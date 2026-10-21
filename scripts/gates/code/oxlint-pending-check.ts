// 後で直す違反の一覧（oxlint-pending.ts）を、どの範囲で検査し直すかを決める（Issue #658）。
//
// 一覧と実際の違反は、2 つの向きでずれる。直したのに一覧に残った組（古い組）と、直さずに一覧から消した組（一覧に無い違反）である。
// 検査する範囲は、staged のファイルから決める。
// - ルールの判定か一覧の外し方を変えるファイル（oxlint.config.ts とプラグインから import をたどったファイルと、oxlint の版を決めるファイル）
//   が staged なら、リポジトリ全体を検査する。一覧から組を消しただけの commit も、ここに当たる。
// - そうでなければ、一覧と staged が重なるファイルだけを検査する。関数の大きさのルールはファイルごとに判定するので、
//   staged でないファイルの組はずれない。
// - どちらにも当たらなければ、検査しない。
// pre-commit は、このファイルを CLI として起動し、出力が空なら vitest を起動しない。
import { readFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import ts from "typescript";
import { PENDING_FIXES, type PendingRule } from "./oxlint-pending.ts";

/**
 * ルールの判定と、一覧との突き合わせの結果を決めるファイルの起点。ここから相対 import をたどる。
 * 設定とプラグインに加えて、診断を読む run-oxlint.ts と範囲を決めるこのファイルを起点にする。
 * 突き合わせのテスト自身はテストの補助（lib/testing/）も import するので、起点にしない（関係の無い commit でも全体を検査してしまう）。
 */
export const SOURCE_ENTRIES = [
  "oxlint.config.ts",
  "scripts/gates/code/oxlint-plugin/plugin.ts",
  "scripts/gates/code/oxlint-plugin/run-oxlint.ts",
  "scripts/gates/code/oxlint-pending-check.ts",
];
/** oxlint と依存の版を決めるファイル。 */
export const VERSION_FILES = ["package.json", "pnpm-lock.yaml"];

/** root からのパスの entries から、相対 import をたどって集めたファイル（`/` 区切り）。 */
export function importClosure(root: string, entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    // 解決できない import（拡張子を省いたものなど）は、判定できないので例外にする。oxlint の設定も読めない状態である。
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch (error) {
      throw new Error(`oxlint-pending-check: import をたどれない（${file}）: ${String(error)}`);
    }
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles)
      if (fileName.startsWith("."))
        queue.push(
          normalize(join(dirname(file), fileName))
            .split(sep)
            .join("/"),
        );
  }
  return seen;
}

/** 検査し直すきっかけになるファイル（import をたどったファイルと、版を決めるファイル）。 */
export function pendingSources(root: string): Set<string> {
  return new Set([...importClosure(root, SOURCE_ENTRIES), ...VERSION_FILES]);
}

/** 検査する範囲。all はリポジトリ全体、files は一覧のファイルのうち staged と重なるもの。 */
export type CheckPlan = { mode: "all" } | { mode: "files"; files: string[] } | { mode: "none" };

/** CLI の出力（all か、ファイルの一覧か、空）を、範囲に戻す。 */
export function parsePlan(output: string): CheckPlan {
  const lines = output.split("\n").filter((l) => l !== "");
  if (lines.length === 0) return { mode: "none" };
  return lines.length === 1 && lines[0] === "all"
    ? { mode: "all" }
    : { mode: "files", files: lines };
}

/** staged（null ならすべてを検査する）から、検査する範囲を決める。 */
export function checkPlan(
  pending: Readonly<Record<string, readonly PendingRule[]>>,
  staged: readonly string[] | null,
  sources: ReadonlySet<string>,
): CheckPlan {
  if (staged === null || staged.some((f) => sources.has(f))) return { mode: "all" };
  const files = Object.keys(pending).filter((f) => staged.includes(f));
  return files.length > 0 ? { mode: "files", files } : { mode: "none" };
}

// pre-commit から起動する。stdin に staged のファイル（削除を含む）を 1 行に 1 つ受け取り、
// 検査するなら範囲（all か、ファイルの一覧）を出し、検査しないなら何も出さない。
// pre-commit はこの出力を OXLINT_PENDING_PLAN でテストに渡し、テストは範囲を求め直さない。
if (import.meta.main) {
  const staged = readFileSync(0, "utf8")
    .split("\n")
    .filter((f) => f !== "");
  const root = join(import.meta.dirname, "../../..");
  const plan = checkPlan(PENDING_FIXES, staged, pendingSources(root));
  if (plan.mode === "all") console.log("all");
  if (plan.mode === "files") for (const file of plan.files) console.log(file);
}
