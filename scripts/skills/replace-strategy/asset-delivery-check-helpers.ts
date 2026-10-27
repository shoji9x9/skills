// asset-delivery-check.test.ts のヘルパー。
import { assert, vi } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fetcher } from "../../../skills/replace-strategy/scripts/asset-delivery-check.mjs";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { main } from "../../../skills/replace-strategy/scripts/asset-delivery-check.mjs";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export {
  readAssetLedger,
  readRecord,
  referencedUrls,
} from "../../../skills/replace-strategy/scripts/asset-delivery-check.mjs";
export const script = join(repoRoot, "skills/replace-strategy/scripts/asset-delivery-check.mjs");

export const TEMPLATE = readFileSync(
  join(repoRoot, "skills/replace-strategy/assets/assets-template.md"),
  "utf8",
);

/** --write の先に書き出された replace-metadata.json のうち、テストが読む項目。 */
export type DeliveredFile = { kind: string; bytes_match: boolean; referenced: boolean };
export type Written = {
  slug: string;
  asset_delivery_check: {
    ok: boolean;
    error: string | null;
    files: DeliveredFile[];
    ledger_fingerprint: string;
    probe_fingerprints: unknown[];
  };
};

/** 書き出された記録から favicon の行を取り出す。無ければテストを失敗させる。 */
export function faviconOf(written: Written): DeliveredFile {
  const favicon = written.asset_delivery_check.files.find((f) => f.kind === "favicon");
  assert.exists(favicon, "記録に favicon の行が無い");
  return favicon;
}

export const CUR = "http://current.test";
export const NEW = "http://new.test";

/** 原本のテンプレートの方針の表の末尾に行を足す。 */
export function ledger(...extraRows: string[]) {
  const lines = TEMPLATE.split("\n");
  let last = -1;
  lines.forEach((line, i) => {
    if (line.startsWith("| ")) last = i;
  });
  lines.splice(last + 1, 0, ...extraRows);
  return lines.join("\n");
}

/** asset-probe.mjs の返り値の形（全キーを持たせる）。 */
export function probe(overrides: Record<string, unknown> = {}) {
  return {
    url: "/orders",
    images: [],
    urlRefs: [],
    localFragmentRefs: [],
    glyphs: [],
    fontFaces: [],
    loadedFonts: [],
    icons: [],
    manifests: [],
    urlPropsScanned: ["background-image"],
    resources: [],
    unclassifiedResources: [],
    resourceEntryCount: 0,
    resourcesCompleteness: "unknown",
    shadowRoots: 0,
    unreadableSheets: [],
    ...overrides,
  };
}

/** URL → バイト列の表から取得する関数を作る（表に無い URL は 404）。 */
export function fetcherOf(table: Record<string, string>) {
  return async (url: string) => {
    if (!(url in table)) return { ok: false, status: 404, bytes: null, error: null };
    return { ok: true, status: 200, bytes: Buffer.from(table[url]), error: null };
  };
}

export const SAME_FONTS = {
  [`${CUR}/body.woff2`]: "woff2-bytes",
  [`${NEW}/fonts/body.woff2`]: "woff2-bytes",
  [`${CUR}/body.woff`]: "woff-bytes",
  [`${NEW}/fonts/body.woff`]: "woff-bytes",
};

/** runCheck の入力。省いた項目には、欠陥の無いデフォルトを使う。 */
export type RunCheckOptions = {
  ledgerText?: string;
  record?: unknown;
  recordText?: string;
  probes?: unknown[];
  table?: Record<string, string>;
  extraArgs?: string[];
  metadata?: unknown;
  noProbeArg?: boolean;
  currentBase?: string;
  newBase?: string;
  fetcher?: Fetcher;
};

/** runCheck の入力（台帳・記録・メタデータ・測定の結果）を dir に書き、main に渡すパスを返す。 */
function writeCheckInputs(dir: string, opts: RunCheckOptions) {
  const assets = join(dir, "assets.md");
  const record = join(dir, "asset-delivery.json");
  const meta = join(dir, "replace-metadata.json");
  writeFileSync(assets, opts.ledgerText ?? ledger());
  writeFileSync(record, opts.recordText ?? JSON.stringify(opts.record ?? { entries: [] }));
  writeFileSync(
    meta,
    JSON.stringify(opts.metadata ?? { slug: "orders", suite: { new_green: true } }),
  );
  const probeArgs: string[] = [];
  (opts.probes ?? []).forEach((p, i) => {
    const path = join(dir, `probe-${i}.json`);
    writeFileSync(path, typeof p === "string" ? p : JSON.stringify(p));
    probeArgs.push("--probe", path);
  });
  return { assets, record, meta, probeArgs };
}

/**
 * main を直接呼び、終了コードと出力を返す。
 * @param {{ ledgerText?: string, record?: unknown, recordText?: string, probes?: unknown[], table?: Record<string, string>, extraArgs?: string[], metadata?: unknown, noProbeArg?: boolean }} opts
 */
export async function runCheck(opts: RunCheckOptions) {
  const dir = makeTempDir("asset-delivery-");
  const { assets, record, meta, probeArgs } = writeCheckInputs(dir, opts);
  const out: string[] = [];
  const err: string[] = [];
  const so = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((s) => (out.push(String(s)), true));
  const se = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((s) => (err.push(String(s)), true));
  let code;
  try {
    code = await main(
      [
        "--assets",
        assets,
        "--record",
        record,
        "--current-base",
        opts.currentBase ?? CUR,
        "--new-base",
        opts.newBase ?? NEW,
        ...probeArgs,
        "--write",
        meta,
        ...(opts.extraArgs ?? []),
      ],
      { fetcher: opts.fetcher ?? fetcherOf(opts.table ?? SAME_FONTS) },
    );
  } finally {
    so.mockRestore();
    se.mockRestore();
  }
  return {
    code,
    stdout: out.join(""),
    stderr: err.join(""),
    written: parseJsonAs<Written>(readFileSync(meta, "utf8")),
  };
}

/** bodies の path に本文を返し、それ以外に 404 を返す HTTP サーバーを、空いたポートで起動する。 */
export async function serveBodies(bodies: Record<string, string>) {
  const server = createServer((req, res) => {
    const body = bodies[req.url ?? ""];
    if (body === undefined) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const address = server.address();
  assert(address !== null && typeof address === "object", "TCP で listen していない");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

/** favicon の記録と測定の結果を dir に書き、CLI を子プロセスで起動する。 */
export function runFaviconCli({
  dir,
  base,
  newPath,
}: {
  dir: string;
  base: string;
  newPath: string;
}) {
  writeFileSync(
    join(dir, "record.json"),
    JSON.stringify({
      entries: [
        {
          kind: "favicon",
          files: [{ current: `${base}/cur/favicon.ico`, new: newPath }],
        },
      ],
    }),
  );
  writeFileSync(
    join(dir, "probe.json"),
    JSON.stringify(probe({ icons: [{ rel: "icon", href: `${base}${newPath}` }] })),
  );
  // spawnSync はイベントループを止めるので、同じプロセスのサーバーは応答できない。そのため非同期で起動する。
  return new Promise<{ status: number | null; stdout: string }>((resolveRun) => {
    const child = spawn(
      process.execPath,
      [
        script,
        "--assets",
        join(dir, "assets.md"),
        "--record",
        join(dir, "record.json"),
        "--current-base",
        base,
        "--new-base",
        base,
        "--probe",
        join(dir, "probe.json"),
      ],
      { timeout: CHILD_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", (status) => resolveRun({ status, stdout }));
  });
}
