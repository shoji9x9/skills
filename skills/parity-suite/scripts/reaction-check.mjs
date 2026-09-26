// 操作の反応の被覆表（reactions.json）を照合する（正本）。
// 正本は parity-suite にあり、スキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
// parity-diff は収束判定でインストール済みの parity-suite から同じスクリプトを --recorded で呼ぶ。
//
// 何をするか:
//   1. 現側 metadata.json の reaction_coverage 宣言を読み、declared: true のときだけ反応の被覆表を開く
//   2. 操作ごとに反応の欄が埋まっているかを数え直す（空欄・証拠の欠けは未測定。「なし」も実測の記録を要求する）
//      文書ごとのオリジン（対象 URL と同じか）も数える。別オリジンの文書は親へ反応が届かず「なし」に化けうるので根拠を要求する（Issue #450）
//      操作ごとの頁の組み方の変化（layout）も数える。操作で頁の高さ・要素の位置が変わるなら、2 回以上繰り返した後の実測を要求する（Issue #460）
//      操作を終えた後に残るもの（aftermath）も数える。残る見た目は撮る状態か assertion に割り当て、
//      戻り先は押す前後の URL と、押す前に動かした状態のうち戻った範囲を実測させる（Issue #471）
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
export const VERSION = "4";

/** 反応の種類。none / unmeasured も「欄を埋めた」記録として明示させる（空欄を許さない）。 */
const REACTION_KINDS = ["observed", "none", "unmeasured"];

/**
 * 文書のオリジンが対象 URL（targets[].url）のオリジンと同じか（Issue #450）。
 * 値そのもの（ホスト・ポート）は書かせない——url_command の target は URL を成果物に残さない規約なので、関係だけを記録する。
 */
const ORIGIN_RELATIONS = ["same-origin", "cross-origin"];

/** observed の消え方。auto は消えるまでの時間の標本を要求する。 */
const DISMISSAL_MODES = ["auto", "manual", "persistent", "not-applicable"];

/** layout の矩形 1 つが持つ数値の軸。 */
const RECT_AXES = ["x", "y", "width", "height"];

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
    // 免除は「操作を持たない機能」だけ。理由の文字列だけで通すと、操作のある機能が反応の判定を飛ばして収束する。
    // 画面駆動の機能で、成果物に操作の痕跡（default 以外の撮影状態・器の棚卸し・部品被覆表の宣言）があれば矛盾として落とす
    if (metadata.mode !== "api-resource" && metadata.mode !== "batch") {
      const cc = isPlainObject(metadata.capture_conditions) ? metadata.capture_conditions : {};
      /** @type {string[]} */
      const traces = [];
      if (Array.isArray(cc.states) && cc.states.some((st) => st !== "default")) {
        traces.push("capture_conditions.states に default 以外の状態がある");
      }
      if (Array.isArray(cc.popup_inventory) && cc.popup_inventory.length > 0) {
        traces.push("capture_conditions.popup_inventory が空でない");
      }
      if (
        isPlainObject(metadata.component_coverage) &&
        metadata.component_coverage.declared === true
      ) {
        traces.push("component_coverage.declared が true");
      }
      if (traces.length > 0) {
        throw new UsageError(
          `reaction_coverage.declared: false は操作を持たない機能だけに使えるが、操作の痕跡がある（${traces.join(" / ")}）`,
        );
      }
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
  // 操作した文書。反応の出どころと見た文書のオリジンが違うと、実在する反応が同一オリジンポリシーで届かず「無い」に化ける（表の document_origins で照合する）
  if (!nonEmptyString(obs.source_document)) {
    return "observation.source_document が空（どの文書で操作したかを記録していない。オリジンの照合に使う）";
  }
  if (documents && !documents.has(/** @type {string} */ (obs.source_document))) {
    return `observation.source_document "${obs.source_document}" が表の documents に無い`;
  }
  if (!nonEmptyString(obs.method)) return "observation.method が空";
  // 新側が反応を足しても（遅れて出て消えるトースト等）静止画・特性照合には写らないので、不在もスイートで確かめる
  if (
    !Array.isArray(r.covered_by) ||
    r.covered_by.length === 0 ||
    !r.covered_by.every(nonEmptyString)
  ) {
    return "kind: none なのに covered_by が空（観測時間・文書にわたる不在をスイートの assertion に落としていない）";
  }
  return null;
}

