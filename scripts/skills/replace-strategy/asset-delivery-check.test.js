// 静的資産の台帳で「実体をコピーする」と決めた資産の新側突き合わせ（asset-delivery-check.mjs）の回帰テスト（Issue #458）。
//
// 実例: 台帳で favicon を「実体をコピーする」と決めたのに、新側の index.html に指定が無いまま機能が閉じた。
// favicon はタブにしか出ないので、スイート・画素・特性照合・aria のどれにも記録されない。
//
// 台帳の fixture は原本（replace-strategy の assets/assets-template.md）をそのまま読み、行を足して作る
// （判定に要る列だけを残した表で測ると、実装が別の列を読み始めたときに実在しない形を固定するテストになる）。
// 通さねばならない入力と落とす入力を、同じ数だけ置く。

import { expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/replace-strategy/scripts/asset-delivery-check.mjs");
const { main, readLedger, readRecord, referencedUrls } = await import(script);

const TEMPLATE = readFileSync(
  join(repoRoot, "skills/replace-strategy/assets/assets-template.md"),
  "utf8",
);
const RECORD_TEMPLATE = readFileSync(
  join(repoRoot, "skills/parity-replace/assets/asset-delivery-template.json"),
  "utf8",
);

const CUR = "http://current.test";
const NEW = "http://new.test";
const FAVICON_ROW =
  "| favicon | `favicon.ico`（現行の配信物） | `link[rel=icon]`、全ページ | 実体をコピーする | 可（先方の許諾・2026-09-01） | - | - | 有効 | 2026-09-01・setup | タブの見た目を一致させるため |";
const FIGURE_ROW =
  "| 画面内の図 | `flow.png`（現行の配信物） | `img`、/orders/:id だけ | 実体をコピーする | 可（自社作成） | - | - | 有効 | 2026-09-01・setup | 図の内容を一致させるため |";

/** 原本のテンプレートの方針の表の末尾に行を足す。 */
function ledger(...extraRows) {
  const lines = TEMPLATE.split("\n");
  let last = -1;
  lines.forEach((line, i) => {
    if (line.startsWith("| ")) last = i;
  });
  lines.splice(last + 1, 0, ...extraRows);
  return lines.join("\n");
}

/** asset-probe.mjs の返り値の形（全キーを持たせる）。 */
function probe(overrides = {}) {
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

const FONT_PROBE = probe({
  fontFaces: [{ family: "Body", src: [`${NEW}/fonts/body.woff2`, `${NEW}/fonts/body.woff`] }],
});
const FONT_ENTRY = {
  kind: "本文の書体",
  files: [
    { current: "/body.woff2", new: "/fonts/body.woff2" },
    { current: "/body.woff", new: "/fonts/body.woff" },
  ],
};

/** URL → バイト列の表から取得する関数を作る（表に無い URL は 404）。 */
function fetcherOf(table) {
  return async (url) => {
    if (!(url in table)) return { ok: false, status: 404, bytes: null, error: null };
    return { ok: true, status: 200, bytes: Buffer.from(table[url]), error: null };
  };
}

const SAME_FONTS = {
  [`${CUR}/body.woff2`]: "woff2-bytes",
  [`${NEW}/fonts/body.woff2`]: "woff2-bytes",
  [`${CUR}/body.woff`]: "woff-bytes",
  [`${NEW}/fonts/body.woff`]: "woff-bytes",
};

/**
 * main を直接呼び、終了コードと出力を返す。
 * @param {{ ledgerText?: string, record?: unknown, recordText?: string, probes?: unknown[], table?: Record<string, string>, extraArgs?: string[], metadata?: unknown, noProbeArg?: boolean }} opts
 */
async function runCheck(opts) {
  const dir = makeTempDir("asset-delivery-");
  const assets = join(dir, "assets.md");
  const record = join(dir, "asset-delivery.json");
  const meta = join(dir, "replace-metadata.json");
  writeFileSync(assets, opts.ledgerText ?? ledger());
  writeFileSync(record, opts.recordText ?? JSON.stringify(opts.record ?? { entries: [] }));
  writeFileSync(
    meta,
    JSON.stringify(opts.metadata ?? { slug: "orders", suite: { new_green: true } }),
  );
  const probeArgs = [];
  (opts.probes ?? []).forEach((p, i) => {
    const path = join(dir, `probe-${i}.json`);
    writeFileSync(path, typeof p === "string" ? p : JSON.stringify(p));
    probeArgs.push("--probe", path);
  });
  const out = [];
  const err = [];
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
    written: JSON.parse(readFileSync(meta, "utf8")),
  };
}

// ---- 台帳の読み取り ----

test("台帳: 原本のテンプレートから「有効 × 実体をコピーする」の行だけを取り出す（取り消し済み・同等物・空欄は取らない）", () => {
  const { copyRows } = readLedger(TEMPLATE);
  expect(copyRows.map((r) => r.kind)).toEqual(["本文の書体"]);
});

test("台帳: 旧い方針の値を新しい値と同じ意味に読む（改名する前の台帳を書き直さずに判定する）", () => {
  const text = [
    "| 種類 | 方針 | 状態 |",
    "|---|---|---|",
    "| 新 | 実体をコピーする | 有効 |",
    // 旧い方針の値を読めることを確かめる入力なので、旧い値をそのまま書く。
    // textlint-disable
    "| 旧 | 実体を写す | 有効 |",
    "| 新しい除外 | コピーしない | 有効 |",
    "| 旧い除外 | 写さない | 有効 |",
    // textlint-enable
  ].join("\n");
  const { copyRows, activeRows } = readLedger(text);
  expect(copyRows.map((r) => r.kind)).toEqual(["新", "旧"]);
  expect(activeRows).toBe(4);
});

test("台帳: 行番号は表の中の順番ではなく台帳ファイル上の行を指す（利用者が開く行と揃える）", () => {
  const fileLine = TEMPLATE.split("\n").findIndex((l) => l.startsWith("| 本文の書体 |")) + 1;
  expect(fileLine).toBeGreaterThan(1);
  expect(readLedger(TEMPLATE).copyRows[0].line).toBe(fileLine);
  const broken = TEMPLATE.replace("| 本文の書体 |", "|  |");
  expect(() => readLedger(broken)).toThrow(`台帳の ${fileLine} 行目の「種類」が空`);
});

test("台帳: 表の本体が空行で切れた後の行は警告なしに捨てず判定しない（例外）", () => {
  const text = [
    "| 種類 | 描き方と使われるページ | 方針 | 状態 |",
    "|---|---|---|---|",
    "| ロゴ | `img`、/a | 同等物を作る | 有効 |",
    "",
    "| favicon | `link[rel=icon]`、全ページ | 実体をコピーする | 有効 |",
  ].join("\n");
  expect(() => readLedger(text)).toThrow(/台帳の 5 行目は表に属さない/u);
});

test("台帳: 空行で切れた後の、行頭の `|` を省いた行（GFM では表の行になりうる）も判定しない（例外）", () => {
  const text = [
    "| 種類 | 描き方と使われるページ | 方針 | 状態 |",
    "|---|---|---|---|",
    "| ロゴ | `img`、/a | 同等物を作る | 有効 |",
    "",
    "favicon | `link[rel=icon]`、全ページ | 実体をコピーする | 有効",
  ].join("\n");
  expect(() => readLedger(text)).toThrow(/台帳の 5 行目は表に属さない/u);
});

test("台帳: 表の外の散文に `|` があっても行頭でなければ表の行とみなさない", () => {
  const text = [
    "方針は 実体をコピーする | 同等物を作る のどちらか。",
    "",
    "| 種類 | 描き方と使われるページ | 方針 | 状態 |",
    "|---|---|---|---|",
    "| ロゴ | `img`、/a | 実体をコピーする | 有効 |",
  ].join("\n");
  expect(readLedger(text).copyRows.map((r) => r.kind)).toEqual(["ロゴ"]);
});

test("台帳: HTML コメントとコードフェンスの中の表は台帳として読まない", () => {
  const text = [
    "<!--",
    "| 種類 | 方針 | 状態 |",
    "|---|---|---|",
    "| コメント内 | 実体をコピーする | 有効 |",
    "-->",
    "```md",
    "| 種類 | 方針 | 状態 |",
    "|---|---|---|",
    "| フェンス内 | 実体をコピーする | 有効 |",
    "```",
    "| 種類 | 描き方と使われるページ | 方針 | 状態 |",
    "|---|---|---|---|",
    "| ロゴ | `img`、/a | 実体をコピーする | 有効 |",
  ].join("\n");
  expect(readLedger(text).copyRows.map((r) => r.kind)).toEqual(["ロゴ"]);
});

test("台帳: セル内の `\\|` では列を分けない", () => {
  const text = [
    "| 種類 | ファイル・出どころ | 方針 | 状態 | 使われるページ |",
    "|---|---|---|---|---|",
    "| ロゴ | `a.png` \\| `b.png` | 実体をコピーする | 有効 | /a |",
  ].join("\n");
  expect(readLedger(text).copyRows.map((r) => r.kind)).toEqual(["ロゴ"]);
});

test("台帳: 強調で囲んだ方針・状態・種類は囲みを外して読む", () => {
  const text = [
    "| 種類 | 方針 | 状態 | 使われるページ |",
    "|---|---|---|---|",
    "| **ロゴ** | **実体をコピーする** | **有効** | /a |",
  ].join("\n");
  expect(readLedger(text).copyRows.map((r) => r.kind)).toEqual(["ロゴ"]);
});

test.each([
  ["方針の表が無い", "# 台帳\n\n表なし\n", /列を持つ表が無い/u],
  [
    "方針の表が 2 つ",
    "| 種類 | 方針 | 状態 | 使われるページ |\n|---|---|---|---|\n| a | 実体をコピーする | 有効 | /a |\n\n| 種類 | 方針 | 状態 | 使われるページ |\n|---|---|---|---|\n| b | 実体をコピーする | 有効 | /a |\n",
    /表が 2 個ある/u,
  ],
  [
    "状態が語彙外",
    "| 種類 | 方針 | 状態 | 使われるページ |\n|---|---|---|---|\n| a | 実体をコピーする | 保留 | /a |\n",
    /状態が語彙外/u,
  ],
  [
    "方針が語彙外",
    "| 種類 | 方針 | 状態 | 使われるページ |\n|---|---|---|---|\n| a | コピー | 有効 | /a |\n",
    /方針が語彙外/u,
  ],
  [
    "同じ種類に有効が 2 行",
    "| 種類 | 方針 | 状態 | 使われるページ |\n|---|---|---|---|\n| a | 実体をコピーする | 有効 | /a |\n| a | コピーしない | 有効 | /a |\n",
    /有効 の行が 2 つある/u,
  ],
  [
    "種類が空",
    "| 種類 | 方針 | 状態 | 使われるページ |\n|---|---|---|---|\n|  | 実体をコピーする | 有効 | /a |\n",
    /「種類」が空/u,
  ],
  [
    "列数が見出しと違う",
    "| 種類 | 方針 | 状態 | 使われるページ |\n|---|---|---|---|\n| a | 実体をコピーする | 有効 | /a | 余り |\n",
    /列数が見出しと違う/u,
  ],
])("台帳: %s は判定しない（例外）", (_label, text, message) => {
  expect(() => readLedger(text)).toThrow(message);
});

// ---- 記録の読み取り ----

test.each([
  ["entries が無い", {}, /entries が配列でない/u],
  ["kind が空", { entries: [{ kind: " ", files: [] }] }, /kind が空/u],
  [
    "used を書いた（この画面で使わないは利用者の承認で外す）",
    { entries: [{ kind: "a", used: false, reason: "r" }] },
    /used は書かない/u,
  ],
  [
    "accepted に reason が無い",
    {
      entries: [
        { kind: "a", disposition: "accepted", approved_by: "o", approved_at: "2026-09-30" },
      ],
    },
    /reason が空/u,
  ],
  [
    "accepted に approved_by が無い",
    { entries: [{ kind: "a", disposition: "accepted", reason: "r", approved_at: "2026-09-30" }] },
    /approved_by が空/u,
  ],
  [
    "disposition が語彙外",
    { entries: [{ kind: "a", disposition: "blocking", reason: "r" }] },
    /disposition は accepted だけ/u,
  ],
  ["突き合わせる行に files が無い", { entries: [{ kind: "a" }] }, /files が空/u],
  [
    "files に new が無い",
    { entries: [{ kind: "a", files: [{ current: "/a" }] }] },
    /current と new が無い/u,
  ],
  [
    "accepted に files がある",
    {
      entries: [
        {
          kind: "a",
          disposition: "accepted",
          reason: "r",
          approved_by: "o",
          approved_at: "2026-09-30",
          files: [{ current: "/a", new: "/a" }],
        },
      ],
    },
    /files は accepted の行に書かない/u,
  ],
  [
    "同じ種類が 2 件（表記ゆれを揃えた後で）",
    {
      entries: [
        { kind: "ロゴ", files: [{ current: "/a", new: "/a" }] },
        { kind: "**ロゴ** ", files: [{ current: "/a", new: "/a" }] },
      ],
    },
    /2 件ある/u,
  ],
])("記録: %s は判定しない（例外）", (_label, doc, message) => {
  expect(() => readRecord(doc)).toThrow(message);
});

test("プローブ: asset-probe の出力でない JSON は判定しない（例外）", () => {
  expect(() => referencedUrls({ icons: [] }, "p.json")).toThrow(/asset-probe.mjs の出力でない/u);
});

// ---- 通さねばならない入力（exit 0） ----

test("通す: 参照があり移行元とバイト一致する資産は exit 0 で、結果を replace-metadata.json に書く（他のキーは残す）", async () => {
  const r = await runCheck({ record: { entries: [FONT_ENTRY] }, probes: [FONT_PROBE] });
  expect(r.stdout).toMatch(/^ok: /mu);
  expect(r.code).toBe(0);
  expect(r.written.slug).toBe("orders");
  expect(r.written.asset_delivery_check).toMatchObject({
    tool: "asset-delivery-check",
    ok: true,
    rows: 1,
    checked_rows: 1,
    checked_files: 2,
    failures: 0,
    error: null,
  });
  expect(r.written.asset_delivery_check.files.every((f) => f.bytes_match && f.referenced)).toBe(
    true,
  );
  expect(r.written.asset_delivery_check.ledger_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  // プローブも判定を左右する入力なので指紋を残す
  expect(r.written.asset_delivery_check.probe_fingerprints).toEqual([
    {
      path: expect.stringMatching(/probe-0\.json$/u),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    },
  ]);
});

test("通す: 「実体をコピーする」の有効な行が 0 件の台帳は、プローブ無しで exit 0", async () => {
  const text = [
    "| 種類 | 描き方と使われるページ | 方針 | 状態 |",
    "|---|---|---|---|",
    "| ロゴ | `img`、全ページ | 同等物を作る | 有効 |",
    "| 図 | `img`、/a | 実体をコピーする | 取り消し済み（2026-09-01 → 下の行） |",
    "| 図 | `img`、/a | コピーしない | 有効 |",
  ].join("\n");
  const r = await runCheck({ ledgerText: text, record: { entries: [] } });
  expect(r.code).toBe(0);
  expect(r.written.asset_delivery_check).toMatchObject({ ok: true, rows: 0 });
});

test("判定しない: 記録に used: false と書いた（この画面で使わないは利用者の承認で外す）", async () => {
  const r = await runCheck({
    ledgerText: ledger(FIGURE_ROW),
    record: {
      entries: [FONT_ENTRY, { kind: "画面内の図", used: false, reason: "一覧画面だけの機能" }],
    },
    probes: [FONT_PROBE],
  });
  expect(r.stderr).toMatch(/entries\[1\]\.used は書かない（画面内の図。/u);
  expect(r.code).toBe(2);
});

test("通す: 利用者が承認した accepted の行は突き合わせない", async () => {
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        {
          kind: "favicon",
          disposition: "accepted",
          reason: "manifest の icons からだけ参照される",
          approved_by: "owner",
          approved_at: "2026-09-30",
        },
      ],
    },
    probes: [FONT_PROBE],
  });
  expect(r.code).toBe(0);
});

