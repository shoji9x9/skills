// 部品被覆表（component-coverage.json）の未測定を数え直して収束条件を判定する（正本）。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新を効かせるため）。
//
// 何をするか: 現側 metadata.json の component_coverage 宣言を読み、declared: true のときだけ
// 被覆表を開いて 機能表の項目 × 部品インスタンス の期待セルを列挙し、未測定を数える。
// 宣言された件数は参照せず必ず数え直す（宣言値を信用すると、被覆表を直さずに件数だけ 0 と書けてしまう）。
//
// 何をしないか: 被覆表の作成（parity-suite の仕事）・差分の検出や分類（diff-normalize / triage の仕事）は行わない。
//
// 後方互換: component_coverage を持たない旧成果物と declared: false は判定に入れない（judged: false）。
// ただし黙って合格にしない——判定しなかった理由を出力に残し、利用側は diff-metadata.json の
// component_coverage と diff.md の未検証領域へ転記する。
//
// 被覆プロファイル: components[].profile を宣言した部品では、期待セルを「項目 × インスタンス」ではなく
// インスタンスごとに記録された候補（instances[].candidates）で数える。
// 列挙要素の突き合わせは items[].candidate.axes による**軸ごと**の照合で行う（軸をまたいだ和集合は
// 別軸の同名値で fail-open する）。「その要素はどの候補にもならない」は enumeration.justified_absences の
// 根拠付きでだけ通す（根拠を読む経路が無いと fail-closed が行き止まりになる）。プロファイル自体は parity-suite の
// 同梱物なのでここでは読まず、被覆表に記録された列挙・候補・適合結果（conformance）から数え直す
// （展開ルールの解釈は parity-suite の coverage-expand.mjs が authoring 時に検査する）。
// 「40 列を列挙したが候補は代表 1 列だけ」は、列挙要素が候補に現れないことで落とす。
//
// fail-closed: 未測定は「value: unmeasured」だけではない。行が無い組み合わせ・evidence の空・
// present なのに covered_by が空・同じ組み合わせの重複行も未測定として数える
// （「測っていない」と「測ったが証拠が無い」を同じ空欄で通さない。重複は黙って先勝ちにしない）。
// 列挙側（部品・項目・インスタンス）の id が空／重複している場合も同じ——空 id は全要素が同じキーへ
// 潰れて 1 行で全セルを満たせてしまい、重複 id は期待セルを二重に数えるため、展開に使わず未測定として数える。
// declared: true なのに被覆表が読めない場合も合格に倒さない。
//
// 決定論的: 乱数・現在時刻に依存しない。入力順を保って数える。
// TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定ロジック・出力形状を変えたら上げる。
 * diff-metadata.json の differ_versions.coverage_check に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "15";

// 撮影状態の要約を信頼してよい生成側（parity-suite の coverage-expand.mjs）の最低バージョン。
//
// **なぜ 16 か**: 16 で導出の意味論が変わった——要求元をルール id でまとめるのをやめ、候補 id 単位にし、
// 縮約は宣言・検証済みの同値クラス経由だけにした。15 以前は 1 ルールが展開する複数候補が 1 行へ潰れ、
// 縮約してはいけない軸（datagrid の sort-direction 等）まで畳んでいた。
// 指紋（table / capture）は「その表を忠実に写したか」しか言わないので、壊れた意味論で作られた要約も
// 指紋は一致する。版を見ないと、スキルを上げても既知の欠陥を持つ要約が収束を通り続ける。
//
// **導出の意味論を変えたらここを上げる。** 上げ忘れると、古い規則で作られた成果物が黙って通る。
// 姉妹の reaction-check.mjs は記録側・判定側が同一スクリプトなので完全一致を要求できるが、
// こちらは coverage-expand と coverage-check が別スクリプトで版も独立なので下限で見る。
export const MIN_COVERAGE_EXPAND_VERSION = 16;
const COVERAGE_EXPAND_TOOL = "coverage-expand";

/** 被覆表のセルが取りうる値。 */
const VALUES = ["present", "absent", "unmeasured"];

/** 候補 id と同値クラスの members の区切り（正本は parity-suite の coverage-profiles.md）。 */
const ID_SEPARATOR = "/";

/**
 * 空でない文字列か。
 * @param {unknown} v
 * @returns {boolean}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

// ===== absence-evidence-contract:start =====
// ここから contract:end までは、記録側（parity-suite の coverage-expand.mjs）と
// 収束判定側（parity-diff の coverage-check.mjs）でバイト単位に同一へ保つ。
// 配布スキルは実行時に参照する成果物を自分で同梱する規約のため共有モジュールにできず実体が複製される。
// 片方だけ直すと「記録側は通すが収束側が弾く」（またはその逆）が起きるため、
// リポジトリの scripts/absence-evidence-contract-sync.test.js がこのマーカー間の一致を検査する。

/**
 * `instances[].applicable_states.source.kind` の語彙。
 * 正本は parity-suite の `assets/component-coverage-template.json`。空でないだけを通すと
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
 * 操作可能な要素へ発火を確認した absent（`kind: fired-without-response`）の証拠を検査する。
 * 散文 `evidence` の非空だけでは「送り方・発火確認・観測結果」の 3 点を測ったかを区別できず、
 * 0 寸法要素の中心座標で**重なった別要素**が発火した結果も同じ経路で通ってしまう。
 * @param {Record<string, unknown>} evidence
 * @param {string} label
 * @returns {string|null}
 */
