// 網羅プロファイルから候補集合を展開し、部品網羅表と機械的に照合する（原本）。
// 原本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。プロファイルを同梱ディレクトリから読むため）。
//
// 何をするか: components[].profile が指すプロファイルを assets/coverage-profiles/ から読む。
// インスタンスごとの列挙（enumeration）と candidate_rules の直積から候補集合を展開し、
// 網羅表の items / cells / equivalence_classes と照合する。
//
// 何をしないか: 候補が本当に全て列挙されたか（ソースの読み落とし）は判定できない。
// 判定できるのは、「列挙した要素が候補へ展開され、候補がセルに対応し、セルに証拠と対応付けがある」ことまでである。
// 列挙そのものの網羅は、enumeration.source の出所と complete フラグで扱い、判定できなければ不合格にする。
// 差分の検出・分類（parity-diff の仕事）、網羅表の測定値の記入（人／エージェントの仕事）は行わない。
//
// 候補ゼロ・列挙なし・complete: false・required_rules が 0 件・同値クラスの所属の抜けは、
// いずれも「問題なし」として扱わず、0 以外で終了する。
// 「その部品には無い」を主張するには、列挙側の enumeration.justified_absences に根拠を残す
// （根拠を読む手段が無いと、不合格にした後に進む先が無くなり、フラグを偽って true にする以外の方法が無くなる）。
//
// 部品固有の条件分岐を持たない。新しい部品はプロファイルの追加だけで足せる
// （取り決めは references/coverage-profiles.md、形式は assets/coverage-profiles/profile-schema.json）。
//
// 決定論的: 乱数・現在時刻に依存しない。入力順を保って展開する。
// TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags, stripDashes } from "./lib/flags.mjs";
import { isPlainObject, nonEmptyString } from "./lib/guards.mjs";
import { canonicalize } from "./lib/json.mjs";

/**
 * ツールのバージョン（原本）。展開規則・照合規則・出力形状を変えたら上げる。
 * 網羅表の conformance.tool_version に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "20";

/** 網羅表のセルが取りうる値（原本は coverage.md「部品網羅表」）。 */
const VALUES = ["present", "absent", "unmeasured"];

// 撮影状態の種別。部品の操作から「見た目が変わる状態」を表す語彙で、
// capture_conditions.states の状態名そのものではない（名前は撮る側が決める）。
// 先頭の 5 種は操作の**途中**の見た目、after-operation は操作を**終えた後に残る**見た目
// （選択の塗り・絞り込み中の見出しの印・並べ替えの印）。途中だけを導くと、
// 終えた後の見た目は撮られず、差は「差 0 件」と同じ見え方になる。
// 導出は下限であって上限ではない。操作から導けない状態（error / 初期表示のバリアント）は
// 従来どおり手で states へ足す。
const VISUAL_STATE_KINDS = [
  "opens-container",
  "hover",
  "focus",
  "active",
  "disabled",
  "after-operation",
];

// 撮影状態の行のうち、人／エージェントが埋める欄。導出は要求の集合だけを決めるので、
// 書き戻し（fillVisualStateRows）はこの一覧を必ず引き継ぐ。
// **欄を増やしたらここへ足す**。足し忘れると、その欄は必ず通る --write の側で消える。
// 実際に shared_capture_reason で起き、根拠を書いても次の --write が消して逃げ道が死んだ。
const HUMAN_DECIDED_ROW_FIELDS = ["captured", "reason", "shared_capture_reason"];

/** 候補 id の区切り。軸値に含まれると id が衝突するため、列挙時に禁止する。 */
const ID_SEPARATOR = "/";

// coverage-fingerprint:begin
/**
 * 表の指紋。conformance を除いた内容をキー順に正規化して sha256 を取る。
 * 記録側（parity-suite の coverage-expand.mjs）と判定側（parity-diff の coverage-check.mjs）で
 * 同じ値になる必要がある。両者を突き合わせる往復テストは、配布元のリポジトリにある。
 * 様式は reaction-check.mjs の tableFingerprint と同じ。
 * @param {Record<string, unknown>} table
 * @returns {string}
 */
export function coverageFingerprint(table) {
  const { conformance: _ignored, ...rest } = table;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(rest)))
    .digest("hex");
}

/**
 * 撮影条件の指紋。撮影状態の照合に実際に使った入力（slug・ページ名・状態名・ポップアップの状態名）だけを取る。
 * 配列は並びで指紋が変わらないよう整列する（内容が同じなら同じ指紋にする）。
 * @param {{slug?: string, pageNames?: string[], states: string[], popupStates: string[]}} capture
 * @returns {string}
 */
export function captureFingerprint(capture) {
  /** @param {unknown} v */
  const sorted = (v) => [...(isArray(v) ? v : [])].map(String).sort();
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalize({
          slug: nonEmptyString(capture.slug) ? String(capture.slug) : null,
          pageNames: sorted(capture.pageNames),
          states: sorted(capture.states),
          popupStates: sorted(capture.popupStates),
        }),
      ),
    )
    .digest("hex");
}
// coverage-fingerprint:end

// absence-evidence-contract:begin
// この印の間は、記録側（parity-suite の coverage-expand.mjs）と
// 収束判定側（parity-diff の coverage-check.mjs）でバイト単位に同一へ保つ。
// 配布スキルは実行時に参照する成果物を自分で同梱する規約のため共有モジュールにできず実体が複製される。
// 片方だけ直すと「記録側は通すが収束側が弾く」（またはその逆）が起きるため、
// 配布元のリポジトリのチェックが、この印の間の一致を検査する。

/**
 * `instances[].applicable_states.source.kind` の語彙。
 * 形は parity-suite の `assets/component-coverage-template.json` で定義する。空でないだけを通すと
 * 出所不明の状態manifest（`kind: "invented"` 等）で `non-renderable` / `absent` を収束させられる。
 */
const APPLICABLE_STATE_SOURCE_KINDS = ["profile", "vendor-spec", "current-source", "app-ui"];

/** `absence_evidence.action.method`（操作の送り方）の語彙。 */
const FIRED_ACTION_METHODS = ["locator-api", "coordinate"];

/** `absence_evidence.fired.signal`（発火を確認した手段）の語彙。 */
const FIRED_SIGNALS = ["event-listener", "dom-change", "state-change"];

/**
 * 語彙に含まれる文字列か。`String()` で潰してから比較すると `["coordinate"]` のような型崩れが
 * allowlist を通り、後段の厳密比較（`=== "coordinate"`）だけ false になって、その分岐でしか
 * 課されない必須検査（座標操作の hit-test 等）を回避できる。型を先に確かめる。
 * @param {unknown} v
 * @param {string[]} allowed
 * @returns {boolean}
 */
function inAllowlist(v, allowed) {
  return typeof v === "string" && allowed.includes(v);
}

/**
 * fired-without-response の `action`（操作の送り方）を検査する。
 * @param {Record<string, unknown>} action
 * @param {string} label
 * @returns {string|null}
 */
function firedActionProblem(action, label) {
  if (!nonEmptyString(action.locator) || !nonEmptyString(action.detail)) {
    return `${label}: fired-without-response の action.locator / action.detail が空`;
  }
  if (!inAllowlist(action.method, FIRED_ACTION_METHODS)) {
    return `${label}: fired-without-response の action.method が ${FIRED_ACTION_METHODS.join(" / ")} のいずれでもない`;
  }
  // この判定の前提は「操作可能な可視要素へ送った」こと。どちらの method でも正の矩形と可視性を実測させる。
  // force / dispatchEvent のように actionability を迂回する送り方は、可視要素への操作の証拠にならない。
  if (!isPlainObject(action.bounding_box)) {
    return `${label}: fired-without-response なのに action.bounding_box が JSON オブジェクトではない`;
  }
  const box = action.bounding_box;
  if (![box.x, box.y, box.width, box.height].every((v) => Number.isFinite(v))) {
    return `${label}: action.bounding_box の x / y / width / height が有限の数値ではない`;
  }
  if (!(Number(box.width) > 0) || !(Number(box.height) > 0)) {
    return `${label}: action.bounding_box の幅・高さが正ではない（可視要素への操作になっていない）`;
  }
  if (action.visible !== true) {
    return `${label}: action.visible が実測の true ではない（可視要素へ送った証拠が無い）`;
  }
  if (action.actionability_bypassed !== false) {
    return `${label}: action.actionability_bypassed が実測の false ではない（force / dispatchEvent 等で actionability を迂回していないことを示せていない）`;
  }
  // 座標操作だけは、重なった別要素の発火を対象の発火と誤認しうる。hit-test の実測も要求する。
  if (action.method === "coordinate") {
    if (!nonEmptyString(action.hit_test_target)) {
      return `${label}: 座標操作なのに action.hit_test_target が空（何が発火先だったか残らない）`;
    }
    if (action.hit_test_is_target_or_descendant !== true) {
      return `${label}: 座標操作の hit-test が操作用要素または子孫を指した実測になっていない`;
    }
  }
  return null;
}

/**
 * 操作可能な要素へ発火を確認した absent（`kind: fired-without-response`）の証拠を検査する。
 * 散文 `evidence` の非空だけでは「送り方・発火確認・観測結果」の 3 点を測ったかを区別できず、
 * 0 寸法要素の中心座標で**重なった別要素**が発火した結果も同じ判定で通ってしまう。
 * @param {Record<string, unknown>} evidence
 * @param {string} label
 * @returns {string|null}
 */
function firedEvidenceProblem(evidence, label) {
  if (!isPlainObject(evidence.action)) {
    return `${label}: fired-without-response なのに action が JSON オブジェクトではない`;
  }
  const actionProblem = firedActionProblem(evidence.action, label);
  if (actionProblem !== null) return actionProblem;
  if (!isPlainObject(evidence.fired)) {
    return `${label}: fired-without-response なのに fired が JSON オブジェクトではない`;
  }
  const fired = evidence.fired;
  if (!inAllowlist(fired.signal, FIRED_SIGNALS)) {
    return `${label}: fired-without-response の fired.signal が ${FIRED_SIGNALS.join(" / ")} のいずれでもない`;
  }
  if (!nonEmptyString(fired.detail) || fired.verified !== true) {
    return `${label}: fired-without-response の発火確認（fired.detail / fired.verified）が実測になっていない`;
  }
  if (!nonEmptyString(evidence.observation)) {
    return `${label}: fired-without-response の observation が空（期待した UI 応答が無かった観測結果が残らない）`;
  }
  return null;
}

/**
 * インスタンスの applicable_states を検査し、状態 id → transition の対応を返す。不備があればその指摘を返す。
 * @param {unknown} stateManifest - components[].instances[].applicable_states
 * @param {string} label
 * @returns {string|Map<string, string>}
 */
function manifestStatesOf(stateManifest, label) {
  if (!isPlainObject(stateManifest)) {
    return `${label}: non-renderable なのにインスタンスの applicable_states が無い`;
  }
  const manifest = stateManifest;
  const source = isPlainObject(manifest.source) ? manifest.source : null;
  if (
    manifest.complete !== true ||
    source === null ||
    ![source.kind, source.ref, source.version, source.condition].every(nonEmptyString)
  ) {
    return `${label}: applicable_states の complete / source が不完全`;
  }
  if (!inAllowlist(source.kind, APPLICABLE_STATE_SOURCE_KINDS)) {
    return `${label}: applicable_states.source.kind（${String(source.kind)}）が ${APPLICABLE_STATE_SOURCE_KINDS.join(" / ")} のいずれでもない`;
  }
  if (!isArray(manifest.items) || manifest.items.length === 0) {
    return `${label}: applicable_states.items が空`;
  }
  /** @type {Map<string, string>} */
  const manifestStates = new Map();
  for (const [index, rawItem] of manifest.items.entries()) {
    if (!isPlainObject(rawItem)) return `${label}: applicable_states.items[${index}] が不正`;
    const item = rawItem;
    if (!nonEmptyString(item.id) || !nonEmptyString(item.transition)) {
      return `${label}: applicable_states.items[${index}] の id / transition が空`;
    }
    const id = String(item.id);
    if (manifestStates.has(id)) return `${label}: applicable_states.items の id ${id} が重複`;
    manifestStates.set(id, String(item.transition));
  }
  return manifestStates;
}

/**
 * 状態の矩形が 0 寸法かを返す。矩形が null なら false を返す。不備があればその指摘を返す。
 * @param {Record<string, unknown>} state
 * @param {string} stateLabel
 * @returns {string|boolean}
 */
function zeroAreaOf(state, stateLabel) {
  if (state.bounding_box === null) return false;
  if (!isPlainObject(state.bounding_box)) {
    return `${stateLabel}.bounding_box が null または JSON オブジェクトではない`;
  }
  const box = state.bounding_box;
  if (![box.x, box.y, box.width, box.height].every((v) => Number.isFinite(v))) {
    return `${stateLabel}.bounding_box の x / y / width / height が有限の数値ではない`;
  }
  // Playwright の矩形に負の幅・高さは無い。負値を通すと、実在しない矩形で 0 寸法判定を迂回できる。
  if (Number(box.width) < 0 || Number(box.height) < 0) {
    return `${stateLabel}.bounding_box の width / height が負（実在しない矩形）`;
  }
  return box.width === 0 || box.height === 0;
}

/**
 * 状態の非表示原因（hidden_by）が検証済みかを返す。hidden_by が null なら false を返す。不備があればその指摘を返す。
 * @param {Record<string, unknown>} state
 * @param {string} stateLabel
 * @param {unknown} targetLocator - non-renderable の証拠の locator
 * @returns {string|boolean}
 */