test("通す: 突き合わせる行が全て accepted ならプローブ無しで exit 0", async () => {
  const r = await runCheck({
    record: {
      entries: [
        {
          kind: "本文の書体",
          disposition: "accepted",
          reason: "r",
          approved_by: "owner",
          approved_at: "2026-09-30",
        },
      ],
    },
  });
  expect(r.code).toBe(0);
});

test("通す: 記録の種類の表記ゆれ（空白・強調）は台帳と同じ正規化で揃えて突き合わせる", async () => {
  const r = await runCheck({
    record: { entries: [{ ...FONT_ENTRY, kind: " **本文の書体** " }] },
    probes: [FONT_PROBE],
  });
  expect(r.code).toBe(0);
});

test("通す: 別オリジン（CDN）の絶対 URL で配る資産も、プローブに同じ URL があれば突き合う", async () => {
  const cdn = "https://cdn.example.test/icons/favicon.ico";
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [FONT_ENTRY, { kind: "favicon", files: [{ current: "/favicon.ico", new: cdn }] }],
    },
    probes: [FONT_PROBE, probe({ icons: [{ rel: "icon", href: cdn, sizes: null }] })],
    table: { ...SAME_FONTS, [`${CUR}/favicon.ico`]: "ico", [cdn]: "ico" },
  });
  expect(r.code).toBe(0);
});

