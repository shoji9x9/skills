// 部品の操作の結果を現行とカタログで突き合わせる検査（behavior-compare.mjs）の回帰テスト（Issue #446）。
//
// 状態ごとの見た目が基準と一致していても、操作した結果（全選択になる・チェックが残る・書き出しで落ちる）は
// 別の測定で、見た目の照合はそれを 1 件も示さない。この検査が壊れる方向は「比べていないものを一致と言う」側に
// 偏るので、fail-closed の側（未突合・記録の不備・基準の無い行が findings に残るか）を厚く見る。
//
// 陽性コントロール（揃った記録が exit 0）を置く——これが無いと「常に落とす」実装と区別できない。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-component/scripts/behavior-compare.mjs");
const { VERSION, compareBehaviors, canonical, cellKey, isoDateTime, loadBaseline, main } =
  await import(script);

/** 操作 2 件 × インスタンス 2 件の採取。 */
function metadataOf(override = {}) {
  return {
    slug: "data-grid",
    capture: {
      operation_source: "vendor-feature-list",
      operations: [
        {
          id: "corner-click",
          description: "隅のアイコンを押す",
          steps: "表の左上の隅のボタンをクリックする",
          observe: ["selection", "open_popup"],
        },
        {
          id: "export",
          description: "Excel に書き出す",
          steps: "メニューから書き出しを選ぶ",
          observe: ["download", "page_errors"],
        },
      ],
      ...override.capture,
    },
    instances: override.instances ?? [{ id: "orders" }, { id: "stock" }],
  };
}

const CURRENT = {
  "corner-click": { selection: { rows: [0, 9], cols: [0, 4] }, open_popup: null },
  export: { download: "orders.xlsx", page_errors: 0 },
};

function behaviorsOf(ids = ["orders", "stock"], results = CURRENT) {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        instance: id,
        results: Object.entries(results).map(([operation, observed]) => ({ operation, observed })),
      },
    ]),
  );
}

function comparisonOf({ rows, target = "preview", component = "data-grid" } = {}) {
  return {
    component,
    target,
    rows:
      rows ??
      ["orders", "stock"].flatMap((instance) =>
        Object.entries(CURRENT).map(([operation, observed]) => ({
          operation,
          instance,
          story: `${instance}--${operation}`,
          observed,
        })),
      ),
  };
}

const run = (override = {}) =>
  compareBehaviors({
    metadata: override.metadata ?? metadataOf(),
    behaviors: override.behaviors ?? behaviorsOf(),
    comparison: "comparison" in override ? override.comparison : comparisonOf(),
    target: override.target ?? "preview",
  });

const codes = (result) => result.findings.map((f) => f.code);

test("陽性コントロール: 全組み合わせで観測が一致すれば findings 0 件", () => {
  const result = run();
  expect(result.findings).toEqual([]);
  expect(result.counts).toMatchObject({ cells: 4, matched: 4, uncompared: 0, mismatched: 0 });
  expect(result.judged).toBe(true);
});

test("見た目が同じでも操作の結果が違えば behavior-mismatch で落とす", () => {
  const rows = comparisonOf().rows.map((r) =>
    r.operation === "corner-click" && r.instance === "orders"
      ? {
          ...r,
          observed: { selection: { rows: [0, 9], cols: [0, 4] }, open_popup: "column-picker" },
        }
      : r,
  );
  const result = run({ comparison: comparisonOf({ rows }) });
  expect(codes(result)).toEqual(["behavior-mismatch"]);
  expect(result.findings[0].differing).toEqual([
    { observation: "open_popup", current: null, new: "column-picker" },
  ]);
  expect(result.counts.mismatched).toBe(1);
});

test("オブジェクトのキー順だけの違いは不一致にしない（配列の順序は比べる）", () => {
  expect(canonical({ b: 1, a: [2, 1] })).toBe(canonical({ a: [2, 1], b: 1 }));
  expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
});

test("突き合わせ表が無いときは全組み合わせを未突合として数える", () => {
  const result = run({ comparison: null });
  expect(codes(result)).toEqual(["comparison-missing"]);
  expect(result.counts.uncompared).toBe(4);
});

