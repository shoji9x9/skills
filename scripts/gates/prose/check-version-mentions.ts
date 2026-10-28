#!/usr/bin/env node
// 文書とコメントに書いたツールのバージョンが、リポジトリで宣言したバージョンと食い違っていないかチェックする（lefthook pre-commit + CI）。
// 依存を上げると、文書に書いた「<ツール> X.Y.Z で実測」が上げる前のバージョンのまま残る。
// バージョンを書かなくても意味が通る文には書かない（writing-style の規則 9）。残した記述をこのチェックが宣言と突き合わせる。
//
// - 宣言: package.json の dependencies と devDependencies（バージョンは pnpm-lock.yaml の importers の `.` で解決したもの）、
//   package.json の packageManager、mise.toml の [tools]。
//   mise.toml は `mise ls --current --json` で mise に解決させて読む。mise.toml を上書きする設定（mise.local.toml など）は読ませない。
//   宣言の無いツール（gh・git・Chrome など）は見ない。
// - 名前: 宣言の名前と、文書で使う呼び名（ALIASES）。大文字と小文字を区別しない。
// - 記述: 名前の直後の `X.Y.Z`（`v` と `@` を前に付けた形を含む）。`X` と `X.Y` だけの記述は見ない。
//   メジャーやマイナーの境目（「Node 24.2 より古い版」「vitest 5」）を表し、パッチの更新では古くならないからである。
//   直後の語（「以上」「〜」など）では除かない。範囲の書き方は閉じないので、宣言と違う X.Y.Z はすべて違反にし、
//   正しい記述（必要な最低のバージョンなど）は下の許可で通す。
//   プレリリースの接尾辞（`-rc.1` など）は記述に含めて比べる。
//   英語の文の文末の `.` は記述に含めない（Markdown の「Tested with Playwright X.Y.Z.」も読む）。`.` の後に数字が続く X.Y.Z.W は見ない。
// - 走査対象は scripts/gates/docs/doc-scan-files.ts と同じ（Tier 1〜3）。Markdown はコードフェンスの外の本文を、
//   それ以外はコメントの文章（scripts/lib/text/code-comments.ts）を読む。名前をバッククォートで囲んだ記述も読む。
//   code-comments.ts は日本語を含まない段落を返さないので、英語だけのコメントは読まない（このリポジトリのコメントは日本語で書く）。
//   例の行（scripts/lib/doc-scan.ts の EXAMPLE_LINE_RE）は読まない。
// - 違反の形だが正しい記述（上流のソースのタグ・古いバージョンの挙動の記録・必要な最低のバージョン）は、
//   scripts/gates/docs/doc-allowed.json に規則 version-mention で理由付きで許可する（使われていない許可は失敗にする）。
// 宣言を読めない（mise を起動できない場合を含む）・解決したバージョンが X.Y.Z でない・対象ファイルが 0 件のときは exit 2。違反は exit 1。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { applyAllowed, EXAMPLE_LINE_RE, fencedLines, loadAllowed } from "../../lib/doc-scan.ts";
import { scannedFiles } from "../docs/doc-scan-files.ts";
import { commentMarkdown, hasComments } from "../../lib/text/code-comments.ts";
import { loadYamlDocuments } from "../../lib/text/yaml-as.ts";
import { isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";
import { errorMessage } from "../../lib/errors.ts";
import { isCliEntry } from "../../lib/cli/entry.ts";

export const RULE = "version-mention";
// このチェック自身のテストは、違反の fixture を本文に持つので読まない。
const SELF_FIXTURES = ["scripts/gates/prose/check-version-mentions.test.ts"];
// 文書で使う呼び名と、それが指す宣言の名前。呼び名と同じ名前の宣言があれば、宣言を優先する。
const ALIASES = new Map([
  ["node.js", "node"],
  ["playwright", "@playwright/test"],
]);
const SEMVER = /^\d+\.\d+\.\d+$/;

type Declared = Map<string, string>;

/** package.json・pnpm-lock.yaml・mise.toml から、宣言した名前（小文字）とバージョンを読む。 */
export function declaredVersions(root: string, miseList: MiseList = runMiseList): Declared {
  const out = packageVersions(root);
  for (const [name, version] of miseTools(root, miseList)) {
    const key = name.toLowerCase();
    const other = out.get(key);
    if (other !== undefined && other !== version)
      throw new Error(
        `${name} の宣言が食い違う（package.json は ${other}、mise.toml は ${version}）`,
      );
    out.set(key, version);
  }
  for (const [name, version] of out)
    if (!SEMVER.test(version))
      throw new Error(`${name} の宣言したバージョン「${version}」が X.Y.Z でなく、比べられない`);
  return out;
}

/** package.json の依存（lockfile で解決したバージョン）と packageManager。 */
function packageVersions(root: string): Declared {
  const out: Declared = new Map();
  const pkg: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!isRecord(pkg)) throw new Error("package.json が object でない");
  const importer = lockImporter(root);
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (deps === undefined) continue;
    if (!isRecord(deps)) throw new Error(`package.json の ${field} が object でない`);
    for (const name of Object.keys(deps))
      out.set(name.toLowerCase(), resolvedVersion(importer, name));
  }
  if (pkg.packageManager !== undefined) {
    const [key, version] = packageManager(pkg.packageManager);
    const dep = out.get(key);
    if (dep !== undefined && dep !== version)
      throw new Error(`${key} の宣言が食い違う（依存は ${dep}、packageManager は ${version}）`);
    out.set(key, version);
  }
  return out;
}