function hiddenCauseOf(state, stateLabel, targetLocator) {
  if (state.hidden_by === null) return false;
  if (!isPlainObject(state.hidden_by)) {
    return `${stateLabel}.hidden_by が null または JSON オブジェクトではない`;
  }
  const hidden = state.hidden_by;
  const style = isPlainObject(hidden.computed_style) ? hidden.computed_style : null;
  const hiddenCause =
    nonEmptyString(hidden.locator) &&
    hidden.relationship_verified === true &&
    (hidden.relation === "self" || hidden.relation === "ancestor") &&
    hidden.target_locator === targetLocator &&
    style !== null &&
    (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse");
  if (!hiddenCause) {
    return `${stateLabel}.hidden_by が対象本人／祖先との検証済み関係と非表示 CSS を示さない`;
  }
  // display: none の本人／祖先配下では実 DOM の offsetParent は必ず null。
  // 非 null を通すと、実測していない値の組み合わせを非描画の証拠として収束させられる。
  if (style !== null && style.display === "none" && state.offset_parent !== null) {
    return `${stateLabel}: display: none なのに offset_parent が null ではない（矛盾）`;
  }
  return true;
}

/**
 * locator が 1 件に一致した状態に、0 寸法の矩形か非表示原因の証拠があるかを検査する。
 * @param {Record<string, unknown>} state
 * @param {string} stateLabel
 * @param {unknown} targetLocator - non-renderable の証拠の locator
 * @returns {string|null}
 */
function renderedStateProblem(state, stateLabel, targetLocator) {
  if (!("bounding_box" in state) || !("offset_parent" in state)) {
    return `${stateLabel} に bounding_box / offset_parent が無い`;
  }
  if (state.offset_parent !== null && !nonEmptyString(state.offset_parent)) {
    return `${stateLabel}.offset_parent が null または空でない文字列ではない`;
  }
  const zeroArea = zeroAreaOf(state, stateLabel);
  if (typeof zeroArea === "string") return zeroArea;
  const hiddenCause = hiddenCauseOf(state, stateLabel, targetLocator);
  if (typeof hiddenCause === "string") return hiddenCause;
  if (hiddenCause && state.bounding_box !== null) {
    return `${stateLabel}: hidden_by があるのに bounding_box が null ではない（矛盾）`;
  }
  if (!zeroArea && !hiddenCause) {
    return `${stateLabel} に 0 寸法の矩形または非表示原因の証拠が無い`;
  }
  return null;
}

/**
 * non-renderable の状態 1 件を検査する。locator が 0 件だった（DOM に無い）かを返す。不備があればその指摘を返す。
 * @param {unknown} rawState
 * @param {string} stateLabel
 * @param {{ manifestStates: Map<string, string>, measuredStates: Set<string>, locator: unknown }} ctx
 * @returns {string|boolean}
 */
function measureState(rawState, stateLabel, ctx) {
  if (!isPlainObject(rawState)) return `${stateLabel} が JSON オブジェクトではない`;
  const state = rawState;
  if (!nonEmptyString(state.name) || !nonEmptyString(state.transition)) {
    return `${stateLabel} の name / transition が空`;
  }
  const stateName = String(state.name);
  if (ctx.measuredStates.has(stateName)) return `${stateLabel}.name ${stateName} が重複している`;
  ctx.measuredStates.add(stateName);
  if (ctx.manifestStates.get(stateName) !== String(state.transition)) {
    return `${stateLabel} が applicable_states の id / transition と一致しない`;
  }
  // locator が対象を一意に引くことは状態ごとに変わる（開く前は 0 件、開くと 1 件など）。
  // 1 状態だけの一致数では、別状態で 0 件／複数件の locator を非描画の証拠にできてしまう。
  if (!Number.isInteger(state.locator_match_count) || Number(state.locator_match_count) < 0) {
    return `${stateLabel}.locator_match_count が 0 以上の整数ではない（一致数を実測していない）`;
  }
  const matchCount = Number(state.locator_match_count);
  if (matchCount > 1) {
    return `${stateLabel}: locator が ${matchCount} 件に一致する（対象の操作要素を一意に引けていない）`;
  }
  if (matchCount === 0) {
    // その状態では DOM に存在しない＝操作可能な要素が無い。矩形・非表示原因を持つのは矛盾。
    if (state.bounding_box !== null || state.hidden_by !== null || state.offset_parent !== null) {
      return `${stateLabel}: locator が 0 件なのに矩形・offset_parent・hidden_by が null ではない（矛盾）`;
    }
    return true;
  }
  return renderedStateProblem(state, stateLabel, ctx.locator) ?? false;
}

/**
 * non-renderable の expected_states を検査して返す。不備があればその指摘を返す。
 * @param {Record<string, unknown>} evidence
 * @param {string} label
 * @returns {string|string[]}
 */
function expectedStatesOf(evidence, label) {
  if (
    !isArray(evidence.expected_states) ||
    evidence.expected_states.length === 0 ||
    evidence.expected_states.some((name) => !nonEmptyString(name))
  ) {
    return `${label}: non-renderable の expected_states が空または不正`;
  }
  const expectedStates = evidence.expected_states.map(String);
  if (new Set(expectedStates).size !== expectedStates.length) {
    return `${label}: non-renderable の expected_states が重複している`;
  }
  return expectedStates;
}

/**
 * non-renderable の states を 1 件ずつ検査し、測った状態名と、locator が 0 件だった状態数を返す。
 * 不備があればその指摘を返す。
 * @param {unknown[]} states
 * @param {string} label
 * @param {{ manifestStates: Map<string, string>, locator: unknown }} ctx
 * @returns {string|{ measuredStates: Set<string>, domAbsentStates: number }}
 */
function measureStates(states, label, ctx) {
  /** @type {Set<string>} */
  const measuredStates = new Set();
  // locator が 0 件だった状態数。全状態が 0 件なら locator の正しさを実証できていない。
  let domAbsentStates = 0;
  const stateCtx = { ...ctx, measuredStates };
  for (const [index, rawState] of states.entries()) {
    const domAbsent = measureState(rawState, `${label}: non-renderable.states[${index}]`, stateCtx);
    if (typeof domAbsent === "string") return domAbsent;
    if (domAbsent) domAbsentStates += 1;
  }
  return { measuredStates, domAbsentStates };
}

/**
 * absent セルの `kind: non-renderable` の証拠を検査する。全状態を測ったという自己申告と実測の構造を
 * 区別するため、状態ごとの証拠を必須にする。
 * @param {Record<string, unknown>} evidence
 * @param {string} label
 * @param {unknown} stateManifest - components[].instances[].applicable_states
 * @returns {string|null}
 */
function nonRenderableProblem(evidence, label, stateManifest) {
  if (!nonEmptyString(evidence.locator) || !nonEmptyString(evidence.state_source)) {
    return `${label}: non-renderable の locator / state_source が空`;
  }
  // 通常の getByRole は hidden 要素を除外するため、display: none の要素でも一致数は 0 になる。
  // locator が hidden を含むことを実証しないまま 0 件を「DOM に無い」と読むと、非表示の状態を
  // 不在として absent に収束できる。includeHidden または構造 locator であることを実測として要求する。
  if (evidence.locator_includes_hidden !== true) {
    return `${label}: non-renderable の locator_includes_hidden が実測の true ではない（hidden を含む locator である実証が無い）`;
  }
  if (evidence.states_exhaustive !== true) {
    return `${label}: non-renderable の states_exhaustive が true ではない`;
  }
  const manifestStates = manifestStatesOf(stateManifest, label);
  if (typeof manifestStates === "string") return manifestStates;
  if (!isArray(evidence.states) || evidence.states.length === 0) {
    return `${label}: non-renderable の states が空`;
  }
  const expectedStates = expectedStatesOf(evidence, label);
  if (typeof expectedStates === "string") return expectedStates;
  const measured = measureStates(evidence.states, label, {
    manifestStates,
    locator: evidence.locator,
  });
  if (typeof measured === "string") return measured;
  const { measuredStates, domAbsentStates } = measured;
  // 全状態で 0 件なら locator が正しいことを一度も実証できておらず、誤った locator と区別できない。
  if (domAbsentStates === measuredStates.size) {
    return `${label}: non-renderable の locator がどの状態でも 0 件（locator が対象を引けている実証が無い）`;
  }
  if (
    measuredStates.size !== expectedStates.length ||
    expectedStates.some((name) => !measuredStates.has(name)) ||
    expectedStates.length !== manifestStates.size ||
    expectedStates.some((name) => !manifestStates.has(name))
  ) {
    return `${label}: expected_states / states[].name / applicable_states.items[].id が完全一致しない`;
  }
  return null;
}

/**
 * absent セルの証拠を、証拠の種類（`kind`）ごとに検査する。散文 evidence の非空だけでは、全状態を測ったという
 * 自己申告と実測の構造を区別できないため、`non-renderable` は状態ごとの証拠を必須にする。
 * @param {Record<string, unknown>} row
 * @param {string} label
 * @param {unknown} stateManifest - components[].instances[].applicable_states
 * @returns {string|null}
 */
function absentEvidenceProblem(row, label, stateManifest) {
  if (!isPlainObject(row.absence_evidence)) {
    return `${label}: value: absent なのに absence_evidence が JSON オブジェクトではない`;
  }
  const evidence = row.absence_evidence;
  if (evidence.kind === "fired-without-response") return firedEvidenceProblem(evidence, label);
  if (evidence.kind !== "non-renderable") {
    return `${label}: absence_evidence.kind が fired-without-response / non-renderable のいずれでもない`;
  }
  return nonRenderableProblem(evidence, label, stateManifest);
}
/**
 * 集合の出所（`component_inventory` / `components[].instance_inventory`）と
 * `instances[].enumeration.source` で使う情報源の kind の語彙。
 * **並びは強い順**で、先頭が一次情報源（静的に読み切れる受領ソース）。実 UI の歩行はその画面がその時
 * 描いたものしか拾えないため、弱い情報源で列挙したときは一次情報源が使えなかった理由を要求する。
 * 形は parity-suite の `assets/component-coverage-template.json` で定義する。
 */
const SET_SOURCE_KINDS = ["current-source", "config", "app-ui"];

/**
 * `components[].source.kind`（項目集合の列挙元）の語彙。受領ソースから起こした項目集合を
 * `app-ui` として扱わずに書けるよう `current-source` を持つ。`app-ui` として扱うと、静的に全部読んだのか
 * 画面に出ていたものを数えたのかが後から区別できない。
 */
const ITEM_SOURCE_KINDS = [
  "vendor-feature-list",
  "vendor-test-spec",
  "official-sample",
  "current-source",
  "app-ui",
];

/**
 * 語彙外の `kind` をメッセージへ埋める。`String()` で潰すと `["current-source"]` のような型崩れが
 * `current-source` と表示され、「current-source が current-source / … のいずれでもない」という
 * 自己矛盾した指摘になって、直す側が本当の欠陥（型）に辿り着けない。文字列以外は JSON で示す。
 * @param {unknown} v
 * @returns {string}
 */
function showKind(v) {
  return typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
}

/**
 * 一次情報源（`SET_SOURCE_KINDS[0]`）以外で列挙したときに、その情報源が使えなかった理由の申告を要求する。
 * `fail_closed`（ソースを読めないときの `complete: false`）の裏側は、**読めるのに読まなかった**場合である。この場合には
 * それまで検査する手段が無く、いちばん弱い情報源だけで `complete: true` が通っていた。
 * 「読めなかった」のか「実 UI から起こした」のかは機械では区別できないので、申告を残させる。
 * 強さの判定は記録側（coverage-expand）・判定側（coverage-check）のどちらも同じ語彙で行う
 * （片側だけ厳しいと「記録は通るが収束しない表」が作れる）。
 * @param {Record<string, unknown>} block - `source` と `stronger_source_unavailable_reason` を持つブロック
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {string[]}
 */
function strongerSourceProblems(block, label) {
  /** @type {string[]} */
  const problems = [];
  const source = isPlainObject(block.source) ? block.source : null;
  // 語彙の外・source ごとの欠落は呼び出し側が報告する（ここで二重に出さない）。
  if (source === null || !inAllowlist(source.kind, SET_SOURCE_KINDS)) return problems;
  const primary = SET_SOURCE_KINDS[0];
  const reason = block.stronger_source_unavailable_reason;
  if (source.kind === primary) {
    // 使われていない免除は失敗させる。一次情報源で列挙したのに理由が残っていると、
    // 後から読む側はその集合を弱い情報源から起こしたものと誤読する。
    if (reason !== null && reason !== undefined) {
      problems.push(
        `${label}: ${primary} で列挙したのに stronger_source_unavailable_reason が書かれている（機能していない免除。使ったなら null にする）`,
      );
    }
  } else if (!nonEmptyString(reason)) {
    problems.push(
      `${label}: ${String(source.kind)} で列挙したのに stronger_source_unavailable_reason が空（${primary} が使えなかった理由を書く。「読めなかった」と「実 UI から起こした」は別）`,
    );
  }
  return problems;
}

/**
 * 読み切れた（`complete: true`）のに `incomplete_reason` が残っている記録を落とす。
 * 使われていない免除は `stronger_source_unavailable_reason` と同じ扱いにする。機械は収束させるのに、
 * 成果物を読む側には「まだ読み切れていない集合」と見え、`gaps.md` の行も同じ文言で残り続ける。
 * 集合の出所（`component_inventory` / `instance_inventory`）とインスタンスの列挙（`enumeration`）の
 * **両方**へ当てる（片方だけに当てると、同じ表の中で「完全」と「未完了」を同時に主張できる）。
 * @param {Record<string, unknown>} block - `complete` と `incomplete_reason` を持つブロック
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {string[]}
 */
function staleIncompleteReasonProblems(block, label) {
  if (block.complete !== true) return [];
  if (block.incomplete_reason === null || block.incomplete_reason === undefined) return [];
  return [
    `${label}: complete: true なのに incomplete_reason が書かれている（機能していない免除。読み切れたなら null にする）`,
  ];
}

/**
 * 集合の出所と完全性のブロックを検査する（部品の集合とインスタンスの集合で同じ形を使う）。
 * 列挙しなかった部品・インスタンスは期待セルにも現れないため、宣言が無いと「測りの抜け」と
 * 「本当に無い」が同じ見え方（未測定 0 で収束）になる。軸の要素・適用可能状態が既に持っている
 * `source` ＋ `complete` と同じ形を、集合の側にも当てる。
 * @param {unknown} raw - 検査するブロック（`source` / `complete` / `incomplete_reason` / `stronger_source_unavailable_reason`）
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {string[]}
 */
function setInventoryProblems(raw, label) {
  /** @type {string[]} */
  const problems = [];
  if (!isPlainObject(raw)) {
    problems.push(
      `${label} が無い（集合をどこから起こしたか・読み切れたかが残らないので、列挙しなかった要素が未測定 0 で収束する）`,
    );
    return problems;
  }
  const block = raw;
  problems.push(...setSourceProblems(block, label));
  problems.push(...setCompleteProblems(block, label));
  return problems;
}

/**
 * 集合のブロックの `source` を検査する（setInventoryProblems の出所の側）。
 * @param {Record<string, unknown>} block - 集合の出所と完全性のブロック
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {string[]}
 */
function setSourceProblems(block, label) {
  const source = isPlainObject(block.source) ? block.source : null;
  if (source === null) {
    return [`${label}.source が無い（どのバージョンのどこから何を条件に列挙したか残らない）`];
  }
  /** @type {string[]} */
  const problems = [];
  for (const key of ["kind", "ref", "version", "condition"]) {
    if (!nonEmptyString(source[key])) problems.push(`${label}.source.${key} が空`);
  }
  if (!inAllowlist(source.kind, SET_SOURCE_KINDS)) {
    problems.push(
      `${label}.source.kind（${showKind(source.kind)}）が ${SET_SOURCE_KINDS.join(" / ")} のいずれでもない`,
    );
  }
  problems.push(...strongerSourceProblems(block, label));
  return problems;
}

/**
 * 集合のブロックの `complete` / `incomplete_reason` を検査する（setInventoryProblems の完全性の側）。
 * complete: false は「列挙元を読み切れなかった」の記録。未列挙として扱い、確認済みにしない。
 * 真偽値でないときも合格として扱わない（未設定を「完全」と読まない）。
 * @param {Record<string, unknown>} block - 集合の出所と完全性のブロック
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {string[]}
 */
function setCompleteProblems(block, label) {
  if (block.complete === true) return staleIncompleteReasonProblems(block, label);
  if (block.complete !== false) {
    return [`${label}.complete が true ではない（未設定を「完全」と読まない）`];
  }
  if (!nonEmptyString(block.incomplete_reason)) {
    return [`${label}: complete: false なのに incomplete_reason が空（不足と列挙手順が残らない）`];
  }
  return [`${label}: 列挙が未完了（${String(block.incomplete_reason)}）— 確認済みにしない`];
}

/**
 * 項目集合の出所（`components[].source`）を検査する。語彙の外の値・キーごとの欠落を
 * 報告しないと、出所の欄が「書いたことが機能している証拠」にならない。
 * @param {unknown} raw - `components[].source`
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {string[]}
 */
function itemSourceProblems(raw, label) {
  /** @type {string[]} */
  const problems = [];
  if (!isPlainObject(raw)) {
    problems.push(`${label}.source が無い（項目集合をどこから起こしたか残らない）`);
    return problems;
  }
  const source = raw;
  for (const key of ["kind", "ref", "retrieved_at"]) {
    if (!nonEmptyString(source[key])) problems.push(`${label}.source.${key} が空`);
  }
  if (!inAllowlist(source.kind, ITEM_SOURCE_KINDS)) {
    problems.push(
      `${label}.source.kind（${showKind(source.kind)}）が ${ITEM_SOURCE_KINDS.join(" / ")} のいずれでもない`,
    );
  }
  return problems;
}

/**
 * インスタンスの列挙（`instances[].enumeration`）の出所のうち、語彙と一次情報源の申告を検査する。
 * 記録側は加えてプロファイルの `enumeration.sources` に属することも見るが、
 * 強さの判定はどちらの側も `SET_SOURCE_KINDS` で行う。
 * @param {Record<string, unknown>} en - `instances[].enumeration`
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {string[]}
 */
function enumerationSourceProblems(en, label) {
  /** @type {string[]} */
  const problems = [];
  const source = isPlainObject(en.source) ? en.source : null;
  // source ごとの欠落は呼び出し側が報告する（それぞれ別の未測定の数え方を持つ）。
  if (source === null) return problems;
  if (!inAllowlist(source.kind, SET_SOURCE_KINDS)) {
    problems.push(
      `${label}: enumeration.source.kind（${showKind(source.kind)}）が ${SET_SOURCE_KINDS.join(" / ")} のいずれでもない`,
    );
    return problems;
  }
  problems.push(...strongerSourceProblems(en, `${label}: enumeration`));
  return problems;
}

// absence-evidence-contract:end

// coverage-collect-ids:begin
/**
 * 期待セルの展開に使える id を集める。id が空・重複の要素は識別できないので展開に使わず、問題として記録する。
 * その要素が関わるセルは、未測定として数える。
 * id が空だと全要素が同じキーへ潰れ、1 行で全セルを満たせてしまう。重複は期待セルを二重に数える。
 * **警告なしに読み飛ばさない**（読み飛ばすと、識別できない要素があるのに conformance.ok: true になる）。
 * @param {unknown[]} entries
 * @param {string} label - 問題文に出す位置（例: 部品 grid の items）
 * @param {string[]} problems - 問題の追記先
 * @returns {{ids: string[], rejected: number}} rejected は展開に使えなかった要素数（未測定として数える）
 */
function collectIds(entries, label, problems) {
  /** @type {string[]} */
  const ids = [];
  /** @type {Set<string>} */
  const seen = new Set();
  let rejected = 0;
  entries.forEach((entry, index) => {
    const raw = isPlainObject(entry) ? entry.id : undefined;
    if (!nonEmptyString(raw)) {
      problems.push(`${label}[${index}]: id が空（識別できないので未測定として数える）`);
      rejected += 1;
      return;
    }
    const id = String(raw);
    if (seen.has(id)) {
      problems.push(`${label}[${index}]: id ${id} が重複している（先勝ちにしない）`);
      rejected += 1;
      return;
    }
    seen.add(id);
    ids.push(id);
  });
  return { ids, rejected };
}
// coverage-collect-ids:end

/**
 * 網羅表のセル 1 件を採点する。判定規則の原本は `references/coverage.md`「部品網羅表」。
 * **候補を展開する場合（プロファイル宣言あり）と汎用の場合（`profile: null`）で同じ規則を使う**。
 * 片方だけ検査すると、記録側は conformance.ok を出すのに収束側（parity-diff の
 * coverage-check.mjs）が同じ表を弾く状態になる。
 * @param {unknown} row - セル行（無ければ undefined）
 * @param {{isDuplicated: boolean, label: string, stateManifest: unknown}} ctx
 *   isDuplicated は同じ組み合わせの行が複数あるか、label は問題文に出す位置、
 *   stateManifest は components[].instances[].applicable_states
 * @param {string[]} problems - 問題の追記先
 * @returns {boolean} 未測定として数えるべきか
 */
function gradeCellRow(row, ctx, problems) {
  const { isDuplicated, label } = ctx;
  if (isDuplicated) {
    problems.push(`${label}: セル行が複数ある（先勝ちにしない）`);
    return true;
  }
  if (!isPlainObject(row)) {
    problems.push(`${label}: セルが無い（行の無い組み合わせは未測定）`);
    return true;
  }
  return gradeMeasuredCell(row, ctx, problems);
}

/**
 * 1 件に決まったセル行の値と証拠を採点する（gradeCellRow と、候補由来のセルの採点が共有する）。
 * @param {Record<string, unknown>} cell - セル行
 * @param {{label: string, stateManifest: unknown}} ctx
 *   label は問題文に出す位置、stateManifest は components[].instances[].applicable_states
 * @param {string[]} problems - 問題の追記先
 * @returns {boolean} 未測定として数えるべきか
 */
function gradeMeasuredCell(cell, ctx, problems) {
  const { label, stateManifest } = ctx;
  const value = cell.value;
  if (typeof value !== "string" || !VALUES.includes(value)) {
    problems.push(`${label}: value が ${VALUES.join(" / ")} のいずれでもない`);
    return true;
  }
  if (value === "unmeasured") return true;
  if (!nonEmptyString(cell.evidence)) {
    problems.push(`${label}: value: ${value} なのに evidence が空`);
    return true;
  }
  if (value === "present") {
    const coveredBy = isArray(cell.covered_by) ? cell.covered_by.filter(nonEmptyString) : [];
    if (coveredBy.length === 0) {
      problems.push(`${label}: value: present なのに covered_by が空（assertion になっていない）`);
      return true;
    }
    return false;
  }
  const absenceProblem = absentEvidenceProblem(cell, label, stateManifest);
  if (absenceProblem) {
    problems.push(absenceProblem);
    return true;
  }
  return false;
}

/**
 * プロファイルの形式を検査する。不正なプロファイルを警告なしに無視すると、
 * 候補ゼロ＝「照合するものが無い」として通ってしまうため、その場で問題として返す。
 * @param {unknown} profile
 * @param {string} source - 由来（エラーメッセージ用）
 * @returns {string[]} 問題の一覧（空なら妥当）
 */
export function validateProfile(profile, source) {
  /** @type {string[]} */
  const problems = [];
  /** @param {string} msg */
  const at = (msg) => problems.push(`${source}: ${msg}`);
  if (!isPlainObject(profile)) {
    at("プロファイルが JSON オブジェクトではない");
    return problems;
  }
  const p = profile;
  if (!nonEmptyString(p.id)) at("id が空");
  if (!nonEmptyString(p.version)) at("version が空");
  if (!nonEmptyString(p.applies_to)) at("applies_to が空（プロファイル選択の判断材料が残らない）");

  const axisById = validateAxes(p.axes, at);
  const rules = isArray(p.candidate_rules) ? p.candidate_rules : [];
  const ruleIds = validateCandidateRules(rules, axisById, at);
  validateRequiredRules(p.required_rules, { rules, ruleIds }, at);
  validateEnumerationBlock(p.enumeration, at);

  const equivalence = isPlainObject(p.equivalence) ? p.equivalence : null;
  if (equivalence) {
    const reducible = isArray(equivalence.reducible_axes) ? equivalence.reducible_axes : [];
    for (const axisId of reducible) {
      if (!axisById.has(String(axisId)))
        at(`equivalence.reducible_axes: 未定義の軸 ${String(axisId)} を参照している`);
    }
  }
  return problems;
}

/**
 * プロファイルの axes を検査し、軸 id → 軸の宣言の対応を返す。
 * @param {unknown} rawAxes - profile.axes
 * @param {(msg: string) => void} at - 問題の追記先
 * @returns {Map<string, {kind: string, values: string[], flags: string[]}>}
 */
function validateAxes(rawAxes, at) {
  const axes = isArray(rawAxes) ? rawAxes : [];
  if (axes.length === 0) at("axes が空");
  /** @type {Map<string, {kind: string, values: string[], flags: string[]}>} */
  const axisById = new Map();
  axes.forEach((axis, i) => {
    if (!isPlainObject(axis)) {
      at(`axes[${i}]: JSON オブジェクトではない`);
      return;
    }
    const a = axis;
    if (!nonEmptyString(a.id)) {
      at(`axes[${i}]: id が空`);
      return;
    }
    const id = String(a.id);
    if (axisById.has(id)) {
      at(`axes[${i}]: 軸 id ${id} が重複している`);
      return;
    }
    if (a.kind !== "element" && a.kind !== "enum") {
      at(`軸 ${id}: kind が element / enum のいずれでもない`);
      return;
    }
    const values = isArray(a.values) ? a.values.filter(nonEmptyString).map(String) : [];
    const flags = isArray(a.flags) ? a.flags.filter(nonEmptyString).map(String) : [];
    if (a.kind === "enum" && values.length === 0) {
      at(`軸 ${id}: kind: enum なのに values が空（候補が 0 件になる）`);
    }
    if (a.kind === "enum" && values.some((v) => v.includes(ID_SEPARATOR))) {
      at(`軸 ${id}: values に "${ID_SEPARATOR}" を含む値がある（候補 id が衝突する）`);
    }
    axisById.set(id, { kind: String(a.kind), values, flags });
  });
  return axisById;
}

/**
 * プロファイルの candidate_rules を検査し、読めたルール id の集合を返す。
 * @param {unknown[]} rules - profile.candidate_rules
 * @param {Map<string, {kind: string, values: string[], flags: string[]}>} axisById
 * @param {(msg: string) => void} at - 問題の追記先
 * @returns {Set<string>}
 */
function validateCandidateRules(rules, axisById, at) {
  if (rules.length === 0) at("candidate_rules が空");
  /** @type {Set<string>} */
  const ruleIds = new Set();
  rules.forEach((rule, i) => {
    if (!isPlainObject(rule)) {
      at(`candidate_rules[${i}]: JSON オブジェクトではない`);
      return;
    }
    const r = rule;
    if (!nonEmptyString(r.id)) {
      at(`candidate_rules[${i}]: id が空`);
      return;
    }
    const rid = String(r.id);
    if (rid.includes(ID_SEPARATOR))
      at(`ルール ${rid}: id に "${ID_SEPARATOR}" を含む（候補 id が衝突する）`);
    if (ruleIds.has(rid)) {
      at(`candidate_rules[${i}]: ルール id ${rid} が重複している`);
      return;
    }
    ruleIds.add(rid);
    const ruleAxes = isArray(r.axes) ? r.axes : [];
    if (ruleAxes.length === 0) at(`ルール ${rid}: axes が空`);
    for (const axisId of ruleAxes) {
      if (!axisById.has(String(axisId)))
        at(`ルール ${rid}: 未定義の軸 ${String(axisId)} を参照している`);
    }
    validateRuleVisualStates(r, rid, at);
    if (r.guard !== undefined) validateRuleGuard(r.guard, { rid, ruleAxes, axisById }, at);
  });
  return ruleIds;
}

/**
 * ルールの visual_states と no_visual_state_reason を検査する。
 * @param {Record<string, unknown>} r - candidate_rules の要素
 * @param {string} rid - ルール id
 * @param {(msg: string) => void} at - 問題の追記先
 */
function validateRuleVisualStates(r, rid, at) {
  // visual_states はキーごと省略させない。省略を「見た目が変わらない」として扱うと、
  // 状態を書き忘れたルールが、撮影状態の導出から警告なしに外れる（撮られない＝差 0 件と同じ見え方になる）。
  if (!isArray(r.visual_states)) {
    at(
      `ルール ${rid}: visual_states が配列ではない（見た目が変わらないなら空配列と no_visual_state_reason を書く）`,
    );
    return;
  }
  /** @type {Set<string>} */
  const seenKinds = new Set();
  for (const kind of r.visual_states) {
    const k = String(kind);
    if (!VISUAL_STATE_KINDS.includes(k))
      at(`ルール ${rid}: visual_states の ${k} は ${VISUAL_STATE_KINDS.join(" | ")} ではない`);
    else if (seenKinds.has(k)) at(`ルール ${rid}: visual_states の ${k} が重複している`);
    seenKinds.add(k);
  }
  if (r.visual_states.length === 0 && !nonEmptyString(r.no_visual_state_reason))
    at(
      `ルール ${rid}: visual_states が空なのに no_visual_state_reason が空（考えていないのと区別が付かない）`,
    );
  if (r.visual_states.length > 0 && nonEmptyString(r.no_visual_state_reason))
    at(`ルール ${rid}: visual_states が非空なのに no_visual_state_reason が埋まっている`);
}

/**
 * ルールの guard を検査する。
 * @param {unknown} guard - candidate_rules[].guard（undefined ではない）
 * @param {{rid: string, ruleAxes: unknown[], axisById: Map<string, {kind: string, values: string[], flags: string[]}>}} ctx
 *   rid はルール id、ruleAxes はルールの axes
 * @param {(msg: string) => void} at - 問題の追記先
 */
function validateRuleGuard(guard, ctx, at) {
  const { rid, ruleAxes, axisById } = ctx;
  if (!isPlainObject(guard)) {
    at(`ルール ${rid}: guard が JSON オブジェクトではない`);
    return;
  }
  for (const [key, value] of Object.entries(guard)) {
    const dot = key.indexOf(".");
    const axisId = dot === -1 ? "" : key.slice(0, dot);
    const flag = dot === -1 ? "" : key.slice(dot + 1);
    const axis = axisById.get(axisId);
    if (!axis) {
      at(`ルール ${rid}: guard のキー ${key} が <軸 id>.<フラグ名> の形になっていない`);
      continue;
    }
    if (axis.kind !== "element") at(`ルール ${rid}: guard は element 軸にしか置けない（${key}）`);
    // 宣言されていないフラグ名は誤記の可能性が高く、警告なしに「該当なし」＝候補ゼロで通る。
    else if (!axis.flags.includes(flag))
      at(`ルール ${rid}: 軸 ${axisId} に宣言の無いフラグ ${flag} を参照している`);
    if (typeof value !== "boolean") at(`ルール ${rid}: guard ${key} の値が真偽値ではない`);
    if (!ruleAxes.map(String).includes(axisId))
      at(`ルール ${rid}: guard が axes に無い軸 ${axisId} を参照している`);
  }
}

/**
 * required_rules を検査する。
 * 要素は ルール id か、ルール id の配列（どれか 1 つが候補を生めばよい代替の組）。
 * 代替の組は、同じ要求を排他な guard で分けたルール（初期表示の列と、表示切替で出す列の行の選択など）に使う。
 * 別々の要素にすると、片方の guard に当たる要素しか無い正当な部品が「必須ルールの候補 0 件」で行き止まりになる。
 * @param {unknown} rawRequired - profile.required_rules
 * @param {{rules: unknown[], ruleIds: Set<string>}} ctx - rules は candidate_rules、ruleIds は読めたルール id
 * @param {(msg: string) => void} at - 問題の追記先
 */
function validateRequiredRules(rawRequired, ctx, at) {
  const required = isArray(rawRequired) ? rawRequired : [];
  const groupCtx = { ...requiredRuleIndex(ctx.rules), ruleIds: ctx.ruleIds };
  /** @type {Set<string>} */
  const seenRequired = new Set();
  for (const entry of required) {
    const group = isArray(entry) ? entry : [entry];
    if (group.length === 0 || !group.every(nonEmptyString)) {
      at("required_rules: 空の要素・空の代替の組・文字列でないルール id がある");
      continue;
    }
    for (const rid of group) {
      if (!ctx.ruleIds.has(String(rid)))
        at(`required_rules: 未定義のルール ${String(rid)} を参照している`);
      if (seenRequired.has(String(rid)))
        at(
          `required_rules: ルール ${String(rid)} が 2 回以上現れる（代替の組は 1 つの要素にまとめる）`,
        );
      seenRequired.add(String(rid));
    }
    validateRequiredGroup(group, groupCtx, at);
  }
}

/**
 * 代替の組の照合に使う、ルール id ごとの軸の並び・guard・requirement の索引を作る。
 * @param {unknown[]} rules - candidate_rules
 * @returns {{axesOfRule: Map<string, string>, guardOfRule: Map<string, Record<string, unknown>>, requirementOfRule: Map<string, string>}}
 *   axesOfRule は代替の組の同質性、guardOfRule は排他性、requirementOfRule は意味の同一性（宣言した値だけを信じる）の照合に使う
 */
function requiredRuleIndex(rules) {
  /** @type {Map<string, string>} */
  const axesOfRule = new Map();
  /** @type {Map<string, Record<string, unknown>>} */
  const guardOfRule = new Map();
  /** @type {Map<string, string>} */
  const requirementOfRule = new Map();
  for (const rule of rules) {
    if (!isPlainObject(rule) || !nonEmptyString(rule.id)) continue;
    const r = rule;
    axesOfRule.set(String(r.id), JSON.stringify(isArray(r.axes) ? r.axes.map(String) : []));
    guardOfRule.set(String(r.id), isPlainObject(r.guard) ? r.guard : {});
    if (nonEmptyString(r.requirement)) requirementOfRule.set(String(r.id), String(r.requirement));
  }
  return { axesOfRule, guardOfRule, requirementOfRule };
}

/**
 * 代替の組 1 つの軸・requirement・guard の排他性を検査する。
 * @param {unknown[]} group - 空でない文字列だけからなる代替の組
 * @param {{axesOfRule: Map<string, string>, guardOfRule: Map<string, Record<string, unknown>>, requirementOfRule: Map<string, string>}} ctx
 * @param {(msg: string) => void} at - 問題の追記先
 */
function validateRequiredGroup(group, ctx, at) {
  const { axesOfRule, guardOfRule, requirementOfRule } = ctx;
  // 2 つのルールの guard が排他か（同じフラグに逆の値を要求する条件が 1 つ以上ある）。
  // 排他なら、1 つの要素はどちらか一方にしか当たらない＝同じ要求を要素の性質で分けたルールだと機械的に言える
  const exclusive = (/** @type {string} */ a, /** @type {string} */ b) => {
    const ga = guardOfRule.get(a) ?? {};
    const gb = guardOfRule.get(b) ?? {};
    return Object.keys(ga).some((k) => Object.hasOwn(gb, k) && ga[k] !== gb[k]);
  };
  // 組は「どれか 1 つで満たす」ので、同じ要求を guard だけで分けたルールに限る。軸が違うルールを組にすると
  // 片方の候補が、もう片方の候補 0 件を隠してしまう（例: 列の表示と右クリックメニューを組にすると、メニューの列挙の抜けが消える）
  if (group.length > 1 && new Set(group.map((rid) => axesOfRule.get(String(rid)))).size > 1) {
    at(
      `required_rules: 代替の組 ${group.map(String).join(" / ")} の axes が揃っていない（同じ要求を guard だけで分けたルールしか組にしない）`,
    );
  }
  // 軸や guard の形からは「同じ要求か」を推し量れない（排他は候補が重ならないことしか言わない。Codex レビュー）。
  // 組の全てのルールに同じ requirement を明示させ、宣言で意味の同一性を持たせる
  if (group.length > 1) {
    const reqs = group.map((rid) => requirementOfRule.get(String(rid)));
    if (reqs.some((x) => x === undefined) || new Set(reqs).size > 1)
      at(
        `required_rules: 代替の組 ${group.map(String).join(" / ")} の requirement が揃っていない（同じ要求を分けたルールには、組の全てに同じ requirement を書く）`,
      );
  }
  // 軸が揃っていても、別の要求（列の表示と列の絞り込みなど）を組にすると、片方の候補がもう片方の 0 件を隠してしまう。
  // 組の全ての組み合わせで guard が排他（同じフラグに逆の値を要求）なことを要求する
  for (let i = 0; i < group.length; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      if (!exclusive(String(group[i]), String(group[j])))
        at(
          `required_rules: 代替の組の ${String(group[i])} と ${String(group[j])} の guard が排他でない（同じフラグに逆の値を要求する条件が無い。同じ要求を要素の性質で分けたルールしか組にしない）`,
        );
    }
  }
}

