#!/usr/bin/env node
// 変異実証（mutation proof）を再実行可能な形で検査する。
//
// 検査の強度を「変異を当てたら赤くなった」で示す実証は、テストファイル冒頭の散文コメントに
// 書くと腐る。当時の主張が残るだけで、テストを直した瞬間に検証されなくなる
// （実際に「行単位の検査で分岐に混ざった変異を見逃す」「変異が当たっておらず偽の生存を
// 実証と読みかける」「テスト書き換え後に取り直さず記録だけ残る」の 3 通りで踏んだ。Issue #420）。
//
// そこで変異を `<テスト名>.mutations.json` のデータとして持ち、このスクリプトが
// 各変異について次の**両方**を確かめる。
//
//   1. 置換が実際に当たったこと（対象ファイル内の出現数が宣言どおりで、内容が変わったこと）
//   2. 宣言した assertion（テスト名）が**それだけ**落ちたこと
//
// 当たらなかった変異は成功に倒さず FAIL にする（偽の生存を潰す）。合否は終了コードではなく
// 「対象テストが走り、狙ったテストが落ちたこと」で判定する
// （`.agents/rules/state-space-and-mutation-proof.md`）。
//
// 使い方:
//   node scripts/check-mutation-proof.js                    # scripts/*.mutations.json を全部
//   node scripts/check-mutation-proof.js <spec.json> ...     # 指定したものだけ
//   node scripts/check-mutation-proof.js --only A,B          # id で絞る（開発中の 1 本だけ回す）
//   node scripts/check-mutation-proof.js --changed-since origin/main
//                                                            # 差分に当たる宣言だけ（PR 用）
//
// **全件は重い。** 1 変異 = 対象テストファイル 1 回の実行で、実行器自身を変異させる宣言
// （テストが入れ子で runner を起動する）が全体の 3 分の 2 を占める（手元実測: 98 変異 390 秒のうち
// `check-mutation-proof` の 23 変異が 255 秒。Issue #442 でスタブ化と `pnpm exec` の省略を入れる前は
// 95 変異 975 秒・うち 792 秒）。PR では `--changed-since` で差分に当たる宣言へ絞り、
// **全件は定期実行**（`.github/workflows/mutation-proof.yml`）で測る。
//
// 終了コード: 0 = 全変異が実証できた / 1 = 実証できない変異がある / 2 = 使い方・宣言・前提の誤り
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_DIR = "scripts";
const SPEC_SUFFIX = ".mutations.json";

function die(message) {
  console.error(`mutation-proof: ${message}`);
  process.exit(2);
}

// **この検査は作業ツリーを書き換えて戻す。** 並行して走らせる（別の mutation-proof、
// 同時に走るテスト）と、相手が変異を当てている最中のファイルを読んで**無関係な赤**が出る
// （実測: 並行実行中に集計器のテストが 1 本落ちた）。単一実行をロックで担保する。
// **状態ファイルは `/tmp` に置かない。** `os.tmpdir()`（1777）は同一ホストの別ユーザーも書けるうえ、
// パスは repoRoot から決定論的に導けるので**先に作っておける**。ロックを先取りされれば実行を止められ、
// 復元情報を植え付けられれば次回起動が任意のファイルを上書きしてしまう（実測で確認された経路）。
// 作業ツリー内の自分が所有するディレクトリ（`node_modules/.cache/`。vitest を `node_modules` から解決する以上必ず在る）へ置く。
// worktree ごとに `node_modules` が分かれるので、ハッシュで取り合う問題も起きない。
const stateDir = join(repoRoot, "node_modules", ".cache", "mutation-proof");
const lockPath = process.env.MUTATION_PROOF_LOCK ?? join(stateDir, "lock");
let lockHeld = false;

