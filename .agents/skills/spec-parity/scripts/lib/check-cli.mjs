// 検査の CLI（`--名前 値` の引数を読み、判定の結果を stdout へ JSON で書くもの）に共通する処理。引数は lib/flags.mjs の parseFlags で読む。
// このファイルは、同じ内容を複数の配布スキルが持つ。スキルの中で完結させるため、共有せずにコピーする。

import { readFileSync } from "node:fs";

/**
 * 理由と使い方を stderr へ書いて 2 を返す関数を作る。
 * 引数と入力の誤りは判定の結果ではないので、stdout の JSON に混ぜない。
 * @param {(s: string) => void} writeErr
 * @param {string} usage
 * @returns {(message: string) => number}
 */
function usageFailer(writeErr, usage) {
  return (message) => {
    writeErr(`error: ${message}\n${usage}\n`);
    return 2;
  };
}

/**
 * 判定の結果を stdout へ JSON で書き、終了コードを返す（構造の誤りは 2、指摘があれば 1、無ければ 0）。
 * 出力は tool・version、ok、fields、findings、counts の順に並べる。findings は常に result から書く。
 * fields に findings を置くと、その位置に result の findings を書く（出力での位置だけを呼び出し元が決める）。
 * 結果が counts を持つときだけ counts を書き、構造の誤りでなければ指摘の件数を足す。
 * @param {(s: string) => void} write
 * @param {{ structural: boolean, findings: unknown[], counts?: Record<string, number> }} result
 * @param {{ tool: string, version: string, fields: Record<string, unknown> }} shape
 * @returns {number}
 */
function writeCheckResult(write, result, { tool, version, fields }) {
  /** @param {Record<string, unknown>} obj */
  const out = (obj) => write(`${JSON.stringify({ tool, version, ...obj }, null, 2)}\n`);
  const { counts } = result;
  if (result.structural) {
    out({ ok: false, structural: true, findings: result.findings, ...(counts ? { counts } : {}) });
    return 2;
  }
  out({
    ok: result.findings.length === 0,
    ...fields,
    findings: result.findings,
    ...(counts ? { counts: { ...counts, findings: result.findings.length } } : {}),
  });
  return result.findings.length === 0 ? 0 : 1;
}

/**
 * CLI の入出力。差し込まれた関数を使い、省いたものは node:fs・process.cwd()・process の stdout と stderr で補う。
 * テストは子プロセスを起動せずに main を直接呼ぶので、これらを差し込めるようにする。
 * @param {{ readFile?: (path: string) => string, cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} deps
 * @returns {{ readFile: (path: string) => string, cwd: string, write: (s: string) => void, writeErr: (s: string) => void }}
 */
function cliIo(deps) {
  return {
    readFile: deps.readFile ?? ((p) => readFileSync(p, "utf8")),
    cwd: deps.cwd ?? process.cwd(),
    write: deps.write ?? ((s) => process.stdout.write(s)),
    writeErr: deps.writeErr ?? ((s) => process.stderr.write(s)),
  };
}

export { cliIo, usageFailer, writeCheckResult };