test("行の無い組み合わせは behavior-uncompared で落とす", () => {
  const rows = comparisonOf().rows.filter(
    (r) => !(r.operation === "export" && r.instance === "stock"),
  );
  const result = run({ comparison: comparisonOf({ rows }) });
  expect(codes(result)).toEqual(["behavior-uncompared"]);
  expect(result.findings[0]).toMatchObject({ operation: "export", instance: "stock" });
});

test("観測項目が欠けた行は一致扱いにしない（空の観測同士を一致させない）", () => {
  const rows = comparisonOf().rows.map((r) =>
    r.operation === "export" && r.instance === "orders"
      ? { ...r, observed: { download: "orders.xlsx" } }
      : r,
  );
  const result = run({ comparison: comparisonOf({ rows }) });
  expect(codes(result)).toEqual(["behavior-observation-incomplete"]);
  expect(result.findings[0].missing).toEqual(["page_errors"]);
  expect(result.counts.matched).toBe(3);
});

test("基準側の観測項目が欠けていても落とす（新側と同じく空にできない）", () => {
  const behaviors = behaviorsOf();
  behaviors.orders.results[1].observed = {};
  const rows = comparisonOf().rows.map((r) =>
    r.operation === "export" && r.instance === "orders" ? { ...r, observed: {} } : r,
  );
  const result = run({ behaviors, comparison: comparisonOf({ rows }) });
  expect(codes(result)).toContain("behavior-baseline-incomplete");
  expect(result.counts.matched).toBe(3);
});

test("現行の結果が無い組み合わせは宣言が無ければ behavior-baseline-missing", () => {
  const behaviors = behaviorsOf();
  behaviors.stock = null;
  const result = run({ behaviors });
  expect(codes(result).filter((c) => c === "behavior-baseline-missing")).toHaveLength(2);
  expect(result.counts.matched).toBe(2);
});

test("理由付きで到達できないと宣言した組み合わせは母集合から外れ not_compared に数える", () => {
  const metadata = metadataOf({
    instances: [
      { id: "orders" },
      { id: "stock", unreachable_operations: [{ operation: "export", reason: "書き出しは禁止" }] },
    ],
  });
  const behaviors = behaviorsOf(["orders"]);
  behaviors.stock = {
    instance: "stock",
    results: [{ operation: "corner-click", observed: CURRENT["corner-click"] }],
  };
  const rows = comparisonOf().rows.filter(
    (r) => !(r.operation === "export" && r.instance === "stock"),
  );
  const result = run({ metadata, behaviors, comparison: comparisonOf({ rows }) });
  expect(result.findings).toEqual([]);
  expect(result.counts).toMatchObject({ cells: 3, not_compared: 1, matched: 3 });
});

test("理由の無い到達不能の宣言は除外にしない", () => {
  const metadata = metadataOf({
    instances: [
      { id: "orders" },
      { id: "stock", unreachable_operations: [{ operation: "export" }] },
    ],
  });
  const rows = comparisonOf().rows.filter(
    (r) => !(r.operation === "export" && r.instance === "stock"),
  );
  const result = run({ metadata, comparison: comparisonOf({ rows }) });
  expect(codes(result)).toEqual(["unreachable-declaration-invalid", "behavior-uncompared"]);
  expect(result.counts.not_compared).toBe(0);
});

test("母集合に無い組み合わせの行（基準の無い突き合わせ）は behavior-unbaselined", () => {
  const rows = [
    ...comparisonOf().rows,
    { operation: "column-picker-open", instance: "orders", observed: { open_popup: "x" } },
  ];
  const result = run({ comparison: comparisonOf({ rows }) });
  expect(codes(result)).toEqual(["behavior-unbaselined"]);
});

test("同じ組み合わせの行が 2 つあれば behavior-duplicate-row", () => {
  const rows = [...comparisonOf().rows, comparisonOf().rows[0]];
  const result = run({ comparison: comparisonOf({ rows }) });
  expect(codes(result)).toEqual(["behavior-duplicate-row"]);
});

