// aws-architecture-diagram の fetch-aws-icons.mjs のテスト。
//
// スクリプトは公式ページから Icon-package の ZIP の URL を取り出し、ZIP を取得して、
// icon-manifest.json の id ごとに Arch_<サービス名>_64.svg を aws-icons/<id>.svg として書き出す。
// ネットワークには出ず、子プロセスの起動時に --import で読み込むモジュールが fetch を偽物に置き換える。
// 偽物は URL ごとの応答（状態コードと本文のファイル）を環境変数 FAKE_FETCH_ROUTES の JSON から返す。
//
// 確かめる状態は次のとおりである。
//   - 引数: --only なし / `--only a,b` / `--only=a` / 値が無い / 次が別のフラグ / `--only=` / 有効な id が 0 件 /
//     マニフェストに無い id / --out
//   - マニフェスト: null / aws が無い / aws が object でない
//   - 公式ページ: 200 以外 / URL が無い。ZIP: 200 以外 / EOCD が無い / 未対応の圧縮方式
//   - ZIP の中身: 無圧縮と deflate / __MACOSX/ の同名のファイル / マニフェストにあるのに ZIP に無い id

import { expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { zip, svg, run, ICONS_PAGE, page, PACKAGE_URL } from "./fetch-aws-icons-helpers.ts";

test("公式ページから得た ZIP から、マニフェストの全 id を aws-icons/<id>.svg と NOTICE.md に書き出す", () => {
  const r = run({});
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(r.requested).toEqual([ICONS_PAGE, PACKAGE_URL]);
  expect(r.written).toEqual(["NOTICE.md", "dynamodb.svg", "lambda.svg", "s3.svg"]);
  // 無圧縮（lambda）と deflate（dynamodb・s3）のどちらも元の SVG に戻り、__MACOSX/ の中身は使わない。
  expect(readFileSync(join(r.outDir, "lambda.svg"), "utf8")).toBe(svg("lambda"));
  expect(readFileSync(join(r.outDir, "dynamodb.svg"), "utf8")).toBe(svg("dynamodb"));
  expect(readFileSync(join(r.outDir, "s3.svg"), "utf8")).toBe(svg("s3"));
  // 出典に、実際に取得したパッケージの URL を書く。
  expect(readFileSync(join(r.outDir, "NOTICE.md"), "utf8")).toContain(`<${PACKAGE_URL}>`);
  expect(r.stdout).toContain(`パッケージ: ${PACKAGE_URL}`);
  expect(r.stdout).toContain(`書き出し: 3 個 → ${r.outDir}`);
});

test.each([
  ["--only lambda,s3", ["--only", "lambda,s3"], ["NOTICE.md", "lambda.svg", "s3.svg"]],
  ["--only=dynamodb", ["--only=dynamodb"], ["NOTICE.md", "dynamodb.svg"]],
])("%s は指定した id だけを書き出す", (_label, args, expected) => {
  const r = run({ args });
  expect(r.status).toBe(0);
  expect(r.written).toEqual(expected);
});

test("--only のうちマニフェストに無い id は、警告して残りを書き出す", () => {
  const r = run({ args: ["--only", "lambda,nosuch"] });
  expect(r.status).toBe(0);
  expect(r.stderr).toContain("マニフェストに無い id を無視します: nosuch");
  expect(r.written).toEqual(["NOTICE.md", "lambda.svg"]);
});

test("--out で出力先を変える", () => {
  const dir = makeTempDir("fetch-icons-out-");
  const r = run({ args: ["--out", dir, "--only", "s3"] });
  expect(r.status).toBe(0);
  expect(readdirSync(dir).sort()).toEqual(["NOTICE.md", "s3.svg"]);
  expect(r.written).toEqual([]);
});

test("マニフェストにあるのに ZIP に無い id は、ファイル名を添えて警告する", () => {
  const r = run({
    manifest: { aws: { lambda: "AWS-Lambda", renamed: "Amazon-Renamed-Service" } },
  });
  expect(r.status).toBe(0);
  expect(r.written).toEqual(["NOTICE.md", "lambda.svg"]);
  expect(r.stderr).toContain("renamed (Arch_Amazon-Renamed-Service_64.svg)");
  expect(r.stdout).toContain("書き出し: 1 個");
});

test.each([
  ["--only の値が無い", ["--only"], "error: --only に値が無い", 2],
  ["--only の次が別のフラグ", ["--only", "--out"], "error: --only に値が無い", 2],
  ["--only= の後が空", ["--only="], "error: --only に値が無い", 2],
  ["--only の有効な id が 0 件", ["--only", " , "], "--only に有効な id がありません", 1],
  ["--out の値が無い", ["--out"], "error: --out に値が無い", 2],
  ["--only が 2 回ある", ["--only", "lambda", "--only", "s3"], "error: --only が重複している", 2],
  ["知らない引数がある", ["--verbose"], "error: 不明な引数: --verbose", 2],
  ["位置引数がある", ["lambda"], "error: 不明な引数: lambda", 2],
])("%s ときは、取得せずにエラーにする", (...[, args, message, status]) => {
  const r = run({ args });
  expect(r.status).toBe(status);
  expect(r.stderr).toContain(message);
  expect(r.requested).toEqual([]);
  expect(r.written).toEqual([]);
});

test.each([
  ["null", null, "Cannot read properties of null (reading 'aws')"],
  ["aws が無い", { other: {} }, "icon-manifest.json に aws マッピングがありません"],
  ["aws が object でない", { aws: "lambda" }, "icon-manifest.json に aws マッピングがありません"],
])("マニフェストが %s ときは、取得せずにエラーにする", (_label, value, message) => {
  const r = run({ manifest: value });
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain(message);
  expect(r.requested).toEqual([]);
});

test.each([
  [
    "公式ページが 200 以外",
    { [ICONS_PAGE]: { status: 404, body: "" } },
    `公式アイコンページの取得に失敗しました（HTTP 404 Not Found）: ${ICONS_PAGE}`,
  ],
  [
    "公式ページに Icon-package の URL が無い",
    { [ICONS_PAGE]: { body: "<html>moved</html>" } },
    "公式ページから Icon-package の URL を抽出できませんでした",
  ],
  [
    "ZIP が 200 以外",
    { [ICONS_PAGE]: { body: page }, [PACKAGE_URL]: { status: 404, body: "" } },
    `アイコンパッケージの取得に失敗しました（HTTP 404 Not Found）: ${PACKAGE_URL}`,
  ],
  [
    "ZIP に EOCD が無い",
    { [ICONS_PAGE]: { body: page }, [PACKAGE_URL]: { body: Buffer.alloc(64) } },
    "ZIP: EOCD が見つかりません",
  ],
  [
    "未対応の圧縮方式",
    {
      [ICONS_PAGE]: { body: page },
      [PACKAGE_URL]: { body: zip([{ name: "Arch_AWS-Lambda_64.svg", data: "x", method: 12 }]) },
    },
    "ZIP: 未対応の圧縮方式 12: Arch_AWS-Lambda_64.svg",
  ],
])("%s ときは、理由を示してエラーにする", (_label, routes, message) => {
  const r = run({ routes, args: ["--only", "lambda"] });
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain(message);
  expect(r.written.filter((f) => f.endsWith(".svg"))).toEqual([]);
});
