// parity-suite の撮る範囲の検査（capture-scope-check.mjs）の回帰テスト（Issue #239）。
//
// 撮る範囲が狭いと、実装後に範囲外の差分が現れて現側から撮り直すループになる。
// 範囲の狭さは「差分 0 件」と同じ見え方になるので、撮る段で穴を数えて落とす。
//
// 陽性コントロール（穴の無い採取が exit 0）を置く——これが無いと「常に落とす」実装と区別できない。
// 穴の種別は 1 つずつ独立に注入し、注入した種別の id が出ることまで確かめる。

import { test, expect } from "vitest";
import {
  main,
  checkCaptureScope,
  deriveHoles,
  combinationKey,
  AXIS_CANDIDATES,
} from "../../../skills/parity-suite/scripts/capture-scope-check.mjs";

/**
 * スクロールバーを表示した窓のはみ出しの実測（Issue #449）。差し替えたい部分だけ渡す。
 *
 * 形は同梱テンプレート（assets/metadata-template.json の capture_conditions.overflow）と同じ。
 * 頁 list は最小幅 1280 を持つので、それより狭い窓（1180 幅）で横スクロールバーが場所を取る。
 * 高さ 3300 の窓は中身（3200）が収まる窓で、縦のはみ出しは頁の高さの決め方（100% か 100vh か）だけで決まる。
 * @param {Record<string, unknown>} [override]
 */
function overflowOf(override = {}) {
  return {
    status: "measured",
    scrollbars: "shown",
    spec: "e2e/parity/order-list/overflow/overflow.spec.ts",
    pages: [
      {
        page: "list",
        min_width: 1280,
        content_height: 3200,
        probe: { step: 40, breakpoints: [768, 1024], unreadable_stylesheets: 0, gaps_ref: null },
        windows: [
          {
            width: 1366,
            height: 768,
            horizontal: false,
            vertical: true,
            horizontal_bar_px: 0,
            overflow_x_px: 0,
            overflow_y_px: 2432,
          },
          {
            width: 1180,
            height: 768,
            horizontal: true,
            vertical: true,
            horizontal_bar_px: 15,
            overflow_x_px: 100,
            overflow_y_px: 2447,
          },
          {
            width: 1180,
            height: 3300,
            horizontal: true,
            vertical: false,
            horizontal_bar_px: 15,
            overflow_x_px: 100,
            overflow_y_px: 0,
          },
        ],
      },
    ],
    reason: null,
    ...override,
  };
}

/**
 * 表示の軸が 1 つも無い宣言（候補を全て absent に振り分ける）。形は同梱テンプレートの capture_conditions.display_axes と同じ。
 * @param {string[]} [except] absent から外す候補 id（axes に書く側）
 */
function noAxes(except = []) {
  return {
    axes: [],
    absent: AXIS_CANDIDATES.filter((c) => !except.includes(c.id)).map((c) => ({
      candidate: c.id,
      source: `現行の設定画面と移行元ソースに ${c.id} の切り替えが無い（実測）`,
    })),
    pairs: [],
    variants: [],
  };
}

/**
 * ロケール（既定 en、ほかに ja）を持つ宣言。1 軸ずつ振る変種と、窓との対の判断まで揃えた穴の無い形。
 * @param {Record<string, unknown>} [override]
 */
function localeAxes(override = {}) {
  return {
    ...noAxes(["locale"]),
    axes: [
      {
        name: "locale",
        candidate: "locale",
        values: ["en", "ja"],
        default: "en",
        source: "現行のロケール切替の選択肢（実測）",
        apply: "applyDisplayAxes: cookie lang を書いて再読み込み",
        suite_expectations: "e2e/parity/lib/expectations/order-list.ts",
        suite_reason: null,
        not_applicable: [],
      },
    ],
    pairs: [{ axes: ["locale", "viewport"], crossed: false, reason: "窓は 1 つだけ" }],
    variants: [{ label: "desktop-ja", viewport: "desktop", values: { locale: "ja" } }],
    ...override,
  };
}

/**
 * 変種 desktop-ja を撮った記録（capture_scope と noise_baseline）を足す。
 * @param {string[]} [states]
 */
function withVariantCaptures(states = ["default", "hover"]) {
  const base = /** @type {any} */ (metadataOf());
  const scope = [
    ...base.capture_conditions.capture_scope,
    ...states.map((state) => ({
      page: "list",
      state,
      viewport: "desktop-ja",
      document: { width: 1366, height: 3200 },
      captured: { width: 1366, height: 3200 },
      scroll_containers: [],
      named_elements_outside: [],
    })),
  ];
  const noise = [
    ...base.noise_baseline,
    ...states.map((state) => ({ page: "list", state, viewport: "desktop-ja", pixel_diff: 0 })),
  ];
  return { scope, noise };
}

/**
 * 穴の無い metadata を組み立てる。差し替えたい部分だけ渡す。
 *
 * 期待値（撮るはずの組）は `capture_conditions` の 3 軸の直積なので、
 * 1 組だけを対象にするテストは `states` 等の軸も同時に狭める（狭めないと「採っていない組」が増える）。
 * @param {{ scope?: unknown, exemptions?: unknown, noise?: unknown, pages?: unknown, states?: unknown, viewports?: unknown, scrollbars?: unknown, overflow?: unknown }} [override]
 */
function metadataOf(override = {}) {
  return {
    slug: "order-list",
    mode: "mode" in override ? override.mode : "feature",
    capture_conditions: {
      full_page: true,
      viewports:
        "viewports" in override
          ? override.viewports
          : [{ width: 1366, height: 768, label: "desktop" }],
      pages: "pages" in override ? override.pages : [{ name: "list", path: "/orders" }],
      states: "states" in override ? override.states : ["default", "hover"],
      capture_scope: override.scope ?? [
        {
          page: "list",
          state: "default",
          viewport: "desktop",
          document: { width: 1366, height: 3200 },
          captured: { width: 1366, height: 3200 },
          scroll_containers: [],
          named_elements_outside: [],
        },
        {
          page: "list",
          state: "hover",
          viewport: "desktop",
          document: { width: 1366, height: 3200 },
          captured: { width: 1366, height: 3200 },
          scroll_containers: [
            {
              name: "グリッド本体",
              client: { width: 1200, height: 600 },
              scroll: { width: 1200, height: 600 },
              overflow_x: "auto",
              overflow_y: "auto",
              bar: { vertical: 0, horizontal: 0 },
            },
          ],
          named_elements_outside: [],
        },
      ],
      capture_scope_exemptions: override.exemptions ?? [],
      scrollbars: "scrollbars" in override ? override.scrollbars : "shown",
      ...("scrollbarsReason" in override ? { scrollbars_reason: override.scrollbarsReason } : {}),
      ...("scrollbarEnvironment" in override
        ? { scrollbar_environment: override.scrollbarEnvironment }
        : { scrollbar_environment: "Linux の headless Chromium 140（クラシック・15px）" }),
      overflow: "overflow" in override ? override.overflow : overflowOf(),
      display_axes: "displayAxes" in override ? override.displayAxes : noAxes(),
      viewer_environment:
        "viewerEnvironment" in override
          ? override.viewerEnvironment
          : "一致: 利用者環境のブラウザへ接続し CSS.getPlatformFontsForNode で描いた書体を読んだ",
      browser: "browser" in override ? override.browser : "cdp",
      browser_identity:
        "browserIdentity" in override
          ? override.browserIdentity
          : {
              product: "140.0.3485.54",
              user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/140.0",
              browser_os: { platform: "Windows", platformVersion: "15.0.0", architecture: "x86" },
            },
    },
    noise_baseline: override.noise ?? [
      { page: "list", state: "default", viewport: "desktop", pixel_diff: 0 },
      { page: "list", state: "hover", viewport: "desktop", pixel_diff: 0 },
    ],
    traits: "traits" in override ? override.traits : { elements: ["グリッド本体", "保存ボタン"] },
  };
}

/**
 * main をメモリ上のファイルで回す。
 * @param {string[]} argv
 * @param {Record<string, string>} files
 */
function run(argv, files) {
  let output = "";
  const code = main(argv, {
    cwd: "/w",
    readFile: (path) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    },
    write: (s) => {
      output += s;
    },
  });
  return { code, result: output === "" ? null : JSON.parse(output) };
}

/** @param {ReturnType<typeof metadataOf>} metadata */
const codesOf = (metadata) => checkCaptureScope(metadata).findings.map((f) => f.code);

/** @param {ReturnType<typeof metadataOf>} metadata */
const holeIdsOf = (metadata) => checkCaptureScope(metadata).holes.map((h) => h.id);