test("比べないことを選ぶには承認が要る（承認があれば accepted として通す）", () => {
  const approved = comparisonOf().rows.map((r, i) =>
    i === 0
      ? {
          operation: r.operation,
          instance: r.instance,
          disposition: "accepted",
          reason: "版差を許容",
          approved_by: "owner",
          approved_at: "2026-09-23",
        }
      : r,
  );
  const ok = run({ comparison: comparisonOf({ rows: approved }) });
  expect(ok.findings).toEqual([]);
  expect(ok.counts).toMatchObject({ accepted: 1, matched: 3 });

  const unapproved = approved.map((r, i) => (i === 0 ? { ...r, approved_by: "" } : r));
  const ng = run({ comparison: comparisonOf({ rows: unapproved }) });
  expect(codes(ng)).toEqual(["behavior-acceptance-unapproved"]);

  const invalid = approved.map((r, i) => (i === 0 ? { ...r, disposition: "skip" } : r));
  expect(codes(run({ comparison: comparisonOf({ rows: invalid }) }))).toEqual([
    "behavior-disposition-invalid",
  ]);
});

test("別 target・別部品の突き合わせ表を通さない", () => {
  expect(codes(run({ comparison: comparisonOf({ target: "staging" }) }))).toEqual([
    "comparison-target-mismatch",
  ]);
  expect(codes(run({ comparison: comparisonOf({ component: "button" }) }))).toEqual([
    "comparison-component-mismatch",
  ]);
});

test("操作の列挙が無い・空（理由なし）・観測項目が空なら型崩れ", () => {
  expect(run({ metadata: { ...metadataOf(), capture: {} } }).structural).toBe(true);
  expect(run({ metadata: metadataOf({ capture: { operations: [] } }) }).structural).toBe(true);
  expect(
    run({
      metadata: metadataOf({
        capture: { operations: [{ id: "x", description: "d", steps: "s", observe: [] }] },
      }),
    }).structural,
  ).toBe(true);
  expect(run({ metadata: { ...metadataOf(), slug: "" } }).structural).toBe(true);
});

test("操作を持たない部品は理由を宣言すれば判定しないで通す", () => {
  const result = run({
    metadata: metadataOf({ capture: { operations: [], operations_none_reason: "静的なラベル" } }),
  });
  expect(result).toMatchObject({ structural: false, judged: false, findings: [] });
});

test("全組み合わせが到達できない宣言なら合格にしない", () => {
  const all = [
    { operation: "corner-click", reason: "r" },
    { operation: "export", reason: "r" },
  ];
  const metadata = metadataOf({
    instances: [
      { id: "orders", unreachable_operations: all },
      { id: "stock", unreachable_operations: all },
    ],
  });
  const result = run({
    metadata,
    behaviors: {
      orders: { instance: "orders", results: [] },
      stock: { instance: "stock", results: [] },
    },
    comparison: comparisonOf({ rows: [] }),
  });
  expect(codes(result)).toEqual(["behavior-nothing-compared"]);
});

test("鍵は区切り文字で潰れない", () => {
  expect(cellKey("a|b", "c")).not.toBe(cellKey("a", "b|c"));
});

/** 採取物のディレクトリを作る。 */
function baselineDir() {
  const dir = mkdtempSync(join(tmpdir(), "behavior-compare-"));
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadataOf()));
  for (const [id, doc] of Object.entries(behaviorsOf())) {
    mkdirSync(join(dir, "baseline", id), { recursive: true });
    writeFileSync(join(dir, "baseline", id, "behaviors.json"), JSON.stringify(doc));
  }
  mkdirSync(join(dir, "new", "preview"), { recursive: true });
  writeFileSync(
    join(dir, "new", "preview", "behavior-comparison.json"),
    JSON.stringify(comparisonOf()),
  );
  return dir;
}

test("CLI: 揃った採取物と突き合わせ表で exit 0、行を欠くと exit 1", () => {
  const dir = baselineDir();
  const args = [
    "--baseline",
    dir,
    "--comparison",
    join(dir, "new/preview/behavior-comparison.json"),
    "--target",
    "preview",
  ];
  const okRun = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  expect(okRun.status).toBe(0);
  const parsed = JSON.parse(okRun.stdout);
  expect(parsed).toMatchObject({ tool: "behavior-compare", version: VERSION, ok: true });
  expect(parsed.counts.matched).toBe(4);

  const partial = comparisonOf();
  partial.rows = partial.rows.slice(1);
  writeFileSync(join(dir, "new", "preview", "behavior-comparison.json"), JSON.stringify(partial));
  const ngRun = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  expect(ngRun.status).toBe(1);
  expect(JSON.parse(ngRun.stdout).findings.map((f) => f.code)).toEqual(["behavior-uncompared"]);
});

