import { test, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 被覆表の未測定は、記録側（parity-suite の coverage-expand.mjs の reconcile）と
// 判定側（parity-diff の coverage-check.mjs の countCoverage）が独立に数える。
// 配布スキルは成果物を同梱する規約のため共有モジュールにできず、ガードを片方にだけ足すと
// 「記録側は未測定 0 を記録するが判定側は未測定を数える」が起きる（conformance の要約と metadata が
// 未解決領域を過小に見せる）。個別の分岐を後追いする代わりに、同じ入力に両者を当てて件数の関係を固定する。
//
// 関係は 2 種類に限る。
// - eq: 両者が同じ一次情報だけで数える分岐（採点せずに抜ける分岐・セル行の採点）。件数が一致する
// - ge: 記録側だけがプロファイルを読んで展開し直せる分岐。記録側が判定側より多く数えてよいが、少なくはしない
// どちらでも「判定側が未測定を数えるのに記録側が 0 件」は落ちる。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { expandCandidates, loadProfiles, readEnumeration, reconcile } = await import(
  join(repoRoot, "skills/parity-suite/scripts/coverage-expand.mjs")
);
const { countCoverage } = await import(
  join(repoRoot, "skills/parity-diff/scripts/coverage-check.mjs")
);
const { profiles } = loadProfiles(join(repoRoot, "skills/parity-suite/assets/coverage-profiles"));

const SLUG = "order-list";

/** DataGrid の列挙（列 2・メニュー対象 1・メニュー項目 2・条件 1）。 */
function enumeration() {
  const column = (id, filterable) => ({
    id,
    flags: {
      initially_visible: true,
      toggleable: false,
      requires_horizontal_scroll: false,
      filterable,
      sortable: true,
    },
  });
  return {
    source: {
      kind: "current-source",
      ref: "src/grid/orderColumns.ts",
      version: "rev-abc123",
      extracted_at: "2026-09-03T00:00:00Z",
      condition: "columns 配列の全要素",
    },
    complete: true,
    elements: {
      column: [column("price", true), column("name", false)],
      "menu-target": [{ id: "row", flags: { has_context_menu: true } }],
      "menu-item": [
        { id: "copy", flags: { enabled: true } },
        { id: "delete", flags: { enabled: true } },
      ],
      "menu-condition": [{ id: "default", flags: {} }],
    },
  };
}

const presentCell = (component, item, instance) => ({
  component,
  item,
  instance,
  value: "present",
  evidence: "実 UI で操作し DOM 変化で発火を確認した",
  covered_by: [`e2e/${SLUG}.spec.ts > ${item}`],
});

/** プロファイル経路: 全候補を present で埋めた被覆表。 */
function profiled() {
  const profile = profiles.get("datagrid");
  const { elements } = readEnumeration(enumeration(), profile, "t");
  const candidates = expandCandidates(profile, elements);
  return {
    slug: SLUG,
    components: [
      {
        id: "grid",
        profile: "datagrid",
        profile_version: String(profile.version),
        items: candidates.map((c) => ({ id: c.id, candidate: { rule: c.rule, axes: c.axes } })),
        instances: [
          { id: "orders", enumeration: enumeration(), candidates: candidates.map((c) => c.id) },
        ],
      },
    ],
    cells: candidates.map((c) => presentCell("grid", c.id, "orders")),
  };
}

/** 汎用経路（profile: null）: 項目 2 × インスタンス 3 を present で埋めた被覆表。 */
function generic() {
  const items = [{ id: "sort" }, { id: "filter" }];
  const instances = [{ id: "orders" }, { id: "customers" }, { id: "invoices" }];
  return {
    slug: SLUG,
    components: [
      {
        id: "toolbar",
        profile: null,
        profile_absent_reason: "適合する同梱プロファイルが無い",
        items,
        instances,
      },
    ],
    cells: items.flatMap((i) => instances.map((n) => presentCell("toolbar", i.id, n.id))),
  };
}

/** @param {() => any} base @param {(cov: any) => void} mutate */
const variant = (base, mutate) => () => {
  const cov = base();
  mutate(cov);
  return cov;
};
const grid = (cov) => cov.components[0];
const orders = (cov) => cov.components[0].instances[0];