/** package.json の packageManager（`名前@X.Y.Z+ハッシュ`）の名前（小文字）とバージョン。 */
function packageManager(pm: unknown): [string, string] {
  if (typeof pm !== "string") throw new Error("package.json の packageManager が文字列でない");
  const at = pm.lastIndexOf("@");
  if (at <= 0) throw new Error(`package.json の packageManager「${pm}」に @ が無い`);
  return [pm.slice(0, at).toLowerCase(), pm.slice(at + 1).split("+")[0]];
}

/**
 * pnpm-lock.yaml の importers の `.` のうち、プロジェクトの依存を持つもの。
 * lockfile は複数の文書からなり、pnpm 自身の依存（packageManagerDependencies）を書いた文書にも importers の `.` がある。
 */
function lockImporter(root: string): Record<string, unknown> {
  const docs = loadYamlDocuments(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
  const found = docs.flatMap((d) => {
    const dot = isRecord(d) && isRecord(d.importers) ? d.importers["."] : undefined;
    return isRecord(dot) && (isRecord(dot.dependencies) || isRecord(dot.devDependencies))
      ? [dot]
      : [];
  });
  if (found.length !== 1)
    throw new Error(`pnpm-lock.yaml に、依存を持つ importers の . が ${found.length} 件`);
  return found[0];
}

/** importer で解決したバージョン（`1.2.3(peer@4.5.6)` の peer の部分は除く）。 */
function resolvedVersion(importer: Record<string, unknown>, name: string): string {
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = importer[field];
    const entry = isRecord(deps) ? deps[name] : undefined;
    if (isRecord(entry) && typeof entry.version === "string") return entry.version.split("(")[0];
  }
  throw new Error(`pnpm-lock.yaml の importers の . に ${name} が無い`);
}

/** `mise ls --current --json` の出力（JSON の文字列）を返す関数。テストは偽物を渡す。 */
export type MiseList = (root: string) => string;

const MISE_TIMEOUT_MS = 30_000;

/**
 * mise.toml の宣言を上書きする設定（mise.local.toml・mise.<env>.toml・.tool-versions・MISE_<TOOL>_VERSION・MISE_ENV）を、
 * なるべく読ませない環境変数。上書きされると mise ls はその設定の宣言だけを返す。
 * ここで止めきれない上書きは、ownVersion が比べられないとして例外にする（止める種類を数え切ることを前提にしない）。
 */
function miseEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => k !== "MISE_ENV" && !/^MISE_[A-Z0-9_]+_VERSION$/.test(k),
    ),
  );
  return {
    ...env,
    MISE_OVERRIDE_CONFIG_FILENAMES: "mise.toml",
    MISE_OVERRIDE_TOOL_VERSIONS_FILENAMES: "none",
  };
}

