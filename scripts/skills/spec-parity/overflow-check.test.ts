// spec-parity の横のはみ出しの判定（overflow-check.mjs）の回帰テスト（Issue #565）。
//
// 起こりうる不具合は「はみ出したページを通す」「はみ出さないページを検出する」「測っていない組を合格にする」の 3 つ。
// 期待する組は metadata.json の capture_conditions（ページ × 幅）で決まるので、宣言から外れた測定と、宣言にあるのに無い測定も置く。
// 測定の記録の形は、同梱の雛形 assets/overflow.e2e.template.ts が書く形に合わせる。
// main は子プロセスを起動せず、メモリ上のファイルで直接呼ぶ（ミューテーションテストの 1 変異あたりの時間を抑える）。

import { describe, expect, test } from "vitest";
import { main } from "../../../skills/spec-parity/scripts/overflow-check.mjs";
import { parseJsonAs } from "../../lib/parse-as.ts";

const META = ".replace/parity/orders/metadata.json";
const MEAS = ".replace/parity/orders/new/stg/overflow.json";
const VERIFY = ".replace/parity/orders/new/stg/verify-metadata.json";

type Viewport = { width: number; height: number };
type Rec = {
  page: string;
  viewport: Viewport;
  inner_width: number;
  client_width: number;
  scroll_width: number;
};

const NARROW = { width: 375, height: 800 };
const WIDE = { width: 1280, height: 720 };

const metadata = (over: Record<string, unknown> = {}) => ({
  slug: "orders",
  style_policy: "free",
  mode: "feature",
  capture_conditions: { pages: ["/orders", "/orders/1"], viewports: [NARROW, WIDE] },
  ...over,
});

// はみ出さない測定（clientWidth はスクロールバーの分だけ innerWidth より狭いことがある）
const fits = (page: string, viewport: Viewport): Rec => ({
  page,
  viewport,
  inner_width: viewport.width,
  client_width: viewport.width - 15,
  scroll_width: viewport.width - 15,
});

const allFit = (): Rec[] =>
  ["/orders", "/orders/1"].flatMap((p) => [fits(p, NARROW), fits(p, WIDE)]);

const measurements = (records: Rec[], over: Record<string, unknown> = {}) => ({
  version: "1",
  side: "new",
  slug: "orders",
  target: "stg",
  commit: "abc123",
  records,
  ...over,
});

// 配列の要素を取り出す。無ければテストの組み立ての誤りなので投げる
function at<T>(list: T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`要素 ${i} が無い`);
  return v;
}

function text(fs: { files: Map<string, string> }, path: string): string {
  const v = fs.files.get(path);
  if (v === undefined) throw new Error(`無い: ${path}`);
  return v;
}

