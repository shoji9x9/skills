// noise-masks-suggest.test.ts が子プロセスで実行するランナー。
// pngjs はこのリポジトリに入れないので、親が `--import fake-pngjs-hooks.ts` で起動し、"pngjs" を偽物に向ける。
// 引数の JSON（dpr・baseline・pass2・fullPage）で suggestNoiseMasks を呼び、結果と、ページで探すよう渡された領域を stdout に書く。
// ページは、devicePixelRatio と、渡された領域を偶数番目は "#a" に当て、奇数番目は特定できなかったことにする結果だけを返す偽物にする。
import { suggestNoiseMasks } from "../../../../skills/parity-suite/scripts/noise-masks.mjs";

type Rect = { x: number; y: number; width: number; height: number };
type Input = { dpr: number; baseline: string; pass2: string; fullPage: boolean };

function isInput(value: unknown): value is Input {
  return (
    typeof value === "object" &&
    value !== null &&
    "dpr" in value &&
    "baseline" in value &&
    "pass2" in value
  );
}

const input: unknown = JSON.parse(process.argv[2] ?? "null");
if (!isInput(input)) throw new Error("usage: noise-masks-suggest-runner.ts '<json>'");
const searched: Rect[][] = [];
const page = {
  evaluate: async (_fn: unknown, arg?: { regions: Rect[] }) => {
    if (arg === undefined) return input.dpr;
    searched.push(arg.regions);
    return arg.regions.map((region, i) =>
      i % 2 === 0
        ? { region, selector: "#a", basis: "covering", element_rect: region }
        : { region, reason: "no element other than html / body covers the region" },
    );
  },
};
const result = await suggestNoiseMasks(page, input);
process.stdout.write(`${JSON.stringify({ result, searched })}\n`);
