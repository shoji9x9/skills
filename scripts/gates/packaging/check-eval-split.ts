#!/usr/bin/env node
// 配布スキルか、その eval を変えた変更で、そのスキルの evals.json に判定に使うケース（split: judge）が
// 1 件以上あるかを確かめる（lefthook pre-commit はステージしたファイル、CI の Lint ジョブは PR のベースとの差分）。
//
// なぜ要るか: 改善に使うケースと判定に使うケースの分け方（docs/skill-development.md「改善に使うケースと判定に使うケース」）は、
// 全スキルを一度に分けず、スキルを変えるときに少しずつ分ける。文書の取り決めだけだと、分けないままスキルを変えても
// 何も止めないので、分ける作業が進まない（Issue #1126 で利用者が求めた仕組み）。
// 変えたスキルだけを見るので、全体の走査はしない。変えていないスキルは、分けていなくても通す。
//
// 次の変更は、スキルを直したことにならないので対象にしない。
//   - ファイル全体を同じに保つ共通のコピー（scripts/gates/packaging/copies/identical-copies.json の region の無い組）。
//     1 つを直すと、組のすべてのスキルが変わる。それを理由に複数のスキルを一度に分けさせない。
//   - 同梱した設定の読み取り（scripts/skill-config/）と外部のコード（scripts/vendor/）。どちらも全スキルか複数のスキルの共通のコピーである。
//   - Dependabot の PR。CI のステップの条件で外す（.github/workflows/ci.yml）。依存の更新はスキルを直す変更ではない。
//
// pre-commit は変えたファイルを `check-eval-split.ts <path>...` で渡す。
// CI は `check-eval-split.ts --changed-since <ref>` で、<ref>...HEAD の差分を渡す。
// 終了コードは、0 が違反なし、1 が違反あり、2 が入力を決められない（引数が無い・差分を取れない・宣言を読めない）である。
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { errorMessage } from "../../lib/errors.ts";
import { isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";
import { runGit } from "../../lib/git.ts";
import { isCliEntry } from "../../lib/cli/entry.ts";
import { splitChangedSince } from "../../lib/cli/changed-since.ts";
import { evalSplitOf } from "../../lib/eval-split.ts";
import { type CopyGroup, loadGroups } from "./copies/check-identical-copies.ts";

/**
 * スキルの中で、複数のスキルが同じ中身を持つディレクトリ（`skills/<name>/` からの相対パスの接頭辞）。
 * 共通のコピーの組には、この下のファイルの一部（skill-config の vendor の下など）しか載っていないので、ディレクトリで外す。
 */
const SHARED_DIRS = ["scripts/skill-config/", "scripts/vendor/"];

/** 共通のコピーの組から、ファイル全体を同じに保つ組のファイルを集める。region を持つ組は、組の外の部分も持つので含めない。 */
export function wholeFileCopies(groups: readonly CopyGroup[]): Set<string> {
  return new Set(groups.filter((g) => g.region === undefined).flatMap((g) => g.files));
}

/**
 * 変えたファイルから、判定に使うケースを求めるスキルの名前を挙げる。
 * `skills/<name>/` の下のファイル（共通のコピーを除く）と `evals/<name>/evals.json` が当たる。
 */
export function skillsToCheck(paths: readonly string[], copies: ReadonlySet<string>): string[] {
  const names = new Set<string>();
  for (const path of paths) {
    const skill = /^skills\/([^/]+)\/(.+)$/u.exec(path);
    if (skill) {
      const [, name, rest] = skill;
      if (copies.has(path) || SHARED_DIRS.some((dir) => rest.startsWith(dir))) continue;
      names.add(name);
      continue;
    }
    const evals = /^evals\/([^/]+)\/evals\.json$/u.exec(path);
    if (evals) names.add(evals[1]);
  }
  return [...names].sort();
}

/** 1 つのスキルの evals.json を読み、判定に使うケースが無ければ違反の文を返す。 */
export function splitViolation(root: string, name: string): string | undefined {
  // スキルを消した変更（ディレクトリが無い）は、分ける対象が無いので通す。
  if (!statSync(join(root, "skills", name), { throwIfNoEntry: false })?.isDirectory()) {
    return undefined;
  }
  const file = join("evals", name, "evals.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, file), "utf8"));
  } catch (error) {
    return `${file}: 読めないので、判定に使うケースがあるかを確かめられない: ${errorMessage(error)}`;
  }
  if (!isRecord(parsed) || !isArray(parsed.evals)) {
    return `${file}: evals が配列でないので、判定に使うケースがあるかを確かめられない`;
  }
  if (parsed.evals.some((ev) => isRecord(ev) && evalSplitOf(ev) === "judge")) return undefined;
  return (
    `skills/${name}/ を変えたが、${file} に判定に使うケース（"split": "judge"）が無い。` +
    "直す部品を通る eval を選んで split に judge を書く（docs/skill-development.md「改善に使うケースと判定に使うケース」）"
  );
}

/** 引数から変えたファイルの一覧を決める。`--changed-since <ref>` は `<ref>...HEAD` の差分を取る。 */
function changedPaths(root: string, argv: readonly string[]): string[] {
  const { ref, rest } = splitChangedSince(argv.filter((a) => a !== "--"));
  if (ref === undefined) {
    if (rest.length === 0) {
      throw new Error("変えたファイルか --changed-since <ref> を渡す（全体の走査はしない）");
    }
    return rest;
  }
  if (rest.length > 0) {
    throw new Error(`--changed-since とファイルの指定は併用しない: ${rest.join(" ")}`);
  }
  const out = runGit(root, ["diff", "--name-only", "--no-renames", "-z", `${ref}...HEAD`], {
    what: `${ref} からの差分を取れない`,
  });
  return out.split("\0").filter(Boolean);
}

export function main(argv: readonly string[], root = process.cwd()): number {
  let names: string[];
  try {
    const copies = wholeFileCopies(loadGroups(root));
    names = skillsToCheck(changedPaths(root, argv), copies);
  } catch (error) {
    console.error(`eval-split: 実行できない: ${errorMessage(error)}`);
    return 2;
  }
  const violations = names.flatMap((name) => splitViolation(root, name) ?? []);
  if (violations.length > 0) {
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `eval-split: 変えたスキル ${names.length} 件のうち、${violations.length} 件に判定に使うケースが無い`,
    );
    return 1;
  }
  console.log(`eval-split: OK（変えたスキル ${names.length} 件）`);
  return 0;
}

if (isCliEntry(import.meta.url)) process.exitCode = main(process.argv.slice(2));
