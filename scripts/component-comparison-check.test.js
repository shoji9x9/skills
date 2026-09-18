// parity-suite の新側突き合わせの検査（component-comparison-check.mjs）の回帰テスト（Issue #337）。
//
// 被覆表の 3 値は移行元側の測定なので、present をいくら積んでも新側の欠落は 1 件も示されない。
// 新側で同じ操作を実施したことを別の記録に持たせ、入口・当たり判定・完了の 3 点が揃うまで突き合わせ済みにしない。
//
// 陽性コントロール（3 点の揃った記録が exit 0）を置く——これが無いと「常に落とす」実装と区別できない。

import { test, expect } from "vitest";
import {
  main,
  checkComponentComparison,
  cellKey,
  fingerprintOf,
} from "../skills/parity-suite/scripts/component-comparison-check.mjs";

/** 移行元側の被覆表（present 2 件 ＋ absent / unmeasured 各 1 件）。 */
const COVERAGE = {
  slug: "order-list",
  measured_target: "current",
  cells: [
    { component: "grid", item: "sort", instance: "grid@list", value: "present", evidence: "読了" },
    {
      component: "grid",
      item: "context-menu",
      instance: "grid@list",
      value: "present",
      evidence: "読了",
    },
    {
      component: "grid",
      item: "export",
      instance: "grid@detail",
      value: "absent",
      evidence: "発火せず",
    },
    {
      component: "grid",
      item: "group",
      instance: "grid@list",
      value: "unmeasured",
      unmeasured_reason: "未到達",
    },
  ],
};

const PRESENT_KEYS = ["grid|sort|grid@list", "grid|context-menu|grid@list"];

/**
 * 新側の突き合わせ表を組み立てる。差し替えたい行だけ渡す。
 * @param {{ cells?: unknown, fingerprint?: string, target?: string, slug?: string }} [override]
 */
function comparisonOf(override = {}) {
  return {
    slug: override.slug ?? "order-list",
    target: override.target ?? "preview",
    source_coverage: {
      path: ".replace/parity/order-list/component-coverage.json",
      fingerprint: override.fingerprint ?? fingerprintOf(PRESENT_KEYS),
    },
    cells: override.cells ?? [
      {
        component: "grid",
        item: "sort",
        instance: "grid@list",
        compared: true,
        evidence: {
          entry: "新側で列見出しを押して並び替えを開始できた",
          hit_area: "押せる範囲が見出し全体で cursor も pointer（移行元と同じ）",
          completion: "昇順・降順の印が出て行順が移行元と同じになった",
        },
      },
      {
        component: "grid",
        item: "context-menu",
        instance: "grid@list",
        compared: true,
        evidence: {
          entry: "右クリックでメニューが開いた",
          hit_area: "下位を示す三角が項目自身の ::after で、行全体が 1 つの項目",
          completion: "親項目を押すと下位が開き、親メニューは閉じない",
        },
      },
    ],
  };
}

/**
 * main をメモリ上のファイルで回す。
 * @param {string[]} argv
 * @param {Record<string, string>} files
 */
function run(argv, files) {
  let output = "";
  const code = main(argv, {
    cwd: "/w",
    readFile: (path) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    },
    write: (s) => {
      output += s;
    },
  });
  return { code, result: output === "" ? null : JSON.parse(output) };
}

/** @param {{coverage?: unknown, comparison?: unknown, target?: string|null}} [input] */
const codesOf = (input = {}) =>
  checkComponentComparison({
    coverage: input.coverage ?? COVERAGE,
    comparison: "comparison" in input ? input.comparison : comparisonOf(),
    target: input.target ?? null,
  }).findings.map((f) => f.code);

test("セルの鍵は材料が 1 つでも欠けたら作らない（undefined が有効な鍵へ化けない）", () => {
  expect(cellKey({ component: "grid", item: "sort", instance: "grid@list" })).toBe(
    "grid|sort|grid@list",
  );
  expect(cellKey({ component: "grid", item: "sort" })).toBeNull();
  expect(cellKey({ component: "grid", item: "", instance: "grid@list" })).toBeNull();
});

test("陽性コントロール: 3 点の揃った突き合わせは exit 0（常に落とす実装ではない）", () => {
  const { code, result } = run(
    ["--coverage", "c.json", "--comparison", "n.json", "--target", "preview"],
    {
      "/w/c.json": JSON.stringify(COVERAGE),
      "/w/n.json": JSON.stringify(comparisonOf()),
    },
  );
  expect(result.findings).toEqual([]);
  expect(result.counts.present).toBe(2);
  expect(result.counts.compared).toBe(2);
  expect(code).toBe(0);
});

test("突き合わせ表が無ければ未突合として落ちる（在席の記録では収束させない）", () => {
  const { code, result } = run(
    ["--coverage", "c.json", "--comparison", "n.json", "--target", "preview"],
    {
      "/w/c.json": JSON.stringify(COVERAGE),
    },
  );
  expect(code).toBe(1);
  expect(result.findings.map((f) => f.code)).toContain("comparison-missing");
});

test("present なのに行が無いセルは未突合として数える", () => {
  const codes = codesOf({
    comparison: comparisonOf({ cells: [comparisonOf().cells[0]] }),
  });
  expect(codes).toContain("cell-not-compared");
});

