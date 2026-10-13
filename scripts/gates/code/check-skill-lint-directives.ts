#!/usr/bin/env node
// 配布スキルに、このリポジトリの lint・型の検査の設定を前提にした抑止コメントを置かせない（lefthook pre-commit + CI）。
//
// なぜ要るか: 配布スキルは利用者のプロジェクトへ入り、雛形と 1 ファイルだけコピーするツールは利用者のコードになる。
// 利用者のプロジェクトでは、このリポジトリの設定を前提にした抑止コメントは何も抑えない。
// そのうえ、使われない抑止を報告する設定（oxlint・ESLint の reportUnusedDisableDirectives、
// TypeScript の `@ts-expect-error`、Biome・Deno の未使用の抑止）では、それだけで lint や型の検査が失敗する。
// このリポジトリで外す必要がある規則は、行のコメントではなく設定（`oxlint.config.ts` の overrides）で外す。
// 判断の基準は `.agents/rules/distributed-skill-stack-independence.md` にある。
//
// 判定規則:
// 1. `skills/**` の JavaScript・TypeScript で、コメントの先頭（`//`・`/*`・JSDoc の行頭の `*` の直後）に
//    使われない抑止を報告されうる指示（下の DIRECTIVES）があれば違反にする。
//    文章の途中で名前を挙げるだけのコメントや、文字列・正規表現の中の名前は、指示として読まれないので対象にしない。
//    textlint・markdownlint・shellcheck の指示は、未使用でも報告されず、規則が無いプロジェクトでは何もしないので対象にしない。
// 2. `oxlint.config.ts` は、`Array.isArray` の禁止をファイル単位で外す（一覧は `scripts/lib/is-array-holders.ts`）。
//    そのファイルでは、印 `// is-array*:begin` と `// is-array*:end` の間（型ガード `isArray` の本体）の外の `Array.isArray` を違反にする。
//    ファイル単位で外した分、関数の外の呼び出しを oxlint が検出しなくなるので、ここで検出する。
//    一覧のファイルが無い・印が 1 組だけ無い（無い・重複・逆順）ものも違反にする。
// 走査したファイルが 0 件・git が失敗したときは、判定できないので exit 2 にする。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../../lib/errors.ts";
import { IS_ARRAY_HOLDERS } from "../../lib/is-array-holders.ts";

const CODE_EXT_RE = /\.(?:mjs|cjs|js|jsx|ts|mts|cts|tsx)$/i;

/** 使われない抑止を報告されうる指示。 */
const DIRECTIVES = [
  "oxlint-disable",
  "eslint-disable",
  "biome-ignore",
  "@ts-expect-error",
  "deno-lint-ignore",
];

const DIRECTIVE_RE = new RegExp(
  String.raw`(?:\/\/|\/\*+|^\s*\*)\s*(${DIRECTIVES.map((d) => d.replace(/[-@]/g, (c) => `\\${c}`)).join("|")})`,
);

const REGION_RE = /^\s*\/\/ is-array[a-z0-9-]*:(begin|end)\s*$/;
const BUILTIN_IS_ARRAY_RE = /\bArray\s*\.\s*isArray\b/;
const LINE_COMMENT_RE = /(^|\s)\/\//;

/** 1 ファイルの抑止コメントの違反（`行番号: 指示`）。 */
export function findDirectives(text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    const m = DIRECTIVE_RE.exec(line);
    if (m) out.push(`${i + 1}: ${m[1]}`);
  });
  return out;
}

/** 行からコメントを除いた部分（行コメントと、JSDoc・ブロックコメントの行）。 */
function codePart(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  // 行コメントの `//` は、行頭か空白の直後のものだけにする。文字列の中の URL（`"https://..."`）で切ると、
  // その後ろのコードの `Array.isArray` を見逃す。
  const m = LINE_COMMENT_RE.exec(line);
  const idx = m ? m.index + m[1].length : -1;
  return idx === -1 ? line : line.slice(0, idx);
}

/** `isArray` を持つファイルで、印の間の外にある `Array.isArray` の違反。印が 1 組だけ無ければ、その理由を返す。 */
export function findOutsideRegion(text: string): string[] {
  const lines = text.split("\n");
  const marks = lines
    .map((line, i) => ({ i, kind: REGION_RE.exec(line)?.[1] }))
    .filter((m) => m.kind !== undefined);
  const begin = marks.filter((m) => m.kind === "begin");
  const end = marks.filter((m) => m.kind === "end");
  if (begin.length !== 1 || end.length !== 1 || begin[0].i > end[0].i) {
    return ["印 `// is-array*:begin` と `// is-array*:end` が 1 組だけ、この順で無い"];
  }
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (i > begin[0].i && i < end[0].i) return;
    if (BUILTIN_IS_ARRAY_RE.test(codePart(line))) {
      out.push(`${i + 1}: 型ガード isArray の外で Array.isArray を使っている`);
    }
  });
  return out;
}

/** `skills/` の下の、追跡しているファイルと無視されていない未追跡のファイル（ルートからのパス）。 */
export function listSkillFiles(root: string): string[] {
  const res = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "skills"],
    { cwd: root, encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(`git ls-files に失敗した（exit ${res.status}）: ${res.stderr}`);
  }
  return res.stdout.split("\0").filter((p) => p !== "");
}

/** 違反の一覧（`パス:行番号: 内容`）。 */
export function findViolations(
  root: string,
  skillFiles: readonly string[],
  holders: readonly string[],
): string[] {
  const out: string[] = [];
  for (const path of skillFiles) {
    if (!CODE_EXT_RE.test(path)) continue;
    const abs = join(root, path);
    // 作業ツリーに無いファイルは読めないので対象にしない（CI は commit の中身を作業ツリーとして読むので、そこで検出する）。
    if (!existsSync(abs)) continue;
    for (const v of findDirectives(readFileSync(abs, "utf8"))) {
      out.push(`${path}:${v}（このリポジトリの設定を前提にした抑止。設定の overrides で外す）`);
    }
  }
  for (const path of holders) {
    const abs = join(root, path);
    if (!existsSync(abs)) {
      out.push(`${path}: scripts/lib/is-array-holders.ts に挙げたファイルが無い`);
      continue;
    }
    for (const v of findOutsideRegion(readFileSync(abs, "utf8"))) out.push(`${path}:${v}`);
  }
  return out;
}

function repoRoot(cwd: string): string {
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git のリポジトリのルートを特定できない（exit ${res.status}）: ${res.stderr}`);
  }
  return res.stdout.trim();
}

export function main(cwd = "."): number {
  let root: string;
  let files: string[];
  try {
    root = repoRoot(cwd);
    files = listSkillFiles(root);
  } catch (error) {
    console.error(`skill-lint-directives: ${errorMessage(error)}`);
    return 2;
  }
  const code = files.filter((p) => CODE_EXT_RE.test(p));
  if (code.length === 0) {
    console.error(
      `skill-lint-directives: skills/ の JavaScript・TypeScript が 0 件（${root}）。判定できないので失敗にする`,
    );
    return 2;
  }
  let violations: string[];
  try {
    violations = findViolations(root, files, IS_ARRAY_HOLDERS);
  } catch (error) {
    console.error(`skill-lint-directives: ${errorMessage(error)}`);
    return 2;
  }
  if (violations.length) {
    console.error("skill-lint-directives: 違反:");
    for (const v of violations) console.error(`  - ${v}`);
    return 1;
  }
  console.log(
    `skill-lint-directives: OK（${code.length} 件、isArray を持つファイル ${IS_ARRAY_HOLDERS.length} 件）`,
  );
  return 0;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`skill-lint-directives: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main());