/**
 * 同梱テンプレートの説明文（"<...>" で囲んだプレースホルダ）のままの値か。
 * 空でない文字列というだけで「書いた」と数えると、テンプレートを写しただけの記録が通る。
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlaceholder(v) {
  return typeof v === "string" && /^<[\s\S]*>$/.test(v.trim());
}

/**
 * 頁の組み方の 1 回の測定（操作の前 before、または操作を繰り返した後の samples の 1 件）の欠けを返す（無ければ null）。
 * @param {unknown} m
 * @returns {string | null}
 */
function layoutMeasureProblem(m) {
  if (!isPlainObject(m)) return "オブジェクトでない";
  if (!nonNegativeNumber(m.scroll_height)) return "scroll_height が 0 以上の数でない";
  // 窓に収まるか（scroll_height <= client_height）を読むための分母。スクロールバーを隠す撮影では横幅のずれが矩形に出ないので、はみ出しは高さで見る
  if (!positiveNumber(m.client_height)) return "client_height が正の数でない";
  if (!isPlainObject(m.rects) || Object.keys(m.rects).length === 0) {
    return "rects が空（主な論理名の矩形を測っていない）";
  }
  for (const [name, r] of Object.entries(m.rects)) {
    // 論理名の無い矩形は、どの要素の位置かを名指さないので測った記録にならない
    if (!nonEmptyString(name)) return "rects に空の論理名がある";
    // null は「その時点で表示されない」の記録（操作で現れる要素は操作の前には無い）
    if (r === null) continue;
    if (
      !isPlainObject(r) ||
      !RECT_AXES.every((k) => typeof r[k] === "number" && Number.isFinite(r[k]))
    ) {
      return `rects["${name}"] が { x, y, width, height } の数値でも null でもない`;
    }
    if (/** @type {number} */ (r.width) < 0 || /** @type {number} */ (r.height) < 0) {
      return `rects["${name}"] の width / height が負`;
    }
  }
  return null;
}

/**
 * 操作の頁の組み方の変化（layout）の欠けを返す（無ければ null）。Issue #460
 *
 * 寸法の式（dimension_model）と視覚ベースラインは初期表示の状態しか見ないので、操作で頁の高さや要素の位置が変わる振る舞いは
 * どの経路にも入らない。1 回の操作の差分では「窓から書き直す絶対値」と「前の値からの相対」を区別できないため、
 * 変わるなら 2 回以上繰り返した後を測らせる。
 * @param {unknown} layout
 * @returns {{ problem: string | null, unmeasured: boolean }}
 */
