// 拡張子ポリシーの検査（check-js-extensions.ts）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸           | 値                                                                     |
// | ------------ | ---------------------------------------------------------------------- |
// | 置き場所     | skills/<name>/scripts・assets・その他 / scripts/ / private skill / 公開スキルのコピー / 対象外 |
// | 拡張子       | .mjs / .ts / .js / .cjs / .mts / .cts / .tsx / .jsx / .d.ts（大文字を含む） |
// | git での状態 | 追跡 / 無視されていない未追跡 / .gitignore で無視                      |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { violationOf } from "./check-js-extensions.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-js-extensions.ts");
const PRIVATE = ["private-one"];

test.each([
  ["skills/demo/scripts/a.mjs"],
  ["skills/demo/assets/spec.template.ts"],
  ["skills/demo/assets/nested/types.d.ts"],
  ["skills/demo/references/notes.md"],
  ["scripts/gates/a.ts"],
  ["scripts/lib/types.d.ts"],
  [".agents/skills/private-one/scripts/a.ts"],
  [".agents/skills/demo/scripts/a.mjs"],
  [".agents/skills/private-one/SKILL.md"],
  [".agents/skills/private-one/references/notes.md"],
  ["evals/demo/fixtures/a.js"],
  ["vitest.config.ts"],
])("規約どおりの %s は違反にしない", (path) => {
  expect(violationOf(path, PRIVATE)).toBeNull();
});

test.each([
  ["skills/demo/scripts/a.js", ".js"],
  ["skills/demo/a.cjs", ".cjs"],
  ["skills/demo/references/a.mts", ".mts"],
  ["skills/demo/assets/a.cts", ".cts"],
  ["skills/demo/assets/a.tsx", ".tsx"],
  ["skills/demo/assets/a.jsx", ".jsx"],
  ["skills/demo/scripts/a.JS", ".js"],
])("配布スキルの %s を違反にする", (path, ext) => {
  expect(violationOf(path, PRIVATE)).toContain(`skills/ では ${ext} を使わない`);
});

test.each([["skills/demo/scripts/a.ts"], ["skills/demo/references/a.ts"], ["skills/demo/a.ts"]])(
  "配布スキルの assets/ の外の .ts（%s）を違反にする",
  (path) => {
    expect(violationOf(path, PRIVATE)).toContain("assets/ の雛形の外で .ts を使わない");
  },
);

test.each([
  ["scripts/lib/a.js", ".js"],
  ["scripts/a.mjs", ".mjs"],
  ["scripts/gates/a.cjs", ".cjs"],
  ["scripts/gates/a.mts", ".mts"],
  ["scripts/gates/a.cts", ".cts"],
  ["scripts/gates/a.tsx", ".tsx"],
  ["scripts/gates/a.jsx", ".jsx"],
  ["scripts/gates/a.MJS", ".mjs"],
])("scripts/ の %s を違反にする", (path, ext) => {
  expect(violationOf(path, PRIVATE)).toContain(`scripts/ では ${ext} を使わない`);
});

test.each([
  [".agents/skills/private-one/scripts/a.js", ".js"],
  [".agents/skills/private-one/scripts/a.mjs", ".mjs"],
  [".agents/skills/private-one/a.mts", ".mts"],
])("private skill の %s を違反にする", (path, ext) => {
  expect(violationOf(path, PRIVATE)).toContain(`private skill では ${ext} を使わない`);
});

/** 一時的な git リポジトリを作る。`ignored` のファイルは .gitignore に載せ、`tracked` だけを git add する。 */
function makeRepo(files: Record<string, "tracked" | "untracked" | "ignored">): string {
  const root = makeTempDir("js-extensions-");
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q");
  const ignored = Object.entries(files)
    .filter(([, state]) => state === "ignored")
    .map(([path]) => path);
  writeFileSync(join(root, ".gitignore"), ignored.map((p) => `${p}\n`).join(""));
  for (const path of Object.keys(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "export {};\n");
  }
  const tracked = Object.entries(files)
    .filter(([, state]) => state === "tracked")
    .map(([path]) => path);
  if (tracked.length) git("add", "--", ...tracked);
  return root;
}

function runCli(cwd: string) {
  const r = spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("CLI: 追跡しているファイルと、無視されていない未追跡のファイルの違反を検出する", () => {
  const root = makeRepo({
    "scripts/tracked.js": "tracked",
    "scripts/untracked.mts": "untracked",
    "scripts/ok.ts": "tracked",
  });
  const r = runCli(root);
  expect(r.status).toBe(1);
  expect(r.out).toContain("scripts/tracked.js: scripts/ では .js を使わない");
  expect(r.out).toContain("scripts/untracked.mts: scripts/ では .mts を使わない");
  expect(r.out).not.toContain("scripts/ok.ts");
});

test("CLI: .gitignore で無視したファイルは数えない", () => {
  const root = makeRepo({
    "scripts/ok.ts": "tracked",
    "scripts/mutation-proof-fixture-x/fault.cjs": "ignored",
  });
  const r = runCli(root);
  expect(r.out).toContain("js-extensions: OK（1 件）");
  expect(r.status).toBe(0);
});

test("CLI: private skill は skills/<name>/ が無いことで決め、公開スキルのコピーは対象にしない", () => {
  const root = makeRepo({
    "skills/demo/scripts/a.mjs": "tracked",
    ".agents/skills/demo/scripts/a.mjs": "tracked",
    ".agents/skills/private-one/scripts/a.mjs": "tracked",
  });
  const r = runCli(root);
  expect(r.status).toBe(1);
  expect(r.out).toContain(
    ".agents/skills/private-one/scripts/a.mjs: private skill では .mjs を使わない",
  );
  expect(r.out).not.toContain(".agents/skills/demo/");
});

test("CLI: git のリポジトリでなければ判定できないとして exit 2", () => {
  const root = makeTempDir("js-extensions-nogit-");
  const r = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) },
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("git のリポジトリのルートを特定できない");
});

