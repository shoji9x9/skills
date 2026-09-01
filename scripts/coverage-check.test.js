// parity-diff の部品被覆表チェッカ（coverage-check.mjs）の回帰テスト（Issue #274）。
//
// 収束条件に「未測定が残っていない」を足すとき、数え方を宣言値（metadata.json の件数）や
// 行数に任せると、被覆表を直さずに件数だけ 0 と書く／測れなかった行を落とすだけで
// converged: true へ到達できてしまう。数え直しが fail-closed であること
// （行が無い・evidence が空・present なのに covered_by が空・重複行）を固定する。
//
// 後方互換（component_coverage キーが無い旧成果物と declared: false は判定に入れない）は
// 陽性コントロールとして固定する——これが無いと「被覆表が無ければ常に落とす」実装と区別できない。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-diff/scripts/coverage-check.mjs");
const { countCoverage, readDeclaration } = await import(script);

/** 部品 1 つ・項目 2 つ・インスタンス 2 つ ＝ 期待セル 4 の被覆表の骨格。 */
const skeleton = {
  slug: "order-list",
  components: [
    {
      id: "grid",
      items: [{ id: "ctx-menu" }, { id: "drag-reorder" }],
      instances: [{ id: "orders" }, { id: "search" }],
    },
  ],
};

const cell = (item, instance, extra) => ({
  component: "grid",
  item,
  instance,
  value: "present",
  evidence: "右クリックでメニューが出た",
  covered_by: ["context-menu"],
  ...extra,
});

/** 4 セルすべてが測れている被覆表。 */
function full() {
  return {
    ...skeleton,
    cells: [
      cell("ctx-menu", "orders"),
      cell("ctx-menu", "search", {
        value: "absent",
        evidence: "右クリックしてもメニューが出ない",
        covered_by: [],
      }),
      cell("drag-reorder", "orders"),
      cell("drag-reorder", "search"),
    ],
  };
}

test("陽性コントロール: 全セルが測れていれば未測定ゼロ・問題ゼロ（常に落とす実装を弾く）", () => {
  const r = countCoverage(full(), "order-list");
  expect(r).toMatchObject({ cells: 4, present: 3, absent: 1, unmeasured: 0, problems: [] });
});

test("行が無い組み合わせは未測定として数える（行を落として穴を消せない）", () => {
  const cov = full();
  cov.cells = cov.cells.slice(0, 3);
  expect(countCoverage(cov, "order-list").unmeasured).toBe(1);
});

test("value: unmeasured は未測定として数える", () => {
  const cov = full();
  cov.cells[3] = {
    ...cov.cells[3],
    value: "unmeasured",
    unmeasured_reason: "データが無く発火できない",
  };
  expect(countCoverage(cov, "order-list").unmeasured).toBe(1);
});

test("present なのに covered_by が空は未測定（列挙しただけでは押さえたことにしない）", () => {
  const cov = full();
  cov.cells[0] = { ...cov.cells[0], covered_by: [] };
  const r = countCoverage(cov, "order-list");
  expect(r.unmeasured).toBe(1);
  expect(r.problems.join("\n")).toMatch(/covered_by/);
});

test("evidence が空なら present / absent でも未測定", () => {
  const cov = full();
  cov.cells[1] = { ...cov.cells[1], evidence: "  " };
  const r = countCoverage(cov, "order-list");
  expect(r.unmeasured).toBe(1);
  expect(r.problems.join("\n")).toMatch(/evidence/);
});

test("同じ組み合わせの重複行は先勝ちにせず未測定として数える", () => {
  const cov = full();
  cov.cells.push({ ...cov.cells[0], value: "absent", evidence: "別の観測", covered_by: [] });
  const r = countCoverage(cov, "order-list");
  expect(r.unmeasured).toBe(1);
  expect(r.problems.join("\n")).toMatch(/複数ある/);
});

test("items / instances が空の部品は期待セル 0 に化けず未測定 1 として数える", () => {
  const cov = {
    slug: "order-list",
    components: [{ id: "grid", items: [], instances: [] }],
    cells: [],
  };
  expect(countCoverage(cov, "order-list")).toMatchObject({ cells: 1, unmeasured: 1 });
});

test("components が空なら問題として残す（空宣言で通さない）", () => {
  const r = countCoverage({ slug: "order-list", components: [], cells: [] }, "order-list");
  expect(r.problems.join("\n")).toMatch(/components が空/);
});

test("slug 不一致は問題として残す（別 slug の被覆表を読んでいる）", () => {
  expect(countCoverage(full(), "customer-list").problems.join("\n")).toMatch(/slug/);
});

