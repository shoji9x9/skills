#!/usr/bin/env node
// SKILL.md の frontmatter を決定論的に検査する（lefthook pre-commit + CI）。
// gh skill publish の dry-run や reinstall でしか気付けなかった不備を、コミット時に止める。チェックするのは次の点である。
//   (a) frontmatter が YAML としてパースできること。よくある誤りは、クオートしていない description の中の
//       「: 」（コロン＋スペース）がマッピングの区切りと解釈され、YAML として不正になることである。
//   (b) description の UTF-8 バイト長が 1024 以下であること（日本語は 1 文字 3 バイトで実質約
//       340 文字。gh の上限は「文字数」ではなく UTF-8 バイト数で判定される）。
//   (c) name が必須で、形式は小文字英数字とハイフン・64 文字以内であること。
//
// 中核の判定は純粋関数 `checkFrontmatter(path, content)` に切り出してある
// （scripts/gates/packaging/check-skill-frontmatter.test.ts でテスト）。
//
// 使い方: node scripts/gates/packaging/check-skill-frontmatter.ts [files...]
//   引数なし: skills/*/SKILL.md を全件走査。
//   引数あり: 指定ファイルのうち SKILL.md のみを検査（lefthook が渡す staged_files 用）。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadYaml } from "../../lib/text/yaml-as.ts";
import { splitFrontmatter } from "../../lib/text/frontmatter.ts";
import { isPlainObject } from "../../lib/guards.ts";
import { isCliEntry } from "../../lib/cli/entry.ts";

const DESCRIPTION_MAX_BYTES = 1024;
const NAME_MAX_LENGTH = 64;
const NAME_RE = /^[a-z0-9-]+$/;

// 先頭の `---` ... `---` に挟まれた frontmatter 本文を取り出す。無ければ null。
// 実体は共通ヘルパー splitFrontmatter（BOM/CRLF 対応）。
function extractFrontmatter(content: string) {
  const r = splitFrontmatter(content);
  return r ? r.fm : null;
}

// 中核の判定。違反理由（文字列）の配列を返す純粋関数。空配列なら pass。
export function checkFrontmatter(path: string, content: string) {
  const violations: string[] = [];

  const fm = extractFrontmatter(content);
  if (fm === null) {
    violations.push("frontmatter（先頭の --- で挟まれた YAML）が見つからない");
    return violations;
  }

  // (a) YAML パース可能性。
  let data;
  try {
    data = loadYaml(fm);
  } catch (e) {
    const reason = e instanceof Error && e.message ? e.message.split("\n")[0] : String(e);
    violations.push(`frontmatter が YAML としてパースできない: ${reason}`);
    return violations; // パース不能なら以降のフィールド検査は無意味。
  }
  // `!!set` は Set に（js-yaml 5 から）、タイムスタンプは Date に（js-yaml 4 から）なる。どちらも object なので、マッピングかで判定する。
  if (!isPlainObject(data)) {
    violations.push("frontmatter が YAML マッピングになっていない");
    return violations;
  }

  violations.push(...descriptionViolations(data), ...nameViolations(data));
  return violations;
}

/** (b) description の有無・型と、UTF-8 バイト長を確かめる。 */
function descriptionViolations(data: Record<string, unknown>): string[] {
  if (!("description" in data)) return ["description が無い"];
  if (typeof data.description !== "string") return ["description が文字列でない"];
  const bytes = Buffer.byteLength(data.description, "utf8");
  if (bytes > DESCRIPTION_MAX_BYTES) {
    return [
      `description の UTF-8 バイト長が ${bytes} で上限 ${DESCRIPTION_MAX_BYTES} を超過（${bytes - DESCRIPTION_MAX_BYTES} バイト超過）`,
    ];
  }
  return [];
}

/** (c) name の有無・型と、形式（小文字英数字とハイフン・64 文字以内）を確かめる。 */
function nameViolations(data: Record<string, unknown>): string[] {
  if (!("name" in data)) return ["name が無い"];
  if (typeof data.name !== "string") return ["name が文字列でない"];
  const violations: string[] = [];
  if (!NAME_RE.test(data.name)) {
    violations.push(`name「${data.name}」は小文字英数字とハイフンのみ使える`);
  }
  if (data.name.length > NAME_MAX_LENGTH) {
    violations.push(
      `name「${data.name}」が ${data.name.length} 文字で上限 ${NAME_MAX_LENGTH} 文字を超過`,
    );
  }
  return violations;
}

// 走査対象の SKILL.md を列挙する（引数なし走査用）。
//   - skills/*/SKILL.md: 配布スキルのソース。
//   - .agents/skills/*/SKILL.md（`.private-skill` マーカー付きのみ）: private skill。
//     private skill は skills/ にソースを持たず、publish / reinstall / skills-sync の
//     どの方法でも frontmatter をチェックされないため、ここで明示的に対象へ加える。
function listSkillFiles() {
  return [
    ...skillDirFiles("skills", () => true),
    // private skill（.private-skill マーカーあり）だけを追加する。
    ...skillDirFiles(".agents/skills", (dir) => existsSync(join(dir, ".private-skill"))),
  ];
}

/** root の直下のディレクトリのうち、include を満たすものの SKILL.md。 */
function skillDirFiles(root: string, include: (dir: string) => boolean): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && include(join(root, e.name)))
    .map((e) => join(root, e.name, "SKILL.md"))
    .filter((p) => existsSync(p));
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

// CLI として実行されたときだけ動かす（テストから import しても main は動かない）。
if (isCliEntry(import.meta.url)) main();
