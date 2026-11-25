// 2 回撮りの PNG からマスクの候補を出す処理（parity-suite 同梱の noise-masks.mjs の suggestNoiseMasks）のテスト（Issue #1106）。
// pngjs はこのリポジトリに入れないので、PNG の読み書きの偽物（scripts/lib/testing/fake-pngjs.ts）に差し替える。
// ページは、ランナーの中の偽物にする（ページで探す処理は noise-masks.test.ts が確かめる）。

import { assert, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MAX_REGIONS } from "../../../../skills/parity-suite/scripts/noise-masks.mjs";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import { encodePng } from "../../../lib/testing/fake-pngjs.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";

const HOOKS = fileURLToPath(new URL("../../../lib/testing/fake-pngjs-hooks.ts", import.meta.url));
const RUNNER = fileURLToPath(new URL("./noise-masks-suggest-runner.ts", import.meta.url));

type Rect = { x: number; y: number; width: number; height: number };
type Output = {
  result: {
    version: string;
    status: string;
    candidates: unknown[];
    unlocated: unknown[];
    omitted_regions: number;
  };
  searched: Rect[][];
};

function isOutput(value: unknown): value is Output {
  return typeof value === "object" && value !== null && "result" in value && "searched" in value;
}

/** width × height の白い画像のうち、changed の画素だけ黒くした PNG を書き、パスを返す。 */
function writeImage(
  dir: string,
  name: string,
  size: { width: number; height: number; changed?: [number, number][] },
) {
  const data = new Uint8Array(size.width * size.height * 4).fill(255);
  for (const [x, y] of size.changed ?? [])
    data.fill(0, (y * size.width + x) * 4, (y * size.width + x) * 4 + 3);
  const path = join(dir, name);
  writeFileSync(path, encodePng(size.width, size.height, data));
  return path;
}

/** 偽の pngjs と偽のページで suggestNoiseMasks を子プロセスで呼ぶ。 */
function suggest(input: {
  dpr: number;
  baseline: string;
  pass2: string;
  fullPage: boolean;
}): Output {
  const r = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(HOOKS).href, RUNNER, JSON.stringify(input)],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: CHILD_TIMEOUT_MS,
    },
  );
  assert(r.status === 0, `runner failed: ${r.stderr}`);
  const parsed: unknown = JSON.parse(r.stdout);
  assert(isOutput(parsed), "runner の出力の形が違う");
  return parsed;
}

test("同じ画像なら、ページで探さずに候補を空で返す", () => {
  const dir = makeTempDir("noise-masks-");
  const { result, searched } = suggest({
    dpr: 1,
    baseline: writeImage(dir, "a.png", { width: 32, height: 32 }),
    pass2: writeImage(dir, "b.png", { width: 32, height: 32 }),
    fullPage: false,
  });
  expect(result).toEqual({
    version: "1",
    status: "ok",
    candidates: [],
    unlocated: [],
    omitted_regions: 0,
  });
  expect(searched).toEqual([]);
});

test("差の領域を CSS px に直してページで探し、候補と特定できなかった領域に分ける", () => {
  const dir = makeTempDir("noise-masks-");
  // DPR 2 の升目は 16 画素。2 つの塊は升目 2 つ以上離れている
  const { result, searched } = suggest({
    dpr: 2,
    baseline: writeImage(dir, "a.png", { width: 96, height: 32 }),
    pass2: writeImage(dir, "b.png", {
      width: 96,
      height: 32,
      changed: [
        [3, 5],
        [4, 6],
        [80, 20],
      ],
    }),
    fullPage: true,
  });
  expect(searched).toEqual([
    [
      { x: 1, y: 2, width: 2, height: 2 },
      { x: 40, y: 10, width: 1, height: 1 },
    ],
  ]);
  expect(result.candidates).toEqual([
    {
      selector: "#a",
      basis: "covering",
      element_rect: { x: 1, y: 2, width: 2, height: 2 },
      regions: [{ x: 1, y: 2, width: 2, height: 2 }],
    },
  ]);
  expect(result.unlocated).toEqual([
    {
      region: { x: 40, y: 10, width: 1, height: 1 },
      reason: "no element other than html / body covers the region",
    },
  ]);
});

test("領域が上限を超えたら、超えた分は件数だけを残す", () => {
  const dir = makeTempDir("noise-masks-");
  // 升目 8 画素。16 画素おきに置いた画素は、どれも隣り合わない別の領域になる
  const changed: [number, number][] = [];
  for (let i = 0; i < MAX_REGIONS + 3; i += 1)
    changed.push([(i % 20) * 16, Math.floor(i / 20) * 16]);
  const { result, searched } = suggest({
    dpr: 1,
    baseline: writeImage(dir, "a.png", { width: 320, height: 64 }),
    pass2: writeImage(dir, "b.png", { width: 320, height: 64, changed }),
    fullPage: false,
  });
  expect(searched[0]).toHaveLength(MAX_REGIONS);
  expect(result.omitted_regions).toBe(3);
});

test("寸法が違えば、比べずに size-mismatch を返す", () => {
  const dir = makeTempDir("noise-masks-");
  const { result, searched } = suggest({
    dpr: 1,
    baseline: writeImage(dir, "a.png", { width: 32, height: 32 }),
    pass2: writeImage(dir, "b.png", { width: 32, height: 40 }),
    fullPage: true,
  });
  expect(result).toEqual({
    version: "1",
    status: "size-mismatch",
    candidates: [],
    unlocated: [],
    omitted_regions: 0,
  });
  expect(searched).toEqual([]);
});
