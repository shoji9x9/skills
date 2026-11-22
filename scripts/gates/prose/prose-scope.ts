// PR の文章チェック（lint-prose）で見るファイルを、ベースとの差分から決める（Issue #1108）。
//
// なぜ絞れるか: textlint の規則はファイルごとに独立している。1 つのファイルの結果は、そのファイルの内容とパスと
// 検査の側の一式（下の INPUT_FILES と、lint-prose.ts が相対パスで import するコード）だけで決まる。
// main に入るものはすべて PR の検査を通るので、PR で変えていないファイルは、一式が同じなら main と同じく指摘が出ない。
//
// 全件を見るのは次のときである。
// - 一式のどれかが変わった（辞書・設定・パッケージやツールのバージョン・lint-prose.ts とその import 先）
// - 差分を取れない（ref が無い・git を起動できない）。0 件と区別できないので、絞った結果を使わない
// - import 先を読めない
// 一式に入っていない入力（実行時に読むファイルを後から足した場合など）の変更は、週次の全件の実行
// （.github/workflows/prose-lint.yml）が拾う。
//
// 変えていないのに対象かどうかが変わるファイルもある。`skills/<name>/` を消すと、`.agents/skills/<name>/` は
// コピーから private skill の実体に変わり、見る対象に入る（判定は scripts/lib/source-scope.ts）。
// そのため、消えた `skills/<name>/` に当たる `.agents/skills/<name>/` のファイルも見る。
// 逆の向き（`skills/<name>/` を足して実体がコピーになる）は、見るファイルが減るだけなので扱わない。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { errorMessage } from "../../lib/errors.ts";

/** 検査の結果を変える、コード以外の入力（リポジトリのルートからのパス）。 */
export const INPUT_FILES = [
  // textlint の設定と、使わない語の辞書
  ".textlintrc.json",
  ".textlint/words.json",
  // textlint と規則のパッケージ、コメントを取り出す typescript のバージョン
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  // Node.js と、シェルのコメントを取り出す shfmt のバージョン
  "mise.toml",
  "mise.lock",
];

/** 検査の起点（import をたどり始めるファイル）。 */
export const ENTRY = "scripts/gates/prose/lint-prose.ts";

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export type ProseScope =
  | { kind: "full"; reason: string }
  | { kind: "changed"; files: string[]; reason: string };

/**
 * `ref...HEAD` の差分から、見るファイルを決める。
 * root は差分を取るリポジトリ、toolRoot は lint-prose.ts の場所（テストでは実リポジトリ）。
 */
export function proseScope(root: string, ref: string, toolRoot = TOOL_ROOT): ProseScope {
  const changed = changedPaths(root, ref);
  if (typeof changed === "string") return { kind: "full", reason: changed };
  const inputs = toolInputs(toolRoot);
  if (typeof inputs === "string") return { kind: "full", reason: inputs };
  const hit = changed.find((p) => inputs.has(p));
  if (hit !== undefined) return { kind: "full", reason: `検査の側の一式（${hit}）が変わった` };
  const promoted = promotedCopies(root, changed);
  if (typeof promoted === "string") return { kind: "full", reason: promoted };
  const files = [...new Set([...changed, ...promoted])].sort();
  return { kind: "changed", files, reason: `${ref}...HEAD で変わった ${changed.length} 件のパス` };
}

/** `ref...HEAD` で変わったパス（消したものと、名前を変える前のパスを含む）。取れなければ理由を返す。 */
function changedPaths(root: string, ref: string): string[] | string {
  const res = spawnSync("git", ["diff", "--name-only", "--no-renames", "-z", `${ref}...HEAD`], {
    cwd: root,
    encoding: "utf8",
  });
  if (res.error) return `git を起動できない: ${res.error.message}`;
  if (res.status !== 0)
    return `${ref} からの差分を取れない（git diff exit ${String(res.status)}）: ${res.stderr.trim()}`;
  return res.stdout.split("\0").filter(Boolean);
}

/** INPUT_FILES と、ENTRY から相対パスの import を間接のものまでたどった `.ts`。たどれなければ理由を返す。 */
function toolInputs(toolRoot: string): Set<string> | string {
  const seen = new Set<string>([ENTRY]);
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.pop() ?? "";
    let source: string;
    try {
      source = readFileSync(join(toolRoot, file), "utf8");
    } catch (error) {
      return `${file} を読めないので、検査の側のコードを決められない: ${errorMessage(error)}`;
    }
    for (const next of relativeImports(file, source, toolRoot)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return new Set([...INPUT_FILES, ...seen]);
}

/** file が相対パスで import する `.ts`（toolRoot からのパス）。 */
// import の指定子は TypeScript の構文の解析で取る（コメントや文字列の中の `from "..."` を数えない）。
function relativeImports(file: string, source: string, toolRoot: string): string[] {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map(({ fileName }) => fileName)
    .filter((name) => name.startsWith(".") && name.endsWith(".ts"))
    .map((name) =>
      relative(toolRoot, resolve(toolRoot, dirname(file), name))
        .split(sep)
        .join("/"),
    );
}

/** 差分で `skills/<name>/` が無くなったスキルについて、`.agents/skills/<name>/` の tracked のファイル。取れなければ理由を返す。 */
function promotedCopies(root: string, changed: string[]): string[] | string {
  const removed = new Set(
    changed
      .map((p) => /^skills\/([^/]+)\//.exec(p)?.[1])
      .filter(
        (name): name is string => name !== undefined && !existsSync(join(root, "skills", name)),
      ),
  );
  if (removed.size === 0) return [];
  const res = spawnSync(
    "git",
    ["ls-files", "-z", "--", ...[...removed].map((n) => `.agents/skills/${n}/`)],
    { cwd: root, encoding: "utf8" },
  );
  if (res.error) return `git を起動できない: ${res.error.message}`;
  if (res.status !== 0) {
    return `消したスキルのコピーを一覧にできない（git ls-files exit ${String(res.status)}）: ${res.stderr.trim()}`;
  }
  return res.stdout.split("\0").filter(Boolean);
}
