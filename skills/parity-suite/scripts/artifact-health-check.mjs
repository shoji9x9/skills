// 採取物と工程の健全性を数える（正本）。
// 正本は parity-suite にあり、スキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
// parity-diff は収束判定でインストール済みの parity-suite から同じスクリプトを呼ぶ。
//
// 何をするか（metadata.json の宣言を読んで数え直す）:
//   1. 採取物（artifact_health）: 採取物ごとに「読むスペック」と「何から作ったか」の宣言を要求する。
//      読み手は字面の照合（スペックの中に basename が現れるか）で足りる——assertion に使っているかまでは見ない。
//      加工物（kind: derived）は元の実体の sha256 を数え直し、一致しなければ古いものとして落とす。
//      baseline_dir に在るのに entries に無いファイルは未宣言として落とす（宣言の無いものだけを落とす）。
//   2. 反復実行（suite.state_mutating / suite.repeat_run）: 状態を変えるスイートは 2 回続けて緑であることを求める。
//      1 回目は初期状態から始まるため後始末の有無が結果に現れない。
//      記録は suite_fingerprint で「どの版のスイートを回したか」に結びつける——
//      結びつけないと、2 回緑を記録した後にスペックや後始末を変えても古い記録で緑のまま通る。
//   3. 未測定（unmeasured）: gaps.md の散文と対になる機械可読の宣言。disposition: blocking が残る間は収束させない。
//   4. 工程の成果物（--target）: suite.new_green が真なら同じ場所に diff-metadata.json が在り、
//      それが「いまの新側」（new.commit と loop.iterations）に対応していることを求める
//      （converged が偽でも落とさない）。dataset_version は数値の一致では見ない——陳腐化の正本は
//      golden-dataset の references/versioning.md で、交差を見るまでもなく確定する形だけをここで落とす。
//      投入対象でない target は dataset_version: null ＋ dataset_version_exempt で免除される（parity-diff の references/preflight.md）。
//
// 何をしないか: 採取・加工・スイートの実行はしない。ここでは記録と実体を突き合わせるだけ。
//
// fail-closed: 宣言が無い・読み手が無い・元が読めない・対象 0 件・判定不能は合格に倒さない。
// 後方互換: artifact_health / unmeasured / suite.state_mutating をキーごと持たない旧成果物は
//           その節を判定しない（judged: false。理由を出力に残す）。
//
// 決定論的: 乱数・現在時刻に依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定ロジック・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "5";

/** 採取物の種別。derived は元の実体から作った加工物。 */
const ARTIFACT_KINDS = ["captured", "derived"];

/** 未測定の処置。語彙外・欠落は blocking として数える（fail-closed）。 */
const DISPOSITIONS = ["blocking", "accepted"];

/**
 * 呼び出し元の工程。同じ記録でも「誰のゲートか」で blocking の扱いが変わる。
 * - diff（既定・最も厳しい）: parity-diff の収束判定。blocking が残る間は収束させない
 * - suite: parity-suite の完了判定。blocking は本スキルが書く出力そのものなので落とさない
 *   （記録の不備——item の空・重複・reason の空・語彙外の disposition・承認記録の無い accepted——は
 *   どちらの工程でも落とす。測定待ちと壊れた記録は別物）
 */
const STAGES = ["diff", "suite"];

/** 反復実行で緑と数える結果。 */
const GREEN = "green";

/** 走査で辿らないディレクトリ名。 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** 使い方の誤り・型崩れ（exit 2）。 */
export class UsageError extends Error {}

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
 * 相対パスが基準ディレクトリの外へ出ないことを確かめてから解決する。
 * @param {string} baseDir
 * @param {string} relPath
 * @returns {string | null} 基準の外・絶対パスなら null
 */
