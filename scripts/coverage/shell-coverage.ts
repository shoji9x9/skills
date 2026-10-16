// シェルスクリプトの行のカバレッジを、bash の xtrace の記録から集計する。
//
// 記録は bash-trace-env.sh が書く（BASH_ENV で、テストが起動するすべての非対話の bash に読み込ませる）。
// 記録の 1 行は `+SHCOV<TAB><BASH_SOURCE><TAB><LINENO><TAB><コマンド>` の形で、先頭の + は入れ子の深さの分だけ並ぶ。
// ファイルの先頭の `#CWD<TAB><dir>` は、そのプロセスを起動したときの作業ディレクトリである。
// `#HASH<TAB><path><TAB><sha256>` は、起動したスクリプトと同じディレクトリの *.sh の内容のハッシュである。
// テストが一時ディレクトリにコピーして実行したスクリプトは、原本と内容が同じなら原本の記録として数える。
//
// 分母（実行できる行）は、`shfmt --to-json` の構文木から取る。bash の xtrace は、単純なコマンド・宣言・
// `[[ ]]`・`(( ))`・`for`・`case` を、文の開始行の LINENO で記録する。そこで、これらの文の開始行を実行できる行とする。
// `if`・`while`・`{ }`・`( )`・`&&` の連なり・関数の定義は、それ自体は記録されないので、中の文だけを数える。
// 行を正規表現で数えると、heredoc の本文や複数行に分けた引数を文として数えてしまうので、構文木を使う。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { errorMessage } from "../lib/errors.ts";
import { isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";

/**
 * xtrace が開始行で記録する文の種類（shfmt の `Cmd.Type`）。
 * `for` は反復が 0 回だと記録されないので、実行しても未実行に見える。数えず、本体の文で数える。
 */
const TRACED_COMMANDS = new Set([
  "CallExpr",
  "DeclClause",
  "TestClause",
  "ArithmCmd",
  "LetClause",
  "CaseClause",
]);

/** 1 ファイルの行のカバレッジ。形は c8 の json-summary の `lines` に合わせる。 */
export type LineCoverage = { total: number; covered: number; pct: number; uncovered: number[] };

/**
 * shfmt の構文木から、実行できる行（1 始まり）を昇順で返す。
 * 文（`Cmd` を持つノード）のうち、xtrace が記録する種類だけの開始行を集める。
 */
export function executableLines(ast: unknown): number[] {
  const lines = new Set<number>();
  const visit = (node: unknown): void => {
    if (isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isRecord(node)) return;
    const cmd = node.Cmd;
    if (isRecord(cmd) && typeof cmd.Type === "string" && TRACED_COMMANDS.has(cmd.Type)) {
      const line = isRecord(node.Pos) ? node.Pos.Line : undefined;
      if (typeof line !== "number")
        throw new Error(`文の開始行を読めない: ${JSON.stringify(node.Pos)}`);
      lines.add(line);
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(ast);
  return [...lines].sort((a, b) => a - b);
}

/** シェルスクリプトを shfmt で構文木にする。解析できないときは、判定できないとして例外にする。 */
export function parseShell(path: string): unknown {
  let out: string;
  try {
    // `--to-json` は stdin からしか読まない。
    out = execFileSync("shfmt", ["--to-json", "--language-dialect", "bash"], {
      input: readFileSync(path, "utf8"),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`shfmt で ${path} を解析できない: ${errorMessage(error)}`, { cause: error });
  }
  return JSON.parse(out);
}

/** 記録の 1 件（実行したファイルのパスと行）。`source` は記録したままの値（相対パスのこともある）。 */
export type TraceHit = { source: string; cwd: string; line: number };
/** 1 プロセス分の記録。`hashes` は、記録したファイルの絶対パスから内容のハッシュへの対応である。 */
export type Trace = { hits: TraceHit[]; hashes: Map<string, string> };

const TRACE_LINE = /^\++SHCOV\t([^\t]*)\t(\d+)\t/;

/**
 * 1 プロセス分の記録を読む。`#CWD` の行より前の記録と、BASH_SOURCE が空の記録（`bash -c` の本文）は捨てる。
 * コマンドの本文に改行が含まれると、続きの行は記録の形にならないので、記録として読まない。
 */
export function parseTrace(text: string): Trace {
  const hits: TraceHit[] = [];
  const hashes = new Map<string, string>();
  let cwd: string | undefined;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("#CWD\t")) {
      cwd = raw.slice("#CWD\t".length);
      continue;
    }
    const hash = /^#HASH\t(.+)\t([0-9a-f]{64})$/.exec(raw);
    if (hash) {
      hashes.set(resolve(hash[1]), hash[2]);
      continue;
    }
    const m = TRACE_LINE.exec(raw);
    if (!m || cwd === undefined || m[1] === "") continue;
    hits.push({ source: m[1], cwd, line: Number(m[2]) });
  }
  return { hits, hashes };
}

/** 記録のパスの絶対パス。 */
function absSource(hit: TraceHit): string {
  return isAbsolute(hit.source) ? resolve(hit.source) : resolve(hit.cwd, hit.source);
}

/** 記録のパスを、実在するファイルの実体のパスにする。解決できなければ null。 */
function resolveSource(abs: string, cache: Map<string, string | null>): string | null {
  if (!cache.has(abs)) {
    let real: string | null = null;
    try {
      real = realpathSync(abs);
    } catch {
      real = null;
    }
    cache.set(abs, real);
  }
  return cache.get(abs) ?? null;
}

/** 集計の結果。`unresolved` は、実在するファイルに解決できなかった記録の件数である。 */
export type ShellCoverageResult = { files: Record<string, LineCoverage>; unresolved: number };

/**
 * 記録のディレクトリと対象のファイル（`root` からの相対パス）から、ファイルごとの行のカバレッジを出す。
 * 対象の外のファイル（インストール済みのコピー・一時ファイル）の記録は数えない。
 */
export function shellCoverage(
  root: string,
  targets: readonly string[],
  traceDir: string,
): ShellCoverageResult {
  const realToTarget = new Map<string, string>();
  // 内容が同じ対象（同じスクリプトを 2 つのスキルが持つなど）は、コピーの実行をどちらにも数える。
  const hashToTargets = new Map<string, string[]>();
  for (const rel of targets) {
    const path = join(root, rel);
    realToTarget.set(realpathSync(path), rel);
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    hashToTargets.set(hash, [...(hashToTargets.get(hash) ?? []), rel]);
  }

  const executed = new Map<string, Set<number>>();
  const cache = new Map<string, string | null>();
  let unresolved = 0;
  for (const name of readdirSync(traceDir)) {
    if (!name.startsWith("trace.")) continue;
    const trace = parseTrace(readFileSync(join(traceDir, name), "utf8"));
    for (const hit of trace.hits) {
      const abs = absSource(hit);
      const real = resolveSource(abs, cache);
      const hash = trace.hashes.get(abs);
      const direct = real === null ? undefined : realToTarget.get(real);
      const rels =
        direct !== undefined ? [direct] : hash === undefined ? [] : (hashToTargets.get(hash) ?? []);
      if (rels.length === 0) {
        if (real === null) unresolved += 1;
        continue;
      }
      for (const rel of rels) {
        let set = executed.get(rel);
        if (!set) executed.set(rel, (set = new Set()));
        set.add(hit.line);
      }
    }
  }

  const files: Record<string, LineCoverage> = {};
  for (const rel of targets) {
    const lines = executableLines(parseShell(join(root, rel)));
    const hits = executed.get(rel) ?? new Set<number>();
    const uncovered = lines.filter((line) => !hits.has(line));
    const covered = lines.length - uncovered.length;
    const pct = lines.length === 0 ? 100 : Math.round((covered / lines.length) * 10000) / 100;
    files[rel] = { total: lines.length, covered, pct, uncovered };
  }
  return { files, unresolved };
}