function layoutProblem(layout) {
  if (!isPlainObject(layout)) {
    return {
      problem:
        "layout が無い（操作で頁の高さ・要素の位置が変わるかを測っていない。変わらないなら changes: false を確かめ方付きで書く）",
      unmeasured: true,
    };
  }
  const coveredBy = layout.covered_by;
  const covered =
    Array.isArray(coveredBy) &&
    coveredBy.length > 0 &&
    coveredBy.every((c) => nonEmptyString(c) && !isPlaceholder(c));
  if (layout.changes === null) {
    // 測れなかった記録。未測定として数える（空欄と区別するため理由を要求する）
    return {
      problem: `layout: 未測定${nonEmptyString(layout.reason) ? `（${layout.reason}）` : "（reason が空）"}`,
      unmeasured: true,
    };
  }
  if (typeof layout.changes !== "boolean") {
    return { problem: "layout.changes が true / false / null のどれでもない", unmeasured: true };
  }
  if (layout.changes === false) {
    if (!nonEmptyString(layout.evidence) || isPlaceholder(layout.evidence)) {
      return {
        problem:
          "layout.changes: false なのに evidence が空・テンプレートの説明文のまま（操作の前後で頁の高さ・矩形が変わらないことを確かめた記録が無い）",
        unmeasured: true,
      };
    }
    if (!covered) {
      return {
        problem:
          "layout.changes: false なのに covered_by が空（新側が操作で頁の組み方を変えても、静止画・寸法の照合には写らない）",
        unmeasured: true,
      };
    }
    return { problem: null, unmeasured: false };
  }
  const beforeProblem = layoutMeasureProblem(layout.before);
  if (beforeProblem) return { problem: `layout.before: ${beforeProblem}`, unmeasured: true };
  const samples = layout.samples;
  if (!Array.isArray(samples) || samples.length < 2) {
    return {
      problem:
        "layout.changes: true なのに samples が 2 回未満（1 回の操作の差分では、窓から書き直す絶対値か前の値からの相対かを区別できない）",
      unmeasured: true,
    };
  }
  for (const [i, m] of samples.entries()) {
    const p = layoutMeasureProblem(m);
    if (p) return { problem: `layout.samples[${i}]: ${p}`, unmeasured: true };
  }
  // repeat は 1 から始まる連番（何回目の操作の後か）。欠番・重複は繰り返しの記録として読めない
  const repeats = samples.map((m) => /** @type {Record<string, unknown>} */ (m).repeat);
  if (!repeats.every((r, i) => r === i + 1)) {
    return {
      problem: "layout.samples の repeat が 1 から始まる連番でない（何回目の操作の後かを読めない）",
      unmeasured: true,
    };
  }
  // 測った論理名の集合は前後で揃える（ある回だけ測った要素は、回を跨いだ変わり方を読めない）
  const keysOf = (m) => JSON.stringify(Object.keys(m.rects).sort());
  const beforeKeys = keysOf(layout.before);
  if (!samples.every((m) => keysOf(m) === beforeKeys)) {
    return {
      problem:
        "layout の before と samples で測った論理名が揃っていない（表示されない回は null で書く）",
      unmeasured: true,
    };
  }
  // 矩形は軸の順に正規化して比べる（{ width, height, x, y } と { x, y, width, height } を別物にしない）
  const rectsText = (m) =>
    JSON.stringify(
      Object.keys(m.rects)
        .sort()
        .map((k) => [k, m.rects[k] === null ? null : RECT_AXES.map((ax) => m.rects[k][ax])]),
    );
  const same = (a, b) =>
    a.scroll_height === b.scroll_height &&
    a.client_height === b.client_height &&
    rectsText(a) === rectsText(b);
  if (samples.every((m) => same(m, layout.before))) {
    return {
      problem:
        "layout.changes: true なのに before と全ての samples が同じ（変わらないなら changes: false と確かめ方を書く）",
      unmeasured: false,
    };
  }
  if (!covered) {
    return {
      problem:
        "layout.changes: true なのに covered_by が空（2 回以上繰り返した後の頁の高さ・矩形をスイートの assertion に落としていない）",
      unmeasured: true,
    };
  }
  return { problem: null, unmeasured: false };
}

/**
 * 値が空でない文字列の配列か（テンプレートの説明文のままの要素を含まない）。
 * @param {unknown} v
 * @returns {boolean}
 */
function filledStrings(v) {
  return Array.isArray(v) && v.length > 0 && v.every((c) => nonEmptyString(c) && !isPlaceholder(c));
}

/**
 * 空でなく、テンプレートの説明文のままでもない文字列か。
 * @param {unknown} v
 * @returns {boolean}
 */
function filled(v) {
  return nonEmptyString(v) && !isPlaceholder(v);
}

/**
 * 操作を終えた後に残る見た目（aftermath.look）の欠けを返す。Issue #471
 *
 * 撮影状態の導出は操作の途中（器を開く・指を乗せる等）までしか導かないので、終えた後に残る塗り・色・印は
 * 撮る状態にも assertion にも入らず、差は「差 0 件」と同じ見え方になる。見た目ごとに現行で測った値を残させ、
 * 撮る状態か assertion のどちらか（両方でもよい）に割り当てさせる。どちらにもしないなら理由を要求する。
 * @param {unknown} look
 * @param {Set<string> | null} captureStates
 * @returns {{ problem: string, unmeasured: boolean }[]}
 */
