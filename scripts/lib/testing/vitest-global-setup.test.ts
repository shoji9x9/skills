// globalSetup が消す残骸の fixture の範囲の回帰テスト。
//
// | 軸       | 値                                                                  |
// | -------- | ------------------------------------------------------------------- |
// | 名前     | mutation-proof-fixture- で始まる / 途中に含む / 関係のない名前      |
// | 種類     | ディレクトリ（中身あり） / ファイル                                 |
// | 階層     | 直下 / 下の階層                                                     |
//
// 本物の scripts/ では掃かない。並んで実行中の check-mutation-proof.test.ts の fixture を消すからである。
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeTempDir } from "./test-tmpdir.ts";
import { sweepStaleFixtures } from "./vitest-global-setup.ts";

test("直下の mutation-proof-fixture-* だけを中身ごと消し、他の名前と下の階層は残す", () => {
  const dir = makeTempDir("vitest-global-setup-");
  mkdirSync(join(dir, "mutation-proof-fixture-abc", "nested"), { recursive: true });
  writeFileSync(join(dir, "mutation-proof-fixture-abc", "nested", "fixture.test.ts"), "");
  writeFileSync(join(dir, "mutation-proof-fixture-file"), "");
  mkdirSync(join(dir, "keep-mutation-proof-fixture-x"));
  mkdirSync(join(dir, "lib", "mutation-proof-fixture-deep"), { recursive: true });
  writeFileSync(join(dir, "other.ts"), "");

  sweepStaleFixtures(dir);

  expect(readdirSync(dir).sort()).toEqual(["keep-mutation-proof-fixture-x", "lib", "other.ts"]);
  expect(existsSync(join(dir, "lib", "mutation-proof-fixture-deep"))).toBe(true);
});
