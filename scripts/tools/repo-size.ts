#!/usr/bin/env node
// リポジトリの規模（ファイル数と行数）を、スキルごとに本体・テスト・fixture に分けて数える（Issue #664）。
//
// 同じ commit なら同じ結果になるように、作業ツリーではなく commit の中身を数える。
// 対象は `git ls-tree -r <rev>` のファイルで、中身は `git cat-file --batch` で読む。出力には commit の SHA を書く。
//
// 数え方は次のとおり。
// - 数えないもの: シンボリックリンク、インストール済みのコピー（`.agents/skills/<name>/` のうち private skill でないもの）と
//   `.claude/`、記録（`tests/`・`.kaizen/`・`.agent-usage/`）、生成物と設定（lockfile・tsconfig など。EXCLUDED_FILES）
// - スキルに属するもの: `skills/<name>/`・private skill の `.agents/skills/<name>/`・`evals/<name>/`・`scripts/skills/<name>/`。
//   それ以外はリポジトリ共通に数える（`scripts/skills/_cross/` も共通）
// - fixture: `fixtures` という名前のディレクトリの下と、`-fixture.<拡張子>` で終わるファイル
// - テスト: `*.test.*`・`*.mutations.json`、`evals/` と `scripts/skills/` の下、テストの基盤（TEST_DIRS）
// - 行数は改行の数で数え、最後の行に改行が無ければ 1 を足す。NUL を含むファイルはバイナリとして、ファイル数だけを数える
//
// 終了コード: 0 は集計できた、2 は集計できない（git の失敗・ファイルが 0 件・スキルとして知らない名前の置き場所）。
import { spawnSync } from "node:child_process";
import { errorMessage } from "../lib/errors.ts";
import { isCliEntry } from "../lib/cli/entry.ts";

const KINDS = ["main", "test", "fixture"] as const;
export type Kind = (typeof KINDS)[number];

/** 集計の行の名前。スキルの名前か、リポジトリ共通（COMMON）。 */
export const COMMON = "(リポジトリ共通)";

export type Classified =
  | { excluded: true; reason: string }
  | { excluded: false; owner: string; kind: Kind };

/** 記録の置き場所。経過の記録で、コードや文書の規模ではない。 */
const RECORD_DIRS = ["tests/", ".kaizen/", ".agent-usage/"];

/** インストール済みのコピーとエージェント用のリンクの置き場所（private skill は classify で別に扱う）。 */
const INSTALLED_DIRS = [".agents/skills/", ".claude/"];

/** 生成物と設定。ツールが生成するファイルと、ツールの設定ファイル。 */
const EXCLUDED_FILES = new Set([
  "pnpm-lock.yaml",
  "mise.lock",
  "mise.toml",
  "package.json",
  "pnpm-workspace.yaml",
  "lefthook.yml",
  ".gitignore",
  ".gitattributes",
  ".markdownlint.yaml",
  ".markdownlint-cli2.yaml",
  ".textlintrc.json",
  ".textlint/word-list.md",
  ".mcp.json",
  ".github/dependabot.yml",
]);
const EXCLUDED_DIRS = [".codex/", ".config/", ".github/hooks/"];
/** ルートに置くツールの設定（`tsconfig*.json`・`*.config.ts`）。 */
const ROOT_CONFIG = /^(tsconfig[^/]*\.json|[^/]+\.config\.ts)$/;

/** テストを実行・測定する基盤。テストコードとして数える。 */
const TEST_DIRS = [
  "scripts/lib/testing/",
  "scripts/mutation/",
  "scripts/coverage/",
  "scripts/eval/",
];

function isFixture(path: string): boolean {
  return path.split("/").slice(0, -1).includes("fixtures") || /-fixture\.[^/.]+$/.test(path);
}

function isTest(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return (
    /\.test\.[^.]+$/.test(base) ||
    base.endsWith(".mutations.json") ||
    path.startsWith("evals/") ||
    path.startsWith("scripts/skills/") ||
    TEST_DIRS.some((dir) => path.startsWith(dir))
  );
}

function kindOf(path: string): Kind {
  if (isFixture(path)) return "fixture";
  return isTest(path) ? "test" : "main";
}

