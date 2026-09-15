// 操作の反応の被覆表（reactions.json）を照合する（正本）。
// 正本は parity-suite にあり、スキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
// parity-diff は収束判定でインストール済みの parity-suite から同じスクリプトを --recorded で呼ぶ。
//
// 何をするか:
//   1. 現側 metadata.json の reaction_coverage 宣言を読み、declared: true のときだけ反応の被覆表を開く
//   2. 操作ごとに反応の欄が埋まっているかを数え直す（空欄・証拠の欠けは未測定。「なし」も実測の記録を要求する）
//   3. feedback_calls.declared: true なら、移行元ソースを設定のパターンで走査して呼び出し箇所を列挙し、
//      被覆表の call_sites と集合で突き合わせる（記録漏れ・記録だけ残った箇所・反応へ対応付かない箇所を落とす）
//   4. --write なら照合結果を conformance として被覆表へ書き戻す（表の指紋付き）
//   --recorded: ソースを走査せず、表の検査に加えて conformance.ok と表の指紋の一致を要求する
//   （parity-diff の実行環境に移行元ソースがあるとは限らないため。表を後から書き換えたら指紋で落ちる）
//
// 何をしないか: 反応の観測（出るまで待つ・消えるまで測る）はスイートと採取の仕事で、ここでは記録を検査するだけ。
//
// fail-closed: 行が無い・欄が空・型崩れ・重複 id・走査対象 0 件・呼び出し箇所 0 件の免除なしは合格に倒さない。
// 後方互換: reaction_coverage をキーごと持たない旧成果物は判定しない（judged: false。理由を出力に残す）。
//
// 決定論的: 乱数・現在時刻に依存しない（--write の conformance にも時刻を入れない）。
// TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定ロジック・出力形状を変えたら上げる。
 * conformance.tool_version と一致しない記録は --recorded で落ちる。
 * @type {string}
 */
export const VERSION = "1";

/** 反応の種類。none / unmeasured も「欄を埋めた」記録として明示させる（空欄を許さない）。 */
const REACTION_KINDS = ["observed", "none", "unmeasured"];

/** observed の消え方。auto は消えるまでの時間の標本を要求する。 */
const DISMISSAL_MODES = ["auto", "manual", "persistent", "not-applicable"];

/** 走査で辿らないディレクトリ名。 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function positiveNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function nonNegativeNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** 使い方の誤り・型崩れ（exit 2）。 */
export class UsageError extends Error {}

/**
 * metadata.json の reaction_coverage 宣言を読む。
 * @param {unknown} metadata
 * @returns {{ judged: false, reason: string } | { judged: true, path: string }}
 */
export function readDeclaration(metadata) {
  if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");
  if (!Object.hasOwn(metadata, "reaction_coverage")) {
    return {
      judged: false,
      reason: "metadata.json に reaction_coverage が無い旧成果物（反応の被覆を導入する前の採取）",
    };
  }
  const decl = metadata.reaction_coverage;
  if (!isPlainObject(decl)) throw new UsageError("reaction_coverage がオブジェクトでない");
  if (typeof decl.declared !== "boolean")
    throw new UsageError("reaction_coverage.declared が真偽値でない");
  if (decl.declared === false) {
    if (!nonEmptyString(decl.reason)) {
      throw new UsageError(
        "reaction_coverage.declared: false なのに reason が空（免除の根拠が残らない）",
      );
    }
    return { judged: false, reason: decl.reason };
  }
  if (!nonEmptyString(decl.path))
    throw new UsageError("reaction_coverage.path が空でない文字列でない");
  return { judged: true, path: decl.path };
}

/**
 * 表の指紋。conformance を除いた内容をキー順に正規化して sha256 を取る。
 * @param {Record<string, unknown>} table
 * @returns {string}
 */
export function tableFingerprint(table) {
  /** @param {unknown} v @returns {unknown} */
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon);
    if (isPlainObject(v)) {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, canon(v[k])]),
      );
    }
    return v;
  };
  const { conformance: _ignored, ...rest } = table;
  return createHash("sha256")
    .update(JSON.stringify(canon(rest)))
    .digest("hex");
}

