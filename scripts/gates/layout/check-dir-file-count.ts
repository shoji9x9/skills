#!/usr/bin/env node
// 1 つのディレクトリの直下のファイル数を、閾値以下に保つ（lefthook pre-commit + CI）。
//
// なぜ要るか: 1 つのディレクトリにファイルが増えると、目的のファイルを探しにくくなり、役割ごとのまとまりも読めなくなる。
// 散文の規約だけでは、ファイルを足し続けてもエラーにならない。
//
// 数え方は次のとおり。
// - 対象は git の index にあるファイル（`git ls-files`）。`node_modules` や生成物は `.gitignore` で外れる。
//   未追跡のファイルは commit に入らないので数えない。衝突を解消していないファイルも 1 件として数える。
// - 各ディレクトリの直下のファイルを数える。サブディレクトリとその中身は数えず、シンボリックリンクはファイルとして数える。
// - 閾値はデフォルトの値（`default_max`）か、ディレクトリごとの値（`overrides`）。対象外のディレクトリ（`excludes`）は数えない。
//   `descendants: true` の対象外は、そのディレクトリの下のディレクトリもすべて数えない（人ごとに作られるディレクトリなど）。
// - 閾値を変えたディレクトリと対象外のディレクトリには、理由を必須にする。
//   設定に書いたディレクトリが実在しないと失敗にする。古い例外が残ると、同じ名前で作り直したディレクトリが警告なしに外れる。
//
// 終了コード: 0 は違反なし、1 は違反か設定の古い記述、2 は判定できない（設定の形の誤り・git の失敗・ファイルが 0 件）。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../../lib/errors.ts";
import { isNonBlankString, isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";

export const CONFIG_PATH = "scripts/gates/layout/dir-file-count.json";
/** リポジトリのルートを表す `dir` の値。 */
export const ROOT_DIR = ".";

export type Override = { dir: string; max: number; reason: string };
export type Exclude = { dir: string; reason: string; descendants: boolean };
export type Config = { defaultMax: number; overrides: Override[]; excludes: Exclude[] };

/** 0 以上の整数か。 */
function isCount(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

/** 未知のキーを拒否する（`reasons` のような綴りの誤りで、理由の必須を外さないため）。 */
function assertKeys(where: string, value: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(value).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new Error(`${where}: 未知のキー ${unknown.join(", ")}`);
}

/** `dir` の書き方を 1 つにそろえる（`./a`・`a/`・`a//b` を拒否する）。比べるときに表記の揺れで外れないようにする。 */
function assertDir(where: string, dir: unknown): asserts dir is string {
  if (typeof dir !== "string" || dir === "")
    throw new Error(`${where}: dir は空でない文字列にする`);
  if (dir === ROOT_DIR) return;
  if (
    posix.normalize(dir) !== dir ||
    dir.startsWith("/") ||
    dir.endsWith("/") ||
    dir === ".." ||
    dir.startsWith("../")
  ) {
    throw new Error(
      `${where}: dir「${dir}」はルートからの相対パスで、. や .. や末尾の / を含めずに書く（ルートは "."）`,
    );
  }
}

/** 設定の JSON を読む。形の誤りは例外にする（理由が空でも、ここでは落とさない。checkConfig が違反として報告する）。 */
export function parseConfig(data: unknown): Config {
  if (!isRecord(data)) throw new Error("設定は object にする");
  assertKeys("設定", data, ["$comment", "default_max", "overrides", "excludes"]);
  const { default_max: defaultMax, overrides = [], excludes = [] } = data;
  if (!isCount(defaultMax)) throw new Error("default_max は 0 以上の整数にする");
  if (!isArray(overrides) || !isArray(excludes))
    throw new Error("overrides と excludes は配列にする");

  const parsedOverrides = overrides.map((entry, i): Override => {
    const where = `overrides[${i}]`;
    if (!isRecord(entry)) throw new Error(`${where}: object にする`);
    assertKeys(where, entry, ["dir", "max", "reason"]);
    const { dir, max, reason } = entry;
    assertDir(where, dir);
    if (!isCount(max)) throw new Error(`${where}: max は 0 以上の整数にする`);
    if (typeof reason !== "string") throw new Error(`${where}: reason は文字列にする`);
    return { dir, max, reason };
  });
  const parsedExcludes = excludes.map((entry, i): Exclude => {
    const where = `excludes[${i}]`;
    if (!isRecord(entry)) throw new Error(`${where}: object にする`);
    assertKeys(where, entry, ["dir", "reason", "descendants"]);
    const { dir, reason, descendants = false } = entry;
    assertDir(where, dir);
    if (typeof reason !== "string") throw new Error(`${where}: reason は文字列にする`);
    if (typeof descendants !== "boolean") throw new Error(`${where}: descendants は真偽値にする`);
    // ルートを下のディレクトリごと外すと、設定 1 行でチェック全体が何も数えなくなり、それでも OK を出す。
    if (dir === ROOT_DIR && descendants)
      throw new Error(
        `${where}: ルート（"."）は descendants で対象外にできない（すべてのディレクトリを数えなくなる）`,
      );
    return { dir, reason, descendants };
  });

  const seen = new Set<string>();
  for (const { dir } of [...parsedOverrides, ...parsedExcludes]) {
    if (seen.has(dir))
      throw new Error(
        `dir「${dir}」が重複している（閾値を変えるか対象外にするかの、どちらか 1 つにする）`,
      );
    seen.add(dir);
  }
  return { defaultMax, overrides: parsedOverrides, excludes: parsedExcludes };
}

/** ファイルのパスの、親のディレクトリ（ルート直下なら "."）。 */
function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? ROOT_DIR : path.slice(0, i);
}

/** 直下のファイル数（ディレクトリごと）と、実在するディレクトリ（ファイルを 1 つ以上下に持つもの）。 */
export function countFiles(files: readonly string[]) {
  const direct = new Map<string, number>();
  const dirs = new Set<string>([ROOT_DIR]);
  for (const file of files) {
    const parent = parentDir(file);
    direct.set(parent, (direct.get(parent) ?? 0) + 1);
    for (let d = parent; d !== ROOT_DIR; d = parentDir(d)) dirs.add(d);
  }
  return { direct, dirs };
}

/** `dir` を対象外にする設定があれば、それを返す。 */
function excludeOf(dir: string, excludes: readonly Exclude[]): Exclude | undefined {
  return excludes.find((e) => e.dir === dir || (e.descendants && dir.startsWith(`${e.dir}/`)));
}

/** 違反（閾値の超過）と、設定の古い記述・空の理由を返す。 */
export function checkDirFileCount(files: readonly string[], config: Config) {
  const { direct, dirs } = countFiles(files);
  const configErrors: string[] = [];
  for (const { dir, reason } of [...config.overrides, ...config.excludes]) {
    if (!dirs.has(dir)) configErrors.push(`${dir}: git 管理下に無いディレクトリ（設定から外す）`);
    if (!isNonBlankString(reason))
      configErrors.push(`${dir}: reason が空（閾値を変える・対象外にする理由を書く）`);
  }
  // descendants の対象外の下に書いた閾値と対象外は判定に使われない。使われない設定を残さない
  // （残すと、親の descendants を外したときに、見直していない子の設定が警告なしに有効になる）。
  for (const entry of [...config.overrides, ...config.excludes]) {
    const ex = excludeOf(
      entry.dir,
      config.excludes.filter((e) => e !== entry),
    );
    if (ex)
      configErrors.push(
        `${entry.dir}: 対象外（${ex.dir}）の下にあるので、この設定は使われない（設定から外す）`,
      );
  }
  const maxOf = new Map(config.overrides.map((o) => [o.dir, o.max]));
  const violations: string[] = [];
  for (const [dir, count] of [...direct].sort(([a], [b]) => a.localeCompare(b))) {
    if (excludeOf(dir, config.excludes)) continue;
    const max = maxOf.get(dir) ?? config.defaultMax;
    if (count > max) violations.push(`${dir}: ${count} 件（閾値 ${max}）`);
  }
  // 直下のファイルが 0 件のディレクトリは direct に現れないが、閾値 0 の判定には要らない（0 件は常に閾値以下）。
  return { violations, configErrors };
}

/** 設定のファイルを読む。 */
export function loadConfig(root: string): Config {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) throw new Error(`${CONFIG_PATH} が無い`);
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}