test("components に無い組み合わせを参照する行は問題として残す", () => {
  const cov = full();
  cov.cells.push(cell("unknown-item", "orders"));
  expect(countCoverage(cov, "order-list").problems.join("\n")).toMatch(/components に無い/);
});

test("列挙側の id が空なら 1 行で全セルを満たせず未測定として数える（fail-closed）", () => {
  // id を落とすと全要素が同じキーへ潰れるため、素朴な実装では 1 行が全セルを満たしてしまう。
  const cov = {
    slug: "order-list",
    components: [{ items: [{ name: "x" }, { name: "y" }], instances: [{ page: "明細一覧" }] }],
    cells: [{ value: "present", evidence: "e", covered_by: ["s1"] }],
  };
  const r = countCoverage(cov, "order-list");
  expect(r.present).toBe(0);
  expect(r.unmeasured).toBeGreaterThan(0);
  expect(r.problems.join("\n")).toMatch(/id が空/);
});

test("列挙側の重複 id は期待セルを二重に数えず問題として残す", () => {
  const cov = {
    slug: "order-list",
    components: [{ id: "grid", items: [{ id: "a" }, { id: "a" }], instances: [{ id: "orders" }] }],
    cells: [cell("a", "orders")],
  };
  const r = countCoverage(cov, "order-list");
  expect(r.present).toBe(1);
  expect(r.unmeasured).toBe(1);
  expect(r.problems.join("\n")).toMatch(/重複/);
});

test("どのセルの行か決まらない行（component / item / instance が空）は索引に入れない", () => {
  const cov = full();
  cov.cells[0] = { ...cov.cells[0], item: "" };
  const r = countCoverage(cov, "order-list");
  expect(r.unmeasured).toBe(1);
  expect(r.problems.join("\n")).toMatch(/component \/ item \/ instance/);
});

test("id 欠落の項目が関わるセルは「項目数 × インスタンス数」ぶん未測定として数える", () => {
  // 項目 3（うち 1 件 id 欠落）× インスタンス 4 = 期待セル 12。欠落項目の 4 セルはすべて未測定。
  const cov = {
    slug: "order-list",
    components: [
      {
        id: "grid",
        items: [{ id: "a" }, { id: "b" }, { name: "id なし" }],
        instances: [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }],
      },
    ],
    cells: [],
  };
  for (const item of ["a", "b"]) {
    for (const instance of ["p1", "p2", "p3", "p4"]) {
      cov.cells.push(cell(item, instance));
    }
  }
  const r = countCoverage(cov, "order-list");
  expect(r.cells).toBe(12);
  expect(r.present).toBe(8);
  expect(r.unmeasured).toBe(4);
});

test("id 欠落のインスタンスも同様に、その列ぶんのセルが未測定になる", () => {
  const cov = {
    slug: "order-list",
    components: [
      {
        id: "grid",
        items: [{ id: "a" }, { id: "b" }],
        instances: [{ id: "p1" }, { name: "id なし" }],
      },
    ],
    cells: [cell("a", "p1"), cell("b", "p1")],
  };
  const r = countCoverage(cov, "order-list");
  expect(r.cells).toBe(4);
  expect(r.present).toBe(2);
  expect(r.unmeasured).toBe(2);
});

test("配列の被覆表・列挙要素・セル行は JSON オブジェクトでないとして弾く", () => {
  // 被覆表そのもの: 「components が空」等へすり替わらず、型崩れの問題文が返ること。
  const arr = countCoverage([], "order-list");
  expect(arr.problems).toEqual(["被覆表が JSON オブジェクトではない"]);
  expect(arr.unmeasured).toBe(1);
  // 列挙要素とセル行: 配列を混ぜても索引に入らず、未測定として数えられること。
  const mixed = countCoverage(
    {
      slug: "order-list",
      components: [{ id: "grid", items: [{ id: "a" }, []], instances: [{ id: "p1" }] }],
      cells: [[], cell("a", "p1")],
    },
    "order-list",
  );
  expect(mixed.cells).toBe(2);
  expect(mixed.present).toBe(1);
  expect(mixed.unmeasured).toBe(1);
  expect(mixed.problems.join("\n")).toMatch(/JSON オブジェクトでない要素/);
});

test("declared: false は reason が必須（免除の根拠が残らない形を通さない）", () => {
  expect(readDeclaration({ component_coverage: { declared: false } })).toMatchObject({
    judged: false,
    malformed: true,
  });
  expect(readDeclaration({ component_coverage: { declared: false, reason: "  " } })).toMatchObject({
    judged: false,
    malformed: true,
  });
});