/**
 * プロファイルの enumeration ブロックを検査する。
 * enumeration ブロックは形式の原本（profile-schema.json）が必須にしている。
 * とくに sources が空だと、readEnumeration の source.kind 検査が「候補ゼロ」として警告なしに通り、
 * どの列挙元でも通ってしまう。procedure / fail_closed / pitfalls が空のプロファイルは、
 * 列挙手順・落としやすい箇所・ソースを読めない場合の扱いを持たないまま配布されるため、ここで落とす。
 * @param {unknown} rawEnumeration - profile.enumeration
 * @param {(msg: string) => void} at - 問題の追記先
 */
function validateEnumerationBlock(rawEnumeration, at) {
  const enumeration = isPlainObject(rawEnumeration) ? rawEnumeration : null;
  if (!enumeration) {
    at("enumeration が無い（列挙元・手順・読めない場合の扱いが宣言されていない）");
    return;
  }
  validateEnumerationSources(enumeration.sources, at);
  for (const key of ["procedure", "fail_closed"]) {
    if (!nonEmptyString(enumeration[key])) at(`enumeration.${key} が空`);
  }
  const pitfalls = isArray(enumeration.pitfalls) ? enumeration.pitfalls.filter(nonEmptyString) : [];
  if (pitfalls.length === 0) {
    at("enumeration.pitfalls が空（列挙から落としやすい箇所が宣言されていない）");
  }
}

/**
 * プロファイルの enumeration.sources を検査する。
 * @param {unknown} rawSourcesValue - profile.enumeration.sources
 * @param {(msg: string) => void} at - 問題の追記先
 */
function validateEnumerationSources(rawSourcesValue, at) {
  // 型の誤り（非文字列・空文字・入れ子）を filter で落としてから検査すると、残った要素だけが
  // 語彙・順序の検査を通り、不正な宣言が「適合」として配布される。先に生の要素を見る。
  const rawSources = isArray(rawSourcesValue) ? rawSourcesValue : null;
  if (rawSources === null) {
    at("enumeration.sources が配列ではない（列挙元の kind を検査できず、どの値でも通る）");
  }
  const malformedSources = (rawSources ?? []).filter((v) => !nonEmptyString(v));
  if (malformedSources.length > 0) {
    at(
      // 空文字と未定義を見分けられるよう、型を問わず JSON で示す（showKind は文字列をそのまま返す）。
      `enumeration.sources に空でない文字列でない要素がある（${malformedSources.map((v) => JSON.stringify(v) ?? String(v)).join(" / ")}）`,
    );
  }
  const sources = (rawSources ?? []).filter(nonEmptyString).map(String);
  if (sources.length === 0 && rawSources !== null) {
    at("enumeration.sources が空（列挙元の kind を検査できず、どの値でも通る）");
  }
  // sources は**強い順**（SET_SOURCE_KINDS の並び）で宣言する。順序のない集合として扱うと、
  // いちばん弱い情報源だけで complete: true が通り、一次情報源を使わなかったことが残らない。
  const unknownSources = sources.filter((s) => !SET_SOURCE_KINDS.includes(s));
  if (unknownSources.length > 0) {
    at(
      `enumeration.sources に語彙外の値がある（${unknownSources.join(" / ")}）。使えるのは ${SET_SOURCE_KINDS.join(" / ")}`,
    );
  }
  const ranks = sources
    .filter((s) => SET_SOURCE_KINDS.includes(s))
    .map((s) => SET_SOURCE_KINDS.indexOf(s));
  if (ranks.some((rank, i) => i > 0 && rank <= ranks[i - 1])) {
    at(
      `enumeration.sources が強い順（${SET_SOURCE_KINDS.join(" → ")}）に並んでいない、または重複している: ${sources.join(" / ")}`,
    );
  }
}

/**
 * 同梱プロファイルを読み込む。不正なものは無視せず問題として返す（警告なしの候補ゼロを作らない）。
 * @param {string} dir - プロファイルディレクトリ
 * @param {{readdir?: (d: string) => string[], readFile?: (p: string) => string}} [deps]
 * @returns {{profiles: Map<string, Record<string, unknown>>, problems: string[]}}
 */
export function loadProfiles(dir, deps = {}) {
  const readdir = deps.readdir ?? ((d) => readdirSync(d));
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  /** @type {Map<string, Record<string, unknown>>} */
  const profiles = new Map();
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  let names;
  try {
    names = readdir(dir);
  } catch (e) {
    return { profiles, problems: [`プロファイルディレクトリを読めない: ${dir}: ${String(e)}`] };
  }
  // 読み込み順を固定して決定論的にする（readdir の順序は環境依存）。
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json")) continue;
    // スキーマ（形式の説明）はプロファイル実体ではない。
    if (name === "profile-schema.json") continue;
    const loaded = readProfileFile(join(dir, name), name, readFile);
    if ("problems" in loaded) {
      problems.push(...loaded.problems);
      continue;
    }
    const { id, profile } = loaded;
    if (profiles.has(id)) {
      problems.push(`${name}: プロファイル id ${id} が重複している`);
      continue;
    }
    profiles.set(id, profile);
  }
  return { profiles, problems };
}

/**
 * プロファイルのファイル 1 件を読み、形式とファイル名との一致を検査する。
 * @param {string} path - ファイルのパス
 * @param {string} name - ファイル名（エラーメッセージと id の照合に使う）
 * @param {(p: string) => string} readFile
 * @returns {{id: string, profile: Record<string, unknown>} | {problems: string[]}}
 */
function readProfileFile(path, name, readFile) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(readFile(path));
  } catch (e) {
    return { problems: [`${name}: JSON として読めない: ${String(e)}`] };
  }
  const found = validateProfile(parsed, name);
  if (found.length > 0) return { problems: found };
  // validateProfile が問題 0 件を返すのは JSON オブジェクトのときだけなので、ここへは到達しない。
  if (!isPlainObject(parsed)) {
    return {
      problems: [
        `${name}: 検査を通ったのに JSON オブジェクトでない（このツールの不具合。到達しない分岐に到達した）`,
      ],
    };
  }
  const p = parsed;
  const id = String(p.id);
  if (id !== name.slice(0, -".json".length)) {
    return { problems: [`${name}: id（${id}）がファイル名と一致しない`] };
  }
  return { id, profile: p };
}

/**
 * インスタンスの列挙（enumeration）を検査して element 軸ごとの要素を取り出す。
 * @param {unknown} enumeration
 * @param {Record<string, unknown>} profile
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {{elements: Map<string, Array<{id: string, flags: Record<string, boolean>}>>, absences?: undefined, problems: string[], usable: false}
 *   | {elements: Map<string, Array<{id: string, flags: Record<string, boolean>}>>, absences: {axes: Set<string>, elements: Set<string>}, problems: string[], usable: boolean}}
 *   列挙の形が読めないときは absences を持たず usable: false を返す
 */
export function readEnumeration(enumeration, profile, label) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, Array<{id: string, flags: Record<string, boolean>}>>} */
  const elements = new Map();
  if (!isPlainObject(enumeration)) {
    problems.push(`${label}: enumeration が無い（候補を展開できない。未列挙として扱う）`);
    return { elements, problems, usable: false };
  }
  const en = enumeration;
  problems.push(...enumerationOriginProblems(en, profile, label));

  // complete: false は「ソースを読めなかった」の記録。候補を展開せず、未列挙として扱う。
  // 真偽値でないときも合格として扱わない（未設定を「完全」と読まない）。
  if (en.complete !== true) {
    problems.push(incompleteEnumerationProblem(en, label));
    return { elements, problems, usable: false };
  }
  // 読み切れたのに理由が残っている記録は、同じ表の中で「完全」と「未完了」を同時に主張する。
  // 集合の出所（setInventoryProblems）と同じ扱いで落とす（判定側も同じ関数で見る）。
  problems.push(...staleIncompleteReasonProblems(en, label));

  const axes = isArray(profile.axes) ? profile.axes.filter(isPlainObject) : [];
  const raw = isPlainObject(en.elements) ? en.elements : {};
  if (!isPlainObject(en.elements))
    problems.push(`${label}: enumeration.elements が JSON オブジェクトではない`);
  for (const axis of axes) {
    const a = axis;
    if (a.kind !== "element") continue;
    const axisId = String(a.id);
    elements.set(axisId, readAxisElements(raw[axisId], { axis: a, axisId, label }, problems));
  }

  const { absences, problems: absenceProblems } = readJustifiedAbsences(
    en.justified_absences,
    elements,
    label,
  );
  problems.push(...absenceProblems);
  return { elements, absences, problems, usable: problems.length === 0 };
}

