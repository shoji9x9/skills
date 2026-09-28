// 撮る範囲の穴を採取の段で数える検査（正本）。Issue #239。
//
// 何のためか: 撮る範囲が狭いと、**実装したあとに範囲外の差分が現れる**。
// そこで範囲を広げて撮り直すことになるが、**現側も撮り直し**なので反復が 1 つ増える。
// 範囲の狭さは「差分が出なかった」と同じ見え方になる——**差分器は撮った 2 枚しか比べない**ので、
// 撮らなかった領域は永久に差 0 件として通る。だから**撮る段で穴を数える**。
//
// この検査が落とすのは 4 つ。
//   1. **撮影組の取りこぼし**: ノイズ基準値を採った組（ページ × 状態 × ビューポート）に、範囲の実測が無い。
//      「範囲を測っていない組」と「穴の無い組」を同じ見え方にしない。
//   2. **文書が撮影領域より大きい**（`below-fold` / `beyond-right`）: `full_page: false` で下・右が切れている。
//   3. **内部スクロール器の外**（`scroll:<名前>`）: 器の `scrollHeight` / `scrollWidth` が `clientHeight` / `clientWidth` より大きく、
//      画素にも特性にも出ない領域が器の中に残っている（仮想スクロール・固定高のグリッドが該当する）。
//      あわせて器ごとに（Issue #495）、**特性照合に器が無い**（`untraced:<名前>`。器の名前が `traits.elements` に無く、
//      スクロールバーの有無・厚み・見た目が trait-capture.mjs の `scroll` に採られない）と、
//      **スクロールバーを表示して撮ったのに、はみ出した向きのバーが場所を取っていない**（`scrollbar-hidden:<名前>`。
//      `--hide-scrollbars` が残っているか、オーバーレイ型・`scrollbar-width: none` のバー）を穴として数える。
//   4. **撮影領域の外にある論理名付き要素**（`offscreen:<名前>`）: 特性は採れても画素には写らない。
//
// あわせて**スクロールバーが場所を取る窓でのはみ出し**の宣言を数える（Issue #449。`checkOverflow`）。
// スクロールバーを隠した撮影では `100vh` と `height: 100%` の差が 0 になり、上の穴と同じく「差分 0 件」に化けるため。
// 撮影時の扱い（`scrollbars`）は `shown` を既定にし、`hidden` で撮るなら理由（`scrollbars_reason`）を、
// `shown` ならどの環境のスクロールバーで撮ったか（`scrollbar_environment`）を書かせる（Issue #495）。
// **表示を切り替える軸**（ロケール・配色テーマ等。Issue #489。`checkDisplayAxes`）も数える——既定の 1 値だけで撮ると、
// 他の値での差がどの経路にも写らない。既定以外の値ごとの撮影（変種）は撮るはずの組に入り、撮っていなければ `#not-captured` の穴になる。
// **採取環境と利用者環境の一致**（Issue #476。`checkViewerEnvironment` / `checkBrowser`）も数える——「未確認」のままでは、
// 採取環境でだけ成立する一致が差分ゼロのまま収束する。
//
// 穴は消すか、**対象外として理由付きで宣言する**（`capture_scope_exemptions`）。宣言の無い穴は落とす。
// 効かない宣言（対応する穴が無い）も落とす——古い宣言が残ると、範囲を狭めても静かに通る。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは `metadata.json` だけで、ブラウザは駆動しない
// （範囲の実測は採取スペックが行い、その結果をこのスクリプトが数える）。TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 条件を満たす、1 ＝ 穴・不整合が残る（採取へ戻す）、2 ＝ 使い方の誤り・型崩れ。

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "5";

/** `metadata.json` の `mode` の語彙（正本は parity-suite の SKILL.md）。視覚採取物を持つのは `feature` だけ。 */
export const MODES = ["feature", "api-resource", "batch"];

/** 撮影組の鍵の区切り。ページ名・状態名・ビューポート label にこの文字は使えない。 */
export const KEY_SEPARATOR = "|";

/** 穴の id の区切り（`<鍵>#<種別>:<名前>`）。鍵の材料・器の名前・論理名にこの文字は使えない。 */
export const ID_SEPARATOR = "#";

/**
 * id の材料として安全か（区切り文字を含まない非空の文字列）。
 *
 * **id は利用者が `capture_scope_exemptions` へ書き写す**ので、符号化で逃げず材料の側で弾く。
 * 区切りを含めると別々の穴が同じ id になり、**1 つの宣言が 2 つの穴を黙らせる**
 * （ビューポート `v#scroll:x` の below-fold と、ビューポート `v` の器 `x#below-fold` は
 * どちらも `p|s|v#scroll:x#below-fold` になる）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function idPartIsSafe(value) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    !value.includes(KEY_SEPARATOR) &&
    !value.includes(ID_SEPARATOR)
  );
}

/**
 * 撮影組の鍵。`noise_baseline` と `capture_scope` を突き合わせる単位。
 * @param {{page?: unknown, state?: unknown, viewport?: unknown}} entry
 * @returns {string}
 */
export function combinationKey(entry) {
  return [entry.page, entry.state, entry.viewport].map((part) => String(part)).join(KEY_SEPARATOR);
}

/**
 * 鍵の材料に区切り文字が入っていないか。
 *
 * **入っていると別々の組が同じ鍵に潰れる**——`("a|b", "c", "d")` と `("a", "b|c", "d")` はどちらも
 * `a|b|c|d` になり、1 つの範囲の実測が 2 つの撮影組を満たしたことになって穴が消える。
 * 鍵は穴の id にも入る（利用者が `capture_scope_exemptions` に書き写す）ので、
 * 符号化で回避せず**材料の側で弾く**。
 * @param {{page?: unknown, state?: unknown, viewport?: unknown}} entry
 * @returns {boolean}
 */
export function keyPartsAreSafe(entry) {
  return [entry.page, entry.state, entry.viewport].every((part) => idPartIsSafe(part));
}

/**
 * 正の有限数か（寸法の実測値はここを通す）。
 * @param {unknown} value
 * @returns {boolean}
 */
function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 空でない文字列か。
 * @param {unknown} value
 * @returns {boolean}
 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * 寸法（`{width, height}`）を検証して返す。型崩れ・0 以下なら null。
 *
 * **0 を通さない**——同梱テンプレートは寸法を `0` で置いてあるので、
 * プレースホルダのまま書いた組は文書も撮影領域も 0×0 になり、寸法の比較では穴が 1 つも出ない。
 * 「測っていない組」が「穴の無い組」と同じ見え方になるため、実測値は正の数だけを受ける。
 * @param {unknown} value
 * @returns {{width:number, height:number} | null}
 */
function readSize(value) {
  if (!value || typeof value !== "object") return null;
  const size = /** @type {{width?: unknown, height?: unknown}} */ (value);
  if (!positiveNumber(size.width) || !positiveNumber(size.height)) return null;
  return { width: /** @type {number} */ (size.width), height: /** @type {number} */ (size.height) };
}

/** CSS の `overflow-x` / `overflow-y` の計算値の語彙。 */
export const OVERFLOW_VALUES = ["visible", "hidden", "clip", "scroll", "auto"];

/** スクロールバーを描く `overflow` の値（`hidden` / `clip` は切るだけでバーを描かない）。 */
const SCROLLBAR_OVERFLOW = ["scroll", "auto"];

/**
 * 0 以上の有限数か（スクロールバーの厚みの実測値はここを通す。0 はバーが場所を取らない正規の値）。
 * @param {unknown} value
 * @returns {boolean}
 */
function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * 1 つの撮影組の実測から穴を導く。
 *
 * **穴は記録された `holes` ではなく寸法から導く**——書き手が挙げた分だけを見ると、
 * 挙げ忘れた穴が「穴が無い」と同じ見え方になる。
 *
 * `context.elements` は `traits.elements`（特性照合する論理名）の集合。null（読めない）なら器ごとの
 * `untraced` の判定をしない（読めないことは呼び出し側が finding にする）。`context.scrollbars` は撮影時の扱いで、
 * `shown` のときだけ `scrollbar-hidden` の陽性コントロールを当てる（`hidden` ではバーの厚み 0 が正規の値）。
 * @param {Record<string, unknown>} entry
 * @param {{ elements?: Set<string> | null, scrollbars?: unknown }} [context]
 * @returns {{ holes: {id:string, kind:string, detail:string}[], findings: {code:string, message:string}[] }}
 */
