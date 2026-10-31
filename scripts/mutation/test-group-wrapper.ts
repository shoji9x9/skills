#!/usr/bin/env node
// ミューテーションテストのランナー（`check-mutation-proof.ts`）が、テストのコマンドを包んで起動するプロセス。
//
// 変異でテストの中に同期の無限ループができると、vitest の `testTimeout` では止まらない。
// そこで、テストのコマンドを別のプロセスグループで起動し、テストが進まない時間が上限を超えたら、グループごと止める。
// vitest だけを止めると、テストを実行している forks のワーカーが無限ループのまま残る（PR #776 で実測）。
//
// テストが進んだかは、`progress-reporter.ts` がテストの開始と終了のたびに書く行で判断する。
// 非同期の待ちで止まったテストは `testTimeout` で落ちて次の行が書かれるので、重いテストファイルでも誤って止めない。
//
// 起動の形は `node test-group-wrapper.ts <file> [args...]` で、ランナーが次の 3 つの環境変数を渡す。
// `MUTATION_PROOF_PROGRESS_FILE` は、進み具合の行を書くファイルである。reporter も同じ値を読む。
// `MUTATION_PROOF_WRAPPER_IDLE_MS` は、テストが進まない時間の上限（ミリ秒）である。
// `MUTATION_PROOF_WRAPPER_GRACE_MS` は、SIGTERM を送ってから SIGKILL を送るまでの猶予（ミリ秒）である。
// 名前は、ランナーのテスト用の注入（`MUTATION_PROOF_IDLE_TIMEOUT_MS` など）と分ける。
// 同じ名前にすると、テストが中で起動した入れ子のランナーが、外側の値を注入として読む。
// 包む側は、自分が使う猶予を `MUTATION_PROOF_OUTER_GRACE_MS` で子に渡す（`effectiveGrace`）。
//
// ランナーへの知らせは、stderr の `mutation-proof-wrapper[<ID>]: ` で始まる 1 行の JSON で渡す（`notify`）。
// 終了コードだけでは、テストのコマンドが同じ値で終わった場合と区別できないからである。
// ID は、ランナーが起動ごとに `MUTATION_PROOF_WRAPPER_RUN_ID` で渡す。
// テストが中で起動した入れ子のランナーの知らせがテストの出力に出ても、ランナーは ID で自分への知らせと区別する。
// `event` の値は次の 5 つである。
// `config-error` は、環境変数や引数の誤りで起動できなかったことを示す（exit 2）。
// `timeout` は、テストが進まなかったので止めたことを示す（exit 124）。
// `signal` は、SIGTERM・SIGINT・SIGHUP を受けて、子のグループを止めて終わることを示す（exit 128 + signal の番号）。
// `spawn-error` は、テストのコマンドを起動できなかったことを示す（exit 127）。
// `leftover` は、子のグループを SIGKILL しても、プロセスが残っていることを示す（exit 125）。
// どれにも当たらなければ、テストのコマンドの終了コードで終わる。
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { constants } from "node:os";

const WRAPPER_MARK = `mutation-proof-wrapper[${process.env.MUTATION_PROOF_WRAPPER_RUN_ID ?? ""}]: `;
const POLL_MS = 500;
/** 実行中のテストの上限に足す余裕。テストが上限で落ちてから、reporter が行を書くまでの時間を見込む。 */
const TIMEOUT_MARGIN_MS = 30_000;
/** SIGKILL を送った後、グループが消えるのを待つ時間。 */
const REAP_WAIT_MS = 2_000;

function notify(event: Record<string, unknown>) {
  // テストの出力と同じファイルに書くので、テストが改行で終えていない行の後ろに続くと、行の先頭の印で見つけられない。
  // 改行から書き始めて、知らせを必ず行の先頭に置く。
  process.stderr.write(`\n${WRAPPER_MARK}${JSON.stringify(event)}\n`);
}

function configError(message: string): never {
  notify({ event: "config-error", message });
  process.exit(2);
}

/**
 * SIGTERM を送ってから SIGKILL を送るまでの猶予を決める。
 * テストが中で起動した入れ子のランナーの包む側は、外側の包む側が止めるグループの中にいる。
 * 入れ子の猶予が外側と同じだと、入れ子の包む側が自分のグループを止め終える前に、外側の SIGKILL で終わる。
 * 入れ子のグループは外側のグループの外にいるので、SIGTERM で終わらないテストがそのまま残る。
 * そこで、外側の猶予（`MUTATION_PROOF_OUTER_GRACE_MS`）があれば、その半分を超えない値にする。
 */
function effectiveGrace(own: number): number {
  if (process.env.MUTATION_PROOF_OUTER_GRACE_MS === undefined) return own;
  const outer = positiveInt("MUTATION_PROOF_OUTER_GRACE_MS");
  return Math.max(1, Math.min(own, Math.floor(outer / 2)));
}

function positiveInt(name: string): number {
  const raw = process.env[name] ?? "";
  const value = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(value)) {
    configError(`${name} が正の整数でない: ${JSON.stringify(raw)}`);
  }
  return value;
}

const progressFile = process.env.MUTATION_PROOF_PROGRESS_FILE ?? "";
if (progressFile === "") configError("MUTATION_PROOF_PROGRESS_FILE が無い");
const idleMs = positiveInt("MUTATION_PROOF_WRAPPER_IDLE_MS");
const graceMs = effectiveGrace(positiveInt("MUTATION_PROOF_WRAPPER_GRACE_MS"));
const [file, ...args] = process.argv.slice(2);
if (file === undefined) configError("起動するコマンドが無い");

