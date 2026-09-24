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
} from "../skills/parity-suite/scripts/capture-scope-check.mjs";

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
            },
          ],
          named_elements_outside: [],
        },
      ],
      capture_scope_exemptions: override.exemptions ?? [],
      scrollbars: "scrollbars" in override ? override.scrollbars : "hidden",
      overflow: "overflow" in override ? override.overflow : overflowOf(),
    },
    noise_baseline: override.noise ?? [
      { page: "list", state: "default", viewport: "desktop", pixel_diff: 0 },
      { page: "list", state: "hover", viewport: "desktop", pixel_diff: 0 },
    ],
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
            client: { width: 1200, height: 600 },
            scroll: { width: 1200, height: 2400 },
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
      new URL("../skills/parity-suite/assets/metadata-template.json", import.meta.url),
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