export function deriveHoles(entry, context = {}) {
  const elements = context.elements ?? null;
  const key = combinationKey(entry);
  /** @type {{id:string, kind:string, detail:string}[]} */
  const holes = [];
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  const document = readSize(entry.document);
  const captured = readSize(entry.captured);
  if (!document || !captured) {
    findings.push({
      code: "scope-size-unreadable",
      message: `${key} の document / captured の寸法が数値で書かれていない（測っていないことを穴が無いことに倒さない）`,
    });
    return { holes, findings };
  }
  if (document.height > captured.height) {
    holes.push({
      id: `${key}#below-fold`,
      kind: "below-fold",
      detail: `文書の高さ ${document.height} に対し撮影領域は ${captured.height}（下が ${document.height - captured.height}px 切れている）`,
    });
  }
  if (document.width > captured.width) {
    holes.push({
      id: `${key}#beyond-right`,
      kind: "beyond-right",
      detail: `文書の幅 ${document.width} に対し撮影領域は ${captured.width}（右が ${document.width - captured.width}px 切れている）`,
    });
  }
  const containers = entry.scroll_containers;
  if (!Array.isArray(containers)) {
    findings.push({
      code: "scroll-containers-missing",
      message: `${key} に scroll_containers が無い（内部スクロール器を数えていないことと、器が無いことを書き分ける。無ければ空配列を書く）`,
    });
  } else {
    const seen = new Set();
    for (const raw of containers) {
      const container = /** @type {Record<string, unknown>} */ (raw ?? {});
      const name = container.name;
      if (!nonEmptyString(name)) {
        findings.push({
          code: "scroll-container-name-missing",
          message: `${key} の scroll_containers に名前の無い要素がある（穴の id が決まらない）`,
        });
        continue;
      }
      if (!idPartIsSafe(name)) {
        findings.push({
          code: "scroll-container-name-unsafe",
          message: `${key} の scroll_containers[${String(name)}] に区切り文字（${KEY_SEPARATOR} / ${ID_SEPARATOR}）が入っている（別々の穴が同じ id になり、1 つの宣言が 2 つの穴を黙らせる）`,
        });
        continue;
      }
      if (seen.has(name)) {
        findings.push({
          code: "scroll-container-duplicated",
          message: `${key} の scroll_containers に ${name} が 2 つ以上ある（宣言がどちらに効くか決まらない）`,
        });
      }
      seen.add(name);
      const client = readSize(container.client);
      const scroll = readSize(container.scroll);
      if (!client || !scroll) {
        findings.push({
          code: "scroll-container-size-unreadable",
          message: `${key} の scroll_containers[${String(name)}] の client / scroll が数値で書かれていない`,
        });
        continue;
      }
      if (scroll.height > client.height || scroll.width > client.width) {
        holes.push({
          id: `${key}#scroll:${String(name)}`,
          kind: "scroll-container",
          detail: `器 ${String(name)} の内容 ${scroll.width}x${scroll.height} が可視部 ${client.width}x${client.height} より大きい`,
        });
      }
      // 器ごとの overflow とスクロールバーの厚み（Issue #495）。寸法だけでは、現行が overflow: auto で横のバーを出し、
      // 新側が overflow-x: hidden で右端を切る差が見えない（バーを隠して撮ると client と scroll が両側とも揃う）
      const overflowX = container.overflow_x;
      const overflowY = container.overflow_y;
      if (
        !OVERFLOW_VALUES.includes(/** @type {string} */ (overflowX)) ||
        !OVERFLOW_VALUES.includes(/** @type {string} */ (overflowY))
      ) {
        findings.push({
          code: "scroll-container-overflow-unreadable",
          message: `${key} の scroll_containers[${String(name)}] の overflow_x / overflow_y が計算値の語彙（${OVERFLOW_VALUES.join(" / ")}）で書かれていない`,
        });
        continue;
      }
      const bar = /** @type {Record<string, unknown> | null | undefined} */ (container.bar);
      if (
        !bar ||
        typeof bar !== "object" ||
        !nonNegativeNumber(bar.vertical) ||
        !nonNegativeNumber(bar.horizontal)
      ) {
        findings.push({
          code: "scroll-container-bar-unreadable",
          message: `${key} の scroll_containers[${String(name)}] の bar（vertical: 縦のバーの幅 / horizontal: 横のバーの高さ。枠を除く）が 0 以上の数で書かれていない`,
        });
        continue;
      }
      if (elements && !elements.has(String(name))) {
        holes.push({
          id: `${key}#untraced:${String(name)}`,
          kind: "untraced-scroll-container",
          detail: `器 ${String(name)} が traits.elements に無い（スクロールバーの有無・厚み・見た目が特性照合に写らない。器に論理名を付けて採る）`,
        });
      }
      // 陽性コントロール: バーを描く overflow ではみ出しているのに厚みが 0 なら、バーが場所を取っていない
      const hiddenVertical =
        scroll.height > client.height &&
        SCROLLBAR_OVERFLOW.includes(/** @type {string} */ (overflowY)) &&
        bar.vertical === 0;
      const hiddenHorizontal =
        scroll.width > client.width &&
        SCROLLBAR_OVERFLOW.includes(/** @type {string} */ (overflowX)) &&
        bar.horizontal === 0;
      if (context.scrollbars === "shown" && (hiddenVertical || hiddenHorizontal)) {
        holes.push({
          id: `${key}#scrollbar-hidden:${String(name)}`,
          kind: "scrollbar-hidden",
          detail: `器 ${String(name)} は${hiddenVertical ? "縦" : "横"}にはみ出しているのにスクロールバーの厚みが 0（scrollbars: shown で撮ったはずが --hide-scrollbars が残っているか、オーバーレイ型・scrollbar-width: none のバー）`,
        });
      }
    }
  }
  const outside = entry.named_elements_outside;
  if (!Array.isArray(outside)) {
    findings.push({
      code: "named-elements-outside-missing",
      message: `${key} に named_elements_outside が無い（撮影領域の外に出た論理名を数えていない。無ければ空配列を書く）`,
    });
  } else {
    const seenOutside = new Set();
    for (const name of outside) {
      if (!nonEmptyString(name)) {
        findings.push({
          code: "named-element-name-missing",
          message: `${key} の named_elements_outside に空の要素がある`,
        });
        continue;
      }
      if (!idPartIsSafe(name)) {
        findings.push({
          code: "named-element-name-unsafe",
          message: `${key} の named_elements_outside の ${String(name)} に区切り文字（${KEY_SEPARATOR} / ${ID_SEPARATOR}）が入っている（別々の穴が同じ id になる）`,
        });
        continue;
      }
      // **同じ論理名が 2 つあると同じ id の穴が 2 つできる**——1 つの宣言で両方が消えるので、
      // 器の名前と同じく重複の側で落とす（棚卸しが潰れたまま exit 0 にしない）。
      if (seenOutside.has(name)) {
        findings.push({
          code: "named-element-duplicated",
          message: `${key} の named_elements_outside に ${String(name)} が 2 つ以上ある（同じ id の穴が 2 つでき、1 つの宣言で両方が消える）`,
        });
        continue;
      }
      seenOutside.add(name);
      holes.push({
        id: `${key}#offscreen:${String(name)}`,
        kind: "offscreen-named-element",
        detail: `論理名 ${String(name)} が撮影領域の外にある（特性は採れても画素には写らない）`,
      });
    }
  }
  return { holes, findings };
}

/**
 * 撮影条件が宣言した組（ページ × 状態 × ビューポート）を列挙する。
 *
 * **突き合わせ相手を `noise_baseline` だけにしない**——採った組の一覧を期待値にすると、
 * 宣言した組を採らずに落とした場合に「採っていない組」が一覧から消え、
 * 穴が 1 つも出ないまま通る（範囲の狭さが差分 0 件と同じ見え方になる、というこの検査の前提そのもの）。
 * 期待値は `capture_conditions` の 3 軸から作り、採った側・測った側の双方と突き合わせる。
 *
 * 軸の材料に区切り文字が入ると別々の組が同じ鍵に潰れるため、`keyPartsAreSafe` と同じ規律で材料の側を弾く。
 *
 * **表示の軸の値ごとの撮影（`display_axes.variants`）も撮るはずの組に入れる**（Issue #489）。変種の label は
 * ビューポートの軸の値として扱い（`noise_baseline` / `capture_scope` の `viewport` に書く）、全ページ × 全状態を期待する。
 * 変種が持つ軸を `not_applicable` と宣言したページだけは期待しない。
 * @param {Record<string, unknown>} conditions
 * @param {{ variants: {label:string, axes:string[]}[], notApplicable: Map<string, Set<string>> }} [displayAxes]
 * @returns {{ keys: string[], findings: {code:string, message:string}[] }}
 */
export function declaredCombinations(conditions, displayAxes) {
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  /**
   * @param {unknown} value
   * @param {string} axis
   * @param {(element: unknown) => unknown} pick
   * @returns {string[]}
   */
  const axisValues = (value, axis, pick) => {
    if (!Array.isArray(value) || value.length === 0) {
      findings.push({
        code: "declared-axis-missing",
        message: `capture_conditions.${axis} が空（撮るはずの組を列挙できない。採った組の一覧を期待値にすると、採らなかった組が期待値からも消える）`,
      });
      return [];
    }
    /** @type {string[]} */
    const names = [];
    const seen = new Set();
    for (const element of value) {
      const name = pick(element);
      if (!idPartIsSafe(name)) {
        findings.push({
          code: "declared-axis-value-unusable",
          message: `capture_conditions.${axis} に使えない値がある（空、または区切り文字 ${KEY_SEPARATOR} / ${ID_SEPARATOR} を含む）: ${name === undefined ? "（欠落）" : JSON.stringify(name)}`,
        });
        continue;
      }
      const text = /** @type {string} */ (name);
      if (seen.has(text)) {
        findings.push({
          code: "declared-axis-value-duplicated",
          message: `capture_conditions.${axis} に ${text} が 2 つ以上ある（同じ組が 2 回期待され、片方の実測がもう片方を満たす）`,
        });
        continue;
      }
      seen.add(text);
      names.push(text);
    }
    return names;
  };
  const pages = axisValues(conditions.pages, "pages", (element) =>
    element && typeof element === "object"
      ? /** @type {{name?: unknown}} */ (element).name
      : undefined,
  );
  const states = axisValues(conditions.states, "states", (element) => element);
  const viewports = axisValues(conditions.viewports, "viewports", (element) =>
    element && typeof element === "object"
      ? /** @type {{label?: unknown}} */ (element).label
      : undefined,
  );
  /** @type {string[]} */
  const keys = [];
  for (const page of pages) {
    for (const state of states) {
      for (const viewport of viewports) {
        keys.push(combinationKey({ page, state, viewport }));
      }
    }
  }
  for (const variant of displayAxes?.variants ?? []) {
    for (const page of pages) {
      const excluded = variant.axes.some((axis) => displayAxes?.notApplicable.get(axis)?.has(page));
      if (excluded) continue;
      for (const state of states) {
        keys.push(combinationKey({ page, state, viewport: variant.label }));
      }
    }
  }
  return { keys, findings };
}

