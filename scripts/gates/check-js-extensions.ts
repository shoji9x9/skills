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
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sourceSkillNames } from "../lib/source-scope.ts";

type Rule = { root: string; banned: string[]; expected: string; reason: string };

const NON_DISTRIBUTED_BANNED = [".js", ".mjs", ".cjs"];

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

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
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
