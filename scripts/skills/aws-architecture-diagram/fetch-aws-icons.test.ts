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
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/aws-architecture-diagram/assets/engine/fetch-aws-icons.mjs");
const ICONS_PAGE = "https://aws.amazon.com/architecture/icons/";
const PACKAGE_URL =
  "https://d1.awsstatic.com/webteam/architecture-icons/q3-2026/Icon-package_07312026.zip";

type ZipFile = { name: string; data: string; method?: 0 | 8 | 12 };

/** 標準の ZIP（local header・central directory・EOCD）を組み立てる。 */
function zip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const method = f.method ?? 8;
    const raw = Buffer.from(f.data, "utf8");
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(f.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const svg = (marker: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g class="${marker}"/></svg>`;
const page = `<html><a href="${PACKAGE_URL}">Download</a></html>`;
const manifest = {
  aws: { lambda: "AWS-Lambda", dynamodb: "Amazon-DynamoDB", s3: "Amazon-Simple-Storage-Service" },
};
const fullZip = () =>
  zip([
    // __MACOSX/ の AppleDouble は同じ basename を持つ。後に置き、実体を上書きしないことを確かめる。
    {
      name: "Architecture-Service-Icons/Arch_Compute/64/Arch_AWS-Lambda_64.svg",
      data: svg("lambda"),
      method: 0,
    },
    {
      name: "Architecture-Service-Icons/Arch_Database/64/Arch_Amazon-DynamoDB_64.svg",
      data: svg("dynamodb"),
    },
    {
      name: "__MACOSX/Architecture-Service-Icons/Arch_Compute/64/Arch_AWS-Lambda_64.svg",
      data: "appledouble",
    },
    {
      name: "Architecture-Service-Icons/Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg",
      data: svg("s3"),
    },
  ]);

type Route = { status?: number; body: string | Buffer };

/** 図ディレクトリと偽物の fetch を用意し、スクリプトを子プロセスで実行する。 */
function run(opts: { args?: string[]; manifest?: unknown; routes?: Record<string, Route> }) {
  const dir = makeTempDir("fetch-icons-");
  writeFileSync(
    join(dir, "icon-manifest.json"),
    JSON.stringify(opts.manifest === undefined ? manifest : opts.manifest),
  );
  const fake = join(dir, "fake");
  mkdirSync(fake);
  const routes = opts.routes ?? {
    [ICONS_PAGE]: { body: page },
    [PACKAGE_URL]: { body: fullZip() },
  };
  const table: Record<string, { status: number; file: string }> = {};
  const requested = join(fake, "requested.txt");
  Object.entries(routes).forEach(([url, route], i) => {
    const file = join(fake, `body-${i}`);
    writeFileSync(file, route.body);
    table[url] = { status: route.status ?? 200, file };
  });
  const preload = join(fake, "fake-fetch.mjs");
  writeFileSync(
    preload,
    `import { appendFileSync, readFileSync } from "node:fs";
const routes = JSON.parse(process.env.FAKE_FETCH_ROUTES);
globalThis.fetch = async (url) => {
  appendFileSync(${JSON.stringify(requested)}, url + "\\n");
  const r = routes[url];
  if (!r) throw new Error("unexpected fetch: " + url);
  return new Response(readFileSync(r.file), { status: r.status, statusText: r.status === 200 ? "OK" : "Not Found" });
};
`,
  );
  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(preload).href, script, ...(opts.args ?? [])],
    {
      cwd: dir,
      env: { ...process.env, DIAGRAM_DIR: dir, FAKE_FETCH_ROUTES: JSON.stringify(table) },
      encoding: "utf8",
    },
  );
  if (result.error) throw result.error;
  const outDir = join(dir, "icons/aws-icons");
  return {
    ...result,
    dir,
    outDir,
    written: existsSync(outDir) ? readdirSync(outDir).sort() : [],
    requested: existsSync(requested) ? readFileSync(requested, "utf8").trim().split("\n") : [],
  };
}

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
  ["--only の値が無い", ["--only"], "--only には値を指定してください"],
  ["--only の次が別のフラグ", ["--only", "--verbose"], "--only には値を指定してください"],
  ["--only= の後が空", ["--only="], "--only= には値を指定してください"],
  ["--only の有効な id が 0 件", ["--only", " , "], "--only に有効な id がありません"],
  ["--out の値が無い", ["--out"], "--out には値を指定してください"],
])("%s ときは、取得せずにエラーにする", (_label, args, message) => {
  const r = run({ args });
  expect(r.status).not.toBe(0);
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