function resolveInside(baseDir, relPath) {
  if (typeof relPath !== "string" || relPath.trim() === "" || isAbsolute(relPath)) return null;
  const resolved = resolve(baseDir, relPath);
  const rel = relative(baseDir, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return resolved;
}

/**
 * ディレクトリ直下を再帰的に列挙し、基準からの相対パスを返す（POSIX 区切りに揃える）。
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(current, entry.name));
      } else if (entry.isFile()) {
        out.push(relative(dir, join(current, entry.name)).split(sep).join("/"));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * JSON を読む。読めない・壊れているは型崩れ（exit 2）。
 * @param {string} path
 * @param {string} label
 * @returns {unknown}
 */
function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new UsageError(
      `${label} を読めない: ${path}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(
      `${label} が JSON として壊れている: ${path}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
}

/**
 * @param {string} path
 * @returns {string} sha256（16 進小文字）
 */
function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * スペックの本文に採取物の名前が「ファイル名として」現れるかを見る。
 * 素の部分文字列一致にすると orders.xlsx が orders.xlsx.json にも当たり、
 * 実際には読まれていない採取物が読み手ありとして素通りする。
 * 前後がファイル名を構成しうる文字（英数・. _ -）でないことまで確かめる。
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
export function includesAsName(text, name) {
  const namePart = /[A-Za-z0-9._-]/;
  let from = 0;
  for (;;) {
    const at = text.indexOf(name, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + name.length] ?? "";
    if (!namePart.test(before) && !namePart.test(after)) return true;
    from = at + 1;
  }
}

/**
 * 採取物の節を数え直す。
 * @param {Record<string, unknown>} metadata
 * @param {{ root: string }} ctx
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
export function checkArtifacts(metadata, ctx) {
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];
  if (!("artifact_health" in metadata)) {
    return {
      judged: false,
      findings,
      notes: ["artifact_health をキーごと持たない旧成果物のため採取物の節を判定しない"],
    };
  }
  const health = metadata.artifact_health;
  if (!isPlainObject(health)) throw new UsageError("artifact_health がオブジェクトでない");
  if (typeof health.declared !== "boolean")
    throw new UsageError("artifact_health.declared が真偽値でない");
  if (!health.declared) {
    if (!nonEmptyString(health.reason))
      throw new UsageError(
        "artifact_health.declared: false なのに reason が空（免除の根拠が残らない）",
      );
    return {
      judged: false,
      findings,
      notes: [
        `artifact_health.declared: false のため判定しない（理由: ${String(health.reason).trim()}）`,
      ],
    };
  }

  if (!nonEmptyString(health.baseline_dir))
    throw new UsageError("artifact_health.baseline_dir が空でない文字列でない");
  const baselineDir = resolveInside(ctx.root, String(health.baseline_dir));
  if (baselineDir === null)
    throw new UsageError(
      `artifact_health.baseline_dir がルートの外を指している: ${String(health.baseline_dir)}`,
    );
  if (!Array.isArray(health.entries)) throw new UsageError("artifact_health.entries が配列でない");

  let present = [];
  if (!existsSync(baselineDir) || !statSync(baselineDir).isDirectory()) {
    findings.push(`artifact_health.declared: true なのに baseline_dir が無い: ${baselineDir}`);
  } else {
    present = listFiles(baselineDir);
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const byPath = new Map();
  const seen = new Set();
  for (const [i, entry] of health.entries.entries()) {
    if (!isPlainObject(entry))
      throw new UsageError(`artifact_health.entries[${i}] がオブジェクトでない`);
    if (!nonEmptyString(entry.path))
      throw new UsageError(`artifact_health.entries[${i}].path が空でない文字列でない`);
    const p = String(entry.path).trim();
    if (seen.has(p)) {
      findings.push(`採取物の宣言が重複している（先勝ちにしない）: ${p}`);
      continue;
    }
    seen.add(p);
    byPath.set(p, entry);
  }

  if (present.length === 0 && byPath.size === 0) {
    findings.push(`採取物が 0 件（宣言も実体も無い）。対象 0 件を合格に倒さない: ${baselineDir}`);
  }

  for (const file of present) {
    if (!byPath.has(file))
      findings.push(`採取物が宣言されていない（読み手が居るか分からない）: ${file}`);
  }

  for (const [p, entry] of byPath) {
    const target = resolveInside(baselineDir, p);
    if (target === null) {
      findings.push(`採取物のパスが baseline_dir の外を指している: ${p}`);
      continue;
    }
    if (!existsSync(target)) {
      findings.push(`宣言された採取物の実体が無い: ${p}`);
      continue;
    }

    const kind = entry.kind;
    if (!ARTIFACT_KINDS.includes(/** @type {string} */ (kind))) {
      findings.push(`採取物の kind が語彙外（${ARTIFACT_KINDS.join(" / ")}）: ${p}`);
    }

    // 読み手（字面の照合）
    const readBy = entry.read_by;
    if (readBy !== undefined && readBy !== null && !Array.isArray(readBy)) {
      throw new UsageError(`artifact_health.entries[${p}].read_by が配列でない`);
    }
    const readers = Array.isArray(readBy) ? readBy : [];
    if (readers.length === 0) {
      if (!nonEmptyString(entry.unread_reason)) {
        findings.push(
          `読み手が宣言されておらず unread_reason も空（採っただけの採取物になる）: ${p}`,
        );
      }
    } else {
      const name = basename(p);
      for (const reader of readers) {
        if (!nonEmptyString(reader)) {
          findings.push(`read_by に空の要素がある: ${p}`);
          continue;
        }
        const specPath = resolveInside(ctx.root, String(reader).trim());
        if (specPath === null || !existsSync(specPath)) {
          findings.push(`read_by が指すスペックが無い: ${String(reader).trim()}（採取物 ${p}）`);
          continue;
        }
        let text;
        try {
          text = readFileSync(specPath, "utf8");
        } catch (e) {
          findings.push(
            `read_by が指すスペックを読めない: ${String(reader).trim()}（${e instanceof Error ? e.message : String(e)}）`,
          );
          continue;
        }
        if (!includesAsName(text, name)) {
          findings.push(
            `read_by が指すスペックに採取物の名前が現れない（字面の照合で不一致）: ${name} ∉ ${String(reader).trim()}`,
          );
        }
      }
    }

    // 鮮度（何から作ったか）
    const derivedFrom = entry.derived_from;
    if (kind === "derived") {
      if (derivedFrom === undefined || derivedFrom === null) {
        if (!nonEmptyString(entry.freshness_unverified_reason)) {
          findings.push(
            `加工物に derived_from が無く freshness_unverified_reason も空（古いかもしれないが未検証としても残らない）: ${p}`,
          );
        }
        continue;
      }
      if (!isPlainObject(derivedFrom))
        throw new UsageError(`artifact_health.entries[${p}].derived_from がオブジェクトでない`);
      if (!nonEmptyString(derivedFrom.path) || !nonEmptyString(derivedFrom.sha256)) {
        findings.push(`derived_from の path / sha256 が空: ${p}`);
        continue;
      }
      const srcRel = String(derivedFrom.path).trim();
      if (!byPath.has(srcRel)) {
        findings.push(
          `derived_from が宣言されていない採取物を指している: ${srcRel}（加工物 ${p}）`,
        );
        continue;
      }
      const srcPath = resolveInside(baselineDir, srcRel);
      if (srcPath === null || !existsSync(srcPath)) {
        findings.push(`derived_from の実体が無い: ${srcRel}（加工物 ${p}）`);
        continue;
      }
      const actual = sha256File(srcPath);
      if (actual !== String(derivedFrom.sha256).trim().toLowerCase()) {
        findings.push(
          `加工物が古い（元の実体の sha256 が宣言と一致しない）: ${p} ← ${srcRel}（宣言 ${String(derivedFrom.sha256).trim()} / 実測 ${actual}）`,
        );
      }
    } else if (derivedFrom !== undefined && derivedFrom !== null) {
      findings.push(`kind: captured なのに derived_from がある（採取か加工かが決まらない）: ${p}`);
    }
  }

  notes.push(`採取物 ${byPath.size} 件を宣言、${present.length} 件を baseline_dir に実測`);
  return { judged: true, findings, notes };
}

