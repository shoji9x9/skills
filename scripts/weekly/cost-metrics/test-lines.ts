// テストと実装の行数を数え、直近の期間の増分と比を出す（Issue #1109）。
// check-cost-metrics.ts が週次の指標の 1 つとして呼び、テストが実装に比べて増えすぎた週（テスト ÷ 実装の比の上昇率が上限を超えた週）に候補として挙げる。
// テストを消すか、まとめるかは人が決める。重複したテストの候補は、週次のセルフ点検（docs/self-review-procedure.md）が挙げる。
//
// 数えるファイルは、設定の tests と implementation の glob（git の pathspec の glob）で決める。
// implementation の glob に当たるファイルのうち、tests の glob に当たるものは実装として数えない。
// 行数は `git grep -c ''` で、HEAD と、直近の期間の始まりの時点の first-parent の commit の両方で数える。
// 作業ツリーではなく commit を数えるので、前の時点のために checkout し直さない。
// 行数の増えたテストのファイルの表では、名前を変えたテストを前の名前の行数と比べる。名前の変更は、2 つの commit の
// `git diff -M` がテストの glob の中で見つけたものだけを使う（glob の外から移したファイルは、新しいファイルとして数える）。
//
// 確かめられないものを「該当なし」として扱わない。次のときは例外にする。
// - 期間の始まりより前の commit が無い（履歴が浅い・リポジトリが新しい）
// - どちらかの時点で、tests か implementation の glob に当たるファイルが 1 件も無い（glob の誤りを 0 行として扱わない）
// - git の出力の行が、パスと行数の形でない
//
// 週次のセルフ点検（.github/workflows/self-review.yml）は、費用の指標に候補が出ない週も重複したテストを探せるよう、
// この CLI で同じ表を作ってエージェントの入力に置く。費用の指標の追跡 Issue は、候補が 0 件の週には閉じるからである。
// self-review.yml は依存を入れずにこの CLI を起動するので、外部のパッケージを import しない（node: とリポジトリのモジュールだけにする）。
// 使い方: node scripts/weekly/cost-metrics/test-lines.ts --out <表のパス> [--config <check-cost-metrics.json のパス>]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../../lib/cli/args.ts";
import { isCliEntry } from "../../lib/cli/entry.ts";
import { errorMessage } from "../../lib/errors.ts";
import { isNonBlankString, isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";
import { defaultRunner, type Runner } from "./runner.ts";
import { naturalOrder, tableCell } from "../../lib/text/tracking-diff.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * days は比べる期間、tests と implementation は数えるファイルの glob、
 * maxRatioIncreasePercent は、テスト ÷ 実装の比が前の時点から上がる割合の上限（百分率の整数。これを超えたら挙げる）。
 */
export type TestLinesConfig = {
  days: number;
  tests: string[];
  implementation: string[];
  maxRatioIncreasePercent: number;
};

/** 1 つの時点の、パスごとの行数。 */
export type Snapshot = {
  commit: string;
  tests: Map<string, number>;
  implementation: Map<string, number>;
};
/** renames は、名前を変えたテストの今の名前から前の名前への対応。 */
export type TestLinesMetrics = {
  current: Snapshot;
  previous: Snapshot;
  renames: Map<string, string>;
};

export type TestLinesFinding = { kind: "test-growth"; target: string; detail: string };

function globList(value: unknown, where: string): string[] {
  if (!isArray(value) || value.length === 0 || !value.every(isNonBlankString)) {
    throw new Error(`${where} が、空でない文字列の空でない配列でない`);
  }
  const bad = value.find((g) => !isPlainGlob(g));
  if (bad !== undefined) throw new Error(`${where} に、: か / で始まる値がある: ${bad}`);
  return [...value];
}

/** check-cost-metrics.json の test_lines の節を読む。足りない・型の違う項目は例外にする。 */
export function parseTestLinesConfig(value: unknown): TestLinesConfig {
  if (!isRecord(value)) throw new Error("test_lines がオブジェクトでない");
  const days = value["days"];
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
    throw new Error("test_lines.days が正の数でない");
  }
  const percent = value["max_ratio_increase_percent"];
  if (typeof percent !== "number" || !Number.isInteger(percent) || percent < 0) {
    throw new Error("test_lines.max_ratio_increase_percent が 0 以上の整数でない");
  }
  return {
    days,
    tests: globList(value["tests"], "test_lines.tests"),
    implementation: globList(value["implementation"], "test_lines.implementation"),
    maxRatioIncreasePercent: percent,
  };
}

