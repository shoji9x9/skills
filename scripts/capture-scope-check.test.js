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
 * 穴の無い metadata を組み立てる。差し替えたい部分だけ渡す。
 * @param {{ scope?: unknown, exemptions?: unknown, noise?: unknown }} [override]
 */
function metadataOf(override = {}) {
  return {
    slug: "order-list",
    capture_conditions: {
      full_page: true,
      viewports: [{ width: 1366, height: 768, label: "desktop" }],
      pages: [{ name: "list", path: "/orders" }],
      states: ["default", "hover"],
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
    noise: [{ page: "list", state: "default", viewport: "desktop", pixel_diff: 0 }],
  });
  expect(holeIdsOf(metadata)).toEqual(["list|default|desktop#scroll:グリッド本体"]);
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

test("撮っていない組の実測が混ざっていれば落ちる", () => {
  const metadata = metadataOf({
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

test("撮影組の鍵はページ・状態・ビューポートで作る", () => {
  expect(combinationKey({ page: "list", state: "hover", viewport: "mobile" })).toBe(
    "list|hover|mobile",
  );
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
