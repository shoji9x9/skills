#!/usr/bin/env node
// JavaScript・TypeScript の拡張子ポリシーを決定論的に検査する（lefthook pre-commit + CI）。
// docs/tooling.md「JavaScript の拡張子」の住み分けに対応する自動ガード:
//   - 配布物は `.mjs`: 配布スキルのスクリプト（`skills/**`）は ESM を拡張子で保証する。
//     よって `skills/**` 配下の `.js` と `.cjs` は違反。
//     `skills/<name>/scripts/` の `.ts` も違反（利用者の Node で動くので、型を消して実行できる版を利用者に求めない）。
//     `skills/<name>/assets/` の `.ts` は利用者のプロジェクトへ置く雛形なので対象外。
//   - 非配布物は `.ts`: リポジトリ内ツール（`scripts/**`）は TypeScript で書き、`pnpm run typecheck` で型を検査する。
//     よって `scripts/**` 配下の `.js`・`.mjs`・`.cjs` は違反。
// 配布しない private skill も非配布なので、`scripts/**` と同じく `.ts`。
// private skill かは `skills/<name>/` が無いことで決める（scripts/lib/source-scope.ts と同じ判定）。
// `.private-skill` の印で決めると、印を付け忘れた private skill がこの検査から外れる。
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sourceSkillNames } from "../lib/source-scope.ts";

type Rule = { root: string; banned: string[]; expected: string; reason: string };

// `.mts`・`.cts`・`.tsx` も禁じる。`.mts`・`.cts` は Node が実行できるのに `tsconfig.repo.json` の include（`*.ts`）に入らず、
// `.tsx` は Node が型を消して実行できない。
const NON_DISTRIBUTED_BANNED = [".js", ".mjs", ".cjs", ".mts", ".cts", ".tsx"];

// (ルート, 違反拡張子, あるべき拡張子) の検査対象。
const RULES: Rule[] = [
  { root: "skills", banned: [".js", ".cjs"], expected: ".mjs", reason: "配布物" },
  ...distributedScriptRoots().map((root) => ({
    root,
    banned: [".ts", ".mts", ".cts"],
    expected: ".mjs",
    reason: "配布スキルのスクリプトは利用者の Node で動く",
  })),
  { root: "scripts", banned: NON_DISTRIBUTED_BANNED, expected: ".ts", reason: "非配布物" },
  ...sourceSkillNames(".").map((name) => ({
    root: join(".agents", "skills", name),
    banned: NON_DISTRIBUTED_BANNED,
    expected: ".ts",
    reason: "private skill は非配布物",
  })),
];

/** 配布スキルの `skills/<name>/scripts/`。 */
function distributedScriptRoots(): string[] {
  if (!existsSync("skills")) return [];
  return readdirSync("skills", { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join("skills", e.name, "scripts"));
}

/**
 * `dir` の下の、追跡しているファイルと、無視されていない未追跡のファイル。
 * `.gitignore` のものを除くのは、テストが `scripts/` の下に一時的に作る fixture（`.cjs` など）を数えないため。
 * 未追跡のファイルを含めるのは、`git add` の前に置いた違反も検出するため。
 */
function listFiles(dir: string): string[] {
  const res = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", dir],
    {
      encoding: "utf8",
    },
  );
  if (res.status !== 0) {
    console.error(`js-extensions: git ls-files に失敗した（exit ${res.status}）: ${res.stderr}`);
    process.exit(2);
  }
  return res.stdout.split("\0").filter((p) => p !== "" && existsSync(p));
}

const violations: string[] = [];
for (const { root, banned, expected, reason } of RULES) {
  if (!existsSync(root)) continue;
  for (const file of listFiles(root)) {
    const ext = banned.find((b) => file.endsWith(b));
    if (ext) {
      violations.push(`${file}: ${root}/ では ${ext} を使わない（${reason} → ${expected} にする）`);
    }
  }
}

if (violations.length) {
  console.error("js-extensions: 拡張子ポリシー違反:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "Fix: 配布物（skills/**）は .mjs、非配布物（scripts/** と private skill）は .ts にリネームする。",
  );
  process.exit(1);
}
console.log("js-extensions: OK");
