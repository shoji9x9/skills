// fetch-aws-icons.test.ts のヘルパー。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/aws-architecture-diagram/scripts/fetch-aws-icons.mjs");
export const ICONS_PAGE = "https://aws.amazon.com/architecture/icons/";
export const PACKAGE_URL =
  "https://d1.awsstatic.com/webteam/architecture-icons/q3-2026/Icon-package_07312026.zip";

export type ZipFile = { name: string; data: string; method?: 0 | 8 | 12 };

/** 標準の ZIP（local header・central directory・EOCD）を組み立てる。 */
export function zip(files: ZipFile[]): Buffer {
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

export const svg = (marker: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g class="${marker}"/></svg>`;
export const page = `<html><a href="${PACKAGE_URL}">Download</a></html>`;
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

export type Route = { status?: number; body: string | Buffer };

/** 偽物の fetch（応答の本文・preload のスクリプト）を fake に書き、子プロセスに渡す表を返す。 */
function writeFakeFetch(fake: string, routes: Record<string, Route>) {
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
  return { table, requested, preload };
}

/** 図ディレクトリと偽物の fetch を用意し、スクリプトを子プロセスで実行する。 */
export function run(opts: { args?: string[]; manifest?: unknown; routes?: Record<string, Route> }) {
  const dir = makeTempDir("fetch-icons-");
  writeFileSync(
    join(dir, "icon-manifest.json"),
    JSON.stringify(opts.manifest === undefined ? manifest : opts.manifest),
  );
  const fake = join(dir, "fake");
  mkdirSync(fake);
  const { table, requested, preload } = writeFakeFetch(
    fake,
    opts.routes ?? {
      [ICONS_PAGE]: { body: page },
      [PACKAGE_URL]: { body: fullZip() },
    },
  );
  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(preload).href, script, ...(opts.args ?? [])],
    {
      cwd: dir,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: join(dir, "xdg"),
        FAKE_FETCH_ROUTES: JSON.stringify(table),
      },
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
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