/** リポジトリのルートで `mise ls --current --json` を実行する。起動できない・0 以外で終わったときは例外にする。 */
const runMiseList: MiseList = (root) => {
  const r = spawnSync("mise", ["ls", "--current", "--json"], {
    cwd: root,
    env: miseEnv(),
    encoding: "utf8",
    timeout: MISE_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) throw new Error(`mise を起動できない: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`mise ls が ${r.status} で終わった: ${r.stderr.trim()}`);
  return r.stdout;
};

/**
 * mise.toml の [tools] の宣言を、mise 自身に解決させて読む（TOML を自前で解析しない）。
 * mise はグローバルの設定の宣言も返すので、`source.path` がリポジトリの mise.toml のものだけを使う。
 * バージョンは mise が解決したバージョン（`version`。mise.lock で固定した値）で、package.json の側と同じく解決した値と比べる。
 * X.Y.Z でなければ declaredVersions が例外にする。
 * mise.toml が無ければ mise を起動しない。在るのに 1 件も読めない・形が違うときは例外にする。
 */
function miseTools(root: string, miseList: MiseList): [string, string][] {
  const path = join(root, "mise.toml");
  if (!existsSync(path)) return [];
  const own = realpathSync(path);
  const listed: unknown = JSON.parse(miseList(root));
  if (!isRecord(listed)) throw new Error("mise ls の出力が object でない");
  const out: [string, string][] = [];
  for (const [name, entries] of Object.entries(listed)) {
    if (!isArray(entries)) throw new Error(`mise ls の ${name} が配列でない`);
    const versions = entries.flatMap((entry) => ownVersion(name, entry, own) ?? []);
    if (versions.length > 1)
      throw new Error(
        `mise.toml が ${name} に複数のバージョン（${versions.join("、")}）を宣言していて、比べるバージョンを決められない`,
      );
    if (versions.length === 1) out.push([name, versions[0]]);
  }
  if (out.length === 0) throw new Error("mise.toml の宣言を mise ls から 1 件も読めない");
  return out;
}

/**
 * mise ls の 1 件が own（リポジトリの mise.toml）の宣言なら、解決したバージョンを返す。
 * リポジトリの外の設定（グローバルの設定）の宣言なら undefined。
 * リポジトリの中の別の設定（mise.<env>.toml・mise.local.toml など）と、ファイルを持たない出所（環境変数など）の宣言は、
 * mise.toml の宣言を上書きしていて比べられないので例外にする。読み飛ばすと、そのツールだけが警告なしに突き合わせから抜ける。
 */
function ownVersion(name: string, entry: unknown, own: string): string | undefined {
  if (!isRecord(entry)) throw new Error(`mise ls の ${name} の要素が object でない`);
  const source = isRecord(entry.source) ? entry.source : {};
  if (typeof source.path !== "string")
    throw new Error(
      `mise ls の ${name} の出所（${String(source.type)}）がファイルでなく、mise.toml の宣言と比べられない`,
    );
  const path = existsSync(source.path) ? realpathSync(source.path) : source.path;
  if (path !== own) {
    if (!path.startsWith(dirname(own) + sep)) return undefined;
    throw new Error(
      `${source.path} が ${name} の宣言を上書きしていて、mise.toml の宣言と比べられない`,
    );
  }
  const version = entry.version;
  if (typeof version !== "string") throw new Error(`mise ls の ${name} に version が無い`);
  return version;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// 宣言ごとに 1 回だけ組み立てる（ファイルごとに作り直さない）。
const patterns = new WeakMap<Declared, { all: RegExp; probe: RegExp }>();

/**
 * 宣言の名前と呼び名のどれかの直後の X.Y.Z に当たる正規表現。長い名前を先に試す。
 * all は matchAll に渡す g 付きのもの、probe は記述の有無だけを調べる g の無いもの。
 * g 付きの test は lastIndex を進め、後の matchAll がそれを引き継ぐので、有無は probe で調べる。
 */
function mentionPattern(declared: Declared) {
  const cached = patterns.get(declared);
  if (cached) return cached;
  const names = [...new Set([...declared.keys(), ...ALIASES.keys()])].sort(
    (a, b) => b.length - a.length,
  );
  const source = `(?<![\\w@/.-])(${names.map(escapeRe).join("|")})(?:@|\\s*v?)(\\d+\\.\\d+\\.\\d+(?:-[0-9a-z]+(?:\\.[0-9a-z]+)*)?)(?!\\w|\\.\\d)`;
  const built = { all: new RegExp(source, "gi"), probe: new RegExp(source, "i") };
  patterns.set(declared, built);
  return built;
}

/** 1 ファイルのうち、読む文章を行ごとに返す（line は 0 始まり）。 */
function proseLines(file: string, markdown: boolean, text: string) {
  if (markdown) {
    const lines = text.split(/\r?\n/);
    const fenced = fencedLines(lines);
    return lines.flatMap((t, line) => (fenced[line] ? [] : [{ line, text: t }]));
  }
  if (!hasComments(file)) return [];
  const { markdown: md, lines } = commentMarkdown(file, text);
  return md.split("\n").map((t, i) => ({ line: lines[i], text: t }));
}

/** 宣言と食い違う記述を列挙する。 */
export function findMismatches(
  { file, markdown }: { file: string; markdown: boolean },
  text: string,
  declared: Declared,
) {
  const { all: re, probe } = mentionPattern(declared);
  const out: { line: number; text: string; message: string }[] = [];
  // 記述の無いファイルはコメントを取り出さない（シェルは shfmt を起動するので、全件で取り出すと数秒かかる）。
  // バッククォートを除いた本文に当たらなければ、文章のどの部分にも当たらない。
  if (!probe.test(text.replace(/`/g, ""))) return out;
  for (const { line, text: raw } of proseLines(file, markdown, text)) {
    if (EXAMPLE_LINE_RE.test(raw)) continue;
    const prose = raw.replace(/`/g, "");
    for (const m of prose.matchAll(re)) {
      const name = m[1].toLowerCase();
      const alias = ALIASES.get(name);
      const want = declared.get(name) ?? (alias === undefined ? undefined : declared.get(alias));
      if (want === undefined || want === m[2]) continue;
      out.push({ line: line + 1, text: m[0], message: `${m[0]}（宣言は ${want}）` });
    }
  }
  return out;
}

export function checkVersionMentions(root: string, miseList: MiseList = runMiseList) {
  const declared = declaredVersions(root, miseList);
  const files = scannedFiles(root, { exclude: SELF_FIXTURES });
  const found = [];
  for (const { file, markdown } of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const v of findMismatches({ file, markdown }, text, declared))
      found.push({ file, rule: RULE, ...v });
  }
  return { files: files.length, ...applyAllowed(found, loadAllowed(root), [RULE]) };
}

/** 引数のリポジトリのルート（無ければ作業ディレクトリ）を検査し、終了コードを返す。 */
function main(argv: string[]): number {
  const root = argv.find((a) => a !== "--" && !a.startsWith("--")) ?? process.cwd();
  const result = (() => {
    try {
      return checkVersionMentions(root);
    } catch (error) {
      return new Error(errorMessage(error));
    }
  })();
  if (result instanceof Error) {
    console.error(`version-mentions: チェックできない: ${result.message}`);
    return 2;
  }
  if (result.files === 0) {
    console.error("version-mentions: 対象ファイルが 0 件。列挙できていない");
    return 2;
  }
  if (result.failures.length === 0) {
    console.log(`version-mentions: OK（${result.files} 件）`);
    return 0;
  }
  console.error(
    `version-mentions: ${result.files} 件を走査し、${result.failures.length} 件の食い違い:`,
  );
  for (const f of result.failures) console.error(`  - ${f}`);
  console.error(
    "Fix: バージョンが要らない文からは消す。要る文は、宣言したバージョンで確かめ直して書き替える。" +
      "古いバージョンの挙動の記録のように正しい記述だけを、scripts/gates/docs/doc-allowed.json に理由付きで許可する。",
  );
  return 1;
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