/**
 * id の一意性を検査し、使える id の集合を返す（空・重複は problems に積み、集合から外す）。
 * @param {unknown[]} entries
 * @param {string} label
 * @param {string[]} problems
 * @returns {Set<string>}
 */
function collectIds(entries, label, problems) {
  const seen = new Map();
  for (const e of entries) {
    const id = isPlainObject(e) ? e.id : undefined;
    if (!nonEmptyString(id)) {
      problems.push(`${label}: id が空の要素がある`);
      continue;
    }
    if (id.includes("/")) {
      // 反応キー <操作 id>/<反応 id> が別の組と衝突するため索引に入れない
      problems.push(`${label}: id "${id}" が "/" を含む`);
      continue;
    }
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const ok = new Set();
  for (const [id, n] of seen) {
    if (n > 1) problems.push(`${label}: id "${id}" が ${n} 回重複している（先勝ちにしない）`);
    else ok.add(id);
  }
  return ok;
}

/**
 * observed の反応の欠けを返す（無ければ null）。
 * @param {Record<string, unknown>} r
 * @param {Set<string> | null} captureStates - metadata.json の capture_conditions.states（渡されたときだけ照合）
 * @param {Set<string> | null} documents - 表の documents（文書の棚卸し。不正なら null で、表側の問題として別に落ちる）
 * @returns {string | null}
 */
function observedProblem(r, captureStates, documents) {
  if (!nonEmptyString(r.description)) return "description が空";
  if (typeof r.visible !== "boolean") return "visible が真偽値でない";
  if (
    !Array.isArray(r.covered_by) ||
    r.covered_by.length === 0 ||
    !r.covered_by.every(nonEmptyString)
  ) {
    return "covered_by が空（スイートの assertion に落としていない）";
  }
  if (!r.visible) {
    if (!nonEmptyString(r.observation))
      return "visible: false なのに observation（どう確かめたか）が空";
    return null;
  }
  const dest = r.destination;
  if (!isPlainObject(dest) || !nonEmptyString(dest.document) || !nonEmptyString(dest.locator)) {
    return "destination の document / locator が空（出る先の文書と論理名を記録していない）";
  }
  if (documents && !documents.has(/** @type {string} */ (dest.document))) {
    return `destination.document "${dest.document}" が表の documents に無い`;
  }
  const app = r.appearance;
  if (!isPlainObject(app) || !positiveNumber(app.wait_limit_ms))
    return "appearance.wait_limit_ms が正の数でない";
  const delays = app.delay_ms_samples;
  if (!Array.isArray(delays) || delays.length === 0 || !delays.every(nonNegativeNumber)) {
    return "appearance.delay_ms_samples が空・非数を含む";
  }
  if (Math.max(...delays) > app.wait_limit_ms)
    return "appearance.delay_ms_samples に wait_limit_ms を超える標本がある";
  const dis = r.dismissal;
  if (!isPlainObject(dis) || typeof dis.mode !== "string" || !DISMISSAL_MODES.includes(dis.mode)) {
    return `dismissal.mode が語彙（${DISMISSAL_MODES.join(" / ")}）に無い`;
  }
  if (dis.mode === "auto") {
    const d = dis.duration_ms_samples;
    if (!Array.isArray(d) || d.length < 2 || !d.every(positiveNumber)) {
      return "dismissal.mode: auto なのに duration_ms_samples が 2 標本未満・非正数を含む（1 回の観測で消える時間を決めない）";
    }
    if (!nonNegativeNumber(dis.tolerance_ms)) return "dismissal.tolerance_ms が 0 以上の数でない";
    if (dis.tolerance_ms < Math.max(...d) - Math.min(...d)) {
      return "dismissal.tolerance_ms が標本の幅（最大 − 最小）より小さい";
    }
  } else if (!nonEmptyString(dis.evidence)) {
    return `dismissal.mode: ${dis.mode} なのに evidence が空（消えないこと・消え方を確かめた記録が無い）`;
  }
  const cap = r.capture;
  if (!isPlainObject(cap)) return "capture が無い（撮る／撮らないを決めていない）";
  const hasState = nonEmptyString(cap.state);
  const hasReason = nonEmptyString(cap.reason);
  if (hasState === hasReason) return "capture は state と reason のどちらか一方だけを埋める";
  if (hasState && captureStates && !captureStates.has(/** @type {string} */ (cap.state))) {
    return `capture.state "${cap.state}" が capture_conditions.states に無い`;
  }
  return null;
}

/**
 * none の反応の欠けを返す（無ければ null）。
 * @param {Record<string, unknown>} r
 * @param {number | null} windowMs - 表の observation_window_ms
 * @param {Set<string> | null} documents - 表の documents（top と全フレーム）
 * @returns {string | null}
 */
function noneProblem(r, windowMs, documents) {
  const obs = r.observation;
  if (!isPlainObject(obs))
    return "kind: none なのに observation が無い（見ていないと無いを区別できない）";
  if (!positiveNumber(obs.window_ms)) return "observation.window_ms が正の数でない";
  if (windowMs !== null && obs.window_ms < windowMs) {
    return `observation.window_ms が表の observation_window_ms（${windowMs}）より短い`;
  }
  if (
    !Array.isArray(obs.documents) ||
    obs.documents.length === 0 ||
    !obs.documents.every(nonEmptyString)
  ) {
    return "observation.documents が空（どの文書を見たか記録していない）";
  }
  // 操作した器（iframe 等）の中だけを見た none は、親文書や別フレームに出る反応を取りこぼす
  if (!obs.documents.includes("top")) return "observation.documents に top（最上位の文書）が無い";
  if (documents) {
    const seen = new Set(obs.documents);
    const missing = [...documents].filter((d) => !seen.has(d));
    if (missing.length > 0) {
      return `observation.documents が表の documents を網羅していない（見ていない文書: ${missing.join(", ")}）`;
    }
    const unknown = obs.documents.filter((d) => !documents.has(d));
    if (unknown.length > 0) {
      return `observation.documents に表の documents に無い文書がある: ${unknown.join(", ")}`;
    }
  }
  if (!nonEmptyString(obs.method)) return "observation.method が空";
  return null;
}

/**
 * 移行元ソースを走査して呼び出し箇所を列挙する。
 * @param {string} root
 * @param {string[]} paths
 * @param {{ id: string, re: RegExp }[]} patterns
 * @returns {{ files: number, sites: { file: string, line: number, column: number, pattern: string }[] }}
 */
export function scanSources(root, paths, patterns) {
  const absRoot = resolve(root);
  /** @type {string[]} */
  const files = [];
  const visit = (abs) => {
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        if (SKIP_DIRS.has(name)) continue;
        visit(join(abs, name));
      }
    } else if (st.isFile()) {
      files.push(abs);
    }
  };
  for (const p of paths) {
    if (isAbsolute(p)) throw new UsageError(`feedback_calls.source.paths に絶対パスがある: ${p}`);
    const abs = resolve(absRoot, p);
    const rel = relative(absRoot, abs);
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new UsageError(`feedback_calls.source.paths がルートの外を指す: ${p}`);
    }
    try {
      visit(abs);
    } catch (e) {
      throw new UsageError(
        `feedback_calls.source.paths を読めない: ${p}（${e instanceof Error ? e.message : e}）`,
      );
    }
  }
  const unique = [...new Set(files)].sort();
  const sites = [];
  let scanned = 0;
  for (const abs of unique) {
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue; // バイナリは走査しない
    scanned += 1;
    const lines = buf.toString("utf8").split(/\r?\n/);
    const file = relative(absRoot, abs).split(sep).join("/");
    for (let i = 0; i < lines.length; i += 1) {
      for (const p of patterns) {
        // 同じ行の複数の呼び出しを 1 件に潰さない（1 行に 2 つあると 2 つ目の記録漏れが見えなくなる）
        p.re.lastIndex = 0;
        for (let m = p.re.exec(lines[i]); m !== null; m = p.re.exec(lines[i])) {
          sites.push({ file, line: i + 1, column: m.index + 1, pattern: p.id });
          if (m[0] === "") p.re.lastIndex += 1; // 空一致で止まらない
        }
      }
    }
  }
  return { files: scanned, sites };
}