/**
 * 列挙の出所（enumeration.source）を検査する。
 * @param {Record<string, unknown>} en - instances[].enumeration
 * @param {Record<string, unknown>} profile
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {string[]}
 */
function enumerationOriginProblems(en, profile, label) {
  /** @type {string[]} */
  const problems = [];
  const source = isPlainObject(en.source) ? en.source : null;
  if (!source) {
    problems.push(`${label}: enumeration.source が無い（出所が残らない）`);
    return problems;
  }
  for (const key of ["kind", "ref", "version", "extracted_at", "condition"]) {
    if (!nonEmptyString(source[key])) problems.push(`${label}: enumeration.source.${key} が空`);
  }
  const allowed = isPlainObject(profile.enumeration) ? profile.enumeration.sources : null;
  const kinds = isArray(allowed) ? allowed.map(String) : [];
  if (kinds.length > 0 && nonEmptyString(source.kind) && !kinds.includes(String(source.kind))) {
    problems.push(
      `${label}: enumeration.source.kind（${String(source.kind)}）がプロファイルの sources にない`,
    );
  }
  // 語彙と「一次情報源を使わなかった理由」は判定側（coverage-check.mjs）と同じ関数で見る。
  // プロファイルの sources は所属だけを決める集合なので、いちばん弱い情報源だけで
  // complete: true が通る（読めるのに読んでいない場合に何も残らない）。
  problems.push(...enumerationSourceProblems(en, label));
  return problems;
}

/**
 * complete が true ではない列挙の指摘を返す。
 * @param {Record<string, unknown>} en - instances[].enumeration
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {string}
 */
function incompleteEnumerationProblem(en, label) {
  if (en.complete !== false) {
    return `${label}: enumeration.complete が true ではない（未設定を「完全」と読まない）`;
  }
  if (!nonEmptyString(en.incomplete_reason)) {
    return `${label}: complete: false なのに incomplete_reason が空（不足と実 UI からの列挙手順が残らない）`;
  }
  return `${label}: 列挙が未完了（${String(en.incomplete_reason)}）— 確認済みにしない`;
}

/**
 * element 軸 1 本の列挙を読む。
 * @param {unknown} rawList - enumeration.elements[<軸 id>]
 * @param {{axis: Record<string, unknown>, axisId: string, label: string}} ctx - axis はプロファイルの軸の宣言
 * @param {string[]} problems - 問題の追記先
 * @returns {Array<{id: string, flags: Record<string, boolean>}>}
 */
function readAxisElements(rawList, ctx, problems) {
  const { axis, axisId, label } = ctx;
  const list = isArray(rawList) ? rawList : null;
  if (list === null) {
    // 軸ごと欠けているのは「その軸の要素が無い」ではなく「列挙していない」。空配列と区別する。
    problems.push(`${label}: 軸 ${axisId} の列挙が無い（要素が無いなら空配列と根拠を残す）`);
    return [];
  }
  const elementCtx = {
    axisId,
    label,
    declaredFlags: isArray(axis.flags) ? axis.flags.map(String) : [],
    /** @type {Set<string>} */
    seen: new Set(),
  };
  /** @type {Array<{id: string, flags: Record<string, boolean>}>} */
  const parsed = [];
  list.forEach((el, i) => {
    const element = readAxisElement(el, i, { ...elementCtx, problems });
    if (element !== null) parsed.push(element);
  });
  return parsed;
}

/**
 * element 軸の要素 1 件を読む。読めなければ問題を残して null を返す。
 * @param {unknown} el - 要素
 * @param {number} i - 軸の中の位置
 * @param {{axisId: string, label: string, declaredFlags: string[], seen: Set<string>, problems: string[]}} ctx
 *   declaredFlags はプロファイルが宣言したフラグ名、seen は読んだ要素 id、problems は問題の追記先
 * @returns {{id: string, flags: Record<string, boolean>} | null}
 */
function readAxisElement(el, i, ctx) {
  const { axisId, label, seen, problems } = ctx;
  if (!isPlainObject(el)) {
    problems.push(`${label}: 軸 ${axisId}[${i}] が JSON オブジェクトではない`);
    return null;
  }
  const e = el;
  if (!nonEmptyString(e.id)) {
    problems.push(`${label}: 軸 ${axisId}[${i}]: id が空（候補 id を組めない）`);
    return null;
  }
  const id = String(e.id);
  if (id.includes(ID_SEPARATOR)) {
    problems.push(
      `${label}: 軸 ${axisId} の要素 ${id}: id に "${ID_SEPARATOR}" を含む（候補 id が衝突する）`,
    );
    return null;
  }
  if (seen.has(id)) {
    problems.push(`${label}: 軸 ${axisId} の要素 ${id} が重複している（先勝ちにしない）`);
    return null;
  }
  seen.add(id);
  return { id, flags: readElementFlags(e.flags, `${label}: 軸 ${axisId} の要素 ${id}`, ctx) };
}

/**
 * 要素のフラグを、プロファイルが宣言したフラグ名で読む。
 * @param {unknown} rawFlagsValue - 要素の flags
 * @param {string} elementLabel - エラーメッセージ用の要素のラベル
 * @param {{declaredFlags: string[], problems: string[]}} ctx
 * @returns {Record<string, boolean>}
 */
function readElementFlags(rawFlagsValue, elementLabel, ctx) {
  const { declaredFlags, problems } = ctx;
  /** @type {Record<string, boolean>} */
  const flags = {};
  const rawFlags = isPlainObject(rawFlagsValue) ? rawFlagsValue : {};
  for (const flag of declaredFlags) {
    const v = rawFlags[flag];
    if (typeof v !== "boolean") {
      problems.push(`${elementLabel}: フラグ ${flag} が真偽値で記録されていない`);
      flags[flag] = false;
      continue;
    }
    flags[flag] = v;
  }
  for (const key of Object.keys(rawFlags)) {
    if (!declaredFlags.includes(key)) {
      problems.push(`${elementLabel}: プロファイルに宣言の無いフラグ ${key} がある`);
    }
  }
  return flags;
}

/**
 * 「その軸／その要素は無い」の根拠（enumeration.justified_absences）を読む。
 * 根拠を読む手段が無いと、候補ゼロで不合格にした後に進む先が無くなり、
 * 「実際には無いのにフラグを true と偽って absent を測る」以外の方法が無くなる。
 * scope は `<軸 id>`（軸ごと空）か `<軸 id>/<要素 id>`（要素は在るがどの候補にもならない）。
 * @param {unknown} raw - enumeration.justified_absences
 * @param {Map<string, Array<{id: string, flags: Record<string, boolean>}>>} elements
 * @param {string} label
 * @returns {{absences: {axes: Set<string>, elements: Set<string>}, problems: string[]}}
 */
export function readJustifiedAbsences(raw, elements, label) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const axes = new Set();
  /** @type {Set<string>} */
  const elementScopes = new Set();
  if (raw === undefined) return { absences: { axes, elements: elementScopes }, problems };
  if (!isArray(raw)) {
    problems.push(`${label}: justified_absences が配列ではない`);
    return { absences: { axes, elements: elementScopes }, problems };
  }
  raw.forEach((entry, i) => {
    const problem = readAbsenceEntry(entry, i, { elements, label, axes, elementScopes });
    if (problem !== null) problems.push(problem);
  });
  return { absences: { axes, elements: elementScopes }, problems };
}

/**
 * justified_absences の 1 件を読み、scope を axes か elementScopes へ足す。不備があればその指摘を返す。
 * @param {unknown} entry - justified_absences の要素
 * @param {number} i - 位置
 * @param {{elements: Map<string, Array<{id: string, flags: Record<string, boolean>}>>, label: string, axes: Set<string>, elementScopes: Set<string>}} ctx
 *   axes は軸スコープの免除、elementScopes は要素スコープの免除の追記先
 * @returns {string|null}
 */
function readAbsenceEntry(entry, i, ctx) {
  const { elements, label } = ctx;
  if (!isPlainObject(entry))
    return `${label}: justified_absences[${i}] が JSON オブジェクトではない`;
  const e = entry;
  if (!nonEmptyString(e.scope)) return `${label}: justified_absences[${i}]: scope が空`;
  if (!nonEmptyString(e.reason)) {
    // 根拠のない免除は「測っていない」と区別が付かない。
    return `${label}: justified_absences[${i}]（${String(e.scope)}）: reason が空（無いことを確かめた手順が残らない）`;
  }
  const scope = String(e.scope);
  const sep = scope.indexOf(ID_SEPARATOR);
  const axisId = sep === -1 ? scope : scope.slice(0, sep);
  const list = elements.get(axisId);
  if (list === undefined) {
    return `${label}: justified_absences[${i}]: 未定義の element 軸 ${axisId} を参照している`;
  }
  if (sep === -1) {
    if (list.length > 0) {
      // 軸ごとの免除は「1 件も列挙されていない」ときだけ。要素が在るなら要素ごとに根拠を出す。
      return `${label}: justified_absences[${i}]: 軸 ${axisId} には要素が ${list.length} 件あり、軸ごとの免除は使えない（要素ごとの scope にする）`;
    }
    ctx.axes.add(axisId);
    return null;
  }
  const elementId = scope.slice(sep + 1);
  if (!list.some((el) => el.id === elementId)) {
    return `${label}: justified_absences[${i}]: 軸 ${axisId} に列挙されていない要素 ${elementId} を参照している`;
  }
  ctx.elementScopes.add(scope);
  return null;
}

/**
 * プロファイルの candidate_rules とインスタンスの列挙から候補集合を展開する。
 * 候補 id は `<ルール id>/<軸値をルールの axes 順に "/" 連結>` で決定論的に組む。
 * @param {Record<string, unknown>} profile
 * @param {Map<string, Array<{id: string, flags: Record<string, boolean>}>>} elements
 * @returns {Array<{id: string, rule: string, axes: Record<string, string>}>}
 */
export function expandCandidates(profile, elements) {
  const axes = isArray(profile.axes) ? profile.axes.filter(isPlainObject) : [];
  /** @type {Map<string, {kind: string, values: string[]}>} */
  const axisById = new Map();
  for (const axis of axes) {
    const a = axis;
    axisById.set(String(a.id), {
      kind: String(a.kind),
      values: isArray(a.values) ? a.values.map(String) : [],
    });
  }
  const rules = isArray(profile.candidate_rules)
    ? profile.candidate_rules.filter(isPlainObject)
    : [];
  /** @type {Array<{id: string, rule: string, axes: Record<string, string>}>} */
  const candidates = [];
  for (const rule of rules) {
    const r = rule;
    const ruleId = String(r.id);
    /** @type {string[]} */
    const ruleAxes = (isArray(r.axes) ? r.axes : []).map(String);
    /** @type {Record<string, unknown>} */
    const guard = isPlainObject(r.guard) ? r.guard : {};
    const columns = ruleColumns(ruleAxes, guard, { axisById, elements });
    if (columns === null || columns.some((c) => c.length === 0)) continue;
    for (const row of cartesianRows(columns)) {
      /** @type {Record<string, string>} */
      const axisValues = {};
      ruleAxes.forEach((axisId, i) => {
        axisValues[axisId] = row[i];
      });
      candidates.push({ id: [ruleId, ...row].join(ID_SEPARATOR), rule: ruleId, axes: axisValues });
    }
  }
  return candidates;
}

/**
 * ルールの軸ごとに、候補の軸値になる値の列を作る。未定義の軸を参照していれば null を返す。
 * @param {string[]} ruleAxes - ルールの axes
 * @param {Record<string, unknown>} guard - ルールの guard
 * @param {{axisById: Map<string, {kind: string, values: string[]}>, elements: Map<string, Array<{id: string, flags: Record<string, boolean>}>>}} ctx
 * @returns {string[][] | null}
 */
function ruleColumns(ruleAxes, guard, ctx) {
  /** @type {string[][]} */
  const columns = [];
  for (const axisId of ruleAxes) {
    const axis = ctx.axisById.get(axisId);
    if (!axis) return null;
    if (axis.kind === "enum") {
      columns.push([...axis.values]);
      continue;
    }
    const list = ctx.elements.get(axisId) ?? [];
    // guard はこの軸のフラグだけを見る。全て満たす要素だけが候補になる。
    const filtered = list.filter((el) =>
      Object.entries(guard).every(([key, want]) => {
        const dot = key.indexOf(".");
        if (dot === -1 || key.slice(0, dot) !== axisId) return true;
        return el.flags[key.slice(dot + 1)] === want;
      }),
    );
    columns.push(filtered.map((el) => el.id));
  }
  return columns;
}

/**
 * 値の列の直積を入力順で展開する（最後の軸が最も速く回る）。
 * @param {string[][]} columns
 * @returns {string[][]}
 */
function cartesianRows(columns) {
  /** @type {string[][]} */
  let rows = [[]];
  for (const column of columns) {
    /** @type {string[][]} */
    const next = [];
    for (const row of rows) for (const value of column) next.push([...row, value]);
    rows = next;
  }
  return rows;
}

/**
 * 必須ルールの候補ゼロが「根拠付きで空」かを判定する。
 * ルールが使う element 軸のうち 1 つでも、軸ごと空（軸スコープの免除あり）か
 * 全要素が要素スコープの免除を持つなら、そのルールが 0 件になるのは説明が付く。
 * @param {Record<string, unknown>} profile
 * @param {string} ruleId
 * @param {{elements: Map<string, Array<{id: string, flags: Record<string, boolean>}>>, absences: {axes: Set<string>, elements: Set<string>}}} enumerated
 *   readEnumeration が返した要素と免除
 * @returns {string[]|null} 根拠になった scope の一覧。説明が付かなければ null
 */
export function justifiedEmptyAxis(profile, ruleId, enumerated) {
  const { elements, absences } = enumerated;
  const rules = isArray(profile.candidate_rules)
    ? profile.candidate_rules.filter(isPlainObject)
    : [];
  const rule = rules.find((r) => String(r.id) === ruleId);
  if (!rule) return null;
  const ruleAxes = (isArray(rule.axes) ? rule.axes : []).map(String);
  for (const axisId of ruleAxes) {
    const list = elements.get(axisId);
    if (list === undefined) continue; // enum 軸は列挙を持たないので免除の対象外
    if (list.length === 0) {
      if (absences.axes.has(axisId)) return [axisId];
      continue;
    }
    const scopes = list.map((el) => `${axisId}${ID_SEPARATOR}${el.id}`);
    if (scopes.every((scope) => absences.elements.has(scope))) return scopes;
  }
  return null;
}

/**
 * 同値クラスを検査する。宣言が空なら削減していない（全候補を個別に採取した）とみなして検査しない。
 * 1 つでも宣言されたら、全候補の所属を要求する（部分的な削減を「宣言した分だけ」で通さない）。
 * @param {unknown} classes - components[].equivalence_classes
 * @param {Record<string, unknown>} profile
 * @param {{candidateIndex: Map<string, {rule: string, axes: Record<string, string>}>, label: string}} ctx
 *   candidateIndex は "<instance>/<candidate>" → 候補
 * @returns {string[]}
 */
export function checkEquivalenceClasses(classes, profile, ctx) {
  const { candidateIndex, label } = ctx;
  /** @type {string[]} */
  const problems = [];
  const list = isArray(classes) ? classes : [];
  if (list.length === 0) return problems;
  const equivalence = isPlainObject(profile.equivalence) ? profile.equivalence : {};
  const reducible = isArray(equivalence.reducible_axes)
    ? equivalence.reducible_axes.map(String)
    : [];

  const classCtx = {
    label,
    reducible,
    candidateIndex,
    problems,
    /** @type {Map<string, string>} メンバー → 最初に所属したクラス id */
    owner: new Map(),
    /** @type {Set<string>} */
    classIds: new Set(),
  };
  list.forEach((cls, i) => checkEquivalenceClass(cls, i, classCtx));

  for (const key of candidateIndex.keys()) {
    if (!classCtx.owner.has(key)) {
      problems.push(
        `${label}: 候補 ${key} がどの同値クラスにも属していない（削減するなら全候補の所属が要る）`,
      );
    }
  }
  return problems;
}

/**
 * @typedef {object} EquivalenceClassContext
 * @property {string} label
 * @property {string[]} reducible - プロファイルの equivalence.reducible_axes
 * @property {Map<string, {rule: string, axes: Record<string, string>}>} candidateIndex
 * @property {string[]} problems - 問題の追記先
 * @property {Map<string, string>} owner - メンバー → 最初に所属したクラス id
 * @property {Set<string>} classIds
 */

/**
 * 同値クラス 1 件を検査する。
 * @param {unknown} cls - equivalence_classes の要素
 * @param {number} i - 位置
 * @param {EquivalenceClassContext} ctx
 */
function checkEquivalenceClass(cls, i, ctx) {
  const { label, problems } = ctx;
  if (!isPlainObject(cls)) {
    problems.push(`${label}: equivalence_classes[${i}] が JSON オブジェクトではない`);
    return;
  }
  const c = cls;
  const { cid, axisId } = checkEquivalenceClassHeader(c, i, ctx);
  const members = (isArray(c.members) ? c.members : []).filter(nonEmptyString).map(String);
  if (members.length === 0) {
    problems.push(`${label}: 同値クラス ${cid}: members が空`);
    return;
  }
  const resolved = resolveEquivalenceMembers(members, cid, ctx);
  const representative = nonEmptyString(c.representative) ? String(c.representative) : null;
  if (!representative)
    problems.push(`${label}: 同値クラス ${cid}: representative が空（採取する候補が決まらない）`);
  else if (!members.includes(representative)) {
    problems.push(
      `${label}: 同値クラス ${cid}: representative ${representative} が members に含まれていない`,
    );
  }
  // 束ねてよいのは宣言した軸だけ。他の軸やルールが違うメンバーが含まれると、
  // 代表 1 件の採取では別物の差分が見えなくなる。
  if (axisId && resolved.length > 1) checkEquivalenceClassSpread(resolved, { axisId, cid }, ctx);
}

/**
 * 同値クラスの id・rationale・axis を検査し、問題文で使うクラスの呼び名と、読めた軸 id（空なら null）を返す。
 * @param {Record<string, unknown>} c - 同値クラス
 * @param {number} i - 位置
 * @param {EquivalenceClassContext} ctx
 * @returns {{ cid: string, axisId: string|null }}
 */
function checkEquivalenceClassHeader(c, i, ctx) {
  const { label, problems, classIds, reducible } = ctx;
  const cid = nonEmptyString(c.id) ? String(c.id) : `#${i}`;
  if (!nonEmptyString(c.id)) problems.push(`${label}: equivalence_classes[${i}]: id が空`);
  else if (classIds.has(cid)) problems.push(`${label}: 同値クラス ${cid} の id が重複している`);
  classIds.add(cid);
  if (!nonEmptyString(c.rationale)) {
    problems.push(
      `${label}: 同値クラス ${cid}: rationale が空（「同じに見えたから」は根拠にしない）`,
    );
  }
  const axisId = nonEmptyString(c.axis) ? String(c.axis) : null;
  if (!axisId) problems.push(`${label}: 同値クラス ${cid}: axis が空（どの軸で束ねたか残らない）`);
  else if (!reducible.includes(axisId)) {
    problems.push(
      `${label}: 同値クラス ${cid}: 軸 ${axisId} は reducible_axes にない（束ねると差分が見えなくなる）`,
    );
  }
  return { cid, axisId };
}

/**
 * 同値クラスのメンバーを候補へ引き当て、所属を記録する。引き当てた候補を返す。
 * @param {string[]} members
 * @param {string} cid - クラス id
 * @param {EquivalenceClassContext} ctx
 * @returns {Array<{rule: string, axes: Record<string, string>}>}
 */