function firedEvidenceProblem(evidence, label) {
  if (!isPlainObject(evidence.action)) {
    return `${label}: fired-without-response なのに action が JSON オブジェクトではない`;
  }
  const action = /** @type {Record<string, unknown>} */ (evidence.action);
  if (!nonEmptyString(action.locator) || !nonEmptyString(action.detail)) {
    return `${label}: fired-without-response の action.locator / action.detail が空`;
  }
  if (!inAllowlist(action.method, FIRED_ACTION_METHODS)) {
    return `${label}: fired-without-response の action.method が ${FIRED_ACTION_METHODS.join(" / ")} のいずれでもない`;
  }
  // この経路の前提は「操作可能な可視要素へ送った」こと。どちらの method でも正の矩形と可視性を実測させる。
  // force / dispatchEvent のように actionability を迂回する送り方は、可視要素への操作の証拠にならない。
  if (!isPlainObject(action.bounding_box)) {
    return `${label}: fired-without-response なのに action.bounding_box が JSON オブジェクトではない`;
  }
  const box = /** @type {Record<string, unknown>} */ (action.bounding_box);
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
  if (!isPlainObject(evidence.fired)) {
    return `${label}: fired-without-response なのに fired が JSON オブジェクトではない`;
  }
  const fired = /** @type {Record<string, unknown>} */ (evidence.fired);
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
 * absent セルの経路別証拠を検査する。散文 evidence の非空だけでは、全状態を測ったという
 * 自己申告と実測の構造を区別できないため、非描画経路は状態ごとの証拠を必須にする。
 * @param {Record<string, unknown>} row
 * @param {string} label
 * @param {unknown} stateManifest - components[].instances[].applicable_states
 * @returns {string|null}
 */
function absentEvidenceProblem(row, label, stateManifest) {
  if (!isPlainObject(row.absence_evidence)) {
    return `${label}: value: absent なのに absence_evidence が JSON オブジェクトではない`;
  }
  const evidence = /** @type {Record<string, unknown>} */ (row.absence_evidence);
  if (evidence.kind === "fired-without-response") return firedEvidenceProblem(evidence, label);
  if (evidence.kind !== "non-renderable") {
    return `${label}: absence_evidence.kind が fired-without-response / non-renderable のいずれでもない`;
  }
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
  if (!isPlainObject(stateManifest)) {
    return `${label}: non-renderable なのにインスタンスの applicable_states が無い`;
  }
  const manifest = /** @type {Record<string, unknown>} */ (stateManifest);
  const source = isPlainObject(manifest.source)
    ? /** @type {Record<string, unknown>} */ (manifest.source)
    : null;
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
  if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
    return `${label}: applicable_states.items が空`;
  }
  /** @type {Map<string, string>} */
  const manifestStates = new Map();
  for (const [index, rawItem] of manifest.items.entries()) {
    if (!isPlainObject(rawItem)) return `${label}: applicable_states.items[${index}] が不正`;
    const item = /** @type {Record<string, unknown>} */ (rawItem);
    if (!nonEmptyString(item.id) || !nonEmptyString(item.transition)) {
      return `${label}: applicable_states.items[${index}] の id / transition が空`;
    }
    const id = String(item.id);
    if (manifestStates.has(id)) return `${label}: applicable_states.items の id ${id} が重複`;
    manifestStates.set(id, String(item.transition));
  }
  if (!Array.isArray(evidence.states) || evidence.states.length === 0) {
    return `${label}: non-renderable の states が空`;
  }
  if (
    !Array.isArray(evidence.expected_states) ||
    evidence.expected_states.length === 0 ||
    evidence.expected_states.some((name) => !nonEmptyString(name))
  ) {
    return `${label}: non-renderable の expected_states が空または不正`;
  }
  const expectedStates = evidence.expected_states.map(String);
  if (new Set(expectedStates).size !== expectedStates.length) {
    return `${label}: non-renderable の expected_states が重複している`;
  }
  /** @type {Set<string>} */
  const measuredStates = new Set();
  // locator が 0 件だった状態数。全状態が 0 件なら locator の正しさを実証できていない。
  let domAbsentStates = 0;
  for (const [index, rawState] of evidence.states.entries()) {
    const stateLabel = `${label}: non-renderable.states[${index}]`;
    if (!isPlainObject(rawState)) return `${stateLabel} が JSON オブジェクトではない`;
    const state = /** @type {Record<string, unknown>} */ (rawState);
    if (!nonEmptyString(state.name) || !nonEmptyString(state.transition)) {
      return `${stateLabel} の name / transition が空`;
    }
    const stateName = String(state.name);
    if (measuredStates.has(stateName)) return `${stateLabel}.name ${stateName} が重複している`;
    measuredStates.add(stateName);
    if (manifestStates.get(stateName) !== String(state.transition)) {
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
      domAbsentStates += 1;
      continue;
    }
    if (!("bounding_box" in state) || !("offset_parent" in state)) {
      return `${stateLabel} に bounding_box / offset_parent が無い`;
    }
    if (state.offset_parent !== null && !nonEmptyString(state.offset_parent)) {
      return `${stateLabel}.offset_parent が null または空でない文字列ではない`;
    }
    let zeroArea = false;
    if (state.bounding_box !== null) {
      if (!isPlainObject(state.bounding_box)) {
        return `${stateLabel}.bounding_box が null または JSON オブジェクトではない`;
      }
      const box = /** @type {Record<string, unknown>} */ (state.bounding_box);
      if (![box.x, box.y, box.width, box.height].every((v) => Number.isFinite(v))) {
        return `${stateLabel}.bounding_box の x / y / width / height が有限の数値ではない`;
      }
      // Playwright の矩形に負の幅・高さは無い。負値を通すと、実在しない矩形で 0 寸法判定を迂回できる。
      if (Number(box.width) < 0 || Number(box.height) < 0) {
        return `${stateLabel}.bounding_box の width / height が負（実在しない矩形）`;
      }
      zeroArea = box.width === 0 || box.height === 0;
    }
    let hiddenCause = false;
    if (state.hidden_by !== null) {
      if (!isPlainObject(state.hidden_by)) {
        return `${stateLabel}.hidden_by が null または JSON オブジェクトではない`;
      }
      const hidden = /** @type {Record<string, unknown>} */ (state.hidden_by);
      const style = isPlainObject(hidden.computed_style)
        ? /** @type {Record<string, unknown>} */ (hidden.computed_style)
        : null;
      hiddenCause =
        nonEmptyString(hidden.locator) &&
        hidden.relationship_verified === true &&
        (hidden.relation === "self" || hidden.relation === "ancestor") &&
        hidden.target_locator === evidence.locator &&
        style !== null &&
        (style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse");
      if (!hiddenCause) {
        return `${stateLabel}.hidden_by が対象本人／祖先との検証済み関係と非表示 CSS を示さない`;
      }
      // display: none の本人／祖先配下では実 DOM の offsetParent は必ず null。
      // 非 null を通すと、実測していない値の組み合わせを非描画の証拠として収束させられる。
      if (style !== null && style.display === "none" && state.offset_parent !== null) {
        return `${stateLabel}: display: none なのに offset_parent が null ではない（矛盾）`;
      }
    }
    if (hiddenCause && state.bounding_box !== null) {
      return `${stateLabel}: hidden_by があるのに bounding_box が null ではない（矛盾）`;
    }
    if (!zeroArea && !hiddenCause) {
      return `${stateLabel} に 0 寸法の矩形または非表示原因の証拠が無い`;
    }
  }
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
 * 集合の来歴（`component_inventory` / `components[].instance_inventory`）と
 * `instances[].enumeration.source` で使う情報源の kind の語彙。
 * **並びは強い順**で、先頭が一次情報源（静的に読み切れる受領ソース）。実 UI の歩行はその画面がその時
 * 描いたものしか拾えないため、弱い情報源で列挙したときは一次情報源が使えなかった理由を要求する。
 * 正本は parity-suite の `assets/component-coverage-template.json`。
 */
const SET_SOURCE_KINDS = ["current-source", "config", "app-ui"];

/**
 * `components[].source.kind`（項目集合の列挙元）の語彙。受領ソースから起こした項目集合を
 * `app-ui` へ倒さずに書けるよう `current-source` を持つ——`app-ui` に倒すと、静的に全部読んだのか
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
 * `fail_closed`（ソースを読めないときの `complete: false`）の裏側——**読めるのに読まなかった**——には
 * それまで経路が無く、いちばん弱い情報源だけで `complete: true` が通っていた。
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
  const source = isPlainObject(block.source)
    ? /** @type {Record<string, unknown>} */ (block.source)
    : null;
  // 語彙の外・source ごとの欠落は呼び出し側が報告する（ここで二重に出さない）。
  if (source === null || !inAllowlist(source.kind, SET_SOURCE_KINDS)) return problems;
  const primary = SET_SOURCE_KINDS[0];
  const reason = block.stronger_source_unavailable_reason;
  if (source.kind === primary) {
    // 効いていない免除は失敗させる。一次情報源で列挙したのに理由が残っていると、
    // 後から読む側はその集合を弱い情報源から起こしたものと誤読する。
    if (reason !== null && reason !== undefined) {
      problems.push(
        `${label}: ${primary} で列挙したのに stronger_source_unavailable_reason が書かれている（効いていない免除。使ったなら null にする）`,
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
 * 集合の来歴＋完全性のブロックを検査する（部品の集合とインスタンスの集合で同じ形を使う）。
 * 列挙しなかった部品・インスタンスは期待セルにも現れないため、宣言が無いと「測り漏れ」と
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
  const block = /** @type {Record<string, unknown>} */ (raw);
  const source = isPlainObject(block.source)
    ? /** @type {Record<string, unknown>} */ (block.source)
    : null;
  if (source === null) {
    problems.push(`${label}.source が無い（どの版のどこから何を条件に列挙したか残らない）`);
  } else {
    for (const key of ["kind", "ref", "version", "condition"]) {
      if (!nonEmptyString(source[key])) problems.push(`${label}.source.${key} が空`);
    }
    if (!inAllowlist(source.kind, SET_SOURCE_KINDS)) {
      problems.push(
        `${label}.source.kind（${showKind(source.kind)}）が ${SET_SOURCE_KINDS.join(" / ")} のいずれでもない`,
      );
    }
    problems.push(...strongerSourceProblems(block, label));
  }
  // complete: false は「列挙元を読み切れなかった」の記録。未列挙として扱い、確認済みにしない。
  // 真偽値でないときも合格に倒さない（未設定を「完全」と読まない）。
  if (block.complete !== true) {
    if (block.complete === false) {
      if (!nonEmptyString(block.incomplete_reason)) {
        problems.push(
          `${label}: complete: false なのに incomplete_reason が空（不足と列挙手順が残らない）`,
        );
      } else {
        problems.push(
          `${label}: 列挙が未完了（${String(block.incomplete_reason)}）— 確認済みにしない`,
        );
      }
    } else {
      problems.push(`${label}.complete が true ではない（未設定を「完全」と読まない）`);
    }
  } else if (block.incomplete_reason !== null && block.incomplete_reason !== undefined) {
    // 効いていない免除は失敗させる（stronger_source_unavailable_reason と同じ扱い）。
    // complete: false から true へ直したときに理由が残ると、機械は収束させるのに
    // 成果物を読む側には「まだ読み切れていない集合」と見え、gaps.md の行も同じ文言で残り続ける。
    problems.push(
      `${label}: complete: true なのに incomplete_reason が書かれている（効いていない免除。読み切れたなら null にする）`,
    );
  }
  return problems;
}

/**
 * 項目集合の来歴（`components[].source`）を検査する。語彙の外の値・キーごとの欠落を
 * 報告しないと、来歴の欄が「書けたことが効いている証拠」にならない。
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
  const source = /** @type {Record<string, unknown>} */ (raw);
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
 * インスタンスの列挙（`instances[].enumeration`）の来歴のうち、語彙と一次情報源の申告を検査する。
 * 記録側は加えてプロファイルの `enumeration.sources` に属することも見るが、
 * 強さの判定はどちらの側も `SET_SOURCE_KINDS` で行う。
 * @param {Record<string, unknown>} en - `instances[].enumeration`
 * @param {string} label - エラーメッセージ用のラベル
 * @returns {string[]}
 */
function enumerationSourceProblems(en, label) {
  /** @type {string[]} */
  const problems = [];
  const source = isPlainObject(en.source)
    ? /** @type {Record<string, unknown>} */ (en.source)
    : null;
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

// ===== absence-evidence-contract:end =====

/**
 * metadata.json の撮影条件から、記録側と同じ形の指紋を取る。
 * 撮影条件が読めない（キー欠落・型崩れ）ときは null を返し、「照合しない」と「一致した」を区別する。
 * @param {unknown} metadata
 * @returns {string|null}
 */
export function readCaptureForFingerprint(metadata) {
  if (!isPlainObject(metadata)) return null;
  const meta = /** @type {Record<string, unknown>} */ (metadata);
  if (!isPlainObject(meta.capture_conditions)) return null;
  const cc = /** @type {Record<string, unknown>} */ (meta.capture_conditions);
  if (!Array.isArray(cc.states) || !Array.isArray(cc.pages) || !Array.isArray(cc.popup_inventory))
    return null;
  /** @type {string[]} */
  const pageNames = [];
  for (const row of cc.pages) {
    if (isPlainObject(row) && nonEmptyString(/** @type {Record<string, unknown>} */ (row).name))
      pageNames.push(String(/** @type {Record<string, unknown>} */ (row).name));
  }
  /** @type {string[]} */
  const popupStates = [];
  for (const row of cc.popup_inventory) {
    if (isPlainObject(row) && nonEmptyString(/** @type {Record<string, unknown>} */ (row).captured))
      popupStates.push(String(/** @type {Record<string, unknown>} */ (row).captured));
  }
  return captureFingerprint({
    slug: nonEmptyString(meta.slug) ? String(meta.slug) : undefined,
    pageNames,
    states: cc.states.filter(nonEmptyString).map(String),
    popupStates,
  });
}

/**
 * 現側 metadata.json の component_coverage 宣言を読む。返す状態は 3 つ:
 * judged: true（判定に入れる）／judged: false（後方互換で判定に入れない。キー欠落 = 旧成果物、declared: false）／
 * malformed: true（型崩れ。後方互換に倒さず使い方の誤りとして扱う）。
 * **型崩れを「旧成果物」に倒さない**——倒すと metadata.json が配列や壊れた形のときに judged: false → exit 0 で
 * 収束条件を素通りできる（後方互換の経路が fail-open の抜け道になる）。
 * @param {unknown} metadata
 * @returns {{judged: boolean, malformed: boolean, reason: string|null, path: string|null}}
 */
export function readDeclaration(metadata) {
  const bad = (reason) => ({ judged: false, malformed: true, reason, path: null });
  const skip = (reason) => ({ judged: false, malformed: false, reason, path: null });
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return bad("metadata.json が JSON オブジェクトではない（型崩れ）");
  }
  const decl = /** @type {Record<string, unknown>} */ (metadata).component_coverage;
  if (decl === undefined || decl === null) {
    return skip("旧成果物: metadata.json に component_coverage キーが無い（判定に入れない）");
  }
  if (typeof decl !== "object" || Array.isArray(decl)) {
    return bad("component_coverage が JSON オブジェクトではない（型崩れ）");
  }
  const d = /** @type {Record<string, unknown>} */ (decl);
  if (d.declared === false) {
    // 免除経路は理由の記録とセットでだけ成立する。理由が無い declared: false を通すと、
    // 「測らなかった事実」がどの成果物にも残らないまま収束条件を外せる（緩和経路の抜け道）。
    if (!nonEmptyString(d.reason)) {
      return bad("component_coverage.declared: false なのに reason が空（免除の根拠が残らない）");
    }
    return skip(`declared: false（${String(d.reason)}）`);
  }
  if (d.declared !== true) {
    return bad("component_coverage.declared が真偽値ではない（型崩れ）");
  }
  if (d.path !== undefined && d.path !== null && !nonEmptyString(d.path)) {
    return bad("component_coverage.path が空でない文字列ではない（型崩れ）");
  }
  return {
    judged: true,
    malformed: false,
    reason: null,
    path: nonEmptyString(d.path) ? String(d.path) : null,
  };
}

/**
 * 部品・項目・インスタンスの id 列を取り出す。空 id と重複 id は展開に使わず問題として記録する
 * （id が空だと全要素が同じキーへ潰れ、1 行で全セルを満たせてしまう。重複は期待セルを二重に数える）。
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
    const raw =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? /** @type {Record<string, unknown>} */ (entry).id
        : undefined;
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

/**
 * JSON オブジェクト（配列でない）か。配列は typeof で "object" を通るため明示的に弾く。
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/**
 * 表の指紋。conformance を除いた内容をキー順に正規化して sha256 を取る。
 * 記録側（parity-suite の coverage-expand.mjs）と判定側（parity-diff の coverage-check.mjs）で
 * 同じ値になる必要がある。両者を突き合わせる往復テストは scripts/coverage-record-judge-parity.test.js。
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
 * 撮影条件の指紋。撮影状態の照合に実際に使った入力（slug・ページ名・状態名・器の状態名）だけを取る。
 * 配列は並びで指紋が変わらないよう整列する（内容が同じなら同じ指紋にする）。
 * @param {{slug?: string, pageNames?: string[], states: string[], popupStates: string[]}} capture
 * @returns {string}
 */
export function captureFingerprint(capture) {
  const sorted = (v) => [...(Array.isArray(v) ? v : [])].map(String).sort();
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

/** @param {unknown} v @returns {unknown} */
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (isPlainObject(v)) {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonicalize(v[k])]),
    );
  }
  return v;
}

/**
 * 部品の items から 項目 id → 軸値（items[].candidate.axes）の索引を作る。
 * 列挙要素が候補に現れるかの判定は**軸ごと**に行う必要がある——候補 id を "/" で割った
 * 値の集合（軸をまたいだ和集合）で見ると、別軸に同じ値がある要素（列名 default と
 * menu-condition の default 等）が自分の軸の候補に 1 件も無くても通ってしまい、
 * 「代表だけを確認していないか」のゲートが fail-open になる。
 * 軸値の記録（candidate.axes）は被覆表テンプレートが必須にしており、
 * parity-suite の coverage-expand.mjs が展開結果との一致まで検査している。
 * 無い場合は和集合へフォールバックせず未測定に倒す（フォールバックは同じ穴を作り直す）。
 * @param {unknown} items - components[].items
 * @returns {Map<string, Record<string, string>>}
 */
function readItemAxes(items) {
  /** @type {Map<string, Record<string, string>>} */
  const byId = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!isPlainObject(item)) continue;
    const it = /** @type {Record<string, unknown>} */ (item);
    if (!nonEmptyString(it.id) || !isPlainObject(it.candidate)) continue;
    const candidate = /** @type {Record<string, unknown>} */ (it.candidate);
    if (!isPlainObject(candidate.axes)) continue;
    /** @type {Record<string, string>} */
    const axes = {};
    for (const [axisId, value] of Object.entries(
      /** @type {Record<string, unknown>} */ (candidate.axes),
    )) {
      if (typeof value === "string") axes[axisId] = value;
    }
    byId.set(String(it.id), axes);
  }
  return byId;
}