test.each([
  ["images[].src", (u) => probe({ images: [{ src: u, kind: "img" }] })],
  ["urlRefs[].url", (u) => probe({ urlRefs: [{ url: u, property: "background-image" }] })],
  ["fontFaces[].src[]", (u) => probe({ fontFaces: [{ family: "x", src: [u] }] })],
  ["icons[].href", (u) => probe({ icons: [{ rel: "icon", href: u }] })],
  ["resources[].url", (u) => probe({ resources: [{ url: u, initiatorType: "img" }] })],
])("通す: プローブの %s に現れれば参照している", async (_label, make) => {
  const r = await runCheck({
    ledgerText: ledger(FIGURE_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        { kind: "画面内の図", files: [{ current: "/flow.png", new: "/img/flow.png" }] },
      ],
    },
    probes: [FONT_PROBE, make(`${NEW}/img/flow.png`)],
    table: { ...SAME_FONTS, [`${CUR}/flow.png`]: "png", [`${NEW}/img/flow.png`]: "png" },
  });
  expect(r.code).toBe(0);
});

// ---- 落とす入力（exit 1） ----

test("落とす: 実例の形——favicon を配っていてバイトも同じだが、新側の画面が指していない", async () => {
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        { kind: "favicon", files: [{ current: "/favicon.ico", new: "/favicon.ico" }] },
      ],
    },
    probes: [FONT_PROBE],
    table: { ...SAME_FONTS, [`${CUR}/favicon.ico`]: "ico", [`${NEW}/favicon.ico`]: "ico" },
  });
  expect(r.stdout).toMatch(/「favicon」の \/favicon.ico を新側の画面が参照していない/u);
  expect(r.code).toBe(1);
  expect(r.written.asset_delivery_check.ok).toBe(false);
  // 参照の抜けは referenced の軸。バイトは一致しているので bytes_match に混ぜない（「バイト不一致」と読ませない）
  const favicon = r.written.asset_delivery_check.files.find((f) => f.kind === "favicon");
  expect(favicon).toMatchObject({ referenced: false, bytes_match: true });
});