/** 反復実行の記録が指す「スイートそのもの」を構成する metadata.suite のキー。 */
const SUITE_SOURCE_KEYS = ["specs", "locator_map", "expectations", "interactions", "tools"];

/**
 * 現在のスイートの指紋を計算する。
 *
 * 2 回緑を記録した後にスペックを書き換えたり後始末を外したりしても、記録だけを見る検査は緑のまま通る。
 * 記録が「どの版のスイートを 2 回回したか」を持たないためで、指紋を記録・照合して初めて
 * 「いまのスイートが 2 回続けて回った」と言える。
 *
 * 列挙は宣言されたパス（suite.specs / locator_map / interactions）から行い、
 * ディレクトリは再帰、並びはソートで固定する。1 つでも実体が無ければ判定不能として null を返す。
 * @param {Record<string, unknown>} suiteObj
 * @param {string} root
 * @returns {{ fingerprint: string | null, files: number, missing: string[] }}
 */
export function suiteFingerprint(suiteObj, root) {
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const files = [];
  let declared = 0;
  for (const key of SUITE_SOURCE_KEYS) {
    const value = suiteObj[key];
    if (!nonEmptyString(value)) continue;
    declared += 1;
    const rel = String(value).trim();
    const abs = resolveInside(root, rel);
    if (abs === null || !existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    if (statSync(abs).isDirectory()) files.push(...listFiles(abs).map((f) => `${rel}/${f}`));
    else files.push(rel);
  }
  if (declared === 0 || missing.length > 0) return { fingerprint: null, files: 0, missing };
  files.sort();
  const digest = createHash("sha256");
  for (const rel of files) {
    const abs = resolveInside(root, rel);
    if (abs === null || !existsSync(abs)) return { fingerprint: null, files: 0, missing: [rel] };
    digest.update(rel);
    digest.update("\0");
    digest.update(sha256File(abs));
    digest.update("\n");
  }
  return { fingerprint: `sha256:${digest.digest("hex")}`, files: files.length, missing: [] };
}

/**
 * 状態を変えるスイートの反復実行を数え直す。
 * @param {Record<string, unknown>} metadata
 * @param {{ artifactHealthPresent: boolean, root: string }} ctx
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
export function checkRepeatRun(metadata, ctx) {
  /** @type {string[]} */
  const findings = [];
  const suite = metadata.suite;
  if (suite !== undefined && suite !== null && !isPlainObject(suite))
    throw new UsageError("suite がオブジェクトでない");
  // suite をキーごと持たない成果物も「state_mutating が無い」と同じ扱いにする（型崩れに倒さない）。
  // artifact_health を宣言していれば下の分岐が未検証として落とすので、後方互換は fail-open にならない。
  const suiteObj = isPlainObject(suite) ? suite : {};
  if (!("state_mutating" in suiteObj)) {
    // 判定の根拠は artifact_health の「宣言の有無」ではなく「キーの有無」。
    // declared: false は視覚採取物を持たない成果物（api-resource 等）の免除であって旧成果物ではなく、
    // 書き込み系 API のスイートこそ 2 回続けての緑を要る側なので、ここで外さない。
    if (ctx.artifactHealthPresent) {
      findings.push(
        "artifact_health を持つ成果物なのに suite.state_mutating が無い（状態を変えるかどうかが決まらない）",
      );
      return { judged: true, findings, notes: [] };
    }
    return {
      judged: false,
      findings,
      notes: ["suite.state_mutating をキーごと持たない旧成果物のため反復実行の節を判定しない"],
    };
  }
  if (typeof suiteObj.state_mutating !== "boolean")
    throw new UsageError("suite.state_mutating が真偽値でない");

  const repeat = suiteObj.repeat_run;
  if (repeat !== undefined && repeat !== null && !isPlainObject(repeat)) {
    throw new UsageError("suite.repeat_run がオブジェクトでない");
  }
  const record = isPlainObject(repeat) ? repeat : {};

  if (!suiteObj.state_mutating) {
    if (!nonEmptyString(record.reason)) {
      findings.push(
        "suite.state_mutating: false なのに repeat_run.reason が空（状態を変えないと判断した根拠が残らない）",
      );
    }
    return {
      judged: true,
      findings,
      notes: ["suite.state_mutating: false のため 2 回続けての緑は求めない"],
    };
  }

  if (record.cleanup_in_suite !== true) {
    findings.push(
      "状態を変えるスイートなのに repeat_run.cleanup_in_suite が true でない（後始末が外の道具に依存すると次の実行が壊れる）",
    );
  }
  const runs = record.runs;
  if (runs !== undefined && runs !== null && !Array.isArray(runs))
    throw new UsageError("suite.repeat_run.runs が配列でない");
  const list = Array.isArray(runs) ? runs : [];
  if (list.length < 2) {
    findings.push(
      `状態を変えるスイートの実行記録が ${list.length} 件（2 回続けて回さないと後始末の有無が結果に現れない）`,
    );
    return { judged: true, findings, notes: [] };
  }
  const tail = list.slice(-2);
  /** @type {string[]} */
  const startedAt = [];
  for (const [i, run] of tail.entries()) {
    if (!isPlainObject(run))
      throw new UsageError(`suite.repeat_run.runs の末尾 ${i + 1} 件目がオブジェクトでない`);
    if (run.result !== GREEN) {
      findings.push(
        `連続する 2 回のうち ${i + 1} 回目が緑でない（result: ${JSON.stringify(run.result)}）`,
      );
    }
    if (!nonEmptyString(run.started_at)) {
      findings.push(`連続する 2 回のうち ${i + 1} 回目の started_at が空`);
    } else {
      startedAt.push(String(run.started_at).trim());
    }
  }
  if (startedAt.length === 2) {
    if (startedAt[0] === startedAt[1]) {
      findings.push(
        `連続する 2 回の started_at が同じ（1 回の記録の写しと区別が付かない）: ${startedAt[0]}`,
      );
    } else {
      const t0 = Date.parse(startedAt[0]);
      const t1 = Date.parse(startedAt[1]);
      if (Number.isNaN(t0) || Number.isNaN(t1)) {
        findings.push(`started_at が日時として読めない: ${startedAt.join(" / ")}`);
      } else if (t1 <= t0) {
        findings.push(
          `2 回目の started_at が 1 回目より後になっていない: ${startedAt.join(" → ")}`,
        );
      }
    }
  }
  /** @type {string[]} */
  const notes = [`状態を変えるスイートの実行記録 ${list.length} 件のうち末尾 2 件を判定`];

  // 記録を「いまのスイート」に結びつける。指紋が無い旧成果物はこの軸を判定しない（理由は残す）。
  const prints = tail.map((run) => (isPlainObject(run) ? run.suite_fingerprint : undefined));
  if (prints.every((p) => p === undefined || p === null)) {
    notes.push(
      "runs[].suite_fingerprint を持たない旧成果物のため、記録が現在のスイートのものかは判定しない",
    );
  } else if (!prints.every((p) => nonEmptyString(p))) {
    findings.push(
      "連続する 2 回のうち片方だけ suite_fingerprint を持つ（どの版のスイートを回したか対応づかない）",
    );
  } else {
    const recorded = prints.map((p) => String(p).trim());
    if (recorded[0] !== recorded[1]) {
      findings.push(
        `連続する 2 回で suite_fingerprint が違う（同じスイートを 2 回続けて回していない）: ${recorded.join(" / ")}`,
      );
    } else {
      const current = suiteFingerprint(suiteObj, ctx.root);
      if (current.fingerprint === null) {
        findings.push(
          `現在のスイートの指紋を計算できない（判定不能を合格に倒さない）: ${current.missing.length > 0 ? `実体が無い ${current.missing.join(" / ")}` : "suite.specs / locator_map / interactions がどれも宣言されていない"}`,
        );
      } else if (current.fingerprint !== recorded[0]) {
        findings.push(
          `記録した 2 回は現在のスイートのものでない（suite_fingerprint ${recorded[0]} ≠ 実測 ${current.fingerprint}）。スイートを変えたら 2 回続けて回し直す`,
        );
      } else {
        notes.push(`スイートの指紋が記録と一致（${current.files} ファイル）`);
      }
    }
  }

  return { judged: true, findings, notes };
}

