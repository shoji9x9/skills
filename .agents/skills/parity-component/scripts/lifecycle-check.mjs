#!/usr/bin/env node
// 部品の一生の順番で不具合が起きる実行パスの記録（build-metadata.json の lifecycle）を検査する（検査の仕方はこのスクリプトで定義する）。
//
// 何のためか: 見本の照合・操作の突き合わせ・パリティスイートは毎回同じ順で部品を描く。そのため、結び直し・引数の差し替え・
// 付け直し・初期化の後の変化で起きる不具合を、一度も通らない。build はこの実行パスを判定し、順番を強制する見本で確かめる。
// しかし、記録を文章の規律だけに任せると、実行パスを警告なしに除いた記録でも完了できてしまう。
// 例えば、4 つの実行パスのどれにも振り分けていない記録、検査が無い記録、実行パスに入っていない記録である。
// この検査は、記録の形と完了の条件を機械的に確かめる。
//
// lifecycle.applies が true のときは、次のものを判定する。
//   - paths[].path と not_applicable_paths[].path の和が、4 つの実行パス（PATHS）をちょうど 1 回ずつ含む（抜け・重複・語彙の外を失敗にする）
//   - paths は 1 件以上（名指しできる実行パスが 1 つも無いなら対象ではないので、applies: false にする）
//   - paths の各行: breaking_process / story / entry_attribute / check が記入済み、result が pass、
//     entered が 1 以上の整数、fix_removal_verified が true
//   - not_applicable_paths の各行: reason が記入済み
// applies が false のときは paths が空であること（対象でないのに検査の見本を置くと、照合されない見本がカタログに残る）。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON だけで、見本も検査も実行しない
// （検査の実行と結果の記録は build の手順で行う。この検査は、記録が条件を満たすかだけを見る）。
//
// 使い方: node lifecycle-check.mjs --build-metadata <new/<target>/build-metadata.json>
// 終了コード: 0 ＝ 条件を満たす（対象でない場合を含む）、1 ＝ 不足が残る、2 ＝ 使い方の誤り・型崩れ。

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";

import { cliIo, usageFailer, writeCheckResult } from "./lib/check-cli.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { field, filled, isObjectLike, isPlainObject, nonEmptyString } from "./lib/guards.mjs";

/** ツールのバージョン（このスクリプトで定義する）。判定の規則・出力の形を変えたら上げる。 */
export const VERSION = "1";

/** 4 つの実行パスの語彙（このスクリプトで定義する。references/lifecycle.md「4 つの実行パス」と同じ）。 */
export const PATHS = ["strict-rebind", "prop-identity", "remount", "prop-change-after-init"];

/**
 * 検査の指摘 1 件。code は必ずあり、ほかの欄は code ごとに付く。
 * @typedef {{
 *   code: string,
 *   detail?: string,
 *   where?: string,
 *   path?: unknown,
 *   missing?: string[],
 *   story?: string,
 *   count?: number,
 * }} LifecycleFinding
 */

/**
 * 型崩れの結果を作る。
 * @param {string} detail
 * @returns {{ structural: true, applies: null, findings: LifecycleFinding[] }}
 */
function structuralResult(detail) {
  return { structural: true, applies: null, findings: [{ code: "structural", detail }] };
}

/**
 * build-metadata.json から lifecycle の記録と見た目の見本の集合を読む。形が誤っていれば detail だけを返す。
 * @param {unknown} metadata
 * @returns {{ detail: string } | {
 *   detail?: undefined,
 *   applies: boolean,
 *   paths: unknown[],
 *   notApplicable: unknown[],
 *   visualStories: Set<string>,
 * }}
 */
function readLifecycleInput(metadata) {
  const lifecycle = field(metadata, "lifecycle");
  const catalogStories = field(field(metadata, "catalog"), "stories");
  if (!isPlainObject(lifecycle)) {
    return { detail: "build-metadata.json の lifecycle が無い（対象かどうかを判定していない）" };
  }
  if (typeof lifecycle.applies !== "boolean") {
    return { detail: "lifecycle.applies が真偽値でない（テンプレートのプレースホルダのまま等）" };
  }
  if (!filled(lifecycle.reason)) {
    return { detail: "lifecycle.reason が空かプレースホルダのまま（判定の根拠が無い）" };
  }
  const paths = lifecycle.paths;
  const notApplicable = lifecycle.not_applicable_paths;
  if (!isArray(paths) || !isArray(notApplicable)) {
    return { detail: "lifecycle.paths / not_applicable_paths が配列でない" };
  }
  if (!isArray(catalogStories)) {
    return {
      detail:
        "catalog.stories が配列でない（順番の見本と見た目の見本の対応表を突き合わせられない）",
    };
  }
  const visualStories = new Set(
    catalogStories.map((row) => field(row, "story")).filter(nonEmptyString),
  );
  return { applies: lifecycle.applies, paths, notApplicable, visualStories };
}

/** @typedef {string & { readonly __lifecyclePathName: true }} LifecyclePathName 語彙（PATHS）の中の実行パスの名前。 */

/**
 * 実行パスの名前を語彙と照らし、出現回数を数える関数を作る。語彙の外の名前は findings に積んで false を返す。
 * @param {LifecycleFinding[]} findings
 * @returns {{ count: (name: unknown, where: string) => name is LifecyclePathName, seen: Map<string, number> }}
 */
function createPathCounter(findings) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  /**
   * @param {unknown} name
   * @param {string} where
   * @returns {name is LifecyclePathName}
   */
  const count = (name, where) => {
    if (typeof name !== "string" || !nonEmptyString(name) || !PATHS.includes(name)) {
      findings.push({
        code: "lifecycle-path-unknown",
        where,
        path: name ?? null,
        detail: `path は ${PATHS.join(" / ")} のいずれか`,
      });
      return false;
    }
    seen.set(name, (seen.get(name) ?? 0) + 1);
    return true;
  };
  return { count, seen };
}