test("落とす: 同じオリジンの構成で current と new が同じ URL に解決される（同じ配信物を比べているだけ）", async () => {
  const HOST = "http://host.test";
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    currentBase: `${HOST}/legacy/`,
    newBase: `${HOST}/app/`,
    record: {
      entries: [
        {
          kind: "本文の書体",
          disposition: "accepted",
          reason: "r",
          approved_by: "owner",
          approved_at: "2026-09-30",
        },
        { kind: "favicon", files: [{ current: "/favicon.ico", new: "/favicon.ico" }] },
      ],
    },
    probes: [probe({ icons: [{ rel: "icon", href: `${HOST}/favicon.ico` }] })],
    table: { [`${HOST}/favicon.ico`]: "ico" },
  });
  expect(r.stdout).toMatch(
    /current と new が同じ URL（http:\/\/host.test\/favicon.ico）に解決される/u,
  );
  expect(r.code).toBe(1);
  expect(r.written.asset_delivery_check.files[0].bytes_match).toBe(false);
});

test("落とす: current が新側のオリジンを指す（移行元を一度も取得していない）", async () => {
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        {
          kind: "favicon",
          files: [{ current: `${NEW}/assets/favicon-abc.ico`, new: "/favicon.ico" }],
        },
      ],
    },
    probes: [FONT_PROBE, probe({ icons: [{ rel: "icon", href: `${NEW}/favicon.ico` }] })],
    table: {
      ...SAME_FONTS,
      [`${NEW}/assets/favicon-abc.ico`]: "ico",
      [`${NEW}/favicon.ico`]: "ico",
    },
  });
  expect(r.stdout).toMatch(
    /assets\/favicon-abc.ico は新側のオリジン（http:\/\/new.test）を指している/u,
  );
  expect(r.code).toBe(1);
});

