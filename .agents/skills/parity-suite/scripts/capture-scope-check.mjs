// 撮る範囲の抜けを採取の段で数える検査（原本）。
//
// 何のためか: 撮る範囲が狭いと、**実装したあとに範囲外の差分が現れる**。
// そこで範囲を広げて撮り直すことになるが、**現側も撮り直し**なので反復が 1 つ増える。
// 範囲の狭さは「差分が出なかった」と同じ見え方になる。**差分ツールは撮った 2 枚しか比べない**ので、
// 撮らなかった領域は永久に差 0 件として通る。だから**撮る段で抜けを数える**。
//
// この検査が落とすのは次の 4 つである。出力では、この抜けを `穴` と表示する。
//   1. 撮影組の取りこぼし。ノイズ基準値を採った組（ページ × 状態 × ビューポート）に、範囲の実測が無い。
//      「範囲を測っていない組」と「抜けの無い組」を同じ見え方にしない。
//   2. 文書が撮影領域より大きい（`below-fold` / `beyond-right`）。`full_page: false` で下・右が切れている。
//   3. 内部のスクロール領域の外（`scroll:<名前>`）。スクロール領域の `scrollHeight` / `scrollWidth` が
//      `clientHeight` / `clientWidth` より大きく、画素にも特性にも出ない領域がスクロール領域の中に残っている
//      （仮想スクロール・固定高のグリッドが該当する）。
//      あわせてスクロール領域ごとに、次の 2 つも抜けとして数える。
//      - 特性照合にスクロール領域が無い（`untraced:<名前>`）。スクロール領域の名前が `traits.elements` に無く、
//        スクロールバーの有無・厚み・見た目が trait-capture.mjs の `scroll` に採られない。
//      - スクロールバーを表示して撮ったのに、はみ出した向きのバーが場所を取っていない（`scrollbar-hidden:<名前>`）。
//        `--hide-scrollbars` が残っているか、オーバーレイ型・`scrollbar-width: none` のバーである。
//   4. 撮影領域の外にある論理名付き要素（`offscreen:<名前>`）。特性は採れても、画素には記録されない。
//
// あわせて、**スクロールバーが場所を取る窓でのはみ出し**の宣言を数える（`checkOverflow`）。
// スクロールバーを隠した撮影では `100vh` と `height: 100%` の差が 0 になり、上の抜けと同じく「差分 0 件」と誤って判定されるためである。
// 撮影時の扱い（`scrollbars`）は `shown` をデフォルトにする。`hidden` で撮るなら理由（`scrollbars_reason`）を、
// `shown` ならどの環境のスクロールバーで撮ったか（`scrollbar_environment`）を書かせる。
// **表示を切り替える軸**（ロケール・配色テーマなど。`checkDisplayAxes`）も数える。デフォルトの 1 値だけで撮ると、
// 他の値での差がどの比較方法にも表れない。デフォルト以外の値ごとの撮影（変種）は撮るはずの組に入り、
// 撮っていなければ `#not-captured` の抜けになる。
// **採取環境と利用者環境の一致**（`checkViewerEnvironment` / `checkBrowser`）も数える。「未確認」のままでは、
// 採取環境でだけ成立する一致が、差分ゼロのまま収束する。
//
// 抜けは消すか、**対象外として理由付きで宣言する**（`capture_scope_exemptions`）。宣言の無い抜けは落とす。
// 機能しない宣言（対応する抜けが無い）も落とす。古い宣言が残っていると、範囲を狭めてもチェックがエラーを出さない。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは `metadata.json` だけで、ブラウザは駆動しない
// （範囲の実測は採取スペックが行い、その結果をこのスクリプトが数える）。TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 条件を満たす、1 ＝ 抜け・不整合が残る（採取へ戻す）、2 ＝ 使い方の誤り・型崩れ。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { errorMessage } from "./lib/errors.mjs";
import {
  isInteger,
  isObjectLike,
  isPlainObject,
  nonEmptyString,
  nonNegativeNumber,
  positiveNumber,
} from "./lib/guards.mjs";

/**
 * ツールのバージョン（原本）。判定規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "5";

/** `metadata.json` の `mode` の語彙（原本は parity-suite の SKILL.md）。視覚採取物を持つのは `feature` だけ。 */
export const MODES = ["feature", "api-resource", "batch"];

/** 撮影組の鍵の区切り。ページ名・状態名・ビューポート label にこの文字は使えない。 */
export const KEY_SEPARATOR = "|";

/** 抜けの id の区切り（`<鍵>#<種別>:<名前>`）。鍵の材料・スクロール領域の名前・論理名にこの文字は使えない。 */
export const ID_SEPARATOR = "#";

/**
 * id の材料として安全か（区切り文字を含まない非空の文字列）。
 *
 * **id は利用者が `capture_scope_exemptions` へ書き写す**ので、符号化で逃げず材料の側で弾く。
 * 区切りを含めると別々の抜けが同じ id になり、**1 つの宣言が 2 つの抜けを対象外にしてしまう**。
 * 例えば、ビューポート `v#scroll:x` の below-fold と、ビューポート `v` のスクロール領域 `x#below-fold` は、
 * どちらも `p|s|v#scroll:x#below-fold` になる。
 * @param {unknown} value
 * @returns {value is string & { readonly __idPartIsSafe: true }}
 */