/**
 * 表示を切り替える軸の候補（正本）。Issue #489。
 *
 * **軸は思いついた分だけ数えると、数えなかった軸の値での差がどの経路にも写らない**（ロケールを数えずに English だけで撮り、
 * 利用者が Japanese で開いて初めて気づいた）。候補の全件を「在る（`axes[].candidate`）」か「無い（`absent`）」に振り分けさせ、
 * 振り分けていない候補を落とす。一覧に無い軸は `candidate: "other"` で足す。
 * スクロールバーの出方（常に表示・オーバーレイ）は利用者の OS・ブラウザの設定で変わる軸として数える（Issue #495）。
 * 採取環境で撮るバーの扱い（場所を取るか）は別に `scrollbars` / `overflow` が持つ。
 * @type {{id:string, label:string}[]}
 */
export const AXIS_CANDIDATES = [
  { id: "locale", label: "ロケール（言語）" },
  { id: "text-direction", label: "文字の方向（RTL）" },
  { id: "number-date-format", label: "数値と日付の書式" },
  { id: "color-scheme", label: "配色テーマ（prefers-color-scheme）" },
  { id: "forced-colors", label: "高コントラスト（forced-colors）" },
  { id: "prefers-contrast", label: "コントラストの設定（prefers-contrast）" },
  { id: "text-size", label: "文字の大きさ・拡大率" },
  { id: "device-pixel-ratio", label: "DPR" },
  { id: "reduced-motion", label: "動きを減らす設定（prefers-reduced-motion）" },
  { id: "role", label: "利用者の権限・ロールで変わる表示" },
  { id: "print", label: "印刷（@media print）" },
  { id: "scrollbar-appearance", label: "スクロールバーの出方（常に表示・オーバーレイ）" },
];

/** 一覧に無い軸を足すときの `candidate`。 */
export const OTHER_CANDIDATE = "other";

/** 軸の対でビューポートを指す名前（`pairs[].axes` に書く）。軸の名前には使えない。 */
export const VIEWPORT_AXIS = "viewport";

/**
 * 軸の名前・値として使えるか。組の鍵と穴の id に入る label の材料にはしないが、
 * 宣言の突き合わせで `名前=値` の形に並べるので、`=` と `,` も弾く。
 * @param {unknown} value
 * @returns {boolean}
 */
function axisPartIsSafe(value) {
  return idPartIsSafe(value) && !String(value).includes("=") && !String(value).includes(",");
}

/**
 * 根拠として数えてよい文字列か（空でなく、テンプレートの <…> や TODO・未確認のようなプレースホルダで始まらない）。
 * 空でないだけで数えると、同梱テンプレートの値を埋めずに残した軸が「来歴付きで数えた」ことになる。
 * @param {unknown} value
 * @returns {boolean}
 */
function evidenceText(value) {
  return nonEmptyString(value) && !UNCONFIRMED_BODY.test(String(value).trim());
}

/**
 * 変種の値（軸名 → 値）を順序に依らない文字列にする（`locale=ja,theme=dark`）。
 * @param {Record<string, string>} values
 * @returns {string}
 */
function variantSignature(values) {
  return Object.keys(values)
    .sort()
    .map((axis) => `${axis}=${values[axis]}`)
    .join(",");
}

/**
 * 表示を切り替える軸（`capture_conditions.display_axes`）の宣言を検査する。Issue #489。
 *
 * 落とすのは 4 群。
 *   1. **数えていない**: キーごと無い・候補の一覧に振り分けていない候補がある。
 *   2. **値の撮り漏れ**: 既定以外の値ごとに、他の軸を既定のままその値だけを振った変種が無い（1 軸ずつ振る）。
 *   3. **掛け合わせの判断漏れ**: 軸（とビューポート）の対ごとに、掛けたか掛けなかったかと理由が無い。掛けると宣言した対の組み合わせの変種が無い。
 *   4. **スイートに写していない**: 軸ごとに、値ごとの期待値を引く箇所か、値で文言・振る舞いが変わらない根拠が無い。
 *
 * 撮った組の数え直しはここではしない——変種の label を `declaredCombinations` に渡し、
 * 撮っていない組を `#not-captured` の穴として他の穴と同じ経路で数える。
 * @param {Record<string, unknown>} conditions
 * @returns {{ findings: {code:string, message:string}[], variants: {label:string, axes:string[]}[], notApplicable: Map<string, Set<string>> }}
 */
