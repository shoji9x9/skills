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
// 参照の書き方は自分で列挙せず、TypeScript の `ts.preProcessFile` に集めさせる。
// `import`・`export from`・`import()`（テンプレート文字列を含む）・`import x = require()`・`require()`・型の `import("…")` を拾い、
// 文字列とコメントの中は読まない。JSDoc の型（`@typedef {import("…").T}`）は、JSDoc のコメントの本文に同じ関数を当てて拾う。
// `preProcessFile` が拾わない `createRequire` の戻り値を別の名前で受けた呼び出しだけを、構文木で拾う。
import { isAbsolute, posix, relative, resolve, dirname, sep } from "node:path";
import ts from "typescript";
import { isRecord } from "../../../lib/guards.ts";

export type Loc = { line: number; column: number };
export type Comment = { type: string; value: string; range: readonly [number, number] };
export type Expr = {
  type: string;
  name?: string;
  value?: unknown;
  callee?: Expr;
  arguments?: Expr[];
};
export type Declarator = { id?: Expr; init?: Expr | null };

type Context = {
  filename: string;
  options: readonly unknown[];
  sourceCode: {
    text: string;
    getAllComments: () => Comment[];
    getLocFromIndex: (index: number) => Loc;
  };
  report: (d: { loc: { start: Loc; end: Loc }; message: string }) => void;
};

/** 参照の specifier と、ファイルの中の位置（文字の index）。 */
export type ModuleReference = { specifier: string; start: number; end: number };

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

/**
 * text の中のモジュールの参照を、`ts.preProcessFile` で集める。
 * `obj.require("…")` のようなメンバーの呼び出しは require 関数ではないので除く。
 */
export function moduleReferences(text: string, offset = 0): ModuleReference[] {
  return ts
    .preProcessFile(text, true, true)
    .importedFiles.filter((f) => !/\.\s*require\s*\(\s*["'`]?$/.test(text.slice(0, f.pos)))
    .map((f) => ({ specifier: f.fileName, start: offset + f.pos, end: offset + f.end }));
}

/** JSDoc のコメント（`/** … *\/`）の中の、型の `import("…")`。 */
export function jsdocReferences(comments: readonly Comment[]): ModuleReference[] {
  return comments
    .filter((c) => c.type === "Block" && c.value.startsWith("*"))
    .flatMap((c) => moduleReferences(c.value, c.range[0] + 2));
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
    const check = ({ specifier, start, end }: ModuleReference) => {
      const to = resolveFromRoot(root, context.filename, specifier);
      if (to === null) return;
      const message = directionViolation(from, to);
      if (message === null) return;
      const loc = {
        start: sourceCode.getLocFromIndex(start),
        end: sourceCode.getLocFromIndex(end),
      };
      context.report({ loc, message: `${message}。向きは docs/tooling.md にある` });
    };
    // createRequire の戻り値を受けた名前（`const r = createRequire(import.meta.url)` の r）。
    const requireAliases = new Set<string>();
    return {
      Program() {
        moduleReferences(sourceCode.text).forEach(check);
        jsdocReferences(sourceCode.getAllComments()).forEach(check);
      },
      VariableDeclarator(node: Declarator) {
        const { id, init } = node;
        if (id?.type === "Identifier" && id.name && init?.type === "CallExpression")
          if (init.callee?.type === "Identifier" && init.callee.name === "createRequire")
            requireAliases.add(id.name);
      },
      CallExpression(node: Expr & { range: readonly [number, number] }) {
        const { callee } = node;
        if (callee?.type !== "Identifier" || !requireAliases.has(callee.name ?? "")) return;
        const arg = node.arguments?.[0];
        if (arg?.type !== "Literal" || typeof arg.value !== "string") return;
        check({ specifier: arg.value, start: node.range[0], end: node.range[1] });
      },
    };
  },
};