/** `cwd` を含むリポジトリのルートと、index にあるファイル（ルートからの相対パス）。 */
export function listTrackedFiles(cwd: string) {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (top.status !== 0) throw new Error(`git のリポジトリのルートを特定できない: ${top.stderr}`);
  const root = top.stdout.trim();
  // 衝突を解消していない index は 1 つのパスを段ごとに持ち、ls-files は同じパスを最大 3 回出す。重複は Set で除く
  // （--deduplicate は git 2.31 から使えるオプションなので、git の版に依らない方法で除く）。
  const ls = spawnSync("git", ["ls-files", "-z", "--cached"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (ls.status !== 0)
    throw new Error(`git ls-files に失敗した（exit ${ls.status}）: ${ls.stderr}`);
  return { root, files: [...new Set(ls.stdout.split("\0").filter((p) => p !== ""))] };
}

export function main(cwd = "."): number {
  let root: string;
  let files: string[];
  let config: Config;
  try {
    ({ root, files } = listTrackedFiles(cwd));
    config = loadConfig(root);
  } catch (error) {
    console.error(`dir-file-count: 判定できない: ${errorMessage(error)}`);
    return 2;
  }
  // ファイルが 0 件なのは、対象が無いのではなく走査の範囲を取り違えている（判定できない）。
  if (files.length === 0) {
    console.error(
      `dir-file-count: git 管理下のファイルが 0 件（${root}）。判定できないので失敗にする`,
    );
    return 2;
  }
  const { violations, configErrors } = checkDirFileCount(files, config);
  if (configErrors.length) {
    console.error(`dir-file-count: ${CONFIG_PATH} に、直す記述がある。`);
    for (const e of configErrors) console.error(`  - ${e}`);
  }
  if (violations.length) {
    console.error("dir-file-count: 直下のファイル数が閾値を超えたディレクトリがある。");
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "対処: 役割ごとのサブディレクトリに分ける。分けられない理由があれば、" +
        `${CONFIG_PATH} の overrides（閾値を変える）か excludes（対象外にする）に、理由を付けて登録する。` +
        "どちらにするかの基準と分け方は docs/directory-layout.md にある。",
    );
  }
  if (configErrors.length || violations.length) return 1;
  console.log(`dir-file-count: OK（${files.length} ファイル）`);
  return 0;
}

// CLI として起動されたかは、両辺を実パスにそろえて比べる（片側だけを解決すると、symlink 経由の起動で何もせずに終わる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`dir-file-count: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(2);
  }
}

if (isCliEntry()) process.exit(main());