/**
 * 未測定の宣言を数え直す。
 * @param {Record<string, unknown>} metadata
 * @param {{ stage?: string }} [ctx] stage: "suite" なら blocking を落とさない（既定 "diff"）
 * @returns {{ judged: boolean, findings: string[], notes: string[], blocking: number }}
 */
export function checkUnmeasured(metadata, ctx) {
  const stage = ctx?.stage ?? "diff";
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const pending = [];
  if (!("unmeasured" in metadata)) {
    return {
      judged: false,
      findings,
      notes: ["unmeasured をキーごと持たない旧成果物のため未測定の節を判定しない"],
      blocking: 0,
    };
  }
  const decl = metadata.unmeasured;
  if (!isPlainObject(decl)) throw new UsageError("unmeasured がオブジェクトでない");
  if (typeof decl.declared !== "boolean")
    throw new UsageError("unmeasured.declared が真偽値でない");
  if (!decl.declared) {
    if (!nonEmptyString(decl.reason))
      throw new UsageError("unmeasured.declared: false なのに reason が空（免除の根拠が残らない）");
    return {
      judged: false,
      findings,
      notes: [`unmeasured.declared: false のため判定しない（理由: ${String(decl.reason).trim()}）`],
      blocking: 0,
    };
  }
  if (!Array.isArray(decl.entries)) throw new UsageError("unmeasured.entries が配列でない");

  let blocking = 0;
  const seen = new Set();
  for (const [i, entry] of decl.entries.entries()) {
    if (!isPlainObject(entry))
      throw new UsageError(`unmeasured.entries[${i}] がオブジェクトでない`);
    const item = nonEmptyString(entry.item) ? String(entry.item).trim() : null;
    if (item === null) {
      findings.push(`unmeasured.entries[${i}].item が空（照合キーが無い）`);
      blocking += 1;
      continue;
    }
    if (seen.has(item)) {
      findings.push(`未測定の項目が重複している（先勝ちにしない）: ${item}`);
      blocking += 1;
      continue;
    }
    seen.add(item);
    if (!nonEmptyString(entry.reason)) {
      findings.push(`未測定の理由が空: ${item}`);
      blocking += 1;
      continue;
    }
    const disposition = entry.disposition;
    if (!DISPOSITIONS.includes(/** @type {string} */ (disposition))) {
      findings.push(
        `未測定の disposition が語彙外（${DISPOSITIONS.join(" / ")}）のため blocking として数える: ${item}`,
      );
      blocking += 1;
      continue;
    }
    if (disposition === "accepted") {
      if (!nonEmptyString(entry.approved_by) || !nonEmptyString(entry.approved_at)) {
        findings.push(
          `accepted なのに approved_by / approved_at が空のため blocking として数える: ${item}`,
        );
        blocking += 1;
      }
      continue;
    }
    blocking += 1;
    // suite 工程では blocking は「これから測る」の記録なので落とさない（書いた本人のゲートを止めない）。
    // diff 工程では収束を止める（正本: parity-suite の references/coverage.md「未測定を機械可読にする」）。
    if (stage === "suite") pending.push(item);
    else findings.push(`未測定が残っている（disposition: blocking）: ${item}`);
  }
  const notes = [`未測定の宣言 ${decl.entries.length} 件のうち blocking ${blocking} 件`];
  if (pending.length > 0) {
    notes.push(
      `stage: suite のため blocking ${pending.length} 件は落とさない（parity-diff の収束判定が受け取る）: ${pending.join(" / ")}`,
    );
  }
  return { judged: true, findings, notes, blocking };
}