/**
 * 設定の値が、`:(glob)` の後にそのまま置ける素の glob かを返す。設定の読み込みで、空の値と、
 * `:` で始まる値（pathspec の別の記法と読まれる）と `/` で始まる値（ファイルシステムの絶対パスと読まれる）を拒否する。
 */
export function isPlainGlob(value: string): boolean {
  return value !== "" && !value.startsWith(":") && !value.startsWith("/");
}

/**
 * `git grep -z -c '' <commit>` の出力を、パスごとの行数にする。形が違えば例外にする。
 * 1 件は `<commit>:<パス>` と NUL と行数と改行である。`-z` でもパスは引用されず、改行を含むパスは改行をそのまま含むので、
 * 改行で区切ってから読まない。NUL までをパスとして読み、その後の改行までを行数として読む（行数は数字だけなので改行を含まない）。
 */
export function parseCounts(output: string, commit: string): Map<string, number> {
  const counts = new Map<string, number>();
  const prefix = `${commit}:`;
  let pos = 0;
  while (pos < output.length) {
    const nul = output.indexOf("\0", pos);
    const newline = nul < 0 ? -1 : output.indexOf("\n", nul);
    const end = newline < 0 ? output.length : newline;
    const name = output.slice(pos, nul < 0 ? end : nul);
    const count = nul < 0 ? "" : output.slice(nul + 1, end);
    if (!name.startsWith(prefix) || !/^\d+$/u.test(count)) {
      throw new Error(
        `git grep の出力がパスと行数の形でない: ${JSON.stringify(output.slice(pos, end))}`,
      );
    }
    counts.set(name.slice(prefix.length), Number(count));
    pos = end + 1;
  }
  return counts;
}

/** `git diff -z --name-status --diff-filter=R` の出力（`R<類似度>`・前の名前・今の名前の並び）を、今の名前から前の名前への対応にする。 */
export function parseRenames(output: string): Map<string, string> {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 3 !== 0) throw new Error("git diff の名前の変更の出力が 3 つ組でない");
  const renames = new Map<string, string>();
  for (let i = 0; i < fields.length; i += 3) {
    const [status = "", from = "", to = ""] = fields.slice(i, i + 3);
    if (!/^R\d+$/u.test(status) || from === "" || to === "") {
      throw new Error(`git diff の名前の変更の出力の形でない: ${JSON.stringify(status)}`);
    }
    renames.set(to, from);
  }
  return renames;
}

type Git = (args: string[]) => Promise<string>;

const globs = (values: readonly string[], magic: string): string[] =>
  values.map((g) => `:(${magic})${g}`);

/**
 * commit で pathspecs に当たるファイルの行数を数える。当たるファイルが無いと git grep は終了コード 1 で終わり、
 * 本番の runner は例外にする。件数の確かめは、終了コード 0 で空の出力を返す runner でも 0 行として扱わないためにあり、
 * 増加率と比の割り算の分母が 0 にならないことも、これで決まる（git grep は 0 行のファイルを出力しない）。
 */
async function countLines(
  git: Git,
  commit: string,
  target: { pathspecs: string[]; what: string },
): Promise<Map<string, number>> {
  const { pathspecs, what } = target;
  const counts = parseCounts(
    await git(["grep", "-z", "-c", "", commit, "--", ...pathspecs]),
    commit,
  );
  if (counts.size === 0) throw new Error(`${commit} に、${what}の glob に当たるファイルが無い`);
  return counts;
}

async function snapshot(git: Git, commit: string, config: TestLinesConfig): Promise<Snapshot> {
  const [tests, implementation] = await Promise.all([
    countLines(git, commit, { pathspecs: globs(config.tests, "glob"), what: "テスト" }),
    countLines(git, commit, {
      pathspecs: [...globs(config.implementation, "glob"), ...globs(config.tests, "exclude,glob")],
      what: "実装",
    }),
  ]);
  return { commit, tests, implementation };
}

