// テストファイルの終わりに、makeTempDirFactory が作り直した共有の一時ディレクトリを消す（Issue #1108、#1112）。
//
// なぜ要るか: vitest の `isolate: false` では、テストファイルの間でモジュールを使い回す。共有のヘルパーがモジュールの最上位で
// makeTempDirFactory を呼ぶと、その共有のディレクトリは最初のファイルの afterAll で消え、後のファイルは作り直したものを使う。
// 作り直したものを消す afterAll は、使う側のファイルでは登録できない（テストの中からは登録できない）。
// setupFiles はテストファイルごとに実行されるので、ここで登録する。
import { afterAll } from "vitest";
import { removeRecreatedRoots } from "../test-tmpdir.ts";

afterAll(() => removeRecreatedRoots());
