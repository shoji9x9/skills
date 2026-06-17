#!/usr/bin/env node
// JavaScript の拡張子ポリシーを決定論的に検査する（lefthook pre-commit + CI）。
// AGENTS.md「リント／フォーマット」の住み分けに対応する自動ガード:
//   - 配布物は `.mjs`: 配布スキルのスクリプト（`skills/**`）は ESM を拡張子で保証する。
//     よって `skills/**` 配下の `.js` は違反。
//   - 非配布物は `.js`: リポジトリ内ツール（`scripts/**`）は `package.json` の
//     `"type": "module"` 下で ESM になるため `.mjs` は不要。よって `scripts/**` 配下の `.mjs` は違反。
// 配布しない private skill（`.agents/skills/<name>/`）は非配布なので `.js`（本ガードの対象外）。
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// (ルート, 違反拡張子, あるべき拡張子) の検査対象。
const RULES = [
  { root: "skills", banned: ".js", expected: ".mjs", reason: "配布物は .mjs" },
  { root: "scripts", banned: ".mjs", expected: ".js", reason: "非配布物は .js" },
];

function listFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

const violations = [];
for (const { root, banned, expected, reason } of RULES) {
  if (!existsSync(root)) continue;
  for (const file of listFiles(root)) {
    if (file.endsWith(banned)) {
      violations.push(
        `${file}: ${root}/ では ${banned} を使わない（${reason} → ${expected} にする）`,
      );
    }
  }
}

if (violations.length) {
  console.error("js-extensions: 拡張子ポリシー違反:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("Fix: 配布物（skills/**）は .mjs、非配布物（scripts/**）は .js にリネームする。");
  process.exit(1);
}
console.log("js-extensions: OK");
