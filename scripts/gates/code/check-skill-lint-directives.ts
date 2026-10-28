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
// `skills/**` の JavaScript・TypeScript のコメントで、行頭（`//`・`/*`・JSDoc の行頭の `*` を除いた先頭）に
// 使われない抑止を報告されうる指示（下の DIRECTIVES）があれば違反にする。
// コメントの範囲は TypeScript のパーサで決める（`scripts/lib/text/code-comments.ts` の jsCommentRanges）。
// 文字列・テンプレート・正規表現の中の `//` や指示の名前は、コメントではないので対象にしない。
// 文章の途中で名前を挙げるだけのコメントも、指示として読まれないので対象にしない。
// textlint・markdownlint・shellcheck の指示は、未使用でも報告されず、規則が無いプロジェクトでは何もしないので対象にしない。
// 読む中身: index にあるファイルは staged の blob、未追跡のファイルは作業ツリーから読む。
// pre-commit では commit に入る中身を、CI では commit の中身（作業ツリーと同じ）を見る。作業ツリーから消して
// stage したままのファイルも、index から読む。
// 走査したファイルが 0 件・git が失敗した・中身を読めないときは、判定できないので exit 2 にする。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { jsCommentRanges } from "../../lib/text/code-comments.ts";
import { errorMessage } from "../../lib/errors.ts";
import { listFiles } from "./check-js-extensions.ts";

// 配布スキルで置ける JavaScript・TypeScript の拡張子だけを走査する（`.mjs` と雛形の `.ts`）。
// 他の拡張子（`.js`・`.jsx`・`.tsx`・`.mts` など）は `check-js-extensions.ts` が配布スキルで禁じているので、
// ここで JSX などの文法を読み分ける必要は無い。
const CODE_EXT_RE = /\.(?:mjs|ts)$/;

/**
 * 使われない抑止を報告されうる指示と、ツールが受け付ける接尾辞。
 * 指示の後ろは、行末・空白・`:`（`biome-ignore lint/x: 理由` など）のどれかに限る。
 * `eslint-disablement` のように指示を前に含むだけの語は、ツールが指示として読まないので数えない。
 */
const DIRECTIVES: Record<string, string[]> = {
  "oxlint-disable": ["", "-line", "-next-line"],
  "eslint-disable": ["", "-line", "-next-line"],
  "biome-ignore": ["", "-all", "-start", "-end"],
  "@ts-expect-error": [""],
  "deno-lint-ignore": ["", "-file"],
};

// 指示と接尾辞は英小文字・`-`・`@` だけなので、文字クラスの外ではそのまま正規表現に置ける。
// 接尾辞は長いものから並べ、`-next-line` を `-line` より先に試す。
const SUFFIXES = [...new Set(Object.values(DIRECTIVES).flat())]
  .filter((x) => x !== "")
  .sort((a, b) => b.length - a.length);
const DIRECTIVE_RE = new RegExp(
  `^(${Object.keys(DIRECTIVES).join("|")})(${SUFFIXES.join("|")})?(?=$|[\\s:])`,
);

/** コメントの 1 行の先頭が、受け付ける接尾辞を付けた指示なら、その指示の名前。 */
function directiveAt(head: string): string | undefined {
  const m = DIRECTIVE_RE.exec(head);
  if (!m) return undefined;
  return (DIRECTIVES[m[1]] ?? []).includes(m[2] ?? "") ? m[1] : undefined;
}

function lineOf(source: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos; i++) if (source[i] === "\n") line++;
  return line;
}

/** 1 ファイルの抑止コメントの違反（`行番号: 指示`）。 */
export function findDirectives(source: string, path = "a.ts"): string[] {
  const out: string[] = [];
  for (const r of jsCommentRanges(source, path)) {
    const raw = source.slice(r.pos, r.end);
    const body =
      r.kind === ts.SyntaxKind.SingleLineCommentTrivia
        ? raw.replace(/^\/\//, "")
        : raw.replace(/^\/\*+/, "").replace(/\*+\/$/, "");
    const first = lineOf(source, r.pos);
    body.split("\n").forEach((part, i) => {
      const head = part.replace(/^\s*(?:\*+(?!\/))?\s*/, "");
      const hit = directiveAt(head);
      if (hit) out.push(`${first + i}: ${hit}`);
    });
  }
  return out;
}

/** `skills/` の下の、追跡しているファイルと無視されていない未追跡のファイル（ルートからのパス）。 */
function listSkillFiles(root: string): string[] {
  return listFiles(root).filter((p) => p.startsWith("skills/"));
}

/** index にあるファイルのパスと blob の id。 */
function indexBlobs(root: string, paths: readonly string[]): Map<string, string> {
  const res = spawnSync("git", ["ls-files", "-z", "--stage", "--", ...paths], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`git ls-files --stage に失敗した（exit ${res.status}）: ${res.stderr}`);
  }
  const map = new Map<string, string>();
  for (const entry of res.stdout.split("\0")) {
    const m = /^\d+ ([0-9a-f]+) \d+\t(.+)$/s.exec(entry);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

/** ファイルの中身。index にあれば staged の blob、無ければ作業ツリーから読む。どちらにも無ければ null。 */
function readSource(root: string, path: string, blobs: Map<string, string>): string | null {
  const blob = blobs.get(path);
  if (blob) {
    const res = spawnSync("git", ["cat-file", "blob", blob], { cwd: root, encoding: "utf8" });
    if (res.status !== 0) {
      throw new Error(
        `${path}: staged の中身を読めない（git cat-file exit ${res.status}）: ${res.stderr}`,
      );
    }
    return res.stdout;
  }
  const abs = join(root, path);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
}

/** 違反の一覧（`パス:行番号: 内容`）。 */
export function findViolations(root: string, skillFiles: readonly string[]): string[] {
  const out: string[] = [];
  const code = skillFiles.filter((p) => CODE_EXT_RE.test(p));
  const blobs = indexBlobs(root, code);
  for (const path of code) {
    const source = readSource(root, path, blobs);
    if (source === null) throw new Error(`${path}: index にも作業ツリーにも無い`);
    for (const v of findDirectives(source, path)) {
      out.push(`${path}:${v}（このリポジトリの設定を前提にした抑止。設定の overrides で外す）`);
    }
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

function main(cwd = "."): number {
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
    violations = findViolations(root, files);
  } catch (error) {
    console.error(`skill-lint-directives: ${errorMessage(error)}`);
    return 2;
  }
  if (violations.length) {
    console.error("skill-lint-directives: 違反:");
    for (const v of violations) console.error(`  - ${v}`);
    return 1;
  }
  console.log(`skill-lint-directives: OK（${code.length} 件）`);
  return 0;
}

if (import.meta.main) process.exit(main());