test("陽性コントロール: 穴の無い採取は exit 0（常に落とす実装ではない）", () => {
  const { code, result } = run(["--metadata", "m.json"], {
    "/w/m.json": JSON.stringify(metadataOf()),
  });
  expect(result.findings).toEqual([]);
  expect(result.holes).toEqual([]);
  expect(code).toBe(0);
});

test("撮影領域より文書が大きい組は、下・右の切れを穴として数える", () => {
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1600, height: 3200 },
        captured: { width: 1366, height: 768 },
        scroll_containers: [],
        named_elements_outside: [],
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  expect(holeIdsOf(metadata)).toEqual([
    "list|default|desktop#below-fold",
    "list|default|desktop#beyond-right",
  ]);
  expect(codesOf(metadata).filter((c) => c === "hole-unexempted")).toHaveLength(2);
});

test("内部スクロール器の外は穴になる（画素にも特性にも出ない）", () => {
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 3200 },
        scroll_containers: [
          {
            name: "グリッド本体",
            client: { width: 1185, height: 600 },
            scroll: { width: 1185, height: 2400 },
            overflow_x: "auto",
            overflow_y: "auto",
            bar: { vertical: 15, horizontal: 0 },
          },
        ],
        named_elements_outside: [],
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  expect(holeIdsOf(metadata)).toEqual(["list|default|desktop#scroll:グリッド本体"]);
});

// 器ごとの overflow とスクロールバーの厚み（Issue #495）。実例: ダイアログの中のデータグリッド（628×298、中身 628 幅）。
// バーを隠して撮ると client 628 = scroll 628 で横のはみ出しが消え、現行の横のバーと新側の右端の切れが区別できない。
/**
 * 撮影組 1 つ・器 1 つの metadata。
 * @param {Record<string, unknown>} container 器の差し替え
 * @param {Record<string, unknown>} [override] metadataOf へ渡す差し替え
 */
function withContainer(container, override = {}) {
  return metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 768 },
        captured: { width: 1366, height: 768 },
        scroll_containers: [
          {
            name: "グリッド本体",
            client: { width: 613, height: 283 },
            scroll: { width: 628, height: 900 },
            overflow_x: "auto",
            overflow_y: "auto",
            bar: { vertical: 15, horizontal: 15 },
            ...container,
          },
        ],
        named_elements_outside: [],
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
    ...override,
  });
}

test("器ごとの記録の陰性コントロール: バーが場所を取って撮った器は scroll の穴だけ", () => {
  expect(holeIdsOf(withContainer({}))).toEqual(["list|default|desktop#scroll:グリッド本体"]);
  // 新側の形（overflow-x: hidden で横のバーを描かない）は、横の厚み 0 が正規の値
  expect(
    holeIdsOf(withContainer({ overflow_x: "hidden", bar: { vertical: 15, horizontal: 0 } })),
  ).toEqual(["list|default|desktop#scroll:グリッド本体"]);
  // hidden で撮ったなら（理由付き）、厚み 0 は正規の値
  expect(
    holeIdsOf(
      withContainer(
        { client: { width: 628, height: 298 }, bar: { vertical: 0, horizontal: 0 } },
        { scrollbars: "hidden", scrollbarsReason: "キオスク端末でスクロールバーを出さない運用" },
      ),
    ),
  ).toEqual(["list|default|desktop#scroll:グリッド本体"]);
});

test.each([
  ["縦", { client: { width: 628, height: 298 }, bar: { vertical: 0, horizontal: 0 } }],
  [
    "横",
    {
      client: { width: 613, height: 298 },
      scroll: { width: 628, height: 298 },
      bar: { vertical: 15, horizontal: 0 },
    },
  ],
])(
  "shown で撮ったのに%sにはみ出した向きのバーが場所を取っていない器は穴になる",
  (_label, container) => {
    expect(holeIdsOf(withContainer(container))).toContain(
      "list|default|desktop#scrollbar-hidden:グリッド本体",
    );
  },
);

test.each([
  ["overflow が hidden", { overflow_x: "hidden", overflow_y: "hidden" }],
  ["overflow が clip", { overflow_x: "clip", overflow_y: "clip" }],
  [
    "はみ出していない",
    { scroll: { width: 628, height: 298 }, client: { width: 628, height: 298 } },
  ],
])("バーを描かない器（%s）の厚み 0 は scrollbar-hidden にしない", (_label, container) => {
  expect(
    holeIdsOf(withContainer({ ...container, bar: { vertical: 0, horizontal: 0 } })),
  ).not.toContain("list|default|desktop#scrollbar-hidden:グリッド本体");
});

test("traits.elements に無い器は untraced の穴になる（スクロールバーの差が特性照合に写らない）", () => {
  expect(holeIdsOf(withContainer({ name: "名前の無い器" }))).toContain(
    "list|default|desktop#untraced:名前の無い器",
  );
  expect(holeIdsOf(withContainer({}))).not.toContain("list|default|desktop#untraced:グリッド本体");
});

test.each([
  ["欠落", { traits: undefined }],
  ["配列でない", { traits: { elements: "グリッド本体" } }],
  ["空の名前", { traits: { elements: ["グリッド本体", ""] } }],
])("器があるのに traits.elements が読めない（%s）なら落とす", (_label, override) => {
  expect(codesOf(withContainer({}, override))).toContain("traits-elements-unreadable");
});

test("器が無ければ traits.elements が読めなくても落とさない（判定に使わない）", () => {
  const metadata = withContainer({}, { traits: undefined });
  /** @type {any} */ (metadata).capture_conditions.capture_scope[0].scroll_containers = [];
  expect(codesOf(metadata)).toEqual([]);
});

test.each([
  ["overflow_x の欠落", { overflow_x: undefined }, "scroll-container-overflow-unreadable"],
  ["overflow_y が語彙外", { overflow_y: "overlay" }, "scroll-container-overflow-unreadable"],
  ["bar の欠落", { bar: undefined }, "scroll-container-bar-unreadable"],
  ["bar の負の値", { bar: { vertical: -1, horizontal: 0 } }, "scroll-container-bar-unreadable"],
  ["bar が文字列", { bar: { vertical: "15", horizontal: 0 } }, "scroll-container-bar-unreadable"],
])("器の記録の %s は落とす（読めないことを穴が無いことに倒さない）", (_label, container, code) => {
  expect(codesOf(withContainer(container))).toContain(code);
});

test("scrollbars が hidden なら理由を、shown なら撮った環境を書かせる", () => {
  expect(codesOf(metadataOf({ scrollbars: "hidden" }))).toContain(
    "scrollbars-hidden-reason-missing",
  );
  expect(codesOf(metadataOf({ scrollbars: "hidden", scrollbarsReason: "<理由>" }))).toContain(
    "scrollbars-hidden-reason-missing",
  );
  expect(
    codesOf(metadataOf({ scrollbars: "hidden", scrollbarsReason: "キオスク端末で出さない" })),
  ).toEqual([]);
  for (const env of [undefined, "", "未確認", "<OS・ブラウザ>"]) {
    expect(codesOf(metadataOf({ scrollbarEnvironment: env }))).toContain(
      "scrollbar-environment-missing",
    );
  }
});

test("同じ論理名が 2 つあれば落ちる（同じ id の穴が 2 つできる）", () => {
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 3200 },
        scroll_containers: [],
        named_elements_outside: ["フッタの件数表示", "フッタの件数表示"],
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  expect(codesOf(metadata)).toContain("named-element-duplicated");
  // 重複した分から穴を作らない（1 つの宣言が 2 つの穴を消すのを防ぐ）。
  expect(holeIdsOf(metadata)).toEqual(["list|default|desktop#offscreen:フッタの件数表示"]);
});

test("撮影領域の外にある論理名は穴になる", () => {
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 3200 },
        scroll_containers: [],
        named_elements_outside: ["フッタの件数表示"],
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  expect(holeIdsOf(metadata)).toEqual(["list|default|desktop#offscreen:フッタの件数表示"]);
});

test("理由と gaps への参照が揃った宣言は穴を通す（範囲を広げる以外の出口が在る）", () => {
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 768 },
        scroll_containers: [],
        named_elements_outside: [],
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
    exemptions: [
      {
        id: "list|default|desktop#below-fold",
        reason: "仮想スクロールで全画面撮影が成立しない",
        gaps_ref: "gaps.md の未検証領域「一覧の 2 画面目以降」",
      },
    ],
  });
  expect(codesOf(metadata)).toEqual([]);
});