test("落とす: 移行元が CDN から配る資産へ、新側が同じ CDN のまま直リンクしている", async () => {
  const cdn = "https://static.old.test/img/logo.png";
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [FONT_ENTRY, { kind: "favicon", files: [{ current: cdn, new: `${cdn}?v=2` }] }],
    },
    probes: [FONT_PROBE, probe({ icons: [{ rel: "icon", href: `${cdn}?v=2` }] })],
    table: { ...SAME_FONTS, [cdn]: "png", [`${cdn}?v=2`]: "png" },
  });
  expect(r.stdout).toMatch(/は移行元のオリジン（https:\/\/static.old.test）を指している/u);
  expect(r.code).toBe(1);
});

test("通す: 新側が転送（ハッシュ付きのパスへの 301 等）で配る資産も、参照は転送前の URL・バイトは最終応答で突き合う", async () => {
  const base = fetcherOf({
    ...SAME_FONTS,
    [`${CUR}/favicon.ico`]: "ico",
    [`${NEW}/favicon.ico`]: "ico",
  });
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        { kind: "favicon", files: [{ current: "/favicon.ico", new: "/favicon.ico" }] },
      ],
    },
    probes: [FONT_PROBE, probe({ icons: [{ rel: "icon", href: `${NEW}/favicon.ico` }] })],
    fetcher: async (url) => ({
      ...(await base(url)),
      ...(url === `${NEW}/favicon.ico`
        ? {
            redirected: true,
            finalUrl: `${NEW}/assets/favicon-abc.ico?sig=secret`,
            contentType: "image/x-icon",
          }
        : {}),
    }),
  });
  expect(r.stdout).toMatch(/^ok: /mu);
  expect(r.code).toBe(0);
  const favicon = r.written.asset_delivery_check.files.find((f) => f.kind === "favicon");
  expect(favicon).toMatchObject({ new_redirected: true, bytes_match: true, referenced: true });
  // 転送先は署名付き URL のクエリを含みうるので書き出さない
  expect(JSON.stringify(r.written)).not.toContain("sig=secret");
});

