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
    new_implementation:
      "new_implementation" in override
        ? override.new_implementation
        : { commit: "abc123", dirty: false },
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

/** 現在の新側の版（`--replace-metadata` が読む形）。突き合わせ表の記録と同じ commit・clean。 */
const REPLACE_METADATA = { new: { commit: "abc123", dirty: false } };

/** @param {{coverage?: unknown, comparison?: unknown, target?: string|null, replaceMetadata?: unknown}} [input] */
const codesOf = (input = {}) =>
  checkComponentComparison({
    coverage: input.coverage ?? COVERAGE,
    comparison: "comparison" in input ? input.comparison : comparisonOf(),
    replaceMetadata: "replaceMetadata" in input ? input.replaceMetadata : REPLACE_METADATA,
    target: input.target ?? null,
  }).findings.map((f) => f.code);

test("セルの鍵は材料が 1 つでも欠けたら作らない（undefined が有効な鍵へ化けない）", () => {
  expect(cellKey({ component: "grid", item: "sort", instance: "grid@list" })).toBe(
    "grid|sort|grid@list",
  );
  expect(cellKey({ component: "grid", item: "sort" })).toBeNull();
  expect(cellKey({ component: "grid", item: "", instance: "grid@list" })).toBeNull();
});

test("区切り文字を含む材料からは鍵を作らない（別の操作の記録が証拠に化ける）", () => {
  // ("a|b","c","d") と ("a","b|c","d") はどちらも a|b|c|d になり、
  // 別セルの突き合わせ記録が present セルの証拠として通る（指紋も同じ鍵を数えるので一致する）。
  expect(cellKey({ component: "a|b", item: "c", instance: "d" })).toBeNull();
  expect(cellKey({ component: "a", item: "b|c", instance: "d" })).toBeNull();

  const coverage = {
    slug: "order-list",
    cells: [{ component: "a|b", item: "c", instance: "d", value: "present", evidence: "読了" }],
  };
  const comparison = {
    slug: "order-list",
    target: "preview",
    source_coverage: { path: "x", fingerprint: fingerprintOf([]) },
    cells: [
      {
        component: "a",
        item: "b|c",
        instance: "d",
        compared: true,
        evidence: { entry: "a", hit_area: "b", completion: "c" },
      },
    ],
  };
  const codes = checkComponentComparison({ coverage, comparison, target: "preview" }).findings.map(
    (f) => f.code,
  );
  expect(codes).toContain("coverage-cell-unkeyed");
  expect(codes).toContain("comparison-row-unkeyed");
});

test("陽性コントロール: 3 点の揃った突き合わせは exit 0（常に落とす実装ではない）", () => {
  const { code, result } = run(
    [
      "--coverage",
      "c.json",
      "--comparison",
      "n.json",
      "--replace-metadata",
      "r.json",
      "--target",
      "preview",
    ],
    {
      "/w/c.json": JSON.stringify(COVERAGE),
      "/w/n.json": JSON.stringify(comparisonOf()),
      "/w/r.json": JSON.stringify(REPLACE_METADATA),
    },
  );
  expect(result.findings).toEqual([]);
  expect(result.counts.present).toBe(2);
  expect(result.counts.compared).toBe(2);
  expect(code).toBe(0);
});