/**
 * 整数として読める値に直す（数値・数字だけの文字列を受ける）。版と反復回数の両方で使う。
 * @param {unknown} v
 * @returns {number | null}
 */
function toInteger(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number.parseInt(v.trim(), 10);
  return null;
}

/**
 * 記録済みの版 V より後、現在の版 C までの changes[].affects を集める。
 * 履歴が壊れている（欠番・重複・affects が配列でない）ときは null を返す——
 * 正本（golden-dataset の references/versioning.md）が「影響なしへ倒さない」と定めているため、
 * 呼び出し側はこれを陳腐化として扱う。
 * @param {unknown} changes
 * @param {number} v
 * @param {number} c
 * @returns {string[] | null}
 */
export function affectsBetween(changes, v, c) {
  if (!Array.isArray(changes)) return null;
  /** @type {Map<number, string[]>} */
  const byVersion = new Map();
  for (const change of changes) {
    if (!isPlainObject(change)) return null;
    const ver = toInteger(change.version);
    if (ver === null || ver < 1) return null;
    if (byVersion.has(ver)) return null;
    if (!Array.isArray(change.affects)) return null;
    for (const a of change.affects) if (!nonEmptyString(a)) return null;
    byVersion.set(
      ver,
      change.affects.map((a) => String(a).trim()),
    );
  }
  for (let i = 1; i <= c; i += 1) if (!byVersion.has(i)) return null;
  /** @type {string[]} */
  const out = [];
  for (let i = v + 1; i <= c; i += 1) out.push(.../** @type {string[]} */ (byVersion.get(i)));
  return [...new Set(out)];
}