function takeLock() {
  mkdirSync(dirname(lockPath), { recursive: true });
  // **pid を書き終えてから公開する。** `openSync(wx)` → `writeFileSync` の 2 段だと、
  // 作成直後の窓ではロックが**空**で、そこに入った 2 本目が「pid が読めない＝残骸」と判定して
  // 生きている持ち主のロックを奪える（`Number("")` は NaN ではなく 0 なので `pid > 0` が false）。
  // 一時ファイルへ pid を書いてから `linkSync` で公開すると、公開されたロックは常に pid を持つ。
  const staging = `${lockPath}.${process.pid}.staging`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(staging, `${process.pid}\n`);
      linkSync(staging, lockPath); // 既にあれば EEXIST（アトミック）
      // **公開できた時点で所有を記録する。** staging の後片付けの失敗で catch へ落ちると、
      // ロックは公開済みなのに `lockHeld` が false のままで解放されず、しかも
      // 「ロックを作れない」という実態と違う理由で終わる。
      lockHeld = true;
      try {
        unlinkSync(staging);
      } catch (cleanupErr) {
        console.error(
          `mutation-proof: 一時ファイルを消せなかった（${staging}）: ${cleanupErr.message}`,
        );
      }
      return;
    } catch (err) {
      try {
        unlinkSync(staging);
      } catch {
        /* 作れていなければ消すものが無い */
      }
      if (err.code !== "EEXIST") die(`ロックを作れない（${lockPath}）: ${err.message}`);
      // **読み取りも失敗しうる。** EEXIST を受けてから持ち主が `releaseLock()` で unlink する窓に
      // 入ると ENOENT を投げ、`catch` の中なので誰も受けず未処理例外になる（終了コード 1 は
      // 「実証できない変異がある」の意味なので、一過性の競合が実証の失敗に化ける）。
      // 読めなかったロックは残骸として扱い、次の試行へ落とす。
      let pid = NaN;
      try {
        pid = Number(readFileSync(lockPath, "utf8").trim());
      } catch (readErr) {
        if (readErr.code !== "ENOENT") {
          die(`ロック（${lockPath}）を読めない: ${readErr.message}`);
        }
      }
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) {
        die(
          `別の実行（pid ${pid}）が作業ツリーへ変異を当てている最中。` +
            `終わるまで待つ（この検査は同時に走らせられない）。ロック: ${lockPath}`,
        );
      }
      // 生きていないプロセスのロックは残骸。**奪うのは `renameSync` で行う**——`unlinkSync` だと、
      // 同じ残骸を読んだ 2 本が「先に貼り直した側の**生きた**ロック」を消してしまい、両方が同時に
      // 作業ツリーへ変異を当てる（ロックが防ぐはずの状態そのもの）。rename は勝者が 1 本に決まり、
      // 負けた側は ENOENT で次の試行へ落ちる。
      try {
        const stale = `${lockPath}.stale.${process.pid}`;
        renameSync(lockPath, stale);
        unlinkSync(stale);
      } catch {
        /* 別の実行が先に奪った（ENOENT）。次の試行で EEXIST か取得成功になる */
      }
    }
  }
  die(`ロックの取得が競合した（${lockPath}）。時間を置いて再実行する`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function releaseLock() {
  if (!lockHeld) return;
  lockHeld = false;
  try {
    unlinkSync(lockPath);
  } catch {
    /* すでに消えていれば何もしない */
  }
}

// 実行中に作った一時ディレクトリ。`die()`（`process.exit`）は finally を飛ばすので、
// exit ハンドラからも片付ける。
const tempDirs = new Set();

// 変異を当てている間だけ置く復元情報。プロセスが殺されて（SIGKILL・電源断・端末の Ctrl-C）
// 復元が走らなかった場合に、**次回起動で作業ツリーを元へ戻す**ための記録。
const recoveryPath = `${lockPath}.recovery.json`;

function writeRecovery(target, before, after) {
  mkdirSync(dirname(recoveryPath), { recursive: true });
  writeFileSync(recoveryPath, JSON.stringify({ file: target, before, after }));
}

function clearRecovery() {
  try {
    unlinkSync(recoveryPath);
  } catch {
    /* 無ければ消すものが無い */
  }
}

/** 前回の中断で変異が残っていれば戻す（ロックを取った後・宣言を読む前に呼ぶ）。 */
function recoverFromInterrupted() {
  if (!existsSync(recoveryPath)) return;
  let saved;
  try {
    saved = JSON.parse(readFileSync(recoveryPath, "utf8"));
  } catch (err) {
    die(
      `前回の中断の復元情報を読めない（${recoveryPath}）: ${err.message}。手で作業ツリーを確かめる`,
    );
  }
  if (
    typeof saved?.file !== "string" ||
    typeof saved?.before !== "string" ||
    typeof saved?.after !== "string"
  ) {
    die(`前回の中断の復元情報が壊れている（${recoveryPath}）。手で作業ツリーを確かめる`);
  }
  // **書き戻し先はリポジトリ内に限る**（宣言の `file` と同じ扱い）。植え付けられた記録で
  // リポジトリ外のファイルを上書きしない。
  const target = resolve(saved.file);
  if (!target.startsWith(repoRoot + "/")) {
    die(`復元情報の書き戻し先がリポジトリ外（${target}）。植え付けを疑い、記録を消して調べる`);
  }
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current === saved.before) {
    console.error(`mutation-proof: 前回の中断で残った変異は無かった（${target}）`);
  } else if (current === saved.after) {
    // **変異後の内容と一致したときだけ戻す。** 「変異が残っている」と「人が直してさらに編集した」を
    // 区別せず上書きすると、無関係な編集を消して「変異を戻した」と事実でないログを出す（実測）。
    writeFileSync(target, saved.before);
    console.error(`mutation-proof: 前回の中断で残っていた変異を戻した（${target}）`);
  } else {
    die(
      `復元情報と作業ツリーが食い違う（${target}）。中断後に編集された可能性があるので自動で戻さない。` +
        `内容を確かめてから ${recoveryPath} を消す`,
    );
  }
  clearRecovery();
}