/** 数えないファイルなら理由を、数えるなら undefined を返す。private skill の原本は数える。 */
function excludedReason(path: string, privateSkills: ReadonlySet<string>): string | undefined {
  if (RECORD_DIRS.some((dir) => path.startsWith(dir))) return "記録";
  if (path.startsWith(".agents/skills/") && privateSkills.has(path.split("/")[2] ?? ""))
    return undefined;
  if (INSTALLED_DIRS.some((dir) => path.startsWith(dir))) return "インストール済みのコピー";
  if (
    EXCLUDED_FILES.has(path) ||
    EXCLUDED_DIRS.some((dir) => path.startsWith(dir)) ||
    ROOT_CONFIG.test(path)
  ) {
    return "生成物と設定";
  }
  return undefined;
}

/** スキルの置き場所の下なら、そのスキルの名前を返す。それ以外と `scripts/skills/_cross/` は undefined。 */
function skillDirName(path: string): string | undefined {
  const parts = path.split("/");
  // 名前の階層の下にファイルがあるときだけ、スキルの置き場所とみなす（`skills/README.md` は共通）。
  const at = (depth: number) => (parts.length > depth + 1 ? parts[depth] : undefined);
  if (path.startsWith("scripts/skills/")) {
    const name = at(2);
    return name === "_cross" ? undefined : name;
  }
  if (path.startsWith(".agents/skills/")) return at(2);
  if (path.startsWith("skills/") || path.startsWith("evals/")) return at(1);
  return undefined;
}

/**
 * 1 つのファイルを、数えないか、どの行（スキルかリポジトリ共通）のどの種類かに分ける。
 * skills は配布するスキルの名前、privateSkills は private skill の名前。
 */
export function classify(
  path: string,
  skills: ReadonlySet<string>,
  privateSkills: ReadonlySet<string>,
): Classified {
  const reason = excludedReason(path, privateSkills);
  if (reason !== undefined) return { excluded: true, reason };
  const kind = kindOf(path);
  const name = skillDirName(path);
  if (name === undefined) return { excluded: false, owner: COMMON, kind };
  if (!skills.has(name) && !privateSkills.has(name)) {
    throw new Error(`${path}: スキルとして知らない名前「${name}」の置き場所にある`);
  }
  return { excluded: false, owner: name, kind };
}

/** 行数。改行の数に、最後の行に改行が無ければ 1 を足す。NUL を含むならバイナリとして null を返す。 */
export function countLines(content: Buffer): number | null {
  if (content.includes(0)) return null;
  let lines = 0;
  for (const byte of content) if (byte === 0x0a) lines++;
  if (content.length > 0 && content[content.length - 1] !== 0x0a) lines++;
  return lines;
}

export type Cell = { files: number; lines: number };
export type Row = { owner: string } & Record<Kind, Cell>;
export type Report = { commit: string; rows: Row[]; excluded: Record<string, number> };

function emptyRow(owner: string): Row {
  return {
    owner,
    main: { files: 0, lines: 0 },
    test: { files: 0, lines: 0 },
    fixture: { files: 0, lines: 0 },
  };
}

export type Entry = { path: string; mode: string; content: Buffer };

/** ファイルの一覧から、行ごとの集計を作る。スキルの行は名前の順、最後にリポジトリ共通の行を置く。 */
export function summarize(commit: string, entries: readonly Entry[]): Report {
  const paths = entries.map((e) => e.path);
  const skills = new Set(
    paths.filter((p) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).map((p) => p.split("/")[1] ?? ""),
  );
  const privateSkills = new Set(
    paths
      .filter((p) => /^\.agents\/skills\/[^/]+\/\.private-skill$/.test(p))
      .map((p) => p.split("/")[2] ?? ""),
  );
  const rows = new Map<string, Row>();
  for (const name of [...skills, ...privateSkills]) rows.set(name, emptyRow(name));
  rows.set(COMMON, emptyRow(COMMON));
  const excluded: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.mode === "120000") {
      excluded["シンボリックリンク"] = (excluded["シンボリックリンク"] ?? 0) + 1;
      continue;
    }
    const c = classify(entry.path, skills, privateSkills);
    if (c.excluded) {
      excluded[c.reason] = (excluded[c.reason] ?? 0) + 1;
      continue;
    }
    const cell = (rows.get(c.owner) ?? emptyRow(c.owner))[c.kind];
    cell.files++;
    cell.lines += countLines(entry.content) ?? 0;
  }
  const skillRows = [...rows.values()]
    .filter((r) => r.owner !== COMMON)
    .sort((a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0));
  return { commit, rows: [...skillRows, rows.get(COMMON) ?? emptyRow(COMMON)], excluded };
}

