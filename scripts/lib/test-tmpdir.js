// テストが使う一時ディレクトリの作成と後片付けを 1 か所にまとめる（Issue #479）。
//
// `mkdtempSync(join(tmpdir(), ...))` を各テストが直に呼ぶと、後片付けを書き忘れたファイルが
// `pnpm test` のたびに `/tmp` へ数百個ずつ残す。変異実証は変異 1 件ごとにテストファイルを丸ごと
// 実行するのでさらに数十倍になり、tmpfs の inode を使い切った。作成と登録を分けると書き忘れが
// 再発するので、作った時点で消す予約まで済ませる（直呼びは `test-tmpdir.test.js` が落とす）。
//
// - `makeTempDir`: テストの中（`beforeEach` を含む）で作り、そのテストの終わりに消す（`onTestFinished`。
//   assertion が落ちても走る）。収集時に呼ぶと `onTestFinished` が例外を投げるので、取り違えは黙って通らない。
// - `makeSharedTempDir`: 収集時（モジュールの最上位・`describe` の本体）に作り、複数のテストで共有する。
//   その階層の `afterAll` で消す。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, onTestFinished } from "vitest";

export function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return dir;
}

export function makeSharedTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