test("CLI: 引数の欠落・空白だけの target は exit 2", () => {
  const dir = baselineDir();
  const writes = [];
  const errors = [];
  const io = { write: (s) => writes.push(s), writeErr: (s) => errors.push(s) };
  expect(main(["--baseline", dir, "--target", "preview"], io)).toBe(2);
  expect(main(["--baseline", dir, "--comparison", "x.json", "--target", " "], io)).toBe(2);
  // 引数の誤りは stdout の JSON に混ぜず、usage 付きで stderr へ出す。
  expect(writes).toEqual([]);
  expect(errors.join("")).toMatch(/^usage: behavior-compare\.mjs /m);
});

test("baseline の外を指す behaviors.json は読まない", () => {
  const dir = baselineDir();
  const outside = mkdtempSync(join(tmpdir(), "behavior-compare-outside-"));
  mkdirSync(join(outside, "x"), { recursive: true });
  writeFileSync(
    join(outside, "x", "behaviors.json"),
    JSON.stringify({ instance: "evil", results: [] }),
  );
  const meta = metadataOf({ instances: [{ id: "orders" }, { id: "evil" }] });
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(meta));
  symlinkSync(join(outside, "x"), join(dir, "baseline", "evil"));
  expect(() => loadBaseline(dir)).toThrow(/baseline の外/);
  expect(() => {
    writeFileSync(
      join(dir, "metadata.json"),
      JSON.stringify(metadataOf({ instances: [{ id: "../x" }] })),
    );
    loadBaseline(dir);
  }).toThrow(/セグメント/);
});

test("behaviors.json の instance が別インスタンスを指すなら基準にしない", () => {
  const behaviors = behaviorsOf();
  behaviors.stock = { ...behaviors.stock, instance: "orders" };
  const result = run({ behaviors });
  expect(codes(result)).toEqual([
    "behavior-baseline-instance-mismatch",
    "behavior-baseline-missing",
    "behavior-baseline-missing",
  ]);
});

test("到達できないと宣言した操作に現行の結果があれば behavior-baseline-unknown", () => {
  const metadata = metadataOf({
    instances: [
      { id: "orders" },
      { id: "stock", unreachable_operations: [{ operation: "export", reason: "書き出しは禁止" }] },
    ],
  });
  const rows = comparisonOf().rows.filter(
    (r) => !(r.operation === "export" && r.instance === "stock"),
  );
  const result = run({ metadata, comparison: comparisonOf({ rows }) });
  expect(codes(result)).toEqual(["behavior-baseline-unknown"]);
});

test("rows が配列でない突き合わせ表は全組み合わせを未突合にする", () => {
  const result = run({ comparison: { component: "data-grid", target: "preview", rows: {} } });
  expect(codes(result)).toEqual([
    "comparison-rows-invalid",
    "behavior-uncompared",
    "behavior-uncompared",
    "behavior-uncompared",
    "behavior-uncompared",
  ]);
});

test("同梱テンプレートをそのまま渡しても合格にしない", async () => {
  const { readFileSync } = await import("node:fs");
  const asset = (name) =>
    JSON.parse(readFileSync(join(repoRoot, "skills/parity-component/assets", name), "utf8"));
  const metadata = asset("metadata-template.json");
  const id = metadata.instances[0].id;
  const behavior = asset("behaviors-template.json");
  const result = compareBehaviors({
    metadata,
    behaviors: { [id]: { ...behavior, instance: id } },
    comparison: asset("behavior-comparison-template.json"),
    target: "preview",
  });
  // 導出源・操作 id がテンプレートの値のままなので、判定に入る前に型崩れとして落ちる。
  expect(result.structural).toBe(true);
  expect(result.findings[0].detail).toMatch(/operation_source|プレースホルダ/);
});

