// 新側のバージョン（new.commit・new.tree・new.dirty）を取り、JSON で標準出力に出す。
//
// 何のためか: リプレイスの記録（.replace/）と新側のソースを同じ git のリポジトリに置くと、記録を書くたびに作業ツリーが変わり、
// 記録を commit するたびに HEAD が進む。HEAD の SHA で照合すると、記録を書いただけで次のスキルが止まる。
// そこで、記録の置き場所（.replace/）を除いた新側のソースのツリーのハッシュ（new.tree）で照合する。
// 取り方の原本は replace-strategy の references/project-config.md「新側のバージョンの記録」である。
//
// 範囲: new.repo のディレクトリ（git のリポジトリのサブディレクトリなら、その下だけ）から、--artifacts のディレクトリを除いたもの。
// new.tree: HEAD のツリーから --artifacts を除いた、new.repo のディレクトリのツリーのハッシュ。
//   --artifacts が新側のディレクトリの中にあり commit にも含まれるときだけ、一時的な index に読んで外してから書く。
//   それ以外は除くものが無いので、commit のツリーから直接読む。
//   利用者の index（.git/index）と作業ツリーは変えない。commit していない変更は new.tree に入らないので、new.dirty で表す。
// new.dirty: 同じ範囲の git status --porcelain --untracked-files=all --ignore-submodules=none の出力が空でなければ true。
//   オプションは、利用者の git の設定（status.showUntrackedFiles・submodule.<name>.ignore）で出力が変わらないようにするために付ける。
//   --no-optional-locks で、status が index を書き直さないようにする。
// new.commit: HEAD の完全な SHA。人がどの commit で確かめたかを追うための値で、一致の判定には使わない。
// 新側が git で管理されていなければ、commit と tree を "none"、dirty を false にする。
// --rev <commit> を渡すと、HEAD の代わりにその commit から同じ範囲の tree を取る（デプロイした commit や、
//   変更宣言の commits.after を tree で照合するため）。作業ツリーとは関係が無いので、dirty は null にする。
//   git で管理されていない新側に --rev を渡すと、確かめる commit が無いので exit 2 にする（none を返さない）。
//
// 使い方: node source-version.mjs --repo <new.repo> [--artifacts <.replace のパス>] [--rev <commit>]
//   --artifacts のデフォルトは、作業ディレクトリの .replace である。
//
// 終了コード: 0 ＝ 取れた、2 ＝ 使い方の誤り・git を起動できない・新側に commit が無いなど（値を出していない）。

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NONE = "none";
const USAGE =
  "usage: node source-version.mjs --repo <new.repo> [--artifacts <.replace のパス>] [--rev <commit>]";
class UsageError extends Error {}

/** @type {string[] | null} */
let localEnvVars = null;

// git -c や環境で渡した設定（safe.directory など）。git も別のリポジトリで子を起動するときに受け継がせるので、外さない
const KEEP_CONFIG_ENV = new Set(["GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"]);

/**
 * 子の git に渡さない環境変数の名前。git が別のリポジトリで子の git を起動するときと同じ扱いにする。
 * git rev-parse --local-env-vars が出す、そのリポジトリだけに関わる変数（GIT_DIR・GIT_INDEX_FILE・GIT_NO_REPLACE_OBJECTS など）から、
 * 設定を渡す変数（KEEP_CONFIG_ENV）を除いたものを外す。hook などから受け継ぐと、--repo と別のリポジトリや別の状態を読むからである。
 * 一覧は git 自身から取る。手で持つと git の一覧とずれる。一覧は環境に依らないので、取るときに環境は変えない。
 * 一覧に無い変数は外さない。GIT_NAMESPACE は ref の名前空間を決めるが、このスクリプトは ref を列挙しないので値に影響しない。
 * GIT_CEILING_DIRECTORIES は利用者が探索を止める設定なので、受け継ぐ。新側のリポジトリの最上位を指していると、
 * その下のサブディレクトリの新側は git で管理されていないと判定され、none になる（最上位そのものの新側は影響を受けない）。
 * @returns {string[]}
 */