function aftermathLookProblems(look, captureStates) {
  if (!isPlainObject(look)) {
    return [
      {
        problem:
          "aftermath.look が無い（押した後に残る見た目〈塗り・色・印・焦点〉を測っていない。残らないなら changes: false を確かめ方付きで書く）",
        unmeasured: true,
      },
    ];
  }
  if (look.changes === null) {
    return [
      {
        problem: `aftermath.look: 未測定${nonEmptyString(look.reason) ? `（${look.reason}）` : "（reason が空）"}`,
        unmeasured: true,
      },
    ];
  }
  if (typeof look.changes !== "boolean") {
    return [
      { problem: "aftermath.look.changes が true / false / null のどれでもない", unmeasured: true },
    ];
  }
  const items = look.items;
  if (look.changes === false) {
    /** @type {{ problem: string, unmeasured: boolean }[]} */
    const out = [];
    if (!filled(look.evidence)) {
      out.push({
        problem:
          "aftermath.look.changes: false なのに evidence が空・テンプレートの説明文のまま（押した後に見た目が残らないことを確かめた記録が無い）",
        unmeasured: true,
      });
    }
    // 残らないことも assertion にする。新側が押した後に塗り・焦点の輪を残しても、撮っていない状態は 3 経路に写らない
    if (!filledStrings(look.covered_by)) {
      out.push({
        problem:
          "aftermath.look.changes: false なのに covered_by が空（押した後に見た目が残らないことをスイートの assertion に落としていない）",
        unmeasured: true,
      });
    }
    if (Array.isArray(items) && items.length > 0) {
      out.push({
        problem:
          "aftermath.look.changes: false なのに items がある（残らないと残るが同時に成立する）",
        unmeasured: false,
      });
    }
    return out;
  }
  if (!Array.isArray(items) || items.length === 0) {
    return [
      {
        problem:
          "aftermath.look.changes: true なのに items が空（残る見た目を 1 つずつ列挙していない）",
        unmeasured: true,
      },
    ];
  }
  /** @type {string[]} */
  const idProblems = [];
  const ids = collectIds(items, "aftermath.look.items", idProblems);
  /** @type {{ problem: string, unmeasured: boolean }[]} */
  const out = idProblems.map((problem) => ({ problem, unmeasured: true }));
  for (const item of items) {
    if (!isPlainObject(item) || !ids.has(/** @type {string} */ (item.id))) continue;
    const at = `aftermath.look.items["${item.id}"]`;
    if (!filled(item.target) || !filled(item.description)) {
      out.push({ problem: `${at}: target（論理名）/ description が空`, unmeasured: true });
      continue;
    }
    // 現行で 1 度測った値。書かせないと、見た目を思い浮かべただけの列挙と区別が付かない
    if (!filled(item.observed)) {
      out.push({
        problem: `${at}: observed（現行で測った値〈計算後スタイル・印の文言など〉）が空・テンプレートの説明文のまま`,
        unmeasured: true,
      });
      continue;
    }
    const hasState = filled(item.captured);
    const hasAssertion = filledStrings(item.covered_by);
    const hasReason = filled(item.reason);
    if (hasReason && (hasState || hasAssertion)) {
      out.push({
        problem: `${at}: reason と captured / covered_by が両方埋まっている（撮る・押さえると、どちらにもしないが同時に成立する）`,
        unmeasured: false,
      });
      continue;
    }
    if (!hasState && !hasAssertion && !hasReason) {
      out.push({
        problem: `${at}: 撮る状態（captured）にも assertion（covered_by）にも割り当てていない（どちらにもしないなら reason を書き、gaps.md に残す）`,
        unmeasured: true,
      });
      continue;
    }
    if (hasState && captureStates && !captureStates.has(/** @type {string} */ (item.captured))) {
      out.push({
        problem: `${at}: captured "${item.captured}" が capture_conditions.states に無い`,
        unmeasured: true,
      });
    }
  }
  return out;
}

