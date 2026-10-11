#!/usr/bin/env node
// JavaScript・TypeScript の拡張子ポリシーを決定論的に検査する（lefthook pre-commit + CI）。
// docs/tooling.md「JavaScript の拡張子」の住み分けに対応する自動ガード:
//   - 配布物は `.mjs`: 配布スキル（`skills/**`）は利用者の Node で動くので、ESM を拡張子で保証する。
//     よって `skills/**` の `.js`・`.cjs`・`.mts`・`.cts`・`.tsx` は違反。
//     `.ts` も違反（型を消して実行できる版を利用者に求めない）。
//     ただし `skills/<name>/assets/` の `.ts` は、利用者のプロジェクトへ置く雛形なので対象外。
//   - 非配布物は `.ts`: リポジトリ内ツール（`scripts/**`）は TypeScript で書き、`pnpm run typecheck` で型を検査する。
//     よって `scripts/**` の `.js`・`.mjs`・`.cjs` は違反。
//     `.mts`・`.cts` は Node が実行できるのに `tsconfig.repo.json` の include（`*.ts`）に入らず、
//     `.tsx` は Node が型を消して実行できないので、これらも違反。
// 配布しない private skill も非配布なので、`scripts/**` と同じく `.ts`。
// private skill かは `skills/<name>/` が無いことで決める（scripts/lib/source-scope.ts と同じ判定）。
// ただし作業ツリーではなく、走査したファイルの一覧（index と未追跡のファイル）から決める。
// 対象のファイルと出所をそろえるため（作業ツリーだけを消した stage 済みの違反や、空の `skills/<name>/` で判定がずれない）。
// `.private-skill` の印で決めると、印を付け忘れた private skill がこの検査から外れる。
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../lib/errors.ts";

// `.jsx` は `.tsx` と同じく、Node が実行できず `tsconfig.repo.json` の include にも入らない。
const DISTRIBUTED_BANNED = [".js", ".cjs", ".mts", ".cts", ".tsx", ".jsx"];
const NON_DISTRIBUTED_BANNED = [".js", ".mjs", ".cjs", ".mts", ".cts", ".tsx", ".jsx"];

/** パス（リポジトリのルートからの `/` 区切り）が拡張子の規約に反していれば、その理由を返す。 */
export function violationOf(path: string, privateSkills: readonly string[]): string | null {
  const parts = path.split("/");
  // 拡張子は大文字と小文字を区別せずに照合する（区別しないファイルシステムでは `a.JS` も `.js` として読まれる）。
  const lower = path.toLowerCase();
  const ext = (banned: readonly string[]) => banned.find((b) => lower.endsWith(b));
  if (parts[0] === "skills") {
    const bad = ext(DISTRIBUTED_BANNED);
    if (bad) return `skills/ では ${bad} を使わない（配布物 → .mjs にする）`;
    if (lower.endsWith(".ts") && parts[2] !== "assets") {
      return "skills/ では assets/ の雛形の外で .ts を使わない（配布スキルのスクリプトは利用者の Node で動く → .mjs にする）";
    }
    return null;
  }
  const isPrivateSkill =
    parts[0] === ".agents" && parts[1] === "skills" && privateSkills.includes(parts[2] ?? "");
  if (parts[0] === "scripts" || isPrivateSkill) {
    const bad = ext(NON_DISTRIBUTED_BANNED);
    const where = isPrivateSkill ? "private skill" : "scripts/";
    if (bad) return `${where} では ${bad} を使わない（非配布物 → .ts にする）`;
  }
  return null;
}

/** 違反の一覧（`パス: 理由`）。 */
export function findViolations(
  paths: readonly string[],
  privateSkills: readonly string[],
): string[] {
  const out: string[] = [];
  for (const path of paths) {
    const reason = violationOf(path, privateSkills);
    if (reason) out.push(`${path}: ${reason}`);
  }
  return out;
}

/**
 * 追跡しているファイルと、無視されていない未追跡のファイル。
 * `.gitignore` のものを除くのは、テストが `scripts/` の下に一時的に作る fixture（`.cjs` など）を数えないため。
 * 未追跡のファイルを含めるのは、`git add` の前に置いた違反も検出するため。
 * 1 回の `git ls-files` で全体を取り、規則はパスの接頭辞で振り分ける。
 * 作業ツリーに在るかでは絞らない。stage した違反を作業ツリーから消しても、commit には入るため。
 * `root` はリポジトリのルート（pathspec と返るパスは、起動した場所ではなくルートからの相対パスになる）。
 */
export function listFiles(root: string): string[] {
  const res = spawnSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "skills",
      "scripts",
      ".agents/skills",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(`git ls-files に失敗した（exit ${res.status}）: ${res.stderr}`);
  }
  return res.stdout.split("\0").filter((p) => p !== "");
}

/** `cwd` を含むリポジトリのルート。どの場所から起動しても、同じ範囲を走査するため。 */
export function repoRoot(cwd: string): string {
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(
      `git のリポジトリのルートを特定できない（git rev-parse exit ${res.status}）: ${res.stderr}`,
    );
  }
  return res.stdout.trim();
}

/** 走査したファイルの一覧のうち、`.agents/skills/<name>/` にあって `skills/<name>/` に無いスキルの名前。 */
export function privateSkillNames(files: readonly string[]): string[] {
  const installed = new Set<string>();
  const published = new Set<string>();
  for (const path of files) {
    const parts = path.split("/");
    if (parts[0] === ".agents" && parts[1] === "skills" && parts.length > 3)
      installed.add(parts[2]);
    if (parts[0] === "skills" && parts.length > 2) published.add(parts[1]);
  }
  return [...installed].filter((name) => !published.has(name)).sort();
}

export function main(cwd = "."): number {
  let root: string;
  let files: string[];
  try {
    root = repoRoot(cwd);
    files = listFiles(root);
  } catch (error) {
    console.error(`js-extensions: ${errorMessage(error)}`);
    return 2;
  }
  // 走査したファイルが 0 件なのは、対象が無いのではなく走査の範囲を取り違えている（判定できない）。
  if (files.length === 0) {
    console.error(`js-extensions: 走査したファイルが 0 件（${root}）。判定できないので失敗にする`);
    return 2;
  }
  const violations = findViolations(files, privateSkillNames(files));
  if (violations.length) {
    console.error("js-extensions: 拡張子ポリシー違反:");
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "Fix: 配布物（skills/**）は .mjs、非配布物（scripts/** と private skill）は .ts にリネームする。",
    );
    return 1;
  }
  console.log(`js-extensions: OK（${files.length} 件）`);
  return 0;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`js-extensions: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main());