test("宣言に reason / gaps_ref が無ければ落ちる", () => {
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 768 },
        scroll_containers: [],
        named_elements_outside: [],
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
    exemptions: [{ id: "list|default|desktop#below-fold" }],
  });
  const codes = codesOf(metadata);
  expect(codes).toContain("exemption-reason-missing");
  expect(codes).toContain("exemption-gaps-ref-missing");
});

test("対応する穴の無い宣言は効かない宣言として落ちる", () => {
  const metadata = metadataOf({
    exemptions: [
      { id: "list|default|desktop#below-fold", reason: "以前は切れていた", gaps_ref: "gaps.md" },
    ],
  });
  expect(codesOf(metadata)).toContain("exemption-ineffective");
});

test("撮ったのに範囲を測っていない組は落ちる（測っていないことを穴無しに倒さない）", () => {
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 3200 },
        scroll_containers: [],
        named_elements_outside: [],
      },
    ],
  });
  const codes = codesOf(metadata);
  expect(codes).toContain("scope-entry-missing");
});

test("noise_baseline に同じ組が 2 行あれば落ちる（Set が黙って畳む前に）", () => {
  const metadata = metadataOf({
    noise: [
      { page: "list", state: "default", viewport: "desktop", pixel_diff: 0, trait_diffs: 0 },
      { page: "list", state: "default", viewport: "desktop", pixel_diff: 0, trait_diffs: 12 },
      { page: "list", state: "hover", viewport: "desktop", pixel_diff: 0 },
    ],
  });
  expect(codesOf(metadata)).toContain("noise-entry-duplicated");
});

test("撮っていない組の実測が混ざっていれば落ちる", () => {
  const metadata = metadataOf({
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  expect(codesOf(metadata)).toContain("scope-entry-unknown");
});

test("scroll_containers / named_elements_outside のキー欠落は未測定として落ちる", () => {
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 3200 },
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  const codes = codesOf(metadata);
  expect(codes).toContain("scroll-containers-missing");
  expect(codes).toContain("named-elements-outside-missing");
});

test("寸法が数値でなければ穴の有無を判定せず落とす", () => {
  const derived = deriveHoles({
    page: "list",
    state: "default",
    viewport: "desktop",
    document: { width: "1366", height: 3200 },
    captured: { width: 1366, height: 768 },
    scroll_containers: [],
    named_elements_outside: [],
  });
  expect(derived.holes).toEqual([]);
  expect(derived.findings.map((f) => f.code)).toEqual(["scope-size-unreadable"]);
});

test("capture_scope をキーごと持たない成果物は落ちる（後方互換で素通りさせない）", () => {
  const metadata = metadataOf();
  delete metadata.capture_conditions.capture_scope;
  expect(codesOf(metadata)).toContain("capture-scope-missing");
});

test("noise_baseline が空なら合格に倒さない", () => {
  const metadata = metadataOf({ noise: [] });
  expect(codesOf(metadata)).toContain("noise-baseline-missing");
});

test("穴の id の材料に区切り文字が入っていれば落とす（1 つの宣言が 2 つの穴を黙らせる）", () => {
  // ビューポート `v#scroll:x` の below-fold と、ビューポート `v` の器 `x#below-fold` は
  // どちらも p|s|v#scroll:x#below-fold になり、1 つの宣言で両方が消える。
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 3200 },
        scroll_containers: [
          {
            name: "グリッド#below-fold",
            client: { width: 1200, height: 600 },
            scroll: { width: 1200, height: 2400 },
          },
        ],
        named_elements_outside: ["フッタ#scroll:x"],
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  const codes = codesOf(metadata);
  expect(codes).toContain("scroll-container-name-unsafe");
  expect(codes).toContain("named-element-name-unsafe");
  // 区切りを含む名前からは穴の id を作らない（作ると衝突した id が宣言で消える）。
  expect(holeIdsOf(metadata)).toEqual([]);
});

test("ビューポート label に id の区切りが入っていても落とす", () => {
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop#scroll:x",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 768 },
        scroll_containers: [],
        named_elements_outside: [],
      },
    ],
    noise: [{ page: "list", state: "default", viewport: "desktop#scroll:x", pixel_diff: 0 }],
  });
  const codes = codesOf(metadata);
  expect(codes).toContain("scope-entry-key-unsafe");
  expect(codes).toContain("noise-entry-key-unsafe");
});

test("鍵の材料に区切り文字が入っていれば落とす（別々の組が同じ鍵に潰れる）", () => {
  // ("a|b", "c", "d") と ("a", "b|c", "d") はどちらも a|b|c|d になり、
  // 1 つの範囲の実測が 2 つの撮影組を満たしたことになる。
  const metadata = metadataOf({
    scope: [
      {
        page: "a|b",
        state: "c",
        viewport: "d",
        document: { width: 1366, height: 768 },
        captured: { width: 1366, height: 768 },
        scroll_containers: [],
        named_elements_outside: [],
      },
    ],
    noise: [
      { page: "a|b", state: "c", viewport: "d", pixel_diff: 0 },
      { page: "a", state: "b|c", viewport: "d", pixel_diff: 0 },
    ],
  });
  const codes = codesOf(metadata);
  expect(codes).toContain("scope-entry-key-unsafe");
  expect(codes).toContain("noise-entry-key-unsafe");
});

test("撮影組の鍵はページ・状態・ビューポートで作る", () => {
  expect(combinationKey({ page: "list", state: "hover", viewport: "mobile" })).toBe(
    "list|hover|mobile",
  );
});

test("テンプレートのプレースホルダ（寸法 0）は測っていない組として落ちる", () => {
  // assets/metadata-template.json は寸法を 0 で置いてある。0 を通すと文書も撮影領域も 0×0 になり、
  // 穴が 1 つも出ないまま exit 0（「測っていない組」が「穴の無い組」に化ける）。
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 0, height: 0 },
        captured: { width: 0, height: 0 },
        scroll_containers: [],
        named_elements_outside: [],
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  const result = checkCaptureScope(metadata);
  expect(result.holes).toEqual([]);
  expect(result.findings.map((f) => f.code)).toContain("scope-size-unreadable");
});

test("内部スクロール器の寸法 0 も測っていない扱いにする", () => {
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 3200 },
        scroll_containers: [
          {
            name: "グリッド本体",
            client: { width: 0, height: 0 },
            scroll: { width: 0, height: 0 },
          },
        ],
        named_elements_outside: [],
      },
    ],
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  expect(codesOf(metadata)).toContain("scroll-container-size-unreadable");
});

test("mode の欠落・非文字列は feature に倒さず exit 2", () => {
  for (const mode of [undefined, null, 3, ""]) {
    const metadata = metadataOf({ mode });
    if (mode === undefined) delete metadata.mode;
    const { code, result } = run(["--metadata", "m.json"], {
      "/w/m.json": JSON.stringify(metadata),
    });
    expect(code).toBe(2);
    expect(result.findings.map((f) => f.code)).toContain("mode-unknown");
  }
});

test("視覚採取物を持たないモードは判定に入れない（合格ではなく judged: false）", () => {
  for (const mode of ["api-resource", "batch"]) {
    const { code, result } = run(["--metadata", "m.json"], {
      "/w/m.json": JSON.stringify({ slug: "user", mode }),
    });
    expect(code).toBe(0);
    expect(result.judged).toBe(false);
  }
});

test("mode が語彙外なら判定を飛ばさず落とす（緩和経路を未列挙の入力へ広げない）", () => {
  const { code, result } = run(["--metadata", "m.json"], {
    "/w/m.json": JSON.stringify({ slug: "user", mode: "component" }),
  });
  expect(code).toBe(2);
  expect(result.findings.map((f) => f.code)).toContain("mode-unknown");
});

test("feature モードは判定に入る（judged: true）", () => {
  const metadata = metadataOf();
  metadata.mode = "feature";
  const { code, result } = run(["--metadata", "m.json"], { "/w/m.json": JSON.stringify(metadata) });
  expect(code).toBe(0);
  expect(result.judged).toBe(true);
});