test.each([
  [
    "新側が移行元へ転送する",
    `${NEW}/favicon.ico`,
    `${CUR}/favicon.ico?v=2`,
    /\/favicon.ico は移行元のオリジン（http:\/\/current.test）へ転送される/u,
  ],
  [
    "移行元が新側へ転送する",
    `${CUR}/favicon.ico`,
    `${NEW}/favicon.ico?v=2`,
    /\/favicon.ico は新側のオリジン（http:\/\/new.test）へ転送される/u,
  ],
])("落とす: 転送を経由した直リンク（%s）", async (_label, redirectedUrl, finalUrl, message) => {
  const base = fetcherOf({
    ...SAME_FONTS,
    [`${CUR}/favicon.ico`]: "ico",
    [`${NEW}/favicon.ico`]: "ico",
  });
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        { kind: "favicon", files: [{ current: "/favicon.ico", new: "/favicon.ico" }] },
      ],
    },
    probes: [FONT_PROBE, probe({ icons: [{ rel: "icon", href: `${NEW}/favicon.ico` }] })],
    fetcher: async (url) => ({
      ...(await base(url)),
      ...(url === redirectedUrl ? { redirected: true, finalUrl, contentType: "image/x-icon" } : {}),
    }),
  });
  expect(r.stdout).toMatch(message);
  expect(r.code).toBe(1);
  expect(r.written.asset_delivery_check.files.find((f) => f.kind === "favicon").bytes_match).toBe(
    false,
  );
});

test("落とす: 新側が移行元の配信物へ直リンクしている（new が移行元のオリジン）", async () => {
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        {
          kind: "favicon",
          files: [{ current: "/favicon.ico", new: `${CUR}/favicon.ico` }],
        },
      ],
    },
    probes: [FONT_PROBE, probe({ icons: [{ rel: "icon", href: `${CUR}/favicon.ico` }] })],
    table: { ...SAME_FONTS, [`${CUR}/favicon.ico`]: "ico" },
  });
  expect(r.stdout).toMatch(/移行元のオリジン（http:\/\/current.test）を指している/u);
  expect(r.code).toBe(1);
});

test("落とす: 新側が 200 で別のバイト（SPA のフォールバックの index.html）を返す", async () => {
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        { kind: "favicon", files: [{ current: "/favicon.ico", new: "/favicon.ico" }] },
      ],
    },
    probes: [FONT_PROBE, probe({ icons: [{ rel: "icon", href: `${NEW}/favicon.ico` }] })],
    table: {
      ...SAME_FONTS,
      [`${CUR}/favicon.ico`]: "ico",
      [`${NEW}/favicon.ico`]: "<!doctype html><html></html>",
    },
  });
  expect(r.stdout).toMatch(/「favicon」の新側の配信物が移行元とバイト一致しない/u);
  expect(r.code).toBe(1);
});