/**
 * 「その軸・その要素は無い」の根拠（enumeration.justified_absences）のうち、
 * 要素スコープ（`<軸 id>/<要素 id>`）で理由が空でないものを集める。
 * 根拠を読む経路が無いと、候補に現れない要素の判定が行き止まりになる
 * （様式の正本は parity-suite の references/coverage-profiles.md）。
 * @param {unknown} raw - enumeration.justified_absences
 * @returns {Set<string>}
 */
function readJustifiedElementAbsences(raw) {
  /** @type {Set<string>} */
  const scopes = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isPlainObject(entry)) continue;
    const e = /** @type {Record<string, unknown>} */ (entry);
    if (!nonEmptyString(e.scope) || !nonEmptyString(e.reason)) continue;
    if (!String(e.scope).includes(ID_SEPARATOR)) continue;
    scopes.add(String(e.scope));
  }
  return scopes;
}

/**
 * セル 1 件を採点する。判定規則の正本は parity-suite の references/coverage.md「部品被覆表」。
 * @param {Record<string, unknown>|undefined} row
 * @param {boolean} duplicated
 * @param {string} label - 問題文に付けるセルの識別子
 * @param {string[]} problems
 * @param {unknown} stateManifest
 * @returns {'present'|'absent'|'unmeasured'}
 */