// 変異を当てている最中のファイル。中断（Ctrl-C・SIGTERM）でも必ず戻す
// ——戻せないまま終わると、変異したワークフローやスクリプトが作業ツリーに残る。
let pending = null;

function cleanupTempDirs() {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 消せなければ諦める（一時ディレクトリなので害は蓄積だけ） */
    }
  }
  tempDirs.clear();
}

function restorePending() {
  if (!pending) return;
  const { path, content } = pending;
  pending = null;
  try {
    writeFileSync(path, content);
  } catch (err) {
    console.error(`mutation-proof: ${path} を復元できなかった（手で戻す）: ${err.message}`);
  }
}

// **signal handler は置かない。** `main()` は `spawnSync` だけの完全な同期処理なので、
// 届いた signal の JS コールバックはスタックが空くまで dispatch されず、`main()` が終わる前に
// 実行されることはない（最小プローブで実測）。登録するだけだと `SIGTERM` の既定動作
// （terminate）が外れて `kill` でも止まらなくなり、「中断を扱っている」という誤った保証になる。
//
// 中断（SIGKILL を含む）で変異が残る可能性は、**次回起動時の復元**で受ける（`recoveryPath`）。
process.on("exit", () => {
  restorePending();
  cleanupTempDirs();
  releaseLock();
});

/** `--only` を除いた位置引数と id フィルタを返す。 */
function parseArgs(argv) {
  const files = [];
  let only = null;
  let changedSince = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") {
      const value = argv[++i];
      if (!value) die("--only に値がない");
      only = new Set(value.split(",").filter(Boolean));
      if (only.size === 0) die("--only の値が空");
    } else if (arg === "--changed-since") {
      changedSince = argv[++i];
      if (!changedSince) die("--changed-since に ref がない");
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "usage: node scripts/check-mutation-proof.js [<spec.json>...] [--only <id,...>] [--changed-since <ref>]",
      );
      process.exit(0);
    } else if (arg.startsWith("-")) {
      die(`不明な引数: ${arg}`);
    } else {
      files.push(arg);
    }
  }
  return { files, only, changedSince };
}

/** 宣言ファイルの一覧。**0 件は成功に倒さない**（検査が空振りしただけの緑を根拠にしない）。 */
function specPaths(files) {
  const found = files.length
    ? files.map((f) => (isAbsolute(f) ? f : resolve(repoRoot, f)))
    : readdirSync(join(repoRoot, SPEC_DIR))
        .filter((name) => name.endsWith(SPEC_SUFFIX))
        .sort()
        .map((name) => join(repoRoot, SPEC_DIR, name));
  if (found.length === 0) die(`${SPEC_DIR}/*${SPEC_SUFFIX} が 1 件も無い`);
  for (const p of found) {
    if (!existsSync(p)) die(`宣言ファイルが無い: ${p}`);
  }
  return found;
}

/**
 * `ref` からの差分で変更されたリポジトリ相対パスを返す。
 *
 * **失敗を「変更なし」に倒さない**（未知の ref・git が無い・repo でない）。0 件と失敗が同じ
 * 空配列になると、当たるはずの宣言を 1 件も走らせないまま緑で終わる。
 * テスト用に `MUTATION_PROOF_CHANGED_FILES`（改行区切り）で差し替えられる。**使ったら必ず印字する**
 * ——CI が気づかないまま注入された一覧に頼るのを防ぐ。
 */
