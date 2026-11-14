// diff-report.mjs の回帰テスト（Issue #1018）。
// 期待値は references/triage.md の「承認する人が見る HTML のレポート」の取り決めから決める。
//
// 入力の状態を軸ごとに挙げ、各状態を少なくとも 1 件のテストにする。
// - diff.md の行と領域の結びは、結べる・行が無い領域・領域の無い画素の行・画素以外の行・ページか bbox が違う行である。
// - 埋め込む文字は、HTML の特別な文字（< > & " '）を含む論理名・分類・根拠・ページである。
// - diff.md の形は、差分一覧の節が無い・列が足りない・欄の中の \| である。
// - 画像は、PNG でない・現行と新側で寸法が違う・bbox が画像の外か寸法が正でない、である。
// - 組の一覧は、同じページ・状態・ビューポートの組が 2 回ある、である。
// - 位置の欄の bbox は、小数の一部・2 つの bbox である。
// - diff-metadata.json は、値が無い・オブジェクトでない、である。

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  bboxesInText,
  escapeHtml,
  isSeparatorRow,
  parseDiffRows,
  pngSize,
  readMappedRegions,
  readMetadataSummary,
  readPairs,
  rowMatchesRegion,
  splitTableRow,
} from "../../../skills/parity-diff/scripts/diff-report.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const SCRIPT = fileURLToPath(
  new URL("../../../skills/parity-diff/scripts/diff-report.mjs", import.meta.url),
);

const HEADER =
  "| ID | 比較方法 | ページ | 状態 | ビューポート | 位置（論理名 or bbox） | 内容 | 正規化結果 | 分類 | 根拠（測定条件を併記） |\n" +
  "|---|---|---|---|---|---|---|---|---|---|\n";

function diffMd(rows: string): string {
  return `# 差分レポート（diff）\n\n## 2. 比較方法別のサマリ\n\n| a |\n|---|\n| b |\n\n## 3. 差分一覧\n\n<!-- 注記 -->\n\n${HEADER}${rows}\n## 4. 要対応\n\n| ID | x |\n|---|---|\n| 9 | y |\n`;
}

// IHDR までの 24 バイトを持つ PNG の先頭（レポートは寸法だけを読み、画素は data: URI のまま埋め込む）。
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "latin1");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

const ROWS =
  "| 1 | 画素 | list | default | desktop | 10,10,4,4 | 罫線の色 | unexplained | 許容候補（要確認） | 600 の見出しで観測 |\n" +
  "| 2 | 特性照合 | list | default | desktop | save-button | padding-left | deviates_T | 要対応 | T から逸脱 |\n" +
  "| 3 | 画素 | list | default | desktop | 50,50,9,9 | どの領域とも一致しない | unexplained | 未説明 | — |\n";

const REGIONS = {
  regions: [
    {
      id: 1,
      kind: "threshold",
      bbox: { x: 10, y: 10, width: 4, height: 4 },
      status: "named",
      names: [
        {
          name: "save-button",
          sides: ["current", "new"],
          overlap_px: 16,
          region_coverage: 1,
          element_coverage: 0.2,
        },
      ],
      masks: [],
      unresolved: [],
    },
    {
      id: "s1",
      kind: "strict_only",
      bbox: { x: 30, y: 30, width: 5, height: 5 },
      status: "unknown",
      names: [],
      masks: [],
      unresolved: ["traits_missing:new"],
    },
  ],
};

type Scene = {
  md?: string;
  metadata?: unknown;
  regions?: unknown;
  currentPng?: Buffer;
  newPng?: Buffer;
  page?: string;
};

function writeInputs(p: (name: string) => string, scene: Scene): void {
  writeFileSync(p("diff.md"), scene.md ?? diffMd(ROWS));
  writeFileSync(
    p("diff-metadata.json"),
    JSON.stringify(
      scene.metadata ?? {
        slug: "list",
        new: { target: "local" },
        converged: false,
        results: { total: 3 },
      },
    ),
  );
  writeFileSync(p("current.png"), scene.currentPng ?? pngHeader(100, 80));
  writeFileSync(p("new.png"), scene.newPng ?? pngHeader(100, 80));
  writeFileSync(p("regions.json"), JSON.stringify(scene.regions ?? REGIONS));
  writeFileSync(
    p("pairs.json"),
    JSON.stringify([
      {
        page: scene.page ?? "list",
        state: "default",
        viewport: "desktop",
        current: p("current.png"),
        new: p("new.png"),
        regions: p("regions.json"),
      },
    ]),
  );
}

