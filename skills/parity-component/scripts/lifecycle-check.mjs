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

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 記入済みかの判定は behavior-compare.mjs と同じものを使う（実パスに解決したディレクトリから読む。
// シンボリックリンク経由で --preserve-symlinks-main 起動されても兄弟ファイルを見つけられるように）。
const { filled, nonEmptyString } = await import(
  pathToFileURL(join(dirname(realpathSync(fileURLToPath(import.meta.url))), "behavior-compare.mjs"))
    .href
);

/** ツールのバージョン（このスクリプトで定義する）。判定の規則・出力の形を変えたら上げる。 */
export const VERSION = "1";

/** 4 つの実行パスの語彙（このスクリプトで定義する。references/lifecycle.md「4 つの実行パス」と同じ）。 */
export const PATHS = ["strict-rebind", "prop-identity", "remount", "prop-change-after-init"];

/**
 * build-metadata.json の lifecycle の記録を検査する（純関数）。lifecycle だけでなく catalog.stories も読む——
 * 順番の見本が見た目の照合の対応表にも載っていると、見た目の見本がすり替わっても検査が通るため。
 * @param {any} metadata build-metadata.json の中身
 * @returns {{ structural: boolean, applies: boolean | null, findings: object[] }}
 */
export function checkLifecycle(metadata) {
  const lifecycle = metadata && metadata.lifecycle;
  const catalogStories = metadata && metadata.catalog && metadata.catalog.stories;
  /** @type {object[]} */
  const findings = [];
  const structural = (detail) => ({
    structural: true,
    applies: null,
    findings: [{ code: "structural", detail }],
  });
  if (lifecycle === null || typeof lifecycle !== "object" || Array.isArray(lifecycle)) {
    return structural("build-metadata.json の lifecycle が無い（対象かどうかを判定していない）");
  }
  if (typeof lifecycle.applies !== "boolean") {
    return structural("lifecycle.applies が真偽値でない（テンプレートのプレースホルダのまま等）");
  }
  if (!filled(lifecycle.reason)) {
    return structural("lifecycle.reason が空かプレースホルダのまま（判定の根拠が無い）");
  }
  const paths = lifecycle.paths;
  const notApplicable = lifecycle.not_applicable_paths;
  if (!Array.isArray(paths) || !Array.isArray(notApplicable)) {
    return structural("lifecycle.paths / not_applicable_paths が配列でない");
  }
  if (!Array.isArray(catalogStories)) {
    return structural(
      "catalog.stories が配列でない（順番の見本と見た目の見本の対応表を突き合わせられない）",
    );
  }
  const visualStories = new Set(
    catalogStories.map((row) => row && row.story).filter(nonEmptyString),
  );
  if (!lifecycle.applies) {
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
  /** @type {Map<string, number>} */
  const seen = new Map();
  const count = (name, where) => {
    if (!nonEmptyString(name) || !PATHS.includes(name)) {
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
  for (const row of paths) {
    const name = row && row.path;
    if (!count(name, "paths")) continue;
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
    if (!Number.isInteger(row.entered) || row.entered < 1) {
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
  for (const row of notApplicable) {
    const name = row && row.path;
    if (!count(name, "not_applicable_paths")) continue;
    if (!filled(row.reason)) {
      findings.push({
        code: "lifecycle-na-reason-missing",
        path: name,
        detail: "名指しできない理由が空かプレースホルダのまま",
      });
    }
  }
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
  return { structural: false, applies: true, findings };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [io]
 * @returns {number} 終了コード
 */
export function main(
  argv,
  {
    cwd = process.cwd(),
    write = (s) => process.stdout.write(s),
    writeErr = (s) => process.stderr.write(s),
  } = {},
) {
  const out = (obj) =>
    write(`${JSON.stringify({ tool: "lifecycle-check", version: VERSION, ...obj }, null, 2)}\n`);
  const usage = "usage: lifecycle-check.mjs --build-metadata <new/<target>/build-metadata.json>";
  const fail = (message) => {
    writeErr(`error: ${message}\n${usage}\n`);
    return 2;
  };
  if (argv.length !== 2 || argv[0] !== "--build-metadata") {
    return fail(argv.length === 0 ? "--build-metadata は必須" : `不明な引数: ${argv.join(" ")}`);
  }
  if (!nonEmptyString(argv[1])) return fail("--build-metadata は必須（空白だけの値も不可）");
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(resolve(cwd, argv[1]), "utf8"));
  } catch (error) {
    return fail(`build-metadata.json を読めない: ${error && error.message}`);
  }
  const result = checkLifecycle(metadata);
  if (result.structural) {
    out({ ok: false, structural: true, findings: result.findings });
    return 2;
  }
  out({ ok: result.findings.length === 0, applies: result.applies, findings: result.findings });
  return result.findings.length === 0 ? 0 : 1;
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動でサイレント no-op にしない）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  process.exitCode = main(process.argv.slice(2));
}