export function checkDisplayAxes(conditions) {
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  const add = (code, message) => findings.push({ code, message });
  /** @type {{label:string, axes:string[]}[]} */
  const variantsOut = [];
  /** @type {Map<string, Set<string>>} */
  const notApplicable = new Map();
  const result = () => ({ findings, variants: variantsOut, notApplicable });

  if (!Object.hasOwn(conditions, "display_axes")) {
    add(
      "display-axes-missing",
      "capture_conditions.display_axes が無い（表示を切り替える軸〈ロケール・配色テーマ等〉を数えていない。既定の 1 値だけで撮った差は 3 経路のどれにも写らない）",
    );
    return result();
  }
  const raw = conditions.display_axes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    add("display-axes-malformed", "capture_conditions.display_axes がオブジェクトではない");
    return result();
  }
  const da = /** @type {Record<string, unknown>} */ (raw);
  for (const key of ["axes", "absent", "pairs", "variants"]) {
    if (!Array.isArray(da[key])) {
      add(
        "display-axes-malformed",
        `capture_conditions.display_axes.${key} が配列ではない（空でもキーごと書く。欠落は「数えていない」と区別できない）`,
      );
      return result();
    }
  }
  const declaredPages = Array.isArray(conditions.pages)
    ? conditions.pages
        .map((p) =>
          p && typeof p === "object" ? /** @type {{name?: unknown}} */ (p).name : undefined,
        )
        .filter((name) => typeof name === "string")
    : [];
  const candidateIds = AXIS_CANDIDATES.map((c) => c.id);
  /** @type {Map<string, string>} 候補 id → 振り分け先（どこに書いたか） */
  const surveyed = new Map();
  const survey = (candidate, where) => {
    if (candidate === OTHER_CANDIDATE) return;
    if (!candidateIds.includes(candidate)) {
      add(
        "display-axis-candidate-unknown",
        `${where} の candidate「${String(candidate)}」が候補の一覧に無い（一覧に無い軸は "${OTHER_CANDIDATE}" で書く。候補: ${candidateIds.join(" / ")}）`,
      );
      return;
    }
    if (surveyed.has(candidate)) {
      add(
        "display-axis-candidate-duplicated",
        `候補 ${candidate} が ${surveyed.get(candidate)} と ${where} の 2 か所に振り分けてある（在る・無いのどちらかに 1 回だけ書く）`,
      );
      return;
    }
    surveyed.set(candidate, where);
  };

  /** @type {Map<string, {values:string[], default:string}>} */
  const axes = new Map();
  /** @type {unknown[]} */ (da.axes).forEach((rawAxis, i) => {
    const at = `display_axes.axes[${i}]`;
    const axis = /** @type {Record<string, unknown>} */ (
      rawAxis && typeof rawAxis === "object" ? rawAxis : {}
    );
    const name = axis.name;
    if (!axisPartIsSafe(name) || name === VIEWPORT_AXIS) {
      add(
        "display-axis-name-unusable",
        `${at} の name が使えない（空・区切り文字 | # = , を含む・予約語 "${VIEWPORT_AXIS}"）: ${JSON.stringify(name)}`,
      );
      return;
    }
    const axisName = /** @type {string} */ (name);
    if (axes.has(axisName)) {
      add("display-axis-duplicated", `display_axes.axes に ${axisName} が 2 つ以上ある`);
      return;
    }
    survey(axis.candidate, at);
    const values = axis.values;
    /** @type {string[]} */
    const valueList = [];
    if (!Array.isArray(values) || values.length < 2) {
      add(
        "display-axis-values-unusable",
        `${at}（${axisName}）の values が 2 つ以上の値の配列ではない（値が 1 つなら切り替えの軸ではないので absent に書く）`,
      );
    } else {
      for (const value of values) {
        if (!axisPartIsSafe(value)) {
          add(
            "display-axis-values-unusable",
            `${at}（${axisName}）の values に使えない値がある（空・区切り文字 | # = , を含む）: ${JSON.stringify(value)}`,
          );
        } else if (valueList.includes(/** @type {string} */ (value))) {
          add(
            "display-axis-values-unusable",
            `${at}（${axisName}）の values に ${value} が 2 つ以上ある`,
          );
        } else {
          valueList.push(/** @type {string} */ (value));
        }
      }
    }
    if (typeof axis.default !== "string" || !valueList.includes(axis.default)) {
      add(
        "display-axis-default-unknown",
        `${at}（${axisName}）の default が values に無い（基準の組を撮った値が決まらない）: ${JSON.stringify(axis.default)}`,
      );
    }
    if (!evidenceText(axis.source)) {
      add(
        "display-axis-source-missing",
        `${at}（${axisName}）に source が無い（値の一覧をどこから数えたかの来歴が残らない）`,
      );
    }
    if (!evidenceText(axis.apply)) {
      add(
        "display-axis-apply-missing",
        `${at}（${axisName}）に apply が無い（値の当て方が残らないと、新側を同じ値で撮れない）`,
      );
    }
    const expectations = evidenceText(axis.suite_expectations);
    const noExpectations = evidenceText(axis.suite_reason);
    if (expectations === noExpectations) {
      add(
        "display-axis-suite-undecided",
        `${at}（${axisName}）は suite_expectations（値ごとの期待値を引く箇所）と suite_reason（値で文言・振る舞いが変わらない根拠）のどちらか一方だけを書く（視覚ベースラインだけではスイートが既定の値でしか緑を示さない）`,
      );
    }
    /** @type {Set<string>} */
    const excludedPages = new Set();
    const naList = axis.not_applicable ?? [];
    if (!Array.isArray(naList)) {
      add(
        "display-axis-not-applicable-malformed",
        `${at}（${axisName}）の not_applicable が配列ではない`,
      );
    } else {
      naList.forEach((rawNa, j) => {
        const na = /** @type {Record<string, unknown>} */ (
          rawNa && typeof rawNa === "object" ? rawNa : {}
        );
        const page = na.page;
        if (typeof page !== "string" || !declaredPages.includes(page)) {
          add(
            "display-axis-not-applicable-page-unknown",
            `${at}.not_applicable[${j}] のページ ${JSON.stringify(page)} が capture_conditions.pages に無い`,
          );
          return;
        }
        if (excludedPages.has(page)) {
          add(
            "display-axis-not-applicable-duplicated",
            `${at}（${axisName}）の not_applicable に ${page} が 2 つ以上ある`,
          );
          return;
        }
        if (!evidenceText(na.reason)) {
          add(
            "display-axis-not-applicable-reason-missing",
            `${at}（${axisName}）の not_applicable の ${page} に reason が無い（軸が効かないことの来歴が残らない）`,
          );
          return;
        }
        excludedPages.add(page);
      });
    }
    // 全ページで効かない軸は切り替えの軸ではない。変種を宣言しても撮るはずの組が 0 件になり、撮らずに通る
    if (declaredPages.length > 0 && declaredPages.every((page) => excludedPages.has(page))) {
      add(
        "display-axis-not-applicable-all-pages",
        `${at}（${axisName}）の not_applicable が撮影ページの全てを覆う（どのページでも効かない軸は absent に書く。変種の撮るはずの組が 0 件になり、撮らずに通る）`,
      );
    }
    notApplicable.set(axisName, excludedPages);
    axes.set(axisName, {
      values: valueList,
      default: typeof axis.default === "string" ? axis.default : "",
    });
  });

  /** @type {unknown[]} */ (da.absent).forEach((rawAbsent, i) => {
    const at = `display_axes.absent[${i}]`;
    const absent = /** @type {Record<string, unknown>} */ (
      rawAbsent && typeof rawAbsent === "object" ? rawAbsent : {}
    );
    if (absent.candidate === OTHER_CANDIDATE) {
      add(
        "display-axis-candidate-unknown",
        `${at} に "${OTHER_CANDIDATE}" は書けない（無いと言える候補は一覧の候補だけ）`,
      );
      return;
    }
    survey(absent.candidate, at);
    if (!evidenceText(absent.source)) {
      add(
        "display-axis-absent-source-missing",
        `${at}（${String(absent.candidate)}）に source が無い（無いと確かめた来歴が残らない。思いつかなかった軸と区別できない）`,
      );
    }
  });
  for (const id of candidateIds) {
    if (!surveyed.has(id)) {
      const label = AXIS_CANDIDATES.find((c) => c.id === id)?.label ?? id;
      add(
        "display-axis-candidate-unsurveyed",
        `表示の軸の候補 ${id}（${label}）が axes にも absent にも無い（数えていない軸の値での差は、どの経路にも写らない）`,
      );
    }
  }

  const baseViewports = Array.isArray(conditions.viewports)
    ? conditions.viewports
        .map((v) =>
          v && typeof v === "object" ? /** @type {{label?: unknown}} */ (v).label : undefined,
        )
        .filter((label) => typeof label === "string")
    : [];
  /** @type {Set<string>} */
  const labels = new Set();
  /** @type {Set<string>} 変種の中身（`<基準の窓>|<軸=値,…>`） */
  const variantKeys = new Set();
  /** @type {Set<string>} 軸=値 の組み合わせ（窓を問わない） */
  const signatures = new Set();
  /** @type {unknown[]} */ (da.variants).forEach((rawVariant, i) => {
    const at = `display_axes.variants[${i}]`;
    const variant = /** @type {Record<string, unknown>} */ (
      rawVariant && typeof rawVariant === "object" ? rawVariant : {}
    );
    const label = variant.label;
    // label は書き出し先のディレクトリ名にもなる（page/state/label）。`.` / `..` やパスの区切りを通すと、
    // 採取の noise パスの削除が別の組のディレクトリを指す
    if (
      !idPartIsSafe(label) ||
      label === "." ||
      label === ".." ||
      /[\\/,]/.test(/** @type {string} */ (label))
    ) {
      add(
        "display-axis-variant-label-unusable",
        `${at} の label が使えない（空、区切り文字 ${KEY_SEPARATOR} / ${ID_SEPARATOR} を含む、または . / .. / パスの区切り・カンマを含む。カンマは PARITY_NOISE_PAIRS 等の区切りでもある）: ${JSON.stringify(label)}`,
      );
      return;
    }
    const labelText = /** @type {string} */ (label);
    if (labels.has(labelText) || baseViewports.includes(labelText)) {
      add(
        "display-axis-variant-label-duplicated",
        `${at} の label ${labelText} が他の変種か capture_conditions.viewports の label と重なる（別々の組が同じ鍵に潰れる）`,
      );
      return;
    }
    labels.add(labelText);
    if (typeof variant.viewport !== "string" || !baseViewports.includes(variant.viewport)) {
      add(
        "display-axis-variant-viewport-unknown",
        `${at}（${labelText}）の viewport ${JSON.stringify(variant.viewport)} が capture_conditions.viewports の label に無い（どの窓で撮るか決まらない）`,
      );
      return;
    }
    const values = variant.values;
    if (
      !values ||
      typeof values !== "object" ||
      Array.isArray(values) ||
      Object.keys(values).length === 0
    ) {
      add(
        "display-axis-variant-values-unusable",
        `${at}（${labelText}）の values が「軸の名前 → 既定以外の値」のオブジェクトではない`,
      );
      return;
    }
    /** @type {Record<string, string>} */
    const picked = {};
    let usable = true;
    for (const [axisName, value] of Object.entries(values)) {
      const axis = axes.get(axisName);
      if (!axis) {
        add(
          "display-axis-variant-values-unusable",
          `${at}（${labelText}）の values の軸 ${axisName} が display_axes.axes に無い`,
        );
        usable = false;
        continue;
      }
      if (typeof value !== "string" || !axis.values.includes(value)) {
        add(
          "display-axis-variant-values-unusable",
          `${at}（${labelText}）の ${axisName} の値 ${JSON.stringify(value)} が values に無い`,
        );
        usable = false;
        continue;
      }
      if (value === axis.default) {
        add(
          "display-axis-variant-values-unusable",
          `${at}（${labelText}）の ${axisName} が既定値 ${value}（既定値は基準の組が撮る。変種には既定以外の値だけを書く）`,
        );
        usable = false;
        continue;
      }
      picked[axisName] = value;
    }
    if (!usable) return;
    // 変種の軸のどれかが効かないページは撮らない。全ページが外れる変種は撮るはずの組が 0 件になり、
    // それでも掛け合わせの対を満たしたことになるので落とす
    const pickedAxes = Object.keys(picked);
    if (
      declaredPages.length > 0 &&
      declaredPages.every((page) => pickedAxes.some((axis) => notApplicable.get(axis)?.has(page)))
    ) {
      add(
        "display-axis-variant-no-pages",
        `${at}（${labelText}）の軸が効くページが 1 つも無い（not_applicable が合わせて全ページを覆う。撮るはずの組が 0 件のまま掛け合わせの対を満たさない。同時に効かない対なら crossed: false にする）`,
      );
      return;
    }
    const signature = variantSignature(picked);
    const key = `${variant.viewport}${KEY_SEPARATOR}${signature}`;
    if (variantKeys.has(key)) {
      add(
        "display-axis-variant-duplicated",
        `${at}（${labelText}）は同じ窓 ${variant.viewport} × ${signature} の変種が既にある（同じ撮影が 2 回期待される）`,
      );
      return;
    }
    variantKeys.add(key);
    signatures.add(signature);
    variantsOut.push({ label: labelText, axes: Object.keys(picked) });
  });

  // 1 軸ずつ振る: 既定以外の値ごとに、その軸だけを振った変種が要る（窓は問わない）
  for (const [axisName, axis] of axes) {
    for (const value of axis.values) {
      if (value === axis.default) continue;
      if (!signatures.has(variantSignature({ [axisName]: value }))) {
        add(
          "display-axis-value-unswept",
          `軸 ${axisName} の値 ${value} を撮る変種が無い（他の軸を既定のまま ${axisName}=${value} だけを振った変種を 1 つの窓で撮る）`,
        );
      }
    }
  }

  // 対ごとの掛け合わせの判断
  const members = [...axes.keys()];
  /** @type {Map<string, boolean>} */
  const decided = new Map();
  const pairKey = (a, b) => [a, b].sort().join(",");
  /** @type {unknown[]} */ (da.pairs).forEach((rawPair, i) => {
    const at = `display_axes.pairs[${i}]`;
    const pair = /** @type {Record<string, unknown>} */ (
      rawPair && typeof rawPair === "object" ? rawPair : {}
    );
    const names = pair.axes;
    if (
      !Array.isArray(names) ||
      names.length !== 2 ||
      names[0] === names[1] ||
      !names.every((n) => typeof n === "string" && (n === VIEWPORT_AXIS || axes.has(n))) ||
      names.every((n) => n === VIEWPORT_AXIS)
    ) {
      add(
        "display-axis-pair-unusable",
        `${at} の axes が「宣言した軸（または "${VIEWPORT_AXIS}"）の異なる 2 つ」ではない: ${JSON.stringify(names)}`,
      );
      return;
    }
    const key = pairKey(names[0], names[1]);
    if (decided.has(key)) {
      add("display-axis-pair-duplicated", `display_axes.pairs に ${key} の対が 2 つ以上ある`);
      return;
    }
    if (typeof pair.crossed !== "boolean") {
      add("display-axis-pair-unusable", `${at}（${key}）の crossed が真偽値ではない`);
      return;
    }
    if (!evidenceText(pair.reason)) {
      add(
        "display-axis-pair-reason-missing",
        `${at}（${key}）に reason が無い（掛けた・掛けなかった理由が残らない）`,
      );
    }
    decided.set(key, pair.crossed);
  });
  const pairMembers = [...members, VIEWPORT_AXIS];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < pairMembers.length; j += 1) {
      const a = members[i];
      const b = pairMembers[j];
      const key = pairKey(a, b);
      if (!decided.has(key)) {
        add(
          "display-axis-pair-undecided",
          `軸の対 ${key} を掛け合わせるかの判断が display_axes.pairs に無い（同時に変えると結果が変わる対か、理由付きで書く）`,
        );
        continue;
      }
      if (!decided.get(key)) continue;
      const nonDefault = (name) => {
        const axis = axes.get(name);
        return axis ? axis.values.filter((v) => v !== axis.default) : [];
      };
      if (b === VIEWPORT_AXIS) {
        for (const value of nonDefault(a)) {
          for (const viewport of baseViewports) {
            const want = `${viewport}${KEY_SEPARATOR}${variantSignature({ [a]: value })}`;
            if (!variantKeys.has(want)) {
              add(
                "display-axis-pair-not-crossed",
                `掛け合わせると宣言した対 ${key} の組 ${a}=${value} × 窓 ${viewport} の変種が無い`,
              );
            }
          }
        }
        continue;
      }
      for (const va of nonDefault(a)) {
        for (const vb of nonDefault(b)) {
          const want = variantSignature({ [a]: va, [b]: vb });
          if (!signatures.has(want)) {
            add(
              "display-axis-pair-not-crossed",
              `掛け合わせると宣言した対 ${key} の組 ${want} の変種が無い`,
            );
          }
        }
      }
    }
  }
  return result();
}