test("入口・当たり判定・完了のどれかが欠けたら突き合わせ済みにしない", () => {
  for (const axis of ["entry", "hit_area", "completion"]) {
    const cells = comparisonOf().cells.map((cell) => {
      if (cell.item !== "sort") return cell;
      const evidence = { ...cell.evidence };
      delete evidence[axis];
      return { ...cell, evidence };
    });
    const result = checkComponentComparison({
      coverage: COVERAGE,
      comparison: comparisonOf({ cells }),
    });
    expect(result.findings.map((f) => f.code)).toContain("evidence-axis-missing");
    expect(result.counts.blocking).toBe(1);
  }
});

test("compared: false は理由が要り、承認の無いものは blocking として数える", () => {
  const cells = comparisonOf().cells.map((cell) =>
    cell.item === "sort" ? { ...cell, compared: false, evidence: undefined } : cell,
  );
  expect(codesOf({ comparison: comparisonOf({ cells }) })).toContain("not-compared-reason-missing");

  const withReason = comparisonOf().cells.map((cell) =>
    cell.item === "sort"
      ? { ...cell, compared: false, evidence: undefined, not_compared_reason: "新側が未実装" }
      : cell,
  );
  expect(codesOf({ comparison: comparisonOf({ cells: withReason }) })).toContain(
    "cell-comparison-blocking",
  );
});

test("承認記録のある accepted だけが未突合を通す", () => {
  const approved = comparisonOf().cells.map((cell) =>
    cell.item === "sort"
      ? {
          ...cell,
          compared: false,
          evidence: undefined,
          not_compared_reason: "移行元の実装に依存する挙動で新側に対応する操作が無い",
          disposition: "accepted",
          approved_by: "利用者",
          approved_at: "2026-09-18T00:00:00Z",
        }
      : cell,
  );
  const result = checkComponentComparison({
    coverage: COVERAGE,
    comparison: comparisonOf({ cells: approved }),
  });
  expect(result.findings).toEqual([]);
  expect(result.counts.accepted).toBe(1);

  const unapproved = approved.map((cell) =>
    cell.item === "sort" ? { ...cell, approved_by: undefined } : cell,
  );
  expect(codesOf({ comparison: comparisonOf({ cells: unapproved }) })).toContain(
    "acceptance-unapproved",
  );
});

test("被覆表が更新されたら古い突き合わせ表は指紋で落ちる", () => {
  const codes = codesOf({
    comparison: comparisonOf({ fingerprint: fingerprintOf(["grid|sort|grid@list"]) }),
  });
  expect(codes).toContain("coverage-fingerprint-mismatch");
});

test("指紋の欄そのものが無い記録も落ちる", () => {
  const comparison = comparisonOf();
  delete comparison.source_coverage.fingerprint;
  expect(codesOf({ comparison })).toContain("coverage-fingerprint-missing");
});

test("別 target の記録では収束させない", () => {
  expect(codesOf({ target: "staging" })).toContain("comparison-target-mismatch");
});

test("被覆表に無いセルの記録が混ざっていれば落ちる", () => {
  const cells = [
    ...comparisonOf().cells,
    {
      component: "grid",
      item: "group",
      instance: "grid@list",
      compared: true,
      evidence: { entry: "a", hit_area: "b", completion: "c" },
    },
  ];
  expect(codesOf({ comparison: comparisonOf({ cells }) })).toContain("comparison-row-unknown");
});

test("同じセルの行が 2 つあれば落ちる", () => {
  const cells = [...comparisonOf().cells, comparisonOf().cells[0]];
  expect(codesOf({ comparison: comparisonOf({ cells }) })).toContain("comparison-row-duplicated");
});

test("被覆表が読めなければ exit 2（合格に倒さない）", () => {
  const { code, result } = run(
    ["--coverage", "c.json", "--comparison", "n.json", "--target", "preview"],
    {
      "/w/c.json": JSON.stringify({ slug: "order-list" }),
      "/w/n.json": JSON.stringify(comparisonOf()),
    },
  );
  expect(code).toBe(2);
  expect(result.findings.map((f) => f.code)).toContain("coverage-unreadable");
});

test("被覆表に同じ present セルが 2 つあれば落ちる（1 セルを 2 回数えない）", () => {
  const coverage = { ...COVERAGE, cells: [...COVERAGE.cells, COVERAGE.cells[0]] };
  const result = checkComponentComparison({
    coverage,
    comparison: comparisonOf(),
    target: null,
  });
  expect(result.findings.map((f) => f.code)).toContain("coverage-cell-duplicated");
  // 重複を弾いたうえで、実在するセルの数え上げは 1 回のままであること
  // （弾かないと present も compared も 1 セルぶん多く報告される）。
  expect(result.counts.present).toBe(PRESENT_KEYS.length);
  expect(result.counts.compared).toBe(PRESENT_KEYS.length);
});

test("--target を省いた実行は exit 2（別環境の記録を黙って通さない）", () => {
  const { code } = run(["--coverage", "c.json", "--comparison", "n.json"], {
    "/w/c.json": JSON.stringify(COVERAGE),
    "/w/n.json": JSON.stringify(comparisonOf()),
  });
  expect(code).toBe(2);
});

test("引数の誤り・読めない被覆表は exit 2", () => {
  expect(run([], {}).code).toBe(2);
  expect(run(["--coverage"], {}).code).toBe(2);
  expect(run(["--coverage", "c.json", "--nope", "x"], {}).code).toBe(2);
  expect(run(["--coverage", "missing.json"], {}).code).toBe(2);
});