/**
 * 押した後に URL の上でも状態の上でもどこへ戻るか（aftermath.returns_to）の欠けを返す。Issue #471
 *
 * 遷移しないはずの操作が遷移する・戻すはずの状態を戻さない差は、撮った画面の上には現れない。
 * 押す前後の URL と、押す前に既定から動かした状態（probed）のうち押した後に既定へ戻ったもの（reset）を実測させる。
 * 動かしていない状態が戻るかは測れないので、動かさずに測った記録は範囲を語れない。
 * URL は成果物にホスト・ポートを残さない規約（url_command の target）に合わせ、オリジンを除いたパスで書かせる。
 * @param {unknown} ret
 * @returns {{ problem: string, unmeasured: boolean }[]}
 */
function aftermathReturnsProblems(ret) {
  if (!isPlainObject(ret)) {
    return [
      {
        problem:
          "aftermath.returns_to が無い（押した後の遷移先と、押す前に動かした状態のうち戻った範囲を測っていない）",
        unmeasured: true,
      },
    ];
  }
  if (ret.measured === false) {
    return [
      {
        problem: `aftermath.returns_to: 未測定${nonEmptyString(ret.reason) ? `（${ret.reason}）` : "（reason が空）"}`,
        unmeasured: true,
      },
    ];
  }
  if (ret.measured !== true) {
    return [{ problem: "aftermath.returns_to.measured が真偽値でない", unmeasured: true }];
  }
  /** @type {{ problem: string, unmeasured: boolean }[]} */
  const out = [];
  for (const key of ["url_before", "url_after"]) {
    const v = ret[key];
    if (!filled(v) || !String(v).startsWith("/") || String(v).startsWith("//")) {
      out.push({
        problem: `aftermath.returns_to.${key} が "/" で始まるオリジンを除いたパス（クエリ・フラグメントを含む）でない`,
        unmeasured: true,
      });
    }
  }
  const probed = ret.probed;
  const reset = ret.reset;
  const stringsOk = (v) => Array.isArray(v) && v.every(filled) && new Set(v).size === v.length;
  if (!stringsOk(probed) || !stringsOk(reset)) {
    out.push({
      problem:
        "aftermath.returns_to の probed / reset が、重複の無い空でない文字列の配列でない（何も動かしていないなら空配列と probe_skipped_reason）",
      unmeasured: true,
    });
  } else {
    const probedSet = new Set(/** @type {string[]} */ (probed));
    const stray = /** @type {string[]} */ (reset).filter((x) => !probedSet.has(x));
    if (stray.length > 0) {
      out.push({
        problem: `aftermath.returns_to.reset に probed に無い状態がある: ${stray.join(", ")}（動かしていない状態が戻ったかは測れない）`,
        unmeasured: true,
      });
    }
    const skipped = filled(ret.probe_skipped_reason);
    if (probed.length === 0 && !skipped) {
      out.push({
        problem:
          "aftermath.returns_to.probed が空なのに probe_skipped_reason が空（押す前に状態を動かさずに測ると、戻す範囲を「何も戻さない」と区別できない）",
        unmeasured: true,
      });
    }
    if (probed.length > 0 && skipped) {
      out.push({
        problem: "aftermath.returns_to.probed があるのに probe_skipped_reason が埋まっている",
        unmeasured: false,
      });
    }
  }
  if (!filledStrings(ret.covered_by)) {
    out.push({
      problem:
        "aftermath.returns_to.covered_by が空（押した後の URL と、戻る・戻らない状態をスイートの assertion に落としていない）",
      unmeasured: true,
    });
  }
  return out;
}