function gradeCell(row, duplicated, label, problems, stateManifest) {
  if (duplicated) {
    problems.push(`セル ${label}: 同じ組み合わせの行が複数ある（先勝ちにしない）`);
    return "unmeasured";
  }
  if (!row) return "unmeasured";
  const value = row.value;
  if (typeof value !== "string" || !VALUES.includes(value)) {
    problems.push(`セル ${label}: value が ${VALUES.join(" / ")} のいずれでもない`);
    return "unmeasured";
  }
  if (value === "unmeasured") return "unmeasured";
  if (!nonEmptyString(row.evidence)) {
    problems.push(`セル ${label}: value: ${value} なのに evidence が空`);
    return "unmeasured";
  }
  if (value === "present") {
    const coveredBy = Array.isArray(row.covered_by) ? row.covered_by : [];
    if (coveredBy.filter(nonEmptyString).length === 0) {
      problems.push(
        `セル ${label}: value: present なのに covered_by が空（採取状態・assertion に落ちていない）`,
      );
      return "unmeasured";
    }
    return "present";
  }
  const absenceProblem = absentEvidenceProblem(row, label, stateManifest);
  if (absenceProblem) {
    problems.push(absenceProblem);
    return "unmeasured";
  }
  return "absent";
}

/**
 * 同値クラスの所属を検査する（プロファイルを読まずにできる範囲）。
 * 束ねてよい軸かどうか（reducible_axes）は parity-suite の coverage-expand.mjs が見るので、
 * ここでは「削減したなら全候補が過不足なくいずれかのクラスに属する」ことと根拠の非空だけを見る。
 * @param {unknown} classes - components[].equivalence_classes
 * @param {Set<string>} candidateKeys - "<インスタンス id>/<候補 id>" の集合
 * @param {string} cid
 * @param {string[]} problems
 */
function checkEquivalenceMembership(classes, candidateKeys, cid, problems) {
  const list = Array.isArray(classes) ? classes : [];
  // 宣言が空なら削減していない（全候補を個別に採取した）とみなす。1 つでも宣言されたら全候補の所属が要る。
  if (list.length === 0) return;
  /** @type {Map<string, string>} */
  const owner = new Map();
  list.forEach((cls, i) => {
    if (!isPlainObject(cls)) {
      problems.push(`部品 ${cid}: equivalence_classes[${i}] が JSON オブジェクトではない`);
      return;
    }
    const klass = /** @type {Record<string, unknown>} */ (cls);
    const kid = nonEmptyString(klass.id) ? String(klass.id) : `#${i}`;
    if (!nonEmptyString(klass.rationale)) {
      problems.push(`部品 ${cid}: 同値クラス ${kid}: rationale が空（分類根拠が残らない）`);
    }
    const members = (Array.isArray(klass.members) ? klass.members : [])
      .filter(nonEmptyString)
      .map(String);
    if (members.length === 0) {
      problems.push(`部品 ${cid}: 同値クラス ${kid}: members が空`);
      return;
    }
    for (const member of members) {
      if (!candidateKeys.has(member)) {
        problems.push(
          `部品 ${cid}: 同値クラス ${kid}: 候補に無いメンバー ${member} を参照している`,
        );
        continue;
      }
      const previous = owner.get(member);
      if (previous !== undefined) {
        problems.push(
          `部品 ${cid}: 候補 ${member} が同値クラス ${previous} と ${kid} の両方に属している`,
        );
        continue;
      }
      owner.set(member, kid);
    }
    const representative = nonEmptyString(klass.representative)
      ? String(klass.representative)
      : null;
    if (!representative) {
      problems.push(
        `部品 ${cid}: 同値クラス ${kid}: representative が空（採取する候補が決まらない）`,
      );
    } else if (!members.includes(representative)) {
      problems.push(
        `部品 ${cid}: 同値クラス ${kid}: representative ${representative} が members に含まれていない`,
      );
    }
  });
  for (const key of candidateKeys) {
    if (!owner.has(key)) {
      problems.push(
        `部品 ${cid}: 候補 ${key} がどの同値クラスにも属していない（削減するなら全候補の所属が要る）`,
      );
    }
  }
}