function changedFiles(ref) {
  const injected = process.env.MUTATION_PROOF_CHANGED_FILES;
  if (injected !== undefined) {
    const list = injected.split("\n").filter(Boolean);
    console.error(
      `変更ファイル: MUTATION_PROOF_CHANGED_FILES から ${list.length} 件（テスト用の注入）`,
    );
    return list;
  }
  const res = spawnSync("git", ["diff", "--name-only", `${ref}...HEAD`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (res.error) die(`git を起動できない: ${res.error.message}`);
  if (res.status !== 0) {
    die(`${ref} からの差分を取れない（git diff exit ${res.status}）: ${tail(res.stderr)}`);
  }
  return res.stdout.split("\n").filter(Boolean);
}

/**
 * 差分に当たる宣言だけを返す。当たり方は 3 通り:
 *   - 実行器（このファイル）が変わった → **全宣言**（判定の仕組みが変わったので全部測り直す）
 *   - 宣言ファイル自身が変わった
 *   - その宣言の `test_file` か、いずれかの変異の対象ファイルが変わった
 *
 * それ以外は対象も検査も変わっていないので、前回の実証がそのまま有効。
 * **選んだ／飛ばした理由は必ず印字する**（0 件を黙って緑にしない）。
 */
function selectChangedSpecs(specs, ref) {
  const changed = new Set(changedFiles(ref));
  const runnerPath = relative(repoRoot, fileURLToPath(import.meta.url));
  console.error(`変更ファイル: ${changed.size} 件（${ref}...HEAD）`);
  if (changed.has(runnerPath)) {
    console.error(`実行器（${runnerPath}）が変わったので全宣言を測る`);
    return specs;
  }
  const selected = [];
  for (const spec of specs) {
    const specRel = relative(repoRoot, spec.specPath);
    const targets = [...new Set(spec.mutations.map((m) => m.file))];
    const hits = [specRel, spec.testFile, ...targets].filter((f) => changed.has(f));
    if (hits.length > 0) {
      console.error(`測る: ${specRel}（当たった変更: ${hits.join(", ")}）`);
      selected.push(spec);
    } else {
      console.error(`飛ばす: ${specRel}（対象も検査も変わっていない）`);
    }
  }
  return selected;
}

function asString(value, label) {
  if (typeof value !== "string" || value.length === 0) die(`${label} が非空の文字列でない`);
  return value;
}

/** 宣言を読んで形を検証する（実行前に落とす。走らせてから気づくと部分適用が残る）。 */
function loadSpec(specPath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(specPath, "utf8"));
  } catch (err) {
    die(`${specPath} を読めない: ${err.message}`);
  }
  // 壊れた宣言は「実証できない変異がある」（exit 1）ではなく前提の誤り（exit 2）。
  // 素通りさせると後続の参照が TypeError になり、CI では本物の実証失敗と同じ赤に見える。
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    die(`${specPath} が JSON オブジェクトでない（${Array.isArray(raw) ? "配列" : String(raw)}）`);
  }
  const testFile = asString(raw.test_file, `${specPath}: test_file`);
  const testPath = resolve(repoRoot, testFile);
  if (!existsSync(testPath)) die(`${specPath}: test_file が実在しない: ${testPath}`);
  if (!Array.isArray(raw.mutations) || raw.mutations.length === 0) {
    die(`${specPath}: mutations が空`);
  }
  const ids = new Set();
  const mutations = raw.mutations.map((m, i) => {
    const at = `${specPath}: mutations[${i}]`;
    const id = asString(m.id, `${at}.id`);
    if (ids.has(id)) die(`${at}.id が重複: ${id}`);
    ids.add(id);
    asString(m.why, `${at}(${id}).why`);
    const file = asString(m.file, `${at}(${id}).file`);
    const target = resolve(repoRoot, file);
    if (!target.startsWith(repoRoot + "/")) die(`${at}(${id}).file がリポジトリ外: ${target}`);
    if (!existsSync(target)) die(`${at}(${id}).file が実在しない: ${target}`);
    const find = asString(m.find, `${at}(${id}).find`);
    // 変異は「変えた」ことが前提。同一文字列だと何も変わらないまま緑になる。
    if (typeof m.replace !== "string") die(`${at}(${id}).replace が文字列でない`);
    if (m.replace === find) die(`${at}(${id}) の find と replace が同じ`);
    const occurrences = m.occurrences ?? 1;
    if (!Number.isInteger(occurrences) || occurrences < 1) {
      die(`${at}(${id}).occurrences が 1 以上の整数でない`);
    }
    if (!Array.isArray(m.expect_failing) || m.expect_failing.length === 0) {
      die(`${at}(${id}).expect_failing が空`);
    }
    const expect = m.expect_failing.map((name, j) =>
      asString(name, `${at}(${id}).expect_failing[${j}]`),
    );
    if (new Set(expect).size !== expect.length) die(`${at}(${id}).expect_failing が重複`);
    return { id, why: m.why, file, target, find, replace: m.replace, occurrences, expect };
  });
  return { specPath, testFile, testPath, mutations };
}

