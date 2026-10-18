#!/usr/bin/env node
// 配布スキルに同梱する設定の読み取り（scripts/skill-config/）が、原本と一致しているかをチェックする（lefthook pre-commit + CI）。
//
// なぜ要るか: 配布スキルは利用者のプロジェクトに依存を install できないので、JSONC のパーサ（jsonc-parser）を
// スキルごとに同梱する。同梱物を手で直したり、devDependency の版を上げて作り直し忘れたりすると、
// スキルごとに読み方が食い違うか、原本と違うコードを配ることになる。
//
// 判定規則:
// - 設定のスキーマ（skills/<name>/config-schemas/）を持つスキルは、読み取りと、同梱したパーサの 3 つを持つ。
//   読み取りは scripts/skill-config/skill-config.mjs で、同じ内容であることは identical-copies.json の組が確かめる。
//   パーサは scripts/skill-config/vendor/ の jsonc-parser.mjs・jsonc-parser.d.mts・LICENSE.md である。
// - vendor/ の 3 つは、devDependency の jsonc-parser から作った内容とバイト単位で一致する。
//   jsonc-parser.mjs は esbuild で 1 ファイルにまとめたもの、jsonc-parser.d.mts は lib/esm/main.d.ts、
//   LICENSE.md は jsonc-parser の LICENSE.md である。
// - スキーマを持たないスキルが scripts/skill-config/ を持つのも違反にする（使われない同梱物を配らない）。
// - スキーマを持つスキルは references/config-files.md（設定ファイルの共通の文書）も持つ。
// - 複数のスキルが同じ内容で持つファイル（読み取り・config-files.md・同じ名前のスキーマ）は、持つスキルのすべてのパスが
//   identical-copies.json の 1 つの組に載っている。内容の比較はその組が行う。組に足し忘れたコピーは比べられないので、ここで挙げる。
// - スキーマを持つスキルが 0 件なら exit 2（対象 0 件を合格として扱わない）。
// - `--fix` を付けると、vendor/ の 3 つを作り直して書く。読み取り（skill-config.mjs）は手で直す。
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { errorMessage } from "../../lib/errors.ts";
import { isArray } from "../../lib/is-array.ts";

export const SCHEMA_DIR = "config-schemas";
export const READER = "scripts/skill-config/skill-config.mjs";
export const VENDOR_DIR = "scripts/skill-config/vendor";
export const VENDOR_FILES = ["jsonc-parser.mjs", "jsonc-parser.d.mts", "LICENSE.md"] as const;
export const SHARED_DOC = "references/config-files.md";
export const COPIES_CONFIG = "scripts/gates/packaging/copies/identical-copies.json";

/** identical-copies.json の組（ファイルのパスの一覧）。 */
export function copyGroups(root: string): string[][] {
  const raw: unknown = JSON.parse(readFileSync(join(root, COPIES_CONFIG), "utf8"));
  const groups =
    typeof raw === "object" && raw !== null && "groups" in raw ? raw.groups : undefined;
  if (!isArray(groups)) throw new Error(`${COPIES_CONFIG}: groups が配列でない`);
  return groups.map((g: unknown, i) => {
    const files = typeof g === "object" && g !== null && "files" in g ? g.files : undefined;
    if (!isArray(files) || !files.every((f) => typeof f === "string"))
      throw new Error(`${COPIES_CONFIG}: groups[${i}].files が文字列の配列でない`);
    return files;
  });
}

/** paths のすべてが 1 つの組に載っていなければ、載っていないパスを挙げる。 */
export function missingFromGroup(paths: string[], groups: string[][], what: string): Finding[] {
  if (paths.length < 2) return [];
  const best = groups
    .map((files) => ({ files, hit: paths.filter((p) => files.includes(p)).length }))
    .sort((a, b) => b.hit - a.hit)[0];
  const inGroup = best === undefined || best.hit === 0 ? [] : best.files;
  return paths
    .filter((p) => !inGroup.includes(p))
    .map((p) => ({
      path: p,
      message: `${COPIES_CONFIG} の${what}の組に無い（同じ内容であることを比べられない。組に足す）`,
    }));
}

/** jsonc-parser のパッケージのディレクトリと版。 */
export function jsoncParserPackage(root: string): { dir: string; version: string } {
  const require = createRequire(join(root, "package.json"));
  const pkgJson = require.resolve("jsonc-parser/package.json");
  const pkg: unknown = JSON.parse(readFileSync(pkgJson, "utf8"));
  const version =
    typeof pkg === "object" && pkg !== null && "version" in pkg ? pkg.version : undefined;
  if (typeof version !== "string") throw new Error(`${pkgJson}: version が無い`);
  return { dir: dirname(pkgJson), version };
}

/** vendor/ の 3 つの内容を作る。 */
export async function renderVendor(
  root: string,
): Promise<Record<(typeof VENDOR_FILES)[number], string>> {
  const { dir, version } = jsoncParserPackage(root);
  const result = await build({
    stdin: { contents: 'export * from "jsonc-parser";\n', resolveDir: root, loader: "js" },
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    legalComments: "inline",
    write: false,
    logLevel: "silent",
  });
  const out = result.outputFiles[0];
  if (out === undefined) throw new Error("esbuild の出力が無い");
  // esbuild が書く出所のコメントは node_modules の実パス（pnpm の版を含む）なので、手元と CI で同じになる
  const header = [
    `// jsonc-parser ${version}（MIT。ライセンスは同じディレクトリの LICENSE.md）を 1 ファイルにまとめた生成物。手で直さない。`,
    // 配布スキルはスキルの外のファイルを参照しない（check-doc-refs の dist-repo-path）ので、作るツールの名前だけを書く
    "// 配布元（shoji9x9/skills）の check-skill-config-vendor.ts --fix で作る。",
    "",
  ].join("\n");
  return {
    "jsonc-parser.mjs": header + out.text,
    "jsonc-parser.d.mts": readFileSync(join(dir, "lib/esm/main.d.ts"), "utf8"),
    "LICENSE.md": readFileSync(join(dir, "LICENSE.md"), "utf8"),
  };
}

