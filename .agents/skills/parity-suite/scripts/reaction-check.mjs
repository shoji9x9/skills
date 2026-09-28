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
//      操作が最終的に呼ぶ送信・実行の関数の手前にある判定（pre_send）も数える。部品の内側の判定は画面の処理にも
//      部品へ渡す引数にも現れず、境界の外側でしか姿を現さないので、境界の両側を現行で測らせる（Issue #483）
//      表への書き込み（side_effect_writes）も数える。移行元ソースを書き込みのパターンで走査して全件と突き合わせ、
//      1 か所ずつ値・時機・回数と確かめ方を記録させる（Issue #466。利用者に見える反応が無いので反応の欄には現れない）
//      画面ごとの状態表示（空データ・取得の失敗・読み込み中・トースト・ダイアログ）も数える。候補ごとに ある／ない を現行で測らせ、
//      要求に結び付く候補（取得の失敗・読み込み中）の「ない」は要求の横取りで試した記録か、要求が無いことの記録でだけ通す。
//      送る操作ごとの「送っている間にもう一度押す」（resubmit）も数える。応答を保留して押し直し、送った回数・確認の回数・覆いを測らせ、
//      表への書き込みを持つ操作は書き込みの回数とも突き合わせる（Issue #500。1 回押した後の反応や押している最中の見た目には現れない）
//   3. feedback_calls.declared: true なら、移行元ソースを設定のパターンで走査して呼び出し箇所を列挙し、
//      被覆表の call_sites と集合で突き合わせる（記録漏れ・記録だけ残った箇所・反応へ対応付かない箇所を落とす）。
//      side_effect_writes.declared: true なら、表に書いた書き込みのパターンで同じく走査して sites と突き合わせる
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
export const VERSION = "6";

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

/** 送る前の判定の種類（Issue #483）。 */
const PRE_SEND_KINDS = [
  "count-limit",
  "length-limit",
  "size-limit",
  "required",
  "format",
  "range",
  "other",
];

/** 境界のどちら側を測ったか。inside ＝ 判定を通る側（上限ちょうど・形式の内側）、outside ＝ 止まる側（1 つ超え・形式の外側）。 */
const BOUNDARY_SIDES = ["inside", "outside"];

/** 表への書き込みが通る経路（Issue #466）。例外処理の中の書き込みは通常の操作では起きないので経路を分けて数える。 */
const WRITE_PATHS = ["normal", "exception"];

/** 表への書き込みの確かめ方。source-only は移行元で起こせない書き込み（例外時等）を読解だけで記録したもの。 */
const WRITE_VERIFICATIONS = ["assertion", "source-only"];

/**
 * 画面ごとに ある／ない を振り分ける状態表示の候補（Issue #500）。
 * 操作が返すトースト・ダイアログは反応の欄が測るが、画面の状態（0 件・取得の失敗・読み込み中）に出るものは操作の反応に現れない。
 */
const STATE_DISPLAY_CANDIDATES = ["empty", "fetch-error", "loading", "toast", "dialog"];

/** 状態表示の候補の振り分け。unmeasured は理由付きでも未測定として数える。 */
const STATE_DISPLAY_STATUSES = ["present", "absent", "unmeasured"];

/**
 * 状態表示を作った（作ろうとした）手段。route-* は要求の横取り（Playwright の page.route で abort / fulfill / 応答の保留）。
 * no-request は画面がその状態に結び付く要求を送らないこと、not-applicable は画面がその状態を持つ器を持たないことの記録。
 */
const STATE_SETUP_METHODS = [
  "data",
  "ui",
  "route-abort",
  "route-fulfill",
  "route-delay",
  "no-request",
  "not-applicable",
];

/** 要求の横取り。request（横取りした要求）を要求する。 */
const INTERCEPT_METHODS = ["route-abort", "route-fulfill", "route-delay"];

/**
 * 候補ごとに absent（ない）を名乗れる手段。取得の失敗と読み込み中は、移行元で「起こせない」と書かれやすいが
 * 要求の横取りで起こせる（Issue #500）。横取りで試した記録か、要求が無いことの記録が無い「ない」は通さない。
 * @type {Record<string, string[]>}
 */
const ABSENT_METHODS = {
  empty: ["data", "ui", "route-fulfill", "not-applicable"],
  "fetch-error": ["route-abort", "route-fulfill", "no-request"],
  loading: ["route-delay", "no-request"],
  toast: ["data", "ui", "route-abort", "route-fulfill", "route-delay", "not-applicable"],
  dialog: ["data", "ui", "route-abort", "route-fulfill", "route-delay", "not-applicable"],
};

