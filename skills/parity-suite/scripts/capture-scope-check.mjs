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
//   4. **撮影領域の外にある論理名付き要素**（`offscreen:<名前>`）: 特性は採れても画素には写らない。
//
// あわせて**スクロールバーが場所を取る窓でのはみ出し**の宣言を数える（Issue #449。`checkOverflow`）。
// スクロールバーを隠した撮影では `100vh` と `height: 100%` の差が 0 になり、上の穴と同じく「差分 0 件」に化けるため。
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
export const VERSION = "3";

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

/**
 * 1 つの撮影組の実測から穴を導く。
 *
 * **穴は記録された `holes` ではなく寸法から導く**——書き手が挙げた分だけを見ると、
 * 挙げ忘れた穴が「穴が無い」と同じ見え方になる。
 * @param {Record<string, unknown>} entry
 * @returns {{ holes: {id:string, kind:string, detail:string}[], findings: {code:string, message:string}[] }}
 */
export function deriveHoles(entry) {
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
 * @param {Record<string, unknown>} conditions
 * @returns {{ keys: string[], findings: {code:string, message:string}[] }}
 */
export function declaredCombinations(conditions) {
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
  return { keys, findings };
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
  const declared = declaredCombinations(
    /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (conditions)),
  );
  findings.push(...declared.findings);
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
  for (const key of scopeByKey.keys()) {
    if (shot.size > 0 && !shot.has(key)) {
      findings.push({
        code: "scope-entry-unknown",
        message: `capture_scope の ${key} は noise_baseline に無い組（撮っていない組の実測が混ざっている）`,
      });
    }
  }
  for (const entry of scopeByKey.values()) {
    const derived = deriveHoles(entry);
    holes.push(...derived.holes);
    findings.push(...derived.findings);
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