/** HEAD と、期間の始まりより前の最後の first-parent の commit で数える。その commit が無ければ例外にする。 */
export async function collectTestLines(
  run: Runner,
  input: { root: string; now: Date; config: TestLinesConfig },
): Promise<TestLinesMetrics> {
  const { root, now, config } = input;
  const git: Git = (args) => run("git", ["-C", root, ...args]);
  const before = new Date(now.getTime() - config.days * DAY_MS).toISOString();
  const [head, base] = (
    await Promise.all([
      git(["rev-parse", "HEAD"]),
      git(["rev-list", "-1", "--first-parent", `--before=${before}`, "HEAD"]),
    ])
  ).map((out) => out.trim());
  if (base === "") {
    throw new Error(`${before} より前の commit が無い（履歴が浅いか、期間より新しいリポジトリ）`);
  }
  // -l0 は、名前の変更を探すファイルの数の上限（diff.renameLimit。git のデフォルトは 1000）を外す（git help diff の -l<num>）。
  // 上限を超えると、git は警告を出すだけで終了コード 0 で終わり、移したテストを新しいファイルとして数える。
  const diff = ["diff", "-z", "-M", "-l0", "--name-status", "--diff-filter=R", base, head];
  const [current, previous, renamed] = await Promise.all([
    snapshot(git, head, config),
    snapshot(git, base, config),
    git([...diff, "--", ...globs(config.tests, "glob")]),
  ]);
  return { current, previous, renames: parseRenames(renamed) };
}

function total(counts: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const n of counts.values()) sum += n;
  return sum;
}

/** 前の時点からの増加率。分母が 0 にならないことは countLines が決める。 */
function growth(current: number, previous: number): number {
  return (current - previous) / previous;
}

type Totals = {
  tests: number;
  previousTests: number;
  implementation: number;
  previousImplementation: number;
};

function totals(metrics: TestLinesMetrics): Totals {
  return {
    tests: total(metrics.current.tests),
    previousTests: total(metrics.previous.tests),
    implementation: total(metrics.current.implementation),
    previousImplementation: total(metrics.previous.implementation),
  };
}

function percent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

/** テスト ÷ 実装の比が、前の時点から上がった割合（表示に使う）。テストが実装と同じ割合で増えれば 0 になる。 */
function ratioIncrease(t: Totals): number {
  return t.tests / t.implementation / (t.previousTests / t.previousImplementation) - 1;
}

/**
 * 比の上昇率が percent % を超えたか。割り算を重ねると、上限とちょうど同じ値が浮動小数点数の誤差で上回るので、
 * 両辺に分母を掛けた整数の比較（100 × T × 前の I > (100 + p) × I × 前の T）で決める。
 * 行数の積は数千万行の規模まで Number.MAX_SAFE_INTEGER に収まる。
 */
function ratioIncreaseExceeds(t: Totals, percent: number): boolean {
  return (
    100 * t.tests * t.previousImplementation > (100 + percent) * t.implementation * t.previousTests
  );
}

/**
 * テスト ÷ 実装の比の上昇率が上限を超えたら 1 件挙げる。
 * テストが実装より少し多く増えただけの週や、テストと実装が同じ割合で大きく増えた週は挙げない。
 */
export function testLinesFindings(
  metrics: TestLinesMetrics,
  config: TestLinesConfig,
): TestLinesFinding[] {
  const t = totals(metrics);
  if (!ratioIncreaseExceeds(t, config.maxRatioIncreasePercent)) return [];
  const testGrowth = growth(t.tests, t.previousTests);
  const implGrowth = growth(t.implementation, t.previousImplementation);
  return [
    {
      kind: "test-growth",
      target: config.tests.join("、"),
      detail: `直近 ${config.days} 日でテスト ${signed(t.tests - t.previousTests)} 行（${percent(testGrowth)}）、実装 ${signed(t.implementation - t.previousImplementation)} 行（${percent(implGrowth)}）、テスト ÷ 実装の比 ${percent(ratioIncrease(t))}（上限 +${config.maxRatioIncreasePercent}%）`,
    },
  ];
}