/** absent の記録のうち、不在を確かめる assertion を置けないもの（状態を作る要求・器がそもそも無い）。 */
const ABSENT_WITHOUT_ASSERTION = ["no-request", "not-applicable"];

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
  // 同じ状態名の使い回しの照合は checkReactions が全操作を見た後に行う（残る見た目の captured と合わせて数える）
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
    // 残らないことを確かめた論理名。強度ゲートがここへ押した後だけ残る塗りを注入し、不在の assertion が赤くなるかを確かめる
    if (!filledStrings(look.targets)) {
      out.push({
        problem:
          "aftermath.look.changes: false なのに targets（残らないことを確かめた論理名）が空（強度ゲートが注入する先が無く、不在の assertion の空振りを検出できない）",
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
 * probed は操作ごとの自己申告だと、1 つだけ動かして 1 つだけ確かめた記録が通る（Codex レビュー）。
 * 表で 1 回だけ宣言した画面の状態の棚卸し（screen_states）と突き合わせ、動かさなかった状態には理由を要求する。
 * @param {unknown} ret
 * @param {string[] | null} screenStates - 表の screen_states.states（読めなければ null で、表側の問題として別に落ちる）
 * @returns {{ problem: string, unmeasured: boolean }[]}
 */
function aftermathReturnsProblems(ret, screenStates) {
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
        "aftermath.returns_to の probed / reset が、重複の無い空でない文字列の配列でない（何も動かしていないなら空配列）",
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
    const notProbed = ret.not_probed;
    if (!isPlainObject(notProbed)) {
      out.push({
        problem:
          'aftermath.returns_to.not_probed が状態ごとの理由のオブジェクトでない（{ "<状態>": "<動かさなかった理由>" }。全て動かしたなら {}）',
        unmeasured: true,
      });
    } else if (screenStates !== null) {
      const declared = new Set(screenStates);
      const unknown = /** @type {string[]} */ (probed).filter((x) => !declared.has(x));
      if (unknown.length > 0) {
        out.push({
          problem: `aftermath.returns_to.probed に表の screen_states に無い状態がある: ${unknown.join(", ")}（棚卸しに足すか名前を合わせる）`,
          unmeasured: true,
        });
      }
      // 動かしていない状態が戻るかは測れない。棚卸しの全ての状態を、動かしたか・理由付きで動かさなかったかのどちらかにする
      const lacking = screenStates.filter((x) => !probedSet.has(x) && !filled(notProbed[x]));
      if (lacking.length > 0) {
        out.push({
          problem: `aftermath.returns_to: 画面の状態 ${lacking.join(", ")} を押す前に動かしておらず、not_probed に理由も無い（戻す範囲を語れない）`,
          unmeasured: true,
        });
      }
      const stale = Object.keys(notProbed).filter((x) => !declared.has(x) || probedSet.has(x));
      if (stale.length > 0) {
        out.push({
          problem: `aftermath.returns_to.not_probed に、棚卸しに無い・動かした状態の理由が残っている: ${stale.join(", ")}`,
          unmeasured: false,
        });
      }
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
 * 横取り・保留した要求の URL のパターンが、オリジン（スキームとホスト・ポート）を含まない形か。
 * 成果物にホスト・ポートを残さない規約（url_command の target）に合わせ、実行時に解決した URL がそのまま記録されるのを落とす
 * （Codex レビュー #504）。先頭の `*`（Playwright の glob）を外した残りが `/` で始まるパス（`//` で始まらない）で、
 * どこにも `://` を含まないものだけを通す——`https://host/…`・`//host/…` に加えて、glob の後ろにスキームやホストを書いた
 * `*` + `*://host/…` の形も落とす。
 * @param {unknown} v
 * @returns {boolean}
 */
function originFreePattern(v) {
  if (!filled(v)) return false;
  const path = String(v).trim().replace(/^\*+/, "");
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("://");
}

/**
 * 状態表示の候補 1 つ（state_displays.pages[].candidates の 1 値）の欠けを返す。Issue #500
 *
 * 「状態表示」を散文の観点にしておくと、画面がその状態を持つかを一度も測らないまま完了できる。
 * 候補ごとに ある（present）／ない（absent）を現行で測らせ、ある は撮る状態か assertion へ割り当てさせる。
 * ない も測った結果なので、不在を確かめる assertion を要求する（新側が警告のダイアログを足しても、撮っていない状態は 3 経路に写らない）。
 * toast / dialog も操作の反応を参照させない。参照は画面・見えるか・種別の一致を検査で保証し続ける必要があり、
 * 軸を 1 つ塞ぐたびに別の軸の穴が出た（Codex レビュー #504 で 3 巡）ので、入力形式ごと外した。反応と同じ assertion 名を covered_by に書く。
 * @param {unknown} entry
 * @param {string} candidate - STATE_DISPLAY_CANDIDATES の 1 つ
 * @param {Set<string> | null} captureStates
 * @returns {{ problem: string, unmeasured: boolean }[]}
 */
function stateDisplayProblems(entry, candidate, captureStates) {
  if (!isPlainObject(entry)) {
    return [
      {
        problem: `${candidate} の記録がオブジェクトでない（status: present / absent / unmeasured で書く）`,
        unmeasured: true,
      },
    ];
  }
  if (typeof entry.status !== "string" || !STATE_DISPLAY_STATUSES.includes(entry.status)) {
    return [
      {
        problem: `${candidate}.status が語彙（${STATE_DISPLAY_STATUSES.join(" / ")}）に無い`,
        unmeasured: true,
      },
    ];
  }
  if (entry.status === "unmeasured") {
    return [
      {
        problem: `${candidate}: 未測定${filled(entry.reason) ? `（${entry.reason}）` : "（reason が空）"}`,
        unmeasured: true,
      },
    ];
  }
  /** @type {{ problem: string, unmeasured: boolean }[]} */
  const out = [];
  const setup = entry.setup;
  const method = isPlainObject(setup) ? setup.method : undefined;
  const allowed =
    entry.status === "present"
      ? STATE_SETUP_METHODS.filter((m) => !ABSENT_WITHOUT_ASSERTION.includes(m))
      : ABSENT_METHODS[candidate];
  if (typeof method !== "string" || !allowed.includes(method)) {
    out.push({
      problem:
        entry.status === "absent" && (candidate === "fetch-error" || candidate === "loading")
          ? `${candidate}: absent の setup.method が ${allowed.join(" / ")} でない（「起こせない」と書く前に要求の横取り〈page.route の abort / fulfill / 応答の保留〉で試す。画面がその要求を送らないなら no-request）`
          : `${candidate}: ${entry.status} の setup.method が ${allowed.join(" / ")} でない（その状態をどう作った・作ろうとしたかが残らない）`,
      unmeasured: true,
    });
  } else {
    if (!filled(/** @type {Record<string, unknown>} */ (setup).detail)) {
      out.push({
        problem: `${candidate}: setup.detail（状態の作り方〈検索条件・横取りした応答の中身・保留した時間〉）が空`,
        unmeasured: true,
      });
    }
    // 横取りした要求を書かせないと、どの要求を止めたか（画面の本体の取得か、無関係な要求か）を読めない
    if (
      INTERCEPT_METHODS.includes(method) &&
      !originFreePattern(/** @type {Record<string, unknown>} */ (setup).request)
    ) {
      out.push({
        problem: `${candidate}: setup.method: ${method} なのに setup.request（横取りした要求の URL のパターン。オリジンは書かない）が空・オリジン付き`,
        unmeasured: true,
      });
    }
  }
  // 現行で見たもの。ある なら文言・覆い・ページ表示、ない なら代わりに見えたもの（表示が変わらない等）
  if (!filled(entry.observed)) {
    out.push({
      problem: `${candidate}: observed（現行で見た文言・覆い・ページ表示。ない なら代わりに見えたもの）が空・テンプレートの説明文のまま`,
      unmeasured: true,
    });
  }
  const hasState = filled(entry.captured);
  const hasAssertion = filledStrings(entry.covered_by);
  // 反応の参照は受け付けない（黙って無視すると、参照だけで割り当てたつもりの記録が「割り当てなし」と別の理由で落ち、直し方を誤る）
  if (Object.hasOwn(entry, "reactions")) {
    out.push({
      problem: `${candidate}: reactions は書けない（操作の反応を参照せず、撮る状態〈captured〉か assertion〈covered_by。反応と同じ assertion 名でよい〉で押さえる）`,
      unmeasured: true,
    });
  }
  if (entry.status === "present") {
    if (!hasState && !hasAssertion) {
      out.push({
        problem: `${candidate}: present なのに撮る状態（captured）にも assertion（covered_by）にも割り当てていない`,
        unmeasured: true,
      });
    }
    if (hasState && captureStates && !captureStates.has(/** @type {string} */ (entry.captured))) {
      out.push({
        problem: `${candidate}: captured "${entry.captured}" が capture_conditions.states に無い`,
        unmeasured: true,
      });
    }
    return out;
  }
  // absent
  if (hasState) {
    out.push({
      problem: `${candidate}: absent なのに captured がある（ないと在るが同時に成立する）`,
      unmeasured: false,
    });
  }
  if (!ABSENT_WITHOUT_ASSERTION.includes(/** @type {string} */ (method)) && !hasAssertion) {
    out.push({
      problem: `${candidate}: absent なのに covered_by が空（その状態で何も出ないことをスイートの assertion にしていない。新側が出しても写らない）`,
      unmeasured: true,
    });
  }
  return out;
}

/**
 * 画面ごとの状態表示の振り分け（state_displays）を検査する。Issue #500
 *
 * 画面の集合は metadata.json の capture_conditions.pages（宣言）から取る。記録した画面の一覧を期待値にすると、
 * 画面ごと落とした振り分けが期待値からも消える。
 * @param {unknown} sd
 * @param {{ pageNames: Set<string> | null, captureStates: Set<string> | null, problems: string[], captureUses: Map<string, { opId: string | null, label: string, shared: boolean }[]>, captureLabel: Map<string, string> }} ctx
 * @returns {{ pages: number | null, entries: number, unmeasured: number }}
 */
function checkStateDisplays(sd, ctx) {
  const { pageNames, captureStates, problems, captureUses, captureLabel } = ctx;
  const summary = { pages: null, entries: 0, unmeasured: 0 };
  if (!isPlainObject(sd) || !Array.isArray(sd.pages)) {
    problems.push(
      "state_displays.pages が配列でない（画面ごとに状態表示の候補〈空データ・取得の失敗・読み込み中・トースト・ダイアログ〉を ある／ない へ振り分ける。キーごと省略しない）",
    );
    summary.unmeasured += 1;
    return summary;
  }
  if (pageNames === null || pageNames.size === 0) {
    problems.push(
      "state_displays を画面の集合と照合できない（metadata.json の capture_conditions.pages を読めない）",
    );
    summary.unmeasured += 1;
  }
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const row of sd.pages) {
    const page = isPlainObject(row) ? row.page : undefined;
    if (!filled(page)) {
      problems.push("state_displays.pages: page（capture_conditions.pages の名前）が空の行がある");
      summary.unmeasured += 1;
      continue;
    }
    seen.set(/** @type {string} */ (page), (seen.get(/** @type {string} */ (page)) ?? 0) + 1);
  }
  for (const [page, n] of seen) {
    if (n > 1)
      problems.push(`state_displays.pages: 画面 "${page}" が ${n} 回ある（先勝ちにしない）`);
  }
  if (pageNames !== null) {
    const lacking = [...pageNames].filter((pg) => !seen.has(pg));
    if (lacking.length > 0) {
      problems.push(
        `state_displays: 画面 ${lacking.join(", ")} の状態表示を振り分けていない（capture_conditions.pages の全ての画面を 1 回ずつ書く）`,
      );
      summary.unmeasured += lacking.length;
    }
    const unknown = [...seen.keys()].filter((pg) => !pageNames.has(pg));
    if (unknown.length > 0) {
      problems.push(
        `state_displays: 画面 ${unknown.join(", ")} が capture_conditions.pages に無い（誤記・旧称）`,
      );
    }
  }
  summary.pages = seen.size;
  for (const row of sd.pages) {
    if (
      !isPlainObject(row) ||
      !filled(row.page) ||
      seen.get(/** @type {string} */ (row.page)) !== 1
    )
      continue;
    const at = `state_displays["${row.page}"]`;
    const candidates = row.candidates;
    if (!isPlainObject(candidates)) {
      problems.push(
        `${at}: candidates が候補ごとの記録のオブジェクトでない（${STATE_DISPLAY_CANDIDATES.join(" / ")} を全て書く）`,
      );
      summary.unmeasured += 1;
      continue;
    }
    const lacking = STATE_DISPLAY_CANDIDATES.filter((c) => !Object.hasOwn(candidates, c));
    if (lacking.length > 0) {
      problems.push(
        `${at}: 候補 ${lacking.join(", ")} を振り分けていない（ある／ない を現行で測って書く。測れなければ status: unmeasured と理由）`,
      );
      summary.unmeasured += lacking.length;
    }
    const unknown = Object.keys(candidates).filter((c) => !STATE_DISPLAY_CANDIDATES.includes(c));
    if (unknown.length > 0) {
      problems.push(
        `${at}: 候補の語彙（${STATE_DISPLAY_CANDIDATES.join(" / ")}）に無いキー: ${unknown.join(", ")}`,
      );
    }
    for (const c of STATE_DISPLAY_CANDIDATES) {
      if (!Object.hasOwn(candidates, c)) continue;
      summary.entries += 1;
      const entry = candidates[c];
      const found = stateDisplayProblems(entry, c, captureStates);
      if (found.some((f) => f.unmeasured)) summary.unmeasured += 1;
      for (const f of found) problems.push(`${at}: ${f.problem}`);
      // 撮る状態は撮影の単位（ページ × 状態名）で、反応・残る見た目の撮る状態と同じ集合に入れて使い回しを数える
      if (isPlainObject(entry) && entry.status === "present" && filled(entry.captured)) {
        const key = JSON.stringify([row.page, entry.captured]);
        if (!captureLabel.has(key)) captureLabel.set(key, `${row.page} の ${entry.captured}`);
        const uses = captureUses.get(key) ?? [];
        uses.push({ opId: null, label: `${at}.${c}`, shared: filled(entry.shared_capture_reason) });
        captureUses.set(key, uses);
      }
    }
  }
  return summary;
}

/**
 * 送っている間にもう一度押したときの振る舞い（resubmit）の欠けを返す。Issue #500
 *
 * 撮影状態の active は押している最中の見た目で、反応の欄は 1 回押した後を測る。要求が往復している間の操作の受け付け
 * （無視する・もう一度送る・確認をもう一度出す）はどちらにも現れず、移行元と移行先で違いやすい。
 * 応答を保留して（page.route で応答を返さずに待つ）押し直し、送った回数・確認の回数・画面の覆いを現行で測らせる。
 * @param {unknown} rs
 * @param {boolean} writes - この操作に表への書き込み（side_effect_writes の除外していない sites）があるか
 * @returns {{ problem: string, unmeasured: boolean }[]}
 */
function resubmitProblems(rs, writes) {
  if (!isPlainObject(rs)) {
    return [
      {
        problem:
          "resubmit が無い（送る操作なら、応答を保留して押し直したときの送った回数・確認の回数・覆いを測る。送らないなら sends: false と根拠）",
        unmeasured: true,
      },
    ];
  }
  if (rs.sends === null) {
    return [
      {
        problem: `resubmit: 未測定${filled(rs.reason) ? `（${rs.reason}）` : "（reason が空）"}`,
        unmeasured: true,
      },
    ];
  }
  if (rs.sends === false) {
    /** @type {{ problem: string, unmeasured: boolean }[]} */
    const out = [];
    if (!filled(rs.reason)) {
      out.push({
        problem:
          "resubmit.sends: false なのに reason（要求を送らないことを確かめた記録）が空・テンプレートの説明文のまま",
        unmeasured: true,
      });
    }
    // 表へ書き込む操作は要求を送っている。送らないと書いた記録は書き込みの記録と矛盾する
    if (writes) {
      out.push({
        problem:
          "resubmit.sends: false なのに、この操作の表への書き込みが side_effect_writes.sites にある（書き込む操作は送っている）",
        unmeasured: true,
      });
    }
    for (const key of ["hold", "presses", "observed", "writes", "covered_by"]) {
      if (rs[key] !== undefined && rs[key] !== null) {
        out.push({
          problem: `resubmit.sends: false なのに ${key} がある（送らないと送るが同時に成立する）`,
          unmeasured: false,
        });
      }
    }
    return out;
  }
  if (rs.sends !== true) {
    return [{ problem: "resubmit.sends が true / false / null のどれでもない", unmeasured: true }];
  }
  /** @type {{ problem: string, unmeasured: boolean }[]} */
  const out = [];
  // 応答を保留しないと、押し直す前に往復が終わり「送っている間」を一度も作らない
  const hold = rs.hold;
  if (!isPlainObject(hold) || hold.method !== "route-delay" || !originFreePattern(hold.request)) {
    out.push({
      problem:
        "resubmit.hold が { method: route-delay, request: <保留した要求の URL のパターン。オリジンは書かない> } でない（応答を保留せずに押し直すと、送っている間を作れない）",
      unmeasured: true,
    });
  }
  if (!Number.isInteger(rs.presses) || /** @type {number} */ (rs.presses) < 2) {
    out.push({
      problem:
        "resubmit.presses（応答を保留している間に押した回数。最初の 1 回を含む）が 2 以上の整数でない",
      unmeasured: true,
    });
  }
  const obs = rs.observed;
  if (
    !isPlainObject(obs) ||
    !Number.isInteger(obs.requests_sent) ||
    /** @type {number} */ (obs.requests_sent) < 1 ||
    !Number.isInteger(obs.confirms_shown) ||
    /** @type {number} */ (obs.confirms_shown) < 0 ||
    !filled(obs.overlay)
  ) {
    out.push({
      problem:
        "resubmit.observed に、送った回数（requests_sent: 1 以上の整数）・確認の回数（confirms_shown: 0 以上の整数）・覆い（overlay: 画面を覆って受け付けない・押した要素だけ不活性・何もしない等）が揃っていない",
      unmeasured: true,
    });
  }
  const w = rs.writes;
  if (writes) {
    // 書き込みの回数は送った回数と別に数える（1 回の送信が 2 行書く・2 回送っても 1 行に畳む処理がある）
    if (
      !isPlainObject(w) ||
      !Number.isInteger(w.count) ||
      /** @type {number} */ (w.count) < 0 ||
      !filled(w.evidence)
    ) {
      out.push({
        problem:
          "resubmit.writes が { count: <押し直しで表に書かれた行の数>, evidence: <数え方> } でない（この操作は side_effect_writes.sites に書き込みがあるので、送った回数を書き込みの回数と突き合わせる）",
        unmeasured: true,
      });
    }
  } else if (w !== undefined && w !== null) {
    out.push({
      problem:
        "resubmit.writes があるのに、この操作の表への書き込みが side_effect_writes.sites に無い（書き込みを sites に記録するか writes を消す）",
      unmeasured: false,
    });
  }
  if (!filledStrings(rs.covered_by)) {
    out.push({
      problem:
        "resubmit.covered_by が空（送っている間の押し直しで送った回数・確認の回数・覆いをスイートの assertion にしていない）",
      unmeasured: true,
    });
  }
  return out;
}

/**
 * 移行元ソースの 1 箇所（ファイルとシンボル）の参照か。
 * @param {unknown} ref
 * @returns {ref is { file: string, symbol: string }}
 */
function isSourceRef(ref) {
  return isPlainObject(ref) && filled(ref.file) && filled(ref.symbol);
}

/**
 * シンボルが本文に語として現れるか（前後が識別子の文字でない）。
 * @param {string} text
 * @param {string} symbol
 * @returns {boolean}
 */
function symbolIn(text, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w$])${escaped}([^\\w$]|$)`).test(text);
}

/**
 * 操作が最終的に呼ぶ送信・実行の関数の手前にある判定（pre_send）の欠けを返す。Issue #483
 *
 * 件数・長さ・大きさの上限や必須・形式の検証は、共通部品のクライアント側スクリプトや送信の関数の中に置かれることがあり、
 * 画面の処理にも部品へ渡す引数にも現れない。ふだんの操作では通るので、スイートも差分器も両側で緑のまま新側に判定が無いことが分からない。
 * そこで、どこまで追ったか（traced_to）を残させ、判定ごとに境界の両側（通る側と止まる側）を現行で測った記録と assertion を要求する。
 * 判定の順序（確認・記録・送信のどれより前か）も order に残させる——順序が違うと、止めたときに残る記録や出る確認の回数が変わる。
 * @param {unknown} ps
 * @returns {{ problems: { problem: string, unmeasured: boolean }[], refs: { file: string, symbol: string, label: string }[] }}
 */
function preSendProblems(ps) {
  /** @type {{ problem: string, unmeasured: boolean }[]} */
  const out = [];
  /** @type {{ file: string, symbol: string, label: string }[]} */
  const refs = [];
  if (!isPlainObject(ps)) {
    out.push({
      problem:
        "pre_send が無い（操作が最終的に呼ぶ送信・実行の関数まで追い、送る前の判定〈上限・境界値・検証〉を列挙していない。無いなら found: false を確かめ方付きで書く）",
      unmeasured: true,
    });
    return { problems: out, refs };
  }
  if (ps.found === null) {
    out.push({
      problem: `pre_send: 未測定${nonEmptyString(ps.reason) ? `（${ps.reason}）` : "（reason が空）"}`,
      unmeasured: true,
    });
    return { problems: out, refs };
  }
  if (typeof ps.found !== "boolean") {
    out.push({ problem: "pre_send.found が true / false / null のどれでもない", unmeasured: true });
    return { problems: out, refs };
  }
  // 到達点。画面の処理で読むのを止めると、部品の内側の判定は読まれない（Issue #483 の実例は送信の関数の中の上限）
  const traced = ps.traced_to;
  if (!Array.isArray(traced) || traced.length === 0 || !traced.every(isSourceRef)) {
    out.push({
      problem:
        "pre_send.traced_to（追った到達点〈送信・実行の直前の関数〉のファイルとシンボル）が空・欠けている（どこまで読んだかが残らない）",
      unmeasured: true,
    });
  } else {
    for (const t of traced)
      refs.push({ file: t.file, symbol: t.symbol, label: "pre_send.traced_to" });
  }
  if (!filled(ps.trace)) {
    out.push({
      problem:
        "pre_send.trace が空（操作のハンドラから部品の内側を通って到達点までどう辿ったかが残らない）",
      unmeasured: true,
    });
  }
  const checks = ps.items;
  if (ps.found === false) {
    if (!filled(ps.evidence)) {
      out.push({
        problem:
          "pre_send.found: false なのに evidence が空・テンプレートの説明文のまま（到達点まで読んで送る前の判定が無いことを確かめた記録が無い）",
        unmeasured: true,
      });
    }
    if (Array.isArray(checks) && checks.length > 0) {
      out.push({
        problem: "pre_send.found: false なのに items がある（無いと在るが同時に成立する）",
        unmeasured: false,
      });
    }
    return { problems: out, refs };
  }
  if (!Array.isArray(checks) || checks.length === 0) {
    out.push({
      problem: "pre_send.found: true なのに items が空（判定を 1 つずつ列挙していない）",
      unmeasured: true,
    });
    return { problems: out, refs };
  }
  /** @type {string[]} */
  const idProblems = [];
  const ids = collectIds(checks, "pre_send.items", idProblems);
  for (const problem of idProblems) out.push({ problem, unmeasured: true });
  for (const item of checks) {
    if (!isPlainObject(item) || !ids.has(/** @type {string} */ (item.id))) continue;
    const at = `pre_send.items["${item.id}"]`;
    if (typeof item.kind !== "string" || !PRE_SEND_KINDS.includes(item.kind)) {
      out.push({
        problem: `${at}: kind が語彙（${PRE_SEND_KINDS.join(" / ")}）に無い`,
        unmeasured: true,
      });
    }
    if (!isSourceRef(item.location)) {
      out.push({
        problem: `${at}: location（判定のあるファイルとシンボル）が空・欠けている`,
        unmeasured: true,
      });
    } else {
      refs.push({
        file: item.location.file,
        symbol: item.location.symbol,
        label: `${at}.location`,
      });
    }
    if (!filled(item.condition) || !filled(item.on_block)) {
      out.push({
        problem: `${at}: condition（止める条件）/ on_block（止めたときに起きること）が空`,
        unmeasured: true,
      });
    }
    // 判定の順序。確認・記録・送信と並べて、この判定がどこに入るかを残す（自分だけの 1 要素では前後を語れない）
    const order = item.order;
    if (
      !Array.isArray(order) ||
      order.length < 2 ||
      !order.every(filled) ||
      new Set(order).size !== order.length ||
      !order.includes(item.id)
    ) {
      out.push({
        problem: `${at}: order が、この判定の id を 1 回含む 2 つ以上の重複の無い工程の並びでない（確認・記録・送信のどれより前かが残らない）`,
        unmeasured: true,
      });
    }
    const sides = item.sides;
    if (!Array.isArray(sides) || sides.length === 0) {
      out.push({
        problem: `${at}: sides が空（境界の両側〈通る側 inside と止まる側 outside〉を現行で測っていない）`,
        unmeasured: true,
      });
      continue;
    }
    /** @type {Set<string>} */
    const measuredSides = new Set();
    for (const [i, side] of sides.entries()) {
      const sat = `${at}.sides[${i}]`;
      if (
        !isPlainObject(side) ||
        typeof side.side !== "string" ||
        !BOUNDARY_SIDES.includes(side.side)
      ) {
        out.push({
          problem: `${sat}: side が ${BOUNDARY_SIDES.join(" / ")} でない`,
          unmeasured: true,
        });
        continue;
      }
      // どう境界の状態を作ったか。ゴールデンデータの件数が境界に届かないときは、届かないことと代わりの作り方をここに残す
      if (!filled(side.input) || !filled(side.setup)) {
        out.push({
          problem: `${sat}: input（与えた値）/ setup（境界の状態をどう作ったか。ゴールデンデータが届かないなら代わりの作り方）が空`,
          unmeasured: true,
        });
        continue;
      }
      if (filled(side.observed) && filledStrings(side.covered_by)) {
        measuredSides.add(side.side);
        continue;
      }
      out.push({
        problem: filled(side.reason)
          ? `${sat}: 未測定（${side.reason}）`
          : `${sat}: observed（現行で測った結果）/ covered_by（assertion）が空`,
        unmeasured: true,
      });
    }
    const lacking = BOUNDARY_SIDES.filter((x) => !measuredSides.has(x));
    if (lacking.length > 0 && out.every((o) => !o.problem.startsWith(`${at}.sides`))) {
      out.push({
        problem: `${at}: 境界の ${lacking.join(" / ")} 側を測っていない（ふだんの操作は通る側しか通らないので、止まる側を測らないと新側に判定が無くても緑になる）`,
        unmeasured: true,
      });
    }
  }
  return { problems: out, refs };
}

/**
 * 走査のパターン（id・regex・example）をコンパイルする。example に一致しないパターンは落とす（走査 0 件を「無い」と区別する陽性コントロール）。
 * @param {unknown[]} patterns
 * @param {Set<string>} patIds
 * @param {string} label
 * @param {string[]} problems
 * @returns {{ id: string, re: RegExp, pattern: Record<string, unknown> }[]}
 */
function compilePatterns(patterns, patIds, label, problems) {
  /** @type {{ id: string, re: RegExp, pattern: Record<string, unknown> }[]} */
  const compiled = [];
  for (const p of patterns) {
    if (!isPlainObject(p) || !patIds.has(/** @type {string} */ (p.id))) continue;
    if (!nonEmptyString(p.regex)) {
      problems.push(`${label}["${p.id}"]: regex が空`);
      continue;
    }
    /** @type {RegExp} */
    let re;
    try {
      // ファイル全体に照合するので、^ / $ が行頭・行末に効くよう複数行モードにする（行ごとに照合していたときの意味を保つ）
      re = new RegExp(/** @type {string} */ (p.regex), "gm");
    } catch (e) {
      throw new UsageError(
        `${label}["${p.id}"]: regex が不正（${e instanceof Error ? e.message : e}）`,
      );
    }
    // 陽性コントロール: 実際の呼び出しの字面に一致しないパターンは、走査 0 件を「呼び出しが無い」と区別できない
    if (!nonEmptyString(p.example)) {
      problems.push(`${label}["${p.id}"]: example（一致すべき呼び出しの字面）が空`);
      continue;
    }
    re.lastIndex = 0;
    if (!re.test(/** @type {string} */ (p.example))) {
      problems.push(
        `${label}["${p.id}"]: regex が example に一致しない（検出器が呼び出しを認識できない）`,
      );
      continue;
    }
    re.lastIndex = 0;
    compiled.push({ id: /** @type {string} */ (p.id), re, pattern: p });
  }
  return compiled;
}

/**
 * 走査範囲と走査した版の欠けを返す。走査した版が測定した現行の版と違えば、測定側にだけある呼び出しが走査に現れない。
 * @param {unknown} src
 * @param {unknown} targetCommit - metadata.json の target.commit（undefined なら照合しない）
 * @param {string} label - 例: feedback_calls.source
 * @returns {string[]}
 */
function sourceProblems(src, targetCommit, label) {
  const paths = isPlainObject(src) && Array.isArray(src.paths) ? src.paths : [];
  if (!isPlainObject(src) || paths.length === 0 || !paths.every(nonEmptyString)) {
    return [`${label}.paths が空（走査範囲が無い）`];
  }
  if (!nonEmptyString(src.version)) return [`${label}.version が空（どの版を走査したか残らない）`];
  if (targetCommit === undefined) return [];
  const measured = nonEmptyString(targetCommit) && targetCommit !== "none" ? targetCommit : null;
  const unverified = nonEmptyString(src.version_unverified_reason);
  if (measured === null || src.version === "none") {
    return unverified
      ? []
      : [
          `走査した版と metadata.json の target.commit を照合できない（どちらかが none）のに ${label}.version_unverified_reason が空`,
        ];
  }
  if (src.version !== measured) {
    return [
      `${label}.version（${src.version}）が metadata.json の target.commit（${measured}）と違う（測定した版と別の版を走査している）`,
    ];
  }
  if (unverified) {
    return [
      `${label}: 走査した版が target.commit と一致しているのに version_unverified_reason が埋まっている`,
    ];
  }
  return [];
}

/**
 * 表への書き込み（side_effect_writes）を検査する。Issue #466
 *
 * 監査・利用ログのような表への書き込みは利用者に見える反応を出さないので、反応の欄では「反応が無い」に落ち、
 * 差分器の 3 経路（画素・特性・aria）も DB を見ない。書き込みがまるごと無い新側でもスイートと差分検出が緑になる。
 * 書き込みのパターンで移行元ソースを走査して全件（例外処理の中を含む）と突き合わせ、1 か所ずつ値・時機・回数と確かめ方を残させる。
 * @param {unknown} sew
 * @param {{ opIds: Set<string>, root: string, recorded: boolean, targetCommit: unknown, problems: string[] }} ctx
 * @returns {{ declared: boolean | null, checked: boolean, found: number | null, recorded: number | null, files: number | null }}
 */
function checkSideEffectWrites(sew, ctx) {
  const { opIds, root, recorded, targetCommit, problems, writeOps } = ctx;
  const summary = { declared: null, checked: false, found: null, recorded: null, files: null };
  if (!isPlainObject(sew) || typeof sew.declared !== "boolean") {
    problems.push(
      "side_effect_writes.declared が真偽値でない（表への書き込み〈監査・利用ログ等〉を移行元ソースから列挙したかを書く。書き込みを持たない機能は declared: false と理由。キーごと省略しない）",
    );
    return summary;
  }
  summary.declared = sew.declared;
  if (sew.declared === false) {
    if (!filled(sew.reason)) problems.push("side_effect_writes.declared: false なのに reason が空");
    for (const key of ["tables", "patterns", "sites"]) {
      const value = sew[key];
      if (value !== undefined && !(Array.isArray(value) && value.length === 0))
        problems.push(
          `side_effect_writes.declared: false なのに ${key} がある（書き込みが無いと在るが同時に成立する。記録したなら declared: true で走査させる）`,
        );
    }
    return summary;
  }
  const tables = sew.tables;
  /** @type {Set<string>} */
  let tableSet = new Set();
  if (
    !Array.isArray(tables) ||
    tables.length === 0 ||
    !tables.every(filled) ||
    new Set(tables).size !== tables.length
  ) {
    problems.push(
      "side_effect_writes.tables が重複の無い空でない文字列の配列でない（features.md の副作用出力にある書き込み先の表を列挙する）",
    );
  } else {
    tableSet = new Set(/** @type {string[]} */ (tables));
  }
  const patterns = Array.isArray(sew.patterns) ? sew.patterns : [];
  if (patterns.length === 0)
    problems.push("side_effect_writes.patterns が空（書き込みの呼び出しを探すパターンが無い）");
  const patIds = collectIds(patterns, "side_effect_writes.patterns", problems);
  const compiled = compilePatterns(patterns, patIds, "side_effect_writes.patterns", problems);
  /** @type {Map<string, string>} パターン id → 書き込み先の表 */
  const tableOfPattern = new Map();
  for (const c of compiled) {
    const t = c.pattern.table;
    if (!filled(t) || !tableSet.has(/** @type {string} */ (t))) {
      problems.push(
        `side_effect_writes.patterns["${c.id}"]: table "${String(t)}" が side_effect_writes.tables に無い`,
      );
      continue;
    }
    tableOfPattern.set(c.id, /** @type {string} */ (t));
  }
  const patternless = [...tableSet].filter((t) => ![...tableOfPattern.values()].includes(t));
  if (patternless.length > 0) {
    problems.push(
      `side_effect_writes: 表 ${patternless.join(", ")} への書き込みを探すパターンが無い（走査しない表は全件を突き合わせられない）`,
    );
  }
  const sites = Array.isArray(sew.sites) ? sew.sites : null;
  if (sites === null) throw new UsageError("side_effect_writes.sites が配列でない");
  const keyOf = (s) => JSON.stringify([s.file, s.line, s.column, s.pattern]);
  /** @type {Map<string, number>} */
  const recordedCount = new Map();
  /** @type {Set<string>} 書き込み箇所を 1 件以上記録した表 */
  const writtenTables = new Set();
  for (const s of sites) {
    if (
      !isPlainObject(s) ||
      !nonEmptyString(s.file) ||
      !Number.isInteger(s.line) ||
      !Number.isInteger(s.column) ||
      s.column < 1 ||
      !nonEmptyString(s.pattern)
    ) {
      problems.push("side_effect_writes.sites: file / line / column / pattern が欠けた行がある");
      continue;
    }
    const key = keyOf(s);
    recordedCount.set(key, (recordedCount.get(key) ?? 0) + 1);
    const at = `side_effect_writes.sites ${key}`;
    if (!patIds.has(/** @type {string} */ (s.pattern))) {
      problems.push(`${at}: pattern "${s.pattern}" が side_effect_writes.patterns に無い`);
      continue;
    }
    if (filled(s.excluded_reason)) continue; // この機能の書き込みではない（別 slug の操作の呼び出し等）
    const table = tableOfPattern.get(/** @type {string} */ (s.pattern));
    if (table !== undefined) writtenTables.add(table);
    // 送っている間の押し直し（resubmit）で書き込みの回数を突き合わせる操作
    if (opIds.has(/** @type {string} */ (s.operation)))
      writeOps.add(/** @type {string} */ (s.operation));
    // 画面を開いたときの書き込みのように操作に結び付かない書き込みは operation: null（occasion で時機を書く）
    if (s.operation !== null && !opIds.has(/** @type {string} */ (s.operation))) {
      problems.push(
        `${at}: operation "${String(s.operation)}" が被覆表の操作に無い（操作に結び付かない書き込みは null にして occasion に時機を書く。この機能の書き込みでなければ excluded_reason）`,
      );
    }
    if (!filled(s.occasion) || !filled(s.values) || !filled(s.count)) {
      problems.push(
        `${at}: occasion（いつ書くか。送信・確認・例外との前後）/ values（書く値）/ count（回数）が空`,
      );
    }
    if (typeof s.path !== "string" || !WRITE_PATHS.includes(s.path)) {
      problems.push(`${at}: path が語彙（${WRITE_PATHS.join(" / ")}）に無い`);
    }
    if (s.verification === "assertion") {
      if (!filledStrings(s.covered_by)) {
        problems.push(`${at}: verification: assertion なのに covered_by が空`);
      }
    } else if (s.verification === "source-only") {
      // 移行元で起こせない書き込み（例外時等）は読解だけで記録する。新側の書き込み箇所は parity-replace が porting.md に残す
      if (!filled(s.source_only_reason)) {
        problems.push(
          `${at}: verification: source-only なのに source_only_reason（移行元で起こせない理由）が空`,
        );
      }
      // 読解のみと assertion が同時に成立する記録は、どちらで確かめたかを読めない
      if (Array.isArray(s.covered_by) && s.covered_by.length > 0) {
        problems.push(
          `${at}: verification: source-only なのに covered_by がある（assertion で確かめたなら verification: assertion にする）`,
        );
      }
    } else {
      problems.push(`${at}: verification が語彙（${WRITE_VERIFICATIONS.join(" / ")}）に無い`);
    }
  }
  for (const [key, n] of recordedCount) {
    if (n > 1) problems.push(`side_effect_writes.sites ${key}: ${n} 回重複している`);
  }
  const unwritten = [...tableSet].filter((t) => !writtenTables.has(t));
  if (unwritten.length > 0) {
    problems.push(
      `side_effect_writes: 表 ${unwritten.join(", ")} に書く箇所が 1 件も記録されていない（例外処理の中を含めて移行元ソースから全件列挙する）`,
    );
  }
  summary.recorded = sites.length;
  const srcProblems = sourceProblems(sew.source, targetCommit, "side_effect_writes.source");
  problems.push(...srcProblems);
  const src = sew.source;
  const paths = isPlainObject(src) && Array.isArray(src.paths) ? src.paths : [];
  if (!recorded && paths.length > 0 && paths.every(nonEmptyString) && compiled.length > 0) {
    const scan = scanSources(
      root,
      /** @type {string[]} */ (paths),
      compiled,
      "side_effect_writes.source.paths",
    );
    summary.checked = true;
    summary.files = scan.files;
    summary.found = scan.sites.length;
    if (scan.files === 0)
      problems.push(
        "side_effect_writes: 走査対象のテキストファイルが 0 件（走査範囲が誤っている）",
      );
    const foundKeys = new Set(scan.sites.map(keyOf));
    for (const key of foundKeys) {
      if (!recordedCount.has(key))
        problems.push(
          `side_effect_writes.sites: ソースの書き込み ${key} が被覆表に記録されていない`,
        );
    }
    for (const key of recordedCount.keys()) {
      if (!foundKeys.has(key))
        problems.push(
          `side_effect_writes.sites: 記録された ${key} がソースに見つからない（版の食い違い・行ずれ）`,
        );
    }
  }
  return summary;
}

/**
 * 移行元ソースの 1 ファイルを --root から読む。--root からの / 区切りの相対パスそのもの（走査範囲のキーと同じ形）でないもの
 * （絶対パス・`./` や `..` を含む形・ルートの外）・読めない・バイナリは null。形を揃えないと、declared を true に切り替えたときに
 * 同じ参照が走査範囲のキーと一致せず合否が逆になり、マシン固有の絶対パスが表の指紋に残る。
 * feedback_calls.declared: false で走査範囲を持たないときに、送る前の判定の参照を照合するために使う。
 * @param {string} root
 * @param {string} file - --root からの相対（/ 区切り）
 * @returns {string | null}
 */
function readSourceFile(root, file) {
  const absRoot = resolve(root);
  const abs = resolve(absRoot, file);
  const rel = relative(absRoot, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  if (rel.split(sep).join("/") !== file) return null;
  try {
    const buf = readFileSync(abs);
    return buf.includes(0) ? null : buf.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * 送る前の判定の到達点と判定の場所（ファイルとシンボル）をソースと照合する。
 * @param {Map<string, { file: string, symbol: string, label: string }[]>} refsByOp
 * @param {(file: string) => string | null | undefined} read - ファイルの本文（読めなければ null / undefined）
 * @param {string} unreadable - 読めないときの説明
 * @returns {{ opId: string, problem: string }[]}
 */
function preSendRefProblems(refsByOp, read, unreadable) {
  /** @type {{ opId: string, problem: string }[]} */
  const out = [];
  for (const [opId, refs] of refsByOp) {
    for (const ref of refs) {
      const text = read(ref.file);
      if (text === null || text === undefined) {
        out.push({
          opId,
          problem: `operations["${opId}"]: ${ref.label} のファイル ${ref.file} ${unreadable}`,
        });
      } else if (!symbolIn(text, ref.symbol)) {
        out.push({
          opId,
          problem: `operations["${opId}"]: ${ref.label} の ${ref.symbol} が ${ref.file} に見つからない`,
        });
      }
    }
  }
  return out;
}

/**
 * 移行元ソースを走査して呼び出し箇所を列挙する。
 * @param {string} root
 * @param {string[]} paths
 * @param {{ id: string, re: RegExp }[]} patterns
 * @param {string} [label] - エラーに出す走査範囲の名前
 * @returns {{ files: number, texts: Map<string, string>, sites: { file: string, line: number, column: number, pattern: string }[] }}
 */
export function scanSources(root, paths, patterns, label = "feedback_calls.source.paths") {
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
    if (isAbsolute(p)) throw new UsageError(`${label} に絶対パスがある: ${p}`);
    const abs = resolve(absRoot, p);
    const rel = relative(absRoot, abs);
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new UsageError(`${label} がルートの外を指す: ${p}`);
    }
    try {
      visit(abs);
    } catch (e) {
      throw new UsageError(`${label} を読めない: ${p}（${e instanceof Error ? e.message : e}）`);
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
 * @param {{ root?: string, recorded?: boolean, captureStates?: Set<string> | null, pageNames?: Set<string> | null, slug?: string | null, target?: string | null, targetCommit?: unknown }} [opts]
 *   targetCommit は metadata.json の target.commit（undefined なら照合しない。null / none は照合不能として扱う）
 */
export function checkReactions(table, opts = {}) {
  const {
    root = process.cwd(),
    recorded = false,
    captureStates = null,
    pageNames = null,
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

  // 画面が持つ状態の棚卸し（Issue #471）。押した後に戻す範囲を、操作ごとの自己申告ではなくこの一覧と突き合わせる
  const ss = table.screen_states;
  /** @type {string[] | null} */
  let screenStates = null;
  if (
    !isPlainObject(ss) ||
    !Array.isArray(ss.states) ||
    !ss.states.every(filled) ||
    new Set(ss.states).size !== ss.states.length
  ) {
    problems.push(
      "screen_states.states が重複の無い空でない文字列の配列でない（画面が持つ状態〈検索条件・並べ替え・列フィルター・列の変更・行の選択・ページ送り等〉の棚卸し。持たないなら空配列）",
    );
  } else if (!filled(ss.source)) {
    problems.push(
      "screen_states.source が空（状態の棚卸しをどこから列挙したか〈移行元ソースの状態を持つ変数・URL のクエリ・実 UI〉が残らない）",
    );
  } else {
    screenStates = /** @type {string[]} */ (ss.states);
  }

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
  /** @type {Map<string, { opId: string | null, label: string, shared: boolean }[]>} [ページ, 撮る状態名] → 割り当てた行（状態表示の行は opId: null） */
  const aftermathCaptureUses = new Map();
  /** @type {Map<string, string>} 使い回しの照合のキー → 人が読む名前（最初に現れたページ名 × 状態名） */
  const captureLabel = new Map();
  /** @type {Map<string, unknown>} 操作 id → handlers（移行元ソースとの突き合わせで照合する） */
  const handlersByOp = new Map();
  /** @type {Map<string, { file: string, symbol: string, label: string }[]>} 操作 id → 送る前の判定の到達点と判定の場所 */
  const preSendRefsByOp = new Map();
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
          ...aftermathReturnsProblems(am.returns_to, screenStates),
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
    // 送る前の判定（Issue #483）。欠けは layout と同じく未測定に数える
    const ps = preSendProblems(op.pre_send);
    for (const pp of ps.problems) {
      if (pp.unmeasured) fail(pp.problem);
      else problems.push(`${label}: ${pp.problem}`);
    }
    preSendRefsByOp.set(/** @type {string} */ (op.id), ps.refs);
    // 撮影の単位はページ × 状態名 × ビューポートなので、別のページの同じ状態名は別の 1 枚（baseline.md）。
    // 割る単位は操作が載るページではなく、押した後に撮ったページ（capture_page。遷移する操作は遷移先）。
    // 載るページで割ると、別のページから同じ遷移先へ移る 2 操作が 1 枚を共有しても通ってしまう（Codex レビュー）。
    // 省略は同じページとみなして使い回しを厳しく見る
    /** @type {string | null} */
    let page = null;
    if (op.capture_page !== undefined && op.capture_page !== null) {
      if (!filled(op.capture_page))
        fail(
          "capture_page が空でない文字列でない（省略するか capture_conditions.pages の名前を書く）",
        );
      else if (pageNames === null && captureStates !== null)
        fail(
          `capture_page "${op.capture_page}" を照合できない（metadata.json の capture_conditions.pages を読めない）`,
        );
      else if (pageNames !== null && !pageNames.has(/** @type {string} */ (op.capture_page)))
        fail(
          `capture_page "${op.capture_page}" が metadata.json の capture_conditions.pages に無い`,
        );
      else page = /** @type {string} */ (op.capture_page);
    }
    // ページが 2 つ以上ある機能で capture_page を省くと、撮った状態がどのページの 1 枚かを決められない
    // （別のページの同名の 1 枚でも行が満たされる）。ページが 1 つだけならそのページとみなす
    const consumesCapture =
      (Array.isArray(op.reactions) ? op.reactions : []).some(
        (r) =>
          isPlainObject(r) &&
          r.kind === "observed" &&
          isPlainObject(r.capture) &&
          filled(r.capture.state),
      ) ||
      (isPlainObject(op.aftermath) &&
        isPlainObject(op.aftermath.look) &&
        Array.isArray(op.aftermath.look.items) &&
        op.aftermath.look.items.some((it) => isPlainObject(it) && filled(it.captured)));
    if (page === null && op.capture_page == null && consumesCapture && pageNames !== null) {
      if (pageNames.size === 1) page = [...pageNames][0];
      else if (pageNames.size > 1)
        fail(
          "capture_page が無い（撮る状態を持つ操作は、capture_conditions.pages が 2 つ以上なら押した後に撮ったページを書く）",
        );
    }
    // 使い回しは名乗ったページ名 × 状態名で数える。名乗ったページが本当に撮ったページか（押した後の URL との照合）は
    // ページの定義（pages[].path の意味論: baseURL の接頭辞・クエリ・フラグメント）を固めてから扱う（Issue #484）。
    // それまでは規約（押した後に撮ったページを書く）で持つ
    const pageKey = page;
    const captureKey = (/** @type {string} */ state) => {
      const key = JSON.stringify([pageKey, state]);
      if (!captureLabel.has(key))
        captureLabel.set(key, page === null ? state : `${page} の ${state}`);
      return key;
    };
    // 撮る状態へ割り当てた残る見た目を、ページ × 状態名ごとに集める（使い回しの照合は全操作を見た後）
    const lookItems =
      isPlainObject(am) && isPlainObject(am.look) && Array.isArray(am.look.items)
        ? am.look.items
        : [];
    // 観測した反応の capture.state も同じ状態名の集合に入れる（別の操作の残る見た目と 1 枚を共有しても通さない）
    for (const r of Array.isArray(op.reactions) ? op.reactions : []) {
      if (!isPlainObject(r) || r.kind !== "observed" || !isPlainObject(r.capture)) continue;
      if (!filled(r.capture.state) || !nonEmptyString(r.id)) continue;
      const key = captureKey(/** @type {string} */ (r.capture.state));
      const uses = aftermathCaptureUses.get(key) ?? [];
      uses.push({
        opId: /** @type {string} */ (op.id),
        label: `${label}: reactions["${r.id}"].capture`,
        shared: filled(r.capture.shared_capture_reason),
      });
      aftermathCaptureUses.set(key, uses);
    }
    for (const item of lookItems) {
      if (!isPlainObject(item) || !filled(item.captured) || !nonEmptyString(item.id)) continue;
      const key = captureKey(/** @type {string} */ (item.captured));
      const uses = aftermathCaptureUses.get(key) ?? [];
      uses.push({
        opId: /** @type {string} */ (op.id),
        label: `${label}: aftermath.look.items["${item.id}"]`,
        shared: filled(item.shared_capture_reason),
      });
      aftermathCaptureUses.set(key, uses);
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
    // 走査範囲が無くても、送る前の判定の到達点と判定の場所は --root から直接読んで照合する。
    // 照合しないと、存在しないファイル・関数を書いた pre_send が完全な記録として通る（code-review）。
    // 移行元ソースを読めない環境では到達点まで追えないので、found: null と理由で未測定にする
    if (!recorded) {
      for (const { opId, problem } of preSendRefProblems(
        preSendRefsByOp,
        (file) => readSourceFile(root, file),
        "を --root から読めない（--root からの / 区切りの相対パスで書く。移行元ソースを読めないなら pre_send.found: null と理由を書く）",
      )) {
        problems.push(problem);
        unmeasuredOps.add(opId);
      }
    }
  } else {
    const patterns = Array.isArray(fc.patterns) ? fc.patterns : [];
    if (patterns.length === 0)
      problems.push("feedback_calls.patterns が空（突き合わせる呼び出しが無い）");
    const patIds = collectIds(patterns, "feedback_calls.patterns", problems);
    const compiled = compilePatterns(patterns, patIds, "feedback_calls.patterns", problems);
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
    problems.push(...sourceProblems(src, targetCommit, "feedback_calls.source"));
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
        if (!symbolIn(text, h.symbol)) {
          problems.push(
            `operations["${h.opId}"]: ハンドラ ${h.symbol} が ${h.file} に見つからない`,
          );
          unmeasuredOps.add(h.opId);
        }
      }
      // 送る前の判定の到達点と判定の場所も走査範囲に入れさせる。部品の内側まで範囲を広げると、
      // そこにあるフィードバック呼び出し（上限を超えたときの通知等）も call_sites に現れて反応と突き合わせられる
      for (const { opId, problem } of preSendRefProblems(
        preSendRefsByOp,
        (file) => scan.texts.get(file),
        "が走査範囲に無い・読めていない（feedback_calls.source.paths に部品の内側を含める）",
      )) {
        problems.push(problem);
        unmeasuredOps.add(opId);
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

  // --- 表への書き込みとの突き合わせ（Issue #466）---
  /** @type {Set<string>} 表への書き込みを持つ操作 */
  const writeOps = new Set();
  const sideEffects = checkSideEffectWrites(table.side_effect_writes, {
    opIds,
    root,
    recorded,
    targetCommit,
    problems,
    writeOps,
  });

  // --- 送っている間の押し直し（Issue #500）---
  // 書き込みを持つ操作は表への書き込みの突き合わせが済んでから分かるので、操作の走査とは別に回す
  for (const op of operations) {
    if (!isPlainObject(op) || !opIds.has(/** @type {string} */ (op.id))) continue;
    for (const rp of resubmitProblems(op.resubmit, writeOps.has(/** @type {string} */ (op.id)))) {
      problems.push(`operations["${op.id}"]: ${rp.problem}`);
      if (rp.unmeasured) unmeasuredOps.add(/** @type {string} */ (op.id));
    }
  }

  // --- 画面ごとの状態表示（Issue #500）---
  const stateDisplays = checkStateDisplays(table.state_displays, {
    pageNames,
    captureStates,
    problems,
    captureUses: aftermathCaptureUses,
    captureLabel,
  });

  // 同じ撮る状態名を複数の残る見た目が指すと、その 1 枚が片方の操作しか作っていなくても全行が満たされる（Codex レビュー）。
  // coverage-expand.mjs の撮影状態と同じく、使い回す全行に実 UI で確かめた根拠（shared_capture_reason）を要求する。
  // 状態表示を撮る状態も同じ集合で数える（0 件の 1 枚を、押した後の 1 枚と根拠なしに兼ねさせない。Issue #500）
  for (const [key, uses] of aftermathCaptureUses) {
    if (uses.length < 2) continue;
    const name = captureLabel.get(key) ?? key;
    const lacking = uses.filter((u) => !u.shared);
    if (lacking.length === 0) continue;
    for (const u of lacking) if (u.opId !== null) unmeasuredOps.add(u.opId);
    problems.push(
      `撮る状態 "${name}" を ${uses.map((u) => u.label).join(" / ")} が使い回している（その 1 枚が全ての操作の後を写すことを実 UI で確かめた根拠を全行の shared_capture_reason に書くか、別の状態名にする。根拠が空: ${lacking.map((u) => u.label).join(" / ")}）`,
    );
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
      if (sideEffects.declared === true && conf.side_effects_checked !== true)
        problems.push("conformance.side_effects_checked が true でない");
    }
  }

  return {
    operations: operations.length,
    reactions: reactionCount,
    unmeasured_operations: unmeasuredOps.size,
    call_sites: callSummary,
    side_effect_writes: sideEffects,
    state_displays: stateDisplays,
    table_fingerprint: fingerprint,
    problems,
  };
}

/**
 * capture_conditions.pages から画面名の集合を作る。名前の無い・空・重複した宣言は黙って捨てずに落とす（Codex レビュー #504）——
 * 捨てると、宣言した画面の一部が期待集合から消え、状態表示の全画面の振り分けが残りの画面だけで通る。
 * @param {unknown[]} pages
 * @returns {Set<string>}
 */
function pageNameSet(pages) {
  const names = new Set();
  pages.forEach((pg, i) => {
    if (!isPlainObject(pg) || !nonEmptyString(pg.name)) {
      throw new UsageError(
        `metadata.json の capture_conditions.pages[${i}] に name（空でない文字列）が無い`,
      );
    }
    if (names.has(pg.name)) {
      throw new UsageError(
        `metadata.json の capture_conditions.pages に画面 "${pg.name}" が 2 つある`,
      );
    }
    names.add(pg.name);
  });
  return names;
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
      pageNames: Array.isArray(cc.pages) ? pageNameSet(cc.pages) : null,
      slug: metadata.slug,
      target: metadata.target.name,
      targetCommit: metadata.target.commit,
    });
    const ok =
      result.unmeasured_operations === 0 &&
      result.state_displays.unmeasured === 0 &&
      result.problems.length === 0;
    if (write) {
      table.conformance = {
        tool: "reaction-check",
        tool_version: VERSION,
        ok,
        call_sites_checked: result.call_sites.checked,
        side_effects_checked: result.side_effect_writes.checked,
        table_fingerprint: result.table_fingerprint,
        problems: result.problems.length,
      };
      writeFile(tablePath, `${JSON.stringify(table, null, 2)}\n`);
    }
    out({ judged: true, reason: null, ok, path: decl.path, ...result });
    for (const p of result.problems) process.stderr.write(`warn: ${p}\n`);
    if (!ok) {
      process.stderr.write(
        `error: 反応の未測定 ${result.unmeasured_operations} 操作・状態表示の未測定 ${result.state_displays.unmeasured} 件・不整合 ${result.problems.length} 件 — 測り直す（parity-diff では収束させず parity-suite へ戻す）\n`,
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
