import { assert, test, expect } from "vitest";
import { fillSetProvenance } from "../../lib/testing/coverage-set-provenance-fixture.ts";
import { invalidInput, removeField } from "../../lib/testing/test-input.ts";
import * as expand from "../../../skills/parity-suite/scripts/coverage-expand.mjs";
import * as check from "../../../skills/parity-diff/scripts/coverage-check.mjs";
import {
  counts,
  fingerprintFixture,
  type Fixture,
  generic,
  grid,
  orders,
  profiled,
  profiles,
  SLUG,
  variant,
} from "./coverage-record-judge-parity-helpers.ts";
import {
  datagridEnumeration,
  componentInventory,
  findOrFail,
  instanceInventory,
  reconcile,
} from "./coverage-fixture-helpers.ts";

// 網羅表の未測定は、記録側（parity-suite の coverage-expand.mjs の reconcile）と
// 判定側（parity-diff の coverage-check.mjs の countCoverage）が独立に数える。
// 配布スキルは成果物を同梱する規約のため共有モジュールにできず、ガードを片方にだけ足すと
// 「記録側は未測定 0 を記録するが判定側は未測定を数える」が起きる（conformance の要約と metadata が
// 未解決領域を過小に見せる）。個別の分岐を後追いする代わりに、同じ入力に両者を当てて件数の関係を固定する。
//
// 関係は 2 種類に限る。
// - eq: 両者が同じ一次情報だけで数える分岐（採点せずに抜ける分岐・セル行の採点）。件数が一致する
// - ge: 記録側だけがプロファイルを読んで展開し直せる分岐。記録側が判定側より多く数えてよいが、少なくはしない
// どちらでも「判定側が未測定を数えるのに記録側が 0 件」は落ちる。

