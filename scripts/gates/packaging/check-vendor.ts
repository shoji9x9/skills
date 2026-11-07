#!/usr/bin/env node
// 配布スキルに同梱する外部のパッケージ（vendor/）が、devDependency のバージョンから作った内容と一致しているかをチェックする（lefthook pre-commit + CI）。
//
// なぜ要るか: 配布スキルは利用者のプロジェクトに依存を install できないので、外部のパッケージを 1 ファイルにまとめて同梱する。
// 同梱物を手で直したり、devDependency のバージョンを上げて作り直し忘れたりすると、原本と違うコードを配ることになる。
//
// 同梱するものは BUNDLES で宣言する。宣言ごとに、同梱するスキル・置き場所・ファイル・作り方を持つ。
// - jsonc-parser: 設定のスキーマ（skills/<name>/config-schemas/）を持つスキルの scripts/skill-config/vendor/ に置く。
// - mdast-gfm: replace-strategy と golden-dataset の scripts/vendor/ に置く。.replace/ の Markdown の表を GFM と同じに読むためのパーサである。
//
// 判定規則:
// - 宣言した各ファイルは、devDependency から作った内容とバイト単位で一致する。
// - 宣言の置き場所に、宣言に無いファイルを置かない。宣言の対象でないスキルが、その置き場所を持たない（使われない同梱物を配らない）。
// - 宣言の置き場所は、lint・整形・型の検査から外す範囲（scripts/lib/source-scope.ts の isVendored）に入る。
// - 設定のスキーマを持つスキルは、読み取り（scripts/skill-config/skill-config.mjs）と references/config-files.md も持つ。
//   copies/check-identical-copies.ts は、identical-copies.json の組に載ったコピーが同じ内容であることだけを確かめる。
//   新しいスキルのコピーを組に足すのは、docs/skill-development.md の手順で行い、チェックしない。
// - スキーマを持たないスキルが scripts/skill-config/ を持つのも違反にする。
// - スキーマを持つスキルが 0 件なら exit 2（対象 0 件を合格として扱わない）。
// - `--fix` を付けると、宣言した同梱物を作り直して書く。読み取り（skill-config.mjs）は手で直す。
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Metafile } from "esbuild";
import { errorMessage } from "../../lib/errors.ts";
import { isRecord } from "../../lib/guards.ts";
import { isCliEntry } from "../../lib/cli/entry.ts";
import { isVendored } from "../../lib/source-scope.ts";
import { directiveCommentRanges, findDirectives } from "../code/check-skill-lint-directives.ts";

const SCHEMA_DIR = "config-schemas";
export const READER = "scripts/skill-config/skill-config.mjs";
export const SHARED_DOC = "references/config-files.md";

/** 同梱物を作るツールの名前。生成物の先頭に書く（配布スキルはスキルの外のパスを書かないので、名前だけにする）。 */
const TOOL = "check-vendor.ts";

/** 同梱する外部のパッケージの宣言。 */
export type VendorBundle = {
  /** 報告に使う名前 */
  name: string;
  /** スキルの中の置き場所 */
  dir: string;
  /** 置き場所に置くファイル */
  files: readonly string[];
  /** 同梱するスキルの名前 */
  targets: (root: string) => string[];
  /** ファイルごとの内容を作る */
  render: (root: string) => Promise<Record<string, string>>;
  /** 作るのに使った devDependency とバージョン（報告に使う） */
  versions: (root: string) => string;
};

/** パッケージのディレクトリとバージョン。root の node_modules から解決する。 */
export function packageInfo(root: string, name: string): { dir: string; version: string } {
  // exports に package.json を載せないパッケージ（micromark 群など）もあるので、require.resolve で解決しない。
  // devDependency は root の node_modules の直下にある（pnpm はそこへのリンクを置く）。
  const pkgJson = realpathSync(join(root, "node_modules", name, "package.json"));
  const pkg: unknown = JSON.parse(readFileSync(pkgJson, "utf8"));
  const version =
    typeof pkg === "object" && pkg !== null && "version" in pkg ? pkg.version : undefined;
  if (typeof version !== "string") throw new Error(`${pkgJson}: version が無い`);
  return { dir: dirname(pkgJson), version };
}