/**
 * テストを起動するコマンド（実行ファイルと、`run <testFile> ...` の前に置く引数）。
 *
 * **既定は vitest の entry を Node のモジュール解決で求め、`node` で直接起動する。** `pnpm exec` を経由すると
 * 1 回あたり約 0.6 秒の起動コストが乗り（実測: `pnpm exec vitest --version` 0.70 秒 / `node vitest.mjs --version`
 * 0.07 秒）、変異 1 件ごとに基準 run・入れ子の runner を含めて数十回起動するこの検査では支配的になる。
 * `node_modules/.bin/` のハードパスは使わない（AGENTS.md「ツール起動」の例外。解決はパッケージの `bin` から取る）。
 *
 * `MUTATION_PROOF_TEST_COMMAND` で実行ファイルを差し替えられる（**テスト用の seam**。実行器のロック・復元・
 * 判定のテストを、決まった JSON レポートを返すスタブで回して vitest の起動を省くため）。引数は vitest と同じ
 * `run <testFile> --reporter=json --outputFile=<path>` を渡す。**使ったら必ず印字する**（`MUTATION_PROOF_CHANGED_FILES` と同じ扱い）。
 */
let testCommandCache = null;
function testCommand() {
  if (testCommandCache) return testCommandCache;
  const injected = process.env.MUTATION_PROOF_TEST_COMMAND;
  if (injected !== undefined) {
    // 空文字を「未指定」に倒さない（注入のつもりで本物の vitest を測ると、速さも中身も別物になる）。
    if (injected === "") die("MUTATION_PROOF_TEST_COMMAND が空");
    console.error(
      `テストコマンド: MUTATION_PROOF_TEST_COMMAND=${injected}（テスト用の注入。vitest は起動しない）`,
    );
    testCommandCache = { file: injected, prefix: [] };
    return testCommandCache;
  }
  let entry;
  try {
    const pkgPath = createRequire(join(repoRoot, "package.json")).resolve("vitest/package.json");
    const { bin } = JSON.parse(readFileSync(pkgPath, "utf8"));
    const rel = typeof bin === "string" ? bin : bin?.vitest;
    if (typeof rel !== "string") throw new Error(`${pkgPath} に bin.vitest が無い`);
    entry = join(dirname(pkgPath), rel);
  } catch (err) {
    // 起動できないのと同じく前提の誤り（exit 2）。`pnpm install` 前・リポジトリ外へのコピー等。
    die(`vitest を解決できない（pnpm install 済みか確かめる）: ${err.message}`);
  }
  testCommandCache = { file: process.execPath, prefix: [entry] };
  return testCommandCache;
}

/**
 * テストファイルを 1 回走らせ、テスト名 → 状態のマップを返す。
 * **終了コードでは判定しない**——走らなかった（収集で落ちた）のか、狙ったテストが落ちたのかを
 * 区別できないため、JSON レポータの結果から名前で読む。
 */