test("宣言した組を採っていなければ穴として数える（採った組の一覧を期待値にしない）", () => {
  // noise_baseline だけを突き合わせ相手にすると、組ごと落とした範囲が期待値からも消えて穴が 0 件になる。
  const metadata = metadataOf({
    scope: [
      {
        page: "list",
        state: "default",
        viewport: "desktop",
        document: { width: 1366, height: 3200 },
        captured: { width: 1366, height: 3200 },
        scroll_containers: [],
        named_elements_outside: [],
      },
    ],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  // states は既定の [default, hover] のままなので hover の組が採られていない。
  expect(holeIdsOf(metadata)).toEqual(["list|hover|desktop#not-captured"]);
  expect(codesOf(metadata)).toContain("hole-unexempted");

  // 理由付きの宣言なら通る（他の穴と同じ出口）。
  const exempted = metadataOf({
    scope: metadata.capture_conditions.capture_scope,
    noise: metadata.noise_baseline,
    exemptions: [
      {
        id: "list|hover|desktop#not-captured",
        reason: "この機能に hover 状態の器が無い",
        gaps_ref: "gaps.md の撮影範囲の対象外「一覧の hover」",
      },
    ],
  });
  expect(codesOf(exempted)).toEqual([]);
});

test("撮影条件の軸が空・区切り文字入り・重複なら落とす（期待値を作れないことを合格に倒さない）", () => {
  const base = metadataOf();
  expect(codesOf(metadataOf({ states: [] }))).toContain("declared-axis-missing");
  expect(codesOf(metadataOf({ pages: [{ path: "/orders" }] }))).toContain(
    "declared-axis-value-unusable",
  );
  expect(codesOf(metadataOf({ viewports: [{ label: "desk|top" }] }))).toContain(
    "declared-axis-value-unusable",
  );
  expect(codesOf(metadataOf({ states: ["default", "hover", "hover"] }))).toContain(
    "declared-axis-value-duplicated",
  );
  // 陽性コントロール: 3 軸が揃った宣言ではこれらは出ない。
  expect(codesOf(base)).toEqual([]);
  expect(checkCaptureScope(base).counts.declared).toBe(2);
});

test("capture_conditions が無い・JSON が壊れている入力は exit 2", () => {
  expect(run(["--metadata", "m.json"], { "/w/m.json": "{}" }).code).toBe(2);
  expect(run(["--metadata", "m.json"], { "/w/m.json": "{" }).code).toBe(2);
});

test("引数の誤り・読めない入力は exit 2", () => {
  expect(run([], {}).code).toBe(2);
  expect(run(["--metadata"], {}).code).toBe(2);
  expect(run(["--metadata", "m.json", "--nope", "x"], {}).code).toBe(2);
  expect(run(["--metadata", "missing.json"], {}).code).toBe(2);
});

// Issue #407: capture_scope の重複要素を finding の後も無条件に上書きしていたため（後勝ち）、
// 本物の実測の後にプレースホルダーが続くと deriveHoles が最後の要素しか見ず、穴が消えていた。
// noise_baseline の重複と同じく先勝ちで残す。
test("capture_scope の重複要素は先勝ちで残り、本物の穴が消えない", () => {
  const real = {
    page: "list",
    state: "default",
    viewport: "desktop",
    document: { width: 1366, height: 3200 },
    captured: { width: 1366, height: 1200 },
    scroll_containers: [],
    named_elements_outside: [],
  };
  // 同じ鍵を持つプレースホルダー（寸法が一致し穴が無い）。後勝ちだとこれが採られて穴が消える。
  const placeholder = {
    ...real,
    document: { width: 100, height: 100 },
    captured: { width: 100, height: 100 },
  };
  const metadata = metadataOf({
    states: ["default"],
    scope: [real, placeholder],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  expect(codesOf(metadata)).toContain("scope-entry-duplicated");
  expect(holeIdsOf(metadata)).toContain("list|default|desktop#below-fold");
});

// 先勝ちにしても `holes` の中身は並び順で変わる（読む重複が入れ替わるだけ）。
// 並び順に依らないのは合否で、重複そのものが必ず落ちる。両方を 1 件ずつ固定する。
test("holes の中身は先に来た実測で決まり、合否は並び順に依らない", () => {
  const withHole = {
    page: "list",
    state: "default",
    viewport: "desktop",
    document: { width: 1366, height: 3200 },
    captured: { width: 1366, height: 1200 },
    scroll_containers: [],
    named_elements_outside: [],
  };
  const noHole = {
    ...withHole,
    captured: { width: 1366, height: 3200 },
  };
  const noise = [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }];
  // 穴の無い方を先に置いたときは、後ろの穴は（先勝ちなので）採らない＝ holes は並び順で変わる。
  expect(
    holeIdsOf(metadataOf({ states: ["default"], scope: [noHole, withHole], noise })),
  ).not.toContain("list|default|desktop#below-fold");
  // 一方で合否は並び順に依らない——どちらの順でも重複そのものが必ず報告される（無音で決まらない）。
  expect(codesOf(metadataOf({ states: ["default"], scope: [noHole, withHole], noise }))).toContain(
    "scope-entry-duplicated",
  );
});

// ---- スクロールバーが場所を取る窓のはみ出し（Issue #449） ----
//
// スクロールバーを隠した撮影では 100vh と height: 100% の差が 0 になり、3 経路すべてが緑のまま通る。
// 撮影時の扱い（scrollbars）と、スクロールバーを表示した窓の縦・横のはみ出し（overflow）を宣言させる。

/** @param {Record<string, unknown>} windowOverride 頁 list の 2 つ目の窓（1180x768）へ当てる差し替え */
function overflowWithWindow(windowOverride) {
  const base = overflowOf();
  const page = /** @type {any} */ (base.pages)[0];
  return overflowOf({
    pages: [
      {
        ...page,
        windows: [page.windows[0], { ...page.windows[1], ...windowOverride }, page.windows[2]],
      },
    ],
  });
}

test("はみ出しの陰性コントロール: 正規の記録は落とさない（hidden / shown / not_measured）", () => {
  expect(codesOf(metadataOf())).toEqual([]);
  // 撮影をスクロールバー表示で行ったプロジェクト
  expect(codesOf(metadataOf({ scrollbars: "shown" }))).toEqual([]);
  // 測れなかったことを理由付きで宣言する
  expect(
    codesOf(
      metadataOf({ overflow: { status: "not_measured", reason: "認証の都合で窓を変えられない" } }),
    ),
  ).toEqual([]);
  // 最小幅を持たない頁（どの窓でも横にはみ出さない）
  expect(
    codesOf(
      metadataOf({
        overflow: overflowOf({
          pages: [
            {
              page: "list",
              min_width: null,
              probe: { step: 40, breakpoints: [], unreadable_stylesheets: 0, gaps_ref: null },
              windows: [
                {
                  width: 1366,
                  height: 768,
                  horizontal: false,
                  vertical: true,
                  horizontal_bar_px: 0,
                  overflow_x_px: 0,
                  overflow_y_px: 2432,
                },
                {
                  width: 360,
                  height: 768,
                  horizontal: false,
                  vertical: true,
                  horizontal_bar_px: 0,
                  overflow_x_px: 0,
                  overflow_y_px: 2432,
                },
              ],
            },
          ],
        }),
      }),
    ),
  ).toEqual([]);
});

test("scrollbars の欠落・語彙外は落とす（新側を同じ扱いで撮れない）", () => {
  const { scrollbars: _dropped, ...conditions } = metadataOf().capture_conditions;
  expect(codesOf({ ...metadataOf(), capture_conditions: conditions })).toContain(
    "scrollbars-missing",
  );
  expect(codesOf(metadataOf({ scrollbars: "auto" }))).toContain("scrollbars-unknown");
  expect(codesOf(metadataOf({ scrollbars: null }))).toContain("scrollbars-unknown");
});

test("overflow をキーごと持たない成果物は落とす（省略を免除にしない）", () => {
  const { overflow: _dropped, ...conditions } = metadataOf().capture_conditions;
  expect(codesOf({ ...metadataOf(), capture_conditions: conditions })).toContain(
    "overflow-missing",
  );
});

test("overflow の status が読めない・not_measured の理由が無いなら落とす", () => {
  for (const overflow of [null, [], "measured", { status: "skipped" }, { reason: "x" }]) {
    expect(codesOf(metadataOf({ overflow }))).toContain("overflow-status-unknown");
  }
  for (const reason of [undefined, null, "", "  "]) {
    expect(codesOf(metadataOf({ overflow: { status: "not_measured", reason } }))).toContain(
      "overflow-reason-missing",
    );
  }
  expect(codesOf(metadataOf({ overflow: overflowOf({ reason: "測った" }) }))).toContain(
    "overflow-reason-unexpected",
  );
});

test("スクロールバーを隠して測った記録は落とす（100vh と 100% の差が 0 になる）", () => {
  for (const scrollbars of ["hidden", undefined, null]) {
    expect(codesOf(metadataOf({ overflow: overflowOf({ scrollbars }) }))).toContain(
      "overflow-scrollbars-hidden",
    );
  }
  // 陽性コントロール: 横にはみ出した窓で横スクロールバーの厚みが 0 なら、隠れたまま測っている
  expect(codesOf(metadataOf({ overflow: overflowWithWindow({ horizontal_bar_px: 0 }) }))).toContain(
    "overflow-bar-takes-no-space",
  );
});

test("記録を現・新に当てるスペックが無いなら落とす", () => {
  for (const spec of [undefined, null, ""]) {
    expect(codesOf(metadataOf({ overflow: overflowOf({ spec }) }))).toContain(
      "overflow-spec-missing",
    );
  }
});

test("頁の測り漏れ・重複・撮影頁に無い頁は落とす（期待集合は capture_conditions.pages から作る）", () => {
  const page = /** @type {any} */ (overflowOf().pages)[0];
  expect(codesOf(metadataOf({ overflow: overflowOf({ pages: [] }) }))).toContain(
    "overflow-page-missing",
  );
  expect(codesOf(metadataOf({ overflow: overflowOf({ pages: [page, page] }) }))).toContain(
    "overflow-page-duplicated",
  );
  expect(
    codesOf(metadataOf({ overflow: overflowOf({ pages: [page, { ...page, page: "detail" }] }) })),
  ).toContain("overflow-page-unknown");
  expect(codesOf(metadataOf({ overflow: overflowOf({ pages: [{ ...page, page: "" }] }) }))).toEqual(
    expect.arrayContaining(["overflow-page-unkeyed", "overflow-page-missing"]),
  );
  expect(codesOf(metadataOf({ overflow: overflowOf({ pages: "list" }) }))).toContain(
    "overflow-pages-missing",
  );
});

test("窓の欠落・型崩れ・重複は落とす", () => {
  const page = /** @type {any} */ (overflowOf().pages)[0];
  expect(
    codesOf(metadataOf({ overflow: overflowOf({ pages: [{ ...page, windows: [] }] }) })),
  ).toContain("overflow-windows-missing");
  expect(
    codesOf(
      metadataOf({
        overflow: overflowOf({ pages: [{ ...page, windows: [...page.windows, page.windows[1]] }] }),
      }),
    ),
  ).toContain("overflow-window-duplicated");
  for (const bad of [
    { width: 0 },
    { height: "768" },
    { horizontal: "true" },
    { vertical: undefined },
    { horizontal_bar_px: -1 },
    { horizontal_bar_px: null },
  ]) {
    expect(codesOf(metadataOf({ overflow: overflowWithWindow(bad) }))).toContain(
      "overflow-window-malformed",
    );
  }
});

test("最小幅と窓の記録が矛盾していれば落とす", () => {
  const page = /** @type {any} */ (overflowOf().pages)[0];
  for (const minWidth of [0, -1, 1280.5, "1280", undefined]) {
    expect(
      codesOf(metadataOf({ overflow: overflowOf({ pages: [{ ...page, min_width: minWidth }] }) })),
    ).toContain("overflow-min-width-malformed");
  }
  // 最小幅より狭い窓がどれも横にはみ出していない（最小幅の実測が誤っている）
  expect(
    codesOf(
      metadataOf({
        overflow: overflowOf({
          pages: [
            {
              ...page,
              windows: page.windows.map((w) => ({
                ...w,
                horizontal: false,
                horizontal_bar_px: 0,
                overflow_x_px: 0,
              })),
            },
          ],
        }),
      }),
    ),
  ).toContain("overflow-narrow-window-missing");
  // 最小幅を持たないと書いたのに横にはみ出している
  expect(
    codesOf(metadataOf({ overflow: overflowOf({ pages: [{ ...page, min_width: null }] }) })),
  ).toContain("overflow-min-width-inconsistent");
  // 最小幅より狭い窓が 1 つも無い（横スクロールバーが出る窓で測っていない）
  expect(
    codesOf(
      metadataOf({ overflow: overflowOf({ pages: [{ ...page, windows: [page.windows[0]] }] }) }),
    ),
  ).toContain("overflow-narrow-window-missing");
});

test("中身が収まる高さの狭い窓が無い記録は落とす（Codex レビュー #453）", () => {
  const page = /** @type {any} */ (overflowOf().pages)[0];
  // 狭い窓が短い 1 窓だけ: 縦のはみ出しが頁の高さの決め方で決まらず、100% と 100vh を見分けられない
  expect(
    codesOf(
      metadataOf({
        overflow: overflowOf({ pages: [{ ...page, windows: [page.windows[0], page.windows[1]] }] }),
      }),
    ),
  ).toContain("overflow-fit-window-missing");
  // 狭い窓の高さが中身の高さと同じ（収まっていない）
  expect(
    codesOf(metadataOf({ overflow: overflowOf({ pages: [{ ...page, content_height: 3300 }] }) })),
  ).toContain("overflow-fit-window-missing");
  for (const contentHeight of [undefined, null, 0, 3200.5, "3200"]) {
    expect(
      codesOf(
        metadataOf({
          overflow: overflowOf({ pages: [{ ...page, content_height: contentHeight }] }),
        }),
      ),
    ).toContain("overflow-content-height-malformed");
  }
  // 陰性コントロール: 中身が収まる高さの窓でも縦にはみ出す頁（body の height: 100% と既定の margin）は落とさない
  expect(
    codesOf(
      metadataOf({
        overflow: overflowOf({
          pages: [
            {
              ...page,
              windows: [
                page.windows[0],
                page.windows[1],
                { ...page.windows[2], vertical: true, overflow_y_px: 16 },
              ],
            },
          ],
        }),
      }),
    ),
  ).toEqual([]);
  // 最小幅を持たない頁は content_height を要求しない
  expect(
    codesOf(
      metadataOf({
        overflow: overflowOf({
          pages: [
            {
              page: "list",
              min_width: null,
              probe: { step: 40, breakpoints: [], unreadable_stylesheets: 0, gaps_ref: null },
              content_height: null,
              windows: [
                {
                  width: 1366,
                  height: 768,
                  horizontal: false,
                  vertical: true,
                  horizontal_bar_px: 0,
                  overflow_x_px: 0,
                  overflow_y_px: 2432,
                },
              ],
            },
          ],
        }),
      }),
    ),
  ).toEqual([]);
});

test("同梱テンプレートのプレースホルダのままの overflow は落とす", async () => {
  const { readFileSync } = await import("node:fs");
  const template = JSON.parse(
    readFileSync(
      new URL("../../../skills/parity-suite/assets/metadata-template.json", import.meta.url),
      "utf8",
    ),
  );
  const cc = template.capture_conditions;
  const codes = codesOf(metadataOf({ scrollbars: cc.scrollbars, overflow: cc.overflow }));
  expect(codes).toEqual(expect.arrayContaining(["scrollbars-unknown", "overflow-status-unknown"]));
});

test("最小幅が中間のブレークポイントでだけ効く頁は、狭いモバイル幅ではみ出さなくても落とさない（Codex レビュー #453）", () => {
  const page = /** @type {any} */ (overflowOf().pages)[0];
  const mobile = {
    width: 375,
    height: 768,
    horizontal: false,
    vertical: true,
    horizontal_bar_px: 0,
    overflow_x_px: 0,
    overflow_y_px: 2432,
  };
  expect(
    codesOf(
      metadataOf({
        viewports: [
          { width: 1366, height: 768, label: "desktop" },
          { width: 375, height: 768, label: "mobile" },
        ],
        scope: [],
        noise: [],
        overflow: overflowOf({ pages: [{ ...page, windows: [...page.windows, mobile] }] }),
      }),
    ).filter((c) => c.startsWith("overflow-")),
  ).toEqual([]);
});

test("はみ出し量の欠落・型崩れ・真偽値との矛盾は落とす（Codex レビュー #453）", () => {
  for (const bad of [
    { overflow_x_px: undefined },
    { overflow_y_px: -1 },
    { overflow_y_px: 1.5 },
    { overflow_x_px: "100" },
  ]) {
    expect(codesOf(metadataOf({ overflow: overflowWithWindow(bad) }))).toContain(
      "overflow-window-malformed",
    );
  }
  expect(codesOf(metadataOf({ overflow: overflowWithWindow({ overflow_x_px: 0 }) }))).toContain(
    "overflow-extent-inconsistent",
  );
  expect(codesOf(metadataOf({ overflow: overflowWithWindow({ overflow_y_px: 0 }) }))).toContain(
    "overflow-extent-inconsistent",
  );
});

test("最小幅の探索の範囲の記録が無い・読めないスタイルシートを未検証に回していない記録は落とす（Codex レビュー #453）", () => {
  const page = /** @type {any} */ (overflowOf().pages)[0];
  const withProbe = (probe) =>
    metadataOf({ overflow: overflowOf({ pages: [{ ...page, probe }] }) });
  for (const probe of [
    undefined,
    null,
    { ...page.probe, step: 0 },
    { ...page.probe, breakpoints: "768" },
    { ...page.probe, breakpoints: [768, -1] },
    { ...page.probe, unreadable_stylesheets: -1 },
    { ...page.probe, unreadable_stylesheets: undefined },
  ]) {
    expect(codesOf(withProbe(probe))).toContain("overflow-probe-malformed");
  }
  expect(codesOf(withProbe({ ...page.probe, unreadable_stylesheets: 2 }))).toContain(
    "overflow-probe-unreadable-unrecorded",
  );
  expect(codesOf(withProbe({ ...page.probe, gaps_ref: "gaps.md#stale" }))).toContain(
    "overflow-probe-gaps-ref-unexpected",
  );
  // 陰性コントロール: 読めないスタイルシートを gaps.md に回した記録は通す
  expect(
    codesOf(
      withProbe({
        ...page.probe,
        unreadable_stylesheets: 2,
        gaps_ref: "gaps.md#採取環境依存の未検証",
      }),
    ),
  ).toEqual([]);
});

// ---- 表示を切り替える軸（Issue #489） ----

test("陽性コントロール: ロケールの変種を全ページ × 全状態で撮った採取は通る", () => {
  const { scope, noise } = withVariantCaptures();
  const metadata = metadataOf({ displayAxes: localeAxes(), scope, noise });
  expect(codesOf(metadata)).toEqual([]);
  expect(holeIdsOf(metadata)).toEqual([]);
});

test("display_axes をキーごと持たない成果物は落とす（数えていない軸を免除にしない）", () => {
  const metadata = metadataOf();
  delete (/** @type {any} */ (metadata).capture_conditions.display_axes);
  expect(codesOf(metadata)).toContain("display-axes-missing");
  expect(codesOf(metadataOf({ displayAxes: [] }))).toContain("display-axes-malformed");
  expect(codesOf(metadataOf({ displayAxes: { ...noAxes(), variants: undefined } }))).toContain(
    "display-axes-malformed",
  );
});

test("候補を axes にも absent にも振り分けていないと落ちる（思いつかなかった軸と区別する）", () => {
  const axes = noAxes();
  const metadata = metadataOf({
    displayAxes: { ...axes, absent: axes.absent.filter((a) => a.candidate !== "color-scheme") },
  });
  const findings = checkCaptureScope(metadata).findings;
  expect(findings.map((f) => f.code)).toEqual(["display-axis-candidate-unsurveyed"]);
  expect(findings[0].message).toContain("color-scheme");
});

test("absent の来歴の欠落・候補の重複・一覧に無い候補は落とす", () => {
  const axes = noAxes();
  expect(
    codesOf(
      metadataOf({
        displayAxes: {
          ...axes,
          absent: axes.absent.map((a) => (a.candidate === "print" ? { candidate: "print" } : a)),
        },
      }),
    ),
  ).toEqual(["display-axis-absent-source-missing"]);
  expect(
    codesOf(metadataOf({ displayAxes: { ...axes, absent: [...axes.absent, axes.absent[0]] } })),
  ).toContain("display-axis-candidate-duplicated");
  expect(
    codesOf(
      metadataOf({
        displayAxes: { ...axes, absent: [...axes.absent, { candidate: "font", source: "x" }] },
      }),
    ),
  ).toContain("display-axis-candidate-unknown");
  // 在ると無いの両方に書いた候補も重複として落とす
  const both = localeAxes();
  expect(
    codesOf(
      metadataOf({
        displayAxes: { ...both, absent: [...both.absent, { candidate: "locale", source: "x" }] },
        ...withVariantCaptures(),
      }),
    ),
  ).toContain("display-axis-candidate-duplicated");
});

test("既定以外の値を撮る変種が無ければ落ちる（1 軸ずつ振る）", () => {
  const metadata = metadataOf({ displayAxes: localeAxes({ variants: [] }) });
  expect(codesOf(metadata)).toEqual(["display-axis-value-unswept"]);
});

test("変種を宣言したのに撮っていない組は #not-captured の穴になる（parity-diff の収束でも落ちる）", () => {
  const metadata = metadataOf({ displayAxes: localeAxes() });
  expect(holeIdsOf(metadata)).toEqual([
    "list|default|desktop-ja#not-captured",
    "list|hover|desktop-ja#not-captured",
  ]);
  expect(codesOf(metadata).filter((c) => c === "hole-unexempted")).toHaveLength(2);
});

test("軸が効かないページは not_applicable と理由で撮るはずの組から外れる", () => {
  const pages = [
    { name: "list", path: "/orders" },
    { name: "print", path: "/orders/print" },
  ];
  const axes = localeAxes();
  const withNa = (na) =>
    metadataOf({
      pages,
      displayAxes: { ...axes, axes: [{ ...axes.axes[0], not_applicable: na }] },
      ...withVariantCaptures(),
    });
  // 外さなければ print ページの変種と基準の組が穴になる（陽性コントロール）
  expect(holeIdsOf(withNa([]))).toContain("print|default|desktop-ja#not-captured");
  const excluded = holeIdsOf(withNa([{ page: "print", reason: "印刷画面は英語固定（実測）" }]));
  expect(excluded.filter((id) => id.includes("desktop-ja"))).toEqual([]);
  expect(codesOf(withNa([{ page: "print" }]))).toContain(
    "display-axis-not-applicable-reason-missing",
  );
  expect(codesOf(withNa([{ page: "nowhere", reason: "x" }]))).toContain(
    "display-axis-not-applicable-page-unknown",
  );
  expect(
    codesOf(
      withNa([
        { page: "print", reason: "x" },
        { page: "print", reason: "x" },
      ]),
    ),
  ).toContain("display-axis-not-applicable-duplicated");
});

test("軸の宣言の欠落・型崩れは落とす（名前・値・既定・来歴・当て方）", () => {
  const axes = localeAxes();
  const withAxis = (patch) =>
    codesOf(
      metadataOf({
        displayAxes: { ...axes, axes: [{ ...axes.axes[0], ...patch }] },
        ...withVariantCaptures(),
      }),
    );
  for (const name of ["", "a|b", "a=b", "a,b", "viewport", undefined]) {
    expect(withAxis({ name })).toContain("display-axis-name-unusable");
  }
  for (const values of [undefined, ["en"], ["en", "en"], ["en", ""], "en,ja"]) {
    expect(withAxis({ values })).toContain("display-axis-values-unusable");
  }
  expect(withAxis({ default: "fr" })).toContain("display-axis-default-unknown");
  expect(withAxis({ default: undefined })).toContain("display-axis-default-unknown");
  expect(withAxis({ source: "" })).toContain("display-axis-source-missing");
  expect(withAxis({ apply: undefined })).toContain("display-axis-apply-missing");
  expect(withAxis({ candidate: "language" })).toContain("display-axis-candidate-unknown");
  expect(
    codesOf(
      metadataOf({
        displayAxes: { ...axes, axes: [axes.axes[0], axes.axes[0]] },
        ...withVariantCaptures(),
      }),
    ),
  ).toContain("display-axis-duplicated");
});

test("スイートへの写し方は期待値の所在か変わらない根拠のどちらか一方だけ", () => {
  const axes = localeAxes();
  const withSuite = (suite_expectations, suite_reason) =>
    codesOf(
      metadataOf({
        displayAxes: { ...axes, axes: [{ ...axes.axes[0], suite_expectations, suite_reason }] },
        ...withVariantCaptures(),
      }),
    );
  expect(withSuite(null, null)).toEqual(["display-axis-suite-undecided"]);
  expect(withSuite("e2e/x.ts", "変わらない")).toEqual(["display-axis-suite-undecided"]);
  // 陰性コントロール: 変わらない根拠だけでも通る
  expect(withSuite(null, "配色だけが変わり文言・振る舞いは変わらない（移行元ソース）")).toEqual([]);
});

test("軸の対の判断が無い・理由が無い・形が崩れていると落ちる", () => {
  const withPairs = (pairs) =>
    codesOf(metadataOf({ displayAxes: localeAxes({ pairs }), ...withVariantCaptures() }));
  expect(withPairs([])).toEqual(["display-axis-pair-undecided"]);
  expect(withPairs([{ axes: ["locale", "viewport"], crossed: false, reason: "" }])).toEqual([
    "display-axis-pair-reason-missing",
  ]);
  for (const bad of [
    { axes: ["locale"], crossed: false, reason: "x" },
    { axes: ["locale", "locale"], crossed: false, reason: "x" },
    { axes: ["locale", "theme"], crossed: false, reason: "x" },
    { axes: ["viewport", "viewport"], crossed: false, reason: "x" },
    { axes: ["locale", "viewport"], crossed: "no", reason: "x" },
  ]) {
    expect(withPairs([bad])).toContain("display-axis-pair-unusable");
  }
  const pair = { axes: ["viewport", "locale"], crossed: false, reason: "x" };
  expect(withPairs([pair, pair])).toContain("display-axis-pair-duplicated");
});

test("窓と掛け合わせると宣言した軸は、全ての窓で変種が要る", () => {
  const viewports = [
    { width: 1920, height: 1080, label: "desktop" },
    { width: 1255, height: 900, label: "narrow" },
  ];
  const crossed = [
    { axes: ["locale", "viewport"], crossed: true, reason: "文言の長さで折り返しが変わる" },
  ];
  // desktop だけの変種では narrow との組が欠ける
  expect(
    codesOf(
      metadataOf({ viewports, scope: [], noise: [], displayAxes: localeAxes({ pairs: crossed }) }),
    ),
  ).toContain("display-axis-pair-not-crossed");
  const both = localeAxes({
    pairs: crossed,
    variants: [
      { label: "desktop-ja", viewport: "desktop", values: { locale: "ja" } },
      { label: "narrow-ja", viewport: "narrow", values: { locale: "ja" } },
    ],
  });
  expect(
    codesOf(metadataOf({ viewports, scope: [], noise: [], displayAxes: both })).filter((c) =>
      c.startsWith("display-axis"),
    ),
  ).toEqual([]);
});

test("2 つの軸を掛け合わせると宣言したら、既定以外の値の組ごとに変種が要る", () => {
  const locale = localeAxes();
  const theme = {
    ...locale.axes[0],
    name: "theme",
    candidate: "color-scheme",
    values: ["light", "dark"],
    default: "light",
  };
  const displayAxes = (crossed, variants) => ({
    ...noAxes(["locale", "color-scheme"]),
    axes: [locale.axes[0], theme],
    pairs: [
      { axes: ["locale", "viewport"], crossed: false, reason: "x" },
      { axes: ["theme", "viewport"], crossed: false, reason: "x" },
      { axes: ["locale", "theme"], crossed, reason: "x" },
    ],
    variants,
  });
  const singles = [
    { label: "desktop-ja", viewport: "desktop", values: { locale: "ja" } },
    { label: "desktop-dark", viewport: "desktop", values: { theme: "dark" } },
  ];
  const axisCodes = (m) => codesOf(m).filter((c) => c.startsWith("display-axis"));
  expect(axisCodes(metadataOf({ displayAxes: displayAxes(false, singles) }))).toEqual([]);
  expect(axisCodes(metadataOf({ displayAxes: displayAxes(true, singles) }))).toEqual([
    "display-axis-pair-not-crossed",
  ]);
  const crossedVariant = {
    label: "desktop-ja-dark",
    viewport: "desktop",
    values: { theme: "dark", locale: "ja" },
  };
  expect(
    axisCodes(metadataOf({ displayAxes: displayAxes(true, [...singles, crossedVariant]) })),
  ).toEqual([]);
  // 掛け合わせた変種だけでは、1 軸ずつ振った変種の代わりにならない
  expect(axisCodes(metadataOf({ displayAxes: displayAxes(true, [crossedVariant]) }))).toEqual([
    "display-axis-value-unswept",
    "display-axis-value-unswept",
  ]);
});

test("変種の宣言の型崩れは落とす（label・窓・値）", () => {
  const withVariant = (variant) =>
    codesOf(metadataOf({ displayAxes: localeAxes({ variants: [variant] }) }));
  const ok = { label: "desktop-ja", viewport: "desktop", values: { locale: "ja" } };
  expect(withVariant({ ...ok, label: "a|b" })).toContain("display-axis-variant-label-unusable");
  expect(withVariant({ ...ok, label: "desktop" })).toContain(
    "display-axis-variant-label-duplicated",
  );
  expect(withVariant({ ...ok, viewport: "tablet" })).toContain(
    "display-axis-variant-viewport-unknown",
  );
  for (const values of [undefined, {}, [], { locale: "en" }, { locale: "fr" }, { theme: "dark" }]) {
    expect(withVariant({ ...ok, values })).toContain("display-axis-variant-values-unusable");
  }
  expect(
    codesOf(
      metadataOf({ displayAxes: localeAxes({ variants: [ok, { ...ok, label: "desktop-ja-2" }] }) }),
    ),
  ).toContain("display-axis-variant-duplicated");
});

// ---- 採取環境と利用者環境（Issue #476） ----

test("viewer_environment が未確認・確かめ方の無い一致・欠落なら落とす", () => {
  for (const value of ["未確認", "一致", "一致:", "", null, 1]) {
    expect(codesOf(metadataOf({ viewerEnvironment: value }))).toEqual([
      "viewer-environment-unconfirmed",
    ]);
  }
  const metadata = metadataOf();
  delete (/** @type {any} */ (metadata).capture_conditions.viewer_environment);
  expect(codesOf(metadata)).toEqual(["viewer-environment-missing"]);
  // 陰性コントロール: 理由付きの乖離と、全角コロンの一致は通す
  expect(
    codesOf(
      metadataOf({
        viewerEnvironment:
          "乖離: 利用者は Windows で Meiryo UI、採取環境には無い（gaps.md 採取環境依存の未検証）",
      }),
    ),
  ).toEqual([]);
  expect(
    codesOf(metadataOf({ viewerEnvironment: "一致：利用者環境の Edge へ接続して撮った" })),
  ).toEqual([]);
});

test("browser の欠落・語彙外は落とす（新側を同じ扱いで撮れない）", () => {
  expect(codesOf(metadataOf({ browser: "edge" }))).toEqual(["browser-unknown"]);
  const metadata = metadataOf();
  delete (/** @type {any} */ (metadata).capture_conditions.browser);
  expect(codesOf(metadata)).toEqual(["browser-missing"]);
  expect(codesOf(metadataOf({ browser: "launched" }))).toEqual([]);
});

test("同梱テンプレートのプレースホルダのまま書いた表示の軸・利用者環境・ブラウザは落ちる", async () => {
  const { readFileSync } = await import("node:fs");
  const template = JSON.parse(
    readFileSync(
      new URL("../../../skills/parity-suite/assets/metadata-template.json", import.meta.url),
      "utf8",
    ),
  );
  const cc = template.capture_conditions;
  const codes = codesOf(
    metadataOf({
      displayAxes: cc.display_axes,
      viewerEnvironment: cc.viewer_environment,
      browser: cc.browser,
    }),
  );
  expect(codes).toEqual(
    expect.arrayContaining([
      "display-axis-name-unusable",
      "display-axis-candidate-unsurveyed",
      "viewer-environment-unconfirmed",
      "browser-unknown",
    ]),
  );
});

test("not_applicable が撮影ページの全てを覆う軸は落とす（変種の撮るはずの組が 0 件になり撮らずに通る）", () => {
  const axes = localeAxes();
  const metadata = metadataOf({
    displayAxes: {
      ...axes,
      axes: [{ ...axes.axes[0], not_applicable: [{ page: "list", reason: "英語固定" }] }],
    },
  });
  expect(codesOf(metadata)).toEqual([
    "display-axis-not-applicable-all-pages",
    "display-axis-variant-no-pages",
    // 0 ページの変種は数えないので、その値を撮る変種も無いことになる
    "display-axis-value-unswept",
  ]);
  // 撮るはずの組は 0 件なので穴は出ない（落とすのは上の finding だけ）
  expect(holeIdsOf(metadata)).toEqual([]);
});

test("軸の効くページが 1 つも無い複合変種は落とす（撮るはずの組 0 件で掛け合わせの対を満たさない。Codex レビュー #491）", () => {
  const pages = [
    { name: "list", path: "/orders" },
    { name: "print", path: "/orders/print" },
  ];
  const locale = localeAxes();
  const theme = {
    ...locale.axes[0],
    name: "theme",
    candidate: "color-scheme",
    values: ["light", "dark"],
    default: "light",
    not_applicable: [{ page: "list", reason: "一覧は配色が固定" }],
  };
  const localeAxis = {
    ...locale.axes[0],
    not_applicable: [{ page: "print", reason: "印刷画面は英語固定" }],
  };
  const crossedVariant = {
    label: "desktop-ja-dark",
    viewport: "desktop",
    values: { locale: "ja", theme: "dark" },
  };
  const displayAxes = {
    ...noAxes(["locale", "color-scheme"]),
    axes: [localeAxis, theme],
    pairs: [
      { axes: ["locale", "viewport"], crossed: false, reason: "x" },
      { axes: ["theme", "viewport"], crossed: false, reason: "x" },
      { axes: ["locale", "theme"], crossed: true, reason: "x" },
    ],
    variants: [
      { label: "desktop-ja", viewport: "desktop", values: { locale: "ja" } },
      { label: "desktop-dark", viewport: "desktop", values: { theme: "dark" } },
      crossedVariant,
    ],
  };
  const codes = codesOf(metadataOf({ pages, scope: [], noise: [], displayAxes })).filter((c) =>
    c.startsWith("display-axis"),
  );
  expect(codes).toContain("display-axis-variant-no-pages");
  // 落とした変種は掛け合わせの対も満たさない
  expect(codes).toContain("display-axis-pair-not-crossed");
});

test("変種の label に . / .. / パスの区切りは使えない（書き出し先が別の組のディレクトリを指す。Codex レビュー #491）", () => {
  for (const label of [".", "..", "a/b", "a\\b"]) {
    expect(
      codesOf(
        metadataOf({
          displayAxes: localeAxes({
            variants: [{ label, viewport: "desktop", values: { locale: "ja" } }],
          }),
        }),
      ),
    ).toContain("display-axis-variant-label-unusable");
  }
});

test("乖離に gaps.md の該当箇所が無ければ落とす（既知の乖離を未検証へ回さない。Codex レビュー #491）", () => {
  expect(codesOf(metadataOf({ viewerEnvironment: "乖離: Linux と Windows が異なる" }))).toEqual([
    "viewer-environment-gaps-ref-missing",
  ]);
  // 陰性コントロール: gaps.md の該当箇所を書けば通る
  expect(
    codesOf(
      metadataOf({
        viewerEnvironment: "乖離: Linux と Windows が異なる（gaps.md 採取環境依存の未検証）",
      }),
    ),
  ).toEqual([]);
});

test("「一致: 未確認」のように形だけ満たしたプレースホルダは落とす（Codex レビュー #491）", () => {
  for (const value of [
    "一致: 未確認",
    "一致: 未検証",
    "一致: TODO",
    "一致: tbd",
    "一致: <確かめ方>",
    "乖離: 未確認（gaps.md）",
  ]) {
    expect(codesOf(metadataOf({ viewerEnvironment: value }))).toEqual([
      "viewer-environment-unconfirmed",
    ]);
  }
  // 陰性コントロール: 確かめ方が書いてあれば、途中に「未確認」の語を含んでも通る
  expect(
    codesOf(
      metadataOf({
        viewerEnvironment: "一致: 利用者環境の Edge へ接続して撮った（以前の未確認を解消）",
      }),
    ),
  ).toEqual([]);
});

test("軸の根拠欄にテンプレートの <…> や TODO が残っていたら落とす（Codex レビュー #491）", () => {
  const axes = localeAxes();
  const withAxis = (patch) =>
    codesOf(
      metadataOf({
        displayAxes: { ...axes, axes: [{ ...axes.axes[0], ...patch }] },
        ...withVariantCaptures(),
      }),
    );
  expect(withAxis({ source: "<値の一覧をどこから数えたか>" })).toContain(
    "display-axis-source-missing",
  );
  expect(withAxis({ apply: "TODO" })).toContain("display-axis-apply-missing");
  expect(withAxis({ suite_expectations: "<期待値解決層のパス>" })).toContain(
    "display-axis-suite-undecided",
  );
  expect(
    withAxis({ not_applicable: [{ page: "list", reason: "未確認" }] }).filter((c) =>
      c.startsWith("display-axis-not-applicable-reason"),
    ),
  ).toEqual(["display-axis-not-applicable-reason-missing"]);
  const absentPlaceholder = noAxes();
  expect(
    codesOf(
      metadataOf({
        displayAxes: {
          ...absentPlaceholder,
          absent: absentPlaceholder.absent.map((a) =>
            a.candidate === "print" ? { ...a, source: "<無いと確かめた来歴>" } : a,
          ),
        },
      }),
    ),
  ).toEqual(["display-axis-absent-source-missing"]);
  expect(
    codesOf(
      metadataOf({
        displayAxes: localeAxes({
          pairs: [{ axes: ["locale", "viewport"], crossed: false, reason: "TBD" }],
        }),
        ...withVariantCaptures(),
      }),
    ),
  ).toEqual(["display-axis-pair-reason-missing"]);
});

test("変種の label にカンマは使えない（PARITY_NOISE_PAIRS の区切りと衝突する。Codex レビュー #491）", () => {
  expect(
    codesOf(
      metadataOf({
        displayAxes: localeAxes({
          variants: [{ label: "desktop,ja", viewport: "desktop", values: { locale: "ja" } }],
        }),
      }),
    ),
  ).toContain("display-axis-variant-label-unusable");
});

test("browser が cdp なのに接続先の同一性が無ければ落とす（現・新が別の機械へ接続しても揃ったことになる。Codex レビュー #491）", () => {
  for (const identity of [
    undefined,
    null,
    {},
    { product: "140", user_agent: "" },
    { product: "<browser.version()>", user_agent: "x" },
  ]) {
    expect(codesOf(metadataOf({ browserIdentity: identity }))).toEqual([
      "browser-identity-missing",
    ]);
  }
  // 陰性コントロール: launched では同一性を求めない
  expect(codesOf(metadataOf({ browser: "launched", browserIdentity: null }))).toEqual([]);
});

/** browser_os だけを差し替えた cdp の browser_identity。 */
function identityWithOs(/** @type {unknown} */ os) {
  return {
    product: "140.0.3485.54",
    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/140.0",
    ...(os === undefined ? {} : { browser_os: os }),
  };
}

test("browser が cdp なのに描画するブラウザ側の OS が無ければ落とす（reduced UA では別の機械を見分けられない。Issue #502）", () => {
  for (const os of [undefined, null, "Windows 15.0.0", ["Windows"]]) {
    expect(codesOf(metadataOf({ browserIdentity: identityWithOs(os) }))).toEqual([
      "browser-os-missing",
    ]);
  }
  // 陰性コントロール: launched では OS を求めない
  expect(codesOf(metadataOf({ browser: "launched", browserIdentity: null }))).toEqual([]);
});

test.each([
  ["navigator.platform への代替", { platform: "Win32" }],
  [
    "brands / mobile を残した生の値",
    {
      platform: "Windows",
      platformVersion: "15.0.0",
      architecture: "x86",
      brands: [],
      mobile: false,
    },
  ],
  ["キーが欠けた値", { platform: "Windows", platformVersion: "15.0.0" }],
  ["文字列でない値", { platform: "Windows", platformVersion: 15, architecture: "x86" }],
  ["空の platform", { platform: "", platformVersion: "15.0.0", architecture: "x86" }],
  ["空白だけの platform", { platform: "  ", platformVersion: "15.0.0", architecture: "x86" }],
  [
    "テンプレートのプレースホルダ",
    {
      platform: "<platform>",
      platformVersion: "<platformVersion>",
      architecture: "<architecture>",
    },
  ],
  [
    "platformVersion のプレースホルダ",
    { platform: "Linux", platformVersion: "<v>", architecture: "x86" },
  ],
])("cdp の browser_os が正規化した形でなければ落とす: %s（Issue #502）", (_label, os) => {
  expect(codesOf(metadataOf({ browserIdentity: identityWithOs(os) }))).toEqual([
    "browser-os-invalid",
  ]);
});

test("cdp の browser_os は正規化した 3 キーなら通し、空の platformVersion も認める（Linux の Chromium は空で返す。Issue #502）", () => {
  for (const os of [
    { platform: "Windows", platformVersion: "15.0.0", architecture: "x86" },
    { architecture: "x86", platform: "Linux", platformVersion: "" },
  ]) {
    expect(codesOf(metadataOf({ browserIdentity: identityWithOs(os) }))).toEqual([]);
  }
});

test("宣言に無い組（消した・改名した変種の古い記録）が noise_baseline と capture_scope に残っていたら落とす（Codex レビュー #491）", () => {
  const { scope, noise } = withVariantCaptures();
  // 変種を宣言から消し、記録だけを残す
  const metadata = metadataOf({ displayAxes: localeAxes({ variants: [] }), scope, noise });
  const codes = codesOf(metadata);
  expect(codes.filter((c) => c === "recorded-combination-undeclared")).toHaveLength(2);
  // 陰性コントロール: 宣言どおりの記録だけなら出ない
  expect(
    codesOf(metadataOf({ displayAxes: localeAxes(), scope, noise })).filter(
      (c) => c === "recorded-combination-undeclared",
    ),
  ).toEqual([]);
});
