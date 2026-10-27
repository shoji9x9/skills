// dimension-fit.test.ts が使うヘルパーと fixture。
import { expect, assert, vi } from "vitest";
import { main } from "../../../../skills/parity-suite/scripts/dimension-fit.mjs";
import { parseJsonAs } from "../../../lib/parse-as.ts";

export type Win = { width: number; height: number };
type Layout = (w: Win) => Record<string, Record<string, number> | null>;
/** 当てはめに渡す samples の 1 要素。rect は窓で表示されなければ null。 */
type SampleElement = {
  page: string;
  element: string;
  rects: { window: Win; rect: Record<string, number> | null }[];
};
export type Samples = { windows: Win[]; elements: SampleElement[] };

/** samples の 1 つ目の要素の、1 つ目の窓の矩形（表示されている窓なので在る）。 */
export function firstRect(s: Samples): Record<string, number> {
  const rect = s.elements[0].rects[0].rect;
  assert.exists(rect, "1 つ目の要素の 1 つ目の窓に矩形が無い");
  return rect;
}
export type Metadata = {
  slug: string;
  capture_conditions: {
    viewports: unknown[];
    pages: { name: string; path: string }[];
    dimension_model?: unknown;
  };
  traits: { elements: string[] };
};
/** dimension-fit.mjs が書く dimension_model のうち、テストが読み書きする欄。 */
export type Fit = {
  page: string;
  element: string;
  property: string;
  offset: number;
  residual: number;
  ratio: { width: number; height: number };
};
export type DimensionModel = {
  status?: string;
  measured_at?: unknown;
  tool_version?: string;
  fits: Fit[];
  unfit: unknown[];
};
export type FittedMetadata = {
  capture_conditions: { viewports: unknown[]; dimension_model: DimensionModel };
};
export type Failure = {
  element: string;
  property: string;
  reason: string;
  window?: Win;
  deviation: number;
};
/** CLI が stdout に出す JSON のうち、テストが読む欄（fit と check の両方）。 */
type CliOutput = {
  judged?: boolean;
  ok?: boolean;
  checked?: number;
  reason?: string | null;
  failures: Failure[];
  unfit_to_note?: unknown[];
  dimension_model: { unfit: Unfit[] };
};
/** fit が unfit に残す 1 件のうち、テストが読む欄。 */
export type Unfit = { element: string; property: string; reason: string };
/** check --write が書く replace-metadata.json のうち、テストが読む欄。 */
type WrittenCheck = { dimension_check: Record<string, unknown> };

/** 幅と高さを独立に動かした 4 窓（撮影ビューポート 1366×768 を含む）。 */
export const WINDOWS = [
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1280, height: 1024 },
  { width: 1920, height: 800 },
];

/** 移行元の式: 操作ボタンはコンテナ（幅 W − 40 の 50%）＋ 12、グリッドの高さは H − 132。 */
export const formula = (w: Win) => ({
  button: { x: 0.5 * (w.width - 40) + 12, y: 64, width: 96, height: 32 },
  grid: { x: 20, y: 120, width: w.width - 40, height: w.height - 132 },
});

/** 1366×768 の実測 px をそのまま並べた版組（新側の失敗形）。 */
export const pinned = () => formula(WINDOWS[0]);

/**
 * @param {(w: {width:number,height:number}) => Record<string, Record<string, number> | null>} layout
 * @param {{width:number,height:number}[]} [windows]
 */
export const samplesOf = (layout: Layout, windows: Win[] = WINDOWS): Samples => ({
  windows,
  elements: ["button", "grid"].map((element) => ({
    page: "list",
    element,
    rects: windows.map((w) => ({ window: w, rect: layout(w)[element] })),
  })),
});

export const metadataOf = (
  viewports: unknown[] = [{ width: 1366, height: 768, label: "desktop" }],
): Metadata => ({
  slug: "order-list",
  capture_conditions: { viewports, pages: [{ name: "list", path: "/orders" }] },
  traits: { elements: ["button", "grid"] },
});

/** メモリ上のファイルで main を回す。 */
export function run(argv: string[], files: Record<string, unknown>) {
  // check が読む現側 samples は、明示しなければ直近の fittedMetadata が当てはめたもの
  const fs = new Map(
    Object.entries({ "/w/s.json": currentSamplesText, ...files }).map(
      ([k, v]): [string, string] => [k, typeof v === "string" ? v : JSON.stringify(v)],
    ),
  );
  let stdout = "";
  let stderr = "";
  const ow = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((s) => ((stdout += String(s)), true));
  const ew = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((s) => ((stderr += String(s)), true));
  let code;
  try {
    code = main(argv, {
      cwd: "/w",
      readFile: (p) => {
        const text = fs.get(p);
        if (text === undefined) throw new Error(`ENOENT ${p}`);
        return text;
      },
      writeFile: (p, s) => fs.set(p, s),
    });
  } finally {
    ow.mockRestore();
    ew.mockRestore();
  }
  return {
    code,
    stdout,
    stderr,
    // stdout が空なら null（JSON.parse("null") と同じ値）。形は各テストの expect が確かめる
    json: parseJsonAs<CliOutput>(stdout || "null"),
    // 無いパスなら、テストを失敗させる
    file: <T = WrittenCheck>(p: string): T => {
      const text = fs.get(p);
      assert.exists(text, `${p} が書かれていない`);
      return parseJsonAs<T>(text);
    },
  };
}

/** 現側で fit して dimension_model を書いた metadata.json を返す。 */
/** 直近の fittedMetadata が当てはめに使った現側 samples の本文（check の --current-samples に渡す。指紋が一致する） */
let currentSamplesText = "";

export function fittedMetadata(layout: Layout = formula) {
  currentSamplesText = JSON.stringify(samplesOf(layout));
  const r = run(["fit", "--samples", "s.json", "--metadata", "m.json", "--write"], {
    "/w/s.json": currentSamplesText,
    "/w/m.json": metadataOf(),
  });
  expect(r.code).toBe(0);
  return r.file<FittedMetadata>("/w/m.json");
}