/**
 * プロファイルを宣言した部品を数え直す。期待セルは「項目 × インスタンス」ではなく
 * インスタンスごとに記録された候補（instances[].candidates）で、プロファイル本体は読まない。
 * @param {Record<string, unknown>} c - 部品
 * @param {string} cid - 部品 id
 * @param {Map<string, Record<string, unknown>>} byKey
 * @param {Set<string>} duplicated
 * @param {(c: string, i: string, n: string) => string} keyOf
 * @param {Set<string>} expected - 期待セルのキー集合（呼び出し側と共有）
 * @param {string[]} problems
 * @returns {{cells: number, present: number, absent: number, unmeasured: number}}
 */
function countProfiledComponent(c, cid, byKey, duplicated, keyOf, expected, problems) {
  let cells = 0;
  let present = 0;
  let absent = 0;
  let unmeasured = 0;
  const instances = Array.isArray(c.instances) ? c.instances : [];
  if (instances.length === 0) {
    problems.push(`部品 ${cid}: instances が空（列挙が起きていない）`);
    return { cells: 1, present: 0, absent: 0, unmeasured: 1 };
  }
  const itemAxes = readItemAxes(c.items);
  /** @type {Set<string>} */
  const candidateKeys = new Set();
  /** @type {Set<string>} */
  const seenInstances = new Set();

  for (const [index, instance] of instances.entries()) {
    if (!isPlainObject(instance)) {
      problems.push(`部品 ${cid}: instances[${index}] が JSON オブジェクトではない`);
      cells += 1;
      unmeasured += 1;
      continue;
    }
    const inst = /** @type {Record<string, unknown>} */ (instance);
    if (!nonEmptyString(inst.id)) {
      problems.push(
        `部品 ${cid}: instances[${index}]: id が空（識別できないので未測定として数える）`,
      );
      cells += 1;
      unmeasured += 1;
      continue;
    }
    const iid = String(inst.id);
    // インスタンス id は同値クラスの members（"<インスタンス id>/<候補 id>"）の前半になる。
    // 区切り文字を含むと前半と後半を切り分けられず、所属検査が別の組み合わせと突き合う。
    if (iid.includes(ID_SEPARATOR)) {
      problems.push(
        `部品 ${cid}: インスタンス id ${iid} に "${ID_SEPARATOR}" を含む（同値クラスの members が切り分けられない）`,
      );
      cells += 1;
      unmeasured += 1;
      continue;
    }
    if (seenInstances.has(iid)) {
      problems.push(`部品 ${cid}: インスタンス id ${iid} が重複している（先勝ちにしない）`);
      cells += 1;
      unmeasured += 1;
      continue;
    }
    seenInstances.add(iid);
    const label = `部品 ${cid} / インスタンス ${iid}`;

    // 列挙が未完了なら候補は信用できない。候補ゼロで素通りさせず 1 件の未測定として数える。
    const enumeration = isPlainObject(inst.enumeration)
      ? /** @type {Record<string, unknown>} */ (inst.enumeration)
      : null;
    if (!enumeration) {
      problems.push(`${label}: enumeration が無い（候補の来歴が残らない）`);
      cells += 1;
      unmeasured += 1;
      continue;
    }
    if (enumeration.complete !== true) {
      problems.push(
        `${label}: enumeration.complete が true ではない（列挙が未完了のまま確認済みにしない）`,
      );
      cells += 1;
      unmeasured += 1;
      continue;
    }
    if (!isPlainObject(enumeration.source)) {
      problems.push(
        `${label}: enumeration.source が無い（どの版のどこから何を条件に抜いたか残らない）`,
      );
      cells += 1;
      unmeasured += 1;
      continue;
    }
    // 来歴の語彙と「一次情報源を使わなかった理由」は記録側（coverage-expand.mjs）と同じ関数で見る。
    // 出所不明の kind や、受領ソースが読めるのに実 UI の歩行だけで列挙した記録を通さない。
    const enumerationProblems = enumerationSourceProblems(enumeration, label);
    if (enumerationProblems.length > 0) {
      problems.push(...enumerationProblems);
      cells += 1;
      unmeasured += 1;
      continue;
    }

    const candidates = (Array.isArray(inst.candidates) ? inst.candidates : [])
      .filter(nonEmptyString)
      .map(String);
    if (candidates.length === 0) {
      problems.push(`${label}: candidates が空（プロファイルからの展開が記録されていない）`);
      cells += 1;
      unmeasured += 1;
      continue;
    }

    // 「40 列を列挙したが候補は代表 1 列だけ」を落とす。プロファイルは読まないので、
    // 候補に対応する項目の candidate.axes から**軸ごと**の値集合を作って突き合わせる。
    /** @type {Map<string, Set<string>>} */
    const valuesByAxis = new Map();
    let axesResolvable = true;
    for (const candidateId of candidates) {
      const axes = itemAxes.get(candidateId);
      if (axes === undefined) {
        // 軸値が引けない候補があると軸ごとの突き合わせが成立しない。和集合へ倒さず未測定にする。
        problems.push(
          `${label}: 候補 ${candidateId} に対応する項目の candidate.axes が無い（軸ごとの突き合わせができない）`,
        );
        cells += 1;
        unmeasured += 1;
        axesResolvable = false;
        continue;
      }
      for (const [axisId, value] of Object.entries(axes)) {
        if (!valuesByAxis.has(axisId)) valuesByAxis.set(axisId, new Set());
        /** @type {Set<string>} */ (valuesByAxis.get(axisId)).add(value);
      }
    }
    const elements = isPlainObject(enumeration.elements)
      ? /** @type {Record<string, unknown>} */ (enumeration.elements)
      : {};
    const justified = readJustifiedElementAbsences(enumeration.justified_absences);
    for (const [axisId, list] of Object.entries(elements)) {
      if (!Array.isArray(list)) {
        problems.push(`${label}: enumeration.elements.${axisId} が配列ではない`);
        continue;
      }
      if (!axesResolvable) continue; // 軸値が欠けている状態での判定は誤検出になる（上で未測定に数えている）
      const seen = valuesByAxis.get(axisId) ?? new Set();
      for (const el of list) {
        if (!isPlainObject(el) || !nonEmptyString(/** @type {Record<string, unknown>} */ (el).id))
          continue;
        const elementId = String(/** @type {Record<string, unknown>} */ (el).id);
        if (seen.has(elementId)) continue;
        // 「その要素はどの候補にもならない」を主張するには根拠が要る（fail-closed の行き止まりを作らない）。
        if (justified.has(`${axisId}${ID_SEPARATOR}${elementId}`)) continue;
        problems.push(
          `${label}: 列挙した ${axisId} の要素 ${elementId} がどの候補にも現れない（代表だけを確認していないか。意図的なら enumeration.justified_absences に根拠を残す）`,
        );
        cells += 1;
        unmeasured += 1;
      }
    }

    /** @type {Set<string>} */
    const seenCandidates = new Set();
    for (const candidateId of candidates) {
      if (seenCandidates.has(candidateId)) {
        problems.push(`${label}: 候補 ${candidateId} が重複している（期待セルを二重に数えない）`);
        continue;
      }
      seenCandidates.add(candidateId);
      candidateKeys.add(`${iid}${ID_SEPARATOR}${candidateId}`);
      const key = keyOf(cid, candidateId, iid);
      expected.add(key);
      cells += 1;
      const graded = gradeCell(
        byKey.get(key),
        duplicated.has(key),
        `${label} / ${candidateId}`,
        problems,
        inst.applicable_states,
      );
      if (graded === "present") present += 1;
      else if (graded === "absent") absent += 1;
      else unmeasured += 1;
    }
  }

  checkEquivalenceMembership(c.equivalence_classes, candidateKeys, cid, problems);
  return { cells, present, absent, unmeasured };
}