/** entry を esbuild で 1 ファイルにまとめる。出力の本文と、読んだファイルの一覧を返す。 */
async function bundle(root: string, entry: string): Promise<{ text: string; metafile: Metafile }> {
  const result = await build({
    stdin: { contents: entry, resolveDir: root, loader: "js" },
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    legalComments: "inline",
    write: false,
    metafile: true,
    // metafile の入力のパスは absWorkingDir からの相対パスになる。root にそろえ、bundledPackages が root から解決できるようにする
    absWorkingDir: root,
    logLevel: "silent",
  });
  const out = result.outputFiles[0];
  if (out === undefined) throw new Error("esbuild の出力が無い");
  // esbuild が書く出所のコメントは node_modules の実パス（pnpm のバージョンを含む）なので、手元と CI で同じになる
  return { text: withoutDirectives(out.text), metafile: result.metafile };
}

/**
 * 上流のコードに残る lint と型の検査の抑止コメント（`@ts-expect-error`・`eslint-disable` など）を、コメントごと取り除く。
 * 利用者の lint が同梱物を読むと、使われない抑止として報告されうるからである（.agents/rules/distributed-skill-stack-independence.md）。
 * 抑止の見分け方は check-skill-lint-directives.ts と同じにし、取り除いた後に 1 件も残らないことを確かめる。
 */
export function withoutDirectives(text: string): string {
  let out = text;
  for (const r of directiveCommentRanges(text, "bundle.mjs").reverse()) {
    out = out.slice(0, r.pos) + out.slice(r.end);
  }
  const left = findDirectives(out, "bundle.mjs");
  if (left.length > 0) throw new Error(`抑止のコメントを取り除けない（${left.join(", ")}）`);
  return out;
}

/** 設定のスキーマを持つスキルと、scripts/skill-config/ を持つスキル。 */
function skillsWithConfig(root: string): { withSchema: string[]; withReader: string[] } {
  const names = skillNames(root);
  const skillsDir = join(root, "skills");
  return {
    withSchema: names.filter((n) => existsSync(join(skillsDir, n, SCHEMA_DIR))),
    withReader: names.filter((n) => existsSync(join(skillsDir, n, "scripts/skill-config"))),
  };
}