/**
 * 被覆表を検査する。
 * @param {unknown} table
 * @param {{ root?: string, recorded?: boolean, captureStates?: Set<string> | null, slug?: string | null, target?: string | null }} [opts]
 */
export function checkReactions(table, opts = {}) {
  const {
    root = process.cwd(),
    recorded = false,
    captureStates = null,
    slug = null,
    target = null,
  } = opts;
  if (!isPlainObject(table)) throw new UsageError("反応の被覆表がオブジェクトでない");
  /** @type {string[]} */
  const problems = [];
  // 別機能・別 target の表を取り違えて通さない（metadata.json 側の値が無ければ照合できないので main が落とす）
  if (slug !== null && table.slug !== slug) {
    problems.push(
      `被覆表の slug（${String(table.slug)}）が metadata.json の slug（${slug}）と違う`,
    );
  }
  if (target !== null && table.measured_target !== target) {
    problems.push(
      `被覆表の measured_target（${String(table.measured_target)}）が metadata.json の target.name（${target}）と違う`,
    );
  }
  // 文書の棚卸し（最上位の文書 top と全フレーム）。none の観測範囲と出る先の照合に使う
  const docs = table.documents;
  /** @type {Set<string> | null} */
  let documents = null;
  if (!Array.isArray(docs) || docs.length === 0 || !docs.every(nonEmptyString)) {
    problems.push("documents が空でない文字列の配列でない（top と全フレームを棚卸ししていない）");
  } else if (new Set(docs).size !== docs.length) {
    problems.push("documents に重複がある");
  } else if (!docs.includes("top")) {
    problems.push("documents に top（最上位の文書）が無い");
  } else {
    documents = new Set(/** @type {string[]} */ (docs));
  }
  const windowMs = positiveNumber(table.observation_window_ms)
    ? /** @type {number} */ (table.observation_window_ms)
    : null;
  if (windowMs === null)
    problems.push("observation_window_ms が正の数でない（none の観測時間の下限が無い）");

  const operations = Array.isArray(table.operations) ? table.operations : null;
  if (operations === null) throw new UsageError("operations が配列でない");
  if (operations.length === 0)
    problems.push(
      "operations が空（操作が無い機能は metadata.json で declared: false と理由を書く）",
    );
  const opIds = collectIds(operations, "operations", problems);

  /** 反応キー（<操作 id>/<反応 id>）→ kind。call_sites の対応付け先。 */
  const reactionKinds = new Map();
  let reactionCount = 0;
  /** @type {number | null} observed の delay_ms_samples の最大値（observation_window_ms の下限照合に使う） */
  let maxObservedDelay = null;
  /** @type {Set<string>} */
  const unmeasuredOps = new Set();
  for (const op of operations) {
    if (!isPlainObject(op) || !opIds.has(/** @type {string} */ (op.id))) continue;
    const label = `operations["${op.id}"]`;
    const fail = (msg) => {
      problems.push(`${label}: ${msg}`);
      unmeasuredOps.add(/** @type {string} */ (op.id));
    };
    if (!nonEmptyString(op.trigger)) fail("trigger（操作アダプタの呼び出し）が空");
    if (!nonEmptyString(op.immediate_state)) fail("immediate_state（直後の状態）が空");
    const reactions = Array.isArray(op.reactions) ? op.reactions : [];
    if (reactions.length === 0) {
      fail("reactions が空（反応の欄が無い＝見ていない。無いなら kind: none を実測で書く）");
      continue;
    }
    const rIds = collectIds(reactions, `${label}.reactions`, problems);
    if (rIds.size !== reactions.length) unmeasuredOps.add(/** @type {string} */ (op.id));
    const kinds = reactions.map((r) => (isPlainObject(r) ? r.kind : undefined));
    if (kinds.includes("none") && reactions.length > 1)
      fail("kind: none と他の反応が同居している（無いと在るが同時に成立する）");
    for (const r of reactions) {
      if (!isPlainObject(r) || !rIds.has(/** @type {string} */ (r.id))) continue;
      reactionCount += 1;
      const rLabel = `reactions["${r.id}"]`;
      if (typeof r.kind !== "string" || !REACTION_KINDS.includes(r.kind)) {
        fail(`${rLabel}: kind が語彙（${REACTION_KINDS.join(" / ")}）に無い`);
        continue;
      }
      reactionKinds.set(`${op.id}/${r.id}`, r.kind);
      if (r.kind === "unmeasured") {
        fail(
          `${rLabel}: unmeasured${nonEmptyString(r.reason) ? `（${r.reason}）` : "（reason が空）"}`,
        );
        continue;
      }
      const p =
        r.kind === "observed"
          ? observedProblem(r, captureStates, documents)
          : noneProblem(r, windowMs, documents);
      if (p) fail(`${rLabel}: ${p}`);
      if (r.kind === "observed" && isPlainObject(r.appearance)) {
        const d = r.appearance.delay_ms_samples;
        if (Array.isArray(d) && d.length > 0 && d.every(nonNegativeNumber)) {
          maxObservedDelay = Math.max(maxObservedDelay ?? 0, ...d);
        }
      }
    }
  }
  // none の観測時間の下限が観測済みの遅れ以下だと、遅れて出る反応を「無い」と記録しても通る
  if (windowMs !== null && maxObservedDelay !== null && windowMs <= maxObservedDelay) {
    problems.push(
      `observation_window_ms（${windowMs}）が observed の遅れの最大値（${maxObservedDelay}）以下（none の観測が遅れて出る反応を取りこぼす）`,
    );
  }

  // --- 移行元のフィードバック呼び出しとの突き合わせ ---
  const fc = table.feedback_calls;
  if (!isPlainObject(fc) || typeof fc.declared !== "boolean") {
    throw new UsageError("feedback_calls.declared が真偽値でない（キーごと省略しない）");
  }
  /** @type {Record<string, unknown>} */
  const callSummary = { checked: false, found: null, recorded: null, files: null };
  if (fc.declared === false) {
    if (!nonEmptyString(fc.reason))
      problems.push("feedback_calls.declared: false なのに reason が空");
  } else {
    const patterns = Array.isArray(fc.patterns) ? fc.patterns : [];
    if (patterns.length === 0)
      problems.push("feedback_calls.patterns が空（突き合わせる呼び出しが無い）");
    const patIds = collectIds(patterns, "feedback_calls.patterns", problems);
    /** @type {{ id: string, re: RegExp }[]} */
    const compiled = [];
    for (const p of patterns) {
      if (!isPlainObject(p) || !patIds.has(/** @type {string} */ (p.id))) continue;
      if (!nonEmptyString(p.regex)) {
        problems.push(`feedback_calls.patterns["${p.id}"]: regex が空`);
        continue;
      }
      try {
        compiled.push({
          id: /** @type {string} */ (p.id),
          re: new RegExp(/** @type {string} */ (p.regex), "g"),
        });
      } catch (e) {
        throw new UsageError(
          `feedback_calls.patterns["${p.id}"]: regex が不正（${e instanceof Error ? e.message : e}）`,
        );
      }
    }
    const recordedSites = Array.isArray(fc.call_sites) ? fc.call_sites : null;
    if (recordedSites === null) throw new UsageError("feedback_calls.call_sites が配列でない");
    const keyOf = (s) => `${s.file}:${s.line}:${s.column}:${s.pattern}`;
    /** @type {Map<string, number>} */
    const recordedCount = new Map();
    for (const s of recordedSites) {
      if (
        !isPlainObject(s) ||
        !nonEmptyString(s.file) ||
        !Number.isInteger(s.line) ||
        !Number.isInteger(s.column) ||
        s.column < 1 ||
        !nonEmptyString(s.pattern)
      ) {
        problems.push("feedback_calls.call_sites: file / line / column / pattern が欠けた行がある");
        continue;
      }
      const key = keyOf(s);
      recordedCount.set(key, (recordedCount.get(key) ?? 0) + 1);
      const hasReaction = nonEmptyString(s.reaction);
      const hasExcluded = nonEmptyString(s.excluded_reason);
      if (hasReaction === hasExcluded) {
        problems.push(`call_sites ${key}: reaction と excluded_reason のどちらか一方だけを埋める`);
      } else if (hasReaction) {
        const kind = reactionKinds.get(/** @type {string} */ (s.reaction));
        if (kind === undefined)
          problems.push(`call_sites ${key}: reaction "${s.reaction}" が被覆表の反応に無い`);
        else if (kind !== "observed") {
          problems.push(
            `call_sites ${key}: reaction "${s.reaction}" は kind: ${kind}（呼び出しがあるのに観測した反応へ対応付いていない）`,
          );
          const opId = String(s.reaction).split("/")[0];
          if (opIds.has(opId)) unmeasuredOps.add(opId);
        }
      }
    }
    for (const [key, n] of recordedCount) {
      if (n > 1) problems.push(`call_sites ${key}: ${n} 回重複している`);
    }
    const src = fc.source;
    const paths = isPlainObject(src) && Array.isArray(src.paths) ? src.paths : [];
    if (!isPlainObject(src) || paths.length === 0 || !paths.every(nonEmptyString)) {
      problems.push("feedback_calls.source.paths が空（走査範囲が無い）");
    } else if (!nonEmptyString(src.version)) {
      problems.push("feedback_calls.source.version が空（どの版を走査したか残らない）");
    }
    callSummary.recorded = recordedSites.length;
    if (!recorded && paths.length > 0 && paths.every(nonEmptyString) && compiled.length > 0) {
      const scan = scanSources(root, /** @type {string[]} */ (paths), compiled);
      callSummary.checked = true;
      callSummary.files = scan.files;
      callSummary.found = scan.sites.length;
      if (scan.files === 0)
        problems.push("走査対象のテキストファイルが 0 件（走査範囲が誤っている）");
      const foundKeys = new Set(scan.sites.map(keyOf));
      for (const key of foundKeys) {
        if (!recordedCount.has(key))
          problems.push(`call_sites: ソースの呼び出し ${key} が被覆表に記録されていない`);
      }
      for (const key of recordedCount.keys()) {
        if (!foundKeys.has(key))
          problems.push(
            `call_sites: 記録された ${key} がソースに見つからない（版の食い違い・行ずれ）`,
          );
      }
    }
  }

  // --- 記録済みの照合結果（--recorded）---
  const fingerprint = tableFingerprint(table);
  if (recorded) {
    const conf = table.conformance;
    if (!isPlainObject(conf))
      problems.push(
        "conformance が無い（parity-suite で reaction-check を --write 付きで通していない）",
      );
    else {
      if (conf.ok !== true) problems.push("conformance.ok が true でない");
      if (conf.tool_version !== VERSION)
        problems.push(
          `conformance.tool_version が ${VERSION} でない（採り直しの時点と照合規則が違う）`,
        );
      if (conf.table_fingerprint !== fingerprint)
        problems.push(
          "conformance.table_fingerprint が表の内容と一致しない（照合後に表が書き換えられた）",
        );
      if (fc.declared === true && conf.call_sites_checked !== true)
        problems.push("conformance.call_sites_checked が true でない");
    }
  }

  return {
    operations: operations.length,
    reactions: reactionCount,
    unmeasured_operations: unmeasuredOps.size,
    call_sites: callSummary,
    table_fingerprint: fingerprint,
    problems,
  };
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{ readFile?: (p: string) => string, writeFile?: (p: string, s: string) => void, cwd?: string }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const writeFile = deps.writeFile ?? ((p, s) => writeFileSync(p, s));
  const cwd = deps.cwd ?? process.cwd();
  const usage =
    "usage: reaction-check.mjs --metadata <metadata.json> [--root <移行元ソースのルート>] [--write | --recorded]";
  let metadataPath = null;
  let root = cwd;
  let write = false;
  let recorded = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--metadata" || a === "--root") {
      const v = argv[i + 1];
      if (!nonEmptyString(v) || v.startsWith("--")) {
        process.stderr.write(`error: ${a} に値が無い\n${usage}\n`);
        return 2;
      }
      if (a === "--metadata") metadataPath = v;
      else root = resolve(cwd, v);
      i += 1;
    } else if (a === "--write") write = true;
    else if (a === "--recorded") recorded = true;
    else {
      process.stderr.write(`error: 不明な引数 ${a}\n${usage}\n`);
      return 2;
    }
  }
  if (metadataPath === null || (write && recorded)) {
    process.stderr.write(
      `error: ${metadataPath === null ? "--metadata が無い" : "--write と --recorded は同時に使えない"}\n${usage}\n`,
    );
    return 2;
  }
  const out = (obj) =>
    process.stdout.write(
      `${JSON.stringify({ tool: "reaction-check", version: VERSION, ...obj }, null, 2)}\n`,
    );
  try {
    const metadata = JSON.parse(readFile(resolve(cwd, metadataPath)));
    const decl = readDeclaration(metadata);
    if (!decl.judged) {
      out({ judged: false, reason: decl.reason });
      return 0;
    }
    const tablePath = resolve(cwd, decl.path);
    let table;
    try {
      table = JSON.parse(readFile(tablePath));
    } catch (e) {
      out({ judged: true, reason: null, ok: false, unmeasured_operations: null });
      process.stderr.write(
        `error: 反応の被覆表を読めない: ${decl.path}（${e instanceof Error ? e.message : e}）\n`,
      );
      return 1;
    }
    // declared: true の照合は撮影状態・slug・target を必須にする（欠落を照合スキップへ倒すと、存在しない状態名や取り違えた表が通る）
    const cc = metadata.capture_conditions;
    if (!isPlainObject(cc) || !Array.isArray(cc.states) || !cc.states.every(nonEmptyString)) {
      throw new UsageError(
        "metadata.json の capture_conditions.states が空でない文字列の配列でない（撮影状態を確定してから通す）",
      );
    }
    if (!nonEmptyString(metadata.slug)) throw new UsageError("metadata.json の slug が空");
    if (!isPlainObject(metadata.target) || !nonEmptyString(metadata.target.name)) {
      throw new UsageError("metadata.json の target.name が空");
    }
    const result = checkReactions(table, {
      root,
      recorded,
      captureStates: new Set(cc.states),
      slug: metadata.slug,
      target: metadata.target.name,
    });
    const ok = result.unmeasured_operations === 0 && result.problems.length === 0;
    if (write) {
      table.conformance = {
        tool: "reaction-check",
        tool_version: VERSION,
        ok,
        call_sites_checked: result.call_sites.checked,
        table_fingerprint: result.table_fingerprint,
        problems: result.problems.length,
      };
      writeFile(tablePath, `${JSON.stringify(table, null, 2)}\n`);
    }
    out({ judged: true, reason: null, ok, path: decl.path, ...result });
    for (const p of result.problems) process.stderr.write(`warn: ${p}\n`);
    if (!ok) {
      process.stderr.write(
        `error: 反応の未測定 ${result.unmeasured_operations} 操作・不整合 ${result.problems.length} 件 — 測り直す（parity-diff では収束させず parity-suite へ戻す）\n`,
      );
    }
    return ok ? 0 : 1;
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : e}\n${usage}\n`);
    return 2;
  }
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動でサイレント no-op にしない）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  process.exit(main(process.argv.slice(2)));
}
