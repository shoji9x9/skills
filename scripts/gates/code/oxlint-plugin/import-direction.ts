// 参照の向きを決めて、逆向きの import を失敗にするルール（Issue #658）。
//
// 組み込みの `no-restricted-imports` の `patterns` は、書かれた specifier の字面で照合する。
// 相対パスの `../../skills/` は、書いたファイルの深さによって `scripts/skills/` も `skills/` も指すので、
// 字面では向きを決められない。そこで、import するファイルからの相対パスを解決し、リポジトリのルートからのパスで判定する。
//
// 向きは次の 3 つである。
// - 配布スキル（skills/<name>/）は、自分のディレクトリの外を import しない。利用者のプロジェクトには skills/<name>/ だけが入る。
//   ただし雛形（skills/<name>/assets/）は利用者のプロジェクトへコピーしてから使い、相対パスもコピー先で解決するので、対象にしない。
// - scripts/ の各分類（lib/・gates/・eval/・hooks/ など）は、自分の分類と scripts/lib/ の他を import しない。
//   scripts/lib/ は、scripts/ の他の分類を import しないので、共有ライブラリが上位のチェックやツールに依存しない。
//   scripts/skills/ はスキルのスクリプトのテストと fixture の置き場所なので、この向きを当てない。
//
// 参照は、閉じた定義で集める。書き方を 1 つずつ足していくと、足していない書き方を取りこぼすからである。
// 1. 構文の参照は、ESTree と TypeScript の節点から集める。
//    節点は ImportDeclaration・ExportNamedDeclaration・ExportAllDeclaration・ImportExpression・TSImportType・
//    TSImportEqualsDeclaration である。
// 2. 呼び出しの引数: 相対パス（`./`・`../`）の文字列を引数に渡す呼び出しと new は、関数に依らずすべて参照として扱う。
//    require・createRequire の戻り値・vi.mock・vi.importActual を、名前を数えずに同じ規則で判定するためである。
//    モジュールでないファイル（`.md` など）のパスは除く。拡張子が JS・TS・JSON か、拡張子の無いパスだけを数える。
// 3. コメントの参照: JSDoc の型（`{import("…")}`）・`@import`・`/// <reference path>` は構文木に現れないので、
//    TypeScript のパーサで読む。`@example` のコードは JSDoc の本文として扱われるので、参照にならない。
// specifier が文字列でない参照（式を埋め込んだテンプレート文字列・変数・`join(here, "..", "lib")` のように分けた引数）は、
// 解決先を決められないので判定しない。引数の相対パスは、書いたファイルからのパスとして解決する。
// cwd やリポジトリのルートを基準にした文字列も同じに解決するので、その形で向きに反して見えるときは、基準を変数にして渡す。
import { extname, isAbsolute, posix, relative, resolve, dirname, sep } from "node:path";
import ts from "typescript";
import { isRecord } from "../../../lib/guards.ts";
import { isArray } from "../../../lib/is-array.ts";

export type Loc = { line: number; column: number };
export type Comment = { type: string; value: string };
/** ルールが読む AST の節点。oxlint は型を公開していないので、読む欄だけを書く。 */
export type AstNode = {
  type: string;
  value?: unknown;
  source?: AstNode | null;
  arguments?: AstNode[];
  moduleReference?: AstNode;
  expression?: AstNode;
  quasis?: { value: { cooked?: string | null } }[];
  expressions?: AstNode[];
};

type Context = {
  filename: string;
  options: readonly unknown[];
  sourceCode: {
    text: string;
    getAllComments: () => Comment[];
    getLocFromIndex: (index: number) => Loc;
  };
  report: (
    d: { node: AstNode; message: string } | { loc: { start: Loc; end: Loc }; message: string },
  ) => void;
};

/** コメントの中の参照と、ファイルの中の位置（文字の index）。 */
export type CommentReference = { specifier: string; start: number; end: number };

const SKILL_RE = /^skills\/([^/]+)\//;
const SCRIPTS_RE = /^scripts\/([^/]+)\//;
/** scripts/ の中で、向きの規則を当てない分類（スキルのスクリプトのテストと fixture）。 */
const UNRESTRICTED_SCRIPTS = ["skills"];

/**
 * from（import するファイル）から to（import されるファイル）への参照が向きに反するなら、理由を返す。
 * どちらもリポジトリのルートからの `/` 区切りのパス。to がルートの外なら `../` で始まる。
 */
export function directionViolation(from: string, to: string): string | null {
  // 拡張子の無い参照（`../..` が解決した skills/<name> などのディレクトリ）は、その中のファイルと同じに扱うため、末尾に / を足して照合する。
  const dir = extname(to) === "" && !to.endsWith("/") ? `${to}/` : to;
  const skill = SKILL_RE.exec(from);
  if (skill) {
    if (from.startsWith(`skills/${skill[1]}/assets/`)) return null;
    if (dir.startsWith(`skills/${skill[1]}/`)) return null;
    return `配布スキルは自分のディレクトリ（skills/${skill[1]}/）の外を import しない（${to}）`;
  }
  const category = SCRIPTS_RE.exec(from)?.[1];
  const target = SCRIPTS_RE.exec(dir)?.[1];
  if (category === undefined || target === undefined || target === category) return null;
  if (UNRESTRICTED_SCRIPTS.includes(category) || target === "lib") return null;
  const allowed = category === "lib" ? "scripts/lib/" : `scripts/${category}/ と scripts/lib/`;
  return `scripts/${category}/ は、${allowed} の外の scripts/ を import しない（${to}）`;
}