export function idPartIsSafe(value) {
  return nonEmptyString(value) && !value.includes(KEY_SEPARATOR) && !value.includes(ID_SEPARATOR);
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
 * **入っていると別々の組が同じ鍵に潰れる**。`("a|b", "c", "d")` と `("a", "b|c", "d")` はどちらも
 * `a|b|c|d` になり、1 つの範囲の実測が 2 つの撮影組を満たしたことになって抜けが消える。
 * 鍵は抜けの id にも入る（利用者が `capture_scope_exemptions` に書き写す）ので、
 * 符号化で回避せず**材料の側で弾く**。
 * @param {{page?: unknown, state?: unknown, viewport?: unknown}} entry
 * @returns {boolean}
 */
export function keyPartsAreSafe(entry) {
  return [entry.page, entry.state, entry.viewport].every((part) => idPartIsSafe(part));
}

/**
 * display_axes の 4 つの一覧を取り出す。どれかが配列でなければ、最初に見つけたキーの名前を返す
 * （axes・absent・pairs・variants の順。キーの名前と検査を 1 か所にまとめる）。
 * @param {Record<string, unknown>} da
 * @returns {{ axes: unknown[], absent: unknown[], pairs: unknown[], variants: unknown[] } | string}
 */
function displayAxisLists(da) {
  const { axes, absent, pairs, variants } = da;
  if (!isArray(axes)) return "axes";
  if (!isArray(absent)) return "absent";
  if (!isArray(pairs)) return "pairs";
  if (!isArray(variants)) return "variants";
  return { axes, absent, pairs, variants };
}

/**
 * 語彙（文字列の一覧）のどれかと一致する文字列か。
 * @param {readonly string[]} list
 * @param {unknown} value
 * @returns {value is string & { readonly __isOneOf: true }}
 */
function isOneOf(list, value) {
  return typeof value === "string" && list.includes(value);
}

/**
 * 寸法（`{width, height}`）を検証して返す。型崩れ・0 以下なら null。
 *
 * **0 を通さない**。同梱テンプレートは寸法を `0` で置いてあるので、
 * プレースホルダのまま書いた組は文書も撮影領域も 0×0 になり、寸法の比較では抜けが 1 つも出ない。
 * 「測っていない組」が「抜けの無い組」と同じ見え方になるため、実測値は正の数だけを受ける。
 * @param {unknown} value
 * @returns {{width:number, height:number} | null}
 */
function readSize(value) {
  if (!isObjectLike(value)) return null;
  const size = value;
  if (!positiveNumber(size.width) || !positiveNumber(size.height)) return null;
  return { width: size.width, height: size.height };
}

/** CSS の `overflow-x` / `overflow-y` の計算値の語彙。 */
export const OVERFLOW_VALUES = ["visible", "hidden", "clip", "scroll", "auto"];

/** スクロールバーを描く `overflow` の値（`hidden` / `clip` は切るだけでバーを描かない）。 */
const SCROLLBAR_OVERFLOW = ["scroll", "auto"];

/**
 * `deriveHoles` が抜けと finding を集める先と、1 つの撮影組の判定に使う材料。
 * @typedef {{
 *   key: string,
 *   elements: Set<string> | null,
 *   scrollbars: unknown,
 *   holes: {id:string, kind:string, detail:string}[],
 *   findings: {code:string, message:string}[],
 * }} HoleContext
 */

/**
 * 1 つの撮影組の実測から抜けを導く。
 *
 * **抜けは記録された `holes` ではなく寸法から導く**。書き手が挙げた分だけを見ると、
 * 挙げ忘れた抜けが「抜けが無い」と同じ見え方になる。
 *
 * `context.elements` は `traits.elements`（特性照合する論理名）の集合。null（読めない）ならスクロール領域ごとの
 * `untraced` の判定をしない（読めないことは呼び出し側が finding にする）。`context.scrollbars` は撮影時の扱いで、
 * `shown` のときだけ `scrollbar-hidden` の検出の確認を当てる（`hidden` ではバーの厚み 0 が正規の値）。
 * @param {Record<string, unknown>} entry
 * @param {{ elements?: Set<string> | null, scrollbars?: unknown }} [context]
 * @returns {{ holes: {id:string, kind:string, detail:string}[], findings: {code:string, message:string}[] }}
 */
export function deriveHoles(entry, context = {}) {
  /** @type {HoleContext} */
  const ctx = {
    key: combinationKey(entry),
    elements: context.elements ?? null,
    scrollbars: context.scrollbars,
    holes: [],
    findings: [],
  };
  const { key, holes, findings } = ctx;
  const document = readSize(entry.document);
  const captured = readSize(entry.captured);
  if (!document || !captured) {
    findings.push({
      code: "scope-size-unreadable",
      message: `${key} の document / captured の寸法が数値で書かれていない（測っていないことを、抜けが無いこととして扱わない）`,
    });
    return { holes, findings };
  }
  pageSizeHoles(ctx, document, captured);
  scrollContainerHoles(ctx, entry.scroll_containers);
  outsideElementHoles(ctx, entry.named_elements_outside);
  return { holes, findings };
}

/**
 * 文書が撮影領域より大きい向き（下・右）を抜けにする。
 * @param {HoleContext} ctx
 * @param {{width:number, height:number}} document
 * @param {{width:number, height:number}} captured
 */
function pageSizeHoles(ctx, document, captured) {
  const { key, holes } = ctx;
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
}

/**
 * 内部のスクロール領域（`scroll_containers`）ごとに抜けを導く。
 * @param {HoleContext} ctx
 * @param {unknown} containers
 */
function scrollContainerHoles(ctx, containers) {
  if (!isArray(containers)) {
    ctx.findings.push({
      code: "scroll-containers-missing",
      message: `${ctx.key} に scroll_containers が無い（内部のスクロール領域を数えていないことと、スクロール領域が無いことを書き分ける。無ければ空配列を書く）`,
    });
    return;
  }
  /** @type {Set<string>} */
  const seen = new Set();
  for (const raw of containers) {
    scrollContainerEntryHoles(ctx, raw, seen);
  }
}

/**
 * スクロール領域 1 つの名前・寸法・overflow・スクロールバーの厚みを読み、抜けを導く。
 * @param {HoleContext} ctx
 * @param {unknown} raw
 * @param {Set<string>} seen
 */
function scrollContainerEntryHoles(ctx, raw, seen) {
  /** @type {Record<string, unknown>} */
  const container = isObjectLike(raw) ? raw : {};
  const name = scrollContainerName(ctx, container.name, seen);
  if (name === null) return;
  const client = readSize(container.client);
  const scroll = readSize(container.scroll);
  if (!client || !scroll) {
    ctx.findings.push({
      code: "scroll-container-size-unreadable",
      message: `${ctx.key} の scroll_containers[${name}] の client / scroll が数値で書かれていない`,
    });
    return;
  }
  if (scroll.height > client.height || scroll.width > client.width) {
    ctx.holes.push({
      id: `${ctx.key}#scroll:${name}`,
      kind: "scroll-container",
      detail: `スクロール領域 ${name} の内容 ${scroll.width}x${scroll.height} が可視部 ${client.width}x${client.height} より大きい`,
    });
  }
  const bars = scrollContainerBars(ctx, container, name);
  if (!bars) return;
  if (ctx.elements && !ctx.elements.has(name)) {
    ctx.holes.push({
      id: `${ctx.key}#untraced:${name}`,
      kind: "untraced-scroll-container",
      detail: `スクロール領域 ${name} が traits.elements に無い（スクロールバーの有無・厚み・見た目が特性照合で採られない。スクロール領域に論理名を付けて採る）`,
    });
  }
  scrollbarHiddenHole(ctx, name, { client, scroll, ...bars });
}

/**
 * スクロール領域の名前を検査して返す。id に使えない名前なら finding を足して null を返す。
 * 重複は finding を足すが、名前は返す（同じ名前の抜けも導く）。
 * @param {HoleContext} ctx
 * @param {unknown} name
 * @param {Set<string>} seen
 * @returns {string | null}
 */
function scrollContainerName(ctx, name, seen) {
  const { key, findings } = ctx;
  if (!nonEmptyString(name)) {
    findings.push({
      code: "scroll-container-name-missing",
      message: `${key} の scroll_containers に名前の無い要素がある（抜けの id が決まらない）`,
    });
    return null;
  }
  if (!idPartIsSafe(name)) {
    findings.push({
      code: "scroll-container-name-unsafe",
      message: `${key} の scroll_containers[${String(name)}] に区切り文字（${KEY_SEPARATOR} / ${ID_SEPARATOR}）が入っている（別々の抜けが同じ id になり、1 つの宣言が 2 つの抜けを対象外にしてしまう）`,
    });
    return null;
  }
  if (seen.has(name)) {
    findings.push({
      code: "scroll-container-duplicated",
      message: `${key} の scroll_containers に ${name} が 2 つ以上ある（宣言がどちらに当たるか決まらない）`,
    });
  }
  seen.add(name);
  return name;
}

/**
 * スクロール領域ごとの overflow とスクロールバーの厚みを読む。読めなければ finding を足して null を返す。
 * @param {HoleContext} ctx
 * @param {Record<string, unknown>} container
 * @param {string} name
 * @returns {{ overflowX: string, overflowY: string, bar: { vertical: number, horizontal: number } } | null}
 */
function scrollContainerBars(ctx, container, name) {
  // スクロール領域ごとの overflow とスクロールバーの厚み。寸法だけでは、現行が overflow: auto で横のバーを出し、
  // 新側が overflow-x: hidden で右端を切る差が見えない（バーを隠して撮ると client と scroll が両側とも揃う）
  const overflowX = container.overflow_x;
  const overflowY = container.overflow_y;
  if (!isOneOf(OVERFLOW_VALUES, overflowX) || !isOneOf(OVERFLOW_VALUES, overflowY)) {
    ctx.findings.push({
      code: "scroll-container-overflow-unreadable",
      message: `${ctx.key} の scroll_containers[${name}] の overflow_x / overflow_y が計算値の語彙（${OVERFLOW_VALUES.join(" / ")}）で書かれていない`,
    });
    return null;
  }
  const bar = container.bar;
  if (
    !isObjectLike(bar) ||
    !nonNegativeNumber(bar.vertical) ||
    !nonNegativeNumber(bar.horizontal)
  ) {
    ctx.findings.push({
      code: "scroll-container-bar-unreadable",
      message: `${ctx.key} の scroll_containers[${name}] の bar（vertical: 縦のバーの幅 / horizontal: 横のバーの高さ。枠を除く）が 0 以上の数で書かれていない`,
    });
    return null;
  }
  return { overflowX, overflowY, bar: { vertical: bar.vertical, horizontal: bar.horizontal } };
}

/**
 * スクロールバーを表示して撮ったのに、はみ出した向きのバーが場所を取っていなければ抜けにする。
 * @param {HoleContext} ctx
 * @param {string} name
 * @param {{ client: {width:number, height:number}, scroll: {width:number, height:number}, overflowX: string, overflowY: string, bar: { vertical: number, horizontal: number } }} measured
 */
function scrollbarHiddenHole(ctx, name, measured) {
  const { client, scroll, overflowX, overflowY, bar } = measured;
  // バーを描く overflow ではみ出しているのに厚みが 0 なら、バーが場所を取っていない（隠したまま撮ったことを検出する）
  const hiddenVertical =
    scroll.height > client.height && SCROLLBAR_OVERFLOW.includes(overflowY) && bar.vertical === 0;
  const hiddenHorizontal =
    scroll.width > client.width && SCROLLBAR_OVERFLOW.includes(overflowX) && bar.horizontal === 0;
  if (ctx.scrollbars === "shown" && (hiddenVertical || hiddenHorizontal)) {
    ctx.holes.push({
      id: `${ctx.key}#scrollbar-hidden:${name}`,
      kind: "scrollbar-hidden",
      detail: `スクロール領域 ${name} は${hiddenVertical ? "縦" : "横"}にはみ出しているのにスクロールバーの厚みが 0（scrollbars: shown で撮ったはずが --hide-scrollbars が残っているか、オーバーレイ型・scrollbar-width: none のバー）`,
    });
  }
}

/**
 * 撮影領域の外にある論理名（`named_elements_outside`）を抜けにする。
 * @param {HoleContext} ctx
 * @param {unknown} outside
 */
function outsideElementHoles(ctx, outside) {
  if (!isArray(outside)) {
    ctx.findings.push({
      code: "named-elements-outside-missing",
      message: `${ctx.key} に named_elements_outside が無い（撮影領域の外に出た論理名を数えていない。無ければ空配列を書く）`,
    });
    return;
  }
  /** @type {Set<string>} */
  const seenOutside = new Set();
  for (const name of outside) {
    outsideElementHole(ctx, name, seenOutside);
  }
}

/**
 * 撮影領域の外にある論理名 1 つを検査し、抜けにする。
 * @param {HoleContext} ctx
 * @param {unknown} name
 * @param {Set<string>} seenOutside
 */
function outsideElementHole(ctx, name, seenOutside) {
  const { key, findings } = ctx;
  if (!nonEmptyString(name)) {
    findings.push({
      code: "named-element-name-missing",
      message: `${key} の named_elements_outside に空の要素がある`,
    });
    return;
  }
  if (!idPartIsSafe(name)) {
    findings.push({
      code: "named-element-name-unsafe",
      message: `${key} の named_elements_outside の ${String(name)} に区切り文字（${KEY_SEPARATOR} / ${ID_SEPARATOR}）が入っている（別々の抜けが同じ id になる）`,
    });
    return;
  }
  // **同じ論理名が 2 つあると同じ id の抜けが 2 つできる**。1 つの宣言で両方が消えるので、
  // スクロール領域の名前と同じく重複の側で落とす（棚卸しが潰れたまま exit 0 にしない）。
  if (seenOutside.has(name)) {
    findings.push({
      code: "named-element-duplicated",
      message: `${key} の named_elements_outside に ${name} が 2 つ以上ある（同じ id の抜けが 2 つでき、1 つの宣言で両方が消える）`,
    });
    return;
  }
  seenOutside.add(name);
  ctx.holes.push({
    id: `${key}#offscreen:${name}`,
    kind: "offscreen-named-element",
    detail: `論理名 ${name} が撮影領域の外にある（特性は採れても画素には表れない）`,
  });
}

/**
 * 撮影条件が宣言した組（ページ × 状態 × ビューポート）を列挙する。
 *
 * **突き合わせ相手を `noise_baseline` だけにしない**。採った組の一覧を期待値にすると、
 * 宣言した組を採らずに落とした場合に「採っていない組」が一覧から消え、
 * 抜けが 1 つも出ないまま通る（範囲の狭さが差分 0 件と同じ見え方になる、というこの検査の前提そのもの）。
 * 期待値は `capture_conditions` の 3 軸から作り、採った側・測った側の双方と突き合わせる。
 *
 * 軸の材料に区切り文字が入ると別々の組が同じ鍵に潰れるため、`keyPartsAreSafe` と同じ規律で材料の側を弾く。
 *
 * **表示の軸の値ごとの撮影（`display_axes.variants`）も撮るはずの組に入れる**。変種の label は
 * ビューポートの軸の値として扱い（`noise_baseline` / `capture_scope` の `viewport` に書く）、全ページ × 全状態を期待する。
 * 変種が持つ軸を `not_applicable` と宣言したページだけは期待しない。
 * @param {Record<string, unknown>} conditions
 * @param {{ variants: {label:string, axes:string[]}[], notApplicable: Map<string, Set<string>> }} [displayAxes]
 * @returns {{ keys: string[], findings: {code:string, message:string}[] }}
 */
export function declaredCombinations(conditions, displayAxes) {
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  const pages = declaredAxisValues(findings, {
    value: conditions.pages,
    axis: "pages",
    pick: (element) => (isObjectLike(element) ? element.name : undefined),
  });
  const states = declaredAxisValues(findings, {
    value: conditions.states,
    axis: "states",
    pick: (element) => element,
  });
  const viewports = declaredAxisValues(findings, {
    value: conditions.viewports,
    axis: "viewports",
    pick: (element) => (isObjectLike(element) ? element.label : undefined),
  });
  /** @type {string[]} */
  const keys = [];
  for (const page of pages) {
    for (const state of states) {
      for (const viewport of viewports) {
        keys.push(combinationKey({ page, state, viewport }));
      }
    }
  }
  keys.push(...variantCombinations(displayAxes, pages, states));
  return { keys, findings };
}

/**
 * 撮影条件の 1 つの軸の値を、鍵の材料として使える名前の一覧にする。
 * @param {{code:string, message:string}[]} findings
 * @param {{ value: unknown, axis: string, pick: (element: unknown) => unknown }} source
 * @returns {string[]}
 */
function declaredAxisValues(findings, source) {
  const { value, axis, pick } = source;
  if (!isArray(value) || value.length === 0) {
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
    const text = name;
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
}

/**
 * 表示の軸の変種ごとに撮るはずの組（変種の label をビューポートの軸の値にした組）を列挙する。
 * @param {{ variants: {label:string, axes:string[]}[], notApplicable: Map<string, Set<string>> } | undefined} displayAxes
 * @param {string[]} pages
 * @param {string[]} states
 * @returns {string[]}
 */
function variantCombinations(displayAxes, pages, states) {
  /** @type {string[]} */
  const keys = [];
  for (const variant of displayAxes?.variants ?? []) {
    for (const page of pages) {
      const excluded = variant.axes.some((axis) => displayAxes?.notApplicable.get(axis)?.has(page));
      if (excluded) continue;
      for (const state of states) {
        keys.push(combinationKey({ page, state, viewport: variant.label }));
      }
    }
  }
  return keys;
}

/**
 * 表示を切り替える軸の候補（原本）。
 *
 * **軸は思いついた分だけ数えると、数えなかった軸の値での差がどの比較方法にも表れない**（ロケールを数えずに English だけで撮り、
 * 利用者が Japanese で開いて初めて気づいた）。候補の全件を「在る（`axes[].candidate`）」か「無い（`absent`）」に振り分けさせ、
 * 振り分けていない候補を落とす。一覧に無い軸は `candidate: "other"` で足す。
 * スクロールバーの出方（常に表示・オーバーレイ）は利用者の OS・ブラウザの設定で変わる軸として数える。
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
 * 軸の名前・値として使えるか。組の鍵と抜けの id に入る label の材料にはしないが、
 * 宣言の突き合わせで `名前=値` の形に並べるので、`=` と `,` も弾く。
 * @param {unknown} value
 * @returns {value is string & { readonly __axisPartIsSafe: true }}
 */
function axisPartIsSafe(value) {
  return idPartIsSafe(value) && !String(value).includes("=") && !String(value).includes(",");
}

/**
 * 根拠として数えてよい文字列か（空でなく、テンプレートの <…> や TODO・未確認のようなプレースホルダで始まらない）。
 * 空でないだけで数えると、同梱テンプレートの値を埋めずに残した軸が「出所付きで数えた」ことになる。
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
 * `checkDisplayAxes` の各段が読み書きする状態。
 * @typedef {{
 *   add: (code: string, message: string) => void,
 *   declaredPages: string[],
 *   baseViewports: string[],
 *   candidateIds: string[],
 *   surveyed: Map<string, string>,
 *   axes: Map<string, {values:string[], default:string}>,
 *   notApplicable: Map<string, Set<string>>,
 *   labels: Set<string>,
 *   variantKeys: Set<string>,
 *   signatures: Set<string>,
 *   decided: Map<string, boolean>,
 *   variantsOut: {label:string, axes:string[]}[],
 * }} DisplayAxesState
 */

/**
 * 表示を切り替える軸（`capture_conditions.display_axes`）の宣言を検査する。
 *
 * 落とすのは 4 群。
 *   1. 数えていない。キーごと無い・候補の一覧に振り分けていない候補がある。
 *   2. 値の撮り忘れ。デフォルト以外の値ごとに、他の軸をデフォルトのままその値だけを振った変種が無い（1 軸ずつ振る）。
 *   3. 掛け合わせの判断の抜け。軸（とビューポート）の対ごとに、掛けたか掛けなかったかと理由が無い。
 *      または、掛けると宣言した対の組み合わせの変種が無い。
 *   4. スイートに反映していない。軸ごとに、値ごとの期待値を読む箇所か、値で文言・振る舞いが変わらない根拠が無い。
 *
 * 撮った組の数え直しはここではしない。変種の label を `declaredCombinations` に渡し、
 * 撮っていない組を `#not-captured` の抜けとして他の抜けと同じ処理で数える。
 * @param {Record<string, unknown>} conditions
 * @returns {{ findings: {code:string, message:string}[], variants: {label:string, axes:string[]}[], notApplicable: Map<string, Set<string>> }}
 */
export function checkDisplayAxes(conditions) {
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  /**
   * @param {string} code
   * @param {string} message
   */
  const add = (code, message) => findings.push({ code, message });
  /** @type {{label:string, axes:string[]}[]} */
  const variantsOut = [];
  /** @type {Map<string, Set<string>>} */
  const notApplicable = new Map();
  const result = () => ({ findings, variants: variantsOut, notApplicable });

  const lists = readDisplayAxisLists(conditions, add);
  if (lists === null) return result();
  /** @type {DisplayAxesState} */
  const st = {
    add,
    declaredPages: stringFields(conditions.pages, "name"),
    baseViewports: stringFields(conditions.viewports, "label"),
    candidateIds: AXIS_CANDIDATES.map((c) => c.id),
    surveyed: new Map(),
    axes: new Map(),
    notApplicable,
    labels: new Set(),
    variantKeys: new Set(),
    signatures: new Set(),
    decided: new Map(),
    variantsOut,
  };
  lists.axes.forEach((rawAxis, i) => checkDisplayAxis(st, rawAxis, i));
  lists.absent.forEach((rawAbsent, i) => checkAbsentAxis(st, rawAbsent, i));
  checkUnsurveyedCandidates(st);
  lists.variants.forEach((rawVariant, i) => checkDisplayVariant(st, rawVariant, i));
  checkValueSweep(st);
  lists.pairs.forEach((rawPair, i) => checkAxisPair(st, rawPair, i));
  checkPairCoverage(st);
  return result();
}

/**
 * `display_axes` を読み、4 つの一覧を返す。キーが無い・形が違うなら finding を足して null を返す。
 * @param {Record<string, unknown>} conditions
 * @param {(code: string, message: string) => void} add
 * @returns {{ axes: unknown[], absent: unknown[], pairs: unknown[], variants: unknown[] } | null}
 */
function readDisplayAxisLists(conditions, add) {
  if (!Object.hasOwn(conditions, "display_axes")) {
    add(
      "display-axes-missing",
      "capture_conditions.display_axes が無い（表示を切り替える軸〈ロケール・配色テーマ等〉を数えていない。デフォルトの 1 値だけで撮ると、他の値での差は 3 つの比較方法のどれにも表れない）",
    );
    return null;
  }
  const raw = conditions.display_axes;
  if (!isPlainObject(raw)) {
    add("display-axes-malformed", "capture_conditions.display_axes がオブジェクトではない");
    return null;
  }
  const lists = displayAxisLists(raw);
  if (typeof lists === "string") {
    add(
      "display-axes-malformed",
      `capture_conditions.display_axes.${lists} が配列ではない（空でもキーごと書く。欠落は「数えていない」と区別できない）`,
    );
    return null;
  }
  return lists;
}

/**
 * オブジェクトの配列から、指定した欄の文字列だけを並べる（配列でなければ空）。
 * @param {unknown} list
 * @param {string} field
 * @returns {string[]}
 */
function stringFields(list, field) {
  return isArray(list)
    ? list
        .map((item) => (isObjectLike(item) ? item[field] : undefined))
        .filter((value) => typeof value === "string")
    : [];
}

/**
 * 候補を「在る」か「無い」のどちらかに振り分けたことを記録する。
 * @param {DisplayAxesState} st
 * @param {unknown} candidate
 * @param {string} where
 */
function surveyCandidate(st, candidate, where) {
  const { candidateIds, surveyed, add } = st;
  if (candidate === OTHER_CANDIDATE) return;
  if (!isOneOf(candidateIds, candidate)) {
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
}

/**
 * `display_axes.axes` の 1 つを検査し、使える軸なら `st.axes` と `st.notApplicable` に入れる。
 * @param {DisplayAxesState} st
 * @param {unknown} rawAxis
 * @param {number} i
 */
function checkDisplayAxis(st, rawAxis, i) {
  const { add } = st;
  const at = `display_axes.axes[${i}]`;
  /** @type {Record<string, unknown>} */
  const axis = isObjectLike(rawAxis) ? rawAxis : {};
  const name = axis.name;
  if (!axisPartIsSafe(name) || name === VIEWPORT_AXIS) {
    add(
      "display-axis-name-unusable",
      `${at} の name が使えない（空・区切り文字 | # = , を含む・予約語 "${VIEWPORT_AXIS}"）: ${JSON.stringify(name)}`,
    );
    return;
  }
  const axisName = name;
  if (st.axes.has(axisName)) {
    add("display-axis-duplicated", `display_axes.axes に ${axisName} が 2 つ以上ある`);
    return;
  }
  surveyCandidate(st, axis.candidate, at);
  /** @type {AxisWhere} */
  const where = { at, axisName, excludedPages: new Set() };
  const valueList = axisValueList(st, where, axis.values);
  if (typeof axis.default !== "string" || !valueList.includes(axis.default)) {
    add(
      "display-axis-default-unknown",
      `${at}（${axisName}）の default が values に無い（基準の組を撮った値が決まらない）: ${JSON.stringify(axis.default)}`,
    );
  }
  checkAxisEvidence(st, where, axis);
  const excludedPages = axisExcludedPages(st, where, axis.not_applicable ?? []);
  st.notApplicable.set(axisName, excludedPages);
  st.axes.set(axisName, {
    values: valueList,
    default: typeof axis.default === "string" ? axis.default : "",
  });
}

/**
 * 検査している軸の位置と名前、その軸が機能しないページの集合。
 * @typedef {{ at: string, axisName: string, excludedPages: Set<string> }} AxisWhere
 */

/**
 * 軸の values を検査し、使える値だけを並べる。
 * @param {DisplayAxesState} st
 * @param {AxisWhere} where
 * @param {unknown} values
 * @returns {string[]}
 */
function axisValueList(st, where, values) {
  const { at, axisName } = where;
  const { add } = st;
  /** @type {string[]} */
  const valueList = [];
  if (!isArray(values) || values.length < 2) {
    add(
      "display-axis-values-unusable",
      `${at}（${axisName}）の values が 2 つ以上の値の配列ではない（値が 1 つなら切り替えの軸ではないので absent に書く）`,
    );
    return valueList;
  }
  for (const value of values) {
    if (!axisPartIsSafe(value)) {
      add(
        "display-axis-values-unusable",
        `${at}（${axisName}）の values に使えない値がある（空・区切り文字 | # = , を含む）: ${JSON.stringify(value)}`,
      );
    } else if (valueList.includes(value)) {
      add(
        "display-axis-values-unusable",
        `${at}（${axisName}）の values に ${value} が 2 つ以上ある`,
      );
    } else {
      valueList.push(value);
    }
  }
  return valueList;
}

/**
 * 軸の出所（source）・当て方（apply）・スイートへの反映（suite_expectations / suite_reason）を検査する。
 * @param {DisplayAxesState} st
 * @param {AxisWhere} where
 * @param {Record<string, unknown>} axis
 */
function checkAxisEvidence(st, where, axis) {
  const { at, axisName } = where;
  const { add } = st;
  if (!evidenceText(axis.source)) {
    add(
      "display-axis-source-missing",
      `${at}（${axisName}）に source が無い（値の一覧をどこから数えたかの出所が残らない）`,
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
}

/**
 * 軸の not_applicable を検査し、軸が機能しないページの集合を返す。
 * @param {DisplayAxesState} st
 * @param {AxisWhere} where
 * @param {unknown} naList
 * @returns {Set<string>}
 */
function axisExcludedPages(st, where, naList) {
  const { at, axisName, excludedPages } = where;
  const { declaredPages, add } = st;
  if (!isArray(naList)) {
    add(
      "display-axis-not-applicable-malformed",
      `${at}（${axisName}）の not_applicable が配列ではない`,
    );
  } else {
    naList.forEach((rawNa, j) => notApplicableEntry(st, where, { raw: rawNa, index: j }));
  }
  // 全ページで機能しない軸は切り替えの軸ではない。変種を宣言しても撮るはずの組が 0 件になり、撮らずに通る
  if (declaredPages.length > 0 && declaredPages.every((page) => excludedPages.has(page))) {
    add(
      "display-axis-not-applicable-all-pages",
      `${at}（${axisName}）の not_applicable が撮影ページの全てを覆う（どのページでも機能しない軸は absent に書く。変種の撮るはずの組が 0 件になり、撮らずに通る）`,
    );
  }
  return excludedPages;
}

/**
 * not_applicable の 1 つを検査し、使えるなら軸が機能しないページに入れる。
 * @param {DisplayAxesState} st
 * @param {AxisWhere} where
 * @param {{ raw: unknown, index: number }} item
 */
function notApplicableEntry(st, where, item) {
  const { at, axisName, excludedPages } = where;
  const { declaredPages, add } = st;
  /** @type {Record<string, unknown>} */
  const na = isObjectLike(item.raw) ? item.raw : {};
  const page = na.page;
  if (typeof page !== "string" || !declaredPages.includes(page)) {
    add(
      "display-axis-not-applicable-page-unknown",
      `${at}.not_applicable[${item.index}] のページ ${JSON.stringify(page)} が capture_conditions.pages に無い`,
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
      `${at}（${axisName}）の not_applicable の ${page} に reason が無い（軸が機能しないことの出所が残らない）`,
    );
    return;
  }
  excludedPages.add(page);
}

/**
 * `display_axes.absent` の 1 つを検査し、候補を「無い」に振り分ける。
 * @param {DisplayAxesState} st
 * @param {unknown} rawAbsent
 * @param {number} i
 */
function checkAbsentAxis(st, rawAbsent, i) {
  const { add } = st;
  const at = `display_axes.absent[${i}]`;
  /** @type {Record<string, unknown>} */
  const absent = isObjectLike(rawAbsent) ? rawAbsent : {};
  if (absent.candidate === OTHER_CANDIDATE) {
    add(
      "display-axis-candidate-unknown",
      `${at} に "${OTHER_CANDIDATE}" は書けない（無いと言える候補は一覧の候補だけ）`,
    );
    return;
  }
  surveyCandidate(st, absent.candidate, at);
  if (!evidenceText(absent.source)) {
    add(
      "display-axis-absent-source-missing",
      `${at}（${String(absent.candidate)}）に source が無い（無いと確かめた出所が残らない。思いつかなかった軸と区別できない）`,
    );
  }
}

/**
 * axes にも absent にも振り分けていない候補を落とす。
 * @param {DisplayAxesState} st
 */
function checkUnsurveyedCandidates(st) {
  const { candidateIds, surveyed, add } = st;
  for (const id of candidateIds) {
    if (!surveyed.has(id)) {
      const label = AXIS_CANDIDATES.find((c) => c.id === id)?.label ?? id;
      add(
        "display-axis-candidate-unsurveyed",
        `表示の軸の候補 ${id}（${label}）が axes にも absent にも無い（数えていない軸の値での差は、どの比較方法にも表れない）`,
      );
    }
  }
}

/**
 * `display_axes.variants` の 1 つを検査し、使える変種なら `st.variantsOut` に入れる。
 * @param {DisplayAxesState} st
 * @param {unknown} rawVariant
 * @param {number} i
 */
function checkDisplayVariant(st, rawVariant, i) {
  const { add } = st;
  const at = `display_axes.variants[${i}]`;
  /** @type {Record<string, unknown>} */
  const variant = isObjectLike(rawVariant) ? rawVariant : {};
  const labelText = variantLabel(st, at, variant.label);
  if (labelText === null) return;
  if (typeof variant.viewport !== "string" || !st.baseViewports.includes(variant.viewport)) {
    add(
      "display-axis-variant-viewport-unknown",
      `${at}（${labelText}）の viewport ${JSON.stringify(variant.viewport)} が capture_conditions.viewports の label に無い（どの窓で撮るか決まらない）`,
    );
    return;
  }
  const picked = pickVariantValues(st, { at, labelText }, variant.values);
  if (picked === null) return;
  // 変種の軸のどれかが機能しないページは撮らない。全ページが外れる変種は撮るはずの組が 0 件になり、
  // それでも掛け合わせの対を満たしたことになるので落とす
  if (variantHasNoPages(st, picked)) {
    add(
      "display-axis-variant-no-pages",
      `${at}（${labelText}）の軸が機能するページが 1 つも無い（not_applicable が合わせて全ページを覆う。撮るはずの組が 0 件のまま掛け合わせの対を満たさない。同時に機能しない対なら crossed: false にする）`,
    );
    return;
  }
  const signature = variantSignature(picked);
  const key = `${variant.viewport}${KEY_SEPARATOR}${signature}`;
  if (st.variantKeys.has(key)) {
    add(
      "display-axis-variant-duplicated",
      `${at}（${labelText}）は同じ窓 ${variant.viewport} × ${signature} の変種が既にある（同じ撮影が 2 回期待される）`,
    );
    return;
  }
  st.variantKeys.add(key);
  st.signatures.add(signature);
  st.variantsOut.push({ label: labelText, axes: Object.keys(picked) });
}

/**
 * 変種の label を検査して返す。使えない・重なるなら finding を足して null を返す。
 * @param {DisplayAxesState} st
 * @param {string} at
 * @param {unknown} label
 * @returns {string | null}
 */
function variantLabel(st, at, label) {
  const { labels, baseViewports, add } = st;
  // label は書き出し先のディレクトリ名にもなる（page/state/label）。`.` / `..` やパスの区切りを通すと、
  // 採取の noise パスの削除が別の組のディレクトリを指す
  if (!idPartIsSafe(label) || label === "." || label === ".." || /[\\/,]/.test(label)) {
    add(
      "display-axis-variant-label-unusable",
      `${at} の label が使えない（空、区切り文字 ${KEY_SEPARATOR} / ${ID_SEPARATOR} を含む、または . / .. / パスの区切り・カンマを含む。カンマは PARITY_NOISE_PAIRS 等の区切りでもある）: ${JSON.stringify(label)}`,
    );
    return null;
  }
  const labelText = label;
  if (labels.has(labelText) || baseViewports.includes(labelText)) {
    add(
      "display-axis-variant-label-duplicated",
      `${at} の label ${labelText} が他の変種か capture_conditions.viewports の label と重なる（別々の組が同じ鍵に潰れる）`,
    );
    return null;
  }
  labels.add(labelText);
  return labelText;
}

/**
 * 変種の values（軸の名前 → デフォルト以外の値）を検査して返す。1 つでも使えない値があれば null を返す。
 * @param {DisplayAxesState} st
 * @param {{ at: string, labelText: string }} where
 * @param {unknown} values
 * @returns {Record<string, string> | null}
 */
function pickVariantValues(st, where, values) {
  if (
    !values ||
    typeof values !== "object" ||
    isArray(values) ||
    Object.keys(values).length === 0
  ) {
    st.add(
      "display-axis-variant-values-unusable",
      `${where.at}（${where.labelText}）の values が「軸の名前 → デフォルト以外の値」のオブジェクトではない`,
    );
    return null;
  }
  /** @type {Record<string, string>} */
  const picked = {};
  let usable = true;
  for (const [axisName, value] of Object.entries(values)) {
    const usableValue = variantValue(st, where, [axisName, value]);
    if (usableValue === null) {
      usable = false;
    } else {
      picked[axisName] = usableValue;
    }
  }
  return usable ? picked : null;
}

/**
 * 変種の値 1 つ（軸の名前と値）が、宣言した軸のデフォルト以外の値なら、その値を返す。違えば finding を足して null を返す。
 * @param {DisplayAxesState} st
 * @param {{ at: string, labelText: string }} where
 * @param {[string, unknown]} entry
 * @returns {string | null}
 */
function variantValue(st, where, entry) {
  const { at, labelText } = where;
  const [axisName, value] = entry;
  const axis = st.axes.get(axisName);
  if (!axis) {
    st.add(
      "display-axis-variant-values-unusable",
      `${at}（${labelText}）の values の軸 ${axisName} が display_axes.axes に無い`,
    );
    return null;
  }
  if (typeof value !== "string" || !axis.values.includes(value)) {
    st.add(
      "display-axis-variant-values-unusable",
      `${at}（${labelText}）の ${axisName} の値 ${JSON.stringify(value)} が values に無い`,
    );
    return null;
  }
  if (value === axis.default) {
    st.add(
      "display-axis-variant-values-unusable",
      `${at}（${labelText}）の ${axisName} がデフォルト値 ${value}（デフォルト値は基準の組が撮る。変種にはデフォルト以外の値だけを書く）`,
    );
    return null;
  }
  return value;
}

/**
 * 変種の軸のどれかが機能しないページを除くと、撮影ページが 1 つも残らないか。
 * @param {DisplayAxesState} st
 * @param {Record<string, string>} picked
 * @returns {boolean}
 */
function variantHasNoPages(st, picked) {
  const { declaredPages, notApplicable } = st;
  const pickedAxes = Object.keys(picked);
  return (
    declaredPages.length > 0 &&
    declaredPages.every((page) => pickedAxes.some((axis) => notApplicable.get(axis)?.has(page)))
  );
}

/**
 * 1 軸ずつ振る: 既定以外の値ごとに、その軸だけを振った変種が要る（窓は問わない）。
 * @param {DisplayAxesState} st
 */
function checkValueSweep(st) {
  const { axes, signatures, add } = st;
  for (const [axisName, axis] of axes) {
    for (const value of axis.values) {
      if (value === axis.default) continue;
      if (!signatures.has(variantSignature({ [axisName]: value }))) {
        add(
          "display-axis-value-unswept",
          `軸 ${axisName} の値 ${value} を撮る変種が無い（他の軸をデフォルトのまま ${axisName}=${value} だけを振った変種を 1 つの窓で撮る）`,
        );
      }
    }
  }
}

/**
 * 軸の対の鍵（順序に依らない）。
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function pairKey(a, b) {
  return [a, b].sort().join(",");
}

/**
 * `display_axes.pairs` の 1 つを検査し、掛け合わせの判断を `st.decided` に入れる。
 * @param {DisplayAxesState} st
 * @param {unknown} rawPair
 * @param {number} i
 */
function checkAxisPair(st, rawPair, i) {
  const { axes, decided, add } = st;
  const at = `display_axes.pairs[${i}]`;
  /** @type {Record<string, unknown>} */
  const pair = isObjectLike(rawPair) ? rawPair : {};
  const names = pair.axes;
  // `names.every(nonEmptyString)` は要素の型を絞るためにある。文字列でない名前は、宣言した軸の判定でも落ちる
  if (
    !isArray(names) ||
    names.length !== 2 ||
    names[0] === names[1] ||
    !names.every(nonEmptyString) ||
    !names.every((n) => n === VIEWPORT_AXIS || axes.has(n)) ||
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
}

/**
 * 対ごとの掛け合わせの判断: 軸（とビューポート）の対のすべてに判断があり、掛けると宣言した対の変種が揃うか。
 * @param {DisplayAxesState} st
 */
function checkPairCoverage(st) {
  const members = [...st.axes.keys()];
  const pairMembers = [...members, VIEWPORT_AXIS];
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < pairMembers.length; j += 1) {
      checkPairCrossed(st, members[i], pairMembers[j]);
    }
  }
}

/**
 * 軸の対 1 つに掛け合わせの判断があるかと、掛けると宣言したなら組み合わせの変種があるかを検査する。
 * @param {DisplayAxesState} st
 * @param {string} a
 * @param {string} b
 */
function checkPairCrossed(st, a, b) {
  const { decided, add } = st;
  const key = pairKey(a, b);
  if (!decided.has(key)) {
    add(
      "display-axis-pair-undecided",
      `軸の対 ${key} を掛け合わせるかの判断が display_axes.pairs に無い（同時に変えると結果が変わる対か、理由付きで書く）`,
    );
    return;
  }
  if (!decided.get(key)) return;
  if (b === VIEWPORT_AXIS) {
    checkViewportCrossed(st, a, key);
    return;
  }
  checkAxesCrossed(st, { a, b, key });
}

/**
 * 軸のデフォルト以外の値。
 * @param {Map<string, {values:string[], default:string}>} axes
 * @param {string} name
 * @returns {string[]}
 */
function nonDefaultValues(axes, name) {
  const axis = axes.get(name);
  return axis ? axis.values.filter((v) => v !== axis.default) : [];
}

/**
 * 軸とビューポートを掛けると宣言した対で、デフォルト以外の値 × 窓ごとの変種があるか。
 * @param {DisplayAxesState} st
 * @param {string} a
 * @param {string} key
 */
function checkViewportCrossed(st, a, key) {
  const { baseViewports, variantKeys, add } = st;
  for (const value of nonDefaultValues(st.axes, a)) {
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
}

/**
 * 2 つの軸を掛けると宣言した対で、デフォルト以外の値の組み合わせごとの変種があるか。
 * @param {DisplayAxesState} st
 * @param {{ a: string, b: string, key: string }} pair
 */
function checkAxesCrossed(st, pair) {
  const { a, b, key } = pair;
  const { signatures, add } = st;
  for (const va of nonDefaultValues(st.axes, a)) {
    for (const vb of nonDefaultValues(st.axes, b)) {
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

/**
 * 採取環境と利用者環境の一致（`capture_conditions.viewer_environment`）を検査する。
 *
 * 通すのは `一致: <確かめ方>` と `乖離: <内容と gaps.md の該当箇所>` の 2 形だけ。
 * **「未確認」を通さない**。記録しただけでは誰も読まず、採取環境でだけ成立する一致（フォントのフォールバック先等）が
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
 * `cdp` の `browser_identity.browser_os` のキー（`navigator.userAgentData.getHighEntropyValues` から、この 3 つだけを拾った形）。
 * Chromium は UA の OS 版を固定値に縮めて返す（reduced UA）ので、`product` と `user_agent` だけでは OS の版・アーキテクチャが違う機械を見分けられない。
 * `navigator.platform` への代替は認めない。`cdp` の接続先は Chromium 系で、`platform` も縮められており同じ抜けが残るからである。
 * 正規化と読み方（安全なコンテキストの頁で読む）の原本は parity-suite の references/locator-mapping.md「利用者環境のブラウザへ接続する」。
 */
export const BROWSER_OS_KEYS = ["platform", "platformVersion", "architecture"];

/**
 * 撮影に使ったブラウザ（`capture_conditions.browser`）の記録を検査する。
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
  if (!isOneOf(BROWSER_MODES, conditions.browser)) {
    return [
      {
        code: "browser-unknown",
        message: `capture_conditions.browser「${String(conditions.browser)}」が語彙外（${BROWSER_MODES.join(" / ")}）`,
      },
    ];
  }
  // cdp では接続先の同一性（Browser.version・userAgent・描画するブラウザ側の OS）も残す。モードだけでは、現・新が別の機械へ接続しても揃ったことになる
  if (conditions.browser === "cdp") {
    const identity = conditions.browser_identity;
    if (
      !isObjectLike(identity) ||
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
    return checkBrowserOs(identity.browser_os);
  }
  return [];
}

/**
 * `cdp` の `browser_identity.browser_os` を検査する。
 * 新側の雛形は同じ正規化で読んだ値とキーごとに完全一致で照合するので、形が違えば同じ機械でも照合を通らない。
 * ここで落とすのは、欠落・正規化していない形（キーの過不足。`brands` / `mobile` を残した生の値や `navigator.platform` への代替）・
 * 文字列でない値・テンプレートのプレースホルダ。`platformVersion` は空文字を認める（Linux の Chromium は空で返す。実測）。
 * @param {unknown} os
 * @returns {{code:string, message:string}[]}
 */
function checkBrowserOs(os) {
  if (!isPlainObject(os)) {
    return [
      {
        code: "browser-os-missing",
        message: `capture_conditions.browser が cdp なのに browser_identity.browser_os（${BROWSER_OS_KEYS.join(" / ")}）が無い（reduced UA では OS の版・アーキテクチャが違う機械を見分けられない）`,
      },
    ];
  }
  const record = os;
  const keys = Object.keys(record).sort();
  const sameKeys =
    keys.length === BROWSER_OS_KEYS.length &&
    [...BROWSER_OS_KEYS].sort().every((k, i) => k === keys[i]);
  const valid =
    sameKeys &&
    BROWSER_OS_KEYS.every(
      (k) => typeof record[k] === "string" && !String(record[k]).trim().startsWith("<"),
    ) &&
    evidenceText(record.platform);
  if (!valid) {
    return [
      {
        code: "browser-os-invalid",
        message: `browser_identity.browser_os ${JSON.stringify(os)} が正規化した形（${BROWSER_OS_KEYS.join(" / ")} の文字列だけ。platform は空にしない）でない（新側が同じ正規化で照合できない）`,
      },
    ];
  }
  return [];
}

/** `capture_conditions.scrollbars` の語彙。`hidden` は Playwright のヘッドレス Chromium の既定（`--hide-scrollbars`）。 */
export const SCROLLBAR_MODES = ["hidden", "shown"];

/** `capture_conditions.overflow.status` の語彙。 */
export const OVERFLOW_STATUSES = ["measured", "not_measured"];

/**
 * スクロールバーの扱いと、スクロールバーが場所を取る窓での「はみ出し」の宣言を検査する。
 *
 * **スクロールバーが隠れていると `100vh` と `height: 100%` の差が測れない。** 隠れたスクロールバーは場所を取らないので、
 * 横スクロールバーが出る窓でも「見える高さ」が減らず、頁の高さの決め方の違いが 3 つの比較方法のどれにも表れない。
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
  /**
   * @param {string} code
   * @param {string} message
   */
  const add = (code, message) => findings.push({ code, message });
  checkScrollbarMode(conditions, add);
  if (!Object.hasOwn(conditions, "overflow")) {
    add(
      "overflow-missing",
      "capture_conditions.overflow が無い（スクロールバーを表示した窓のはみ出しを測っていない。測れないなら status: not_measured と reason を書く。キーを省略したまま免除しない）",
    );
    return findings;
  }
  const overflow = conditions.overflow;
  if (
    !isObjectLike(overflow) ||
    isArray(overflow) ||
    !isOneOf(OVERFLOW_STATUSES, overflow.status)
  ) {
    add(
      "overflow-status-unknown",
      `capture_conditions.overflow.status が ${OVERFLOW_STATUSES.join(" / ")} のいずれでもない`,
    );
    return findings;
  }
  const o = overflow;
  if (o.status === "not_measured") {
    if (!nonEmptyString(o.reason)) {
      add(
        "overflow-reason-missing",
        "capture_conditions.overflow.status: not_measured に reason が無い",
      );
    }
    return findings;
  }
  checkMeasuredOverflow(conditions, o, add);
  return findings;
}

/**
 * 撮影時のスクロールバーの扱い（`scrollbars`）と、その扱いに要る記録を検査する。
 * @param {Record<string, unknown>} conditions
 * @param {(code: string, message: string) => void} add
 */
function checkScrollbarMode(conditions, add) {
  if (!Object.hasOwn(conditions, "scrollbars")) {
    add(
      "scrollbars-missing",
      `capture_conditions.scrollbars が無い（撮影時にスクロールバーが場所を取ったか。${SCROLLBAR_MODES.join(" / ")} で書く。新側を同じ扱いで撮れない）`,
    );
  } else if (!isOneOf(SCROLLBAR_MODES, conditions.scrollbars)) {
    add(
      "scrollbars-unknown",
      `capture_conditions.scrollbars「${String(conditions.scrollbars)}」が語彙外（${SCROLLBAR_MODES.join(" / ")}）`,
    );
  } else if (conditions.scrollbars === "hidden" && !evidenceText(conditions.scrollbars_reason)) {
    // デフォルトは shown。隠して撮ると、バーが場所を取る差（はみ出し・横のバーの有無）が 3 つの比較方法のどれにも表れない
    add(
      "scrollbars-hidden-reason-missing",
      "capture_conditions.scrollbars が hidden なのに scrollbars_reason が無い（デフォルトは shown。隠して撮るなら、スクロールバーが場所を取る差を測らない理由を書き gaps.md に残す）",
    );
  } else if (conditions.scrollbars === "shown" && !evidenceText(conditions.scrollbar_environment)) {
    // バーの描き方は OS とブラウザで変わるので、撮ったバーの画素を利用者環境の見え方の根拠にしない
    add(
      "scrollbar-environment-missing",
      "capture_conditions.scrollbars が shown なのに scrollbar_environment が無い（どの OS・ブラウザのどの種類〈クラシック / オーバーレイ〉のスクロールバーで撮ったかを書く）",
    );
  }
}

/**
 * `status: measured` の `overflow` を検査する（記録の形と、撮影頁ごとの実測）。
 * @param {Record<string, unknown>} conditions
 * @param {Record<string, unknown>} o
 * @param {(code: string, message: string) => void} add
 */
function checkMeasuredOverflow(conditions, o, add) {
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
  // 期待集合は撮影条件の pages（宣言）から作る。記録された頁だけを見ると、頁ごと測り忘れても通る
  const declaredPages = isArray(conditions.pages)
    ? conditions.pages.map((p) => (isObjectLike(p) ? p.name : undefined)).filter(nonEmptyString)
    : [];
  if (!isArray(o.pages)) {
    add("overflow-pages-missing", "capture_conditions.overflow.pages が配列でない");
    return;
  }
  /** @type {Set<string>} */
  const seenPages = new Set();
  o.pages.forEach((raw, i) => checkOverflowPage({ add, declaredPages, seenPages }, raw, i));
  for (const page of declaredPages) {
    if (!seenPages.has(page)) {
      add(
        "overflow-page-missing",
        `capture_conditions.overflow.pages に撮影頁 ${page} が無い（頁ごとに測る）`,
      );
    }
  }
}

/**
 * `overflow.pages` の 1 頁を検査したときに、窓ごとの検査と数え上げが読み書きする状態。
 * `minWidth` は `minWidthOk` のときだけ意味を持つ（正の整数か null）。
 * @typedef {{
 *   add: (code: string, message: string) => void,
 *   at: string,
 *   minWidthOk: boolean,
 *   minWidth: number | null,
 *   contentHeightOk: boolean,
 *   contentHeight: unknown,
 *   seenWindows: Set<string>,
 *   narrow: number,
 *   fitting: number,
 * }} OverflowPageState
 */

/**
 * `overflow.pages` の 1 頁を検査する。
 * @param {{ add: (code: string, message: string) => void, declaredPages: string[], seenPages: Set<string> }} ctx
 * @param {unknown} raw
 * @param {number} i
 */
function checkOverflowPage(ctx, raw, i) {
  const { add, declaredPages, seenPages } = ctx;
  const at = `capture_conditions.overflow.pages[${i}]`;
  /** @type {Record<string, unknown>} */
  const entry = isObjectLike(raw) ? raw : {};
  if (!nonEmptyString(entry.page)) {
    add("overflow-page-unkeyed", `${at}.page が空（どの頁の実測か決まらない）`);
    return;
  }
  const page = entry.page;
  if (seenPages.has(page)) {
    add("overflow-page-duplicated", `capture_conditions.overflow.pages に ${page} が 2 つ以上ある`);
    return;
  }
  seenPages.add(page);
  if (!declaredPages.includes(page)) {
    add("overflow-page-unknown", `${at} の頁 ${page} が capture_conditions.pages に無い`);
  }
  const ps = overflowPageLimits(add, at, entry);
  checkOverflowProbe(add, at, entry.probe);
  if (!isArray(entry.windows) || entry.windows.length === 0) {
    add("overflow-windows-missing", `${at}.windows が空（測った窓が無い）`);
    return;
  }
  entry.windows.forEach((rawWindow, j) => checkOverflowWindow(ps, rawWindow, j));
  checkNarrowWindows(ps);
}

/**
 * 頁の最小幅（`min_width`）と、狭い窓で読んだ中身の高さ（`content_height`）を検査し、窓ごとの検査の状態を作る。
 * @param {(code: string, message: string) => void} add
 * @param {string} at
 * @param {Record<string, unknown>} entry
 * @returns {OverflowPageState}
 */
function overflowPageLimits(add, at, entry) {
  const minWidth = entry.min_width;
  const minWidthOk = minWidth === null || (isInteger(minWidth) && minWidth > 0);
  if (!minWidthOk) {
    add(
      "overflow-min-width-malformed",
      `${at}.min_width が正の整数でも null でもない（最小幅を持たない頁だけ null と書く）`,
    );
  }
  // 狭い窓で読んだ中身の高さ。最小幅を持つ頁では、これより高い狭い窓（縦のはみ出しが頁の高さの決め方だけで決まる窓）を要求する。
  // 「縦にはみ出さないこと」は要求しない。body { height: 100% } と既定の margin のように、どの高さでもはみ出す正当な頁があるからである。
  const contentHeight = entry.content_height;
  const contentHeightOk = minWidth === null || (isInteger(contentHeight) && contentHeight > 0);
  if (minWidthOk && !contentHeightOk) {
    add(
      "overflow-content-height-malformed",
      `${at}.content_height が正の整数でない（最小幅より狭い窓で読んだ文書の scrollHeight を書く）`,
    );
  }
  return {
    add,
    at,
    minWidthOk,
    minWidth: minWidthOk ? minWidth : null,
    contentHeightOk,
    contentHeight,
    seenWindows: new Set(),
    narrow: 0,
    fitting: 0,
  };
}

/**
 * 最小幅の探索の範囲（`probe`）を検査する。
 * @param {(code: string, message: string) => void} add
 * @param {string} at
 * @param {unknown} rawProbe
 */
function checkOverflowProbe(add, at, rawProbe) {
  // 最小幅の探索の範囲。刻みだけの探索は狭い帯でだけ有効になる最小幅を見落とすので、メディアクエリの境界も探す。
  // 読めないスタイルシートの境界は探索できていないので、未検証として gaps.md への参照を要求する
  /** @type {Record<string, unknown>} */
  const probe = isObjectLike(rawProbe) ? rawProbe : {};
  if (
    !rawProbe ||
    typeof rawProbe !== "object" ||
    !isInteger(probe.step) ||
    probe.step <= 0 ||
    !isArray(probe.breakpoints) ||
    !probe.breakpoints.every(positiveNumber) ||
    !isInteger(probe.unreadable_stylesheets) ||
    probe.unreadable_stylesheets < 0
  ) {
    add(
      "overflow-probe-malformed",
      `${at}.probe が無いか型が不正（step: 正の整数、breakpoints: 正の数の配列、unreadable_stylesheets: 0 以上の整数）`,
    );
  } else if (probe.unreadable_stylesheets > 0 && !nonEmptyString(probe.gaps_ref)) {
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
}

/**
 * はみ出し量として使える値か（0 以上の整数）。
 * @param {unknown} v
 * @returns {v is number & { readonly __extentOk: true }}
 */
function extentOk(v) {
  return isInteger(v) && v >= 0;
}

/**
 * `windows` の 1 つの窓を検査し、最小幅より狭い窓を数える。
 * @param {OverflowPageState} ps
 * @param {unknown} rawWindow
 * @param {number} j
 */
function checkOverflowWindow(ps, rawWindow, j) {
  const wat = `${ps.at}.windows[${j}]`;
  /** @type {Record<string, unknown>} */
  const record = isObjectLike(rawWindow) ? rawWindow : {};
  const w = readOverflowWindow(ps, wat, record);
  if (w === null) return;
  if (w.horizontal !== w.overflow_x_px > 0 || w.vertical !== w.overflow_y_px > 0) {
    ps.add(
      "overflow-extent-inconsistent",
      `${wat} のはみ出しの真偽値とはみ出し量が矛盾している（horizontal は overflow_x_px > 0、vertical は overflow_y_px > 0 と一致させる）`,
    );
  }
  // 横にはみ出した窓で横スクロールバーが場所を取っていなければ、スクロールバーが隠れたまま測っている（それを検出する）
  if (w.horizontal && w.horizontal_bar_px === 0) {
    ps.add(
      "overflow-bar-takes-no-space",
      `${wat} は横にはみ出しているのに横スクロールバーの厚みが 0（スクロールバーが隠れたまま測っている。--hide-scrollbars が残っているか、オーバーレイ型のスクロールバー）`,
    );
  }
  countNarrowWindow(ps, wat, w);
}

/**
 * 窓 1 つの実測（`windows[]` の 1 要素）。
 * @typedef {{
 *   width: number,
 *   height: number,
 *   horizontal: boolean,
 *   vertical: boolean,
 *   horizontal_bar_px: number,
 *   overflow_x_px: number,
 *   overflow_y_px: number,
 * }} OverflowWindow
 */

/**
 * 窓 1 つの寸法・はみ出し・横スクロールバーの厚み・はみ出し量を読む。読めない・重複するなら finding を足して null を返す。
 * @param {OverflowPageState} ps
 * @param {string} wat
 * @param {Record<string, unknown>} w
 * @returns {OverflowWindow | null}
 */
function readOverflowWindow(ps, wat, w) {
  const { add, at, seenWindows } = ps;
  const { width, height, horizontal, vertical } = w;
  if (!isInteger(width) || !isInteger(height) || width <= 0 || height <= 0) {
    add("overflow-window-malformed", `${wat} の width / height が正の整数でない`);
    return null;
  }
  const key = `${width}x${height}`;
  if (seenWindows.has(key)) {
    add("overflow-window-duplicated", `${at}.windows に窓 ${key} が 2 つ以上ある`);
    return null;
  }
  seenWindows.add(key);
  if (typeof horizontal !== "boolean" || typeof vertical !== "boolean") {
    add("overflow-window-malformed", `${wat} の horizontal / vertical が真偽値でない`);
    return null;
  }
  const bar = w.horizontal_bar_px;
  if (typeof bar !== "number" || !Number.isFinite(bar) || bar < 0) {
    add("overflow-window-malformed", `${wat}.horizontal_bar_px が 0 以上の数でない`);
    return null;
  }
  // はみ出し量。真偽値だけだと、どの高さでも縦にはみ出す頁（body の height: 100% と既定の margin）で
  // 100% と 100vh が両側とも vertical: true になり見分けられない。スイートは量を比べる
  const { overflow_x_px: overflowX, overflow_y_px: overflowY } = w;
  if (!extentOk(overflowX) || !extentOk(overflowY)) {
    add("overflow-window-malformed", `${wat}.overflow_x_px / overflow_y_px が 0 以上の整数でない`);
    return null;
  }
  return {
    width,
    height,
    horizontal,
    vertical,
    horizontal_bar_px: bar,
    overflow_x_px: overflowX,
    overflow_y_px: overflowY,
  };
}

/**
 * 最小幅を持つ頁で、最小幅より狭く横にはみ出した窓と、そのうち中身が収まる高さの窓を数える。
 * @param {OverflowPageState} ps
 * @param {string} wat
 * @param {OverflowWindow} w
 */
function countNarrowWindow(ps, wat, w) {
  const { minWidthOk, minWidth, contentHeightOk, contentHeight } = ps;
  if (!minWidthOk) return;
  if (minWidth === null) {
    if (w.horizontal) {
      ps.add(
        "overflow-min-width-inconsistent",
        `${wat} は横にはみ出しているのに ${ps.at}.min_width が null（最小幅を持つ頁として測り直す）`,
      );
    }
    return;
  }
  // 最小幅より狭い窓が全て横にはみ出すとは限らない（最小幅が中間のブレークポイントでだけ有効になるレスポンシブな頁は、
  // モバイル幅ではみ出さない）。数えるのは「最小幅より狭く、横にはみ出した窓」
  if (w.width < minWidth && w.horizontal) {
    ps.narrow += 1;
    // contentHeightOk かつ minWidth が null でないので contentHeight は数（typeof は型を絞るための再確認）
    if (contentHeightOk && typeof contentHeight === "number" && w.height > contentHeight) {
      ps.fitting += 1;
    }
  }
}

/**
 * 最小幅を持つ頁に、最小幅より狭く横にはみ出した窓と、中身が収まる高さの窓があるか。
 * @param {OverflowPageState} ps
 */
function checkNarrowWindows(ps) {
  const { add, at, minWidthOk, minWidth, contentHeightOk, contentHeight, narrow, fitting } = ps;
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
}

/**
 * `checkCaptureScope` の戻り値。
 * @typedef {{ findings: {code:string, message:string}[], holes: {id:string, kind:string, detail:string}[], counts: Record<string, number>, structural: boolean, judged: boolean }} CaptureScopeResult
 */

/**
 * 撮影条件を読む前に、型崩れとして判定を終える結果。
 * @param {{code:string, message:string}} finding
 * @returns {{ done: CaptureScopeResult }}
 */
function structuralScopeResult(finding) {
  return {
    done: {
      findings: [finding],
      holes: [],
      counts: { combinations: 0, holes: 0 },
      structural: true,
      judged: true,
    },
  };
}

/**
 * 撮影条件を読む前に判定を終える入力（metadata が読めない・mode が語彙外・判定に入れないモード・撮影条件が無い）の結果。
 * 判定に進める入力なら、metadata と撮影条件を返す。
 * @param {unknown} metadata
 * @returns {{ done: CaptureScopeResult } | { meta: Record<string, unknown>, conditions: Record<string, unknown> }}
 */
function capturePrecheck(metadata) {
  if (!isObjectLike(metadata)) {
    return structuralScopeResult({
      code: "metadata-unreadable",
      message: "metadata.json が JSON オブジェクトではない",
    });
  }
  // 視覚採取物を持たないモード（api-resource / batch）は撮影条件そのものを持たないので判定に入れない。
  // **通すのはこの閉じた集合だけ**で、mode が読めない・知らない値のときは判定を飛ばさず落とす
  // （緩和を「不正な入力」全部に広げない）。
  // **欠落・非文字列も同じ**。分岐の外へ落として feature として扱うと、不正な metadata が
  // 「撮影条件が読めた feature」として判定を通りうる。mode は語彙の中の文字列であることを先に確かめる。
  if (typeof metadata.mode !== "string" || !MODES.includes(metadata.mode)) {
    return structuralScopeResult({
      code: "mode-unknown",
      message: `mode「${metadata.mode === undefined ? "（欠落）" : String(metadata.mode)}」が語彙外（${MODES.join(" / ")}）。判定を飛ばさない`,
    });
  }
  if (metadata.mode !== "feature") {
    return {
      done: {
        findings: [],
        holes: [],
        counts: { combinations: 0, holes: 0 },
        structural: false,
        judged: false,
      },
    };
  }
  const conditions = metadata.capture_conditions;
  if (!isObjectLike(conditions)) {
    return structuralScopeResult({
      code: "capture-conditions-missing",
      message: "capture_conditions が無い（撮影条件を持たない成果物は範囲の判定に入れない）",
    });
  }
  return { meta: metadata, conditions };
}

/**
 * 判定に入れた（型崩れでない）結果。
 * @param {{code:string, message:string}[]} findings
 * @param {{id:string, kind:string, detail:string}[]} holes
 * @param {Record<string, number>} counts
 * @returns {CaptureScopeResult}
 */
function judgedScopeResult(findings, holes, counts) {
  return { findings, holes, counts, structural: false, judged: true };
}

/**
 * 撮影条件のうち、範囲の実測より前に読む宣言（撮るはずの組・表示の軸・利用者環境・ブラウザ・はみ出し）を検査する。
 * @param {Record<string, unknown>} conditions
 * @returns {{ declaredKeys: string[], findings: {code:string, message:string}[] }}
 */
function checkConditions(conditions) {
  const displayAxes = checkDisplayAxes(conditions);
  const declared = declaredCombinations(conditions, displayAxes);
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  findings.push(...declared.findings);
  findings.push(...displayAxes.findings);
  findings.push(...checkViewerEnvironment(conditions));
  findings.push(...checkBrowser(conditions));
  findings.push(...checkOverflow(conditions));
  return { declaredKeys: declared.keys, findings };
}

/**
 * `metadata.json` の内容から撮る範囲の抜けを数える。
 *
 * `judged: false` は「視覚採取物を持たないモードなので判定に入れない」の意味で、合格とは別物
 * （呼び出し側は判定しなかった事実を記録に残す）。
 * @param {unknown} metadata
 * @returns {CaptureScopeResult}
 */
export function checkCaptureScope(metadata) {
  const pre = capturePrecheck(metadata);
  if ("done" in pre) return pre.done;
  const { meta, conditions } = pre;
  const { declaredKeys, findings } = checkConditions(conditions);
  /** @type {{id:string, kind:string, detail:string}[]} */
  const holes = [];
  const noiseBaseline = meta.noise_baseline;
  if (!isArray(noiseBaseline) || noiseBaseline.length === 0) {
    findings.push({
      code: "noise-baseline-missing",
      message:
        "noise_baseline が空（どの組を撮ったかが分からない。範囲の検査は撮った組の一覧を突き合わせ相手にする）",
    });
  }
  const scope = conditions.capture_scope;
  if (!isArray(scope)) {
    findings.push({
      code: "capture-scope-missing",
      message:
        "capture_conditions.capture_scope が無い（範囲を測っていない。撮った組ごとに文書・撮影領域・内部のスクロールコンテナ・領域外の論理名を実測して書く）",
    });
    return judgedScopeResult(findings, holes, {
      declared: declaredKeys.length,
      combinations: isArray(noiseBaseline) ? noiseBaseline.length : 0,
      holes: 0,
    });
  }
  const out = { findings, holes };
  const scopeByKey = indexCaptureScope(scope, findings);
  /** @type {Set<string>} */
  const shot = isArray(noiseBaseline) ? indexNoiseBaseline(noiseBaseline, findings) : new Set();
  crossCheckCombinations({ declaredKeys, shot, scopeByKey }, out);
  deriveScopeHoles(
    scopeByKey,
    { elements: traitElementsOf(meta), scrollbars: conditions.scrollbars },
    out,
  );
  checkExemptions(conditions.capture_scope_exemptions ?? [], out);
  return judgedScopeResult(findings, holes, {
    declared: declaredKeys.length,
    combinations: shot.size,
    holes: holes.length,
  });
}

/**
 * 特性照合する論理名（スクロール領域ごとの untraced の判定に使う）。
 * 空でない文字列の配列でなければ null を返す（判定を飛ばさず、スクロール領域があるときに呼び出し側が落とす）。
 * @param {Record<string, unknown>} meta
 * @returns {Set<string> | null}
 */
function traitElementsOf(meta) {
  const traitElements = isObjectLike(meta.traits) ? meta.traits.elements : undefined;
  return isArray(traitElements) && traitElements.every((name) => nonEmptyString(name))
    ? new Set(traitElements)
    : null;
}

/**
 * `capture_scope` を撮影組の鍵で引けるようにする。鍵の揃わない・危ない・重複する要素は finding にして入れない。
 * @param {unknown[]} scope
 * @param {{code:string, message:string}[]} findings
 * @returns {Map<string, Record<string, unknown>>}
 */
function indexCaptureScope(scope, findings) {
  /** @type {Map<string, Record<string, unknown>>} */
  const scopeByKey = new Map();
  for (const raw of scope) {
    /** @type {Record<string, unknown>} */
    const entry = isObjectLike(raw) ? raw : {};
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
    // **後勝ちで上書きしない**。`deriveHoles` は鍵ごとに最後に残った要素しか評価しないので、
    // 本物の実測の後にプレースホルダーが続くと、警告は出るのに抜けそのものが消える。
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
  return scopeByKey;
}

/**
 * `noise_baseline` から撮った組の鍵の集合を作る。鍵の揃わない・危ない・重複する行は finding にして入れない。
 * @param {unknown[]} noiseBaseline
 * @param {{code:string, message:string}[]} findings
 * @returns {Set<string>}
 */
function indexNoiseBaseline(noiseBaseline, findings) {
  /** @type {Set<string>} */
  const shot = new Set();
  for (const raw of noiseBaseline) {
    /** @type {Record<string, unknown>} */
    const entry = isObjectLike(raw) ? raw : {};
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
    // **同じ組が 2 行あると Set が警告なしに畳む**。parity-diff の突き合わせは先に当たった行を使うので、
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
  return shot;
}

/**
 * 突き合わせる 3 つの組の集合（宣言した組・撮った組・範囲を測った組）。
 * @typedef {{ declaredKeys: string[], shot: Set<string>, scopeByKey: Map<string, Record<string, unknown>> }} Combinations
 */

/**
 * 宣言した組・撮った組・範囲を測った組を突き合わせる。
 * @param {Combinations} combos
 * @param {{ findings: {code:string, message:string}[], holes: {id:string, kind:string, detail:string}[] }} out
 */
function crossCheckCombinations(combos, out) {
  const { declaredKeys, shot, scopeByKey } = combos;
  const { findings, holes } = out;
  for (const key of shot) {
    if (!scopeByKey.has(key)) {
      findings.push({
        code: "scope-entry-missing",
        message: `${key} は撮ったのに範囲の実測が無い（測っていない組を抜けの無い組と同じ扱いにしない）`,
      });
    }
  }
  // **宣言した組を採らなかった場合は抜けとして数える。**
  // 採った組の一覧（`noise_baseline`）だけを突き合わせ相手にすると、組ごと落とした範囲が
  // 期待値からも消えて抜けが 0 件になる。対象外にするなら他の抜けと同じく理由付きで宣言させる。
  for (const key of declaredKeys) {
    if (!shot.has(key) && !scopeByKey.has(key)) {
      holes.push({
        id: `${key}#not-captured`,
        kind: "not-captured",
        detail: `撮影条件が宣言した組 ${key} を採っていない（noise_baseline にも capture_scope にも無い）`,
      });
    }
  }
  checkRecordedDeclared(combos, findings);
  for (const key of scopeByKey.keys()) {
    if (shot.size > 0 && !shot.has(key)) {
      findings.push({
        code: "scope-entry-unknown",
        message: `capture_scope の ${key} は noise_baseline に無い組（撮っていない組の実測が含まれている）`,
      });
    }
  }
}

/**
 * **記録した組が宣言にあることも確かめる。** 変種を消した・改名した後に古い行が noise_baseline と capture_scope の
 * 両方に残ると、2 つの記録は互いに突き合って通り、宣言に無い組の基準値が比較や新側の測り直しに使われる
 * @param {Combinations} combos
 * @param {{code:string, message:string}[]} findings
 */
function checkRecordedDeclared(combos, findings) {
  const { declaredKeys, shot, scopeByKey } = combos;
  if (declaredKeys.length === 0) return;
  const declaredSet = new Set(declaredKeys);
  for (const key of new Set([...shot, ...scopeByKey.keys()])) {
    if (!declaredSet.has(key)) {
      findings.push({
        code: "recorded-combination-undeclared",
        message: `${key} は noise_baseline / capture_scope に記録があるが、撮影条件（pages × states × viewports と display_axes.variants）が宣言した組に無い（消した・改名した変種や窓の古い記録を消す）`,
      });
    }
  }
}

/**
 * 範囲を測った組ごとに抜けを導き、スクロール領域があるのに traits.elements が読めなければ落とす。
 * @param {Map<string, Record<string, unknown>>} scopeByKey
 * @param {{ elements: Set<string> | null, scrollbars: unknown }} context
 * @param {{ findings: {code:string, message:string}[], holes: {id:string, kind:string, detail:string}[] }} out
 */
function deriveScopeHoles(scopeByKey, context, out) {
  for (const entry of scopeByKey.values()) {
    const derived = deriveHoles(entry, context);
    out.holes.push(...derived.holes);
    out.findings.push(...derived.findings);
  }
  const hasContainer = [...scopeByKey.values()].some(
    (entry) => isArray(entry.scroll_containers) && entry.scroll_containers.length > 0,
  );
  if (hasContainer && !context.elements) {
    out.findings.push({
      code: "traits-elements-unreadable",
      message:
        "traits.elements が空でない文字列の配列ではない（内部のスクロール領域が特性照合の対象かを判定できない）",
    });
  }
}

/**
 * 対象外の宣言（`capture_scope_exemptions`）を抜けと突き合わせる。
 * @param {unknown} exemptions
 * @param {{ findings: {code:string, message:string}[], holes: {id:string, kind:string, detail:string}[] }} out
 */
function checkExemptions(exemptions, out) {
  const { findings, holes } = out;
  if (!isArray(exemptions)) {
    findings.push({
      code: "exemptions-malformed",
      message: "capture_conditions.capture_scope_exemptions が配列ではない",
    });
    return;
  }
  const exemptionById = indexExemptions(exemptions, findings);
  const holeIds = new Set(holes.map((hole) => hole.id));
  for (const hole of holes) {
    checkHoleExemption(hole, exemptionById.get(hole.id), findings);
  }
  for (const id of exemptionById.keys()) {
    if (!holeIds.has(id)) {
      findings.push({
        code: "exemption-ineffective",
        message: `${id} の宣言に対応する抜けが無い（機能しない宣言。残すと範囲を狭めてもエラーにならないので消す）`,
      });
    }
  }
}

/**
 * 対象外の宣言を id で引けるようにする（重複は finding にして後の宣言で上書きする）。
 * @param {unknown[]} exemptions
 * @param {{code:string, message:string}[]} findings
 * @returns {Map<string, Record<string, unknown>>}
 */
function indexExemptions(exemptions, findings) {
  /** @type {Map<string, Record<string, unknown>>} */
  const exemptionById = new Map();
  for (const raw of exemptions) {
    /** @type {Record<string, unknown>} */
    const exemption = isObjectLike(raw) ? raw : {};
    if (!nonEmptyString(exemption.id)) {
      findings.push({
        code: "exemption-id-missing",
        message:
          "capture_scope_exemptions に id の無い要素がある（どの抜けを対象外にしたか決まらない）",
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
  return exemptionById;
}

/**
 * 抜け 1 つに、理由と gaps.md の該当箇所を持つ対象外の宣言があるか。
 * @param {{id:string, kind:string, detail:string}} hole
 * @param {Record<string, unknown> | undefined} exemption
 * @param {{code:string, message:string}[]} findings
 */
function checkHoleExemption(hole, exemption, findings) {
  if (!exemption) {
    findings.push({
      code: "hole-unexempted",
      message: `撮る範囲に抜けがある: ${hole.detail}（id: ${hole.id}）。範囲を広げて撮り直すか、対象外として理由付きで宣言する`,
    });
    return;
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

/**
 * CLI の引数を読む。誤りがあれば、その説明を `error` に入れて返す。
 * @param {string[]} argv
 * @returns {{ args: Record<string, string>, error: null } | { args: null, error: string }}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      return { args: null, error: `不明な引数: ${key}` };
    }
    const value = argv[i + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      return { args: null, error: `${key} に値がない` };
    }
    if (args[key] !== undefined) {
      return { args: null, error: `${key} が複数ある` };
    }
    args[key] = value;
    i += 1;
  }
  const unknown = Object.keys(args).filter((k) => k !== "--metadata");
  if (unknown.length > 0) {
    return { args: null, error: `不明な引数: ${unknown.join(", ")}` };
  }
  return { args, error: null };
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
  /** @param {Record<string, unknown>} obj */
  const out = (obj) =>
    write(
      `${JSON.stringify({ tool: "capture-scope-check", version: VERSION, ...obj }, null, 2)}\n`,
    );
  const parsed = parseArgs(argv);
  if (parsed.args === null) {
    return fail(parsed.error);
  }
  const metadataPath = parsed.args["--metadata"];
  if (!metadataPath) {
    return fail("--metadata は必須");
  }
  let metadata;
  try {
    metadata = JSON.parse(readFile(resolve(cwd, metadataPath)));
  } catch (error) {
    return fail(`${metadataPath} を読めない: ${errorMessage(error)}`);
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

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