function resolveEquivalenceMembers(members, cid, ctx) {
  const { label, problems, candidateIndex, owner } = ctx;
  /** @type {Array<{rule: string, axes: Record<string, string>}>} */
  const resolved = [];
  for (const member of members) {
    const candidate = candidateIndex.get(member);
    if (!candidate) {
      problems.push(`${label}: 同値クラス ${cid}: 候補に無いメンバー ${member} を参照している`);
      continue;
    }
    const previous = owner.get(member);
    if (previous !== undefined) {
      problems.push(
        `${label}: 候補 ${member} が同値クラス ${previous} と ${cid} の両方に属している`,
      );
      continue;
    }
    owner.set(member, cid);
    resolved.push(candidate);
  }
  return resolved;
}

/**
 * 同値クラスのメンバーが、宣言した軸以外（ルールと他の軸）で揃っているかを検査する。
 * @param {Array<{rule: string, axes: Record<string, string>}>} resolved - 2 件以上の候補
 * @param {{axisId: string, cid: string}} cls - 束ねた軸とクラス id
 * @param {EquivalenceClassContext} ctx
 */
function checkEquivalenceClassSpread(resolved, cls, ctx) {
  const { label, problems } = ctx;
  const { axisId, cid } = cls;
  const [first, ...rest] = resolved;
  const otherRule = rest.find((other) => other.rule !== first.rule);
  if (otherRule) {
    problems.push(
      `${label}: 同値クラス ${cid}: ルールの違う候補が含まれている（${first.rule} と ${otherRule.rule}）`,
    );
  }
  const sharedAxes = Object.keys(first.axes).filter((a) => a !== axisId);
  for (const other of resolved) {
    const differing = sharedAxes.find((a) => other.axes[a] !== first.axes[a]);
    if (differing !== undefined) {
      problems.push(`${label}: 同値クラス ${cid}: 軸 ${axisId} 以外（${differing}）でも束ねている`);
    }
  }
}

/**
 * 部品の宣言セル数（項目数 × インスタンス数）。採点せずに抜ける分岐が未測定として数える件数の定義で、
 * 判定側（parity-diff の coverage-check.mjs）の declaredCells と同じ式にする。列挙が空・部品が JSON
 * オブジェクトでないときに 0 になると「未測定 0」を主張できるため、下限として 1 を取る。
 * @param {unknown} component
 * @returns {number}
 */
function declaredCellCount(component) {
  const c = isPlainObject(component) ? component : {};
  const items = isArray(c.items) ? c.items.length : 0;
  const instances = isArray(c.instances) ? c.instances.length : 0;
  return Math.max(items * instances, 1);
}

/**
 * プロファイルを読めない部品の未測定の下限。記録側は候補を展開できないので採点しないが、判定側
 * （parity-diff の coverage-check.mjs）はプロファイルを読まず、インスタンスごとに記録された候補から数え直す。
 * 宣言セル数だけでは、items が欠けて候補だけ記録された網羅表で判定側を下回るため、判定側がその
 * インスタンスで数えうる件数の上限も取る: 候補ごとのセル（重複を除く）＋ 軸値が引けない候補（記録の要素数ぶん）
 * または列挙した要素のうち候補に現れないもの。どちらか一方しか数えないので大きい方を足す。下限は 1。
 * @param {Record<string, unknown>} c
 * @returns {number}
 */
function unscoredProfiledCellCount(c) {
  const instances = isArray(c.instances) ? c.instances : [];
  let recordedBound = 0;
  for (const instance of instances) {
    const inst = isPlainObject(instance) ? instance : {};
    const recorded = (isArray(inst.candidates) ? inst.candidates : []).filter(nonEmptyString);
    const unique = new Set(recorded.map(String)).size;
    const enumeration = isPlainObject(inst.enumeration) ? inst.enumeration : {};
    const elements = isPlainObject(enumeration.elements)
      ? Object.values(enumeration.elements).reduce(
          /** @param {number} n @param {unknown} list */
          (n, list) => n + (isArray(list) ? list.length : 0),
          0,
        )
      : 0;
    recordedBound += Math.max(unique + Math.max(recorded.length, elements), 1);
  }
  return Math.max(declaredCellCount(c), recordedBound);
}

/**
 * 網羅表とプロファイルを照合する。
 * @param {unknown} coverage - component-coverage.json をパースしたもの
 * @param {Map<string, Record<string, unknown>>} profiles
 * @param {{pageNames: string[], states: string[], popupStates: string[]} | null} [metadata] - metadata.json の撮影条件。
 *   渡さない実行では撮影状態の照合を checked: false にする（照合していない記録を照合済みとして扱わない）。
 * @returns {{ok: boolean, components: Array<Record<string, unknown>>, problems: string[], candidates: number, unmeasured: number, visualStates: {checked: boolean, table_fingerprint?: string, capture_fingerprint?: string | null, rows: number, undecided: number, missing_states: string[]}}}
 */
export function reconcile(coverage, profiles, metadata = null) {
  if (!isPlainObject(coverage)) return unreadableCoverageResult();
  const cov = coverage;
  const components = isArray(cov.components) ? cov.components : [];
  /** @type {string[]} */
  const problems = [];
  if (components.length === 0) problems.push("components が空");
  /** @type {ReconcileState} */
  const st = {
    problems,
    report: [],
    ...indexCells(cov.cells),
    expectedKeys: new Set(),
    seenComponents: new Set(),
    profiles,
    unmeasured: 0,
    candidateTotal: 0,
  };

  // 部品の集合の出所と完全性。列挙しなかった部品は期待セルにも現れないため、宣言が無いと
  // 「載せなかった部品」が未測定 0 のまま収束する（判定側の coverage-check.mjs と同じ扱い）。
  const inventoryProblems = setInventoryProblems(cov.component_inventory, "component_inventory");
  if (inventoryProblems.length > 0) {
    problems.push(...inventoryProblems);
    st.unmeasured += 1;
  }

  for (const [index, component] of components.entries()) {
    reconcileComponent(component, index, st);
  }

  reportStaleCells(st);

  // 撮影状態の導出は候補の展開と独立に当てる（プロファイル無しの部品にも同じ規則が要る）。
  const visual = checkVisualStates(cov, metadata);
  problems.push(...visual.problems);

  return {
    ok: problems.length === 0 && st.unmeasured === 0,
    components: st.report,
    problems,
    candidates: st.candidateTotal,
    unmeasured: st.unmeasured,
    visualStates: visual.summary,
  };
}

/**
 * 網羅表が JSON オブジェクトでないときの照合結果。
 * @returns {{ok: false, components: Array<Record<string, unknown>>, problems: string[], candidates: number, unmeasured: number, visualStates: {checked: boolean, rows: number, undecided: number, missing_states: string[]}}}
 */
function unreadableCoverageResult() {
  return {
    ok: false,
    components: [],
    problems: ["網羅表が JSON オブジェクトではない"],
    candidates: 0,
    unmeasured: 1,
    visualStates: { checked: false, rows: 0, undecided: 1, missing_states: [] },
  };
}

/**
 * 宣言に無い行（古い項目・インスタンスの残骸）を残さない。判定側は expected キー照合で同じ行を弾く。
 * @param {ReconcileState} st
 */
function reportStaleCells(st) {
  for (const key of st.byKey.keys()) {
    if (!st.expectedKeys.has(key)) {
      st.problems.push(`セル ${key}: components に無い 部品／項目／インスタンス を参照している`);
    }
  }
}

/**
 * reconcile が部品ごとの照合で共有する状態。
 * @typedef {object} ReconcileState
 * @property {string[]} problems - 問題の追記先
 * @property {Array<Record<string, unknown>>} report - 部品ごとの報告
 * @property {Map<string, Record<string, unknown>>} byKey - セル行の索引
 * @property {Set<string>} duplicated - 同じキーの行が複数あるキー
 * @property {Set<string>} expectedKeys - 期待セルのキー。宣言に無い行（古い項目・インスタンスの残骸）を最後に弾くために集める
 * @property {Set<string>} seenComponents
 * @property {Map<string, Record<string, unknown>>} profiles
 * @property {number} unmeasured
 * @property {number} candidateTotal
 */

/**
 * セル行のキー（部品／項目／インスタンス）。キーは JSON 配列にして区切り文字の衝突を避ける。
 * @param {string} c - 部品 id
 * @param {string} i - 項目 id
 * @param {string} n - インスタンス id
 * @returns {string}
 */
function cellKey(c, i, n) {
  return JSON.stringify([c, i, n]);
}

/**
 * セル行を 部品／項目／インスタンス で索引する。
 * @param {unknown} rawCells - coverage.cells
 * @returns {{byKey: Map<string, Record<string, unknown>>, duplicated: Set<string>}}
 */
function indexCells(rawCells) {
  const rows = isArray(rawCells) ? rawCells : [];
  /** @type {Map<string, Record<string, unknown>>} */
  const byKey = new Map();
  /** @type {Set<string>} */
  const duplicated = new Set();
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const r = row;
    if (!nonEmptyString(r.component) || !nonEmptyString(r.item) || !nonEmptyString(r.instance))
      continue;
    const key = cellKey(String(r.component), String(r.item), String(r.instance));
    if (byKey.has(key)) duplicated.add(key);
    else byKey.set(key, r);
  }
  return { byKey, duplicated };
}

/**
 * 部品 1 件を照合する。
 * @param {unknown} component - components の要素
 * @param {number} index - 位置
 * @param {ReconcileState} st
 */
function reconcileComponent(component, index, st) {
  const { problems } = st;
  if (!isPlainObject(component)) {
    problems.push(`components[${index}]: JSON オブジェクトではない`);
    st.unmeasured += declaredCellCount(component);
    return;
  }
  const c = component;
  const cid = nonEmptyString(c.id) ? String(c.id) : `#${index}`;
  // 部品 id が空・重複の部品は採点しない（重複は同じ部品を 2 回採点して ok を出せる）。
  // 判定側（parity-diff の coverage-check.mjs）は宣言セル数を未測定として数える。
  // 以下、部品を採点せずに抜ける分岐はすべて宣言セル数を未測定に足す（問題文だけ残して 0 件にしない。
  // 記録側だけが「未測定 0」を主張すると conformance の要約と metadata が未解決領域を過小に見せる）。
  // id が空のまま採点を続けると、未測定は候補数・インスタンス数単位になり宣言セル数を下回りうる。
  if (!nonEmptyString(c.id)) {
    problems.push(`components[${index}]: id が空`);
    st.unmeasured += declaredCellCount(c);
    return;
  }
  if (st.seenComponents.has(cid)) {
    problems.push(`components[${index}]: id ${cid} が重複している（先勝ちにしない）`);
    st.unmeasured += declaredCellCount(c);
    return;
  }
  st.seenComponents.add(cid);
  checkComponentSets(c, cid, st);

  // profile キーの欠落を「汎用」として扱わない。プロファイル無しを選ぶには理由が要る。
  if (!("profile" in c)) {
    problems.push(
      `部品 ${cid}: profile キーが無い（適合プロファイルが無いなら profile: null ＋ profile_absent_reason を書く。暗黙の汎用扱いにしない）`,
    );
    st.unmeasured += declaredCellCount(c);
    return;
  }
  if (c.profile === null) {
    reconcileGenericComponent(c, cid, st);
    return;
  }
  if (!nonEmptyString(c.profile)) {
    problems.push(`部品 ${cid}: profile が空でない文字列でも null でもない`);
    st.unmeasured += declaredCellCount(c);
    return;
  }
  reconcileProfiledComponent(c, cid, st);
}

/**
 * インスタンスの集合（この部品をどの画面に何個置いたか）の出所と完全性と、項目集合の出所
 * （components[].source）の語彙・キー欠落。判定側（coverage-check.mjs）と同じ検査を当てる。
 * @param {Record<string, unknown>} c
 * @param {string} cid
 * @param {ReconcileState} st
 */
function checkComponentSets(c, cid, st) {
  const setProblems = [
    ...setInventoryProblems(c.instance_inventory, `部品 ${cid} の instance_inventory`),
    ...itemSourceProblems(c.source, `部品 ${cid}`),
  ];
  if (setProblems.length > 0) {
    st.problems.push(...setProblems);
    st.unmeasured += 1;
  }
}

/**
 * プロファイルを宣言しない部品（profile: null）の報告。
 * @param {Record<string, unknown>} c
 * @param {string} cid
 * @returns {Record<string, unknown>}
 */
function genericReport(c, cid) {
  return {
    component: cid,
    profile: null,
    judged: false,
    reason: nonEmptyString(c.profile_absent_reason) ? String(c.profile_absent_reason) : null,
  };
}

/**
 * プロファイルを宣言しない部品（profile: null）を照合する。
 * @param {Record<string, unknown>} c
 * @param {string} cid
 * @param {ReconcileState} st
 */
function reconcileGenericComponent(c, cid, st) {
  const { problems } = st;
  if (!nonEmptyString(c.profile_absent_reason)) {
    problems.push(
      `部品 ${cid}: profile: null なのに profile_absent_reason が空（未検証の根拠が残らない）`,
    );
  }
  // プロファイルを宣言しない部品でも期待セルは 項目 × インスタンス で存在する。
  // 候補展開はしないが、セルの判定規則は候補を展開する場合と同じものを当てる（記録側だけ通る表を作らない）。
  const genericItems = isArray(c.items) ? c.items : [];
  const genericInstances = isArray(c.instances) ? c.instances : [];
  if (genericItems.length === 0 || genericInstances.length === 0) {
    // 空の列挙は期待セル 0 ＝ 未測定 0 と誤って判定されるので、1 件の未測定として数える
    // （判定側の coverage-check.mjs と同じ扱い）。
    problems.push(`部品 ${cid}: items または instances が空（列挙が起きていない）`);
    st.unmeasured += 1;
    st.report.push(genericReport(c, cid));
    return;
  }
  const itemIds = collectIds(genericItems, `部品 ${cid} の items`, problems);
  const instanceIds = collectIds(genericInstances, `部品 ${cid} の instances`, problems);
  // 期待セル数は「項目数 × インスタンス数」。id が空・重複の要素も項目／インスタンスとしては実在するので、
  // その要素が関わるセルは全て期待セルであり、識別できない以上すべて未測定になる
  // （読み飛ばすと、識別できない要素があるのに conformance.ok: true を出せる）。
  const itemTotal = itemIds.ids.length + itemIds.rejected;
  const instanceTotal = instanceIds.ids.length + instanceIds.rejected;
  st.unmeasured += itemTotal * instanceTotal - itemIds.ids.length * instanceIds.ids.length;
  gradeGenericCells(
    { cid, itemIds: itemIds.ids, instanceIds: instanceIds.ids, instances: genericInstances },
    st,
  );
  st.report.push(genericReport(c, cid));
}

/**
 * プロファイルを宣言しない部品の期待セル（項目 × インスタンス）を採点する。
 * @param {{cid: string, itemIds: string[], instanceIds: string[], instances: unknown[]}} component
 *   itemIds・instanceIds は展開に使える id、instances は components[].instances
 * @param {ReconcileState} st
 */
function gradeGenericCells(component, st) {
  const { cid, itemIds, instanceIds, instances } = component;
  /** @type {Map<string, Record<string, unknown>>} */
  const instanceById = new Map();
  for (const rawInst of instances) {
    if (!isPlainObject(rawInst)) continue;
    const inst = rawInst;
    if (!nonEmptyString(inst.id)) continue;
    const id = String(inst.id);
    if (!instanceById.has(id)) instanceById.set(id, inst);
  }
  for (const itemId of itemIds) {
    for (const instanceId of instanceIds) {
      const key = cellKey(cid, itemId, instanceId);
      st.expectedKeys.add(key);
      const isUnmeasured = gradeCellRow(
        st.byKey.get(key),
        {
          isDuplicated: st.duplicated.has(key),
          label: `部品 ${cid} / インスタンス ${instanceId}: 項目 ${itemId}`,
          stateManifest: instanceById.get(instanceId)?.applicable_states,
        },
        st.problems,
      );
      if (isUnmeasured) st.unmeasured += 1;
    }
  }
}

/**
 * プロファイルを宣言した部品の照合で、インスタンスをまたいで共有する状態。
 * @typedef {object} ProfiledComponentContext
 * @property {ReconcileState} st
 * @property {string} cid
 * @property {Record<string, unknown>} profile
 * @property {Map<string, Record<string, unknown>>} itemById - 項目 id → 項目（記録された candidate。余剰の検出に使う）
 * @property {Map<string, {rule: string, axes: Record<string, string>}>} candidateIndex
 * @property {Array<Record<string, unknown>>} instanceReports
 * @property {Set<string>} seenInstances
 */

/**
 * プロファイルを宣言した部品を照合する。
 * @param {Record<string, unknown>} c
 * @param {string} cid
 * @param {ReconcileState} st
 */
function reconcileProfiledComponent(c, cid, st) {
  const { problems } = st;
  const profileId = String(c.profile);
  const profile = st.profiles.get(profileId);
  if (!profile) {
    problems.push(`部品 ${cid}: プロファイル ${profileId} が同梱ディレクトリに無い`);
    // 候補を展開できないので採点していない。判定側は記録済みの候補から数え直せるが、記録側は検証していない。
    st.unmeasured += unscoredProfiledCellCount(c);
    return;
  }
  if (nonEmptyString(c.profile_version) && String(c.profile_version) !== String(profile.version)) {
    problems.push(
      `部品 ${cid}: 記録されたプロファイルのバージョン（${String(c.profile_version)}）が同梱プロファイルのバージョン（${String(profile.version)}）と違う。候補を展開し直す`,
    );
  }

  const instances = isArray(c.instances) ? c.instances : [];
  if (instances.length === 0) {
    problems.push(`部品 ${cid}: instances が空（列挙が起きていない）`);
    st.unmeasured += 1;
  }

  /** @type {ProfiledComponentContext} */
  const comp = {
    st,
    cid,
    profile,
    itemById: indexItems(c.items, cid, problems),
    candidateIndex: new Map(),
    instanceReports: [],
    seenInstances: new Set(),
  };
  for (const [i, instance] of instances.entries()) reconcileInstance(instance, i, comp);
  checkSurplusItems(comp);
  finishProfiledComponent(c.equivalence_classes, profileId, comp);
}

/**
 * プロファイルを宣言した部品の同値クラスを検査し、部品の報告を足す。
 * @param {unknown} classes - components[].equivalence_classes
 * @param {string} profileId
 * @param {ProfiledComponentContext} comp
 */
function finishProfiledComponent(classes, profileId, comp) {
  const { st, cid, profile } = comp;
  st.problems.push(
    ...checkEquivalenceClasses(classes, profile, {
      candidateIndex: comp.candidateIndex,
      label: `部品 ${cid}`,
    }),
  );
  st.report.push({
    component: cid,
    profile: profileId,
    profile_version: String(profile.version),
    judged: true,
    instances: comp.instanceReports,
    candidates: [...comp.candidateIndex.keys()].length,
  });
}

/**
 * 項目を id で索引する（記録された candidate。余剰の検出に使う）。
 * @param {unknown} rawItems - components[].items
 * @param {string} cid
 * @param {string[]} problems - 問題の追記先
 * @returns {Map<string, Record<string, unknown>>}
 */
function indexItems(rawItems, cid, problems) {
  const items = isArray(rawItems) ? rawItems : [];
  /** @type {Map<string, Record<string, unknown>>} */
  const itemById = new Map();
  for (const [i, item] of items.entries()) {
    if (!isPlainObject(item)) {
      problems.push(`部品 ${cid}: items[${i}] が JSON オブジェクトではない`);
      continue;
    }
    const it = item;
    if (!nonEmptyString(it.id)) {
      problems.push(`部品 ${cid}: items[${i}]: id が空`);
      continue;
    }
    if (itemById.has(String(it.id))) {
      problems.push(`部品 ${cid}: 項目 id ${String(it.id)} が重複している`);
      continue;
    }
    itemById.set(String(it.id), it);
  }
  return itemById;
}

