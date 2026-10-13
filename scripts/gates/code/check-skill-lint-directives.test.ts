// 配布スキルの抑止コメントと、isArray を持つファイルの検査（check-skill-lint-directives.ts）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸                   | 値                                                                              |
// | -------------------- | ------------------------------------------------------------------------------- |
// | 指示の種類           | oxlint-disable（-next-line・-line）/ eslint-disable / biome-ignore / @ts-expect-error / deno-lint-ignore / 対象外（textlint・shellcheck・markdownlint） |
// | コメントの形         | `//` / `/*` / JSDoc の行頭の `*` / コードの後ろの `//`                          |
// | コメント以外の出現   | 文章の途中の名前 / 文字列 / 正規表現                                             |
// | 拡張子               | .mjs / .ts / .md（対象外）                                                       |
// | isArray の印         | 1 組 / 無い / begin の重複 / 逆順                                                |
// | Array.isArray の位置 | 印の間 / 印の外のコード / 印の外のコメント / 一覧のファイルが無い                  |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findDirectives,
  findOutsideRegion,
  findViolations,
} from "./check-skill-lint-directives.ts";
import { IS_ARRAY_HOLDERS } from "../../lib/is-array-holders.ts";
import { makeTempDir } from "../../lib/test-tmpdir.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-skill-lint-directives.ts");

test.each([
  ["// oxlint-disable-next-line no-restricted-properties -- 理由", "oxlint-disable"],
  ["  return x; // oxlint-disable-line no-console", "oxlint-disable"],
  ["/* eslint-disable no-console */", "eslint-disable"],
  ["/** eslint-disable-next-line */", "eslint-disable"],
  [" * eslint-disable no-console", "eslint-disable"],
  ["// biome-ignore lint/style: 理由", "biome-ignore"],
  ["  // @ts-expect-error 型が合わない", "@ts-expect-error"],
  ["// deno-lint-ignore no-explicit-any", "deno-lint-ignore"],
])("抑止の指示 %s を違反にする", (line, directive) => {
  expect(findDirectives(`const a = 1;\n${line}\n`)).toEqual([`2: ${directive}`]);
});

test.each([
  ["// textlint-disable"],
  ["# shellcheck disable=SC2016"],
  ["<!-- markdownlint-disable MD013 -->"],
  ["// ツールへの指示（eslint-disable・@ts-expect-error など）は除かない"],
  ['const s = "eslint-disable";'],
  ["const re = /^(eslint|oxlint-)/;"],
])("指示として読まれない %s は違反にしない", (line) => {
  expect(findDirectives(`${line}\n`)).toEqual([]);
});

const HOLDER = [
  "// 説明に `Array.isArray` と書く",
  "/** `Array.isArray` より狭く絞る */",
  "// is-array-js:begin",
  "/**",
  " * `Array.isArray` の代わりに使う。",
  " */",
  "function isArray(value) {",
  "  return Array.isArray(value);",
  "}",
  "// is-array-js:end",
  "export const ok = isArray([]);",
];

test("印の間の Array.isArray と、印の外のコメントは違反にしない", () => {
  expect(findOutsideRegion(HOLDER.join("\n"))).toEqual([]);
});

test("印の外のコードの Array.isArray を違反にする", () => {
  const text = [...HOLDER, "export const ng = Array.isArray([]);"].join("\n");
  expect(findOutsideRegion(text)).toEqual([
    "12: 型ガード isArray の外で Array.isArray を使っている",
  ]);
});

test("文字列の中の // の後ろのコードの Array.isArray を違反にする", () => {
  const text = [...HOLDER, 'export const ng = ["https://x", Array.isArray([])];'].join("\n");
  expect(findOutsideRegion(text)).toEqual([
    "12: 型ガード isArray の外で Array.isArray を使っている",
  ]);
});

test.each([
  ["印が無い", HOLDER.filter((l) => !l.includes("is-array-js:"))],
  ["begin が重複する", ["// is-array:begin", ...HOLDER]],
  ["逆順", ["// is-array-js:end", "// is-array-js:begin"]],
])("印が 1 組だけ無い（%s）ものを違反にする", (_label, lines) => {
  expect(findOutsideRegion(lines.join("\n"))).toEqual([
    "印 `// is-array*:begin` と `// is-array*:end` が 1 組だけ、この順で無い",
  ]);
});

function makeRepo(files: Record<string, string>): string {
  const root = makeTempDir("skill-lint-directives-");
  spawnSync("git", ["init", "-q"], { cwd: root });
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

test("配布スキルの .mjs と .ts の指示を検出し、.md と skills/ の外は見ない", () => {
  const root = makeRepo({
    "skills/demo/scripts/a.mjs": "// oxlint-disable-next-line no-console\n",
    "skills/demo/assets/b.template.ts": "// @ts-expect-error x\n",
    "skills/demo/references/c.md": "// eslint-disable\n",
    "scripts/d.ts": "// oxlint-disable-next-line no-console\n",
  });
  try {
    const files = [
      "skills/demo/scripts/a.mjs",
      "skills/demo/assets/b.template.ts",
      "skills/demo/references/c.md",
    ];
    expect(findViolations(root, files, [])).toEqual([
      "skills/demo/scripts/a.mjs:1: oxlint-disable（このリポジトリの設定を前提にした抑止。設定の overrides で外す）",
      "skills/demo/assets/b.template.ts:1: @ts-expect-error（このリポジトリの設定を前提にした抑止。設定の overrides で外す）",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("一覧のファイルが無ければ違反にする", () => {
  const root = makeRepo({ "skills/demo/a.mjs": "export {};\n" });
  try {
    expect(findViolations(root, [], ["skills/demo/scripts/lib/is-array.mjs"])).toEqual([
      "skills/demo/scripts/lib/is-array.mjs: scripts/lib/is-array-holders.ts に挙げたファイルが無い",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// CLI は実物の IS_ARRAY_HOLDERS を読むので、一時リポジトリにも印の付いたファイルを置く。
// 置かないと「一覧のファイルが無い」でも exit 1 になり、終了コードで指示の検出を確かめられない。
const HOLDER_FILES = Object.fromEntries(IS_ARRAY_HOLDERS.map((p) => [p, `${HOLDER.join("\n")}\n`]));

test("CLI: 違反が無ければ exit 0 にする", () => {
  const root = makeRepo({ ...HOLDER_FILES, "skills/demo/scripts/a.mjs": "export {};\n" });
  try {
    const res = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: 未追跡のファイルの指示を検出して exit 1 にする", () => {
  const root = makeRepo({
    ...HOLDER_FILES,
    "skills/demo/scripts/a.mjs": "// eslint-disable-next-line\n",
  });
  try {
    const res = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("skills/demo/scripts/a.mjs:1: eslint-disable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: skills/ の JavaScript・TypeScript が 0 件なら exit 2 にする", () => {
  const root = makeRepo({ "skills/demo/SKILL.md": "# demo\n" });
  try {
    const res = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("0 件");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("実リポジトリ: 違反が無い", () => {
  const res = spawnSync(process.execPath, [script], { encoding: "utf8" });
  expect(res.stderr).toBe("");
  expect(res.status).toBe(0);
});
