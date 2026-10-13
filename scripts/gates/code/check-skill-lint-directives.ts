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
// 1. `skills/**` の JavaScript・TypeScript のコメントで、行頭（`//`・`/*`・JSDoc の行頭の `*` を除いた先頭）に
//    使われない抑止を報告されうる指示（下の DIRECTIVES）があれば違反にする。
//    コメントの範囲は TypeScript のパーサで決める（`scripts/lib/code-comments.ts` の jsCommentRanges）。
//    文字列・テンプレート・正規表現の中の `//` や指示の名前は、コメントではないので対象にしない。
//    文章の途中で名前を挙げるだけのコメントも、指示として読まれないので対象にしない。
//    textlint・markdownlint・shellcheck の指示は、未使用でも報告されず、規則が無いプロジェクトでは何もしないので対象にしない。
// 2. `oxlint.config.ts` は、`Array.isArray` の禁止をファイル単位で外す（一覧は `scripts/lib/is-array-holders.ts`）。
//    そのファイルでは、組み込みの `Array.isArray` を、関数宣言 `isArray` の中で 1 回だけ使うことを求める。
//    使い方は構文木で数える（`Array.isArray`・`Array?.isArray`・`Array["isArray"]`・`const { isArray } = Array`。
//    改行やコメントを挟んでも同じ）。ファイル単位で外した分、関数の外の呼び出しを oxlint が検出しなくなるので、ここで検出する。
//    一覧のファイルが無い・関数宣言 `isArray` が 1 つだけ無いものも違反にする。
// 読む中身: index にあるファイルは staged の blob、未追跡のファイルは作業ツリーから読む。
// pre-commit では commit に入る中身を、CI では commit の中身（作業ツリーと同じ）を見る。作業ツリーから消して
// stage したままのファイルも、index から読む。
// 走査したファイルが 0 件・git が失敗した・中身を読めないときは、判定できないので exit 2 にする。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { jsCommentRanges } from "../../lib/code-comments.ts";
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
      const hit = DIRECTIVES.find((d) => head.startsWith(d));
      if (hit) out.push(`${first + i}: ${hit}`);
    });
  }
  return out;
}

/** 組み込みの `Array.isArray` を読む式か（プロパティの参照・要素の参照・分割代入）。 */
function isBuiltinIsArray(node: ts.Node): boolean {
  const isArrayIdent = (e: ts.Expression) => ts.isIdentifier(e) && e.text === "Array";
  if (ts.isPropertyAccessExpression(node)) {
    return isArrayIdent(node.expression) && node.name.text === "isArray";
  }
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    return (
      isArrayIdent(node.expression) &&
      (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) &&
      arg.text === "isArray"
    );
  }
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name)) {
    return (
      isArrayIdent(node.initializer) &&
      node.name.elements.some((el) => (el.propertyName ?? el.name).getText() === "isArray")
    );
  }
  return false;
}

/** `isArray` を持つファイルの違反。組み込みの `Array.isArray` は、関数宣言 `isArray` の中で 1 回だけ使ってよい。 */
export function findOutsideGuard(source: string, path = "a.ts"): string[] {
  const kind = path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const guards: ts.FunctionDeclaration[] = [];
  const uses: { node: ts.Node; inGuard: boolean }[] = [];
  const visit = (node: ts.Node, inGuard: boolean) => {
    let inside = inGuard;
    if (ts.isFunctionDeclaration(node) && node.name?.text === "isArray") {
      guards.push(node);
      inside = true;
    }
    if (isBuiltinIsArray(node)) uses.push({ node, inGuard: inside });
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(sf, false);
  if (guards.length !== 1) {
    return [`関数宣言 isArray が 1 つだけ無い（${guards.length} 件）`];
  }
  const out: string[] = [];
  for (const u of uses) {
    if (!u.inGuard) {
      out.push(
        `${lineOf(source, u.node.getStart(sf))}: 型ガード isArray の外で Array.isArray を使っている`,
      );
    }
  }
  const inside = uses.filter((u) => u.inGuard).length;
  if (inside !== 1) {
    out.push(
      `${lineOf(source, guards[0].getStart(sf))}: 型ガード isArray の中の Array.isArray が 1 回だけでない（${inside} 回）`,
    );
  }
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
export function findViolations(
  root: string,
  skillFiles: readonly string[],
  holders: readonly string[],
): string[] {
  const out: string[] = [];
  const code = skillFiles.filter((p) => CODE_EXT_RE.test(p));
  const blobs = indexBlobs(root, [...code, ...holders]);
  for (const path of code) {
    const source = readSource(root, path, blobs);
    if (source === null) throw new Error(`${path}: index にも作業ツリーにも無い`);
    for (const v of findDirectives(source, path)) {
      out.push(`${path}:${v}（このリポジトリの設定を前提にした抑止。設定の overrides で外す）`);
    }
  }
  for (const path of holders) {
    const source = readSource(root, path, blobs);
    if (source === null) {
      out.push(`${path}: scripts/lib/is-array-holders.ts に挙げたファイルが無い`);
      continue;
    }
    for (const v of findOutsideGuard(source, path)) out.push(`${path}:${v}`);
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