/**
 * 余剰（候補集合に無い項目が candidate 付きで載っている＝列挙とズレている）を検査する。
 * @param {ProfiledComponentContext} comp
 */
function checkSurplusItems(comp) {
  // インスタンス id に区切り文字が無いことは上で保証済みなので、最初の区切りで切り分けられる。
  const candidateIds = new Set(
    [...comp.candidateIndex.keys()].map((k) => k.slice(k.indexOf(ID_SEPARATOR) + 1)),
  );
  // 列挙できなかったインスタンスがあると候補集合が不完全なので、余剰の判定は行わない
  // （全項目が「余剰」と誤って判定され、本当の原因〈列挙の問題〉を覆い隠す）。
  if (!comp.instanceReports.every((r) => r.usable)) return;
  for (const [itemId, item] of comp.itemById) {
    if (item.candidate !== undefined && !candidateIds.has(itemId)) {
      comp.st.problems.push(
        `部品 ${comp.cid}: 項目 ${itemId} は候補集合に無い（列挙とズレている。余剰）`,
      );
    }
  }
}

/**
 * インスタンスの id を検査する。採点できる id なら返し、できなければ問題と未測定 1 件を残して null を返す。
 * @param {Record<string, unknown>} inst
 * @param {number} i - 位置
 * @param {ProfiledComponentContext} comp
 * @returns {string|null}
 */
function acceptInstanceId(inst, i, comp) {
  const { st, cid } = comp;
  const iid = nonEmptyString(inst.id) ? String(inst.id) : `#${i}`;
  /** @type {string|null} */
  let problem = null;
  if (!nonEmptyString(inst.id)) {
    problem = `部品 ${cid}: instances[${i}]: id が空`;
  } else if (iid.includes(ID_SEPARATOR)) {
    // インスタンス id は候補キー（"<インスタンス id>/<候補 id>"）と同値クラスの members の前半になる。
    // 区切り文字を含むと前半と後半を切り分けられず、余剰判定が全項目を誤検出する。
    problem = `部品 ${cid}: instances[${i}]: id ${iid} に "${ID_SEPARATOR}" を含む（候補キー・同値クラスの members が切り分けられない）`;
  } else if (comp.seenInstances.has(iid)) {
    problem = `部品 ${cid}: インスタンス id ${iid} が重複している（先勝ちにしない）`;
  }
  if (problem !== null) {
    st.problems.push(problem);
    st.unmeasured += 1;
    return null;
  }
  comp.seenInstances.add(iid);
  return iid;
}

/**
 * 候補を展開できたインスタンスの照合で共有する状態。
 * @typedef {object} InstanceContext
 * @property {ProfiledComponentContext} comp
 * @property {string} label
 * @property {string} iid
 * @property {Record<string, unknown>} inst
 * @property {Array<{id: string, rule: string, axes: Record<string, string>}>} candidates
 * @property {{elements: Map<string, Array<{id: string, flags: Record<string, boolean>}>>, absences: {axes: Set<string>, elements: Set<string>}}} enumerated
 * @property {Set<string>} unmeasuredCandidates - 未測定へ数えた候補。instances[].candidates の記録忘れと同じ候補を二重に数えない
 */

/**
 * プロファイルを宣言した部品のインスタンス 1 件を照合する。
 * @param {unknown} instance - components[].instances の要素
 * @param {number} i - 位置
 * @param {ProfiledComponentContext} comp
 */
function reconcileInstance(instance, i, comp) {
  const { st, cid, profile } = comp;
  if (!isPlainObject(instance)) {
    st.problems.push(`部品 ${cid}: instances[${i}] が JSON オブジェクトではない`);
    st.unmeasured += 1;
    return;
  }
  const inst = instance;
  const iid = acceptInstanceId(inst, i, comp);
  if (iid === null) return;
  const label = `部品 ${cid} / インスタンス ${iid}`;
  const enumerated = readEnumeration(inst.enumeration, profile, label);
  st.problems.push(...enumerated.problems);
  if (!enumerated.usable) {
    // 列挙できないインスタンスは候補ゼロで素通りさせず、1 件の未測定として数える。
    st.unmeasured += 1;
    comp.instanceReports.push({ instance: iid, usable: false, candidates: 0 });
    return;
  }

  const candidates = expandCandidates(profile, enumerated.elements);
  /** @type {InstanceContext} */
  const ictx = {
    comp,
    label,
    iid,
    inst,
    candidates,
    enumerated,
    unmeasuredCandidates: new Set(),
  };
  /** @type {Set<string>} */
  const usedAbsences = new Set();
  checkRequiredRuleCandidates(ictx, usedAbsences);
  checkUnlistedElements(ictx, usedAbsences);
  // 使われない免除を警告なしに残さない（状況が変わったのに根拠だけが残る＝古い免除が有効に見える）。
  for (const scope of [...enumerated.absences.axes, ...enumerated.absences.elements]) {
    if (!usedAbsences.has(scope)) {
      st.problems.push(
        `${label}: justified_absences の ${scope} は有効になっていない（候補が展開されている。古い免除を残さない）`,
      );
    }
  }

  st.candidateTotal += candidates.length;
  for (const cand of candidates) gradeCandidate(cand, ictx);
  checkRecordedCandidates(ictx);
  comp.instanceReports.push({ instance: iid, usable: true, candidates: candidates.length });
}

/**
 * 必須ルールごとに候補が 1 件以上あるか、無いなら根拠付きで空かを検査する。根拠に使った免除を usedAbsences へ足す。
 * @param {InstanceContext} ictx
 * @param {Set<string>} usedAbsences
 */
function checkRequiredRuleCandidates(ictx, usedAbsences) {
  const { comp, label, candidates, enumerated } = ictx;
  const { st, profile } = comp;
  // 要素は ルール id か代替の組（validateProfile が形を検査済み）。組はどれか 1 つが候補を生めば満たす。
  const required = (isArray(profile.required_rules) ? profile.required_rules : []).map((entry) =>
    isArray(entry) ? entry.map(String) : [String(entry)],
  );
  for (const group of required) {
    if (candidates.some((cand) => group.includes(cand.rule))) continue;
    // 「その部品には無い」の主張は、ルールが使う element 軸のいずれかが
    // 根拠付きで空（軸ごと空、または全要素が要素ごとの免除を持つ）のときだけ通す。
    // 代替の組は、組の全てのルールについて根拠があるときだけ通す（1 つでも根拠が無ければ、列挙の抜けと区別できない）。
    const justified = group.map((rid) => justifiedEmptyAxis(profile, rid, enumerated));
    if (justified.every(Boolean)) {
      for (const scopes of justified) for (const scope of scopes ?? []) usedAbsences.add(scope);
      continue;
    }
    st.problems.push(
      `${label}: 必須ルール ${group.join(" / ")} の候補が 0 件（列挙されていないのか、その部品に無いのかを区別できない。無いなら enumeration.justified_absences に根拠を残す）`,
    );
    st.unmeasured += 1;
  }
}

/**
 * 列挙した要素が候補へ 1 件も現れないのは、フラグの記録忘れかルールの取りこぼしである。
 * 「40 列を列挙したが候補は代表 1 列だけ」をここで落とす。
 * 根拠付きの免除（justified_absences）がある要素だけを通し、その免除を usedAbsences へ足す。
 * @param {InstanceContext} ictx
 * @param {Set<string>} usedAbsences
 */
function checkUnlistedElements(ictx, usedAbsences) {
  const { comp, label, candidates, enumerated } = ictx;
  for (const [axisId, list] of enumerated.elements) {
    for (const el of list) {
      if (candidates.some((cand) => cand.axes[axisId] === el.id)) continue;
      const scope = `${axisId}${ID_SEPARATOR}${el.id}`;
      if (enumerated.absences.elements.has(scope)) {
        usedAbsences.add(scope);
        continue;
      }
      comp.st.problems.push(
        `${label}: 列挙した ${axisId} の要素 ${el.id} がどの候補にも現れない（フラグの記録忘れか、ルールの取りこぼし。意図的なら enumeration.justified_absences に根拠を残す）`,
      );
      comp.st.unmeasured += 1;
    }
  }
}

/**
 * 候補 1 件を未測定に数え、数えたことを覚える。
 * @param {InstanceContext} ictx
 * @param {string} id - 候補 id
 */
function countCandidateUnmeasured(ictx, id) {
  ictx.comp.st.unmeasured += 1;
  ictx.unmeasuredCandidates.add(id);
}

/**
 * 候補 1 件の記録と、候補由来の期待セルを採点する。
 * @param {{id: string, rule: string, axes: Record<string, string>}} cand
 * @param {InstanceContext} ictx
 */
function gradeCandidate(cand, ictx) {
  const { comp, label, iid, inst } = ictx;
  const { st, cid } = comp;
  comp.candidateIndex.set(`${iid}${ID_SEPARATOR}${cand.id}`, { rule: cand.rule, axes: cand.axes });
  const recordMatches = candidateRecordMatches(cand, ictx);

  // セルの判定規則は coverage.md「部品網羅表」が原本。候補由来の期待セルへ同じ規則を当てる。
  const key = cellKey(cid, cand.id, iid);
  st.expectedKeys.add(key);
  // 記録の不備とセルの不備は別の欠陥として数える。判定側は軸値が引けない候補を 1 件数えたうえで、
  // そのセルも採点するので、ここで 1 件に畳むと両方が欠けた候補で判定側を下回る。
  if (!recordMatches) countCandidateUnmeasured(ictx, cand.id);
  if (st.duplicated.has(key)) {
    st.problems.push(`${label}: 候補 ${cand.id} のセル行が複数ある（先勝ちにしない）`);
    countCandidateUnmeasured(ictx, cand.id);
    return;
  }
  const row = st.byKey.get(key);
  if (!row) {
    st.problems.push(`${label}: 候補 ${cand.id} のセルが無い（行の無い組み合わせは未測定）`);
    countCandidateUnmeasured(ictx, cand.id);
    return;
  }
  const cellCtx = { label: `${label}: 候補 ${cand.id}`, stateManifest: inst.applicable_states };
  if (gradeMeasuredCell(row, cellCtx, st.problems)) countCandidateUnmeasured(ictx, cand.id);
}

/**
 * 項目に記録された candidate が展開結果と一致するかを返す。食い違いは問題として残す。
 * 判定側はプロファイルを読まず、この candidate.axes から軸ごとの要素集合を作って数え直す。
 * 項目が無い・記録が無い・展開結果と違う候補は判定側の数え直しを成立させないので、呼び出し側がセルの値に依らず 1 件を未測定に数える。
 * @param {{id: string, rule: string, axes: Record<string, string>}} cand
 * @param {InstanceContext} ictx
 * @returns {boolean}
 */
function candidateRecordMatches(cand, ictx) {
  const { label } = ictx;
  const { problems } = ictx.comp.st;
  const item = ictx.comp.itemById.get(cand.id);
  if (!item) {
    problems.push(`${label}: 候補 ${cand.id} に対応する項目が網羅表に無い（欠落）`);
    return false;
  }
  const recorded = isPlainObject(item.candidate) ? item.candidate : null;
  if (!recorded) {
    problems.push(`${label}: 項目 ${cand.id} に candidate（ルール id と軸値）が記録されていない`);
    return false;
  }
  // rule だけの不一致は問題として残すが未測定には数えない。判定側は candidate.axes だけで数え直すので、
  // rule の誤りは判定側の件数を変えない（数えると記録側だけが未解決を過大に見せる）。
  if (String(recorded.rule) !== cand.rule) {
    problems.push(
      `${label}: 項目 ${cand.id} の candidate.rule（${String(recorded.rule)}）が展開結果（${cand.rule}）と違う`,
    );
  }
  // axes が無い形は判定側も 1 件数える。軸値が展開結果と違う形は判定側の要素照合を狂わせ、
  // 候補に現れない要素を数えさせうる（記録側は展開結果で照合するので数えない）ため、記録側で 1 件数えて下回らないようにする。
  let recordMatches = isPlainObject(recorded.axes);
  const recordedAxes = isPlainObject(recorded.axes) ? recorded.axes : {};
  for (const [axisId, value] of Object.entries(cand.axes)) {
    if (String(recordedAxes[axisId]) !== value) {
      recordMatches = false;
      problems.push(
        `${label}: 項目 ${cand.id} の candidate.axes.${axisId}（${String(recordedAxes[axisId])}）が展開結果（${value}）と違う`,
      );
    }
  }
  return recordMatches;
}

/**
 * instances[].candidates に記録された候補を、展開結果と突き合わせる。
 * @param {InstanceContext} ictx
 */
function checkRecordedCandidates(ictx) {
  const { comp, label, inst, candidates, unmeasuredCandidates } = ictx;
  const { st } = comp;
  // 記録された候補が展開結果とズレていたら、parity-diff 側の数え直しが別物になる。
  // 判定側は instances[].candidates に記録された候補だけを期待セルとして数え、記録が空・無いインスタンスは
  // 1 件の未測定にする。記録から漏れた候補は判定側で採点されないので、記録側も未測定に数える
  // （空・無いときは判定側と同じ 1 件。一部だけ漏れたときは漏れた件数で、判定側の数え直し以上になる）。
  // 候補ループで既に未測定へ数えた候補は足さない（セル行も記録も無い候補を 2 件に数えない）。
  if (!isArray(inst.candidates)) {
    st.problems.push(
      `${label}: instances[].candidates が無い（parity-diff が数え直せない。--write で書き出す）`,
    );
    st.unmeasured += Number(unmeasuredCandidates.size === 0);
    return;
  }
  const recorded = inst.candidates.filter(nonEmptyString).map(String);
  const expected = candidates.map((cand) => cand.id);
  const missing = expected.filter((id) => !recorded.includes(id));
  const extra = recorded.filter((id) => !expected.includes(id));
  if (missing.length > 0)
    st.problems.push(
      `${label}: instances[].candidates に展開結果の候補が足りない（${missing.length} 件）`,
    );
  st.unmeasured +=
    recorded.length === 0
      ? Number(unmeasuredCandidates.size === 0)
      : missing.filter((id) => !unmeasuredCandidates.has(id)).length;
  if (extra.length > 0)
    st.problems.push(
      `${label}: instances[].candidates に展開結果に無い候補がある（${extra.length} 件）`,
    );
}

/**
 * 撮影状態の行のキー。**要求元（`required_by`）を含める**。種別だけで束ねると、
 * 同じ種別を要求する別の操作が 1 行へ潰れ、片方を撮るだけでチェックが通る。
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function visualRowKey(row) {
  return JSON.stringify([
    String(row.component),
    String(row.instance),
    String(row.required_by),
    String(row.kind),
  ]);
}

/**
 * 撮影状態の必要集合を網羅表から導く（純関数）。
 *
 * 測った操作（value: present のセル）と、その項目が宣言した見た目の状態の種別（items[].visual_states）から
 * 「部品 × インスタンス × 要求元の操作 × 種別」の行を作る。撮っていない状態には差が出ず、差分ツールは撮った 2 枚しか比べないので、
 * 集合が足りないぶんは「差 0 件」と区別が付かない。導出はその不足を撮る前に見えるようにする。
 *
 * 下限であって上限ではない。操作から導けない状態（error / 初期表示のバリアント）は手で states へ足す。
 * @param {Record<string, unknown>} cov
 * @returns {{rows: Array<Record<string, unknown>>, problems: string[]}}
 */
export function deriveVisualStateRows(cov) {
  /** @type {string[]} */
  const problems = [];
  const components = isArray(cov.components) ? cov.components : [];
  const cells = isArray(cov.cells) ? cov.cells : [];
  const derived = deriveRowsFromCells(cells, {
    representativeOf: representativeIndex(components),
    itemsByComponent: itemKindsIndex(components, problems),
  });

  // 入力順ではなく安定な並びで出す（書き戻した網羅表が実行ごとに変わらないようにする）。
  const rows = [...derived.values()]
    .sort(
      (a, b) =>
        a.component.localeCompare(b.component) ||
        a.instance.localeCompare(b.instance) ||
        a.required_by.localeCompare(b.required_by) ||
        VISUAL_STATE_KINDS.indexOf(a.kind) - VISUAL_STATE_KINDS.indexOf(b.kind),
    )
    .map((row) => ({
      ...row,
      ...Object.fromEntries(HUMAN_DECIDED_ROW_FIELDS.map((field) => [field, null])),
    }));
  return { rows, problems };
}

/**
 * 部品 → "<インスタンス id>/<候補 id>" → 視覚採取する代表 "<インスタンス id>/<候補 id>" の対応を作る。
 * 縮約してよい軸かどうか・所属の全体性・根拠・代表の妥当性は、checkEquivalenceClasses が
 * 同じ実行の reconcile で検査する。そのため、ここは構造（members / representative）だけを読む
 * （不正なクラスは problems が立って ok: false になるため、縮約が誤っても緑にはならない）。
 * **プロファイルを宣言した部品だけ**を対象にする。reducible_axes を持たない部品には、
 * どの軸を縮約してよいかの宣言が無く、検証も実行されないためである。
 * @param {unknown[]} components - coverage.components
 * @returns {Map<string, Map<string, string>>}
 */
function representativeIndex(components) {
  /** @type {Map<string, Map<string, string>>} */
  const representativeOf = new Map();
  for (const component of components) {
    if (!isPlainObject(component)) continue;
    const c = component;
    if (!nonEmptyString(c.id) || !nonEmptyString(c.profile)) continue;
    const cid = String(c.id);
    if (representativeOf.has(cid)) continue;
    /** @type {Map<string, string>} */
    const byMember = new Map();
    for (const klass of isArray(c.equivalence_classes) ? c.equivalence_classes : []) {
      if (!isPlainObject(klass)) continue;
      addClassRepresentative(klass, byMember);
    }
    representativeOf.set(cid, byMember);
  }
  return representativeOf;
}

/**
 * 同値クラス 1 件のメンバー → 代表の対応を足す。
 * @param {Record<string, unknown>} k - 同値クラス
 * @param {Map<string, string>} byMember - 追記先
 */
function addClassRepresentative(k, byMember) {
  if (!nonEmptyString(k.representative)) return;
  const representative = String(k.representative);
  for (const member of isArray(k.members) ? k.members : []) {
    if (!nonEmptyString(member)) continue;
    // 同じ候補が複数クラスに属する表は checkEquivalenceClasses が落とす。先勝ちにしない。
    if (byMember.has(String(member))) byMember.set(String(member), "");
    else byMember.set(String(member), representative);
  }
}

/**
 * 部品 → 項目 id → その項目が要求する状態種別の索引を作る。id が空・重複の部品／項目は reconcile 側が落とすので、
 * ここでは識別できるものだけを索引する（同じ問題を二重に報告しない）。
 * @param {unknown[]} components - coverage.components
 * @param {string[]} problems - 問題の追記先
 * @returns {Map<string, Map<string, {kinds: string[], requiredBy: string}>>}
 */
function itemKindsIndex(components, problems) {
  /** @type {Map<string, Map<string, {kinds: string[], requiredBy: string}>>} */
  const itemsByComponent = new Map();
  for (const component of components) {
    if (!isPlainObject(component)) continue;
    const c = component;
    if (!nonEmptyString(c.id)) continue;
    const cid = String(c.id);
    if (itemsByComponent.has(cid)) continue;
    itemsByComponent.set(cid, componentItemKinds(c, cid, problems));
  }
  return itemsByComponent;
}

/**
 * 部品 1 件の項目 id → 状態種別の索引を作る（itemKindsIndex の部品ごとの処理）。
 * @param {Record<string, unknown>} c - 部品
 * @param {string} cid - 部品 id
 * @param {string[]} problems - 問題の追記先
 * @returns {Map<string, {kinds: string[], requiredBy: string}>}
 */
