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
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { jsCommentRanges } from "../../lib/code-comments.ts";
import { errorMessage } from "../../lib/errors.ts";
import { isRecord } from "../../lib/guards.ts";
import { IS_ARRAY_HOLDERS, IS_ARRAY_RESTRICTION } from "../../lib/is-array-holders.ts";
import { isArray } from "../../lib/is-array.ts";

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

/** 関数宣言 `isArray` の範囲（UTF-8 のバイト位置）と、始まりの行。1 つだけでなければ、その件数。 */
function guardRange(
  source: string,
  path: string,
): { start: number; end: number; line: number } | number {
  const kind = path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const guards: ts.FunctionDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "isArray") guards.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (guards.length !== 1) return guards.length;
  // oxlint の診断の位置（offset）は UTF-8 のバイト位置なので、TypeScript の位置（UTF-16）を同じ単位に直す。
  // 行で比べると、同じ行で関数の前後にある呼び出しを、関数の中と取り違える。
  const bytes = (pos: number) => Buffer.byteLength(source.slice(0, pos), "utf8");
  const start = guards[0].getStart(sf);
  return { start: bytes(start), end: bytes(guards[0].getEnd()), line: lineOf(source, start) };
}

/** oxlint が検出した `Array.isArray` の位置（行は 1 始まり、offset は UTF-8 のバイト位置）。 */
export type IsArrayUse = { line: number; offset: number };

const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const RULE = "no-restricted-properties";

/**
 * 組み込みの `Array.isArray` を使う位置を、ファイルごとに返す。
 * 判定は、`oxlint.config.ts` と同じ禁止（IS_ARRAY_RESTRICTION）だけを有効にした oxlint に任せる。
 * 書き方（改行を挟んだ参照・`?.`・`["isArray"]`・分割代入・代入の分割）を自前で数えると、書き方の数だけ抜けが出るからである。
 * 中身は一時ディレクトリに書いて渡す（staged の中身を読むため）。oxlint が失敗したら例外にする。
 */
export function isArrayUses(entries: readonly { path: string; source: string }[]): IsArrayUse[][] {
  const dir = mkdtempSync(join(tmpdir(), "skill-lint-directives-"));
  try {
    const config = join(dir, "oxlintrc.json");
    writeFileSync(
      config,
      JSON.stringify({ categories: {}, rules: { [RULE]: ["error", IS_ARRAY_RESTRICTION] } }),
    );
    const files = entries.map((e, i) => {
      const file = join(dir, `${i}-${basename(e.path)}`);
      writeFileSync(file, e.source);
      return file;
    });
    const res = spawnSync("pnpm", ["exec", "oxlint", "-c", config, "--format", "json", ...files], {
      cwd: REPO_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.status !== 0 && res.status !== 1) {
      throw new Error(`oxlint を実行できない（exit ${res.status}）: ${res.stderr}`);
    }
    const parsed: unknown = JSON.parse(res.stdout);
    const diagnostics = isRecord(parsed) ? parsed.diagnostics : undefined;
    if (!isArray(diagnostics)) throw new Error("oxlint の出力に diagnostics が無い");
    const uses = entries.map((): IsArrayUse[] => []);
    for (const d of diagnostics) {
      if (!isRecord(d) || typeof d.code !== "string" || !d.code.endsWith(`(${RULE})`)) continue;
      const label = isArray(d.labels) ? d.labels[0] : undefined;
      const span = isRecord(label) ? label.span : undefined;
      const index = files.indexOf(typeof d.filename === "string" ? d.filename : "");
      if (
        !isRecord(span) ||
        typeof span.line !== "number" ||
        typeof span.offset !== "number" ||
        index === -1
      ) {
        throw new Error("oxlint の診断の形を読めない");
      }
      uses[index].push({ line: span.line, offset: span.offset });
    }
    return uses;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `isArray` を持つファイルの違反。組み込みの `Array.isArray` は、関数宣言 `isArray` の中で 1 回だけ使ってよい。 */
export function guardViolations(
  source: string,
  path: string,
  uses: readonly IsArrayUse[],
): string[] {
  const guard = guardRange(source, path);
  if (typeof guard === "number") return [`関数宣言 isArray が 1 つだけ無い（${guard} 件）`];
  const out: string[] = [];
  const within = (u: IsArrayUse) => u.offset >= guard.start && u.offset < guard.end;
  for (const u of uses) {
    if (!within(u)) out.push(`${u.line}: 型ガード isArray の外で Array.isArray を使っている`);
  }
  const inside = uses.filter(within).length;
  if (inside !== 1) {
    out.push(
      `${guard.line}: 型ガード isArray の中の Array.isArray が 1 回だけでない（${inside} 回）`,
    );
  }
  return out;
}

/** 1 ファイルの `guardViolations`（テスト用。oxlint を 1 回起動する）。 */
export function findOutsideGuard(source: string, path = "a.ts"): string[] {
  const [uses] = isArrayUses([{ path, source }]);
  return guardViolations(source, path, uses ?? []);
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
  const present: { path: string; source: string }[] = [];
  for (const path of holders) {
    const source = readSource(root, path, blobs);
    if (source === null)
      out.push(`${path}: scripts/lib/is-array-holders.ts に挙げたファイルが無い`);
    // 一覧に挙げたファイルは index に置く。作業ツリーにだけあると pre-commit は通るのに、commit には入らず
    // oxlint.config.ts の overrides が指す先が無くなる（CI で初めて失敗する）。
    else if (!blobs.has(path))
      out.push(`${path}: 一覧に挙げたファイルが index に無い（stage する）`);
    else present.push({ path, source });
  }
  const uses = present.length ? isArrayUses(present) : [];
  present.forEach((e, i) => {
    for (const v of guardViolations(e.source, e.path, uses[i] ?? [])) out.push(`${e.path}:${v}`);
  });
  return out;
}

function repoRoot(cwd: string): string {
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git のリポジトリのルートを特定できない（exit ${res.status}）: ${res.stderr}`);
  }
  return res.stdout.trim();
}

/** 一覧のファイル（このチェックが import する）。中身は作業ツリーの版で、staged の版ではない。 */
export const HOLDERS_REGISTRY = "scripts/lib/is-array-holders.ts";

/**
 * 一覧のファイルが index に無いか、作業ツリーと index で食い違っていれば例外にする。
 * このチェックは一覧を import する（作業ツリーの版）が、ファイルの中身は staged の版を読む。
 * 一部だけを stage すると、commit に入る一覧と、検査に使う一覧がずれる。
 * index に無いと（未追跡・`git rm --cached`）、`git diff` は差を報告しないのに、commit の後は
 * `oxlint.config.ts` の import 先が無くなる。
 */
export function assertRegistryStaged(root: string): void {
  const listed = spawnSync("git", ["ls-files", "--error-unmatch", "--", HOLDERS_REGISTRY], {
    cwd: root,
    encoding: "utf8",
  });
  if (listed.status !== 0) {
    throw new Error(`${HOLDERS_REGISTRY} が index に無い。追加して stage してから実行する`);
  }
  const res = spawnSync("git", ["diff", "--quiet", "--no-ext-diff", "--", HOLDERS_REGISTRY], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.status === 1) {
    throw new Error(
      `${HOLDERS_REGISTRY} の作業ツリーと staged の中身が違う。全体を stage するか、変更を戻してから実行する`,
    );
  }
  if (res.status !== 0) throw new Error(`git diff に失敗した（exit ${res.status}）: ${res.stderr}`);
}

export function main(cwd = "."): number {
  let root: string;
  let files: string[];
  try {
    root = repoRoot(cwd);
    assertRegistryStaged(root);
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
