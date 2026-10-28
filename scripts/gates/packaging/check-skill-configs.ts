#!/usr/bin/env node
// このリポジトリのスキルの設定（.config/skills/shoji9x9/*.jsonc）が、各スキルのスキーマに合うかをチェックする（lefthook pre-commit + CI）。
//
// なぜ要るか: 設定はスキルを実行したときに初めて読まれる。知らないキーや型の誤りを commit しても、
// そのスキルを使うまで誰も気付かない。
//
// 判定規則:
// - 各スキルの config-schemas/*.schema.json を、配布スキルの読み取り（skill-config.mjs）と同じ方法で読む。
//   読めないスキーマは違反にする。
// - .config/skills/shoji9x9/ の <名前>.jsonc はリポジトリの層、<名前>.local.jsonc は人ごと・リポジトリ限定の層として検証する。
//   .local.jsonc は commit しないので CI には無いが、手元の pre-commit では確かめる。
// - どのスキルもスキーマを持たない名前のファイルと、.jsonc でないファイル（旧い skills.yml など）は違反にする。
// - 設定ファイルが 0 件か、スキーマが 0 件なら exit 2（対象 0 件を合格として扱わない）。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { errorMessage } from "../../lib/errors.ts";
// 読み取りは設定を読むスキルがすべて同じ内容で持つ（identical-copies.json の組）ので、どのコピーを使っても同じ結果になる。
import {
  ConfigError,
  NAMESPACE,
  loadSchema,
  readLayer,
} from "../../../skills/kaizen/scripts/skill-config/skill-config.mjs";
import { isCliEntry } from "../../lib/cli/entry.ts";

export type Finding = { path: string; message: string };

/** 全スキルの config-schemas/ のファイル。name は `<名前>.schema.json` の名前で、その形でなければ null。 */
type SchemaFile = { skill: string; dir: string; file: string; name: string | null };

function schemaFiles(root: string): SchemaFile[] {
  const skills = join(root, "skills");
  return readdirSync(skills)
    .sort()
    .flatMap((skill) => {
      const dir = join(skills, skill, "config-schemas");
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .sort()
        .map((file) => ({
          skill,
          dir,
          file,
          name: /^(.+)\.schema\.json$/.exec(file)?.[1] ?? null,
        }));
    });
}

/** 設定の名前 → スキーマを持つスキルのディレクトリ（最初に見つかったもの）。 */
export function schemaDirs(
  root: string,
  files: readonly SchemaFile[] = schemaFiles(root),
): Map<string, string> {
  const out = new Map<string, string>();
  for (const { dir, name } of files) if (name !== null && !out.has(name)) out.set(name, dir);
  return out;
}

/**
 * スキーマそのものを、全スキルの全ファイルについて読めるか確かめる（コピーの一致は identical-copies が見る）。
 * @returns 読んだスキーマの数
 */
function checkSchemas(files: readonly SchemaFile[], findings: Finding[]): number {
  let schemas = 0;
  for (const { skill, dir, file, name } of files) {
    const path = `skills/${skill}/config-schemas/${file}`;
    if (name === null) {
      findings.push({ path, message: "<名前>.schema.json の形でない" });
      continue;
    }
    schemas++;
    try {
      loadSchema(dir, name);
    } catch (e) {
      findings.push({ path, message: errorMessage(e) });
    }
  }
  return schemas;
}

/**
 * .config/skills/<owner>/ の設定ファイルを、対応するスキーマで読めるか確かめる。
 * @returns 名前の形が正しい設定ファイルの数
 */
function checkConfigFiles(root: string, dirs: Map<string, string>, findings: Finding[]): number {
  const configDir = join(root, ".config", "skills", NAMESPACE);
  let files = 0;
  for (const f of existsSync(configDir) ? readdirSync(configDir).sort() : []) {
    const rel = `.config/skills/${NAMESPACE}/${f}`;
    const m = /^([a-z0-9][a-z0-9-]*?)(\.local)?\.jsonc$/.exec(f);
    if (!m) {
      findings.push({
        path: rel,
        message:
          "<名前>.jsonc か <名前>.local.jsonc でない（旧い skills.yml なら、スキルごとの .jsonc に移して消す）",
      });
      continue;
    }
    files++;
    const dir = dirs.get(m[1]);
    if (dir === undefined) {
      findings.push({
        path: rel,
        message: `${m[1]} のスキーマを持つスキルが無い（skills/*/config-schemas/${m[1]}.schema.json）`,
      });
      continue;
    }
    try {
      readLayer(loadSchema(dir, m[1]), m[2] ? "local" : "repo", join(configDir, f));
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      findings.push({ path: rel, message: e.message });
    }
  }
  return files;
}

/** 違反を列挙する。 */
export function check(root: string): { findings: Finding[]; files: number; schemas: number } {
  const findings: Finding[] = [];
  const schemaList = schemaFiles(root);
  const dirs = schemaDirs(root, schemaList);
  const schemas = checkSchemas(schemaList, findings);
  const files = checkConfigFiles(root, dirs, findings);
  return { findings, files, schemas };
}

export function main(root: string = join(import.meta.dirname, "../../..")): number {
  let result: ReturnType<typeof check>;
  try {
    result = check(root);
  } catch (e) {
    process.stderr.write(`check-skill-configs: ${errorMessage(e)}\n`);
    return 2;
  }
  for (const f of result.findings) process.stderr.write(`${f.path}: ${f.message}\n`);
  if (result.findings.length > 0) return 1;
  if (result.files === 0 || result.schemas === 0) {
    process.stderr.write(
      `check-skill-configs: 設定ファイル ${result.files} 件・スキーマ ${result.schemas} 件（0 件を合格として扱わない）\n`,
    );
    return 2;
  }
  process.stdout.write(
    `check-skill-configs: OK（設定ファイル ${result.files} 件・スキーマ ${result.schemas} 件）\n`,
  );
  return 0;
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = main();
}