function componentItemKinds(c, cid, problems) {
  /** @type {Map<string, {kinds: string[], requiredBy: string}>} */
  const byItem = new Map();
  for (const item of isArray(c.items) ? c.items : []) {
    if (!isPlainObject(item)) continue;
    const it = item;
    if (!nonEmptyString(it.id)) continue;
    const iid = String(it.id);
    if (byItem.has(iid)) continue;
    // 要求元は項目 id（プロファイル由来なら候補 id）そのもの。**ルール id でまとめない**。
    // ルールは複数の軸の直積へ展開されるので、まとめると縮約してはいけない軸まで畳んでしまう
    // （datagrid の column-sort は sort-direction へ展開されるが、その軸は reducible_axes に無い）。
    // 縮約は宣言・検証済みの同値クラス経由でだけ行う（representativeIndex）。
    byItem.set(iid, {
      kinds: itemVisualKinds(it, `部品 ${cid}: 項目 ${iid}`, problems),
      requiredBy: iid,
    });
  }
  return byItem;
}

/**
 * 項目の visual_states を検査し、使える状態種別を返す。
 * @param {Record<string, unknown>} it - 項目
 * @param {string} itemLabel - エラーメッセージ用の項目のラベル
 * @param {string[]} problems - 問題の追記先
 * @returns {string[]}
 */
function itemVisualKinds(it, itemLabel, problems) {
  if (!isArray(it.visual_states)) {
    problems.push(
      `${itemLabel}: visual_states が配列ではない（見た目が変わらないなら空配列と no_visual_state_reason を書く。プロファイル宣言済みなら --write で書き戻す）`,
    );
    return [];
  }
  /** @type {string[]} */
  const kinds = [];
  for (const kind of it.visual_states) {
    const k = String(kind);
    if (!VISUAL_STATE_KINDS.includes(k)) {
      problems.push(
        `${itemLabel}: visual_states の ${k} は ${VISUAL_STATE_KINDS.join(" | ")} ではない`,
      );
      continue;
    }
    if (kinds.includes(k)) {
      problems.push(`${itemLabel}: visual_states の ${k} が重複している`);
      continue;
    }
    kinds.push(k);
  }
  // 理由欄の要否は「宣言した長さ」で見る（誤記を弾いた後の kinds.length で見ると、
  // 誤記だけの宣言が「空なのに理由が無い」と誤って判定され、原因が 2 つに割れる。validateProfile と同じ規則）。
  if (it.visual_states.length === 0 && !nonEmptyString(it.no_visual_state_reason))
    problems.push(
      `${itemLabel}: visual_states が空なのに no_visual_state_reason が空（考えていないのと区別が付かない）`,
    );
  if (it.visual_states.length > 0 && nonEmptyString(it.no_visual_state_reason))
    problems.push(`${itemLabel}: visual_states が非空なのに no_visual_state_reason が埋まっている`);
  return kinds;
}

/**
 * 測った操作（value: present のセル）から、撮影状態の行をキーごとに作る。
 * @param {unknown[]} cells - coverage.cells
 * @param {{representativeOf: Map<string, Map<string, string>>, itemsByComponent: Map<string, Map<string, {kinds: string[], requiredBy: string}>>}} index
 * @returns {Map<string, {component: string, instance: string, required_by: string, kind: string}>}
 */
function deriveRowsFromCells(cells, index) {
  /** @type {Map<string, {component: string, instance: string, required_by: string, kind: string}>} */
  const derived = new Map();
  for (const cell of cells) {
    if (!isPlainObject(cell)) continue;
    const r = cell;
    // 撮る必要が生まれるのは操作が在ると測れたときだけ。absent / unmeasured は状態を要求しない。
    if (r.value !== "present") continue;
    if (!nonEmptyString(r.component) || !nonEmptyString(r.item) || !nonEmptyString(r.instance))
      continue;
    const cid = String(r.component);
    const iid = String(r.item);
    const inst = String(r.instance);
    const item = index.itemsByComponent.get(cid)?.get(iid);
    // 宣言に無い部品・項目のセルは reconcile が余剰として落とす。
    if (!item) continue;
    const representative = index.representativeOf.get(cid)?.get(`${inst}${ID_SEPARATOR}${iid}`);
    const target = rowTarget(representative, inst, item.requiredBy);
    for (const kind of item.kinds) {
      // 要求元をキーに含める。種別だけで束ねると、同じ種別を要求する別の操作
      // （列フィルタの吹き出しと右クリックメニューはどちらも opens-container）が 1 行へ潰れ、
      // 片方の状態名を書くだけでチェックが通る。撮られなかった方の差は「差 0 件」と同じ見え方になり、
      // この導出で防ごうとした抜けがそのまま残る。
      const key = JSON.stringify([cid, target.instance, target.requiredBy, kind]);
      derived.set(key, {
        component: cid,
        instance: target.instance,
        required_by: target.requiredBy,
        kind,
      });
    }
  }
  return derived;
}

/**
 * 撮影状態の行を置くインスタンスと要求元を決める。
 * 同値クラスに属する候補は、視覚採取する代表の行へ寄せる（代表 1 件だけを撮る）。
 * 寄せ先は代表のインスタンスである。撮るのは代表が載っているページなので、
 * 行の撮影単位も代表側で決まる。クラスに属さない候補は自分の行を持つ。
 * @param {string|undefined} representative - 代表 "<インスタンス id>/<候補 id>"
 * @param {string} inst - セルのインスタンス id
 * @param {string} requiredBy - 項目の要求元
 * @returns {{instance: string, requiredBy: string}}
 */
function rowTarget(representative, inst, requiredBy) {
  if (!nonEmptyString(representative)) return { instance: inst, requiredBy };
  const cut = String(representative).indexOf(ID_SEPARATOR);
  // インスタンス id に区切り文字は入らない（reconcile が落とす）ので最初の "/" で割れる。
  if (cut <= 0) return { instance: inst, requiredBy };
  return {
    instance: String(representative).slice(0, cut),
    requiredBy: String(representative).slice(cut + 1),
  };
}

/**
 * 書き戻す前の網羅表の行を、キー（部品・インスタンス・要求元・種別）で索引する。
 * キーの材料が欠けた行は索引しない。同じキーの重複は空の行にして、どちらの判断も引き継がない。
 * @param {Record<string, unknown>} previous - 書き戻す前の visual_state_coverage
 * @returns {Map<string, Record<string, unknown>>}
 */
function previousVisualRowsByKey(previous) {
  /** @type {Map<string, Record<string, unknown>>} */
  const prevByKey = new Map();
  for (const row of isArray(previous.rows) ? previous.rows : []) {
    if (!isPlainObject(row)) continue;
    const r = row;
    if (
      !nonEmptyString(r.component) ||
      !nonEmptyString(r.instance) ||
      !nonEmptyString(r.required_by) ||
      !nonEmptyString(r.kind)
    )
      continue;
    const key = visualRowKey(r);
    // 同じキーの重複は先勝ちにせず、どちらの判断も引き継がない（警告なしに一方を採ると判断が消える）。
    if (prevByKey.has(key)) prevByKey.set(key, {});
    else prevByKey.set(key, r);
  }
  return prevByKey;
}

/**
 * 導いた行を網羅表へ書き戻す。captured / reason は同じキー（部品・インスタンス・要求元・種別）の
 * 既存行から引き継ぐ。導出は要求の集合だけを決め、撮る／撮らないの判断は人／エージェントが持つ。
 * 要求が消えた行は落とす（測っていない操作の撮影判断が残り続けない）。
 * @param {Record<string, unknown>} cov
 * @returns {Record<string, unknown>}
 */
export function fillVisualStateRows(cov) {
  const { rows } = deriveVisualStateRows(cov);
  const previous = isPlainObject(cov.visual_state_coverage) ? cov.visual_state_coverage : {};
  const prevByKey = previousVisualRowsByKey(previous);
  for (const row of rows) {
    const kept = prevByKey.get(visualRowKey(row));
    if (!kept) continue;
    for (const field of HUMAN_DECIDED_ROW_FIELDS) {
      if (nonEmptyString(kept[field])) row[field] = String(kept[field]);
    }
  }
  cov.visual_state_coverage = { ...previous, rows };
  return cov;
}

/**
 * 記録された撮影状態の行を、導いた集合と metadata.json の撮影条件に照らして検査する。
 *
 * --metadata を渡さない実行では capture_conditions.states との差を取れないため checked: false にする
 * （照合していない記録を「照合済み」として扱わない。parity-diff は checked: true を要求する）。
 * @param {Record<string, unknown>} cov
 * @param {{pageNames: string[], states: string[], popupStates: string[]} | null} metadata
 * @returns {{problems: string[], summary: {checked: boolean, table_fingerprint: string, capture_fingerprint: string | null, rows: number, undecided: number, missing_states: string[]}}}
 */
export function checkVisualStates(cov, metadata) {
  const { rows: derivedRows, problems } = deriveVisualStateRows(cov);
  /** @type {VisualCheckContext} */
  const vctx = {
    problems,
    recorded: recordedVisualRows(cov.visual_state_coverage, problems),
    states: metadata ? new Set(metadata.states) : null,
    popupStates: metadata ? new Set(metadata.popupStates) : null,
    pageNames: capturePageNames(metadata),
    scopeByInstance: pageScopeIndex(cov),
    missingStates: new Set(),
    capturedUses: new Map(),
    undecided: 0,
  };

  for (const derivedRow of derivedRows) checkDerivedVisualRow(derivedRow, vctx);
  checkSharedCaptures(vctx);

  for (const leftover of vctx.recorded.values()) {
    problems.push(
      `visual_state_coverage: 要求の無い行 ${String(leftover.component)} / ${String(leftover.instance)} / ${String(leftover.required_by)} / ${String(leftover.kind)} が残っている（--write で導出し直す）`,
    );
  }

  return {
    problems,
    summary: {
      checked: metadata !== null,
      // 判定側が要約を現在の入力と突き合わせられるように、照合に使った入力の指紋を残す。
      // 指紋が無いと、--write の後に表や撮影条件を書き換えても古い要約がそのまま通る。
      table_fingerprint: coverageFingerprint(cov),
      capture_fingerprint: metadata === null ? null : captureFingerprint(metadata),
      rows: derivedRows.length,
      undecided: vctx.undecided,
      missing_states: [...vctx.missingStates].sort(),
    },
  };
}

/**
 * checkVisualStates が導いた行ごとの照合で共有する状態。
 * @typedef {object} VisualCheckContext
 * @property {string[]} problems - 問題の追記先
 * @property {Map<string, Record<string, unknown>>} recorded - 記録された行。照合した行は消し、残りを要求の無い行として報告する
 * @property {Set<string> | null} states - capture_conditions.states（metadata が無ければ null）
 * @property {Set<string> | null} popupStates - popup_inventory[].captured（metadata が無ければ null）
 * @property {Set<string> | null | "unreadable"} pageNames - capture_conditions.pages の名前
 * @property {Map<string, string>} scopeByInstance - JSON 配列 [部品 id, インスタンス id] → page
 * @property {Set<string>} missingStates
 * @property {Map<string, Array<{label: string, row: Record<string, unknown>}>>} capturedUses - 撮影単位 → その状態名を使った行
 * @property {number} undecided
 */

/**
 * 記録された撮影状態の行を、キーで索引する。
 * @param {unknown} block - coverage.visual_state_coverage
 * @param {string[]} problems - 問題の追記先
 * @returns {Map<string, Record<string, unknown>>}
 */
function recordedVisualRows(block, problems) {
  /** @type {Map<string, Record<string, unknown>>} */
  const recorded = new Map();
  const recordedBlock = isPlainObject(block) ? block : null;
  if (!recordedBlock || !isArray(recordedBlock.rows)) {
    // キーの欠落を「行が無い＝要求が無い」として扱わない。導出を一度も実行していない表を通さないためである。
    problems.push(
      "visual_state_coverage.rows が無い（coverage-expand.mjs --write で撮影状態を導出する）",
    );
    return recorded;
  }
  for (const row of recordedBlock.rows) {
    if (!isPlainObject(row)) {
      problems.push("visual_state_coverage.rows に JSON オブジェクトでない行がある");
      continue;
    }
    const r = row;
    if (
      !nonEmptyString(r.component) ||
      !nonEmptyString(r.instance) ||
      !nonEmptyString(r.required_by) ||
      !nonEmptyString(r.kind)
    ) {
      problems.push(
        "visual_state_coverage: component / instance / required_by / kind が空の行がある",
      );
      continue;
    }
    const key = visualRowKey(r);
    if (recorded.has(key)) {
      problems.push(
        `visual_state_coverage: ${String(r.component)} / ${String(r.instance)} / ${String(r.required_by)} / ${String(r.kind)} の行が重複している（先勝ちにしない）`,
      );
      continue;
    }
    recorded.set(key, r);
  }
  return recorded;
}

/**
 * 撮影条件のページ名の集合を返す。metadata が無ければ null、ページ名の一覧を読めなければ "unreadable" を返す。
 * metadata を渡された以上、ページ名の集合も来ているはず（readCaptureConditions が必ず返す）。
 * 「無ければ照合しない」として扱うと、呼び出し側が pageNames を落とすだけでページ名の検査が消える。
 * @param {{pageNames: string[], states: string[], popupStates: string[]} | null} metadata
 * @returns {Set<string> | null | "unreadable"}
 */
function capturePageNames(metadata) {
  if (metadata === null) return null;
  return isArray(metadata.pageNames) ? new Set(metadata.pageNames) : "unreadable";
}

/**
 * インスタンスごとの撮影単位（page）の索引を作る。
 * 撮影の単位は ページ × 状態名 × ビューポートなので、同じページで状態名を使い回した行は
 * 同じ 1 枚を指す。行のキーを要求元まで割っても、値が同じなら 1 回の撮影で複数の操作が満たされ、
 * 撮られなかった側の差は「差 0 件」に戻る（キーの粒度と同じ故障が値の側に残る）。
 * ページはこの撮影単位を決めるキーなので、欠けていたら狭いスコープとして扱わず落とす。
 * 狭いスコープとして扱うと、同じページに載る別部品どうしが根拠なく状態名を使い回しても通る。
 * 落とすのは撮影状態を要求する行を持つインスタンスだけ（要求が無ければ撮影単位も無い）。
 * @param {Record<string, unknown>} cov
 * @returns {Map<string, string>}
 */
function pageScopeIndex(cov) {
  /** @type {Map<string, string>} */
  const scopeByInstance = new Map();
  for (const component of isArray(cov.components) ? cov.components : []) {
    if (!isPlainObject(component)) continue;
    const c = component;
    if (!nonEmptyString(c.id)) continue;
    addInstancePageScopes(c, scopeByInstance);
  }
  return scopeByInstance;
}

/**
 * 部品 1 件のインスタンスのページを索引へ足す（pageScopeIndex の部品ごとの処理）。
 * @param {Record<string, unknown>} c - 部品（id は空でない）
 * @param {Map<string, string>} scopeByInstance - 索引の追記先
 */
function addInstancePageScopes(c, scopeByInstance) {
  for (const instance of isArray(c.instances) ? c.instances : []) {
    if (!isPlainObject(instance)) continue;
    const inst = instance;
    if (!nonEmptyString(inst.id)) continue;
    const key = JSON.stringify([String(c.id), String(inst.id)]);
    if (scopeByInstance.has(key)) continue;
    if (nonEmptyString(inst.page)) scopeByInstance.set(key, String(inst.page));
  }
}

/**
 * 導いた行 1 件を、記録された行と照合する。
 * @param {Record<string, unknown>} derivedRow
 * @param {VisualCheckContext} vctx
 */
function checkDerivedVisualRow(derivedRow, vctx) {
  const { problems } = vctx;
  const label = `${String(derivedRow.component)} / ${String(derivedRow.instance)} / ${String(derivedRow.required_by)} / ${String(derivedRow.kind)}`;
  const key = visualRowKey(derivedRow);
  const row = vctx.recorded.get(key);
  if (!row) {
    vctx.undecided += 1;
    problems.push(
      `撮影状態が導出から外れている: ${label}（coverage-expand.mjs --write で行を起こす）`,
    );
    return;
  }
  vctx.recorded.delete(key);
  const captured = nonEmptyString(row.captured) ? String(row.captured) : null;
  const reason = nonEmptyString(row.reason) ? String(row.reason) : null;
  if (captured && reason) {
    problems.push(
      `撮影状態 ${label}: captured と reason が両方埋まっている（撮る・撮らないが同時に成立する）`,
    );
    return;
  }
  if (!captured && !reason) {
    vctx.undecided += 1;
    problems.push(
      `撮影状態が未決: ${label}（撮るなら capture_conditions.states の状態名を captured に、撮れないなら reason に理由を書いて gaps.md の「撮影状態の対象外」へ残す）`,
    );
    return;
  }
  if (!captured) return;
  const page = capturePage(derivedRow, label, vctx);
  if (page === null) return;
  const useKey = JSON.stringify([`page:${page}`, captured]);
  const uses = vctx.capturedUses.get(useKey) ?? [];
  uses.push({ label, row });
  vctx.capturedUses.set(useKey, uses);
  checkCapturedStateName(captured, { label, kind: derivedRow.kind }, vctx);
}

/**
 * 撮る行のインスタンスの page を、撮影条件のページ名と照合して返す。照合できなければ未決に数えて null を返す。
 * @param {Record<string, unknown>} derivedRow
 * @param {string} label - エラーメッセージ用の行のラベル
 * @param {VisualCheckContext} vctx
 * @returns {string|null}
 */
function capturePage(derivedRow, label, vctx) {
  const page = vctx.scopeByInstance.get(
    JSON.stringify([String(derivedRow.component), String(derivedRow.instance)]),
  );
  if (page === undefined) {
    return rejectCapture(
      `撮影状態 ${label}: インスタンス ${String(derivedRow.instance)} に page が無い（page が撮影単位を決めるキーなので、欠けたまま使い回しを判定できない。instances[].page を書く）`,
      vctx,
    );
  }
  // ページ名が非空なだけでは足りない。採取は metadata の capture_conditions.pages を外側のループにして
  // 回るので、宣言に無いページ名（誤記・旧称）を書いた行はどのページでも撮られない。
  // 誤記は使い回しの判定単位も割るため、共有すべきスコープが警告なしに分かれる。
  if (vctx.pageNames === "unreadable") {
    return rejectCapture(
      `撮影状態 ${label}: 撮影条件のページ名一覧を読めないので page「${page}」が宣言されているか照合できない（capture_conditions.pages を渡す）`,
      vctx,
    );
  }
  if (vctx.pageNames && !vctx.pageNames.has(page)) {
    return rejectCapture(
      `撮影状態 ${label}: インスタンス ${String(derivedRow.instance)} の page「${page}」が metadata.json の capture_conditions.pages に無い（そのページは採取されないので撮られない。ページ名を合わせる）`,
      vctx,
    );
  }
  return page;
}

/**
 * 撮る行を照合できないものとして未決に数え、問題を残して null を返す。
 * @param {string} problem
 * @param {VisualCheckContext} vctx
 * @returns {null}
 */
function rejectCapture(problem, vctx) {
  vctx.undecided += 1;
  vctx.problems.push(problem);
  return null;
}

/**
 * captured の状態名が撮影条件に在るかを照合する（metadata が無ければ照合しない）。
 * @param {string} captured - 行の captured
 * @param {{label: string, kind: unknown}} row - 行のラベルと種別
 * @param {VisualCheckContext} vctx
 */