/**
 * 採取環境と利用者環境の一致（`capture_conditions.viewer_environment`）を検査する。Issue #476。
 *
 * 通すのは `一致: <確かめ方>` と `乖離: <内容と gaps.md の該当箇所>` の 2 形だけ。
 * **「未確認」を通さない**——記録しただけでは誰も読まず、採取環境でだけ成立する一致（フォントのフォールバック先等）が
 * 差分ゼロのまま収束する。**確かめ方の無い「一致」も通さない**（未確認と見分けが付かない）。
 * @param {Record<string, unknown>} conditions
 * @returns {{code:string, message:string}[]}
 */
export function checkViewerEnvironment(conditions) {
  const value = conditions.viewer_environment;
  if (value === undefined) {
    return [
      {
        code: "viewer-environment-missing",
        message:
          "capture_conditions.viewer_environment が無い（採取環境と想定利用者環境が一致するかを確かめていない）",
      },
    ];
  }
  const matched =
    typeof value === "string" ? /^(一致|乖離)\s*[:：]\s*(\S[\s\S]*)$/u.exec(value.trim()) : null;
  // 形だけ満たした未確認（「一致: 未確認」「一致: TODO」、テンプレートの <…> のまま）は確かめ方・内容として数えない
  if (matched && UNCONFIRMED_BODY.test(matched[2].trim())) {
    return [
      {
        code: "viewer-environment-unconfirmed",
        message: `capture_conditions.viewer_environment の「${matched[1]}」の後ろが未確認・プレースホルダ: ${JSON.stringify(value)}（確かめ方か、乖離の内容と gaps.md の該当箇所を書く）`,
      },
    ];
  }
  if (matched && matched[1] === "乖離" && !matched[2].includes("gaps.md")) {
    return [
      {
        code: "viewer-environment-gaps-ref-missing",
        message: `capture_conditions.viewer_environment の乖離に gaps.md の該当箇所が無い: ${JSON.stringify(value)}（既知の乖離を未検証領域へ回さないと、収束の後に誰にも見えなくなる）`,
      },
    ];
  }
  if (!matched) {
    return [
      {
        code: "viewer-environment-unconfirmed",
        message: `capture_conditions.viewer_environment が「一致: <確かめ方>」でも「乖離: <内容と gaps.md の該当箇所>」でもない: ${JSON.stringify(value)}（利用者環境のブラウザへ接続して確かめるか、乖離を理由付きで残す）`,
      },
    ];
  }
  return [];
}

/**
 * `viewer_environment` の「一致: / 乖離:」の後ろに置かれた、確かめていないことを表す書き方（先頭一致・大小文字無視）。
 * 空でないだけの本文を確かめ方として数えると、「一致: 未確認」が一致として通る。
 */
export const UNCONFIRMED_BODY =
  /^(?:未確認|未検証|要確認|確認中|不明|未定|なし|todo|tbd|fixme|n\/a|-|—|<)/iu;

/** `capture_conditions.browser` の語彙。`launched` は Playwright が起動したブラウザ、`cdp` は利用者環境で起動したブラウザへの接続。 */
export const BROWSER_MODES = ["launched", "cdp"];

/**
 * 撮影に使ったブラウザ（`capture_conditions.browser`）の記録を検査する。Issue #476。
 * `parity-diff` の新側採取が同じ扱いで撮るために読む（片側だけ利用者環境で撮ると、環境の差がそのまま差分に出る）。
 * @param {Record<string, unknown>} conditions
 * @returns {{code:string, message:string}[]}
 */
export function checkBrowser(conditions) {
  if (!Object.hasOwn(conditions, "browser")) {
    return [
      {
        code: "browser-missing",
        message: `capture_conditions.browser が無い（${BROWSER_MODES.join(" / ")}。新側を同じ扱いで撮れない）`,
      },
    ];
  }
  if (!BROWSER_MODES.includes(/** @type {string} */ (conditions.browser))) {
    return [
      {
        code: "browser-unknown",
        message: `capture_conditions.browser「${String(conditions.browser)}」が語彙外（${BROWSER_MODES.join(" / ")}）`,
      },
    ];
  }
  // cdp では接続先の同一性（Browser.version と userAgent）も残す。モードだけでは、現・新が別の機械へ接続しても揃ったことになる
  if (conditions.browser === "cdp") {
    const identity = /** @type {Record<string, unknown> | null | undefined} */ (
      conditions.browser_identity
    );
    if (
      !identity ||
      typeof identity !== "object" ||
      !evidenceText(identity.product) ||
      !evidenceText(identity.user_agent)
    ) {
      return [
        {
          code: "browser-identity-missing",
          message:
            "capture_conditions.browser が cdp なのに browser_identity（product: Browser.version()、user_agent: navigator.userAgent）が無い（新側が同じ利用者環境へ接続したかを照合できない）",
        },
      ];
    }
  }
  return [];
}

/** `capture_conditions.scrollbars` の語彙。`hidden` は Playwright のヘッドレス Chromium の既定（`--hide-scrollbars`）。 */
export const SCROLLBAR_MODES = ["hidden", "shown"];

/** `capture_conditions.overflow.status` の語彙。 */
export const OVERFLOW_STATUSES = ["measured", "not_measured"];