/** 設定のスキーマを持つスキルと、scripts/skill-config/ を持つスキル。 */
export function skillsWithConfig(root: string): { withSchema: string[]; withReader: string[] } {
  const skillsDir = join(root, "skills");
  const names = readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  return {
    withSchema: names.filter((n) => existsSync(join(skillsDir, n, SCHEMA_DIR))),
    withReader: names.filter((n) => existsSync(join(skillsDir, n, "scripts/skill-config"))),
  };
}

export type Finding = { path: string; message: string };

/** 食い違いを列挙する。fix なら vendor/ を書き直す。 */
/** root からの相対パス rel の途中（rel 自身を含む）で、最初に見つかったシンボリックリンクの相対パス。無ければ null。 */
export function symlinkOnPath(root: string, rel: string): string | null {
  const parts = rel.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join("/");
    const st = lstatSync(join(root, sub), { throwIfNoEntry: false });
    if (st === undefined) return null;
    if (st.isSymbolicLink()) return sub;
  }
  return null;
}

export async function check(root: string, fix: boolean): Promise<Finding[]> {
  const { withSchema, withReader } = skillsWithConfig(root);
  if (withSchema.length === 0) throw new Error(`skills/*/${SCHEMA_DIR}/ を持つスキルが 0 件`);
  const expected = await renderVendor(root);
  const findings: Finding[] = [];
  for (const name of withReader.filter((n) => !withSchema.includes(n))) {
    findings.push({
      path: `skills/${name}/scripts/skill-config`,
      message: `${SCHEMA_DIR}/ が無いのに同梱している（設定を読まないなら消す）`,
    });
  }
  for (const name of withSchema) {
    const reader = `skills/${name}/${READER}`;
    if (!existsSync(join(root, reader))) {
      findings.push({
        path: reader,
        message: "無い（他のスキルの skill-config.mjs をコピーする）",
      });
    }
    const doc = `skills/${name}/${SHARED_DOC}`;
    if (!existsSync(join(root, doc))) {
      findings.push({ path: doc, message: "無い（他のスキルの config-files.md をコピーする）" });
    }
    for (const file of VENDOR_FILES) {
      const rel = `skills/${name}/${VENDOR_DIR}/${file}`;
      const abs = join(root, rel);
      const actual = existsSync(abs) ? readFileSync(abs, "utf8") : null;
      if (actual === expected[file]) continue;
      // 書き込み先か途中のディレクトリがシンボリックリンクなら、リンク先（リポジトリの外もありうる）を書き換えずに挙げる
      const link = fix ? symlinkOnPath(root, rel) : null;
      if (link !== null) {
        findings.push({
          path: rel,
          message: `${link} がシンボリックリンクなので --fix で書かない`,
        });
        continue;
      }
      if (fix) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, expected[file]);
        continue;
      }
      findings.push({
        path: rel,
        message:
          actual === null ? "無い" : "devDependency の jsonc-parser から作った内容と一致しない",
      });
    }
  }
  const groups = copyGroups(root);
  for (const rel of [READER, SHARED_DOC]) {
    const paths = withSchema
      .map((n) => `skills/${n}/${rel}`)
      .filter((p) => existsSync(join(root, p)));
    findings.push(...missingFromGroup(paths, groups, ` ${rel} `));
  }
  const schemas = new Map<string, string[]>();
  for (const name of withSchema) {
    for (const file of readdirSync(join(root, "skills", name, SCHEMA_DIR)).sort()) {
      const list = schemas.get(file) ?? [];
      list.push(`skills/${name}/${SCHEMA_DIR}/${file}`);
      schemas.set(file, list);
    }
  }
  for (const [file, paths] of schemas)
    findings.push(...missingFromGroup(paths, groups, ` ${file} `));
  return findings;
}

export async function main(
  argv: string[],
  root: string = join(dirname(fileURLToPath(import.meta.url)), "../../.."),
): Promise<number> {
  const fix = argv.includes("--fix");
  const unknown = argv.filter((a) => a !== "--fix");
  if (unknown.length > 0) {
    process.stderr.write(
      `usage: check-skill-config-vendor.ts [--fix]（知らない引数: ${unknown.join(" ")}）\n`,
    );
    return 2;
  }
  let findings: Finding[];
  try {
    findings = await check(root, fix);
  } catch (e) {
    process.stderr.write(`check-skill-config-vendor: ${errorMessage(e)}\n`);
    return 2;
  }
  for (const f of findings) process.stderr.write(`${f.path}: ${f.message}\n`);
  if (findings.length > 0) {
    process.stderr.write(
      "check-skill-config-vendor: 食い違いがある。vendor/ は --fix で作り直す（jsonc-parser の版を変えたときも同じ）\n",
    );
    return 1;
  }
  const { withSchema } = skillsWithConfig(root);
  process.stdout.write(
    `check-skill-config-vendor: OK（${withSchema.length} スキル、jsonc-parser ${jsoncParserPackage(root).version}${fix ? "、vendor/ を作り直した" : ""}）\n`,
  );
  return 0;
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