/** skills/ の直下のスキルの名前（並べ替えた順）。 */
function skillNames(root: string): string[] {
  return readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export const JSONC_PARSER: VendorBundle = {
  name: "jsonc-parser",
  dir: "scripts/skill-config/vendor",
  files: ["jsonc-parser.mjs", "jsonc-parser.d.mts", "LICENSE.md"],
  targets: (root) => skillsWithConfig(root).withSchema,
  versions: (root) => `jsonc-parser ${packageInfo(root, "jsonc-parser").version}`,
  async render(root) {
    const { dir, version } = packageInfo(root, "jsonc-parser");
    const { text } = await bundle(root, 'export * from "jsonc-parser";\n');
    const header = [
      `// jsonc-parser ${version}（MIT。ライセンスは同じディレクトリの LICENSE.md）を 1 ファイルにまとめた生成物。手で直さない。`,
      `// 配布元（shoji9x9/skills）の ${TOOL} --fix で作る。`,
      "",
    ].join("\n");
    return {
      "jsonc-parser.mjs": header + text,
      "jsonc-parser.d.mts": readFileSync(join(dir, "lib/esm/main.d.ts"), "utf8"),
      "LICENSE.md": readFileSync(join(dir, "LICENSE.md"), "utf8"),
    };
  },
};

/** mdast-gfm.mjs が直接使うパッケージ。バージョンは pnpm-lock.yaml で決まる。 */
export const MDAST_GFM_PACKAGES = [
  "mdast-util-from-markdown",
  "mdast-util-gfm",
  "micromark-extension-gfm",
] as const;

const MDAST_GFM_ENTRY = [
  'import { fromMarkdown } from "mdast-util-from-markdown";',
  'import { gfmFromMarkdown } from "mdast-util-gfm";',
  'import { gfm } from "micromark-extension-gfm";',
  "",
  "/**",
  " * Markdown を GFM（GitHub Flavored Markdown）の規則で読み、mdast の木を返す。",
  " * mdastExtensions は、木を作る処理に足す handler（mdast-util-from-markdown の Extension）である。",
  " */",
  "export function parseGfm(text, mdastExtensions = []) {",
  "  return fromMarkdown(text, {",
  "    extensions: [gfm()],",
  "    mdastExtensions: [gfmFromMarkdown(), ...mdastExtensions],",
  "  });",
  "}",
  "",
].join("\n");

// 同梱物を読む側（replace-strategy と golden-dataset の lib/markdown.mjs）が使う形だけを宣言する。mdast の型の全体は同梱しない。
const MDAST_GFM_TYPES = [
  `// mdast-gfm.mjs の型。配布元（shoji9x9/skills）の ${TOOL} --fix で作る。手で直さない。`,
  "export interface Point {",
  "  line: number;",
  "  column: number;",
  "  offset?: number;",
  "}",
  "export interface Position {",
  "  start: Point;",
  "  end: Point;",
  "}",
  "export interface Node {",
  "  type: string;",
  "  position?: Position;",
  "  value?: string;",
  "  children?: Node[];",
  "  data?: Record<string, unknown>;",
  "}",
  "/** 木を作る処理が handler に渡す文脈。stack は作りかけの節（一番上が最後）である。 */",
  "export interface CompileContext {",
  "  stack: Node[];",
  "}",
  "/** 木を作る処理に足す handler。キーは micromark のトークンの種類（codeFencedFence など）である。 */",
  "export interface Extension {",
  "  enter?: Record<string, (this: CompileContext, token: unknown) => void>;",
  "  exit?: Record<string, (this: CompileContext, token: unknown) => void>;",
  "}",
  "/** Markdown を GFM（GitHub Flavored Markdown）の規則で読み、mdast の木を返す。 */",
  "export function parseGfm(text: string, mdastExtensions?: Extension[]): Node;",
  "",
].join("\n");

/** パッケージのライセンスのファイル（license・LICENSE・LICENSE.md など）の本文。 */
function licenseText(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(f))
    .sort();
  const file = files[0];
  if (file === undefined) throw new Error(`${dir}: ライセンスのファイルが無い`);
  return readFileSync(join(dir, file), "utf8").trimEnd();
}

/** esbuild が読んだファイルから、まとめたパッケージの名前・バージョン・ライセンスを取り出す。 */
export function bundledPackages(
  metafile: Metafile,
  root: string,
): { name: string; version: string; text: string }[] {
  const dirs = new Map<string, string>();
  for (const input of Object.keys(metafile.inputs)) {
    // entry は stdin で渡すので、esbuild は <stdin> という名前で記録する
    if (input === "<stdin>") continue;
    // pnpm の実体は node_modules/.pnpm/<名前>@<バージョン>/node_modules/<名前>/ にある。最後の node_modules/ の後ろがパッケージ名である
    const m = /^((?:.*\/)?node_modules\/((?:@[^/]+\/)?[^/]+))\/(?!.*\/node_modules\/)/.exec(input);
    if (m === null) throw new Error(`${input}: node_modules の外のファイルをまとめている`);
    dirs.set(m[2], join(root, m[1]));
  }
  return [...dirs]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, dir]) => {
      const pkg: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (!isRecord(pkg)) throw new Error(`${name}: package.json がオブジェクトでない`);
      const { version, license } = pkg;
      // ライセンスが MIT でないパッケージが依存に入ったら、表記の形を決め直すまで作らない
      if (license !== "MIT") throw new Error(`${name}: ライセンスが MIT でない`);
      if (typeof version !== "string") throw new Error(`${name}: version が無い`);
      return { name, version, text: licenseText(dir) };
    });
}