/**
 * スクロールバーの扱いと、スクロールバーが場所を取る窓での「はみ出し」の宣言を検査する。Issue #449。
 *
 * **スクロールバーが隠れていると `100vh` と `height: 100%` の差が測れない。** 隠れたスクロールバーは場所を取らないので、
 * 横スクロールバーが出る窓でも「見える高さ」が減らず、頁の高さの決め方の違いが 3 経路のどれにも写らない。
 * そこで撮影時の扱い（`scrollbars`）を記録させ、別に「スクロールバーを表示した窓で、頁の最小幅より狭い窓の縦・横のはみ出し」を
 * `overflow` に宣言させる（現・新の突き合わせはこの記録を読むスイートの assertion が行う）。
 *
 * 通すのは 2 通りだけ: `status: measured` で頁ごとの実測が揃っている／`status: not_measured` で理由がある。
 * @param {Record<string, unknown>} conditions
 * @returns {{code:string, message:string}[]}
 */
export function checkOverflow(conditions) {
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  const add = (code, message) => findings.push({ code, message });
  if (!Object.hasOwn(conditions, "scrollbars")) {
    add(
      "scrollbars-missing",
      `capture_conditions.scrollbars が無い（撮影時にスクロールバーが場所を取ったか。${SCROLLBAR_MODES.join(" / ")} で書く。新側を同じ扱いで撮れない）`,
    );
  } else if (!SCROLLBAR_MODES.includes(/** @type {string} */ (conditions.scrollbars))) {
    add(
      "scrollbars-unknown",
      `capture_conditions.scrollbars「${String(conditions.scrollbars)}」が語彙外（${SCROLLBAR_MODES.join(" / ")}）`,
    );
  } else if (conditions.scrollbars === "hidden" && !evidenceText(conditions.scrollbars_reason)) {
    // 既定は shown。隠して撮ると、バーが場所を取る差（はみ出し・横のバーの有無）が 3 経路のどれにも写らない（Issue #495）
    add(
      "scrollbars-hidden-reason-missing",
      "capture_conditions.scrollbars が hidden なのに scrollbars_reason が無い（既定は shown。隠して撮るなら、スクロールバーが場所を取る差を測らない理由を書き gaps.md に残す）",
    );
  } else if (conditions.scrollbars === "shown" && !evidenceText(conditions.scrollbar_environment)) {
    // バーの描き方は OS とブラウザで変わるので、撮ったバーの画素を利用者環境の見え方の根拠にしない（Issue #495）
    add(
      "scrollbar-environment-missing",
      "capture_conditions.scrollbars が shown なのに scrollbar_environment が無い（どの OS・ブラウザのどの種類〈クラシック / オーバーレイ〉のスクロールバーで撮ったかを書く）",
    );
  }
  if (!Object.hasOwn(conditions, "overflow")) {
    add(
      "overflow-missing",
      "capture_conditions.overflow が無い（スクロールバーを表示した窓のはみ出しを測っていない。測れないなら status: not_measured と reason を書く。キーを省略したまま免除しない）",
    );
    return findings;
  }
  const overflow = conditions.overflow;
  if (
    !overflow ||
    typeof overflow !== "object" ||
    Array.isArray(overflow) ||
    !OVERFLOW_STATUSES.includes(/** @type {string} */ (/** @type {any} */ (overflow).status))
  ) {
    add(
      "overflow-status-unknown",
      `capture_conditions.overflow.status が ${OVERFLOW_STATUSES.join(" / ")} のいずれでもない`,
    );
    return findings;
  }
  const o = /** @type {Record<string, unknown>} */ (overflow);
  if (o.status === "not_measured") {
    if (!nonEmptyString(o.reason)) {
      add(
        "overflow-reason-missing",
        "capture_conditions.overflow.status: not_measured に reason が無い",
      );
    }
    return findings;
  }
  if (o.reason !== null) {
    add(
      "overflow-reason-unexpected",
      "capture_conditions.overflow.status: measured なのに reason が null でない（測ったか測らなかったかが矛盾）",
    );
  }
  if (o.scrollbars !== "shown") {
    add(
      "overflow-scrollbars-hidden",
      "capture_conditions.overflow.scrollbars が shown でない（スクロールバーが場所を取らない窓では 100vh と 100% の差が 0 になる）",
    );
  }
  if (!nonEmptyString(o.spec)) {
    add(
      "overflow-spec-missing",
      "capture_conditions.overflow.spec が空（この記録を現・新の両側に当てるスペックが無いと、新側と突き合わせられない）",
    );
  }
  // 期待集合は撮影条件の pages（宣言）から作る。記録された頁だけを見ると、頁ごと落とした測り漏れが通る
  const declaredPages = Array.isArray(conditions.pages)
    ? conditions.pages
        .map((p) => (p && typeof p === "object" ? /** @type {any} */ (p).name : undefined))
        .filter(nonEmptyString)
    : [];
  if (!Array.isArray(o.pages)) {
    add("overflow-pages-missing", "capture_conditions.overflow.pages が配列でない");
    return findings;
  }
  /** @type {Set<string>} */
  const seenPages = new Set();
  o.pages.forEach((raw, i) => {
    const at = `capture_conditions.overflow.pages[${i}]`;
    const entry = /** @type {Record<string, unknown>} */ (raw ?? {});
    if (!nonEmptyString(entry.page)) {
      add("overflow-page-unkeyed", `${at}.page が空（どの頁の実測か決まらない）`);
      return;
    }
    const page = /** @type {string} */ (entry.page);
    if (seenPages.has(page)) {
      add(
        "overflow-page-duplicated",
        `capture_conditions.overflow.pages に ${page} が 2 つ以上ある`,
      );
      return;
    }
    seenPages.add(page);
    if (!declaredPages.includes(page)) {
      add("overflow-page-unknown", `${at} の頁 ${page} が capture_conditions.pages に無い`);
    }
    const minWidth = entry.min_width;
    const minWidthOk =
      minWidth === null || (Number.isInteger(minWidth) && /** @type {number} */ (minWidth) > 0);
    if (!minWidthOk) {
      add(
        "overflow-min-width-malformed",
        `${at}.min_width が正の整数でも null でもない（最小幅を持たない頁だけ null と書く）`,
      );
    }
    // 狭い窓で読んだ中身の高さ。最小幅を持つ頁では、これより高い狭い窓（縦のはみ出しが頁の高さの決め方だけで決まる窓）を要求する。
    // 「縦にはみ出さないこと」は要求しない——body { height: 100% } と既定の margin のように、どの高さでもはみ出す正当な頁がある
    const contentHeight = entry.content_height;
    const contentHeightOk =
      minWidth === null ||
      (Number.isInteger(contentHeight) && /** @type {number} */ (contentHeight) > 0);
    if (minWidthOk && !contentHeightOk) {
      add(
        "overflow-content-height-malformed",
        `${at}.content_height が正の整数でない（最小幅より狭い窓で読んだ文書の scrollHeight を書く）`,
      );
    }
    // 最小幅の探索の範囲。刻みだけの探索は狭い帯でだけ効く最小幅を見落とすので、メディアクエリの境界も探す（Codex レビュー #453）。
    // 読めないスタイルシートの境界は探索できていないので、未検証として gaps.md への参照を要求する
    const probe = /** @type {Record<string, unknown>} */ (entry.probe ?? {});
    if (
      !entry.probe ||
      typeof entry.probe !== "object" ||
      !Number.isInteger(probe.step) ||
      /** @type {number} */ (probe.step) <= 0 ||
      !Array.isArray(probe.breakpoints) ||
      !probe.breakpoints.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0) ||
      !Number.isInteger(probe.unreadable_stylesheets) ||
      /** @type {number} */ (probe.unreadable_stylesheets) < 0
    ) {
      add(
        "overflow-probe-malformed",
        `${at}.probe が無いか型が崩れている（step: 正の整数、breakpoints: 正の数の配列、unreadable_stylesheets: 0 以上の整数）`,
      );
    } else if (
      /** @type {number} */ (probe.unreadable_stylesheets) > 0 &&
      !nonEmptyString(probe.gaps_ref)
    ) {
      add(
        "overflow-probe-unreadable-unrecorded",
        `${at} に読めないスタイルシートが ${probe.unreadable_stylesheets} 件あるのに probe.gaps_ref が空（その境界は探索できていない。gaps.md に未検証として残して該当箇所を書く）`,
      );
    } else if (probe.unreadable_stylesheets === 0 && probe.gaps_ref !== null) {
      add(
        "overflow-probe-gaps-ref-unexpected",
        `${at} に読めないスタイルシートが無いのに probe.gaps_ref が null でない（古い記録）`,
      );
    }
    if (!Array.isArray(entry.windows) || entry.windows.length === 0) {
      add("overflow-windows-missing", `${at}.windows が空（測った窓が無い）`);
      return;
    }
    /** @type {Set<string>} */
    const seenWindows = new Set();
    let narrow = 0;
    let fitting = 0;
    entry.windows.forEach((rawWindow, j) => {
      const wat = `${at}.windows[${j}]`;
      const w = /** @type {Record<string, unknown>} */ (rawWindow ?? {});
      if (
        !Number.isInteger(w.width) ||
        !Number.isInteger(w.height) ||
        /** @type {number} */ (w.width) <= 0 ||
        /** @type {number} */ (w.height) <= 0
      ) {
        add("overflow-window-malformed", `${wat} の width / height が正の整数でない`);
        return;
      }
      const key = `${w.width}x${w.height}`;
      if (seenWindows.has(key)) {
        add("overflow-window-duplicated", `${at}.windows に窓 ${key} が 2 つ以上ある`);
        return;
      }
      seenWindows.add(key);
      if (typeof w.horizontal !== "boolean" || typeof w.vertical !== "boolean") {
        add("overflow-window-malformed", `${wat} の horizontal / vertical が真偽値でない`);
        return;
      }
      if (
        typeof w.horizontal_bar_px !== "number" ||
        !Number.isFinite(w.horizontal_bar_px) ||
        w.horizontal_bar_px < 0
      ) {
        add("overflow-window-malformed", `${wat}.horizontal_bar_px が 0 以上の数でない`);
        return;
      }
      // はみ出し量。真偽値だけだと、どの高さでも縦にはみ出す頁（body の height: 100% と既定の margin）で
      // 100% と 100vh が両側とも vertical: true になり見分けられない（Codex レビュー #453）。スイートは量を比べる
      const extentOk = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= 0;
      if (!extentOk(w.overflow_x_px) || !extentOk(w.overflow_y_px)) {
        add(
          "overflow-window-malformed",
          `${wat}.overflow_x_px / overflow_y_px が 0 以上の整数でない`,
        );
        return;
      }
      if (
        w.horizontal !== /** @type {number} */ (w.overflow_x_px) > 0 ||
        w.vertical !== /** @type {number} */ (w.overflow_y_px) > 0
      ) {
        add(
          "overflow-extent-inconsistent",
          `${wat} のはみ出しの真偽値とはみ出し量が矛盾している（horizontal は overflow_x_px > 0、vertical は overflow_y_px > 0 と一致させる）`,
        );
      }
      // 陽性コントロール: 横にはみ出した窓で横スクロールバーが場所を取っていなければ、スクロールバーが隠れたまま測っている
      if (w.horizontal && w.horizontal_bar_px === 0) {
        add(
          "overflow-bar-takes-no-space",
          `${wat} は横にはみ出しているのに横スクロールバーの厚みが 0（スクロールバーが隠れたまま測っている。--hide-scrollbars が残っているか、オーバーレイ型のスクロールバー）`,
        );
      }
      if (!minWidthOk) return;
      if (minWidth === null) {
        if (w.horizontal) {
          add(
            "overflow-min-width-inconsistent",
            `${wat} は横にはみ出しているのに ${at}.min_width が null（最小幅を持つ頁として測り直す）`,
          );
        }
        return;
      }
      // 最小幅より狭い窓が全て横にはみ出すとは限らない（最小幅が中間のブレークポイントでだけ効くレスポンシブな頁は、
      // モバイル幅ではみ出さない）。数えるのは「最小幅より狭く、横にはみ出した窓」
      if (/** @type {number} */ (w.width) < /** @type {number} */ (minWidth) && w.horizontal) {
        narrow += 1;
        if (
          contentHeightOk &&
          /** @type {number} */ (w.height) > /** @type {number} */ (contentHeight)
        ) {
          fitting += 1;
        }
      }
    });
    if (minWidthOk && minWidth !== null && narrow === 0) {
      add(
        "overflow-narrow-window-missing",
        `${at} に min_width（${minWidth}）より狭く横にはみ出した窓が無い（横スクロールバーが出る窓で測らないと 100vh と 100% の差は出ない）`,
      );
    } else if (minWidthOk && minWidth !== null && contentHeightOk && fitting === 0) {
      add(
        "overflow-fit-window-missing",
        `${at} に min_width（${minWidth}）より狭く横にはみ出し、content_height（${contentHeight}）より高い窓が無い（中身が収まる高さの窓でないと、縦のはみ出しが頁の高さの決め方だけで決まらず 100vh と 100% を見分けられない）`,
      );
    }
  });
  for (const page of declaredPages) {
    if (!seenPages.has(page)) {
      add(
        "overflow-page-missing",
        `capture_conditions.overflow.pages に撮影頁 ${page} が無い（頁ごとに測る）`,
      );
    }
  }
  return findings;
}