/**
 * 移行元ソースを走査して呼び出し箇所を列挙する。
 * @param {string} root
 * @param {string[]} paths
 * @param {{ id: string, re: RegExp }[]} patterns
 * @returns {{ files: number, texts: Map<string, string>, sites: { file: string, line: number, column: number, pattern: string }[] }}
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
  /** @type {Map<string, string>} 走査したファイル（/ 区切りの相対パス）→ 本文。ハンドラの来歴の照合に使う */
  const texts = new Map();
  let scanned = 0;
  for (const abs of unique) {
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue; // バイナリは走査しない
    scanned += 1;
    const text = buf.toString("utf8");
    // 行ごとに切ってから照合すると、改行をまたぐ呼び出し（名前と括弧が別の行）を検出できない。
    // ファイル全体に照合し、一致位置から行・列を求める
    const lineStarts = [0];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "\n") lineStarts.push(i + 1);
    }
    const file = relative(absRoot, abs).split(sep).join("/");
    texts.set(file, text);
    for (const p of patterns) {
      p.re.lastIndex = 0;
      for (let m = p.re.exec(text); m !== null; m = p.re.exec(text)) {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (lineStarts[mid] <= m.index) lo = mid;
          else hi = mid - 1;
        }
        sites.push({ file, line: lo + 1, column: m.index - lineStarts[lo] + 1, pattern: p.id });
        if (m[0] === "") p.re.lastIndex += 1; // 空一致で止まらない
      }
    }
  }
  return { files: scanned, texts, sites };
}

/**
 * 被覆表を検査する。
 * @param {unknown} table
 * @param {{ root?: string, recorded?: boolean, captureStates?: Set<string> | null, slug?: string | null, target?: string | null, targetCommit?: unknown }} [opts]
 *   targetCommit は metadata.json の target.commit（undefined なら照合しない。null / none は照合不能として扱う）
 */
