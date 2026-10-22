// table-upsert.test.ts のヘルパー（表の雛形・一時ディレクトリで CLI を実行する・upsert の引数）。

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const script = join(repoRoot, "skills/parity-suite/scripts/table-upsert.mjs");

// 表の形。conformance は照合していない表では無い（テストも消した表を渡す）ので省略可能にする。
export type Operation = { id: string; trigger: string };
export type CallSite = {
  file: string;
  line: number;
  column: number;
  pattern: string;
  reaction: string | null;
};
export type Table = {
  slug: string;
  operations: Operation[];
  feedback_calls: { call_sites: CallSite[] };
  components: { id: string; instances: { id: string; page: string }[] }[];
  conformance?: { tool: string; ok: boolean };
};

export const baseTable = (): Table => ({
  slug: "share",
  operations: [
    { id: "copy", trigger: "clickButton(コピー)" },
    { id: "search", trigger: "clickButton(検索)" },
  ],
  feedback_calls: {
    call_sites: [{ file: "src/share.js", line: 2, column: 3, pattern: "toast", reaction: null }],
  },
  components: [
    { id: "grid", instances: [{ id: "list", page: "一覧" }] },
    { id: "menu", instances: [] },
  ],
  conformance: { tool: "reaction-check", ok: true },
});

/**
 * 一時ディレクトリに表を置いて CLI を実行する。
 * @param {object | string} table - 文字列ならそのまま書く（不正な JSON 用）
 * @param {string[]} args
 * @param {{ fragment?: object | string, input?: string }} [opts]
 */
export function run(
  table: object | string,
  args: string[],
  opts: { fragment?: unknown; input?: string } = {},
) {
  const dir = makeTempDir("table-upsert-");
  writeFileSync(
    join(dir, "t.json"),
    typeof table === "string" ? table : JSON.stringify(table, null, 2),
  );
  if (opts.fragment !== undefined) {
    writeFileSync(
      join(dir, "f.json"),
      typeof opts.fragment === "string" ? opts.fragment : JSON.stringify(opts.fragment),
    );
  }
  const r = spawnSync(process.execPath, [script, ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
    input: opts.input,
    stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  const after = readFileSync(join(dir, "t.json"), "utf8");
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, after };
}

export const upsert = (array: string, extra: string[] = []) => [
  "upsert",
  "--file",
  "t.json",
  "--array",
  array,
  "--from",
  "f.json",
  ...extra,
];
