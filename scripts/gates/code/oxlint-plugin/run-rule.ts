// テストから、JS プラグインのルールを 1 つだけ有効にした oxlint を起動する（oxlint-plugin/ のルールのテストが使う）。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { PLUGIN_PATH, runOxlint } from "./run-oxlint.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

/**
 * dir の下に files（dir からのパス → 内容）を置き、rule だけを有効にした oxlint を 1 回実行する。
 * 診断の行を、files のパスごとに並べて返す（診断の無いファイルは空の配列）。
 */
export function runRule({
  dir,
  rule,
  option,
  files,
}: {
  dir: string;
  rule: string;
  option?: unknown;
  files: Record<string, string>;
}): Record<string, number[]> {
  const config = join(dir, "oxlintrc.json");
  const setting = option === undefined ? "error" : ["error", option];
  const oxlintrc = {
    categories: { correctness: "off" },
    jsPlugins: [PLUGIN_PATH],
    rules: { [rule]: setting },
  };
  writeFileSync(config, JSON.stringify(oxlintrc));
  const lines: Record<string, number[]> = {};
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
    lines[rel] = [];
  }
  for (const d of runOxlint(["-c", config, ...Object.keys(files).map((f) => join(dir, f))], {
    timeout: CHILD_TIMEOUT_MS,
  })) {
    const rel = relative(dir, d.file);
    const found = lines[rel];
    if (d.rule !== rule || found === undefined)
      throw new Error(`想定しない診断: ${rel} [${d.rule}]`);
    found.push(d.line);
  }
  for (const found of Object.values(lines)) found.sort((a, b) => a - b);
  return lines;
}
