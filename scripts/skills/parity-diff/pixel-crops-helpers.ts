// pixel-crops.test.ts のヘルパー（CLI の起動・場面の画像とマスクの組み立て・main と同じ段取りの候補づくり）。

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert } from "vitest";
import {
  clusterComponents,
  filterAndMerge,
  mergeThenFilter,
  absorbStrictIntoRegions,
} from "../../../skills/parity-diff/scripts/pixel-crops.mjs";
import type { Rect } from "../../../skills/parity-diff/scripts/pixel-crops.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { encodePng } from "../../lib/testing/fake-pngjs.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

export const SCRIPT = fileURLToPath(
  new URL("../../../skills/parity-diff/scripts/pixel-crops.mjs", import.meta.url),
);
export const HOOKS = fileURLToPath(
  new URL("../../lib/testing/fake-pngjs-hooks.ts", import.meta.url),
);

export type Region = {
  id: number;
  bbox: Rect;
  pixels: number;
  strict_pixels: number;
  threshold_bbox: Rect;
  absorbed_strict_only_pixels: number;
  crop_current: string;
  crop_new: string;
};
export type StrictRegion = {
  id: string;
  bbox: Rect;
  strict_pixels: number;
  overlaps_regions: number[];
  crop_current: string;
  crop_new: string;
};
export type Output = {
  summary: Record<string, number | null>;
  regions: Region[];
  strict_only_regions: StrictRegion[];
};
export type Run = { code: number | null; stdout: string; stderr: string; out: string };

function isOutput(value: unknown): value is Output {
  if (typeof value !== "object" || value === null) return false;
  return "summary" in value && "regions" in value && "strict_only_regions" in value;
}

/** stdout の JSON を読む。形が違えばテストを落とす。 */
export function parsed(run: Run): Output {
  const value: unknown = JSON.parse(run.stdout);
  assert(
    isOutput(value),
    `stdout が { summary, regions, strict_only_regions } でない: ${run.stdout}`,
  );
  return value;
}

/** 3 枚の画像のファイルを置いて CLI を実行する。fake を false にすると pngjs の無い環境で実行する。 */
export function runFiles(
  dir: string,
  files: { current: Buffer; next: Buffer; diff: Buffer },
  { args = [], fake = true }: { args?: string[]; fake?: boolean } = {},
): Run {
  const paths = [join(dir, "current.png"), join(dir, "new.png"), join(dir, "diff.png")];
  writeFileSync(paths[0] ?? "", files.current);
  writeFileSync(paths[1] ?? "", files.next);
  writeFileSync(paths[2] ?? "", files.diff);
  const out = join(dir, "out");
  const res = spawnSync(
    process.execPath,
    [...(fake ? ["--import", HOOKS] : []), SCRIPT, ...paths, "--out", out, ...args],
    { encoding: "utf8", env: process.env, timeout: CHILD_TIMEOUT_MS },
  );
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, out };
}

/** RGBA の画素の並び（[r,g,b,a] の配列）から 3 枚の画像を作って実行する。 */
export function runRaw(
  images: {
    width: number;
    height: number;
    current: number[][];
    next: number[][];
    diff: number[][];
  },
  args: string[] = [],
): Run {
  const { width, height } = images;
  const png = (pixels: number[][]) => encodePng(width, height, Uint8Array.from(pixels.flat()));
  return runFiles(
    makeTempDir("pixel-crops-"),
    { current: png(images.current), next: png(images.next), diff: png(images.diff) },
    { args },
  );
}

export const BASE = [162, 101, 36, 255];
export const SUBTLE = [162, 102, 36, 255]; // 緑だけ 1/255 違う
export const STRONG = [255, 255, 255, 255];
export const RED = [255, 0, 0, 255];
export const WHITE = [255, 255, 255, 255];

/**
 * 差分の場面を画像にして実行する。
 * marked はツールが差分画像に印を付けた画素（new は current と大きく違う）、
 * subtle はしきい値の内側で 1/255 だけ違う画素（差分画像に印は無い）。
 */
export function runScene(
  scene: { width: number; height: number; marked?: Uint8Array; subtle?: Uint8Array },
  { args = [], dir = makeTempDir("pixel-crops-") }: { args?: string[]; dir?: string } = {},
): Run {
  const { width, height } = scene;
  const marked = scene.marked ?? new Uint8Array(width * height);
  const subtle = scene.subtle ?? new Uint8Array(width * height);
  const current = new Uint8Array(width * height * 4);
  const next = new Uint8Array(width * height * 4);
  const diff = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    current.set(BASE, i * 4);
    if (marked[i] === 1) next.set(STRONG, i * 4);
    else if (subtle[i] === 1) next.set(SUBTLE, i * 4);
    else next.set(BASE, i * 4);
    diff.set(marked[i] === 1 ? RED : WHITE, i * 4);
  }
  return runFiles(
    dir,
    {
      current: encodePng(width, height, current),
      next: encodePng(width, height, next),
      diff: encodePng(width, height, diff),
    },
    { args },
  );
}

/** width×height のマスクに、矩形（x, y, w, h）の輪郭か塗りを立てる。 */
export function maskWith(
  width: number,
  height: number,
  rects: { x: number; y: number; w: number; h: number; ring?: boolean }[],
) {
  const mask = new Uint8Array(width * height);
  for (const { x, y, w, h, ring } of rects) {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        const edge = yy === y || yy === y + h - 1 || xx === x || xx === x + w - 1;
        if (!ring || edge) mask[yy * width + xx] = 1;
      }
    }
  }
  return mask;
}

/** width×height のマスクに、点の並び [[x, y], ...] を立てる。 */
export function maskOfPoints(width: number, height: number, points: number[][]) {
  const mask = new Uint8Array(width * height);
  for (const [x, y] of points) mask[(y ?? 0) * width + (x ?? 0)] = 1;
  return mask;
}

/** candidates が返す領域。取り込みの有無で、しきい値の bbox と取り込んだ画素数の欄があるかが変わる。 */
export type CandidateRegion = {
  pixels: number;
  bbox: Rect;
  threshold_bbox?: Rect;
  absorbed_strict_only_pixels?: number;
};

/** RGBA バッファを作る。pixels は [r,g,b,a] の配列。 */
export const rgba = (pixels: number[][]) => Uint8Array.from(pixels.flat());

/** main と同じ段取りで regions / strict-only を作る（PNG を読まない部分）。 */
export function candidates(
  thresholdMask: Uint8Array,
  strictOnlyMask: Uint8Array,
  {
    width,
    height,
    withAbsorb = true,
    minCluster = 4,
  }: { width: number; height: number; withAbsorb?: boolean; minCluster?: number },
): {
  regions: CandidateRegion[];
  strict: ReturnType<typeof mergeThenFilter>;
  absorbedPixels: number;
} {
  const thresholdRegions = filterAndMerge(clusterComponents(thresholdMask, width, height), 1, 8);
  if (!withAbsorb) {
    const strict = mergeThenFilter(clusterComponents(strictOnlyMask, width, height), minCluster, 8);
    return { regions: thresholdRegions, strict, absorbedPixels: 0 };
  }
  const absorbed = absorbStrictIntoRegions(thresholdRegions, strictOnlyMask, {
    width,
    height,
    pad: 8,
  });
  const strict = mergeThenFilter(
    clusterComponents(absorbed.remainingMask, width, height),
    minCluster,
    8,
  );
  return { regions: absorbed.regions, strict, absorbedPixels: absorbed.absorbedPixels };
}
