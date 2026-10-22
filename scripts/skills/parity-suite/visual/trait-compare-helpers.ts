// trait-compare.test.ts が使うヘルパーと fixture。
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Scroll,
  TextOwner,
  Trait as ComparedTrait,
} from "../../../../skills/parity-suite/scripts/trait-compare.mjs";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// 特性には、採取（trait-capture.mjs）が書き compareTraits は読まない child_inline_styles も持たせる。
type Trait = ComparedTrait & {
  child_inline_styles: { index: number; tag: string; style: string }[];
};

export const font = (overrides: Record<string, string> = {}) => ({
  "font-family": "arial, sans-serif",
  "font-size": "13.3333px",
  "font-style": "normal",
  "font-weight": "400",
  "line-height": "normal",
  ...overrides,
});
// path を dims で渡すと、持ち主を子孫の span にする（渡さなければ要素自身の button）。
export const owner = (
  text: string,
  style: Record<string, string>,
  dims: Partial<TextOwner> = {},
): TextOwner => ({
  path: "",
  tag: (dims.path ?? "") === "" ? "button" : "span",
  text,
  style,
  advance: 26.65625,
  glyph_height: 15,
  lines: 1,
  rect: { x: 16, y: 14, width: 26.65625, height: 15 },
  ...dims,
});
export const trait = (textOwners: TextOwner[] | undefined, name = "toolbar.settings"): Trait => ({
  name,
  computed: { "font-family": "arial, sans-serif", "font-size": "13.3333px" },
  before: null,
  after: null,
  rect: { x: 10, y: 10, width: 40, height: 24 },
  child_inline_styles: [],
  ...(textOwners === undefined ? {} : { text_owners: textOwners }),
});

// スクロールするコンテナ（Issue #495）。値は Chrome 149 の実測: 628×298 のコンテナ・中身 628 幅で、スクロールバーが場所を取る撮影では
// 現行（overflow: auto）は縦横とも 15px、新側（overflow-x: hidden）は横のバーが出ない。
export const scrollOf = (overrides: Partial<Scroll> = {}): Scroll => ({
  overflowing_x: true,
  overflowing_y: true,
  vertical_bar_px: 15,
  horizontal_bar_px: 15,
  style: { "scrollbar-width": "auto", "scrollbar-color": "auto", "scrollbar-gutter": "auto" },
  webkit: webkitOf(),
  ...overrides,
});
/** scrollOf の webkit（::-webkit-scrollbar 系を読めたブラウザの計算値）。 */
export function webkitOf() {
  return {
    "::-webkit-scrollbar": { width: "auto", "background-color": "rgba(0, 0, 0, 0)" },
    "::-webkit-scrollbar-thumb": { width: "auto", "border-top-left-radius": "0px" },
  };
}
export const grid = (scroll: Scroll | null): Trait => ({ ...trait([], "dialog.grid"), scroll });

// --- 相対幾何（要素対の関係だけを比べる） ---

type Box = { x: number; y: number; width: number; height: number };
export const placed = (name: string, rect: Box): Trait => ({ ...trait([], name), rect });
export const shift = (r: Box, dx: number, dy: number): Box => ({ ...r, x: r.x + dx, y: r.y + dy });

export const script = join(repoRoot, "skills/parity-suite/scripts/trait-compare.mjs");

/** CLI に 2 つの採取結果を渡して起動する。`extra` は 2 つのファイルの後ろに足す引数。 */
export function runCli(baseline: unknown, capture: unknown, extra: string[] = []) {
  const dir = makeTempDir("trait-compare-");
  const files = [join(dir, "baseline.json"), join(dir, "capture.json")];
  writeFileSync(files[0], JSON.stringify(baseline));
  writeFileSync(files[1], JSON.stringify(capture));
  return spawnSync(process.execPath, [script, ...files, ...extra], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
}
