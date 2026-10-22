// amend-verify.test.ts のヘルパー（画像の組み立て・main の呼び出し・偽の pngjs で動かす CLI）。

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodePng } from "../../lib/testing/fake-pngjs.ts";
import { parseJsonAs } from "../../lib/parse-as.ts";
import * as verify from "../../../skills/parity-diff/scripts/amend-verify.mjs";
import type { Image } from "../../../skills/parity-diff/scripts/amend-verify.mjs";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

/** 単色の画像を作る。 */
export function solid(width: number, height: number, rgba: number[]): Image {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(rgba, i * 4);
  return { width, height, data };
}

export function clone(img: Image): Image {
  return { width: img.width, height: img.height, data: Uint8Array.from(img.data) };
}

export function setPixel(img: Image, { x, y, rgba }: { x: number; y: number; rgba: number[] }) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

export const WHITE = [255, 255, 255, 255];
export const GREY = [128, 128, 128, 255];
export const BLACK = [0, 0, 0, 255];

// 10x10。現行は (4,4) が灰。改修前の新側は白（1 画素違う）。
export function scene() {
  const current = solid(10, 10, WHITE);
  setPixel(current, { x: 4, y: 4, rgba: GREY });
  const prevNew = solid(10, 10, WHITE);
  return { current, prevNew };
}

// 終了コードだけでは区別できない（この環境には pngjs が無く、どの入力不備も exit 2 になりうる）。
// 落ちた理由（stderr）まで固定する。
export async function run(argv: string[]) {
  const written: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  try {
    const code = await verify.main(argv);
    return { code, stderr: written.join("") };
  } finally {
    process.stderr.write = original;
  }
}

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const script = join(repoRoot, "skills/parity-diff/scripts/amend-verify.mjs");
export const HOOKS = fileURLToPath(
  new URL("../../lib/testing/fake-pngjs-hooks.ts", import.meta.url),
);

/** 画像を PNG で書く。 */
export function writeImage(path: string, img: Image) {
  writeFileSync(path, encodePng(img.width, img.height, Uint8Array.from(img.data)));
}

/** scene() の 3 枚を書き、パスを返す。nextChange で撮り直した新側を変える。 */
export function writeScene(dir: string, nextChange: (next: Image) => void = () => {}) {
  const { current, prevNew } = scene();
  const next = clone(prevNew);
  nextChange(next);
  const paths = {
    prev_new: join(dir, "prev-new.png"),
    new: join(dir, "new.png"),
    current: join(dir, "current.png"),
  };
  writeImage(paths.prev_new, prevNew);
  writeImage(paths.new, next);
  writeImage(paths.current, current);
  return paths;
}

export function singleArgs(paths: ReturnType<typeof writeScene>, pair = "p|hover|desktop") {
  return [
    "--pair",
    pair,
    "--prev-new",
    paths.prev_new,
    "--new",
    paths.new,
    "--current",
    paths.current,
  ];
}

/** 偽の pngjs で CLI を子プロセスとして実行する（計測の環境変数は親から引き継ぐ）。 */
export function runCli(argv: string[]) {
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(HOOKS).href, script, ...argv], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CHILD_TIMEOUT_MS,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export type PairRecord = {
  pair: string;
  pass: boolean;
  outside_diff_pixels: number | null;
  inside_diff_before: number | null;
  inside_diff_after: number | null;
  margin: number;
  declared_regions: unknown[];
  regions: unknown[];
  inputs: Record<string, { path: string; sha256: string }>;
  reasons: string[];
};
export type AmendRecord = {
  tool: string;
  version: string;
  change_id?: string;
  pairs: PairRecord[];
};

export const parseRecord = (text: string) => parseJsonAs<AmendRecord>(text);