class Fs {
  files = new Map<string, string>();
  writes: string[] = [];
  put(path: string, value: unknown) {
    this.files.set(path, typeof value === "string" ? value : JSON.stringify(value));
  }
  run(args: string[]) {
    let stdout = "";
    let stderr = "";
    const code = main(args, {
      cwd: "/repo",
      readFile: (p) => {
        const v = this.files.get(p.replace(/^\/repo\//, ""));
        if (v === undefined) throw new Error(`ENOENT: ${p}`);
        return v;
      },
      writeFile: (p, s) => {
        const rel = p.replace(/^\/repo\//, "");
        this.writes.push(rel);
        this.files.set(rel, s);
      },
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
    });
    return { code, stdout, stderr };
  }
}

type Out = {
  ok: boolean;
  counts: Record<string, number>;
  overflowing: Rec[];
  missing: { page: string; viewport: Viewport }[];
  width_mismatch: Rec[];
  extra: Rec[];
};

const ARGS = ["--metadata", META, "--measurements", MEAS, "--target", "stg"];

function judge(records: Rec[], meta: unknown = metadata()) {
  const fs = new Fs();
  fs.put(META, meta);
  fs.put(MEAS, measurements(records));
  const r = fs.run(ARGS);
  return { ...r, out: r.code === 2 ? null : parseJsonAs<Out>(r.stdout) };
}

describe("overflow-check の判定", () => {
  test("宣言したすべての組がはみ出さなければ exit 0（はみ出さない fixture を検出しない）", () => {
    const r = judge(allFit());
    expect(r.code).toBe(0);
    expect(r.out?.ok).toBe(true);
    expect(r.out?.counts).toMatchObject({ expected: 4, measured: 4, overflowing: 0 });
  });

  test("scrollWidth が clientWidth と等しい組ははみ出しにしない（境界）", () => {
    const records = allFit().map((x) => ({
      ...x,
      client_width: x.inner_width,
      scroll_width: x.inner_width,
    }));
    expect(judge(records).code).toBe(0);
  });

  test("1 組でも scrollWidth が clientWidth を超えれば exit 1（はみ出す fixture を検出する）", () => {
    const records = allFit();
    // 375px の一覧だけが 1px はみ出す
    records[0] = { ...at(records, 0), scroll_width: at(records, 0).client_width + 1 };
    const r = judge(records);
    expect(r.code).toBe(1);
    expect(r.out?.overflowing.map((x) => [x.page, x.viewport.width])).toEqual([["/orders", 375]]);
    expect(r.stderr).toContain("はみ出し /orders 375x800");
  });

  test("宣言にある組の測定が無ければ、はみ出しが無くても exit 1（未測定を合格にしない）", () => {
    const r = judge(allFit().filter((x) => !(x.page === "/orders/1" && x.viewport.width === 1280)));
    expect(r.code).toBe(1);
    expect(r.out?.missing).toEqual([{ page: "/orders/1", viewport: WIDE }]);
  });

  test("測定が 0 件なら、宣言したすべての組を未測定として exit 1", () => {
    const r = judge([]);
    expect(r.code).toBe(1);
    expect(r.out?.counts.missing).toBe(4);
  });

  test("innerWidth が宣言の幅と違う測定は、その幅で測れていないので exit 1", () => {
    const records = allFit();
    records[1] = { ...at(records, 1), inner_width: 1024, client_width: 1024, scroll_width: 1024 };
    const r = judge(records);
    expect(r.code).toBe(1);
    expect(r.out?.width_mismatch.map((x) => x.page)).toEqual(["/orders"]);
  });

  test("宣言に無い組の測定は extra として exit 1", () => {
    const r = judge([...allFit(), fits("/settings", NARROW)]);
    expect(r.code).toBe(1);
    expect(r.out?.extra.map((x) => x.page)).toEqual(["/settings"]);
  });

  test("同じページで高さだけが違う幅は、別の組として数える", () => {
    const tall = { width: 375, height: 1200 };
    const meta = metadata({
      capture_conditions: { pages: ["/orders"], viewports: [NARROW, tall] },
    });
    const r = judge([fits("/orders", NARROW)], meta);
    expect(r.code).toBe(1);
    expect(r.out?.missing).toEqual([{ page: "/orders", viewport: tall }]);
  });
});

describe("overflow-check の判定できない入力（exit 2）", () => {
  test.each([
    ["style_policy が free でない", metadata({ style_policy: "reproduce" })],
    ["幅の宣言が空", metadata({ capture_conditions: { pages: ["/orders"], viewports: [] } })],
    ["ページの宣言が無い", metadata({ capture_conditions: { viewports: [NARROW] } })],
    [
      "幅が 0",
      metadata({
        capture_conditions: { pages: ["/orders"], viewports: [{ width: 0, height: 800 }] },
      }),
    ],
    [
      "幅が重複",
      metadata({ capture_conditions: { pages: ["/orders"], viewports: [NARROW, NARROW] } }),
    ],
    [
      "ページが / で始まらない",
      metadata({ capture_conditions: { pages: ["orders"], viewports: [NARROW] } }),
    ],
    [
      "ページが重複",
      metadata({ capture_conditions: { pages: ["/a", "/a"], viewports: [NARROW] } }),
    ],
  ])("%s", (_name, meta) => {
    const r = judge(allFit(), meta);
    expect(r.code).toBe(2);
  });

  test.each([
    ["target が違う", { target: "prod" }],
    ["slug が違う", { slug: "other" }],
    ["side が current", { side: "current" }],
    ["commit が無い", { commit: "" }],
    ["version が違う", { version: "2" }],
    ["records が配列でない", { records: {} }],
  ])("測定の記録の %s", (_name, over) => {
    const fs = new Fs();
    fs.put(META, metadata());
    fs.put(MEAS, measurements(allFit(), over));
    expect(fs.run(ARGS).code).toBe(2);
  });

  test.each([
    ["同じ組の測定が 2 つ", [...allFit(), fits("/orders", NARROW)]],
    ["clientWidth が innerWidth より大きい", [{ ...fits("/orders", NARROW), client_width: 400 }]],
    ["clientWidth が 0", [{ ...fits("/orders", NARROW), client_width: 0 }]],
    ["scrollWidth が整数でない", [{ ...fits("/orders", NARROW), scroll_width: 360.5 }]],
  ])("%s", (_name, records) => {
    expect(judge(records).code).toBe(2);
  });

  test("引数が欠けると exit 2", () => {
    const fs = new Fs();
    expect(fs.run(["--metadata", META]).code).toBe(2);
  });

  test("ファイルを読めないと exit 2", () => {
    const fs = new Fs();
    fs.put(META, metadata());
    expect(fs.run(ARGS).code).toBe(2);
  });
});

describe("overflow-check の --write", () => {
  test("verify-metadata.json の overflow に判定を書き、他のキーは残す", () => {
    const fs = new Fs();
    fs.put(META, metadata());
    fs.put(MEAS, measurements(allFit()));
    fs.put(VERIFY, { slug: "orders", target: "stg", design_review: { keep: true } });
    const r = fs.run([...ARGS, "--write", VERIFY]);
    expect(r.code).toBe(0);
    const doc = parseJsonAs<{ overflow: { ok: boolean; commit: string }; design_review: unknown }>(
      text(fs, VERIFY),
    );
    expect(doc.overflow).toMatchObject({ ok: true, commit: "abc123" });
    expect(doc.design_review).toEqual({ keep: true });
  });

  test("はみ出しがあっても、判定を書いてから exit 1 にする", () => {
    const fs = new Fs();
    const records = allFit();
    records[3] = { ...at(records, 3), scroll_width: 2000 };
    fs.put(META, metadata());
    fs.put(MEAS, measurements(records));
    fs.put(VERIFY, { slug: "orders", target: "stg" });
    expect(fs.run([...ARGS, "--write", VERIFY]).code).toBe(1);
    expect(parseJsonAs<{ overflow: { ok: boolean } }>(text(fs, VERIFY)).overflow.ok).toBe(false);
  });

  test("verify-metadata.json の target が違えば書かずに exit 2", () => {
    const fs = new Fs();
    fs.put(META, metadata());
    fs.put(MEAS, measurements(allFit()));
    fs.put(VERIFY, { slug: "orders", target: "prod" });
    expect(fs.run([...ARGS, "--write", VERIFY]).code).toBe(2);
    expect(fs.writes).toEqual([]);
  });
});

describe("overflow-check の --side current（suite で現行が保証する幅を決める）", () => {
  const CUR = ".replace/parity/orders/overflow-current.json";
  const curArgs = [
    "--metadata",
    META,
    "--measurements",
    CUR,
    "--target",
    "cur",
    "--side",
    "current",
  ];

  function withCurrent(records: Rec[]) {
    const fs = new Fs();
    fs.put(META, metadata());
    fs.put(CUR, measurements(records, { side: "current", target: "cur" }));
    return fs;
  }

  test("現行の測定がはみ出さなければ exit 0", () => {
    expect(withCurrent(allFit()).run(curArgs).code).toBe(0);
  });

  test("現行がはみ出す幅があれば exit 1（その幅は保証していない）", () => {
    const records = allFit();
    records[0] = { ...at(records, 0), scroll_width: 600 };
    expect(withCurrent(records).run(curArgs).code).toBe(1);
  });

  test("新側の測定を --side current で読むと exit 2", () => {
    const fs = new Fs();
    fs.put(META, metadata());
    fs.put(CUR, measurements(allFit(), { target: "cur" }));
    expect(fs.run(curArgs).code).toBe(2);
  });

  test.each([
    ["--write と一緒に渡す", [...curArgs, "--write", VERIFY]],
    [
      "語彙の外の値",
      ["--metadata", META, "--measurements", CUR, "--target", "cur", "--side", "both"],
    ],
  ])("--side current を %s と exit 2", (_name, args) => {
    const fs = withCurrent(allFit());
    fs.put(VERIFY, { slug: "orders", target: "cur" });
    expect(fs.run(args).code).toBe(2);
    expect(fs.writes).toEqual([]);
  });
});