/** まとめたパッケージのライセンス文を NOTICE.md にする。同じ本文のパッケージは 1 つの節にまとめる。 */
function renderNotice(packages: { name: string; version: string; text: string }[]): string {
  const groups = new Map<string, string[]>();
  for (const p of packages)
    groups.set(p.text, [...(groups.get(p.text) ?? []), `${p.name} ${p.version}`]);
  const sections = [...groups].map(([text, names]) =>
    ["## " + names.join("・"), "", "```text", text, "```", ""].join("\n"),
  );
  return [
    "# 同梱したパッケージのライセンス",
    "",
    `\`mdast-gfm.mjs\` は、次の ${packages.length} 個のパッケージを 1 ファイルにまとめた生成物である。どのパッケージも MIT ライセンスで配布されている。`,
    `配布元（shoji9x9/skills）の ${TOOL} --fix で作る。手で直さない。`,
    "",
    ...sections,
  ].join("\n");
}

export const MDAST_GFM: VendorBundle = {
  name: "mdast-gfm",
  dir: "scripts/vendor",
  files: ["mdast-gfm.mjs", "mdast-gfm.d.mts", "NOTICE.md"],
  targets: () => ["golden-dataset", "replace-strategy"],
  versions: (root) =>
    MDAST_GFM_PACKAGES.map((name) => `${name} ${packageInfo(root, name).version}`).join("・"),
  async render(root) {
    const { text, metafile } = await bundle(root, MDAST_GFM_ENTRY);
    const header = [
      `// ${MDAST_GFM.versions(root)} と、その依存（MIT。ライセンスは同じディレクトリの NOTICE.md）を 1 ファイルにまとめた生成物。手で直さない。`,
      `// 配布元（shoji9x9/skills）の ${TOOL} --fix で作る。`,
      "",
    ].join("\n");
    return {
      "mdast-gfm.mjs": header + text,
      "mdast-gfm.d.mts": MDAST_GFM_TYPES,
      "NOTICE.md": renderNotice(bundledPackages(metafile, root)),
    };
  },
};

export const BUNDLES: readonly VendorBundle[] = [JSONC_PARSER, MDAST_GFM];

/**
 * バージョンを上げると同梱物が変わる devDependency。esbuild は出力の形を、micromark はまとめる実体のバージョンを変える。
 * Dependabot がこれらを上げた PR は、同梱物を作り直すまで CI のこのチェックが失敗する。
 * そのため .github/dependabot.yml の vendored グループと、dependabot-automerge.yml の手動レビューへ回す一覧に同じ名前を書く（check-vendor.test.ts が突き合わせる）。
 */
export const VENDORED_PACKAGES = [
  "esbuild",
  "jsonc-parser",
  "micromark",
  ...MDAST_GFM_PACKAGES,
] as const;

export type Finding = { path: string; message: string };

/** root からの相対パス rel の途中（rel 自身を含む）で、最初に見つかったシンボリックリンクの相対パス。無ければ null。 */
function symlinkOnPath(root: string, rel: string): string | null {
  const parts = rel.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join("/");
    const st = lstatSync(join(root, sub), { throwIfNoEntry: false });
    if (st === undefined) return null;
    if (st.isSymbolicLink()) return sub;
  }
  return null;
}

/** 設定を読むスキルが、読み取りのスクリプトと共有の文書を持つかを確かめる。 */
function missingSharedFiles(root: string, name: string): Finding[] {
  const findings: Finding[] = [];
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
  return findings;
}

/** 設定の読み取りの置き方（スキーマ・読み取り・共有の文書）を確かめる。 */
function configFindings(root: string): Finding[] {
  const { withSchema, withReader } = skillsWithConfig(root);
  if (withSchema.length === 0) throw new Error(`skills/*/${SCHEMA_DIR}/ を持つスキルが 0 件`);
  const findings: Finding[] = [];
  for (const name of withReader.filter((n) => !withSchema.includes(n))) {
    findings.push({
      path: `skills/${name}/scripts/skill-config`,
      message: `${SCHEMA_DIR}/ が無いのに同梱している（設定を読まないなら消す）`,
    });
  }
  for (const name of withSchema) findings.push(...missingSharedFiles(root, name));
  return findings;
}