/**
 * 被覆表を数え直す。宣言された件数（metadata.json 側の cells / unmeasured）は参照しない。
 * @param {unknown} coverage - component-coverage.json をパースしたもの
 * @param {string|null} slug - 突き合わせる slug（metadata.json の slug）。null なら照合しない
 * @param {string|null} [captureFingerprintNow] - いま読んだ metadata.json の撮影条件から取った指紋。
 *   記録側が残した値と突き合わせて、--write の後に撮影条件が変わっていないことを確かめる。
 *   null なら照合しない（撮影条件を読めなかった場合）。
 * @returns {{cells: number, present: number, absent: number, unmeasured: number, problems: string[]}}
 */
export function countCoverage(coverage, slug, captureFingerprintNow = null) {
  /** @type {string[]} */
  const problems = [];
  // 配列は typeof で "object" を通るため明示的に弾く。通すと slug 不一致・components 空といった
  // 別の問題文にすり替わり、原因の切り分けを誤らせる（JSON オブジェクト判定はこのファイル内で同じ形に揃える）。
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
    return {
      cells: 0,
      present: 0,
      absent: 0,
      unmeasured: 1,
      problems: ["被覆表が JSON オブジェクトではない"],
    };
  }
  const cov = /** @type {Record<string, unknown>} */ (coverage);
  if (slug !== null && cov.slug !== slug) {
    problems.push(`被覆表の slug（${String(cov.slug)}）が metadata.json の slug（${slug}）と違う`);
  }
  const components = Array.isArray(cov.components) ? cov.components : [];
  if (components.length === 0) {
    problems.push("components が空（declared: true なら 1 つ以上の部品が要る）");
  }

  // プロファイル適合の記録。展開ルールの解釈は parity-suite 側の coverage-expand.mjs が行うため、
  // ここではその実行結果だけを要求する。無い・ok: false を合格に倒さない
  // （declared: true は被覆表の契約に乗ることの宣言なので、記録の欠落は「旧成果物」ではなく未実行）。
  if (!isPlainObject(cov.conformance)) {
    problems.push(
      "conformance が無い（parity-suite の coverage-expand.mjs を実行してプロファイル適合を記録する）",
    );
  } else {
    const conf = /** @type {Record<string, unknown>} */ (cov.conformance);
    if (conf.ok !== true) {
      problems.push(
        `conformance.ok が true ではない（プロファイル適合が未達のまま。${nonEmptyString(conf.tool) ? String(conf.tool) : "coverage-expand"} の問題を解消する）`,
      );
    }
    // 撮影状態の導出は --metadata を渡した実行でしか capture_conditions.states と突き合わせられない。
    // 照合していない記録（checked: false・キーの欠落）を合格に倒すと、撮る状態が足りない機能が
    // 「差 0 件」のまま収束する——差分器は撮った 2 枚しか比べないので、不足は素通りと同じ見え方になる。
    const visual = isPlainObject(conf.visual_states)
      ? /** @type {Record<string, unknown>} */ (conf.visual_states)
      : null;
    if (!visual) {
      problems.push(
        "conformance.visual_states が無い（parity-suite の coverage-expand.mjs を --metadata 付きで実行し、被覆表から導いた撮影状態を capture_conditions.states と突き合わせる）",
      );
    } else if (visual.checked !== true) {
      problems.push(
        "conformance.visual_states.checked が true ではない（--metadata 無しの実行では撮影状態を capture_conditions.states と照合していない）",
      );
    } else if (String(conf.tool) !== COVERAGE_EXPAND_TOOL) {
      // 生成側が何かを確かめずに要約を信頼しない（別ツールの記録・欠落を「照合済み」に倒さない）。
      problems.push(
        `conformance.tool が ${COVERAGE_EXPAND_TOOL} ではない（撮影状態の要約を誰が書いたか確かめられない): ${nonEmptyString(conf.tool) ? String(conf.tool) : "（空）"}`,
      );
    } else if (
      !nonEmptyString(conf.tool_version) ||
      !Number.isInteger(Number(conf.tool_version)) ||
      Number(conf.tool_version) < MIN_COVERAGE_EXPAND_VERSION
    ) {
      // 指紋は「その表を忠実に写したか」しか言わない。壊れた意味論で作られた要約も指紋は一致するので、
      // 版を見ないとスキルを上げても既知の欠陥を持つ要約が通り続ける。
      // 欠落・非数値は「判定しない」に倒さず落とす（検証不能は満たされたではない）。
      problems.push(
        `conformance.visual_states は ${COVERAGE_EXPAND_TOOL} ${MIN_COVERAGE_EXPAND_VERSION} 以降の導出規則で作られている必要がある（記録: ${nonEmptyString(conf.tool_version) ? String(conf.tool_version) : "（空）"}）。それ以前は要求元をルール id でまとめ、縮約してはいけない軸まで畳んでいた。coverage-expand.mjs を --metadata 付きで通し直す`,
      );
    } else {
      if (typeof visual.undecided !== "number" || visual.undecided !== 0) {
        problems.push(
          `conformance.visual_states.undecided が 0 ではない（撮る／撮れない理由が未決の撮影状態が残っている: ${String(visual.undecided)}）`,
        );
      }
      const missing = Array.isArray(visual.missing_states) ? visual.missing_states : null;
      if (missing === null) {
        problems.push("conformance.visual_states.missing_states が配列ではない");
      } else if (missing.length > 0) {
        problems.push(
          `導いた撮影状態が撮影条件に無い（capture_conditions.states、opens-container は popup_inventory[].captured も）: ${missing.map(String).join(", ")}`,
        );
      }
      // 要約は記録時点の入力についての主張でしかない。いま読んでいる表・撮影条件と結び付けないと、
      // --write の後に表を書き換えても（項目に visual_states を足す、撮影状態を metadata から消す等）
      // 古い要約がそのまま通る。指紋で「何を照合した要約か」を現在の入力へ固定する。
      if (!nonEmptyString(visual.table_fingerprint)) {
        problems.push(
          "conformance.visual_states.table_fingerprint が無い（撮影状態の要約がどの表についてのものか確かめられない。coverage-expand.mjs を通し直す）",
        );
      } else if (String(visual.table_fingerprint) !== coverageFingerprint(cov)) {
        problems.push(
          "conformance.visual_states.table_fingerprint が被覆表の内容と一致しない（照合後に表が書き換えられた。coverage-expand.mjs を通し直す）",
        );
      }
      if (!nonEmptyString(visual.capture_fingerprint)) {
        problems.push(
          "conformance.visual_states.capture_fingerprint が無い（撮影状態の要約がどの撮影条件についてのものか確かめられない。coverage-expand.mjs を --metadata 付きで通し直す）",
        );
      } else if (captureFingerprintNow === null) {
        // 「いまの撮影条件を読めない」を「比較しない」に倒さない。倒すと、記録が正常でも
        // metadata から capture_conditions を落としただけで古い要約が収束を通す。
        // checked: true は撮影条件と突き合わせたという主張なので、突き合わせる相手が読めない時点で成立しない。
        problems.push(
          "metadata.json の撮影条件（capture_conditions の pages / states / popup_inventory）を読めないので、conformance.visual_states.capture_fingerprint と突き合わせられない（checked: true の要約を照合せずに通さない）",
        );
      } else if (String(visual.capture_fingerprint) !== captureFingerprintNow) {
        problems.push(
          "conformance.visual_states.capture_fingerprint が metadata.json の撮影条件と一致しない（照合後に撮影条件が書き換えられた。coverage-expand.mjs を --metadata 付きで通し直す）",
        );
      }
    }
  }

  // セル行を 部品／項目／インスタンス で索引する。重複は先勝ちにせず記録する。
  // キーは JSON 配列にして区切り文字を含む id でも衝突しないようにする。
  const rows = Array.isArray(cov.cells) ? cov.cells : [];
  /** @type {Map<string, Record<string, unknown>>} */
  const byKey = new Map();
  /** @type {Set<string>} */
  const duplicated = new Set();
  const keyOf = (c, i, n) => JSON.stringify([c, i, n]);
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      problems.push(`cells[${index}]: JSON オブジェクトでない要素がある`);
      return;
    }
    const r = /** @type {Record<string, unknown>} */ (row);
    if (!nonEmptyString(r.component) || !nonEmptyString(r.item) || !nonEmptyString(r.instance)) {
      // どのセルの行か決まらない行は索引に入れない（空欄が全セルに効く事故を防ぐ）。
      problems.push(`cells[${index}]: component / item / instance のいずれかが空`);
      return;
    }
    const key = keyOf(String(r.component), String(r.item), String(r.instance));
    if (byKey.has(key)) duplicated.add(key);
    else byKey.set(key, r);
  });

  let cells = 0;
  let present = 0;
  let absent = 0;
  let unmeasured = 0;
  /** @type {Set<string>} */
  const expected = new Set();

  // 部品の集合の来歴と完全性。列挙しなかった部品は期待セルにも現れないため、宣言が無いと
  // 「載せなかった部品」が未測定 0 のまま収束する（測り漏れと「本当に無い」が同じ見え方になる）。
  const inventoryProblems = setInventoryProblems(cov.component_inventory, "component_inventory");
  if (inventoryProblems.length > 0) {
    problems.push(...inventoryProblems);
    cells += 1;
    unmeasured += 1;
  }

  /** @type {Set<string>} */
  const seenComponents = new Set();

  for (const [componentIndex, component] of components.entries()) {
    const c = /** @type {Record<string, unknown>} */ (component || {});
    const items = Array.isArray(c.items) ? c.items : [];
    const instances = Array.isArray(c.instances) ? c.instances : [];
    // 期待セル数は部品を識別できるかに依らず「項目数 × インスタンス数」で数える。部品側の id が
    // 空・重複でもセルは実在するので、1 セルに丸めるとレポート値が定義より小さく出る（列挙が
    // 空のときだけ 0 に落ちてしまうため、fail-closed の下限として 1 を取る）。
    const declaredCells = Math.max(items.length * instances.length, 1);
    if (!nonEmptyString(c.id)) {
      problems.push(`components[${componentIndex}]: id が空（識別できないので未測定として数える）`);
      cells += declaredCells;
      unmeasured += declaredCells;
      continue;
    }
    const cid = String(c.id);
    if (seenComponents.has(cid)) {
      problems.push(`components[${componentIndex}]: id ${cid} が重複している（先勝ちにしない）`);
      cells += declaredCells;
      unmeasured += declaredCells;
      continue;
    }
    seenComponents.add(cid);

    // インスタンスの集合（この部品をどの画面に何個置いたか）の来歴と完全性。落ちたインスタンスも
    // 期待セルに現れないため、行の側ではなく集合の側で宣言させる。
    // 併せて項目集合の来歴（components[].source）の語彙・キー欠落も見る——報告しないと、
    // 語彙の外の値でもキーごと無くても通り、「書けたこと」が効いている証拠にならない。
    const setProblems = [
      ...setInventoryProblems(c.instance_inventory, `部品 ${cid} の instance_inventory`),
      ...itemSourceProblems(c.source, `部品 ${cid}`),
    ];
    if (setProblems.length > 0) {
      problems.push(...setProblems);
      cells += 1;
      unmeasured += 1;
    }

    // profile キーの欠落を「汎用扱い」に倒さない。プロファイル無しを選ぶには理由が要る
    // （正本は parity-suite の references/coverage-profiles.md「プロファイルの選択」）。
    if (!("profile" in c)) {
      problems.push(
        `部品 ${cid}: profile キーが無い（適合プロファイルが無いなら profile: null ＋ profile_absent_reason を書く。暗黙の汎用扱いにしない）`,
      );
      cells += declaredCells;
      unmeasured += declaredCells;
      continue;
    }
    if (c.profile !== null) {
      if (!nonEmptyString(c.profile)) {
        problems.push(`部品 ${cid}: profile が空でない文字列でも null でもない`);
        cells += declaredCells;
        unmeasured += declaredCells;
        continue;
      }
      const counted = countProfiledComponent(c, cid, byKey, duplicated, keyOf, expected, problems);
      cells += counted.cells;
      present += counted.present;
      absent += counted.absent;
      unmeasured += counted.unmeasured;
      continue;
    }
    if (!nonEmptyString(c.profile_absent_reason)) {
      // 「適合プロファイルが無い」を主張するには根拠が要る（未検証として残すため）。
      problems.push(
        `部品 ${cid}: profile: null なのに profile_absent_reason が空（未検証の根拠が残らない）`,
      );
    }

    if (items.length === 0 || instances.length === 0) {
      // 空の列挙は期待セル 0 ＝ 未測定 0 に化けるので、fail-closed で 1 件の未測定として数える。
      problems.push(`部品 ${cid}: items または instances が空（列挙が起きていない）`);
      cells += 1;
      unmeasured += 1;
      continue;
    }
    const { ids: itemIds, rejected: itemRejected } = collectIds(
      items,
      `部品 ${cid} の items`,
      problems,
    );
    const { ids: instanceIds, rejected: instanceRejected } = collectIds(
      instances,
      `部品 ${cid} の instances`,
      problems,
    );
    // 期待セル数は定義どおり「項目数 × インスタンス数」で数える。id が空・重複の要素も項目／インスタンスとしては
    // 実在するので、その要素が関わるセルは全て期待セルであり、識別できない以上すべて未測定になる
    // （rejected を 1 セルとして数えると、件数が定義より小さく出て収束レポートが過小になる）。
    const itemTotal = itemIds.length + itemRejected;
    const instanceTotal = instanceIds.length + instanceRejected;
    // id→インスタンスの索引。collectIds が弾いた要素（id が空・重複）は索引にも入れない——
    // String(undefined) が "undefined" と衝突すると、文字列 id "undefined" を持つ正規インスタンスの
    // セルを id 欠落要素から読み、present / absent の集計まで誤る。
    // 併せて 項目 × インスタンス ループ内の線形探索（O(items × instances²)）も避ける。
    /** @type {Map<string, Record<string, unknown>>} */
    const instanceById = new Map();
    for (const entry of instances) {
      if (!isPlainObject(entry)) continue;
      const raw = /** @type {Record<string, unknown>} */ (entry).id;
      if (!nonEmptyString(raw)) continue;
      const id = String(raw);
      // collectIds は重複 id の 2 件目以降を弾き 1 件目を残すため、索引も先勝ちで揃える。
      if (!instanceById.has(id)) {
        instanceById.set(id, /** @type {Record<string, unknown>} */ (entry));
      }
    }
    cells += itemTotal * instanceTotal;
    unmeasured += itemTotal * instanceTotal - itemIds.length * instanceIds.length;
    for (const iid of itemIds) {
      for (const nid of instanceIds) {
        const key = keyOf(cid, iid, nid);
        expected.add(key);
        // 採点規則はプロファイル経路と共有する（片方だけ緩めない）。
        const instance = instanceById.get(nid);
        const graded = gradeCell(
          byKey.get(key),
          duplicated.has(key),
          key,
          problems,
          instance === undefined ? undefined : instance.applicable_states,
        );
        if (graded === "present") present += 1;
        else if (graded === "absent") absent += 1;
        else unmeasured += 1;
      }
    }
  }

  for (const key of byKey.keys()) {
    if (!expected.has(key)) {
      problems.push(`セル ${key}: components に無い 部品／項目／インスタンス を参照している`);
    }
  }

  return { cells, present, absent, unmeasured, problems };
}