// 状態空間: 部品・インスタンス・項目・候補記録・列挙・セル行それぞれの キーの材料（id）と形の崩れ。
const CASES: Array<[string, "eq" | "ge", () => Fixture]> = [
  ["汎用: 全セル present", "eq", generic],
  ["プロファイル: 全候補 present", "eq", profiled],
  // 部品単位で採点せずに抜ける分岐（Issue #349 の (1)(2)）
  ["汎用: profile キーが無い", "eq", variant(generic, (c) => removeField(grid(c), "profile"))],
  [
    "汎用: profile が文字列でも null でもない",
    "eq",
    variant(generic, (c) => (grid(c).profile = invalidInput(5))),
  ],
  [
    "components の要素が文字列",
    "eq",
    variant(generic, (c) => c.components.push(invalidInput("toolbar"))),
  ],
  ["components の要素が配列", "eq", variant(generic, (c) => c.components.push(invalidInput([])))],
  [
    "components の要素が null",
    "eq",
    variant(generic, (c) => c.components.push(invalidInput(null))),
  ],
  ["汎用: 部品 id が空", "eq", variant(generic, (c) => (grid(c).id = ""))],
  ["プロファイル: 部品 id が空", "eq", variant(profiled, (c) => (grid(c).id = ""))],
  [
    "プロファイル: 部品 id が空で列挙が使えない",
    "eq",
    variant(profiled, (c) => {
      grid(c).id = "";
      removeField(orders(c), "enumeration");
    }),
  ],
  [
    "プロファイル: 部品 id が空で候補に無い項目がある",
    "eq",
    variant(profiled, (c) => {
      grid(c).id = "";
      grid(c).items.push(invalidInput({ id: "extra" }));
    }),
  ],
  [
    "汎用: 部品 id が重複",
    "eq",
    variant(generic, (c) => c.components.push(structuredClone(grid(c)))),
  ],
  ["汎用: instances が空", "eq", variant(generic, (c) => (grid(c).instances = []))],
  ["汎用: 項目 id が重複", "eq", variant(generic, (c) => grid(c).items.push({ id: "sort" }))],
  [
    "汎用: 項目が JSON オブジェクトでない",
    "eq",
    variant(generic, (c) => grid(c).items.push(invalidInput(1))),
  ],
  // インスタンス単位で採点せずに抜ける分岐（同じ故障クラス）
  ["プロファイル: instances が空", "eq", variant(profiled, (c) => (grid(c).instances = []))],
  [
    "プロファイル: インスタンスが JSON オブジェクトでない",
    "eq",
    variant(profiled, (c) => grid(c).instances.push(invalidInput(3))),
  ],
  [
    "プロファイル: インスタンス id が空",
    "eq",
    variant(profiled, (c) =>
      grid(c).instances.push(invalidInput({ enumeration: datagridEnumeration() })),
    ),
  ],
  [
    "プロファイル: インスタンス id に区切り文字",
    "eq",
    variant(profiled, (c) => {
      orders(c).id = "admin/orders";
      for (const cell of c.cells) cell.instance = "admin/orders";
    }),
  ],
  [
    "プロファイル: インスタンス id が重複",
    "eq",
    variant(profiled, (c) => grid(c).instances.push(structuredClone(orders(c)))),
  ],
  [
    "プロファイル: enumeration が無い",
    "eq",
    variant(profiled, (c) => removeField(orders(c), "enumeration")),
  ],
  [
    "プロファイル: enumeration.complete が true でない",
    "eq",
    variant(profiled, (c) => (orders(c).enumeration.complete = false)),
  ],
  [
    "プロファイル: enumeration.source が無い",
    "eq",
    variant(profiled, (c) => removeField(orders(c).enumeration, "source")),
  ],
  // 判定側が数え直しに使う記録（candidates / candidate.axes）の崩れ
  [
    "プロファイル: instances[].candidates が無い",
    "eq",
    variant(profiled, (c) => removeField(orders(c), "candidates")),
  ],
  [
    "プロファイル: instances[].candidates が空",
    "eq",
    variant(profiled, (c) => (orders(c).candidates = [])),
  ],
  [
    "プロファイル: instances[].candidates から 1 件漏れた",
    "eq",
    variant(profiled, (c) => orders(c).candidates.pop()),
  ],
  // 同じ候補が 2 つの箇所（候補ループのセル採点と、candidates の記録の抜け）で欠けても 1 件に数える
  [
    "プロファイル: 同じ候補が candidates とセル行の両方から漏れた",
    "eq",
    variant(profiled, (c) => {
      orders(c).candidates.pop();
      c.cells.pop();
    }),
  ],
  [
    "プロファイル: instances[].candidates が空でセル行も 1 件欠ける",
    "eq",
    variant(profiled, (c) => {
      orders(c).candidates = [];
      c.cells.pop();
    }),
  ],
  [
    "プロファイル: instances[].candidates が無くセル行も 1 件欠ける",
    "eq",
    variant(profiled, (c) => {
      removeField(orders(c), "candidates");
      c.cells.pop();
    }),
  ],
  [
    "プロファイル: 項目の candidate が無い",
    "eq",
    variant(profiled, (c) => removeField(grid(c).items[0], "candidate")),
  ],
  ["プロファイル: 候補に対応する項目が無い", "eq", variant(profiled, (c) => grid(c).items.shift())],
  [
    "プロファイル: 項目の candidate.axes が JSON オブジェクトでない",
    "eq",
    variant(profiled, (c) => (grid(c).items[0].candidate.axes = invalidInput("column=price"))),
  ],
  // 軸値の不一致は、判定側に「候補に現れない要素」を数えさせうる（その要素を持つ候補が 1 件だけのとき）
  [
    "プロファイル: 唯一の候補を持つ要素の candidate.axes の値が違う",
    "ge",
    variant(profiled, (c) => {
      const item = findOrFail(
        grid(c).items,
        (i) => i.candidate.rule === "context-menu-item",
        "context-menu-item の項目",
      );
      for (const axisId of Object.keys(item.candidate.axes)) item.candidate.axes[axisId] = "bogus";
    }),
  ],
  // 候補の記録の不備とセルの不備は別の欠陥。判定側は両方を数えるので、記録側も 1 件に畳まない
  [
    "プロファイル: 項目の candidate とセル行の両方が無い",
    "eq",
    variant(profiled, (c) => {
      removeField(grid(c).items[0], "candidate");
      c.cells = c.cells.filter((cell) => cell.item !== grid(c).items[0].id);
    }),
  ],
  [
    "プロファイル: 候補に対応する項目とセル行の両方が無い",
    "eq",
    variant(profiled, (c) => {
      const [removed] = grid(c).items.splice(0, 1);
      c.cells = c.cells.filter((cell) => cell.item !== removed.id);
    }),
  ],
  [
    "プロファイル: 項目の candidate が無くセルが unmeasured",
    "eq",
    variant(profiled, (c) => {
      removeField(grid(c).items[0], "candidate");
      findOrFail(c.cells, (cell) => cell.item === grid(c).items[0].id, "項目のセル行").value =
        "unmeasured";
    }),
  ],
  // セル行の採点（両者が同じ規則を当てる）
  ["プロファイル: セル行が無い", "eq", variant(profiled, (c) => c.cells.pop())],
  [
    "プロファイル: セル行が重複",
    "eq",
    variant(profiled, (c) => c.cells.push(structuredClone(c.cells[0]))),
  ],
  ["プロファイル: value が 3 値でない", "eq", variant(profiled, (c) => (c.cells[0].value = "yes"))],
  [
    "プロファイル: absent に証拠が無い",
    "eq",
    variant(profiled, (c) => (c.cells[0].value = "absent")),
  ],
  ["汎用: value が unmeasured", "eq", variant(generic, (c) => (c.cells[0].value = "unmeasured"))],
  // 記録側だけがプロファイルを読んで検出できる分岐
  [
    "プロファイル: 同梱ディレクトリに無いプロファイル",
    "ge",
    variant(profiled, (c) => (grid(c).profile = "no-such-profile")),
  ],
  // プロファイルを読めない部品でも、判定側は記録された候補から数え直す。宣言セル数だけを下限にすると、
  // items が欠けて候補だけ記録された表で判定側を下回る
  [
    "プロファイル: 同梱に無いプロファイルで items が 1 件だけ残る",
    "ge",
    variant(profiled, (c) => {
      grid(c).profile = "no-such-profile";
      grid(c).items = grid(c).items.slice(0, 1);
    }),
  ],
  [
    "プロファイル: 同梱に無いプロファイルで items が 1 件だけ残りセル行も無い",
    "ge",
    variant(profiled, (c) => {
      grid(c).profile = "no-such-profile";
      grid(c).items = grid(c).items.slice(0, 1);
      c.cells = [];
    }),
  ],
  [
    "プロファイル: 同梱に無いプロファイルで candidate.axes もセル行も無い",
    "ge",
    variant(profiled, (c) => {
      grid(c).profile = "no-such-profile";
      for (const item of grid(c).items) removeField(item, "candidate");
      c.cells = [];
    }),
  ],
  [
    "プロファイル: 必須ルールの候補が 0 件",
    "ge",
    variant(profiled, (c) => (orders(c).enumeration.elements["menu-item"] = [])),
  ],
  [
    "プロファイル: 列挙した要素がどの候補にも現れない",
    "ge",
    variant(profiled, (c) => {
      const flags = orders(c).enumeration.elements.column[1].flags;
      for (const key of Object.keys(flags)) flags[key] = false;
    }),
  ],
  // 集合の出所と完全性（Issue #392 / #393）。fillSetProvenance は「無いときだけ」補うので、
  // null を置いた欠落はそのまま両側へ渡る（delete だと補完ラッパが埋めてしまう）。
  [
    "集合: component_inventory が無い",
    "eq",
    variant(generic, (c) => (c.component_inventory = invalidInput(null))),
  ],
  [
    "集合: instance_inventory が無い",
    "eq",
    variant(generic, (c) => (grid(c).instance_inventory = invalidInput(null))),
  ],
  [
    "集合: components[].source が無い",
    "eq",
    variant(generic, (c) => (grid(c).source = invalidInput(null))),
  ],
  [
    "集合: 一次情報源以外で列挙したのに理由が無い",
    "eq",
    variant(generic, (c) => {
      fillSetProvenance(c);
      componentInventory(c).source.kind = "app-ui";
    }),
  ],
  [
    "集合: 完全性を宣言していない",
    "eq",
    variant(generic, (c) => {
      fillSetProvenance(c);
      removeField(instanceInventory(grid(c)), "complete");
    }),
  ],
  [
    "集合: complete: true なのに incomplete_reason が残っている",
    "eq",
    variant(generic, (c) => {
      fillSetProvenance(c);
      componentInventory(c).incomplete_reason = "数え切れていない（古い記録）";
    }),
  ],
  [
    "プロファイル: enumeration.source.kind が語彙外",
    "eq",
    variant(profiled, (c) => (orders(c).enumeration.source.kind = "vendor-spec")),
  ],
  [
    "プロファイル: enumeration が実 UI からの列挙なのに理由が無い",
    "eq",
    variant(profiled, (c) => (orders(c).enumeration.source.kind = "app-ui")),
  ],
  [
    "プロファイル: enumeration が complete: true なのに incomplete_reason が残る",
    "eq",
    variant(
      profiled,
      (c) => (orders(c).enumeration.incomplete_reason = "読み切れていない（残り）"),
    ),
  ],
];