test("落とす: 両側とも 200 の空（0 バイト）は sha256 が一致しても配っている証拠にしない", async () => {
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        { kind: "favicon", files: [{ current: "/favicon.ico", new: "/favicon.ico" }] },
      ],
    },
    probes: [FONT_PROBE, probe({ icons: [{ rel: "icon", href: `${NEW}/favicon.ico` }] })],
    table: { ...SAME_FONTS, [`${CUR}/favicon.ico`]: "", [`${NEW}/favicon.ico`]: "" },
  });
  expect(r.stdout).toContain("「favicon」の新側の配信物が空（0 バイト");
  expect(r.code).toBe(1);
});

test.each([
  ["新側", { ...SAME_FONTS, [`${CUR}/favicon.ico`]: "ico" }],
  ["移行元", { ...SAME_FONTS, [`${NEW}/favicon.ico`]: "ico" }],
])("落とす: %sの配信物を取得できない（404）", async (side, table) => {
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        { kind: "favicon", files: [{ current: "/favicon.ico", new: "/favicon.ico" }] },
      ],
    },
    probes: [FONT_PROBE, probe({ icons: [{ rel: "icon", href: `${NEW}/favicon.ico` }] })],
    table,
  });
  expect(r.stdout).toContain(`「favicon」の${side}の配信物を取得できない`);
  expect(r.code).toBe(1);
});

test("落とす: 台帳の「実体をコピーする」の行に記録が無い（突き合わせていない）", async () => {
  const r = await runCheck({
    ledgerText: ledger(FAVICON_ROW),
    record: { entries: [FONT_ENTRY] },
    probes: [FONT_PROBE],
  });
  expect(r.stdout).toMatch(/台帳の「favicon」（実体をコピーする）を突き合わせていない/u);
  expect(r.code).toBe(1);
});

test.each([
  [
    "両側が同じ転送先（ログイン画面）に着く",
    { redirected: true, finalUrl: "http://sso.test/login?state=secret" },
    /移行元と新側が同じ転送先（http:\/\/sso.test\/login）に着いた/u,
  ],
  [
    "HTML の応答（SPA のフォールバック・ログイン画面）",
    { contentType: "text/html; charset=utf-8" },
    /HTML で返った/u,
  ],
])(
  "落とす: 両側とも同じバイトでも、%s は配っている証拠にしない",
  async (_label, extra, message) => {
    const table = { ...SAME_FONTS, [`${CUR}/favicon.ico`]: "same", [`${NEW}/favicon.ico`]: "same" };
    const base = fetcherOf(table);
    const r = await runCheck({
      ledgerText: ledger(FAVICON_ROW),
      record: {
        entries: [
          FONT_ENTRY,
          {
            kind: "favicon",
            files: [{ current: "/favicon.ico", new: "/favicon.ico" }],
          },
        ],
      },
      probes: [FONT_PROBE, probe({ icons: [{ rel: "icon", href: `${NEW}/favicon.ico` }] })],
      fetcher: async (url) => ({
        ...(await base(url)),
        ...(url.endsWith("favicon.ico") ? extra : {}),
      }),
    });
    expect(r.stdout).toMatch(message);
    // 指摘の出た組は、sha256 が一致していても行ごとの記録で「一致」と読めないようにする
    const favicon = r.written.asset_delivery_check.files.find((f) => f.kind === "favicon");
    expect(favicon.bytes_match).toBe(false);
    expect(r.code).toBe(1);
  },
);

test("落とす: 台帳の「実体をコピーする」の有効な行に無い種類の記録（同等物の行・取り消し済みの行）", async () => {
  const r = await runCheck({
    record: {
      entries: [FONT_ENTRY, { kind: "ロゴ", files: [{ current: "/logo.png", new: "/logo.png" }] }],
    },
    probes: [FONT_PROBE],
  });
  expect(r.stdout).toMatch(
    /記録の「ロゴ」は台帳の「状態 有効 × 方針 実体をコピーする」の行に無い/u,
  );
  expect(r.code).toBe(1);
});

