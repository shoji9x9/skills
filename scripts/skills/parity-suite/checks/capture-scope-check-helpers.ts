// capture-scope-check.test.ts が使うヘルパーと fixture。
import {
  main,
  checkCaptureScope,
  AXIS_CANDIDATES,
} from "../../../../skills/parity-suite/scripts/capture-scope-check.mjs";
import { runInMemory } from "../../../lib/testing/memory-cli.ts";

/**
 * スクロールバーを表示した窓のはみ出しの実測（Issue #449）。差し替えたい部分だけ渡す。
 *
 * 形は同梱テンプレート（assets/metadata-template.json の capture_conditions.overflow）と同じ。
 * 頁 list は最小幅 1280 を持つので、それより狭い窓（1180 幅）で横スクロールバーが場所を取る。
 * 高さ 3300 の窓は中身（3200）が収まる窓で、縦のはみ出しは頁の高さの決め方（100% か 100vh か）だけで決まる。
 * @param {Record<string, unknown>} [override]
 */
export function overflowOf(override: Record<string, unknown> = {}) {
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

/** 表示の軸の宣言。軸・対・変種の中身はテストごとに組み立てる。 */
type DisplayAxes = {
  axes: unknown[];
  absent: { candidate: string; source: string }[];
  pairs: unknown[];
  variants: unknown[];
};

/**
 * 表示の軸が 1 つも無い宣言（候補を全て absent に振り分ける）。形は同梱テンプレートの capture_conditions.display_axes と同じ。
 * @param {string[]} [except] absent から外す候補 id（axes に書く側）
 */
export function noAxes(except: string[] = []): DisplayAxes {
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
 * ロケール（既定 en、ほかに ja）を持つ宣言。1 軸ずつ振る変種と、窓との対の判断まで揃えた抜けの無い形。
 * @param {Record<string, unknown>} [override]
 */
export function localeAxes(override: Record<string, unknown> = {}) {
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
export function withVariantCaptures(states: string[] = ["default", "hover"]) {
  const scope = [
    ...defaultScope(),
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
    ...defaultNoise(),
    ...states.map((state) => ({ page: "list", state, viewport: "desktop-ja", pixel_diff: 0 })),
  ];
  return { scope, noise };
}

/** 差し替えを渡さない metadata の capture_scope（2 組。hover の組はスクロールするコンテナを 1 つ持つ）。 */
function defaultScope() {
  return [
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
  ];
}

/** 差し替えを渡さない metadata の noise_baseline。 */
function defaultNoise() {
  return [
    { page: "list", state: "default", viewport: "desktop", pixel_diff: 0 },
    { page: "list", state: "hover", viewport: "desktop", pixel_diff: 0 },
  ];
}

/** metadataOf へ渡す差し替え。値はわざと不正な形も渡すので unknown にする。 */
type MetadataOverride = {
  scope?: unknown;
  exemptions?: unknown;
  noise?: unknown;
  pages?: unknown;
  states?: unknown;
  viewports?: unknown;
  scrollbars?: unknown;
  scrollbarsReason?: unknown;
  scrollbarEnvironment?: unknown;
  overflow?: unknown;
  mode?: unknown;
  displayAxes?: unknown;
  viewerEnvironment?: unknown;
  browser?: unknown;
  browserIdentity?: unknown;
  traits?: unknown;
};

/** CLI が stdout に書く結果。 */
type CliResult = ReturnType<typeof checkCaptureScope>;

/**
 * 抜けの無い metadata を組み立てる。差し替えたい部分だけ渡す。
 *
 * 期待値（撮るはずの組）は `capture_conditions` の 3 軸の直積なので、
 * 1 組だけを対象にするテストは `states` 等の軸も同時に狭める（狭めないと「採っていない組」が増える）。
 * @param {{ scope?: unknown, exemptions?: unknown, noise?: unknown, pages?: unknown, states?: unknown, viewports?: unknown, scrollbars?: unknown, overflow?: unknown }} [override]
 */
export function metadataOf(override: MetadataOverride = {}) {
  return {
    slug: "order-list",
    mode: pick(override, "mode", "feature"),
    capture_conditions: {
      full_page: true,
      viewports: pick(override, "viewports", [{ width: 1366, height: 768, label: "desktop" }]),
      pages: pick(override, "pages", [{ name: "list", path: "/orders" }]),
      states: pick(override, "states", ["default", "hover"]),
      capture_scope: override.scope ?? defaultScope(),
      capture_scope_exemptions: override.exemptions ?? [],
      scrollbars: pick(override, "scrollbars", "shown"),
      ...("scrollbarsReason" in override ? { scrollbars_reason: override.scrollbarsReason } : {}),
      scrollbar_environment: pick(
        override,
        "scrollbarEnvironment",
        "Linux の headless Chromium 140（クラシック・15px）",
      ),
      overflow: pick(override, "overflow", overflowOf()),
      display_axes: pick(override, "displayAxes", noAxes()),
      viewer_environment: pick(
        override,
        "viewerEnvironment",
        "一致: 利用者環境のブラウザへ接続し CSS.getPlatformFontsForNode で描いた書体を読んだ",
      ),
      browser: pick(override, "browser", "cdp"),
      browser_identity: pick(override, "browserIdentity", {
        product: "140.0.3485.54",
        user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/140.0",
        browser_os: { platform: "Windows", platformVersion: "15.0.0", architecture: "x86" },
      }),
    },
    noise_baseline: override.noise ?? defaultNoise(),
    traits: pick(override, "traits", { elements: ["グリッド本体", "保存ボタン"] }),
  };
}

/** override に key があればその値（undefined も含む）を、無ければ fallback を使う。 */
function pick(override: MetadataOverride, key: keyof MetadataOverride, fallback: unknown): unknown {
  return key in override ? override[key] : fallback;
}

/** main をメモリ上のファイルで実行する。 */
export const run = (argv: string[], files: Record<string, string>) =>
  runInMemory<CliResult>(main, argv, { files });

// わざと欄を外した metadata も渡すので unknown で受ける（checkCaptureScope も unknown で受ける）
export const codesOf = (metadata: unknown) =>
  checkCaptureScope(metadata).findings.map((f) => f.code);

export const holeIdsOf = (metadata: unknown) => checkCaptureScope(metadata).holes.map((h) => h.id);

// コンテナごとの overflow とスクロールバーの厚み（Issue #495）。実例: ダイアログの中のデータグリッド（628×298、中身 628 幅）。
// バーを隠して撮ると client 628 = scroll 628 で横のはみ出しが消え、現行の横のバーと新側の右端の切れが区別できない。
/**
 * 撮影組 1 つ・コンテナ 1 つの metadata。
 * @param {Record<string, unknown>} container コンテナの差し替え
 * @param {Record<string, unknown>} [override] metadataOf へ渡す差し替え
 */
export function withContainer(container: Record<string, unknown>, override: MetadataOverride = {}) {
  return metadataOf({
    scope: containerScope(container),
    states: ["default"],
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
    ...override,
  });
}

/**
 * withContainer の capture_scope（撮影組 1 つ・コンテナ 1 つ）。
 * @param {Record<string, unknown>} container コンテナの差し替え
 */
export function containerScope(container: Record<string, unknown>) {
  return [
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
  ];
}

/** @param {Record<string, unknown>} windowOverride 頁 list の 2 つ目の窓（1180x768）へ当てる差し替え */
export function overflowWithWindow(windowOverride: Record<string, unknown>) {
  const base = overflowOf();
  const page = base.pages[0];
  return overflowOf({
    pages: [
      {
        ...page,
        windows: [page.windows[0], { ...page.windows[1], ...windowOverride }, page.windows[2]],
      },
    ],
  });
}

/** browser_os だけを差し替えた cdp の browser_identity。 */
export function identityWithOs(os: unknown) {
  return {
    product: "140.0.3485.54",
    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/140.0",
    ...(os === undefined ? {} : { browser_os: os }),
  };
}

/** 最小幅を持たない頁の overflow の記録（縦にだけはみ出す 1 窓）。 */
export function pageWithoutMinWidth() {
  return {
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
  };
}

/** overflowOf の頁で、中身が収まる高さの窓でも縦に 16px はみ出す記録（body の height: 100% と既定の margin）。 */
export function verticalAtFitWindow() {
  const page = overflowOf().pages[0];
  return {
    ...page,
    windows: [
      page.windows[0],
      page.windows[1],
      { ...page.windows[2], vertical: true, overflow_y_px: 16 },
    ],
  };
}