/** 行数の増えたテストのファイルを、すべて増分の大きい順に返す。名前を変えたファイルは、前の名前の行数と比べる。 */
export function grownTestFiles(
  metrics: TestLinesMetrics,
): { path: string; lines: number; delta: number }[] {
  return [...metrics.current.tests]
    .map(([path, lines]) => ({
      path,
      lines,
      delta: lines - (metrics.previous.tests.get(metrics.renames.get(path) ?? path) ?? 0),
    }))
    .filter((f) => f.delta > 0)
    .sort((a, b) => b.delta - a.delta || naturalOrder(a.path, b.path));
}

function ratio(tests: number, implementation: number): string {
  return (tests / implementation).toFixed(3);
}

/** 追跡 Issue の本文に載せる表。セルフ点検が、重複したテストを探す起点にする。 */
export function testLinesTable(metrics: TestLinesMetrics, config: TestLinesConfig): string[] {
  const t = totals(metrics);
  const files = grownTestFiles(metrics);
  const fileRows =
    files.length === 0
      ? ["行数の増えたテストのファイルは無い。"]
      : [
          "| テストのファイル | 行数 | 増分 |",
          "| --- | --- | --- |",
          ...files.map((f) => `| ${tableCell(f.path)} | ${f.lines} | ${signed(f.delta)} |`),
        ];
  return [
    `<details><summary>テストと実装の行数（直近 ${config.days} 日）</summary>`,
    "",
    `| 種類 | 今 | ${config.days} 日前 | 増分 | 増加率 |`,
    "| --- | --- | --- | --- | --- |",
    `| テスト | ${t.tests} | ${t.previousTests} | ${signed(t.tests - t.previousTests)} | ${percent(growth(t.tests, t.previousTests))} |`,
    `| 実装 | ${t.implementation} | ${t.previousImplementation} | ${signed(t.implementation - t.previousImplementation)} | ${percent(growth(t.implementation, t.previousImplementation))} |`,
    `| テスト ÷ 実装 | ${ratio(t.tests, t.implementation)} | ${ratio(t.previousTests, t.previousImplementation)} | | ${percent(ratioIncrease(t))} |`,
    "",
    `テストは \`${config.tests.join("`・`")}\`、実装は \`${config.implementation.join("`・`")}\` のうちテストでないファイルの行数で、HEAD（${metrics.current.commit.slice(0, 7)}）と ${config.days} 日前の first-parent の commit（${metrics.previous.commit.slice(0, 7)}）で数えた。`,
    "",
    `行数の増えたテストのファイル（${files.length} 件。増分の大きい順）`,
    "",
    ...fileRows,
    "",
    "</details>",
    "",
  ];
}

// ---- 実行

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), "check-cost-metrics.json");
const USAGE =
  "使い方: node scripts/weekly/cost-metrics/test-lines.ts --out <表のパス> [--config <check-cost-metrics.json のパス>]";

/** 表を --out に書く。確かめられなければ 1、引数の誤りは 2 を返す。`options` はテストが時刻と作業ディレクトリを渡すためにある。 */
export async function main(
  args: string[],
  options: { root?: string; now?: Date } = {},
): Promise<number> {
  let parsed: Record<string, string>;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    console.error(`test-lines: ${errorMessage(error)}\n${USAGE}`);
    return 2;
  }
  const { out, config = CONFIG, ...rest } = parsed;
  if (out === undefined || Object.keys(rest).length > 0) {
    console.error(USAGE);
    return 2;
  }
  try {
    const json: unknown = JSON.parse(readFileSync(config, "utf8"));
    const testLines = parseTestLinesConfig(isRecord(json) ? json["test_lines"] : undefined);
    const metrics = await collectTestLines(defaultRunner, {
      root: options.root ?? process.cwd(),
      now: options.now ?? new Date(),
      config: testLines,
    });
    writeFileSync(out, testLinesTable(metrics, testLines).join("\n"));
    return 0;
  } catch (error) {
    console.error(`test-lines: 確かめられない: ${errorMessage(error)}`);
    return 1;
  }
}

if (isCliEntry(import.meta.url)) process.exit(await main(process.argv.slice(2)));