function sumRows(owner: string, rows: readonly Row[]): Row {
  const total = emptyRow(owner);
  for (const row of rows)
    for (const kind of KINDS) {
      total[kind].files += row[kind].files;
      total[kind].lines += row[kind].lines;
    }
  return total;
}

const n = (value: number) => value.toLocaleString("en-US");

/** 集計を Markdown の表にする。スキルの小計と、全体の合計を足す。 */
export function formatMarkdown(report: Report): string {
  const skillRows = report.rows.filter((r) => r.owner !== COMMON);
  const common = report.rows.filter((r) => r.owner === COMMON);
  const line = (r: Row) =>
    `| ${r.owner} | ${KINDS.map((k) => `${n(r[k].files)} | ${n(r[k].lines)}`).join(" | ")} |`;
  const excluded = Object.entries(report.excluded)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([reason, count]) => `${reason} ${n(count)} 件`)
    .join("、");
  return [
    "# リポジトリの規模",
    "",
    "`node scripts/tools/repo-size.ts` の出力で、手で書き換えない。数え方はスクリプトの冒頭のコメントにある。",
    "",
    `commit: ${report.commit}`,
    "",
    "| スキル | 本体のファイル | 本体の行 | テストのファイル | テストの行 | fixture のファイル | fixture の行 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...skillRows.map(line),
    line(sumRows("スキルの小計", skillRows)),
    ...common.map(line),
    line(sumRows("合計", report.rows)),
    "",
    `数えなかったファイル: ${excluded || "なし"}`,
    "",
  ].join("\n");
}

function git(cwd: string, args: readonly string[], input?: string): Buffer {
  const res = spawnSync("git", args, { cwd, input, maxBuffer: 1 << 30, timeout: 120_000 });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr.toString()}`);
  return res.stdout;
}

/** rev の commit にあるファイルを、mode と中身付きで読む。 */
function readTree(cwd: string, rev: string): { commit: string; entries: Entry[] } {
  const commit = git(cwd, ["rev-parse", "--verify", `${rev}^{commit}`])
    .toString()
    .trim();
  const records = git(cwd, ["ls-tree", "-r", "-z", "--full-tree", commit])
    .toString()
    .split("\0")
    .filter(Boolean);
  const listed = records.map((record) => {
    const tab = record.indexOf("\t");
    const [mode = "", type = "", sha = ""] = record.slice(0, tab).split(" ");
    return { mode, type, sha, path: record.slice(tab + 1) };
  });
  // submodule（commit）は中身を持たないので数えない。
  const blobs = listed.filter((e) => e.type === "blob");
  const out = git(cwd, ["cat-file", "--batch"], blobs.map((b) => `${b.sha}\n`).join(""));
  const entries: Entry[] = [];
  let offset = 0;
  for (const blob of blobs) {
    const headerEnd = out.indexOf(0x0a, offset);
    const [sha, type, size] = out.subarray(offset, headerEnd).toString().split(" ");
    if (sha !== blob.sha || type !== "blob" || size === undefined)
      throw new Error(`git cat-file の出力を読めない（${blob.path}）`);
    const start = headerEnd + 1;
    const end = start + Number(size);
    entries.push({ path: blob.path, mode: blob.mode, content: out.subarray(start, end) });
    offset = end + 1;
  }
  return { commit, entries };
}

export function main(args: readonly string[], cwd = "."): number {
  const json = args.includes("--json");
  const rest = args.filter((a) => a !== "--json");
  if (rest.length > 1 || rest.some((a) => a.startsWith("-"))) {
    console.error("使い方: node scripts/tools/repo-size.ts [--json] [<rev>]");
    return 2;
  }
  let report: Report;
  try {
    const { commit, entries } = readTree(cwd, rest[0] ?? "HEAD");
    // 0 件は、対象が無いのではなく走査の範囲を取り違えている（集計できない）。
    if (entries.length === 0) throw new Error(`${commit} にファイルが 0 件`);
    report = summarize(commit, entries);
  } catch (error) {
    console.error(`repo-size: 集計できない: ${errorMessage(error)}`);
    return 2;
  }
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatMarkdown(report));
  return 0;
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