test.each(CASES)("%s: 記録側の未測定が判定側と %s の関係にある", (_name, relation, make) => {
  const { record, judge } = counts(make);
  if (relation === "eq") expect(record).toBe(judge);
  else expect(record).toBeGreaterThanOrEqual(judge);
});

test("誤検知しないことの確認: 全セルを埋めた網羅表は両者とも未測定 0（常に数える実装を弾く）", () => {
  expect(counts(generic)).toEqual({ record: 0, judge: 0 });
  expect(counts(profiled)).toEqual({ record: 0, judge: 0 });
});

test("検出されることの確認: 変異の入力は判定側で未測定を生む（ge の緩さで素通りさせない）", () => {
  // eq のケースで判定側が 0 件なら「両者とも数えない」でも一致してしまい、何も実証しない。
  // 基準の 2 件を除く全ケースで、少なくとも一方が未測定を数えることを確かめる。
  for (const [name, , make] of CASES.slice(2)) {
    const { record, judge } = counts(make);
    expect(record, name).toBeGreaterThan(0);
    if (CASES.find((c) => c[0] === name)?.[1] === "eq") expect(judge, name).toBeGreaterThan(0);
  }
});

test("Issue #349 の再現表: profile キー欠落（項目 2 × インスタンス 3）は 6 件、非オブジェクト要素は 1 件", () => {
  expect(counts(variant(generic, (c) => removeField(grid(c), "profile")))).toEqual({
    record: 6,
    judge: 6,
  });
  expect(counts(variant(generic, (c) => c.components.push(invalidInput("toolbar"))))).toEqual({
    record: 1,
    judge: 1,
  });
});