/**
 * 工程が残す成果物の在否と鮮度を数え直す（--target のときだけ）。
 * @param {{ root: string, slugDir: string, target: string }} ctx
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
export function checkStage(ctx) {
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];
  const stageDir = join(ctx.slugDir, "new", ctx.target);
  const replacePath = join(stageDir, "replace-metadata.json");
  if (!existsSync(replacePath)) {
    return {
      judged: false,
      findings,
      notes: [`${replacePath} が無いため工程の節を判定しない（新側の工程が回っていない）`],
    };
  }
  const replaceMeta = readJson(replacePath, "replace-metadata.json");
  if (!isPlainObject(replaceMeta))
    throw new UsageError("replace-metadata.json がオブジェクトでない");
  const replaceSuite = replaceMeta.suite;
  if (replaceSuite !== undefined && replaceSuite !== null && !isPlainObject(replaceSuite)) {
    throw new UsageError("replace-metadata.json の suite がオブジェクトでない");
  }
  const newGreen = isPlainObject(replaceSuite) ? replaceSuite.new_green : undefined;
  if (newGreen !== true) {
    return {
      judged: false,
      findings,
      notes: [`suite.new_green が真でないため工程の節を判定しない（${replacePath}）`],
    };
  }

  const diffPath = join(stageDir, "diff-metadata.json");
  if (!existsSync(diffPath)) {
    findings.push(
      `suite.new_green: true なのに diff-metadata.json が無い（工程の完了が記憶に委ねられている）: ${diffPath}`,
    );
    return { judged: true, findings, notes };
  }
  const diffMeta = readJson(diffPath, "diff-metadata.json");
  if (!isPlainObject(diffMeta)) throw new UsageError("diff-metadata.json がオブジェクトでない");

  // 同じ target の diff-metadata.json が「いまの新側」に対応しているかを見る。
  // dataset_version だけを鮮度にすると、データセットを変えずに parity-replace が作り直した実装に対して、
  // 前の反復で収束した古い diff-metadata.json がそのままこのゲートを満たす（差分を採り直していないのに「済んだ」に見える）。
  // 対応づけは両成果物が既に持っている識別子で取る——新側のコミット SHA と反復回数。
  const replaceNew = isPlainObject(replaceMeta.new) ? replaceMeta.new : null;
  const diffNew = isPlainObject(diffMeta.new) ? diffMeta.new : null;

  // 環境の対応づけ。同じコミット・同じ反復は環境をまたいで一致しうるので、
  // 両成果物が記録している target 名を --target と突き合わせる
  // （別 target のディレクトリへ写しただけの成果物が、その環境で差分を採らずに通るのを塞ぐ）。
  for (const [label, value] of /** @type {[string, unknown][]} */ ([
    ["replace-metadata.json", replaceNew === null ? undefined : replaceNew.target],
    ["diff-metadata.json", diffNew === null ? undefined : diffNew.target],
  ])) {
    if (!nonEmptyString(value)) {
      notes.push(`${label} が new.target を持たないため環境の対応を判定しない（旧成果物）`);
      continue;
    }
    if (String(value).trim() !== ctx.target) {
      findings.push(
        `${label} が別の環境の成果物（new.target ${String(value).trim()} ≠ --target ${ctx.target}）: ${stageDir}`,
      );
    }
  }

  // 未コミット変更のある木では「差分を採った実装」を特定できない。
  // コミットの比較方法（一致 / none / 片側欠落）を選ぶ前に落とす——
  // none の枝へ入ると dirty の判定へ到達せず、同じ反復のまま中身だけ変わった実装が素通りする。
  if (replaceNew !== null && replaceNew.dirty === true) {
    findings.push(
      `新側の版を特定できない（replace-metadata.json の new.dirty: true。未コミット変更があるので版の同一性を確かめられない）: ${diffPath}`,
    );
  }

  const replaceCommit = replaceNew === null ? undefined : replaceNew.commit;
  const diffCommit = diffNew === null ? undefined : diffNew.commit;
  if (nonEmptyString(replaceCommit) && nonEmptyString(diffCommit)) {
    const wanted = String(replaceCommit).trim();
    const recordedCommit = String(diffCommit).trim();
    if (wanted === "none" || recordedCommit === "none") {
      notes.push(
        `new.commit が none（新側リポジトリのコミットを持たない）ため版の対応は反復回数だけで判定する: ${diffPath}`,
      );
    } else if (wanted !== recordedCommit) {
      findings.push(
        `diff-metadata.json が今の新側の版に対応していない（new.commit ${recordedCommit} ≠ replace-metadata.json の ${wanted}）: ${diffPath}`,
      );
    }
  } else {
    notes.push(
      "new.commit を片側が持たないため新側の版の対応を判定しない（旧成果物）: 記録があれば次の実行から判定する",
    );
  }

  const loop = isPlainObject(replaceMeta.loop) ? replaceMeta.loop : null;
  const iterations = toInteger(loop === null ? undefined : loop.iterations);
  const recordedIteration = toInteger(diffMeta.iteration);
  if (iterations !== null && recordedIteration !== null) {
    if (recordedIteration !== iterations) {
      findings.push(
        `diff-metadata.json が前の反復のもの（iteration ${recordedIteration} ≠ replace-metadata.json の loop.iterations ${iterations}）: ${diffPath}`,
      );
    }
  } else {
    notes.push(
      "iteration / loop.iterations を片側が持たないため反復の対応を判定しない（旧成果物）: 記録があれば次の実行から判定する",
    );
  }

  // 投入対象でない target（db を持たない／seedable の無い読み取り専用）は phase B との整合を免除できる。
  // 正本: parity-diff の references/preflight.md と assets/diff-metadata-template.json の dataset_version_exempt。
  // 免除は dataset_version: null と対で書かれるので、空の判定より先に見る（正規の記録を落とさない）。
  const exempt = diffMeta.dataset_version_exempt;
  if (exempt !== undefined && exempt !== null && typeof exempt !== "string") {
    throw new UsageError("diff-metadata.json の dataset_version_exempt が文字列でも null でもない");
  }
  if (nonEmptyString(exempt)) {
    // 免除は「dataset_version: null ＋ 理由」という閉じた対（正本の定める形）。
    // 理由が残っているだけで版の検査を飛ばすと、投入対象の target に古い免除文字列が残ったまま
    // 鮮度の判定が丸ごと外れる。対になっていなければ免除ではなく記録の不整合として落とす。
    if (diffMeta.dataset_version !== null) {
      findings.push(
        `dataset_version_exempt があるのに dataset_version が null でない（免除は null と対の記録。現在 ${JSON.stringify(diffMeta.dataset_version)}）: ${diffPath}`,
      );
    } else {
      notes.push(`dataset_version を免除して判定（理由: ${String(exempt).trim()}）: ${diffPath}`);
      notes.push(
        `工程の成果物を判定（converged: ${JSON.stringify(diffMeta.converged)} は判定に入れない）`,
      );
      return { judged: true, findings, notes };
    }
  }

  const datasetPath = join(ctx.root, ".replace", "dataset", "metadata.json");
  if (!existsSync(datasetPath)) {
    findings.push(
      `データセットの版を読めないため鮮度を判定できない（判定不能を合格に倒さない）: ${datasetPath}`,
    );
    return { judged: true, findings, notes };
  }
  const datasetMeta = readJson(datasetPath, "dataset/metadata.json");
  if (!isPlainObject(datasetMeta))
    throw new UsageError("dataset/metadata.json がオブジェクトでない");
  const current = datasetMeta.version;
  const recorded = diffMeta.dataset_version;
  if (current === undefined || current === null || String(current).trim() === "") {
    findings.push(`データセットの version が空のため鮮度を判定できない: ${datasetPath}`);
    return { judged: true, findings, notes };
  }
  if (recorded === undefined || recorded === null || String(recorded).trim() === "") {
    findings.push(
      `diff-metadata.json の dataset_version が空で dataset_version_exempt も空（古いかどうかを判定できない）: ${diffPath}`,
    );
    return { judged: true, findings, notes };
  }

  // 数値が古いだけでは陳腐化にしない。正本は golden-dataset の references/versioning.md——
  // 記録済み V・現在 C として 1 <= V <= C を確かめ、V < change.version <= C の affects が
  // slug の実効参照テーブルと交差するときだけ陳腐化する。実効参照テーブルは .replace/features.md から
  // 導くもので導出規則の正本は golden-dataset 側にあるため、ここで 2 つ目の実装を作らない。
  // ここで落とすのは、交差を見るまでもなく陳腐化が確定する形（版が読めない・区間に * がある・履歴が壊れている）だけ。
  const v = toInteger(recorded);
  const c = toInteger(current);
  if (v === null || c === null) {
    findings.push(
      `dataset_version が整数として読めない（記録 ${JSON.stringify(recorded)} / 現在 ${JSON.stringify(current)}）: ${diffPath}`,
    );
    return { judged: true, findings, notes };
  }
  if (v < 1 || v > c) {
    findings.push(
      `dataset_version の範囲が不正（記録 ${v} / 現在 ${c}。1 <= 記録 <= 現在 を満たさない）: ${diffPath}`,
    );
    return { judged: true, findings, notes };
  }
  if (v < c) {
    const affects = affectsBetween(datasetMeta.changes, v, c);
    if (affects === null) {
      findings.push(
        `dataset の changes 履歴が壊れている（欠番・重複・affects が配列でない）ため影響なしに倒さない（記録 ${v} / 現在 ${c}）: ${datasetPath}`,
      );
    } else if (affects.includes("*")) {
      findings.push(
        `記録後の変更が全機能に影響する（changes[].affects に * がある。記録 ${v} / 現在 ${c}）: ${diffPath}`,
      );
    } else {
      notes.push(
        `dataset_version は記録 ${v} / 現在 ${c}。区間の affects（${affects.join(", ") || "なし"}）と slug の実効参照テーブルの交差判定は golden-dataset の references/versioning.md が正本のためここでは数えない`,
      );
    }
  }
  // converged が偽でも落とさない——偽は「まだ直っていない」の記録であり、隠す相手ではない。
  notes.push(
    `工程の成果物を判定（converged: ${JSON.stringify(diffMeta.converged)} は判定に入れない）`,
  );
  return { judged: true, findings, notes };
}