/**
 * CLI 本体。
 * `node coverage-check.mjs --metadata <.replace/parity/<slug>/metadata.json> [--coverage <path>]`
 * 判定結果を JSON で標準出力へ、問題を stderr へ出す。
 * 終了コード: 0 ＝ 収束条件を満たす（判定しない場合を含む）／1 ＝ 未測定・不整合が残る／2 ＝ 使い方の誤り。
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{readFile?: (p: string) => string}} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const usage =
    "usage: node coverage-check.mjs --metadata <metadata.json> [--coverage <component-coverage.json>]\n";
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--metadata" || a === "--coverage") {
      const v = argv[i + 1];
      if (v === undefined) {
        process.stderr.write(usage);
        return 2;
      }
      if (opts[a.slice(2)] !== undefined) {
        // 同じフラグの重複指定を黙って後勝ちにしない（どちらを読んだか出力から分からなくなる）。
        process.stderr.write(`error: ${a} が複数回指定されている\n${usage}`);
        return 2;
      }
      opts[a.slice(2)] = v;
      i += 1;
      continue;
    }
    process.stderr.write(`unknown argument: ${a}\n${usage}`);
    return 2;
  }
  if (!opts.metadata) {
    process.stderr.write(usage);
    return 2;
  }

  /** @type {unknown} */
  let metadata;
  try {
    metadata = JSON.parse(readFile(opts.metadata));
  } catch (e) {
    process.stderr.write(`error: metadata.json を読めない: ${opts.metadata}: ${String(e)}\n`);
    return 2;
  }
  const slug =
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    nonEmptyString(/** @type {Record<string, unknown>} */ (metadata).slug)
      ? String(/** @type {Record<string, unknown>} */ (metadata).slug)
      : null;

  const decl = readDeclaration(metadata);
  if (decl.malformed) {
    // 型崩れは後方互換（judged: false → exit 0）に倒さず、使い方の誤りとして落とす。
    process.stdout.write(
      `${JSON.stringify({ tool: "coverage-check", version: VERSION, judged: false, malformed: true, reason: decl.reason, source: null, cells: 0, unmeasured: null }, null, 2)}\n`,
    );
    process.stderr.write(`error: ${decl.reason} — 旧成果物として扱わない（${opts.metadata}）\n`);
    return 2;
  }
  if (!decl.judged) {
    // 判定に入れないことを出力に残す（黙って合格にしない）。
    process.stdout.write(
      `${JSON.stringify({ tool: "coverage-check", version: VERSION, judged: false, reason: decl.reason, source: null, cells: 0, unmeasured: 0 }, null, 2)}\n`,
    );
    process.stderr.write(
      `note: 被覆表を判定に入れない（${decl.reason}）。diff-metadata.json と diff.md の未検証領域へ残す\n`,
    );
    if (opts.coverage) {
      // 明示的に渡された被覆表を黙って読み飛ばさない（サイレント no-op にしない）。
      process.stderr.write(
        `note: --coverage ${opts.coverage} は読んでいない（宣言が無い／declared: false のため）。判定に入れるなら現側 metadata.json に component_coverage.declared: true を書くのは parity-suite の仕事\n`,
      );
    }
    return 0;
  }

  const source = opts.coverage ?? decl.path;
  if (!source) {
    // declared: true なら判定した記録を必ず残す（他の経路と同じ形で出力する）。
    const problem =
      "declared: true なのに component_coverage.path が無く --coverage も渡されていない";
    process.stdout.write(
      `${JSON.stringify({ tool: "coverage-check", version: VERSION, judged: true, reason: null, source: null, cells: 0, unmeasured: null, problems: [problem] }, null, 2)}\n`,
    );
    process.stderr.write(`error: ${problem}\n`);
    return 1;
  }
  /** @type {unknown} */
  let coverage;
  try {
    coverage = JSON.parse(readFile(source));
  } catch (e) {
    // declared: true なのに読めないときは合格に倒さない。
    process.stdout.write(
      `${JSON.stringify({ tool: "coverage-check", version: VERSION, judged: true, reason: null, source, cells: 0, unmeasured: null, problems: [`被覆表を読めない: ${String(e)}`] }, null, 2)}\n`,
    );
    process.stderr.write(`error: 被覆表を読めない: ${source}: ${String(e)}\n`);
    return 1;
  }

  // いま読んでいる metadata の撮影条件から指紋を取り、記録側が残した値と突き合わせる。
  // 撮影条件を読めない metadata では照合できないので null を渡す（読めたことにしない）。
  const captureNow = readCaptureForFingerprint(metadata);
  const counted = countCoverage(coverage, slug, captureNow);
  const ok = counted.unmeasured === 0 && counted.problems.length === 0;
  process.stdout.write(
    `${JSON.stringify({ tool: "coverage-check", version: VERSION, judged: true, reason: null, source, ...counted }, null, 2)}\n`,
  );
  for (const p of counted.problems) process.stderr.write(`warn: ${p}\n`);
  // exit 1 の理由は必ず error 行として出す。problems はあるが未測定 0（components が空など）のとき
  // warn だけだと、終了コードが 1 になった理由が利用者から読めない。
  if (counted.unmeasured > 0) {
    process.stderr.write(
      `error: 未測定 ${counted.unmeasured} / 期待セル ${counted.cells} — 収束させず parity-suite へ戻す\n`,
    );
  }
  if (counted.problems.length > 0) {
    process.stderr.write(
      `error: 被覆表の不整合 ${counted.problems.length} 件（上の warn を参照）— 収束させず parity-suite へ戻す\n`,
    );
  }
  return ok ? 0 : 1;
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる。
// process.argv[1] は起動時のパスのまま、import.meta.url も --preserve-symlinks(-main)
// （NODE_OPTIONS 経由でも付く）では未解決のままなので、片側だけ解決すると
// シンボリックリンク経由（.claude/skills/<name> → .agents/skills/<name>）の起動で条件が偽になり、
// main() が呼ばれず何も出力せず exit 0 になる（サイレント no-op）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // 実パス解決に失敗したら生パスで突き合わせる（サイレント no-op より誤検出を選ぶ）。
    return entry === self;
  }
})();

if (invokedAsCli) {
  process.exit(main(process.argv.slice(2)));
}