test("突き合わせ表が無ければ未突合として落ちる（在席の記録では収束させない）", () => {
  const { code, result } = run(
    [
      "--coverage",
      "c.json",
      "--comparison",
      "n.json",
      "--replace-metadata",
      "r.json",
      "--target",
      "preview",
    ],
    {
      "/w/c.json": JSON.stringify(COVERAGE),
      "/w/r.json": JSON.stringify(REPLACE_METADATA),
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
      replaceMetadata: REPLACE_METADATA,
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
    replaceMetadata: REPLACE_METADATA,
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

test("突き合わせは新側の版に紐づける（記録後に実装が変わったら落ちる）", () => {
  // target・slug・被覆表の指紋だけでは、記録の後に新側を変えても古い証拠が通る。
  const stale = checkComponentComparison({
    coverage: COVERAGE,
    comparison: comparisonOf(),
    replaceMetadata: { new: { commit: "def456", dirty: false } },
    target: "preview",
  }).findings.map((f) => f.code);
  expect(stale).toContain("comparison-implementation-stale");

  // 同じ版なら通る（陽性コントロール）。
  const fresh = checkComponentComparison({
    coverage: COVERAGE,
    comparison: comparisonOf(),
    replaceMetadata: { new: { commit: "abc123", dirty: false } },
    target: "preview",
  }).findings;
  expect(fresh).toEqual([]);

  // 版を記録していない突き合わせ表と、未コミットの新側は落とす。
  expect(codesOf({ comparison: comparisonOf({ new_implementation: undefined }) })).toContain(
    "comparison-implementation-unrecorded",
  );
  expect(
    checkComponentComparison({
      coverage: COVERAGE,
      comparison: comparisonOf(),
      replaceMetadata: { new: { commit: "abc123", dirty: true } },
      target: "preview",
    }).findings.map((f) => f.code),
  ).toContain("replace-metadata-dirty");
});

test("被覆表に slug が無いことを免除にしない", () => {
  const coverage = { ...COVERAGE };
  delete coverage.slug;
  expect(codesOf({ coverage })).toContain("coverage-slug-missing");
});

test("別機能から写した突き合わせ表は --metadata なしでも落ちる", () => {
  // --metadata は任意なので、metadata があるときだけ slug を見ると、target と鍵が一致するだけで通る。
  const codes = codesOf({
    comparison: comparisonOf({ slug: "order-detail" }),
    target: "preview",
  });
  expect(codes).toContain("comparison-slug-mismatch");
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
    [
      "--coverage",
      "c.json",
      "--comparison",
      "n.json",
      "--replace-metadata",
      "r.json",
      "--target",
      "preview",
    ],
    {
      "/w/c.json": JSON.stringify({ slug: "order-list" }),
      "/w/n.json": JSON.stringify(comparisonOf()),
      "/w/r.json": JSON.stringify(REPLACE_METADATA),
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
    replaceMetadata: REPLACE_METADATA,
    target: null,
  });
  expect(result.findings.map((f) => f.code)).toContain("coverage-cell-duplicated");
  // 重複を弾いたうえで、実在するセルの数え上げは 1 回のままであること
  // （弾かないと present も compared も 1 セルぶん多く報告される）。
  expect(result.counts.present).toBe(PRESENT_KEYS.length);
  expect(result.counts.compared).toBe(PRESENT_KEYS.length);
});

test("--target を省いた実行・空白だけの値は exit 2（別環境の記録を黙って通さない）", () => {
  const files = {
    "/w/c.json": JSON.stringify(COVERAGE),
    "/w/n.json": JSON.stringify(comparisonOf()),
    "/w/r.json": JSON.stringify(REPLACE_METADATA),
  };
  expect(run(["--coverage", "c.json", "--comparison", "n.json"], files).code).toBe(2);
  // 空白だけの値は CLI の truthy 判定を通るが、判定側は非空文字列でないと target 照合を飛ばす。
  expect(run(["--coverage", "c.json", "--comparison", "n.json", "--target", " "], files).code).toBe(
    2,
  );
});

test("--replace-metadata を省いた実行・空白だけの値は exit 2（鮮度の照合相手を省けなくする）", () => {
  // 省けると comparison-implementation-stale が一度も評価されず、記録の後に新側を変えても古い証拠で収束する。
  const files = {
    "/w/c.json": JSON.stringify(COVERAGE),
    "/w/n.json": JSON.stringify(comparisonOf()),
    "/w/r.json": JSON.stringify(REPLACE_METADATA),
  };
  expect(
    run(["--coverage", "c.json", "--comparison", "n.json", "--target", "preview"], files).code,
  ).toBe(2);
  expect(
    run(
      [
        "--coverage",
        "c.json",
        "--comparison",
        "n.json",
        "--replace-metadata",
        " ",
        "--target",
        "preview",
      ],
      files,
    ).code,
  ).toBe(2);
});

test("replace-metadata が new オブジェクトを持たなければ鮮度を検査できたことにしない", () => {
  // 型崩れ・プリミティブを免除にすると、鮮度の分岐ごと飛んで古い記録が通る。
  for (const broken of [undefined, null, 3, "x", [], {}, { new: 3 }, { new: [] }]) {
    expect(codesOf({ replaceMetadata: broken })).toContain("replace-metadata-unusable");
  }
  // 陽性コントロール: new オブジェクトが揃っていればこの finding は出ない。
  expect(codesOf()).not.toContain("replace-metadata-unusable");
});

test("版の記録は dirty: false まで求める（未コミットの作業ツリーは commit が版を指さない）", () => {
  for (const dirty of [undefined, true, "false", null]) {
    const comparison = comparisonOf({ new_implementation: { commit: "abc123", dirty } });
    expect(codesOf({ comparison })).toContain("comparison-implementation-dirty");
    expect(codesOf({ replaceMetadata: { new: { commit: "abc123", dirty } } })).toContain(
      "replace-metadata-dirty",
    );
  }
  // 陽性コントロール: どちらも false なら出ない。
  const clean = codesOf();
  expect(clean).not.toContain("comparison-implementation-dirty");
  expect(clean).not.toContain("replace-metadata-dirty");
});

test("引数の誤り・読めない被覆表は exit 2", () => {
  expect(run([], {}).code).toBe(2);
  expect(run(["--coverage"], {}).code).toBe(2);
  expect(run(["--coverage", "c.json", "--nope", "x"], {}).code).toBe(2);
  expect(run(["--coverage", "missing.json"], {}).code).toBe(2);
});

// Issue #408: new.commit が "none"（新側が git 管理を持たない）のとき、素の文字列比較は
// 常に一致するので comparison-implementation-stale が一度も発火せず、実装を変えても
// 古い突き合わせ記録が鮮度検査を素通りしていた。artifact-health-check.mjs と同じく反復回数へ退く。
const noneReplaceMetadata = (iterations) => ({
  new: { commit: "none", dirty: false },
  ...(iterations === undefined ? {} : { loop: { iterations } }),
});

test("new.commit が none なら反復回数で鮮度を判定する", () => {
  // 記録した反復回数と現在の反復回数がずれていれば落ちる（旧実装ではここが素通りしていた）。
  expect(
    codesOf({
      comparison: comparisonOf({
        new_implementation: { commit: "none", dirty: false, iteration: 2 },
      }),
      replaceMetadata: noneReplaceMetadata(3),
    }),
  ).toContain("comparison-implementation-stale");
  // 一致していれば通る（陽性コントロール。常に落とす実装ではない）。
  expect(
    codesOf({
      comparison: comparisonOf({
        new_implementation: { commit: "none", dirty: false, iteration: 3 },
      }),
      replaceMetadata: noneReplaceMetadata(3),
    }),
  ).toEqual([]);
});

test.each([
  ["記録側の iteration が無い", { commit: "none", dirty: false }, 3],
  ["現在側の loop.iterations が無い", { commit: "none", dirty: false, iteration: 3 }, undefined],
  ["iteration が整数でない", { commit: "none", dirty: false, iteration: "3" }, 3],
])("none なのに退き先が読めなければ合格に倒さない: %s", (_label, implementation, iterations) => {
  expect(
    codesOf({
      comparison: comparisonOf({ new_implementation: implementation }),
      replaceMetadata: noneReplaceMetadata(iterations),
    }),
  ).toContain("comparison-implementation-unversionable");
});

// 片側だけが none なら必要な直し方は「同じ版で取り直す」なので stale だけを出す。
// 反復回数の検査まで進めると、契約上 iteration を書く義務が無い SHA 記録に対して
// unversionable（「iteration を書き足せ」と読める）が併発し、案内と実際の直し方がずれる。
test("片側だけが none なら stale だけを出し、iteration の欠落は問わない", () => {
  const codes = codesOf({
    comparison: comparisonOf({ new_implementation: { commit: "abc123", dirty: false } }),
    replaceMetadata: noneReplaceMetadata(3),
  });
  expect(codes).toContain("comparison-implementation-stale");
  expect(codes).not.toContain("comparison-implementation-unversionable");
});

test("commit が実在の SHA なら従来どおり文字列で判定する（対照）", () => {
  expect(codesOf()).toEqual([]);
  expect(
    codesOf({
      comparison: comparisonOf({ new_implementation: { commit: "def456", dirty: false } }),
    }),
  ).toContain("comparison-implementation-stale");
});

// 片側だけが none のとき、反復回数がたまたま一致しただけで合格に倒さない。
// `none` と実在の SHA は同じ版を指さないので、反復回数の検査とは別に必ず落とす。
test.each([
  ["記録が SHA・現在が none", { commit: "abc123", dirty: false, iteration: 3 }, "none", 3],
  ["記録が none・現在が SHA", { commit: "none", dirty: false, iteration: 3 }, "abc123", 3],
])(
  "片側だけ none で反復回数が一致しても合格に倒さない: %s",
  (_label, implementation, now, iterations) => {
    expect(
      codesOf({
        comparison: comparisonOf({ new_implementation: implementation }),
        replaceMetadata: { new: { commit: now, dirty: false }, loop: { iterations } },
      }),
    ).toContain("comparison-implementation-stale");
  },
);

test("両側とも none で反復回数も一致すれば通る（陽性コントロール。常に落とす実装ではない）", () => {
  expect(
    codesOf({
      comparison: comparisonOf({
        new_implementation: { commit: "none", dirty: false, iteration: 3 },
      }),
      replaceMetadata: noneReplaceMetadata(3),
    }),
  ).toEqual([]);
});