test("candidate.rule だけの不一致は両者とも未測定に数えず、記録側は問題として残す（過大計上しない）", () => {
  // 判定側は candidate.axes だけで数え直すので、rule の誤りは判定側の件数を変えない。
  // 記録側だけが未測定に数えると、conformance の要約が未解決を過大に見せる。
  const make = variant(profiled, (c) => (grid(c).items[0].candidate.rule = "bogus"));
  expect(counts(make)).toEqual({ record: 0, judge: 0 });
  const result = reconcile(make(), profiles);
  expect(result.ok).toBe(false);
  expect(result.problems.join("\n")).toMatch(/candidate\.rule（bogus）が展開結果/);
});

// 撮影状態の要約の指紋は、記録側（coverage-expand）と判定側（coverage-check）が
// 別ファイルに同じ計算を持つ。ずれると「記録側が書いた指紋を判定側が一致と認めない」
// （またはその逆）が起きるので、実際に記録した値を判定側へ通して往復で固定する。
test("撮影状態の指紋は記録側と判定側で一致する（別実装のずれを固定する）", () => {
  const { coverage, metadata } = fingerprintFixture();

  // 指紋は表の内容から取るので、集合の出所を補うのは行を起こす前（＝記録側に渡す前）にする。
  fillSetProvenance(coverage);
  expand.fillVisualStateRows(coverage);
  assert.exists(
    coverage.visual_state_coverage,
    "fillVisualStateRows が visual_state_coverage を書いていない",
  );
  coverage.visual_state_coverage.rows[0].captured = "フィルタの吹き出しを開いた状態";
  const conditions = expand.readCaptureConditions(metadata);
  expect(conditions).not.toBeNull();
  const result = expand.reconcile(coverage, profiles, conditions);
  expect(result.problems).toEqual([]);
  expand.recordConformance(coverage, result);

  // 記録側が書いた 2 つの指紋を、判定側が自分の計算で一致と認める。
  assert.exists(coverage.conformance, "recordConformance が conformance を書いていない");
  expect(coverage.conformance.visual_states.table_fingerprint).toBe(
    check.coverageFingerprint(coverage),
  );
  expect(coverage.conformance.visual_states.capture_fingerprint).toBe(
    check.readCaptureForFingerprint(metadata),
  );
  expect(
    check.countCoverage(coverage, SLUG, check.readCaptureForFingerprint(metadata)).problems,
  ).toEqual([]);
});