test("components[].id が空・重複でも期待セルは 項目数 × インスタンス数 で数える", () => {
  const grid = {
    items: [{ id: "a" }, { id: "b" }],
    instances: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
  };
  const noId = countCoverage(
    { slug: "order-list", components: [{ ...grid }], cells: [] },
    "order-list",
  );
  expect(noId).toMatchObject({ cells: 6, unmeasured: 6 });
  const dup = countCoverage(
    {
      slug: "order-list",
      components: [
        { id: "grid", ...grid },
        { id: "grid", ...grid },
      ],
      cells: [],
    },
    "order-list",
  );
  // 1 つ目は通常展開（6 セル・全未測定）、2 つ目は重複として 6 セルぶん未測定。
  expect(dup).toMatchObject({ cells: 12, unmeasured: 12 });
});

test("型崩れの metadata.json は旧成果物に倒さず malformed として弾く", () => {
  expect(readDeclaration([])).toMatchObject({ judged: false, malformed: true });
  expect(readDeclaration({ component_coverage: [] })).toMatchObject({
    judged: false,
    malformed: true,
  });
  expect(readDeclaration({ component_coverage: { declared: "true" } })).toMatchObject({
    judged: false,
    malformed: true,
  });
  expect(readDeclaration({ component_coverage: { declared: true, path: 5 } })).toMatchObject({
    judged: false,
    malformed: true,
  });
});

test("後方互換: component_coverage キーが無い旧成果物は判定に入れない", () => {
  const d = readDeclaration({ slug: "order-list" });
  expect(d.judged).toBe(false);
  expect(d.malformed).toBe(false);
  expect(d.reason).toMatch(/旧成果物/);
});

test("declared: false は理由付きで判定に入れない（キー欠落と区別する）", () => {
  const d = readDeclaration({
    component_coverage: { declared: false, reason: "共通部品を使っていない" },
  });
  expect(d.judged).toBe(false);
  expect(d.reason).toMatch(/共通部品を使っていない/);
});

/** 一時ディレクトリに metadata.json と被覆表を書いて CLI を実行する。 */
function runCli(metadata, coverage) {
  const dir = mkdtempSync(join(tmpdir(), "coverage-check-"));
  const metaPath = join(dir, "metadata.json");
  const covPath = join(dir, "component-coverage.json");
  writeFileSync(metaPath, JSON.stringify(metadata));
  // null ＝ 被覆表を書かない（読めないケース）、undefined ＝ --coverage も渡さない。
  if (coverage !== null && coverage !== undefined) writeFileSync(covPath, JSON.stringify(coverage));
  const args = [script, "--metadata", metaPath];
  if (coverage !== undefined) args.push("--coverage", covPath);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

const declared = {
  slug: "order-list",
  component_coverage: { declared: true, path: "component-coverage.json" },
};

test("CLI 陽性コントロール: 未測定ゼロなら exit 0", () => {
  const r = runCli(declared, full());
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: true, cells: 4, unmeasured: 0 });
});

test("CLI 陰性コントロール: 未測定が残れば exit 1 で理由が stderr に出る", () => {
  const cov = full();
  cov.cells = cov.cells.slice(0, 2);
  const r = runCli(declared, cov);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).unmeasured).toBe(2);
  expect(r.stderr).toMatch(/parity-suite へ戻す/);
});

test("CLI: declared: true なのに被覆表が読めなければ合格に倒さず exit 1", () => {
  const r = runCli(declared, null);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: true, unmeasured: null });
});

test("CLI: 未測定 0 でも不整合が残れば error 行を出して exit 1 する", () => {
  const r = runCli(declared, { slug: "order-list", components: [], cells: [] });
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).unmeasured).toBe(0);
  expect(r.stderr).toMatch(/error: 被覆表の不整合/);
});

test("CLI: 型崩れの metadata.json は exit 2（後方互換の exit 0 に倒さない）", () => {
  const r = runCli([], full());
  expect(r.status).toBe(2);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: false, malformed: true, unmeasured: null });
});

test("CLI: キーを持たない旧成果物は exit 0 で judged: false を出力する", () => {
  const r = runCli({ slug: "order-list" }, full());
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: false });
});

test("CLI: declared: true で path も --coverage も無ければ判定した記録を出して exit 1", () => {
  const r = runCli({ slug: "order-list", component_coverage: { declared: true } }, undefined);
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({ judged: true, source: null, unmeasured: null });
});

test("CLI: 同じフラグの重複指定は後勝ちにせず exit 2", () => {
  const r = spawnSync(process.execPath, [script, "--metadata", "a.json", "--metadata", "b.json"], {
    encoding: "utf8",
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/複数回指定/);
});
