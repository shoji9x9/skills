#!/usr/bin/env node
// SKILL.md の frontmatter を決定論的に検査する（lefthook pre-commit + CI）。
// gh skill publish の dry-run や reinstall でしか気付けなかった不備を、コミット時に止める:
//   (a) frontmatter が YAML としてパース可能であること（未クオート description 内の「: 」＝
//       コロン＋スペースがマッピング区切りと解釈され YAML が壊れる典型を検出）。
//   (b) description の UTF-8 バイト長が 1024 以下であること（日本語は 1 文字 3 バイトで実質約
//       340 文字。gh の上限は「文字数」ではなく UTF-8 バイト数で判定される）。
//   (c) name が必須で、形式は小文字英数字とハイフン・64 文字以内であること。
//
// 中核の判定は純粋関数 `checkFrontmatter(path, content)` に切り出してある
// （scripts/check-skill-frontmatter.test.js でテスト）。
//
// 使い方: node scripts/check-skill-frontmatter.js [files...]
//   引数なし: skills/*/SKILL.md を全件走査。
//   引数あり: 指定ファイルのうち SKILL.md のみを検査（lefthook が渡す staged_files 用）。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { splitFrontmatter } from "./lib/frontmatter.js";

const DESCRIPTION_MAX_BYTES = 1024;
const NAME_MAX_LENGTH = 64;
const NAME_RE = /^[a-z0-9-]+$/;

// 先頭の `---` ... `---` に挟まれた frontmatter 本文を取り出す。無ければ null。
// 実体は共通ヘルパー splitFrontmatter（BOM/CRLF 対応）。互換のためエクスポートを残す
// （check-skill-frontmatter.test.js が import している）。
export function extractFrontmatter(content) {
  const r = splitFrontmatter(content);
  return r ? r.fm : null;
}

// 中核の判定。違反理由（文字列）の配列を返す純粋関数。空配列なら pass。
export function checkFrontmatter(path, content) {
  const violations = [];

  const fm = extractFrontmatter(content);
  if (fm === null) {
    violations.push("frontmatter（先頭の --- で挟まれた YAML）が見つからない");
    return violations;
  }

  // (a) YAML パース可能性。
  let data;
  try {
    data = yaml.load(fm);
  } catch (e) {
    const reason = e && e.message ? e.message.split("\n")[0] : String(e);
    violations.push(`frontmatter が YAML としてパースできない: ${reason}`);
    return violations; // パース不能なら以降のフィールド検査は無意味。
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    violations.push("frontmatter が YAML マッピングになっていない");
    return violations;
  }

  // (b) description の UTF-8 バイト長。
  if (!("description" in data)) {
    violations.push("description が無い");
  } else if (typeof data.description !== "string") {
    violations.push("description が文字列でない");
  } else {
    const bytes = Buffer.byteLength(data.description, "utf8");
    if (bytes > DESCRIPTION_MAX_BYTES) {
      violations.push(
        `description の UTF-8 バイト長が ${bytes} で上限 ${DESCRIPTION_MAX_BYTES} を超過（${bytes - DESCRIPTION_MAX_BYTES} バイト超過）`,
      );
    }
  }

  // (c) name の必須・形式。
  if (!("name" in data)) {
    violations.push("name が無い");
  } else if (typeof data.name !== "string") {
    violations.push("name が文字列でない");
  } else {
    if (!NAME_RE.test(data.name)) {
      violations.push(`name「${data.name}」は小文字英数字とハイフンのみ使える`);
    }
    if (data.name.length > NAME_MAX_LENGTH) {
      violations.push(
        `name「${data.name}」が ${data.name.length} 文字で上限 ${NAME_MAX_LENGTH} 文字を超過`,
      );
    }
  }

  return violations;
}

// 走査対象の SKILL.md を列挙する（引数なし走査用）。
//   - skills/*/SKILL.md: 配布スキルのソース。
//   - .agents/skills/*/SKILL.md（`.private-skill` マーカー付きのみ）: private skill。
//     private skill は skills/ にソースを持たず、publish / reinstall / skills-sync の
//     どの経路でも frontmatter 検査されないため、ここで明示的に対象へ加える。
function listSkillFiles() {
  const out = [];

  const srcRoot = "skills";
  if (existsSync(srcRoot)) {
    for (const e of readdirSync(srcRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(srcRoot, e.name, "SKILL.md");
      if (existsSync(p)) out.push(p);
    }
  }

  const installedRoot = ".agents/skills";
  if (existsSync(installedRoot)) {
    for (const e of readdirSync(installedRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      // private skill（.private-skill マーカーあり）だけを追加する。
      if (!existsSync(join(installedRoot, e.name, ".private-skill"))) continue;
      const p = join(installedRoot, e.name, "SKILL.md");
      if (existsSync(p)) out.push(p);
    }
  }

  return out;
}

function main() {
  const args = process.argv.slice(2);
  // 引数ありは staged_files 想定。SKILL.md 以外は無視する。
  const targets = args.length ? args.filter((p) => p.endsWith("SKILL.md")) : listSkillFiles();

  const failures = [];
  for (const path of targets) {
    let content;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const v of checkFrontmatter(path, content)) failures.push({ path, msg: v });
  }

  if (failures.length) {
    failures.sort((a, b) => a.path.localeCompare(b.path) || a.msg.localeCompare(b.msg));
    console.error("skill-frontmatter: frontmatter 検査に失敗:");
    for (const f of failures) console.error(`  - ${f.path}: ${f.msg}`);
    console.error(
      "\nFix: frontmatter を YAML として妥当にし、description は UTF-8 で 1024 バイト以内、name は小文字英数字とハイフン 64 文字以内にする。",
    );
    process.exit(1);
  }
  console.log("skill-frontmatter: OK");
}

// CLI として実行されたときだけ走らせる（テストから import しても main は動かない）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
