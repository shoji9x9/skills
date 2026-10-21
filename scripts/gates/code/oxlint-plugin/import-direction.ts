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
// 参照は、ESTree と TypeScript の構文木でモジュールを指す節点から集める。
// 節点は ImportDeclaration・ExportNamedDeclaration・ExportAllDeclaration・ImportExpression・TSImportType・
// TSImportEqualsDeclaration（`import x = require()`）である。加えて、`require` の呼び出しも集める。
// `require` は構文ではないので、`require` という名前と、createRequire の戻り値を受けた名前の呼び出しを数える。
// specifier が文字列でない参照（式を埋め込んだテンプレート文字列・変数）は、解決先を決められないので判定しない。
// JSDoc の型（`@typedef {import("…").T}`）は構文木に現れないので、JSDoc のコメントの `{…}` の中だけを読む。
import { isAbsolute, posix, relative, resolve, dirname, sep } from "node:path";
import { isRecord } from "../../../lib/guards.ts";

export type Loc = { line: number; column: number };
export type Comment = { type: string; value: string; range: readonly [number, number] };
/** ルールが読む AST の節点。oxlint は型を公開していないので、読む欄だけを書く。 */
export type AstNode = {
  type: string;
  name?: string;
  value?: unknown;
  source?: AstNode | null;
  callee?: AstNode;
  arguments?: AstNode[];
  id?: AstNode | null;
  init?: AstNode | null;
  moduleReference?: AstNode;
  expression?: AstNode;
  imported?: AstNode;
  local?: AstNode;
  specifiers?: AstNode[];
  quasis?: { value: { cooked?: string | null } }[];
  expressions?: AstNode[];
};

type Context = {
  filename: string;
  options: readonly unknown[];
  sourceCode: { getAllComments: () => Comment[]; getLocFromIndex: (index: number) => Loc };
  report: (
    d: { node: AstNode; message: string } | { loc: { start: Loc; end: Loc }; message: string },
  ) => void;
};

/** JSDoc の中の型の参照と、コメントの中の位置（文字の index）。 */
export type JsdocReference = { specifier: string; start: number; end: number };

const SKILL_RE = /^skills\/([^/]+)\//;
const SCRIPTS_RE = /^scripts\/([^/]+)\//;
/** scripts/ の中で、向きの規則を当てない分類（スキルのスクリプトのテストと fixture）。 */
const UNRESTRICTED_SCRIPTS = ["skills"];

/**
 * from（import するファイル）から to（import されるファイル）への参照が向きに反するなら、理由を返す。
 * どちらもリポジトリのルートからの `/` 区切りのパス。to がルートの外なら `../` で始まる。
 */
export function directionViolation(from: string, to: string): string | null {
  const skill = SKILL_RE.exec(from);
  if (skill) {
    if (from.startsWith(`skills/${skill[1]}/assets/`)) return null;
    if (to.startsWith(`skills/${skill[1]}/`)) return null;
    return `配布スキルは自分のディレクトリ（skills/${skill[1]}/）の外を import しない（${to}）`;
  }
  const category = SCRIPTS_RE.exec(from)?.[1];
  const target = SCRIPTS_RE.exec(to)?.[1];
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

/** JSDoc の本文から、`@example` の節を除く（コードの例は参照ではない）。次のタグか本文の終わりまでを除く。 */
const withoutExamples = (text: string): string =>
  text.replace(/@example[\s\S]*?(?=\n\s*\*\s*@|$)/g, (m) => " ".repeat(m.length));

/** JSDoc のコメント（`/** … *\/`）の型の式（`{…}` の中）にある `import("…")`。位置はファイルの中の index。 */
export function jsdocReferences(comments: readonly Comment[]): JsdocReference[] {
  const found: JsdocReference[] = [];
  for (const c of comments) {
    if (c.type !== "Block" || !c.value.startsWith("*")) continue;
    const text = withoutExamples(c.value);
    let depth = 0;
    let open = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "{" && depth++ === 0) open = i;
      if (text[i] !== "}" || depth === 0 || --depth !== 0) continue;
      for (const m of text.slice(open, i).matchAll(/import\(\s*(["'`])([^"'`]+)\1\s*\)/g)) {
        const start = c.range[0] + 2 + open + m.index;
        found.push({ specifier: m[2], start, end: start + m[0].length });
      }
    }
  }
  return found;
}

/** createRequire を import した名前（`import { createRequire as cr } from "node:module"` なら cr）。 */
function createRequireNames(node: AstNode): string[] {
  if (staticString(node.source) !== "node:module" && staticString(node.source) !== "module")
    return [];
  return (node.specifiers ?? [])
    .filter((s) => s.imported?.name === "createRequire" && s.local?.name)
    .map((s) => s.local?.name ?? "");
}

/**
 * require の呼び出し。`require` という名前と、creators（createRequire を指す名前）の呼び出しの戻り値を受けた名前の呼び出しを返す。
 * declarators と calls は、ファイルの中の変数の宣言と、名前で呼ぶ呼び出しのすべて。
 */
export function requireCalls(
  creators: ReadonlySet<string>,
  declarators: readonly AstNode[],
  calls: readonly AstNode[],
): AstNode[] {
  const requires = new Set(["require"]);
  for (const { id, init } of declarators)
    if (id?.type === "Identifier" && id.name && init?.type === "CallExpression")
      if (creators.has(init.callee?.name ?? "")) requires.add(id.name);
  return calls.filter((call) => requires.has(call.callee?.name ?? ""));
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
    // require の呼び出しは、createRequire の別名を集め終えてから（Program:exit で）判定する。
    // 宣言より前に書いた関数の中の呼び出しも、宣言の後の呼び出しと同じに扱うためである。
    const creators = new Set(["createRequire"]);
    const declarators: AstNode[] = [];
    const calls: AstNode[] = [];
    const checkSource = (node: AstNode) => check(node, node.source);
    return {
      ImportDeclaration(node: AstNode) {
        checkSource(node);
        createRequireNames(node).forEach((n) => creators.add(n));
      },
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
      ImportExpression: checkSource,
      TSImportType: checkSource,
      TSImportEqualsDeclaration(node: AstNode) {
        const ref = node.moduleReference;
        if (ref?.type === "TSExternalModuleReference") check(node, ref.expression);
      },
      VariableDeclarator(node: AstNode) {
        declarators.push(node);
      },
      CallExpression(node: AstNode) {
        if (node.callee?.type === "Identifier") calls.push(node);
      },
      "Program:exit"() {
        for (const call of requireCalls(creators, declarators, calls))
          check(call, call.arguments?.[0]);
        for (const ref of jsdocReferences(sourceCode.getAllComments())) {
          const message = violation(ref.specifier);
          if (message === null) continue;
          const start = sourceCode.getLocFromIndex(ref.start);
          context.report({ loc: { start, end: sourceCode.getLocFromIndex(ref.end) }, message });
        }
      },
    };
  },
};