function repoLocalEnvVars() {
  if (localEnvVars === null) {
    let out;
    try {
      out = execFileSync("git", ["rev-parse", "--local-env-vars"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      throw gitError(e, "git の環境変数の一覧の取得");
    }
    localEnvVars = out.split("\n").filter((name) => name !== "" && !KEEP_CONFIG_ENV.has(name));
  }
  return localEnvVars;
}

/**
 * git を起動し、標準出力を返す。ロケールに依らないメッセージにするため LC_ALL=C で起動する。
 * ls-files と status の出力は追跡しているファイルや変更の数に比例するので、出力の上限を Node のデフォルト（1 MiB）より大きくする。
 * デフォルトのままだと、数万ファイルのリポジトリで ENOBUFS になり、値を取れずに止まる。
 * @param {string[]} args
 * @param {{ cwd: string, env?: Record<string, string> }} opts
 * @returns {string}
 */
function git(args, { cwd, env = {} }) {
  const base = { ...process.env };
  for (const name of repoLocalEnvVars()) delete base[name];
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...base, LC_ALL: "C", ...env },
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * 子プロセスのエラーから、判定に使うフィールドだけを取り出す（例外の値は Error とは限らない）。
 * @param {unknown} e
 * @returns {{ code?: unknown, status?: unknown, stderr?: unknown, message?: unknown }}
 */
function errorFields(e) {
  if (typeof e !== "object" || e === null) return {};
  return {
    code: "code" in e ? e.code : undefined,
    status: "status" in e ? e.status : undefined,
    stderr: "stderr" in e ? e.stderr : undefined,
    message: "message" in e ? e.message : undefined,
  };
}

/**
 * git を起動できなかった・失敗したときのエラーを、使い方の誤りとして返す。
 * @param {unknown} e
 * @param {string} what
 * @returns {UsageError}
 */
function gitError(e, what) {
  // 中で起きた使い方の誤り（一覧の取得の失敗など）は、メッセージを二重に包まずにそのまま返す
  if (e instanceof UsageError) return e;
  const err = errorFields(e);
  if (err.code === "ENOENT") return new UsageError("git を起動できない（git が PATH に無い）");
  const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
  const detail = stderr !== "" ? stderr : typeof err.message === "string" ? err.message : "";
  return new UsageError(`${what}に失敗した: ${detail}`);
}

/**
 * new.repo がどの git のリポジトリの、どのディレクトリにあるかを返す。git で管理されていなければ null。
 * @param {string} repo
 * @returns {{ top: string, prefix: string } | null}
 */
function locateRepo(repo) {
  let out;
  try {
    out = git(["rev-parse", "--show-toplevel", "--show-prefix"], { cwd: repo });
  } catch (e) {
    const err = errorFields(e);
    // 128 は「git のリポジトリではない」などの致命的なエラー。メッセージで、git で管理されていないことだけを選ぶ
    if (
      err.status === 128 &&
      typeof err.stderr === "string" &&
      /not a git repository/.test(err.stderr)
    )
      return null;
    throw gitError(e, "新側のリポジトリの特定");
  }
  const [top, prefix = ""] = out.replace(/\n$/, "").split("\n");
  if (!top)
    throw new UsageError(
      "新側のリポジトリの最上位を特定できない（bare リポジトリの中では取れない）",
    );
  return { top: realpathSync(top), prefix };
}

/**
 * --artifacts のディレクトリが新側のリポジトリの中にあれば、最上位からの相対パス（/ 区切り）を返す。外にあれば null。
 * 新側のディレクトリそのものか、その祖先を指していれば、除くと新側が何も残らないので使い方の誤りにする。
 * @param {{ top: string, prefix: string }} loc
 * @param {string} artifacts
 * @returns {string | null}
 */
function artifactsInRepo({ top, prefix }, artifacts) {
  const rel = path.relative(top, realpathSync(artifacts));
  // ".." で始まる名前（..data など）はリポジトリの中なので、".." そのものか ".." の下だけを外とする
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  const excluded = rel.split(path.sep).join("/");
  if (excluded === "" || prefix.startsWith(`${excluded}/`))
    throw new UsageError(
      `--artifacts が新側のディレクトリそのものか、その祖先を指している（除くと新側が何も残らない）: ${artifacts}`,
    );
  return excluded;
}

/**
 * new.repo のディレクトリを指す pathspec。名前の文字（* や [ など）をパターンとして読まないよう literal にする。
 * literal の "." は「. という名前のファイル」になって何にも一致しないので、ルートは :(top) だけで指す。
 * @param {string} prefix
 * @returns {string}
 */
function scopeSpec(prefix) {
  return prefix === "" ? ":(top)" : `:(top,literal)${prefix}`;
}

/**
 * commit のツリーから --artifacts を除き、new.repo のディレクトリのツリーのハッシュを返す。利用者の index は使わない。
 * --artifacts が新側のディレクトリの外にあれば除く必要が無いので、一時的な index を作らずに commit のツリーから読む。
 * @param {{ top: string, prefix: string, excluded: string | null }} scope
 * @param {string} commit
 * @returns {string}
 */
function sourceTree({ top, prefix, excluded }, commit) {
  try {
    if (excluded === null || !excluded.startsWith(prefix) || !inCommit(top, commit, excluded))
      return prefix === ""
        ? git(["rev-parse", "--verify", `${commit}^{tree}`], { cwd: top }).trim()
        : subtree(top, `${commit}^{tree}`, prefix);
    return treeWithout({ top, prefix, excluded }, commit);
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw gitError(e, "新側のツリーのハッシュの取得");
  }
}

/**
 * commit のツリーに path があるか（gitignore された .replace/ は commit に無いので、除く必要が無い）。
 * @param {string} top
 * @param {string} commit
 * @param {string} rel
 * @returns {boolean}
 */
function inCommit(top, commit, rel) {
  try {
    git(["cat-file", "-e", `${commit}:${rel}`], { cwd: top });
    return true;
  } catch {
    return false;
  }
}

/**
 * commit のツリーを一時的な index に読み、--artifacts を外してから、new.repo のディレクトリのツリーを書く。
 * @param {{ top: string, prefix: string, excluded: string }} scope
 * @param {string} commit
 * @returns {string}
 */
function treeWithout({ top, prefix, excluded }, commit) {
  const dir = mkdtempSync(path.join(tmpdir(), "source-version-"));
  const env = { GIT_INDEX_FILE: path.join(dir, "index") };
  try {
    git(["read-tree", commit], { cwd: top, env });
    git(["--literal-pathspecs", "rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", excluded], {
      cwd: top,
      env,
    });
    const whole = git(["write-tree"], { cwd: top, env }).trim();
    if (prefix === "") return whole;
    return subtree(top, whole, prefix);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * ツリーの中の new.repo のディレクトリのツリーのハッシュを返す。
 * そのディレクトリに追跡しているファイルが 1 つも無ければ、ツリーに現れないので、空のツリーとして扱う。
 * @param {string} top
 * @param {string} whole
 * @param {string} prefix
 * @returns {string}
 */
function subtree(top, whole, prefix) {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${whole}:${prefix.replace(/\/$/, "")}`], {
      cwd: top,
    }).trim();
  } catch {
    // 空のツリーのハッシュはオブジェクトの形式（SHA-1・SHA-256）で違うので、決め打ちせずに git に作らせる
    return git(["hash-object", "-t", "tree", "--stdin"], { cwd: top }).trim();
  }
}

/**
 * new.repo のディレクトリから --artifacts を除いた範囲に、commit していない変更か追跡していないファイルがあるか。
 * @param {{ top: string, prefix: string, excluded: string | null }} scope
 * @returns {boolean}
 */
function sourceDirty({ top, prefix, excluded }) {
  const specs = [scopeSpec(prefix)];
  if (excluded !== null) specs.push(`:(top,literal,exclude)${excluded}`);
  try {
    const out = git(
      [
        "--no-optional-locks",
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--ignore-submodules=none",
        "--",
        ...specs,
      ],
      { cwd: top },
    );
    return out !== "";
  } catch (e) {
    throw gitError(e, "新側の作業ツリーの状態の取得");
  }
}

/**
 * 新側のバージョンを取る。rev を渡すと、HEAD の代わりにその commit の tree を取り、dirty は null にする。
 * @param {{ repo: string, artifacts: string, rev?: string | null }} opts
 * @returns {{ commit: string, tree: string, dirty: boolean | null, excluded: string | null }}
 */
export function sourceVersion({ repo, artifacts, rev = null }) {
  if (!existsSync(repo)) throw new UsageError(`--repo のディレクトリが無い: ${repo}`);
  // 在らないパスを除いても何も除かれず、.replace/ を含めた値を警告なしに出すので、在ることを先に確かめる
  if (!existsSync(artifacts) || !statSync(artifacts).isDirectory())
    throw new UsageError(
      `--artifacts のディレクトリが無い: ${artifacts}（プロジェクトのルートで実行するか、.replace/ のパスを渡す）`,
    );
  const loc = locateRepo(repo);
  if (loc === null) {
    // --rev の commit を確かめる方法が無いので、none を返して照合を素通りさせない
    if (rev !== null)
      throw new UsageError(`git で管理されていない新側では、--rev の commit を取れない: ${rev}`);
    return { commit: NONE, tree: NONE, dirty: false, excluded: null };
  }
  const commit = resolveCommit(loc.top, rev);
  const scope = { ...loc, excluded: artifactsInRepo(loc, artifacts) };
  const tree = sourceTree(scope, commit);
  return {
    commit,
    tree,
    dirty: rev === null ? sourceDirty(scope) : null,
    excluded: scope.excluded,
  };
}

/**
 * HEAD か --rev の commit を、完全な SHA に解決する。
 * @param {string} top
 * @param {string | null} rev
 * @returns {string}
 */
function resolveCommit(top, rev) {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${rev ?? "HEAD"}^{commit}`], {
      cwd: top,
    }).trim();
  } catch {
    throw new UsageError(
      rev === null
        ? "新側のリポジトリに commit が無い（最初の commit をしてから取る）"
        : `--rev の commit が手元のリポジトリに無い: ${rev}（git fetch してから取る）`,
    );
  }
}

/**
 * 引数を読む。値を取るオプションの重複と、知らないオプションは使い方の誤りにする。
 * @param {string[]} argv
 * @returns {{ repo: string, artifacts: string, rev: string | null }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = argv[i].split(/=(.*)/s, 2);
    if (name !== "--repo" && name !== "--artifacts" && name !== "--rev")
      throw new UsageError(`知らない引数: ${argv[i]}`);
    if (name in opts) throw new UsageError(`${name} が 2 回ある`);
    const value = inline ?? argv[++i];
    // 次の引数がオプションなら、値を書き忘れたとして扱う（--repo --artifacts x を repo = "--artifacts" と読まない）
    if (value === undefined || value === "" || (inline === undefined && value.startsWith("--")))
      throw new UsageError(`${name} に値が無い`);
    opts[name] = value;
  }
  if (opts["--repo"] === undefined)
    throw new UsageError("--repo が無い（新側のリポジトリのディレクトリを渡す）");
  return {
    repo: opts["--repo"],
    artifacts: opts["--artifacts"] ?? ".replace",
    rev: opts["--rev"] ?? null,
  };
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  try {
    process.stdout.write(`${JSON.stringify(sourceVersion(parseArgs(argv)))}\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`source-version: ${e.message}\n${USAGE}\n`);
    return 2;
  }
}

// cli-entry-js:begin
/**
 * CLI として起動されたか。
 * @param {string} moduleUrl 呼び出し元のモジュールの URL
 * @returns {boolean}
 */
function isCliEntry(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(moduleUrl);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // 実パスへの解決に失敗したら、起動時のパスのまま突き合わせる（何もせずに終わるより、誤って起動する方を選ぶ）。
    return entry === self;
  }
}
// cli-entry-js:end

if (isCliEntry(import.meta.url)) process.exitCode = main(process.argv.slice(2));