/** オプション `{ root }`（リポジトリのルートの絶対パス）。無ければ、判定できないので例外にする。 */
export function rootOf(options: readonly unknown[]): string {
  const first = options[0];
  const root = isRecord(first) ? first.root : undefined;
  if (typeof root !== "string" || !isAbsolute(root))
    throw new Error("import-direction: root にリポジトリのルートの絶対パスを渡す");
  return root;
}

/** specifier が相対パスか絶対パスなら、ルートからのパスにする。パッケージの名前なら null。 */
export function resolveFromRoot(root: string, filename: string, specifier: string): string | null {
  if (!specifier.startsWith(".") && !isAbsolute(specifier)) return null;
  return relative(root, resolve(dirname(filename), specifier))
    .split(sep)
    .join(posix.sep);
}

/** 文字列のリテラルか、式を埋め込まないテンプレート文字列なら、その値。それ以外は null。 */
export function staticString(node: AstNode | null | undefined): string | null {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions?.length === 0)
    return node.quasis?.[0]?.value.cooked ?? null;
  return null;
}

/** 呼び出しの引数として、モジュールへの参照とみなすパスか（相対パスで、拡張子が JS・TS・JSON か拡張子が無い）。 */
export function isModuleArgument(path: string): boolean {
  if (path !== "." && path !== ".." && !path.startsWith("./") && !path.startsWith("../"))
    return false;
  const ext = extname(path);
  return ext === "" || /^\.(?:[cm]?[jt]sx?|json)$/.test(ext);
}

/** TypeScript の節点が持つ JSDoc（内部の欄 `jsDoc`）。1 つの節点に複数の JSDoc が付くので、公開の API では取りこぼす。 */
function jsDocOf(node: ts.Node): ts.Node[] {
  const docs: unknown = Reflect.get(node, "jsDoc");
  return isArray(docs) ? docs.filter((d): d is ts.Node => d instanceof Object && "kind" in d) : [];
}

/** ファイルの拡張子に合わせた TypeScript のパースの種類。JSX を含むファイルを TS として読むと構文の誤りになる。 */
function scriptKindOf(filename: string): ts.ScriptKind {
  if (filename.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filename.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return /\.[cm]?js$/.test(filename) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/**
 * コメントの中の参照（JSDoc の型の import("…")・@import・/// <reference path>）を、TypeScript のパーサで集める。
 * コメントに `import(`・`@import`・`<reference` のどれも無ければ、パースせずに空を返す（全ファイルを 2 回パースしないため）。
 */
export function commentReferences(
  filename: string,
  text: string,
  comments: readonly Comment[],
): CommentReference[] {
  if (!comments.some((c) => /import\s*\(|@import|<reference/.test(c.value))) return [];
  const kind = scriptKindOf(filename);
  const sf = ts.createSourceFile(filename, text, ts.ScriptTarget.ESNext, true, kind);
  const found: CommentReference[] = sf.referencedFiles.map((r) => ({
    specifier: r.fileName,
    start: r.pos,
    end: r.end,
  }));
  const literal = (lit: ts.Node) => {
    if (ts.isStringLiteral(lit))
      found.push({ specifier: lit.text, start: lit.getStart(sf), end: lit.end });
  };
  const inDoc = (n: ts.Node): void => {
    if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) literal(n.argument.literal);
    if (ts.isJSDocImportTag(n)) literal(n.moduleSpecifier);
    ts.forEachChild(n, inDoc);
  };
  const visit = (n: ts.Node): void => {
    jsDocOf(n).forEach(inDoc);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

export const importDirection = {
  meta: {
    type: "problem",
    docs: { description: "scripts/ と配布スキルの参照の向きに反する import を失敗にする" },
    schema: [
      {
        type: "object",
        properties: { root: { type: "string" } },
        required: ["root"],
        additionalProperties: false,
      },
    ],
  },
  create(context: Context) {
    const root = rootOf(context.options);
    const from = relative(root, context.filename).split(sep).join(posix.sep);
    const { sourceCode } = context;
    const violation = (specifier: string | null) => {
      const to = specifier === null ? null : resolveFromRoot(root, context.filename, specifier);
      const message = to === null ? null : directionViolation(from, to);
      return message === null ? null : `${message}。向きは docs/tooling.md にある`;
    };
    const check = (node: AstNode, source: AstNode | null | undefined) => {
      const message = violation(staticString(source));
      if (message !== null) context.report({ node, message });
    };
    const checkSource = (node: AstNode) => check(node, node.source);
    const checkArguments = (node: AstNode) => {
      for (const arg of node.arguments ?? []) {
        const path = staticString(arg);
        if (path !== null && isModuleArgument(path)) check(arg, arg);
      }
    };
    return {
      ImportDeclaration: checkSource,
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
      ImportExpression: checkSource,
      TSImportType: checkSource,
      TSImportEqualsDeclaration(node: AstNode) {
        const ref = node.moduleReference;
        if (ref?.type === "TSExternalModuleReference") check(node, ref.expression);
      },
      CallExpression: checkArguments,
      // new URL("…", import.meta.url)・new Worker("…") も、呼び出しと同じに扱う。
      NewExpression: checkArguments,
      "Program:exit"() {
        const comments = sourceCode.getAllComments();
        for (const ref of commentReferences(context.filename, sourceCode.text, comments)) {
          const message = violation(ref.specifier);
          if (message === null) continue;
          const start = sourceCode.getLocFromIndex(ref.start);
          context.report({ loc: { start, end: sourceCode.getLocFromIndex(ref.end) }, message });
        }
      },
    };
  },
};