/**
 * metadata.json のパスからリポジトリルートを導く（.replace の親）。
 * @param {string} metadataPath
 * @returns {string | null}
 */
export function deriveRoot(metadataPath) {
  const parts = resolve(metadataPath).split(sep);
  const i = parts.lastIndexOf(".replace");
  if (i <= 0) return null;
  return parts.slice(0, i).join(sep) || sep;
}

/**
 * @param {string[]} argv
 * @returns {{ metadata: string, root: string | null, target: string | null }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--metadata" || arg === "--root" || arg === "--target" || arg === "--stage") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} に値が無い`);
      opts[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new UsageError(
      `使い方: artifact-health-check.mjs --metadata <path> [--root <dir>] [--target <name>] [--stage diff|suite]（不明な引数: ${arg}）`,
    );
  }
  if (!nonEmptyString(opts.metadata)) throw new UsageError("--metadata は必須");
  const stage = opts.stage ?? "diff";
  if (!STAGES.includes(stage)) {
    throw new UsageError(`--stage は ${STAGES.join(" | ")} のいずれか（渡された値: ${stage}）`);
  }
  return { metadata: opts.metadata, root: opts.root ?? null, target: opts.target ?? null, stage };
}

/**
 * @param {string[]} argv
 * @param {{ log: (line: string) => void }} io
 * @returns {number} 終了コード
 */