test.each([
  [
    "unclassifiedResources",
    (u) => probe({ unclassifiedResources: [{ url: u, initiatorType: "fetch" }] }),
  ],
  ["manifests", (u) => probe({ manifests: [{ href: u, iconsInspected: false }] })],
  ["localFragmentRefs", (u) => probe({ localFragmentRefs: [{ url: u }] })],
])("落とす: プローブの %s にしか現れない URL は参照に数えない", async (_label, make) => {
  const r = await runCheck({
    ledgerText: ledger(FIGURE_ROW),
    record: {
      entries: [
        FONT_ENTRY,
        { kind: "画面内の図", files: [{ current: "/flow.png", new: "/img/flow.png" }] },
      ],
    },
    probes: [FONT_PROBE, make(`${NEW}/img/flow.png`)],
    table: { ...SAME_FONTS, [`${CUR}/flow.png`]: "png", [`${NEW}/img/flow.png`]: "png" },
  });
  expect(r.stdout).toMatch(/「画面内の図」の \/img\/flow.png を新側の画面が参照していない/u);
  expect(r.code).toBe(1);
});

test("落とす: 同梱のテンプレート（プレースホルダ）をそのまま出した記録は通らない", async () => {
  const r = await runCheck({ recordText: RECORD_TEMPLATE, probes: [FONT_PROBE] });
  expect(r.code).not.toBe(0);
  expect(r.written.asset_delivery_check.ok).toBe(false);
});

// ---- 判定しない入力（exit 2） ----

test("判定しない: 突き合わせる資産があるのにプローブが無い", async () => {
  const r = await runCheck({ record: { entries: [FONT_ENTRY] } });
  expect(r.stderr).toMatch(/--probe が無い/u);
  expect(r.code).toBe(2);
});

test("判定しない: 記録の URL が相対パス（基準が決まらない）", async () => {
  const r = await runCheck({
    record: {
      entries: [{ ...FONT_ENTRY, files: [{ current: "body.woff2", new: "/fonts/body.woff2" }] }],
    },
    probes: [FONT_PROBE],
  });
  expect(r.stderr).toMatch(/絶対 URL か \/ 始まりのパス/u);
  expect(r.code).toBe(2);
});

test("判定しない: exit 2 でも前回の合格を上書きし、ok: false と error を書く", async () => {
  const r = await runCheck({
    record: { entries: [FONT_ENTRY] },
    metadata: { slug: "orders", asset_delivery_check: { ok: true } },
  });
  expect(r.code).toBe(2);
  expect(r.written.slug).toBe("orders");
  expect(r.written.asset_delivery_check.ok).toBe(false);
  expect(r.written.asset_delivery_check.error).toMatch(/--probe が無い/u);
});

test("判定しない: 引数の不備でも --write の先に失敗を記録する", async () => {
  const r = await runCheck({
    record: { entries: [] },
    extraArgs: ["--unknown"],
    metadata: { asset_delivery_check: { ok: true } },
  });
  expect(r.code).toBe(2);
  expect(r.written.asset_delivery_check.ok).toBe(false);
});

// ---- CLI（本物の取得） ----

test("CLI: node で起動し、ローカルの HTTP 配信物を実際に取得して突き合わせる（参照ありで exit 0・バイト違いで exit 1）", async () => {
  const bodies = { "/cur/favicon.ico": "ICO", "/new/favicon.ico": "ICO", "/new/bad.ico": "HTML" };
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
  try {
    const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
    const base = `http://127.0.0.1:${port}`;
    const dir = makeTempDir("asset-delivery-cli-");
    const text = [
      "| 種類 | 描き方と使われるページ | 方針 | 状態 |",
      "|---|---|---|---|",
      "| favicon | `link[rel=icon]`、全ページ | 実体をコピーする | 有効 |",
    ].join("\n");
    writeFileSync(join(dir, "assets.md"), text);
    const runCli = (newPath) => {
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
      // spawnSync はイベントループを止めるので、同じプロセスのサーバーは応答できない——非同期で起動する。
      return new Promise((resolveRun) => {
        import("node:child_process").then(({ spawn }) => {
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
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          let stdout = "";
          child.stdout.on("data", (d) => (stdout += d));
          child.on("close", (status) => resolveRun({ status, stdout }));
        });
      });
    };
    const good = await runCli("/new/favicon.ico");
    expect(good.stdout).toMatch(/^ok: /mu);
    expect(good.status).toBe(0);
    const bad = await runCli("/new/bad.ico");
    expect(bad.stdout).toMatch(/バイト一致しない/u);
    expect(bad.status).toBe(1);
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
});

test("CLI: 引数が無ければ exit 2 と使い方を出す", () => {
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(r.stderr).toMatch(/usage: asset-delivery-check.mjs/u);
  expect(r.status).toBe(2);
});