export function checkReactions(table, opts = {}) {
  const {
    root = process.cwd(),
    recorded = false,
    captureStates = null,
    slug = null,
    target = null,
    targetCommit = undefined,
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
  // 文書ごとのオリジン（対象 URL と同じか）。Issue #450
  // 移行元が絶対 URL で組み立てるフレームの読み込み先と targets[].url のオリジンが違うと、フレームの中の処理が親の文書に届かず、
  // 実在する反応が「無い」と記録される。差分器は「無い」同士で一致させてしまうので、別オリジンの文書には根拠を要求する
  const origins = table.document_origins;
  /** @type {string[] | null} 別オリジンの文書（読めなければ null） */
  let crossOrigin = null;
  if (!isPlainObject(origins)) {
    problems.push(
      "document_origins が無い（documents の各文書のオリジンが対象 URL と同じか〈same-origin / cross-origin〉を記録していない）",
    );
  } else if (documents) {
    const keys = Object.keys(origins);
    const lacking = [...documents].filter((d) => !Object.hasOwn(origins, d));
    const unknown = keys.filter((k) => !documents.has(k));
    const invalid = keys.filter(
      (k) => documents.has(k) && !ORIGIN_RELATIONS.includes(/** @type {string} */ (origins[k])),
    );
    if (lacking.length > 0) problems.push(`document_origins に無い文書: ${lacking.join(", ")}`);
    if (unknown.length > 0)
      problems.push(`document_origins に表の documents に無い文書がある: ${unknown.join(", ")}`);
    if (invalid.length > 0) {
      problems.push(
        `document_origins の値が ${ORIGIN_RELATIONS.join(" / ")} でない文書: ${invalid.join(", ")}`,
      );
    }
    if (lacking.length === 0 && unknown.length === 0 && invalid.length === 0) {
      crossOrigin = keys.filter((k) => origins[k] === "cross-origin");
    }
  }
  // 根拠は別オリジンの文書ごとに持たせる。表全体で 1 本だと、意図して別オリジンにした文書の根拠が
  // 環境の都合で別オリジンになった文書まで通してしまう（Codex レビュー #453）
  const evidence = table.cross_origin_evidence;
  if (!isPlainObject(evidence)) {
    problems.push(
      'cross_origin_evidence が文書ごとの根拠のオブジェクトでない（{ "<文書>": "<根拠>" }。別オリジンの文書が無ければ {} と書く。キーの欠落を根拠不要に倒さない）',
    );
  } else if (crossOrigin !== null) {
    const lackingEvidence = crossOrigin.filter((d) => !nonEmptyString(evidence[d]));
    if (lackingEvidence.length > 0) {
      problems.push(
        `文書 ${lackingEvidence.join(", ")} が対象 URL と別オリジンなのに cross_origin_evidence にその文書の根拠が無い（移行元の本来の配置でも別オリジンになることを、移行元が組み立てる絶対 URL 等で確かめた根拠を文書ごとに書く。環境の都合で別オリジンになっているなら、targets[].url をそのオリジンに揃えて測り直す）`,
      );
    }
    const staleEvidence = Object.keys(evidence).filter((d) => !crossOrigin.includes(d));
    if (staleEvidence.length > 0) {
      problems.push(
        `cross_origin_evidence に別オリジンでない文書の根拠が残っている: ${staleEvidence.join(", ")}（古い記録。どの文書の根拠かが実測と合わない）`,
      );
    }
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
  /** @type {Map<string, unknown>} 操作 id → handlers（移行元ソースとの突き合わせで照合する） */
  const handlersByOp = new Map();
  for (const op of operations) {
    if (!isPlainObject(op) || !opIds.has(/** @type {string} */ (op.id))) continue;
    const label = `operations["${op.id}"]`;
    const fail = (msg) => {
      problems.push(`${label}: ${msg}`);
      unmeasuredOps.add(/** @type {string} */ (op.id));
    };
    if (!nonEmptyString(op.trigger)) fail("trigger（操作アダプタの呼び出し）が空");
    if (!nonEmptyString(op.immediate_state)) fail("immediate_state（直後の状態）が空");
    const lp = layoutProblem(op.layout);
    if (lp.problem) {
      if (lp.unmeasured) fail(lp.problem);
      else problems.push(`${label}: ${lp.problem}`);
    }
    // 押した後に残る見た目と戻り先（Issue #471）。欠けは layout と同じく未測定に数える
    const am = op.aftermath;
    const amProblems = isPlainObject(am)
      ? [
          ...aftermathLookProblems(am.look, captureStates),
          ...aftermathReturnsProblems(am.returns_to),
        ]
      : [
          {
            problem:
              "aftermath が無い（押した後に残る見た目〈look〉と戻り先〈returns_to〉を測っていない）",
            unmeasured: true,
          },
        ];
    for (const ap of amProblems) {
      if (ap.unmeasured) fail(ap.problem);
      else problems.push(`${label}: ${ap.problem}`);
    }
    handlersByOp.set(/** @type {string} */ (op.id), op.handlers);
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
      /** @type {RegExp} */
      let re;
      try {
        // ファイル全体に照合するので、^ / $ が行頭・行末に効くよう複数行モードにする（行ごとに照合していたときの意味を保つ）
        re = new RegExp(/** @type {string} */ (p.regex), "gm");
      } catch (e) {
        throw new UsageError(
          `feedback_calls.patterns["${p.id}"]: regex が不正（${e instanceof Error ? e.message : e}）`,
        );
      }
      // 陽性コントロール: 実際の呼び出しの字面に一致しないパターンは、走査 0 件を「呼び出しが無い」と区別できない
      if (!nonEmptyString(p.example)) {
        problems.push(
          `feedback_calls.patterns["${p.id}"]: example（一致すべき呼び出しの字面）が空`,
        );
        continue;
      }
      re.lastIndex = 0;
      if (!re.test(/** @type {string} */ (p.example))) {
        problems.push(
          `feedback_calls.patterns["${p.id}"]: regex が example に一致しない（検出器が呼び出しを認識できない）`,
        );
        continue;
      }
      re.lastIndex = 0;
      compiled.push({ id: /** @type {string} */ (p.id), re });
    }
    const zeroReason = nonEmptyString(fc.zero_calls_reason);
    const recordedSites = Array.isArray(fc.call_sites) ? fc.call_sites : null;
    if (recordedSites === null) throw new UsageError("feedback_calls.call_sites が配列でない");
    // 区切り文字の連結はファイル名・パターン id に ":" があると別の箇所が同じキーに潰れるため、組を JSON で符号化する
    const keyOf = (s) => JSON.stringify([s.file, s.line, s.column, s.pattern]);
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
    } else if (targetCommit !== undefined) {
      // 走査した版が測定した現行の版と違えば、測定側にだけある呼び出しが走査に現れない
      const measured =
        nonEmptyString(targetCommit) && targetCommit !== "none" ? targetCommit : null;
      const unverified = nonEmptyString(src.version_unverified_reason);
      if (measured === null || src.version === "none") {
        if (!unverified) {
          problems.push(
            "走査した版と metadata.json の target.commit を照合できない（どちらかが none）のに feedback_calls.source.version_unverified_reason が空",
          );
        }
      } else if (src.version !== measured) {
        problems.push(
          `feedback_calls.source.version（${src.version}）が metadata.json の target.commit（${measured}）と違う（測定した版と別の版を走査している）`,
        );
      } else if (unverified) {
        problems.push(
          "走査した版が target.commit と一致しているのに version_unverified_reason が埋まっている",
        );
      }
    }
    callSummary.recorded = recordedSites.length;
    // ハンドラの来歴: 走査範囲がどの操作のハンドラを覆っているかを表に残させる（範囲の書き漏れを操作単位で見えるようにする）
    /** @type {{ opId: string, file: string, symbol: string }[]} */
    const handlerRefs = [];
    for (const [opId, handlers] of handlersByOp) {
      if (
        !Array.isArray(handlers) ||
        handlers.length === 0 ||
        !handlers.every(
          (h) => isPlainObject(h) && nonEmptyString(h.file) && nonEmptyString(h.symbol),
        )
      ) {
        problems.push(
          `operations["${opId}"]: handlers（file と symbol）が空・欠けている（走査範囲が操作のハンドラを覆うか照合できない）`,
        );
        unmeasuredOps.add(opId);
        continue;
      }
      for (const h of handlers) handlerRefs.push({ opId, file: h.file, symbol: h.symbol });
    }
    // 呼び出し 0 件は「本当に無い」と「走査が外れている」が同じ出力になるため、根拠付きでだけ通す
    if (recordedSites.length === 0 && !zeroReason) {
      problems.push(
        "feedback_calls.call_sites が 0 件なのに zero_calls_reason が空（走査が外れていないことを示せない）",
      );
    }
    if (recordedSites.length > 0 && zeroReason) {
      problems.push(
        "feedback_calls.call_sites があるのに zero_calls_reason が埋まっている（0 件の根拠と矛盾する）",
      );
    }
    if (!recorded && paths.length > 0 && paths.every(nonEmptyString) && compiled.length > 0) {
      const scan = scanSources(root, /** @type {string[]} */ (paths), compiled);
      callSummary.checked = true;
      callSummary.files = scan.files;
      callSummary.found = scan.sites.length;
      for (const h of handlerRefs) {
        const text = scan.texts.get(h.file);
        if (text === undefined) {
          problems.push(
            `operations["${h.opId}"]: ハンドラのファイル ${h.file} が走査範囲に無い・読めていない`,
          );
          unmeasuredOps.add(h.opId);
          continue;
        }
        const escaped = h.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!new RegExp(`(^|[^\\w$])${escaped}([^\\w$]|$)`).test(text)) {
          problems.push(
            `operations["${h.opId}"]: ハンドラ ${h.symbol} が ${h.file} に見つからない`,
          );
          unmeasuredOps.add(h.opId);
        }
      }
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
    if (
      !isPlainObject(cc) ||
      !Array.isArray(cc.states) ||
      cc.states.length === 0 ||
      !cc.states.every(nonEmptyString)
    ) {
      throw new UsageError(
        "metadata.json の capture_conditions.states が空でない文字列の配列でない（撮影状態を確定してから通す）",
      );
    }
    if (!nonEmptyString(metadata.slug)) throw new UsageError("metadata.json の slug が空");
    if (!isPlainObject(metadata.target) || !nonEmptyString(metadata.target.name)) {
      throw new UsageError("metadata.json の target.name が空");
    }
    // 欠落を明示の none と同じ免除へ流さない（照合不能の理由さえ書けば任意の版を通せてしまう）
    if (!nonEmptyString(metadata.target.commit)) {
      throw new UsageError(
        "metadata.json の target.commit が空（コミット SHA か、入手不可なら none を書く）",
      );
    }
    const result = checkReactions(table, {
      root,
      recorded,
      captureStates: new Set(cc.states),
      slug: metadata.slug,
      target: metadata.target.name,
      targetCommit: metadata.target.commit,
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