function runTests(testFile) {
  // **`die()` は `process.exit` なので finally を飛ばす。** 変異の復元と同じく exit ハンドラで
  // 二重化して、起動失敗・重複検出で落ちたときに一時ディレクトリを残さない。
  const dir = mkdtempSync(join(tmpdir(), "mutation-proof-"));
  tempDirs.add(dir);
  const outFile = join(dir, "result.json");
  try {
    const command = testCommand();
    const res = spawnSync(
      command.file,
      [...command.prefix, "run", testFile, "--reporter=json", `--outputFile=${outFile}`],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // 子 vitest に、使用中の fixture を掃かせない（`scripts/vitest-global-setup.js`）。
        env: { ...process.env, MUTATION_PROOF_CHILD: "1" },
      },
    );
    // **起動できなかったのは「実証の失敗」ではない。** spawn 自体が失敗すると理由は
    // `res.error` にだけ入り stdout/stderr は null なので、そのままだと理由なしの FAIL
    // （exit 1 =「実証できない変異がある」）に化ける。前提の誤りとして exit 2 に倒す。
    if (res.error) {
      die(`テストを起動できない（${command.file}）: ${res.error.message}`);
    }
    if (!existsSync(outFile)) {
      return {
        ran: false,
        reason: `vitest が結果を出さなかった: ${tail(res.stderr || res.stdout)}`,
      };
    }
    let report;
    try {
      report = JSON.parse(readFileSync(outFile, "utf8"));
    } catch (err) {
      return { ran: false, reason: `vitest の結果を読めない: ${err.message}` };
    }
    const results = new Map();
    const duplicated = [];
    for (const file of report.testResults ?? []) {
      for (const a of file.assertionResults ?? []) {
        // **名前をキーにする設計なので、名前の一意性が前提。** 同名（`test.each` の展開が
        // 同じ文字列になる等）があると後の状態が前を上書きし、「1 件目だけ落ちた」変異が
        // 「落ちなかった」に化ける（逆向きなら効いていない assertion が PASS になる）。
        if (results.has(a.fullName)) duplicated.push(a.fullName);
        results.set(a.fullName, a.status);
      }
    }
    if (duplicated.length > 0) {
      die(
        `テスト名が重複している（名前で合否を判定できない）: ${[...new Set(duplicated)].join(" / ")}`,
      );
    }
    if (results.size === 0) {
      return {
        ran: false,
        reason: `テストが 1 件も走らなかった: ${tail(res.stderr || res.stdout)}`,
      };
    }
    const failed = new Set([...results].filter(([, s]) => s === "failed").map(([n]) => n));
    return { ran: true, results, failed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    tempDirs.delete(dir);
  }
}

function tail(text, lines = 8) {
  return (text ?? "").trimEnd().split("\n").slice(-lines).join("\n");
}

function sorted(values) {
  return [...values].sort();
}

/** 変異を当てて走らせ、元に戻す。戻し漏れを残さないため復元まで必ず通る。 */
function proveMutation(mutation, testFile) {
  const original = readFileSync(mutation.target, "utf8");
  const hits = original.split(mutation.find).length - 1;
  if (hits !== mutation.occurrences) {
    // **当たらなかった変異を成功に倒さない。** 偽の生存（効いていない assertion を効いていると
    // 読む）は、この検査が防ごうとしている失敗そのもの。
    return {
      ok: false,
      reason: `置換が当たらない: ${mutation.file} 内の find の出現数が ${hits} 件（宣言は ${mutation.occurrences} 件）`,
    };
  }
  const mutated = original.split(mutation.find).join(mutation.replace);
  if (mutated === original) {
    return { ok: false, reason: `置換しても内容が変わらない: ${mutation.file}` };
  }
  let run;
  try {
    pending = { path: mutation.target, content: original };
    writeRecovery(mutation.target, original, mutated);
    writeFileSync(mutation.target, mutated);
    run = runTests(testFile);
  } finally {
    writeFileSync(mutation.target, original);
    pending = null;
    // 復元を実測する（ここが崩れると、以降の変異も本来の版で測れていない）。
    // **検証を通ってから復元情報を消す**——先に消すと、記録が要るまさにその場合
    //（書き戻したのに内容が一致しない）に次回起動が回収できない。
    const restored = readFileSync(mutation.target, "utf8");
    if (restored !== original) {
      console.error(
        `mutation-proof: ${mutation.target} を復元できなかった。手で戻す（復元情報: ${recoveryPath}）`,
      );
      process.exit(2);
    }
    clearRecovery();
  }
  if (!run.ran) return { ok: false, reason: run.reason };
  const expected = new Set(mutation.expect);
  const missing = sorted([...expected].filter((n) => !run.failed.has(n)));
  const extra = sorted([...run.failed].filter((n) => !expected.has(n)));
  if (missing.length || extra.length) {
    const parts = [];
    // 落ちなかった = その assertion はこの変異を検出できていない。
    if (missing.length) parts.push(`落ちなかった: ${missing.join(" / ")}`);
    // 余分に落ちた = 変異が想定より広い（または assertion の帰属が宣言とずれている）。
    if (extra.length) parts.push(`宣言外で落ちた: ${extra.join(" / ")}`);
    return { ok: false, reason: parts.join("、") };
  }
  return { ok: true, failed: sorted(run.failed) };
}