function checkCapturedStateName(captured, row, vctx) {
  const { states, popupStates } = vctx;
  if (!states) return;
  if (!states.has(captured)) {
    vctx.missingStates.add(captured);
    vctx.problems.push(
      `撮影状態 ${row.label}: captured の ${captured} が metadata.json の capture_conditions.states に無い`,
    );
    return;
  }
  // コンテナを開く状態は popup_inventory にも行が要る。states にあるだけでは、
  // 開く操作・親子・撮る判断が棚卸しされていないまま状態名だけが立つ。
  if (row.kind === "opens-container" && popupStates && !popupStates.has(captured)) {
    vctx.missingStates.add(captured);
    vctx.problems.push(
      `撮影状態 ${row.label}: captured の ${captured} が capture_conditions.popup_inventory[].captured に無い（コンテナの棚卸しに行を足す）`,
    );
  }
}

/**
 * 同じ撮影単位で状態名を共有する行は、共有してよい根拠が全行に要る。
 * 根拠の欄を置くのは、不合格にした後に進む先を残すためである（本当に同じコンテナを開く 2 操作がありうる）。
 * 根拠なしの共有は、1 枚で複数の操作を満たした状態と区別が付かないので落とす。
 * @param {VisualCheckContext} vctx
 */
function checkSharedCaptures(vctx) {
  for (const uses of vctx.capturedUses.values()) {
    if (uses.length < 2) continue;
    const missingReason = uses.filter((u) => !nonEmptyString(u.row.shared_capture_reason));
    if (missingReason.length === 0) continue;
    vctx.undecided += missingReason.length;
    vctx.problems.push(
      `撮影状態の使い回し: ${uses.map((u) => u.label).join(" / ")} が同じ状態名 ${String(uses[0].row.captured)} を指している` +
        `（同じ撮影単位では 1 枚が複数の操作を満たしてしまう。別の状態名にするか、同じコンテナを開く操作であることを全行の shared_capture_reason に書く。` +
        `根拠が空: ${missingReason.map((u) => u.label).join(" / ")}）`,
    );
  }
}

/**
 * プロファイルを宣言した部品の items[].visual_states を candidate_rules から書き戻す。
 * 撮影状態の種別は操作の性質なので、部品ごとに手で書かずプロファイルを原本にする。
 * @param {Record<string, unknown>} coverage
 * @param {Map<string, Record<string, unknown>>} profiles
 * @returns {Record<string, unknown>}
 */
export function fillVisualStates(coverage, profiles) {
  for (const { c, profile } of profiledComponents(coverage, profiles)) {
    applyRuleVisualStates(c, ruleVisualStates(profile));
  }
  return coverage;
}

/**
 * 網羅表の部品のうち、宣言したプロファイルを読めたものと、そのプロファイルの組を、部品の順に返す。
 * 部品でない要素・プロファイルを宣言しない部品・読めないプロファイルを名乗る部品は含めない。
 * @param {Record<string, unknown>} coverage
 * @param {Map<string, Record<string, unknown>>} profiles
 * @returns {{c: Record<string, unknown>, profile: Record<string, unknown>}[]}
 */
function profiledComponents(coverage, profiles) {
  /** @type {{c: Record<string, unknown>, profile: Record<string, unknown>}[]} */
  const out = [];
  const components = isArray(coverage.components) ? coverage.components : [];
  for (const component of components) {
    if (!isPlainObject(component)) continue;
    const c = component;
    if (!nonEmptyString(c.profile)) continue;
    const profile = profiles.get(String(c.profile));
    if (!profile) continue;
    out.push({ c, profile });
  }
  return out;
}

/**
 * プロファイルの candidate_rules から、ルール id → 撮影状態の種別と理由の索引を作る。
 * @param {Record<string, unknown>} profile
 * @returns {Map<string, {kinds: string[], reason: string | null}>}
 */
function ruleVisualStates(profile) {
  /** @type {Map<string, {kinds: string[], reason: string | null}>} */
  const byRule = new Map();
  for (const rule of isArray(profile.candidate_rules) ? profile.candidate_rules : []) {
    if (!isPlainObject(rule)) continue;
    const r = rule;
    if (!nonEmptyString(r.id) || !isArray(r.visual_states)) continue;
    byRule.set(String(r.id), {
      kinds: r.visual_states.map(String),
      reason: nonEmptyString(r.no_visual_state_reason) ? String(r.no_visual_state_reason) : null,
    });
  }
  return byRule;
}

/**
 * 部品 1 件の items[] へ、名乗ったルールの撮影状態を書き戻す（fillVisualStates の部品ごとの処理）。
 * @param {Record<string, unknown>} c - 部品
 * @param {Map<string, {kinds: string[], reason: string | null}>} byRule - ruleVisualStates の索引
 */
function applyRuleVisualStates(c, byRule) {
  for (const item of isArray(c.items) ? c.items : []) {
    if (!isPlainObject(item)) continue;
    const it = item;
    const candidate = isPlainObject(it.candidate) ? it.candidate : null;
    // ルールを名乗らない項目は推測で埋めない（id の前半からの推測は、別ルールの状態を取り込みうる）。
    // 対応付けの欠落は reconcile が候補との突き合わせで落とす。
    if (!candidate || !nonEmptyString(candidate.rule)) continue;
    const declared = byRule.get(String(candidate.rule));
    if (!declared) continue;
    it.visual_states = [...declared.kinds];
    it.no_visual_state_reason = declared.reason;
  }
}

/**
 * 網羅表へ展開結果（instances[].candidates と profile_version）を書き戻す。
 * 測定値（cells の value / evidence / covered_by）には触れない。
 * 照合の前に呼ぶ。記録された候補が古い／無いことを理由にした問題を、書き戻しで先に解消してから
 * 残る欠落だけを報告するためである（書き戻しても直らない欠落だけが問題として残る）。
 * @param {Record<string, unknown>} coverage
 * @param {Map<string, Record<string, unknown>>} profiles
 * @returns {Record<string, unknown>}
 */
export function fillCandidates(coverage, profiles) {
  for (const { c, profile } of profiledComponents(coverage, profiles)) {
    c.profile_version = String(profile.version);
    fillInstanceCandidates(c, profile);
  }
  return coverage;
}

/**
 * 部品 1 件の instances[].candidates を展開結果で書き戻す（fillCandidates の部品ごとの処理）。
 * @param {Record<string, unknown>} c - 部品
 * @param {Record<string, unknown>} profile - 部品が宣言したプロファイル
 */
function fillInstanceCandidates(c, profile) {
  const instances = isArray(c.instances) ? c.instances : [];
  for (const instance of instances) {
    if (!isPlainObject(instance)) continue;
    const inst = instance;
    const label = `部品 ${String(c.id)} / インスタンス ${String(inst.id)}`;
    const { elements, usable } = readEnumeration(inst.enumeration, profile, label);
    inst.candidates = usable ? expandCandidates(profile, elements).map((cand) => cand.id) : [];
  }
}

/**
 * 照合結果を conformance として網羅表へ記録する。parity-diff はプロファイルを読まないため、
 * ここに残った ok が「展開ルールまで含めて適合したか」の唯一の記録になる。
 * @param {Record<string, unknown>} coverage
 * @param {{ok: boolean, problems: string[], candidates: number, unmeasured: number, visualStates: {checked: boolean, table_fingerprint?: string, capture_fingerprint?: string | null, rows: number, undecided: number, missing_states: string[]}}} result
 * @returns {Record<string, unknown>}
 */
export function recordConformance(coverage, result) {
  coverage.conformance = {
    tool: "coverage-expand",
    tool_version: VERSION,
    ok: result.ok,
    candidates: result.candidates,
    unmeasured: result.unmeasured,
    visual_states: result.visualStates,
    problems: result.problems,
  };
  return coverage;
}

/**
 * 行の配列から、オブジェクトの行の指定したフィールドのうち空でない値を順に集める。
 * @param {unknown[]} rows
 * @param {string} field
 * @returns {string[]}
 */
function nonEmptyFieldValues(rows, field) {
  /** @type {string[]} */
  const values = [];
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const r = row;
    if (nonEmptyString(r[field])) values.push(String(r[field]));
  }
  return values;
}

/**
 * metadata.json から撮影条件（撮影状態とコンテナの棚卸し）と slug を読む。
 *
 * slug を返すのは、渡された metadata が同じ機能のものかを呼び出し側で照合するため。
 * 照合しないと別機能の metadata で checked: true を記録でき、状態名が汎用（hover 等）だと
 * 突き合わせも通る。parity-diff はこの conformance を信頼して比較をやり直さないので、
 * 記録側で弾かないと誤った収束まで通る。
 * @param {unknown} parsed
 * @returns {{slug: string, pageNames: string[], states: string[], popupStates: string[]} | null} - 形が違えば null（読めたことにしない）
 */
export function readCaptureConditions(parsed) {
  if (!isPlainObject(parsed)) return null;
  const meta = parsed;
  // slug の欠落は「照合しない」として扱わない（照合できない metadata を通すと、上の抜けがそのまま残る）。
  if (!nonEmptyString(meta.slug)) return null;
  if (!isPlainObject(meta.capture_conditions)) return null;
  const cc = meta.capture_conditions;
  if (!isArray(cc.states)) return null;
  // pages は撮影の外側のループ（parity-diff の採取スペックは pages × states × viewports で回す）。
  // 宣言されたページ名の集合を返さないと、網羅表の instances[].page が実在するかを照合できない。
  if (!isArray(cc.pages)) return null;
  // popup_inventory はキーの欠落と空配列を区別する（欠落は棚卸し未実施＝照合できない）。
  if (!isArray(cc.popup_inventory)) return null;
  const popupStates = nonEmptyFieldValues(cc.popup_inventory, "captured");
  const pageNames = nonEmptyFieldValues(cc.pages, "name");
  return {
    slug: String(meta.slug),
    pageNames,
    states: cc.states.filter(nonEmptyString).map(String),
    popupStates,
  };
}

/**
 * CLI 本体。
 *
 * `node coverage-expand.mjs --coverage <component-coverage.json> [--metadata <metadata.json>] [--profiles <dir>] [--write]`
 *
 * `node coverage-expand.mjs --list-profiles [--profiles <dir>]`
 *
 * 終了コード: 0 ＝ 適合／1 ＝ 欠落・未測定・不整合が残る／2 ＝ 使い方の誤り・読み込み失敗。
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{readFile?: (p: string) => string, readdir?: (d: string) => string[], writeFile?: (p: string, s: string) => void, defaultProfilesDir?: string}} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const writeFile = deps.writeFile ?? ((p, s) => writeFileSync(p, s));
  const args = parseArgs(argv);
  if (typeof args === "number") return args;
  const { opts, write, list } = args;

  const profilesDir =
    opts.profiles ??
    deps.defaultProfilesDir ??
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets", "coverage-profiles");
  const profiles = loadProfilesForCli(profilesDir, { readFile, readdir: deps.readdir });
  if (profiles === null) return 2;

  if (list) {
    printProfileList(profiles, profilesDir);
    return 0;
  }

  const read = readCoverageArg(opts.coverage, readFile, write);
  if (read === null) return 2;
  const coverage = read.value;
  const metadata = readMetadataArg(opts, coverage, readFile);
  if (metadata === null) return 2;

  // 書き戻しは照合の前に行う。候補の記録忘れを書き戻しで埋めたうえで、
  // 埋めても直らない欠落（項目・セルが無い、証拠が無い）だけを問題として残す。
  if (write && isPlainObject(coverage)) {
    fillCandidates(coverage, profiles);
    // 項目の状態種別をプロファイルから埋めてから行を導く（埋める前に導くと未宣言として落ちる）。
    fillVisualStates(coverage, profiles);
    fillVisualStateRows(coverage);
  }
  const result = reconcile(coverage, profiles, metadata.value);
  if (write && isPlainObject(coverage)) {
    recordConformance(coverage, result);
    try {
      writeFile(opts.coverage, `${JSON.stringify(coverage, null, 2)}\n`);
    } catch (e) {
      process.stderr.write(`error: 網羅表を書き戻せない: ${opts.coverage}: ${String(e)}\n`);
      return 2;
    }
  }

  printResult(result, { profilesDir, source: opts.coverage, write });
  return result.ok ? 0 : 1;
}

/**
 * --coverage の網羅表を読む。読めないか、書き戻すのに JSON オブジェクトでなければ stderr に出して null を返す。
 * @param {string} path
 * @param {(p: string) => string} readFile
 * @param {boolean} write - --write を指定したか
 * @returns {{value: unknown} | null}
 */
function readCoverageArg(path, readFile, write) {
  /** @type {unknown} */
  let coverage;
  try {
    coverage = JSON.parse(readFile(path));
  } catch (e) {
    process.stderr.write(`error: 網羅表を読めない: ${path}: ${String(e)}\n`);
    return null;
  }
  if (write && !isPlainObject(coverage)) {
    process.stderr.write("error: 網羅表が JSON オブジェクトではないので書き戻せない\n");
    return null;
  }
  return { value: coverage };
}

const USAGE =
  "usage: node coverage-expand.mjs --coverage <component-coverage.json> [--metadata <metadata.json>] [--profiles <dir>] [--write]\n" +
  "       node coverage-expand.mjs --list-profiles [--profiles <dir>]\n";

/**
 * CLI の引数を読む。使い方の誤りなら stderr に出して終了コード 2 を返す。
 * 同じフラグの重複指定は、警告なしに後勝ちにすると、どちらを読んだか出力から分からなくなるので、parseFlags が止める。
 * @param {string[]} argv
 * @returns {number | {opts: Record<string, string>, write: boolean, list: boolean}}
 */
function parseArgs(argv) {
  const parsed = parseFlags(argv, {
    values: ["--coverage", "--profiles", "--metadata"],
    bools: ["--write", "--list-profiles"],
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`error: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const opts = stripDashes(parsed.strings);
  const write = parsed.bools["--write"] === true;
  const list = parsed.bools["--list-profiles"] === true;
  if (!list && !opts.coverage) {
    process.stderr.write(USAGE);
    return 2;
  }
  return { opts, write, list };
}

/**
 * 同梱プロファイルを読み込む。問題があるか 1 件も読めなければ stderr に出して null を返す。
 * @param {string} profilesDir
 * @param {{readFile: (p: string) => string, readdir?: (d: string) => string[]}} deps
 * @returns {Map<string, Record<string, unknown>> | null}
 */
function loadProfilesForCli(profilesDir, deps) {
  const { profiles, problems: loadProblems } = loadProfiles(profilesDir, deps);
  for (const p of loadProblems) process.stderr.write(`error: プロファイル: ${p}\n`);
  if (loadProblems.length > 0) return null;
  if (profiles.size === 0) {
    // 0 件を「照合するものが無い」として通さない（同梱の取りこぼしを合格として扱わない）。
    process.stderr.write(`error: プロファイルが 1 件も読み込めなかった: ${profilesDir}\n`);
    return null;
  }
  return profiles;
}

/**
 * --list-profiles の結果を stdout に出す。
 * @param {Map<string, Record<string, unknown>>} profiles
 * @param {string} profilesDir
 */
function printProfileList(profiles, profilesDir) {
  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "coverage-expand",
        version: VERSION,
        profiles_dir: profilesDir,
        profiles: [...profiles.values()].map((p) => ({
          id: String(p.id),
          version: String(p.version),
          name: typeof p.name === "string" || typeof p.name === "number" ? String(p.name) : "",
          applies_to:
            typeof p.applies_to === "string" || typeof p.applies_to === "number"
              ? String(p.applies_to)
              : "",
        })),
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * --metadata の撮影条件を読む。渡されていなければ value: null を返す。読めないか網羅表と食い違えば stderr に出して null を返す。
 * @param {Record<string, string>} opts
 * @param {unknown} coverage
 * @param {(p: string) => string} readFile
 * @returns {{value: {slug: string, pageNames: string[], states: string[], popupStates: string[]} | null} | null}
 */
function readMetadataArg(opts, coverage, readFile) {
  if (opts.metadata === undefined) return { value: null };
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(readFile(opts.metadata));
  } catch (e) {
    process.stderr.write(`error: metadata を読めない: ${opts.metadata}: ${String(e)}\n`);
    return null;
  }
  const metadata = readCaptureConditions(parsed);
  if (metadata === null) {
    // 渡されたのに読めない metadata は「照合しない」として扱わない（警告なしに checked: false にすると、
    // 撮影状態の差を見ていない成果物が通ってしまう）。
    process.stderr.write(
      `error: metadata に slug、または capture_conditions.states / capture_conditions.popup_inventory が配列で無い: ${opts.metadata}\n`,
    );
    return null;
  }
  const slugProblem = metadataSlugProblem(metadata, coverage, opts);
  if (slugProblem !== null) {
    process.stderr.write(slugProblem);
    return null;
  }
  return { value: metadata };
}

/**
 * metadata が網羅表と同じ機能のものかを slug で照合する。食い違えば stderr に出す文を返す。
 * 別機能の metadata を警告なしに受理しない。状態名が汎用なら突き合わせも通ってしまい、
 * parity-diff はこの conformance を信頼して比較をやり直さない。
 * @param {{slug: string}} metadata
 * @param {unknown} coverage
 * @param {Record<string, string>} opts
 * @returns {string|null}
 */
function metadataSlugProblem(metadata, coverage, opts) {
  if (!isPlainObject(coverage)) return null;
  const coverageSlug = coverage.slug;
  if (!nonEmptyString(coverageSlug)) {
    return `error: 網羅表に slug が無いので metadata と同じ機能か照合できない: ${opts.coverage}\n`;
  }
  if (String(coverageSlug) !== metadata.slug) {
    return `error: metadata の slug（${metadata.slug}）が網羅表の slug（${String(coverageSlug)}）と違う: ${opts.metadata}\n`;
  }
  return null;
}

/**
 * 照合の結果を stdout に出し、残った問題を stderr に出す。
 * @param {ReturnType<typeof reconcile>} result
 * @param {{profilesDir: string, source: string, write: boolean}} run
 */
function printResult(result, run) {
  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "coverage-expand",
        version: VERSION,
        profiles_dir: run.profilesDir,
        source: run.source,
        written: run.write,
        ok: result.ok,
        candidates: result.candidates,
        unmeasured: result.unmeasured,
        visual_states: result.visualStates,
        components: result.components,
        problems: result.problems,
      },
      null,
      2,
    )}\n`,
  );
  for (const p of result.problems) process.stderr.write(`warn: ${p}\n`);
  if (result.unmeasured > 0) {
    process.stderr.write(
      `error: 候補由来の未測定 ${result.unmeasured} 件 / 候補 ${result.candidates} 件 — 収束させず測定へ戻す\n`,
    );
  }
  if (result.problems.length > 0) {
    process.stderr.write(
      `error: 照合の問題 ${result.problems.length} 件（プロファイル適合・撮影状態の導出。上の warn を参照）\n`,
    );
  }
  printVisualStateSummary(result.visualStates);
}

/**
 * 撮影状態の未決と、照合していないことを stderr に出す。
 * @param {{checked: boolean, undecided: number, missing_states: string[]}} visualStates
 */
function printVisualStateSummary(visualStates) {
  if (visualStates.undecided > 0 || visualStates.missing_states.length > 0) {
    process.stderr.write(
      `error: 撮影状態の未決 ${visualStates.undecided} 件 / 撮影条件に無い状態名 ${visualStates.missing_states.length} 件` +
        `${visualStates.missing_states.length > 0 ? `（${visualStates.missing_states.join(", ")}）` : ""} — 撮る前に決める（後から足すと現側も採り直しになる）\n`,
    );
  }
  if (!visualStates.checked) {
    process.stderr.write(
      "warn: --metadata が無いため撮影状態を capture_conditions.states と照合していない（conformance.visual_states.checked: false のままでは parity-diff が収束させない）\n",
    );
  }
}

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