/** 1 スキルの同梱物を、作るべき内容と突き合わせる。fix なら食い違うファイルを書き直す。 */
function bundleFileFindings(
  root: string,
  rel: { skill: string; bundle: VendorBundle },
  { expected, fix }: { expected: Record<string, string>; fix: boolean },
): Finding[] {
  const findings: Finding[] = [];
  for (const file of rel.bundle.files) {
    const path = `skills/${rel.skill}/${rel.bundle.dir}/${file}`;
    const abs = join(root, path);
    const actual = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (actual === expected[file]) continue;
    // 書き込み先か途中のディレクトリがシンボリックリンクなら、リンク先（リポジトリの外もありうる）を書き換えずに挙げる
    const link = fix ? symlinkOnPath(root, path) : null;
    if (link !== null) {
      findings.push({ path, message: `${link} がシンボリックリンクなので --fix で書かない` });
      continue;
    }
    if (fix) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, expected[file] ?? "");
      continue;
    }
    findings.push({
      path,
      message:
        actual === null
          ? "無い"
          : `devDependency の ${rel.bundle.versions(root)} から作った内容と一致しない`,
    });
  }
  return findings;
}

/** 宣言の置き場所に、宣言に無いスキルやファイルが無いかを確かめる。 */
function strayFindings(root: string, bundle: VendorBundle, targets: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const skill of skillNames(root)) {
    const dir = `skills/${skill}/${bundle.dir}`;
    if (!existsSync(join(root, dir))) continue;
    if (!targets.includes(skill)) {
      findings.push({
        path: dir,
        message: `${bundle.name} を同梱する宣言の対象でないのに置いている（使わないなら消す）`,
      });
      continue;
    }
    for (const file of readdirSync(join(root, dir)).sort()) {
      if (bundle.files.includes(file)) continue;
      findings.push({ path: `${dir}/${file}`, message: `${bundle.name} の宣言に無いファイル` });
    }
  }
  return findings;
}

/** 1 つの宣言について、同梱物の食い違いを列挙する。 */
async function bundleFindings(root: string, bundle: VendorBundle, fix: boolean) {
  const targets = bundle.targets(root);
  const findings: Finding[] = [];
  const sample = `skills/x/${bundle.dir}/${bundle.files[0] ?? ""}`;
  if (!isVendored(sample)) {
    // 外さないと、上流のコードに lint・整形が当たり、--fix で作った内容と一致しなくなる
    findings.push({
      path: `skills/*/${bundle.dir}`,
      message: "scripts/lib/source-scope.ts の VENDORED_GLOBS と isVendored に入っていない",
    });
  }
  const expected = await bundle.render(root);
  for (const skill of targets)
    findings.push(...bundleFileFindings(root, { skill, bundle }, { expected, fix }));
  findings.push(...strayFindings(root, bundle, targets));
  return findings;
}

/** 食い違いを列挙する。fix なら同梱物を書き直す。 */
export async function check(
  root: string,
  fix: boolean,
  bundles: readonly VendorBundle[] = BUNDLES,
): Promise<Finding[]> {
  const findings = configFindings(root);
  for (const bundle of bundles) findings.push(...(await bundleFindings(root, bundle, fix)));
  return findings;
}

export async function main(
  argv: string[],
  root: string = join(dirname(fileURLToPath(import.meta.url)), "../../.."),
  bundles: readonly VendorBundle[] = BUNDLES,
): Promise<number> {
  const fix = argv.includes("--fix");
  const unknown = argv.filter((a) => a !== "--fix");
  if (unknown.length > 0) {
    process.stderr.write(`usage: ${TOOL} [--fix]（知らない引数: ${unknown.join(" ")}）\n`);
    return 2;
  }
  let findings: Finding[];
  try {
    findings = await check(root, fix, bundles);
  } catch (e) {
    process.stderr.write(`check-vendor: ${errorMessage(e)}\n`);
    return 2;
  }
  for (const f of findings) process.stderr.write(`${f.path}: ${f.message}\n`);
  if (findings.length > 0) {
    process.stderr.write(
      "check-vendor: 食い違いがある。同梱物は --fix で作り直す（devDependency のバージョンを変えたときも同じ）\n",
    );
    return 1;
  }
  const summary = bundles
    .map((b) => `${b.name}: ${b.targets(root).length} スキル、${b.versions(root)}`)
    .join("。");
  process.stdout.write(`check-vendor: OK（${summary}${fix ? "。同梱物を作り直した" : ""}）\n`);
  return 0;
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