test("CLI: リポジトリのサブディレクトリから起動しても、ルートから同じ範囲を走査する", () => {
  const root = makeRepo({
    "scripts/bad.js": "tracked",
    "scripts/skills/demo/a.test.ts": "tracked",
    "docs/readme.md": "tracked",
  });
  for (const sub of ["docs", "scripts"]) {
    const r = runCli(join(root, sub));
    expect(r.status).toBe(1);
    expect(r.out).toContain("scripts/bad.js: scripts/ では .js を使わない");
    expect(r.out).not.toContain("a.test.ts");
  }
});

test("CLI: stage した違反は、作業ツリーから消しても検出する", () => {
  const root = makeRepo({ "scripts/ok.ts": "tracked", "scripts/staged.js": "tracked" });
  rmSync(join(root, "scripts/staged.js"));
  const r = runCli(root);
  expect(r.status).toBe(1);
  expect(r.out).toContain("scripts/staged.js: scripts/ では .js を使わない");
});

test("CLI: 走査したファイルが 0 件なら、判定できないとして exit 2", () => {
  const root = makeRepo({ "docs/readme.md": "tracked" });
  const r = runCli(root);
  expect(r.status).toBe(2);
  expect(r.out).toContain("走査したファイルが 0 件");
});

test("CLI: stage した private skill の違反は、作業ツリーからスキルごと消しても検出する", () => {
  const root = makeRepo({
    "scripts/ok.ts": "tracked",
    ".agents/skills/private-one/scripts/a.js": "tracked",
  });
  rmSync(join(root, ".agents"), { recursive: true });
  const r = runCli(root);
  expect(r.status).toBe(1);
  expect(r.out).toContain(
    ".agents/skills/private-one/scripts/a.js: private skill では .js を使わない",
  );
});

test("CLI: 中身の無い skills/<name>/ のディレクトリがあっても、private skill として検査する", () => {
  const root = makeRepo({
    "scripts/ok.ts": "tracked",
    ".agents/skills/private-one/scripts/a.js": "tracked",
  });
  mkdirSync(join(root, "skills/private-one"), { recursive: true });
  const r = runCli(root);
  expect(r.status).toBe(1);
  expect(r.out).toContain(
    ".agents/skills/private-one/scripts/a.js: private skill では .js を使わない",
  );
});

test.each([
  ["skills/demo/scripts/a.MJS", ".mjs"],
  ["skills/demo/assets/spec.template.TS", ".ts"],
  ["skills/demo/assets/types.d.TS", ".ts"],
])("配布スキルの小文字でない拡張子（%s）を違反にする", (path, ext) => {
  expect(violationOf(path, PRIVATE)).toContain(`skills/ では拡張子を小文字の ${ext} にする`);
});

test.each([
  // 置けない場所の大文字の拡張子は、小文字に直すよう案内せず、置き場所の違反として返す。
  ["skills/demo/scripts/x.TS", "skills/ では assets/ の雛形の外で .ts を使わない"],
  [".agents/skills/private-one/lib/x.TS", "private skill では scripts/ の外で .ts を使わない"],
])("置けない場所の大文字の .ts（%s）は、置き場所の違反として返す", (path, message) => {
  expect(violationOf(path, PRIVATE)).toContain(message);
});

test.each([
  ["scripts/gates/a.TS", "scripts/"],
  ["scripts/lib/types.d.Ts", "scripts/"],
  [".agents/skills/private-one/scripts/a.TS", "private skill"],
])("小文字でない .ts（%s）を違反にする", (path, where) => {
  expect(violationOf(path, PRIVATE)).toContain(`${where} では拡張子を小文字の .ts にする`);
});

test.each([
  [".agents/skills/private-one/tools/x.ts"],
  [".agents/skills/private-one/x.ts"],
  // scripts/ の外の宣言も型の検査に入らない。
  [".agents/skills/private-one/types.d.ts"],
  // include は大文字と小文字を区別するので、`Scripts/` は scripts/ として扱わない。
  [".agents/skills/private-one/Scripts/x.ts"],
])("private skill の scripts/ の外の .ts（%s）を違反にする", (path) => {
  expect(violationOf(path, PRIVATE)).toContain("private skill では scripts/ の外で .ts を使わない");
});