export function run(argv, io) {
  const args = parseArgs(argv);
  const metadataPath = resolve(args.metadata);
  if (!existsSync(metadataPath)) throw new UsageError(`metadata.json が無い: ${metadataPath}`);
  const metadata = readJson(metadataPath, "metadata.json");
  if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");

  const root = args.root !== null ? resolve(args.root) : deriveRoot(metadataPath);
  if (root === null) {
    throw new UsageError(
      `metadata.json のパスから .replace を見つけられないため --root を渡す: ${metadataPath}`,
    );
  }
  const slugDir = resolve(metadataPath, "..");

  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];

  const artifacts = checkArtifacts(metadata, { root });
  findings.push(...artifacts.findings);
  notes.push(...artifacts.notes);

  const repeat = checkRepeatRun(metadata, {
    artifactHealthPresent: "artifact_health" in metadata,
    root,
  });
  findings.push(...repeat.findings);
  notes.push(...repeat.notes);

  const unmeasured = checkUnmeasured(metadata, { stage: args.stage });
  findings.push(...unmeasured.findings);
  notes.push(...unmeasured.notes);

  if (args.target !== null) {
    if (!nonEmptyString(args.target)) throw new UsageError("--target が空");
    const stage = checkStage({ root, slugDir, target: args.target.trim() });
    findings.push(...stage.findings);
    notes.push(...stage.notes);
  } else {
    notes.push("--target が無いため工程の節を判定しない");
  }

  for (const note of notes) io.log(`note: ${note}`);
  for (const finding of findings) io.log(`warn: ${finding}`);
  if (findings.length > 0) {
    io.log(
      `error: 採取物・工程の健全性に ${findings.length} 件の未検証／不整合が残る — 収束させず直す`,
    );
    return 1;
  }
  io.log(`ok: 採取物・工程の健全性は条件を満たす（artifact-health-check ${VERSION}）`);
  return 0;
}

/** 使い方（stderr に出す。CLI エントリ判定が壊れたときのサイレント no-op を検出できるようにする）。 */
const usage = [
  "usage: artifact-health-check.mjs --metadata <path> [--root <dir>] [--target <name>] [--stage diff|suite]",
  "  --metadata  .replace/parity/<slug>/metadata.json のパス（必須）",
  "  --root      リポジトリルート（省略時は metadata のパスの .replace の親から導く）",
  "  --target    新側 target 名。渡したときだけ工程の成果物（diff-metadata.json）の在否と鮮度を判定する",
  "  --stage     呼び出し元の工程。diff（既定・収束判定。未測定の blocking で落とす） | suite（完了判定。blocking は落とさない）",
  "exit: 0 = 条件を満たす（判定しない節を含む） / 1 = 未検証・不整合が残る / 2 = 使い方の誤り・型崩れ",
].join("\n");

/**
 * @param {string[]} argv
 * @returns {number} 終了コード
 */
export function main(argv) {
  try {
    return run(argv, { log: (line) => process.stdout.write(`${line}\n`) });
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`error: ${e.message}\n${usage}\n`);
      return 2;
    }
    throw e;
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