// 状態空間: 部品・インスタンス・項目・候補記録・列挙・セル行それぞれの キーの材料（id）と形の崩れ。
/** @type {Array<[string, "eq" | "ge", () => any]>} */
const CASES = [
  ["汎用: 全セル present", "eq", generic],
  ["プロファイル: 全候補 present", "eq", profiled],
  // 部品単位で採点せずに抜ける分岐（Issue #349 の (1)(2)）
  ["汎用: profile キーが無い", "eq", variant(generic, (c) => delete grid(c).profile)],
  [
    "汎用: profile が文字列でも null でもない",
    "eq",
    variant(generic, (c) => (grid(c).profile = 5)),
  ],
  ["components の要素が文字列", "eq", variant(generic, (c) => c.components.push("toolbar"))],
  ["components の要素が配列", "eq", variant(generic, (c) => c.components.push([]))],
  ["components の要素が null", "eq", variant(generic, (c) => c.components.push(null))],
  ["汎用: 部品 id が空", "eq", variant(generic, (c) => (grid(c).id = ""))],
  ["プロファイル: 部品 id が空", "eq", variant(profiled, (c) => (grid(c).id = ""))],
  [
    "プロファイル: 部品 id が空で列挙が使えない",
    "eq",
    variant(profiled, (c) => {
      grid(c).id = "";
      delete orders(c).enumeration;
    }),
  ],
  [
    "プロファイル: 部品 id が空で候補に無い項目がある",
    "eq",
    variant(profiled, (c) => {
      grid(c).id = "";
      grid(c).items.push({ id: "extra" });
    }),
  ],
  [
    "汎用: 部品 id が重複",
    "eq",
    variant(generic, (c) => c.components.push(structuredClone(grid(c)))),
  ],
  ["汎用: instances が空", "eq", variant(generic, (c) => (grid(c).instances = []))],
  ["汎用: 項目 id が重複", "eq", variant(generic, (c) => grid(c).items.push({ id: "sort" }))],
  ["汎用: 項目が JSON オブジェクトでない", "eq", variant(generic, (c) => grid(c).items.push(1))],
  // インスタンス単位で採点せずに抜ける分岐（同じ故障クラス）
  ["プロファイル: instances が空", "eq", variant(profiled, (c) => (grid(c).instances = []))],
  [
    "プロファイル: インスタンスが JSON オブジェクトでない",
    "eq",
    variant(profiled, (c) => grid(c).instances.push(3)),
  ],
  [
    "プロファイル: インスタンス id が空",
    "eq",
    variant(profiled, (c) => grid(c).instances.push({ enumeration: enumeration() })),
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
    variant(profiled, (c) => delete orders(c).enumeration),
  ],
  [
    "プロファイル: enumeration.complete が true でない",
    "eq",
    variant(profiled, (c) => (orders(c).enumeration.complete = false)),
  ],
  [
    "プロファイル: enumeration.source が無い",
    "eq",
    variant(profiled, (c) => delete orders(c).enumeration.source),
  ],
  // 判定側が数え直しに使う記録（candidates / candidate.axes）の崩れ
  [
    "プロファイル: instances[].candidates が無い",
    "eq",
    variant(profiled, (c) => delete orders(c).candidates),
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
  // 同じ候補が 2 つの経路（候補ループのセル採点と candidates の記録漏れ）で欠けても 1 件に数える
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
      delete orders(c).candidates;
      c.cells.pop();
    }),
  ],
  [
    "プロファイル: 項目の candidate が無い",
    "eq",
    variant(profiled, (c) => delete grid(c).items[0].candidate),
  ],
  ["プロファイル: 候補に対応する項目が無い", "eq", variant(profiled, (c) => grid(c).items.shift())],
  // 候補の記録の不備とセルの不備は別の欠陥。判定側は両方を数えるので、記録側も 1 件に畳まない
  [
    "プロファイル: 項目の candidate とセル行の両方が無い",
    "eq",
    variant(profiled, (c) => {
      delete grid(c).items[0].candidate;
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
      delete grid(c).items[0].candidate;
      c.cells.find((cell) => cell.item === grid(c).items[0].id).value = "unmeasured";
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
      for (const item of grid(c).items) delete item.candidate;
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
];

const counts = (make) => ({
  record: reconcile(make(), profiles).unmeasured,
  judge: countCoverage(make(), SLUG).unmeasured,
});

test.each(CASES)("%s: 記録側の未測定が判定側と %s の関係にある", (_name, relation, make) => {
  const { record, judge } = counts(make);
  if (relation === "eq") expect(record).toBe(judge);
  else expect(record).toBeGreaterThanOrEqual(judge);
});

test("陽性コントロール: 全セルを埋めた被覆表は両者とも未測定 0（常に数える実装を弾く）", () => {
  expect(counts(generic)).toEqual({ record: 0, judge: 0 });
  expect(counts(profiled)).toEqual({ record: 0, judge: 0 });
});

test("陽性コントロール: 変異の入力は判定側で未測定を生む（ge の緩さで素通りさせない）", () => {
  // eq のケースで判定側が 0 件なら「両者とも数えない」でも一致してしまい、何も実証しない。
  // 基準の 2 件を除く全ケースで、少なくとも一方が未測定を数えることを確かめる。
  for (const [name, , make] of CASES.slice(2)) {
    const { record, judge } = counts(make);
    expect(record, name).toBeGreaterThan(0);
    if (CASES.find((c) => c[0] === name)?.[1] === "eq") expect(judge, name).toBeGreaterThan(0);
  }
});

test("Issue #349 の再現表: profile キー欠落（項目 2 × インスタンス 3）は 6 件、非オブジェクト要素は 1 件", () => {
  expect(counts(variant(generic, (c) => delete grid(c).profile))).toEqual({ record: 6, judge: 6 });
  expect(counts(variant(generic, (c) => c.components.push("toolbar")))).toEqual({
    record: 1,
    judge: 1,
  });
});