function main() {
  const { files, only, changedSince } = parseArgs(process.argv.slice(2));
  // 宣言の検証より先にロックを取る（並行実行が互いのファイルを読むのを防ぐ）。
  takeLock();
  // 前回が中断されて変異が残っていれば、測る前に戻す（残った変異を基準 run が測らないため）。
  recoverFromInterrupted();
  let specs = specPaths(files).map(loadSpec);
  if (changedSince) {
    if (files.length > 0) {
      die("--changed-since と宣言ファイルの指定は併用しない（選び方が二重になる）");
    }
    const declared = specs.length;
    specs = selectChangedSpecs(specs, changedSince);
    if (specs.length === 0) {
      // **0 件は「測るものが無い」**（宣言 `declared` 件すべてが差分の外）。全件は定期実行が測る。
      console.log(
        `mutation-proof: この差分に当たる宣言は無い（宣言 ${declared} 件はいずれも対象・検査が未変更）。` +
          "全件は定期実行（.github/workflows/mutation-proof.yml）で測る",
      );
      return;
    }
  }
  let proven = 0;
  let failures = 0;

  // `--only` は**宣言をまたいで** id で絞る指定。選ばれなかった宣言は飛ばす
  // ——宣言ごとに「1 件も選ばれなかった」で落とすと、宣言が 2 件以上ある時点で
  // `--only <id>` が常に exit 2 になる（実測。宣言は今 3 件ある）。
  const plans = specs.map((spec) => ({
    spec,
    targeted: spec.mutations.filter((m) => !only || only.has(m.id)),
  }));
  const skipped = plans.reduce((n, p) => n + (p.spec.mutations.length - p.targeted.length), 0);
  if (only) {
    // **どの宣言にも無い id は走らせる前に落とす。** typo を黙って無視すると、
    // 実証していない変異を「実証済み」と読む（0 件を成功に倒さないのと同じ理由）。
    const selected = new Set(plans.flatMap((p) => p.targeted.map((m) => m.id)));
    const unmatched = sorted([...only].filter((id) => !selected.has(id)));
    if (unmatched.length) die(`--only で 1 件も選ばれなかった: ${unmatched.join(" / ")}`);
  }

  for (const { spec, targeted } of plans) {
    if (targeted.length === 0) continue;
    console.log(`\n=== ${relative(repoRoot, spec.specPath)} → ${spec.testFile}`);

    // **基準は先に測る。** 変異前が緑でなければ、落ちた原因を変異に帰属できない。
    const baseline = runTests(spec.testFile);
    if (!baseline.ran) die(`基準 run が走らなかった: ${baseline.reason}`);
    if (baseline.failed.size > 0) {
      die(`基準 run が緑でない（先に直す）: ${sorted(baseline.failed).join(" / ")}`);
    }
    console.log(`baseline: ${baseline.results.size} tests passed`);

    // 宣言したテスト名が実在すること。**名前が腐っていたら実証にならない**——テストを
    // リネームすると `expect_failing` は永遠に落ちない名前を指し、この検査が空振りする。
    for (const m of targeted) {
      const unknown = m.expect.filter((name) => !baseline.results.has(name));
      if (unknown.length) {
        die(`${m.id}: expect_failing に実在しないテスト名がある: ${unknown.join(" / ")}`);
      }
    }

    for (const m of targeted) {
      const res = proveMutation(m, spec.testFile);
      if (res.ok) {
        proven++;
        console.log(`PASS ${m.id}: ${m.why}`);
        console.log(`     → 落ちた: ${res.failed.join(" / ")}`);
      } else {
        failures++;
        console.log(`FAIL ${m.id}: ${m.why}`);
        console.log(`     → ${res.reason}`);
      }
    }
  }

  console.log(
    `\nmutation-proof: ${proven} proven / ${failures} failed` +
      (skipped ? ` / ${skipped} skipped（--only）` : ""),
  );
  if (failures > 0) process.exit(1);
  if (proven === 0) die("実証できた変異が 0 件（対象 0 件を成功に倒さない）");
}

main();
