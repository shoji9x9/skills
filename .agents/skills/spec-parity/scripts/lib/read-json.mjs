// spec-parity の判定のスクリプトが共有する、JSON のファイルを読む部品と、使い方の誤りを表す例外。
// 判定のスクリプトは、読めない入力を合格にせず、UsageError で exit 2 にする。

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { errorMessage } from "./errors.mjs";
import { writeFileAtomic } from "./file-io.mjs";

/** 使い方の誤り・読めない入力・形の誤り。CLI は exit 2 にする。 */
class UsageError extends Error {}

/**
 * main が使う入出力。テストはメモリ上のファイルを渡す。
 * @typedef {{ readFile: (p: string) => string, writeFile: (p: string, s: string) => void, exists: (p: string) => boolean, cwd: string, stdout: (s: string) => void, stderr: (s: string) => void }} JudgeIo
 */

/**
 * JSON のファイルを読む。読めない・JSON でないときは UsageError を投げる。
 * @param {string} path - io.cwd からの相対パスか絶対パス
 * @param {Pick<JudgeIo, "readFile" | "cwd">} io
 * @returns {unknown}
 */
function readJsonFile(path, io) {
  const text = orUsageError(() => io.readFile(resolve(io.cwd, path)), `読めない: ${path}`);
  return orUsageError(() => JSON.parse(text), `JSON でない: ${path}`);
}

/**
 * 処理を実行し、投げた例外を、理由を添えた UsageError にする。
 * @template T
 * @param {() => T} fn
 * @param {string} what - 利用者に示す失敗の内容
 * @returns {T}
 */
function orUsageError(fn, what) {
  try {
    return fn();
  } catch (e) {
    throw new UsageError(`${what}（${errorMessage(e)}）`);
  }
}

/**
 * JSON を、末尾に改行を付けた 2 字下げの文字列にする。
 * @param {unknown} value
 * @returns {string}
 */
function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * 差し込まれなかった入出力を、本物のファイルと標準出力で埋める。
 * @param {Partial<JudgeIo>} deps
 * @returns {JudgeIo}
 */
function judgeIo(deps) {
  /** @type {JudgeIo} */
  const real = {
    cwd: process.cwd(),
    exists: (p) => existsSync(p),
    readFile: (p) => readFileSync(p, "utf8"),
    // 承認の記録を持つファイルを書くので、途中で止まっても書きかけの JSON を残さない
    writeFile: (p, s) => writeFileAtomic(p, s),
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
  };
  return { ...real, ...deps };
}

/**
 * JSON を、io.cwd からのパスに書く。
 * @param {JudgeIo} io
 * @param {string} path
 * @param {unknown} doc
 */
function writeJsonFile(io, path, doc) {
  io.writeFile(resolve(io.cwd, path), jsonText(doc));
}

/**
 * 判定の本体を実行し、UsageError を exit 2 にする。ほかの例外はそのまま投げる（判定の誤りを exit 2 に隠さない）。
 * @param {{ io: JudgeIo, usage: string, onUsageError?: (e: UsageError) => void }} ctx
 * @param {() => number} body
 * @returns {number}
 */
function runJudge(ctx, body) {
  try {
    return body();
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    ctx.onUsageError?.(e);
    ctx.io.stderr(`error: ${errorMessage(e)}\n${ctx.usage}\n`);
    return 2;
  }
}

export { UsageError, judgeIo, jsonText, readJsonFile, runJudge, writeJsonFile };