test("テンプレートのプレースホルダのままの承認は承認として数えない（承認日時も ISO 8601 を要求する）", () => {
  const acceptedRow = (override) => ({
    operation: "corner-click",
    instance: "orders",
    disposition: "accepted",
    reason: "版差を許容",
    approved_by: "owner",
    approved_at: "2026-09-23T10:00:00Z",
    ...override,
  });
  const withRow = (row) => comparisonOf({ rows: [row, ...comparisonOf().rows.slice(1)] });
  expect(run({ comparison: withRow(acceptedRow({})) }).findings).toEqual([]);
  for (const override of [
    { reason: "<比べない・差を残す理由（例: ...）>" },
    { approved_by: "<承認した利用者>" },
    { approved_at: "<ISO 8601 の承認日時>" },
    { approved_at: "昨日" },
  ]) {
    expect(codes(run({ comparison: withRow(acceptedRow(override)) }))).toEqual([
      "behavior-acceptance-unapproved",
    ]);
  }
});

test("プレースホルダのままの operations_none_reason では判定を省略しない", () => {
  const result = run({
    metadata: metadataOf({
      capture: {
        operations: [],
        operations_none_reason:
          "<操作を持たない部品のときだけ理由を書き operations を空配列にする>",
      },
    }),
  });
  expect(result.structural).toBe(true);
});

test("手順（steps）・説明の無い操作は型崩れ（両側で同じ操作を再生できない）", () => {
  for (const op of [
    { id: "x", description: "d", observe: ["a"] },
    { id: "x", steps: "s", observe: ["a"] },
    { id: "x", description: "d", steps: "<見本でも同じに再生できる手順>", observe: ["a"] },
  ]) {
    expect(run({ metadata: metadataOf({ capture: { operations: [op] } }) }).structural).toBe(true);
  }
});

test("プレースホルダのままの到達不能の理由は除外にしない", () => {
  const metadata = metadataOf({
    instances: [
      { id: "orders" },
      {
        id: "stock",
        unreachable_operations: [{ operation: "export", reason: "<実施できない理由>" }],
      },
    ],
  });
  const rows = comparisonOf().rows.filter(
    (r) => !(r.operation === "export" && r.instance === "stock"),
  );
  const result = run({ metadata, comparison: comparisonOf({ rows }) });
  expect(codes(result)).toEqual(["unreachable-declaration-invalid", "behavior-uncompared"]);
});

test("角括弧で囲まれた観測値（<button> 等）も正当な出力として比べる（プレースホルダ扱いしない）", () => {
  const legit = { download: "<none>", page_errors: 0 };
  const behaviors = behaviorsOf();
  behaviors.orders.results[1].observed = legit;
  const rows = comparisonOf().rows.map((r) =>
    r.operation === "export" && r.instance === "orders" ? { ...r, observed: legit } : r,
  );
  const result = run({ behaviors, comparison: comparisonOf({ rows }) });
  expect(result.findings).toEqual([]);
  expect(result.counts.matched).toBe(4);
});

test("見本の識別子（story）が空・プレースホルダの行は突き合わせとして数えない", () => {
  for (const story of [undefined, "", "<操作を実施した見本の識別子>"]) {
    const rows = comparisonOf().rows.map((r, i) => (i === 0 ? { ...r, story } : r));
    const result = run({ comparison: comparisonOf({ rows }) });
    expect(codes(result)).toEqual(["behavior-story-missing"]);
    expect(result.counts).toMatchObject({ matched: 3, uncompared: 1 });
  }
});

test("承認日時は暦の上で実在する値だけを通す（Date.parse の繰り上げに頼らない）", () => {
  for (const ok of ["2026-09-23", "2026-09-23T10:00:00Z", "2024-02-29T23:59:59.5+09:00"]) {
    expect(isoDateTime(ok)).toBe(true);
  }
  for (const ng of [
    "2026-02-30",
    "2026-13-01",
    "2026-09-23T24:00:00Z",
    "2026-09-23T10:60Z",
    "2026-09-23T10:00:00+25:00",
    "2025-02-29",
  ]) {
    expect(isoDateTime(ng)).toBe(false);
  }
});

test("操作の導出源が無い・プレースホルダ・語彙外なら型崩れ", () => {
  for (const operation_source of [undefined, "<操作の導出源>", "guess"]) {
    expect(run({ metadata: metadataOf({ capture: { operation_source } }) }).structural).toBe(true);
  }
  for (const operation_source of [
    "vendor-feature-list",
    "component-catalog",
    "current-source",
    "app-ui",
  ]) {
    expect(run({ metadata: metadataOf({ capture: { operation_source } }) }).findings).toEqual([]);
  }
});