function run(scene: Scene = {}) {
  const dir = makeTempDir("diff-report-");
  const p = (name: string) => join(dir, name);
  writeInputs(p, scene);
  const out = p("report.html");
  const res = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--diff-md",
      p("diff.md"),
      "--diff-metadata",
      p("diff-metadata.json"),
      "--pairs",
      p("pairs.json"),
      "--out",
      out,
    ],
    { encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
  );
  let html = "";
  try {
    html = readFileSync(out, "utf8");
  } catch {
    html = "";
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, html };
}

// --- 関数の粒度 ---

test("HTML の特別な文字をすべて文字参照にする", () => {
  expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
    "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
  );
});

test("表の行の \\| は区切りにしない", () => {
  expect(splitTableRow("| 1 | a \\| b | c |")).toEqual(["1", "a | b", "c"]);
});

test("差分一覧の節の表だけを読み、ほかの節の表を読まない", () => {
  const parsed = parseDiffRows(diffMd(ROWS));
  if ("error" in parsed) throw new Error(parsed.error);
  expect(parsed.rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
  expect(parsed.rows[0]).toMatchObject({
    method: "画素",
    position: "10,10,4,4",
    classification: "許容候補（要確認）",
  });
});

test("節の中で | で始まる行をすべて表の行として読み、空行・コメント・文の後の行も読む", () => {
  const rows =
    "| 1 | 画素 | list | default | desktop | 1,1,1,1 | a | b | c | d |\n\n" +
    "<!-- 途中の注記 -->\n<!--\n複数行の注記\n-->\n注記の文\n" +
    "| 2 | 画素 | list | default | desktop | 2,2,2,2 | a | b | c | d |\n";
  const parsed = parseDiffRows(diffMd(rows));
  if ("error" in parsed) throw new Error(parsed.error);
  expect(parsed.rows.map((r) => r.id)).toEqual(["1", "2"]);
});

test("HTML コメントの範囲は解釈しないので、コメントの中でも | で始まる行は読み、| で始まらない行は読まない", () => {
  const rows =
    "| 1 | 画素 | list | default | desktop | 1,1,1,1 | a | b | c | d | <!--\n" +
    "| 2 | 画素 | list | default | desktop | 2,2,2,2 | a | b | c | d |\n" +
    "--> | 3 | 画素 | list | default | desktop | 3,3,3,3 | a | b | c | d |\n" +
    "<!-->\n| 4 | 画素 | list | default | desktop | 4,4,4,4 | `<!--` | b | c | d |\n";
  const parsed = parseDiffRows(diffMd(rows));
  if ("error" in parsed) throw new Error(parsed.error);
  expect(parsed.rows.map((r) => r.id)).toEqual(["1", "2", "4"]);
});

test("すべての欄が空の行は、区切りの行としても差分の行としても読まない", () => {
  expect(isSeparatorRow("| | | |")).toBe(false);
  expect(isSeparatorRow("|---|:---:|--:|")).toBe(true);
  const parsed = parseDiffRows(
    diffMd("| | | | | | | | | | |\n| 1 | 画素 | a | b | c | 1,1,1,1 | a | b | c | d |\n"),
  );
  if ("error" in parsed) throw new Error(parsed.error);
  expect(parsed.rows.map((r) => r.id)).toEqual(["1"]);
});

test("差分一覧の節に表が 2 つあれば誤りにする", () => {
  const second = "\n| ID | x |\n|---|---|\n| 9 | y |\n";
  expect(
    parseDiffRows(diffMd(`| 1 | 画素 | a | b | c | 1,1,1,1 | a | b | c | d |\n${second}`)),
  ).toHaveProperty("error");
});

test("ページ・状態・ビューポートの欄の前後のバッククォートを外してから比べる", () => {
  const parsed = parseDiffRows(
    diffMd("| 1 | 画素 | `list` | `default` | `desktop` | 1,1,1,1 | a | b | c | d |\n"),
  );
  if ("error" in parsed) throw new Error(parsed.error);
  expect(parsed.rows[0]).toMatchObject({ page: "list", state: "default", viewport: "desktop" });
});

test("差分一覧の節が無いか、列が足りなければ誤りにする", () => {
  expect(parseDiffRows("# x\n\n## 2. サマリ\n\n| a |\n|---|\n")).toHaveProperty("error");
  expect(
    parseDiffRows("## 3. 差分一覧\n\n| ID | 比較方法 |\n|---|---|\n| 1 | 画素 |\n"),
  ).toHaveProperty("error");
});

test("行は、画素で、ページ・状態・ビューポートと bbox が一致する領域にだけ結ぶ", () => {
  const row = {
    id: "1",
    method: "画素",
    page: "list",
    state: "default",
    viewport: "desktop",
    position: "（10, 10, 4, 4）",
    content: "",
    normalized: "",
    classification: "",
    evidence: "",
  };
  const pair = { page: "list", state: "default", viewport: "desktop" };
  const bbox = { x: 10, y: 10, width: 4, height: 4 };
  expect(rowMatchesRegion(row, pair, bbox)).toBe(true);
  expect(rowMatchesRegion({ ...row, method: "特性照合" }, pair, bbox)).toBe(false);
  expect(rowMatchesRegion(row, { ...pair, page: "detail" }, bbox)).toBe(false);
  expect(rowMatchesRegion(row, { ...pair, state: "hover" }, bbox)).toBe(false);
  expect(rowMatchesRegion(row, { ...pair, viewport: "mobile" }, bbox)).toBe(false);
  expect(rowMatchesRegion(row, pair, { ...bbox, width: 5 })).toBe(false);
});

test("位置の欄の小数の一部を、bbox の数として読まない", () => {
  expect(bboxesInText("40,40,80,30")).toEqual([{ x: 40, y: 40, width: 80, height: 30 }]);
  expect(bboxesInText("40.5,40,80,30")).toEqual([]);
  expect(bboxesInText("40,40,80,30.5")).toEqual([]);
  expect(bboxesInText("40,40,80,30 / 1,2,3,4")).toEqual([
    { x: 40, y: 40, width: 80, height: 30 },
    { x: 1, y: 2, width: 3, height: 4 },
  ]);
});

test("region-names.mjs の出力の bbox の寸法が正でなければ、形の誤りにする", () => {
  const region = {
    id: 1,
    kind: "threshold",
    status: "named",
    names: [],
    masks: [],
    unresolved: [],
  };
  const size = { width: 100, height: 100 };
  expect(
    readMappedRegions(
      { regions: [{ ...region, bbox: { x: 1, y: 1, width: 2, height: 2 } }] },
      size,
    ),
  ).not.toHaveProperty("error");
  for (const bbox of [
    { x: 10, y: 10, width: 0, height: 2 },
    { x: 10, y: 10, width: 2, height: -1 },
  ]) {
    expect(readMappedRegions({ regions: [{ ...region, bbox }] }, size)).toHaveProperty("error");
  }
});

test("同じページ・状態・ビューポートの組が 2 回あれば、組の一覧の誤りにする", () => {
  const pair = {
    page: "list",
    state: "default",
    viewport: "desktop",
    current: "c.png",
    new: "n.png",
    regions: "r.json",
  };
  expect(readPairs([pair, { ...pair, viewport: "mobile" }])).not.toHaveProperty("error");
  expect(readPairs([pair, { ...pair, current: "other.png" }])).toHaveProperty("error");
});

test("PNG の寸法を IHDR から読み、PNG でなければ null を返す", () => {
  expect(pngSize(pngHeader(320, 200))).toEqual({ width: 320, height: 200 });
  expect(pngSize(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
});

test("diff-metadata.json の値が無ければ「（記録なし）」にする", () => {
  expect(readMetadataSummary({})).toEqual({
    slug: "（記録なし）",
    target: "（記録なし）",
    converged: "（記録なし）",
    results: "（記録なし）",
  });
  expect(readMetadataSummary([])).toHaveProperty("error");
});

// --- CLI の粒度 ---

test("CLI: 画像の上に差分の ID と bbox を描き、ID から分類と根拠の行へ移れる", () => {
  const res = run();
  expect(res.status).toBe(0);
  const html = res.html;
  // 画像は 2 枚とも data: URI で埋め込み、領域の枠を 2 枚の上に描く
  expect(html.match(/<img src="data:image\/png;base64,/g)).toHaveLength(2);
  expect(html.match(/<rect class="box named" x="10" y="10" width="4" height="4"/g)).toHaveLength(2);
  expect(html).toContain('<a href="#p0-r0" aria-label="1 論理名あり"><rect class="box named"');
  expect(html).toMatch(/<text class="label"[^>]*>1<\/text>/);
  // ID の行に、重なる論理名・比較方法・正規化結果・分類・根拠が並ぶ
  expect(html).toMatch(
    /<tr id="p0-r0"><th scope="row">1<\/th>[\s\S]*save-button[\s\S]*<td>画素<\/td><td>unexplained<\/td><td>許容候補（要確認）<\/td><td>600 の見出しで観測<\/td>/,
  );
  expect(html).toContain("分類と承認の記録ではない");
});

test("CLI: diff.md に行の無い領域は、領域の id を描いて行が無いことを出し、警告する", () => {
  const res = run();
  expect(res.html).toMatch(/<text class="label"[^>]*>領域 s1<\/text>/);
  expect(res.html).toContain("diff.md に、この bbox を位置に書いた行が無い");
  expect(res.html).toContain("判定できない理由: traits_missing:new");
  expect(res.stderr).toContain("1 region(s) have no diff.md row");
  expect(JSON.parse(res.stdout)).toMatchObject({
    regions: 2,
    regions_without_row: 1,
    pixel_rows_unlinked: 1,
    rows_not_on_images: 2,
  });
});

test("CLI: 画素以外の行と、領域に結べない画素の行は、別の表に出す", () => {
  const res = run();
  const rest = res.html.slice(res.html.indexOf("画像の領域に結べなかった行"));
  expect(rest).toContain('<th scope="row">2</th>');
  expect(rest).toContain('<th scope="row">3</th>');
  expect(rest).not.toContain('<th scope="row">1</th>');
  expect(res.stderr).toContain("1 pixel row(s) in diff.md match no region");
});

test("CLI: ページが違う組には行を結ばない", () => {
  const res = run({ page: "detail" });
  expect(res.status).toBe(0);
  expect(JSON.parse(res.stdout)).toMatchObject({ regions_without_row: 2, pixel_rows_unlinked: 2 });
});

test("CLI: 論理名・分類・根拠・ページの HTML の特別な文字は、文字参照にして埋め込む", () => {
  const evil = `<script>alert("x")</script>`;
  const regions = {
    regions: [
      {
        ...REGIONS.regions[0],
        names: [{ name: `<img src=x onerror='1'>`, region_coverage: 1, element_coverage: 1 }],
      },
    ],
  };
  const res = run({
    md: diffMd(
      `| 1 | 画素 | ${evil} | default | desktop | 10,10,4,4 | a | b | ${evil} | ${evil} |\n`,
    ),
    page: evil,
    regions,
    metadata: { slug: evil, new: { target: "t" } },
  });
  expect(res.status).toBe(0);
  expect(res.html).not.toContain("<script");
  expect(res.html).not.toContain("<img src=x");
  expect(res.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  expect(res.html).toContain("&lt;img src=x onerror=&#39;1&#39;&gt;");
});

test("CLI: 外部の資源を読み込まない（http の参照・link 要素・script 要素が無く、CSP で読み込みを止める）", () => {
  const res = run();
  expect(res.html).not.toMatch(/(src|href)="(https?:)?\/\//);
  expect(res.html).not.toMatch(/<link|<script/);
  expect(res.html).toContain(
    `content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`,
  );
});

test.each([
  ["差分一覧の節が無い", { md: "# x\n" }, "差分一覧"],
  ["PNG でない画像", { currentPng: Buffer.from("not a png") }, "is not a PNG"],
  ["現行と新側で寸法が違う", { newPng: pngHeader(100, 81) }, "image sizes differ"],
  [
    "bbox が画像の外",
    {
      regions: {
        regions: [{ ...REGIONS.regions[0], bbox: { x: 98, y: 10, width: 4, height: 4 } }],
      },
    },
    "outside the 100x80 image",
  ],
  [
    "重なる論理名の覆う割合が数でない",
    {
      regions: {
        regions: [
          {
            ...REGIONS.regions[0],
            names: [{ name: "save-button", region_coverage: "<b>", element_coverage: 1 }],
          },
        ],
      },
    },
    "is not a region-names.mjs region",
  ],
  ["diff-metadata.json がオブジェクトでない", { metadata: [] }, "must be an object"],
])("CLI: %s は exit 2 で、HTML を書かない", (_label, scene, message) => {
  const res = run(scene);
  expect(res.status).toBe(2);
  expect(res.stderr).toContain(message);
  expect(res.html).toBe("");
});
