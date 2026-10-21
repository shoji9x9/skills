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
import { isAbsolute, posix, relative, resolve, dirname, sep } from "node:path";
import { isRecord } from "../../../lib/guards.ts";

type SourceNode = { type: string; value?: unknown };
type ImportNode = { type: string; source?: SourceNode | null };
type CallNode = ImportNode & { callee?: { type: string; name?: string }; arguments?: SourceNode[] };

type Context = {
  filename: string;
  options: readonly unknown[];
  report: (d: { node: ImportNode; message: string }) => void;
};

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
    const check = (node: ImportNode, source = node.source) => {
      const specifier = source?.value;
      if (typeof specifier !== "string") return;
      const to = resolveFromRoot(root, context.filename, specifier);
      if (to === null) return;
      const message = directionViolation(from, to);
      if (message !== null)
        context.report({ node, message: `${message}。向きは docs/tooling.md にある` });
    };
    // require() は createRequire で作った関数でも名前が require なので、名前で拾う。
    const checkRequire = (node: CallNode) => {
      if (node.callee?.type !== "Identifier" || node.callee.name !== "require") return;
      check(node, node.arguments?.[0]);
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
      // 型だけの参照（`typeof import("…")`）も、型の検査ではファイルを読むので向きを当てる。
      TSImportType: check,
      CallExpression: checkRequire,
    };
  },
};