/**
 * `metadata.json` の内容から撮る範囲の穴を数える。
 *
 * `judged: false` は「視覚採取物を持たないモードなので判定に入れない」の意味で、合格とは別物
 * （呼び出し側は判定しなかった事実を記録に残す）。
 * @param {unknown} metadata
 * @returns {{ findings: {code:string, message:string}[], holes: {id:string, kind:string, detail:string}[], counts: Record<string, number>, structural: boolean, judged: boolean }}
 */
export function checkCaptureScope(metadata) {
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  /** @type {{id:string, kind:string, detail:string}[]} */
  const holes = [];
  if (!metadata || typeof metadata !== "object") {
    return {
      findings: [
        { code: "metadata-unreadable", message: "metadata.json が JSON オブジェクトではない" },
      ],
      holes,
      counts: { combinations: 0, holes: 0 },
      structural: true,
      judged: true,
    };
  }
  const meta = /** @type {Record<string, any>} */ (metadata);
  // 視覚採取物を持たないモード（api-resource / batch）は撮影条件そのものを持たないので判定に入れない。
  // **通すのはこの閉じた集合だけ**で、mode が読めない・知らない値のときは判定を飛ばさず落とす
  // （緩和経路を「壊れている入力」全部に広げない）。
  // **欠落・非文字列も同じ**——分岐の外へ落として feature 扱いにすると、壊れた metadata が
  // 「撮影条件が読めた feature」として判定を通りうる。mode は語彙の中の文字列であることを先に確かめる。
  if (typeof meta.mode !== "string" || !MODES.includes(meta.mode)) {
    return {
      findings: [
        {
          code: "mode-unknown",
          message: `mode「${meta.mode === undefined ? "（欠落）" : String(meta.mode)}」が語彙外（${MODES.join(" / ")}）。判定を飛ばさない`,
        },
      ],
      holes,
      counts: { combinations: 0, holes: 0 },
      structural: true,
      judged: true,
    };
  }
  if (meta.mode !== "feature") {
    return {
      findings,
      holes,
      counts: { combinations: 0, holes: 0 },
      structural: false,
      judged: false,
    };
  }
  const conditions = meta.capture_conditions;
  if (!conditions || typeof conditions !== "object") {
    return {
      findings: [
        {
          code: "capture-conditions-missing",
          message: "capture_conditions が無い（撮影条件を持たない成果物は範囲の判定に入れない）",
        },
      ],
      holes,
      counts: { combinations: 0, holes: 0 },
      structural: true,
      judged: true,
    };
  }
  const conditionsRecord = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (conditions)
  );
  // 特性照合する論理名（器ごとの untraced の判定に使う）。読めなければ判定を飛ばさず、器があるときに落とす
  const traitElements = meta.traits && meta.traits.elements;
  const elements =
    Array.isArray(traitElements) && traitElements.every((name) => nonEmptyString(name))
      ? new Set(/** @type {string[]} */ (traitElements))
      : null;
  const displayAxes = checkDisplayAxes(conditionsRecord);
  const declared = declaredCombinations(conditionsRecord, displayAxes);
  findings.push(...declared.findings);
  findings.push(...displayAxes.findings);
  findings.push(...checkViewerEnvironment(conditionsRecord));
  findings.push(...checkBrowser(conditionsRecord));
  findings.push(
    ...checkOverflow(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (conditions))),
  );
  const noiseBaseline = meta.noise_baseline;
  if (!Array.isArray(noiseBaseline) || noiseBaseline.length === 0) {
    findings.push({
      code: "noise-baseline-missing",
      message:
        "noise_baseline が空（どの組を撮ったかが分からない。範囲の検査は撮った組の一覧を突き合わせ相手にする）",
    });
  }
  const scope = conditions.capture_scope;
  if (!Array.isArray(scope)) {
    findings.push({
      code: "capture-scope-missing",
      message:
        "capture_conditions.capture_scope が無い（範囲を測っていない。撮った組ごとに文書・撮影領域・内部スクロール器・領域外の論理名を実測して書く）",
    });
    return {
      findings,
      holes,
      counts: {
        declared: declared.keys.length,
        combinations: Array.isArray(noiseBaseline) ? noiseBaseline.length : 0,
        holes: 0,
      },
      structural: false,
      judged: true,
    };
  }
  /** @type {Map<string, Record<string, unknown>>} */
  const scopeByKey = new Map();
  for (const raw of scope) {
    const entry = /** @type {Record<string, unknown>} */ (raw ?? {});
    if (
      !nonEmptyString(entry.page) ||
      !nonEmptyString(entry.state) ||
      !nonEmptyString(entry.viewport)
    ) {
      findings.push({
        code: "scope-entry-unkeyed",
        message:
          "capture_scope に page / state / viewport の揃っていない要素がある（撮影組を特定できない）",
      });
      continue;
    }
    if (!keyPartsAreSafe(entry)) {
      findings.push({
        code: "scope-entry-key-unsafe",
        message: `capture_scope の要素に区切り文字「${KEY_SEPARATOR}」を含む名前がある（別々の組が同じ鍵に潰れ、1 つの実測が 2 つの組を満たす）`,
      });
      continue;
    }
    const key = combinationKey(entry);
    // **後勝ちで上書きしない**——`deriveHoles` は鍵ごとに最後に残った要素しか評価しないので、
    // 本物の実測の後にプレースホルダーが続くと、警告は出るのに穴そのものが消える。
    // noise_baseline の重複と同じく先勝ちで残す。
    // **先勝ちにしても `holes` の中身は並び順で変わる**（どちらの重複を読むかが入れ替わるだけ）。
    // 並び順に依らないのは合否のほうで、重複そのものが必ず `scope-entry-duplicated` で落ちるため、
    // 消えた実測に気づかないまま収束することはない。
    if (scopeByKey.has(key)) {
      findings.push({
        code: "scope-entry-duplicated",
        message: `capture_scope に ${key} の要素が 2 つ以上ある（どちらの実測が有効か決まらない）`,
      });
      continue;
    }
    scopeByKey.set(key, entry);
  }
  /** @type {Set<string>} */
  const shot = new Set();
  if (Array.isArray(noiseBaseline)) {
    for (const raw of noiseBaseline) {
      const entry = /** @type {Record<string, unknown>} */ (raw ?? {});
      if (
        !nonEmptyString(entry.page) ||
        !nonEmptyString(entry.state) ||
        !nonEmptyString(entry.viewport)
      ) {
        findings.push({
          code: "noise-entry-unkeyed",
          message: "noise_baseline に page / state / viewport の揃っていない要素がある",
        });
        continue;
      }
      if (!keyPartsAreSafe(entry)) {
        findings.push({
          code: "noise-entry-key-unsafe",
          message: `noise_baseline の要素に区切り文字「${KEY_SEPARATOR}」を含む名前がある（別々の組が同じ鍵に潰れる）`,
        });
        continue;
      }
      const noiseKey = combinationKey(entry);
      // **同じ組が 2 行あると Set が黙って畳む**——parity-diff の突き合わせは先に当たった行を使うので、
      // しきい値の大きい行が選ばれると実差がノイズとして分類されうる。畳む前に落とす。
      if (shot.has(noiseKey)) {
        findings.push({
          code: "noise-entry-duplicated",
          message: `noise_baseline に ${noiseKey} の行が 2 つ以上ある（どの基準値が有効か決まらない）`,
        });
        continue;
      }
      shot.add(noiseKey);
    }
  }
  for (const key of shot) {
    if (!scopeByKey.has(key)) {
      findings.push({
        code: "scope-entry-missing",
        message: `${key} は撮ったのに範囲の実測が無い（測っていない組を穴の無い組と同じ扱いにしない）`,
      });
    }
  }
  // **宣言した組を採らなかった場合は穴として数える。**
  // 採った組の一覧（`noise_baseline`）だけを突き合わせ相手にすると、組ごと落とした範囲が
  // 期待値からも消えて穴が 0 件になる。対象外にするなら他の穴と同じく理由付きで宣言させる。
  for (const key of declared.keys) {
    if (!shot.has(key) && !scopeByKey.has(key)) {
      holes.push({
        id: `${key}#not-captured`,
        kind: "not-captured",
        detail: `撮影条件が宣言した組 ${key} を採っていない（noise_baseline にも capture_scope にも無い）`,
      });
    }
  }
  // **記録した組が宣言にあることも確かめる。** 変種を消した・改名した後に古い行が noise_baseline と capture_scope の
  // 両方に残ると、2 つの記録は互いに突き合って通り、宣言に無い組の基準値が比較や新側の測り直しに使われる
  if (declared.keys.length > 0) {
    const declaredSet = new Set(declared.keys);
    for (const key of new Set([...shot, ...scopeByKey.keys()])) {
      if (!declaredSet.has(key)) {
        findings.push({
          code: "recorded-combination-undeclared",
          message: `${key} は noise_baseline / capture_scope に記録があるが、撮影条件（pages × states × viewports と display_axes.variants）が宣言した組に無い（消した・改名した変種や窓の古い記録を消す）`,
        });
      }
    }
  }
  for (const key of scopeByKey.keys()) {
    if (shot.size > 0 && !shot.has(key)) {
      findings.push({
        code: "scope-entry-unknown",
        message: `capture_scope の ${key} は noise_baseline に無い組（撮っていない組の実測が混ざっている）`,
      });
    }
  }
  for (const entry of scopeByKey.values()) {
    const derived = deriveHoles(entry, { elements, scrollbars: conditions.scrollbars });
    holes.push(...derived.holes);
    findings.push(...derived.findings);
  }
  const hasContainer = [...scopeByKey.values()].some(
    (entry) => Array.isArray(entry.scroll_containers) && entry.scroll_containers.length > 0,
  );
  if (hasContainer && !elements) {
    findings.push({
      code: "traits-elements-unreadable",
      message:
        "traits.elements が空でない文字列の配列ではない（内部スクロール器が特性照合の対象かを判定できない）",
    });
  }

  const exemptions = conditions.capture_scope_exemptions ?? [];
  if (!Array.isArray(exemptions)) {
    findings.push({
      code: "exemptions-malformed",
      message: "capture_conditions.capture_scope_exemptions が配列ではない",
    });
    return {
      findings,
      holes,
      counts: { declared: declared.keys.length, combinations: shot.size, holes: holes.length },
      structural: false,
      judged: true,
    };
  }
  /** @type {Map<string, Record<string, unknown>>} */
  const exemptionById = new Map();
  for (const raw of exemptions) {
    const exemption = /** @type {Record<string, unknown>} */ (raw ?? {});
    if (!nonEmptyString(exemption.id)) {
      findings.push({
        code: "exemption-id-missing",
        message:
          "capture_scope_exemptions に id の無い要素がある（どの穴を対象外にしたか決まらない）",
      });
      continue;
    }
    const id = String(exemption.id);
    if (exemptionById.has(id)) {
      findings.push({
        code: "exemption-duplicated",
        message: `capture_scope_exemptions に ${id} が 2 つ以上ある`,
      });
    }
    exemptionById.set(id, exemption);
  }
  const holeIds = new Set(holes.map((hole) => hole.id));
  for (const hole of holes) {
    const exemption = exemptionById.get(hole.id);
    if (!exemption) {
      findings.push({
        code: "hole-unexempted",
        message: `撮る範囲に穴がある: ${hole.detail}（id: ${hole.id}）。範囲を広げて撮り直すか、対象外として理由付きで宣言する`,
      });
      continue;
    }
    if (!nonEmptyString(exemption.reason)) {
      findings.push({
        code: "exemption-reason-missing",
        message: `${hole.id} の宣言に reason が無い（なぜ撮らないかが残らない）`,
      });
    }
    if (!nonEmptyString(exemption.gaps_ref)) {
      findings.push({
        code: "exemption-gaps-ref-missing",
        message: `${hole.id} の宣言に gaps_ref が無い（gaps.md の未検証領域へ回らないと、対象外が誰にも見えない）`,
      });
    }
  }
  for (const id of exemptionById.keys()) {
    if (!holeIds.has(id)) {
      findings.push({
        code: "exemption-ineffective",
        message: `${id} の宣言に対応する穴が無い（効かない宣言。範囲を狭めても静かに通る状態になるので消す）`,
      });
    }
  }

  return {
    findings,
    holes,
    counts: { declared: declared.keys.length, combinations: shot.size, holes: holes.length },
    structural: false,
    judged: true,
  };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ readFile?: (path: string) => string, cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const cwd = deps.cwd ?? process.cwd();
  const write = deps.write ?? ((s) => process.stdout.write(s));
  const writeErr = deps.writeErr ?? ((s) => process.stderr.write(s));
  const usage = "usage: capture-scope-check.mjs --metadata <.replace/parity/<slug>/metadata.json>";
  /**
   * 引数・入力の誤りを stderr へ知らせる（判定結果ではないので stdout の JSON には混ぜない）。
   * @param {string} message
   * @returns {number}
   */
  const fail = (message) => {
    writeErr(`error: ${message}\n${usage}\n`);
    return 2;
  };
  const out = (obj) =>
    write(
      `${JSON.stringify({ tool: "capture-scope-check", version: VERSION, ...obj }, null, 2)}\n`,
    );
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      return fail(`不明な引数: ${key}`);
    }
    const value = argv[i + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      return fail(`${key} に値がない`);
    }
    if (args[key] !== undefined) {
      return fail(`${key} が複数ある`);
    }
    args[key] = value;
    i += 1;
  }
  const unknown = Object.keys(args).filter((k) => k !== "--metadata");
  if (unknown.length > 0) {
    return fail(`不明な引数: ${unknown.join(", ")}`);
  }
  const metadataPath = args["--metadata"];
  if (!metadataPath) {
    return fail("--metadata は必須");
  }
  let metadata;
  try {
    metadata = JSON.parse(readFile(resolve(cwd, metadataPath)));
  } catch (error) {
    return fail(`${metadataPath} を読めない: ${error && error.message}`);
  }
  const result = checkCaptureScope(metadata);
  if (result.structural) {
    out({ ok: false, structural: true, findings: result.findings, counts: result.counts });
    return 2;
  }
  out({
    ok: result.findings.length === 0,
    judged: result.judged,
    findings: result.findings,
    holes: result.holes,
    counts: { ...result.counts, findings: result.findings.length },
  });
  return result.findings.length === 0 ? 0 : 1;
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
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