/** プロセスグループに、まだプロセスがいるか。EPERM は、いるが signal を送れない状態なので、いるとして扱う。 */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pgid, signal);
  } catch {
    /* 先に消えていれば送る相手がいない */
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `ms` の間、グループが消えるのを待つ。消えたら true。 */
async function waitGone(pgid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (groupAlive(pgid)) {
    if (Date.now() >= deadline) return false;
    await sleep(50);
  }
  return true;
}

/**
 * 子のグループを止める。まず SIGTERM を送り、猶予の間に消えなければ SIGKILL を送る。
 * SIGTERM を先に送るのは、テストが中で起動した入れ子のランナーに、当てた変異を戻させるためである。
 * SIGKILL では、入れ子のランナーは変異を作業ツリーに残したまま終わる。
 * 止めた後もプロセスが残っていれば、leftover を知らせて false を返す。
 */
async function stopGroup(pgid: number): Promise<boolean> {
  if (!groupAlive(pgid)) return true;
  signalGroup(pgid, "SIGTERM");
  if (await waitGone(pgid, graceMs)) return true;
  signalGroup(pgid, "SIGKILL");
  if (await waitGone(pgid, REAP_WAIT_MS)) return true;
  notify({ event: "leftover", pgid });
  return false;
}

let child: ChildProcess | null = null;
let stopping = false;

/** 子のグループを止めてから、`code` で終わる。止めた後もプロセスが残れば exit 125 にする。 */
async function stopAndExit(code: number): Promise<never> {
  stopping = true;
  const pgid = child?.pid;
  const gone = pgid === undefined ? true : await stopGroup(pgid);
  process.exit(gone ? code : 125);
}

// signal のハンドラと親の確認は、子を起動する前に登録する。起動の直後に signal が届いても、子のグループを止められるようにする。
// 子は別のプロセスグループにいて、端末の Ctrl-C（SIGINT）と SIGHUP が届かないので、ここで受けて子のグループを止める。
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    notify({ event: "signal", signal });
    void stopAndExit(128 + constants.signals[signal]);
  });
}

// ランナーが SIGKILL などで先に終わると、signal を転送できない。親が替わったことを確かめて、子のグループを止める。
const parent = process.ppid;

/** 進み具合のファイルの、まだ読んでいない行を読む。 */
let readOffset = 0;
function readNewLines(): string[] {
  let size: number;
  try {
    size = statSync(progressFile).size;
  } catch {
    return []; // reporter がまだ書いていない
  }
  if (size <= readOffset) return [];
  const buf = Buffer.alloc(size - readOffset);
  const fd = openSync(progressFile, "r");
  try {
    readSync(fd, buf, 0, buf.length, readOffset);
  } finally {
    closeSync(fd);
  }
  const text = buf.toString("utf8");
  // 書きかけの最後の行は、次に読む
  const end = text.lastIndexOf("\n");
  if (end < 0) return [];
  readOffset += Buffer.byteLength(text.slice(0, end + 1), "utf8");
  return text.slice(0, end).split("\n");
}

/**
 * テストが進まない時間を監視する。行の形は `progress-reporter.ts` が決める。
 * `ready\t<上限>\t<id>\t<名前>` で始まったテストを実行中として持ち、`result\t<id>\t<名前>` で外す。
 * 上限は、`idleMs` と、実行中のテストの上限に余裕を足した値の大きい方にする。
 */
const running = new Map<string, number>();
let lastEventAt = Date.now();
let lastLine = "";
function checkProgress() {
  for (const line of readNewLines()) {
    const [kind, ...rest] = line.split("\t");
    if (kind === "ready") {
      const [timeout, id] = rest;
      // 子が書く行なので、上限に使うのは正の安全な整数だけにする。`Infinity` などを受けると、時間切れにできなくなる。
      // それ以外の値の行は、実行中のテストとして数えない（上限を延ばさない）。進んだことには数える。
      const value = Number(timeout);
      if (Number.isSafeInteger(value) && value > 0) running.set(id ?? "", value);
    } else if (kind === "result") {
      running.delete(rest[0] ?? "");
    } else {
      continue;
    }
    lastEventAt = Date.now();
    lastLine = line;
  }
  const limit = Math.max(idleMs, ...[...running.values()].map((t) => t + TIMEOUT_MARGIN_MS));
  const idle = Date.now() - lastEventAt;
  if (idle <= limit) return;
  const [kind, ...rest] = lastLine.split("\t");
  const name = rest.at(-1) ?? "";
  notify({
    event: "timeout",
    limitMs: limit,
    last: lastLine === "" ? null : { kind, name },
    running: running.size,
  });
  void stopAndExit(124);
}

const timer = setInterval(() => {
  if (stopping) return;
  if (process.ppid !== parent) {
    void stopAndExit(1);
    return;
  }
  checkProgress();
}, POLL_MS);

child = spawn(file, args, {
  stdio: "inherit",
  detached: true,
  env: { ...process.env, MUTATION_PROOF_OUTER_GRACE_MS: String(graceMs) },
});
child.on("error", (err) => {
  notify({ event: "spawn-error", message: err.message });
  process.exit(127);
});
child.on("exit", (code, signal) => {
  if (stopping) return;
  clearInterval(timer);
  // テストが終わっても、forks のワーカーやテストが起動したプロセスが同じグループに残ることがある。止めてから終わる。
  const status = code ?? 128 + (signal === null ? 0 : constants.signals[signal]);
  void stopAndExit(status);
});