/**
 * paths の 1 行（実行パスの名前は語彙の中）を検査し、不足を findings に積む。
 * @param {{
 *   row: Record<string, unknown>,
 *   name: string,
 *   visualStories: Set<string>,
 *   findings: LifecycleFinding[],
 * }} args
 */
function checkPathRow({ row, name, visualStories, findings }) {
  const missing = ["breaking_process", "story", "entry_attribute", "check"].filter(
    (key) => !filled(row[key]),
  );
  if (missing.length > 0) {
    findings.push({ code: "lifecycle-path-incomplete", path: name, missing });
  }
  if (row.result !== "pass") {
    findings.push({
      code: "lifecycle-path-failed",
      path: name,
      detail: `result が pass でない: ${JSON.stringify(row.result)}`,
    });
  }
  // Number.isInteger が真なら数なので、typeof は型を絞るためだけにある（判定は変わらない）。
  if (typeof row.entered !== "number" || !Number.isInteger(row.entered) || row.entered < 1) {
    findings.push({
      code: "lifecycle-path-not-entered",
      path: name,
      detail: `entered が 1 以上の整数でない: ${JSON.stringify(row.entered)}（実行パスに入らないまま症状だけを見た検査は何も示さない）`,
    });
  }
  if (nonEmptyString(row.story) && visualStories.has(row.story)) {
    findings.push({
      code: "lifecycle-story-in-catalog",
      path: name,
      story: row.story,
      detail: "順番の見本が catalog.stories（見た目の照合の対応表）にも載っている",
    });
  }
  if (row.fix_removal_verified !== true) {
    findings.push({
      code: "lifecycle-fix-removal-unverified",
      path: name,
      detail: "直した処理を外すとこの検査だけが落ちることを確かめていない",
    });
  }
}

/**
 * 4 つの実行パスがちょうど 1 回ずつ振り分けられているかを検査し、抜けと重複を findings に積む。
 * @param {Map<string, number>} seen
 * @param {LifecycleFinding[]} findings
 */
function checkPathCoverage(seen, findings) {
  for (const name of PATHS) {
    const n = seen.get(name) ?? 0;
    if (n === 0) {
      findings.push({
        code: "lifecycle-path-missing",
        path: name,
        detail: "paths にも not_applicable_paths にも無い（実行パスを警告なしに除かない）",
      });
    } else if (n > 1) {
      findings.push({ code: "lifecycle-path-duplicate", path: name, count: n });
    }
  }
}

/**
 * build-metadata.json の lifecycle の記録を検査する（純関数）。lifecycle だけでなく catalog.stories も読む。
 * 順番の見本が見た目の照合の対応表にも載っていると、見た目の見本がすり替わっても検査が通るためである。
 * @param {unknown} metadata build-metadata.json の中身（形はここで検査する）
 * @returns {{ structural: boolean, applies: boolean | null, findings: LifecycleFinding[] }}
 */
export function checkLifecycle(metadata) {
  const input = readLifecycleInput(metadata);
  if (input.detail !== undefined) return structuralResult(input.detail);
  const { paths, notApplicable, visualStories } = input;
  /** @type {LifecycleFinding[]} */
  const findings = [];
  if (!input.applies) {
    if (paths.length > 0) {
      findings.push({
        code: "lifecycle-paths-when-not-applicable",
        detail:
          "対象でない（applies: false）のに paths がある（照合されない順番の見本がカタログに残る）",
      });
    }
    return { structural: false, applies: false, findings };
  }
  if (paths.length === 0) {
    findings.push({
      code: "lifecycle-no-paths",
      detail:
        "対象（applies: true）なのに名指しできた実行パスが 0 件（名指しできないなら対象ではない）",
    });
  }
  const { count, seen } = createPathCounter(findings);
  for (const row of paths) {
    const name = field(row, "path");
    // count を通れば path は語彙の文字列なので row はオブジェクトである。isObjectLike は型を絞るためだけにある（判定は変わらない）。
    if (!count(name, "paths") || !isObjectLike(row)) continue;
    checkPathRow({ row, name, visualStories, findings });
  }
  for (const row of notApplicable) {
    const name = field(row, "path");
    if (!count(name, "not_applicable_paths") || !isObjectLike(row)) continue;
    if (!filled(row.reason)) {
      findings.push({
        code: "lifecycle-na-reason-missing",
        path: name,
        detail: "名指しできない理由が空かプレースホルダのまま",
      });
    }
  }
  checkPathCoverage(seen, findings);
  return { structural: false, applies: true, findings };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [io]
 * @returns {number} 終了コード
 */
export function main(argv, io = {}) {
  const { cwd, write, writeErr } = cliIo(io);
  const fail = usageFailer(
    writeErr,
    "usage: lifecycle-check.mjs --build-metadata <new/<target>/build-metadata.json>",
  );
  if (argv.length !== 2 || argv[0] !== "--build-metadata") {
    return fail(argv.length === 0 ? "--build-metadata は必須" : `不明な引数: ${argv.join(" ")}`);
  }
  if (!nonEmptyString(argv[1])) return fail("--build-metadata は必須（空白だけの値も不可）");
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(resolve(cwd, argv[1]), "utf8"));
  } catch (error) {
    return fail(`build-metadata.json を読めない: ${String(field(error, "message"))}`);
  }
  const result = checkLifecycle(metadata);
  return writeCheckResult(write, result, {
    tool: "lifecycle-check",
    version: VERSION,
    fields: { applies: result.applies },
  });
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
