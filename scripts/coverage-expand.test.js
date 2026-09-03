// 被覆プロファイル（parity-suite）の候補展開と照合の回帰テスト（Issue #286）。
//
// 塞ぐ穴: 被覆表は登録された項目しか数えないため、データグリッドで代表列だけを操作して
// 2 項目を登録すれば、他の列・非表示列・横スクロール先の列・コンテキストメニューは
// 期待セルにすら現れず、未測定 0 で収束できてしまう。
// 候補集合（列挙した構成要素から機械的に展開されるもの）と被覆集合の差分が残ることを確認する。
//
// 「新しい部品は共通処理と中心ドキュメントを変えずに足せる」ことも、
// 仮想部品のプロファイルを一時ディレクトリへ置いて照合させることで確認する。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/coverage-expand.mjs");
const bundledProfiles = join(repoRoot, "skills/parity-suite/assets/coverage-profiles");
const { expandCandidates, loadProfiles, readEnumeration, reconcile, validateProfile } =
  await import(script);

const { profiles: bundled, problems: bundledProblems } = loadProfiles(bundledProfiles);

test("同梱プロファイルはすべてスキーマ検証を通る（壊れたまま配布しない）", () => {
  expect(bundledProblems).toEqual([]);
  expect(bundled.size).toBeGreaterThanOrEqual(1);
  expect(bundled.has("datagrid")).toBe(true);
});

/** DataGrid の列挙（列 2・メニュー対象 1・メニュー項目 2・条件 1）。 */
function enumeration() {
  return {
    source: {
      kind: "current-source",
      ref: "src/grid/orderColumns.ts",
      version: "rev-abc123",
      extracted_at: "2026-09-03T00:00:00Z",
      condition: "columns 配列の全要素。hidden も含め、横スクロールを右端まで送って確認した",
    },
    complete: true,
    elements: {
      column: [
        {
          id: "price",
          flags: {
            initially_visible: true,
            toggleable: false,
            requires_horizontal_scroll: false,
            filterable: true,
            sortable: true,
          },
        },
        {
          id: "name",
          flags: {
            initially_visible: true,
            toggleable: false,
            requires_horizontal_scroll: false,
            filterable: false,
            sortable: true,
          },
        },
      ],
      "menu-target": [{ id: "row", flags: { has_context_menu: true } }],
      "menu-item": [
        { id: "copy", flags: { enabled: true } },
        { id: "delete", flags: { enabled: true } },
      ],
      "menu-condition": [{ id: "default", flags: {} }],
    },
  };
}

/** 上の列挙から展開される全候補を present で埋めた被覆表。 */
function datagridCoverage() {
  const profile = bundled.get("datagrid");
  const { elements } = readEnumeration(enumeration(), profile, "t");
  const candidates = expandCandidates(profile, elements);
  return {
    slug: "order-list",
    components: [
      {
        id: "grid",
        profile: "datagrid",
        profile_version: "1",
        items: candidates.map((c) => ({
          id: c.id,
          category: c.rule,
          name: c.id,
          candidate: { rule: c.rule, axes: c.axes },
        })),
        instances: [
          {
            id: "orders",
            page: "受注一覧",
            locator: "orders.grid",
            enumeration: enumeration(),
            candidates: candidates.map((c) => c.id),
          },
        ],
      },
    ],
    cells: candidates.map((c) => ({
      component: "grid",
      item: c.id,
      instance: "orders",
      value: "present",
      evidence: "実 UI で操作し DOM 変化で発火を確認した",
      covered_by: [`e2e/order-list.spec.ts > ${c.id}`],
      unmeasured_reason: null,
    })),
  };
}

test("陽性コントロール: 候補が全てセルへ落ちていれば適合（常に落とす実装を弾く）", () => {
  const r = reconcile(datagridCoverage(), bundled);
  expect(r.problems).toEqual([]);
  expect(r.ok).toBe(true);
  // 列 2 の表示 ＋ price のフィルター ＋ 列 2 × 方向 3 のソート ＋ メニュー開閉 1 ＋ メニュー項目 2。
  expect(r.candidates).toBe(12);
  expect(r.unmeasured).toBe(0);
});

test("代表列だけを確認した被覆表は欠落として失敗する", () => {
  const cov = datagridCoverage();
  const c = cov.components[0];
  const keep = (id) => id.includes("/price");
  c.items = c.items.filter((i) => keep(i.id));
  c.instances[0].candidates = c.instances[0].candidates.filter(keep);
  cov.cells = cov.cells.filter((x) => keep(x.item));
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/候補 column-visible\/name に対応する項目が被覆表に無い/);
  expect(r.unmeasured).toBeGreaterThan(0);
});

test("インスタンス id に区切り文字が入ったら、余剰の誤検出ではなく id の問題として落とす", () => {
  // 候補キーは "<インスタンス id>/<候補 id>"。id に "/" が入ると前半と後半を切り分けられず、
  // 余剰判定が全項目を「候補集合に無い」と誤検出して原因の切り分けを誤らせる。
  const cov = datagridCoverage();
  const c = cov.components[0];
  c.instances[0].id = "admin/orders";
  for (const cell of cov.cells) cell.instance = "admin/orders";
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/id admin\/orders に "\/" を含む/);
});

test("インスタンス id の重複は先勝ちにせず問題として残す", () => {
  const cov = datagridCoverage();
  const c = cov.components[0];
  c.instances.push(structuredClone(c.instances[0]));
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/インスタンス id orders が重複している/);
});

test("コンテキストメニューの候補を欠落させた列挙は必須ルールで失敗する", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.elements["menu-item"] = [];
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/必須ルール context-menu-item の候補が 0 件/);
});

test("右クリック対象の列挙が空でもメニュー開閉の必須ルールで失敗する", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.elements["menu-target"] = [];
  const r = reconcile(cov, bundled);
  expect(r.problems.join("\n")).toMatch(/必須ルール context-menu-open の候補が 0 件/);
});

test("列挙した要素がどの候補にも現れなければ失敗する（フラグの記録漏れを落とす）", () => {
  const cov = datagridCoverage();
  const column = cov.components[0].instances[0].enumeration.elements.column[1];
  for (const key of Object.keys(column.flags)) column.flags[key] = false;
  const r = reconcile(cov, bundled);
  expect(r.problems.join("\n")).toMatch(/列挙した column の要素 name がどの候補にも現れない/);
});

test("セルの未測定・証拠なし・対応付けなしは候補由来の期待セルでも同じ規則で落ちる", () => {
  for (const [mutate, pattern] of [
    [(cell) => (cell.value = "unmeasured"), null],
    [(cell) => (cell.evidence = "  "), /evidence が空/],
    [(cell) => (cell.covered_by = []), /covered_by が空/],
  ]) {
    const cov = datagridCoverage();
    mutate(cov.cells[0]);
    const r = reconcile(cov, bundled);
    expect(r.ok).toBe(false);
    expect(r.unmeasured).toBe(1);
    if (pattern) expect(r.problems.join("\n")).toMatch(pattern);
  }
});

test("列挙が未完了なら候補ゼロで素通りせず、理由も必須", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.complete = false;
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(/incomplete_reason が空/);
  cov.components[0].instances[0].enumeration.incomplete_reason =
    "グリッド定義が動的生成で追えない。実 UI から列表示切替を全て開いて列挙する手順が要る";
  const r = reconcile(cov, bundled);
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toMatch(/列挙が未完了/);
});

test("必須ルールの候補ゼロは justified_absences の根拠付きでだけ通す（行き止まりにしない）", () => {
  const cov = datagridCoverage();
  const inst = cov.components[0].instances[0];
  // 右クリックメニューを一切持たないグリッド。列挙は済ませたうえで対象が 0 件。
  for (const axis of ["menu-target", "menu-item", "menu-condition"]) {
    inst.enumeration.elements[axis] = [];
  }
  const keep = (id) => id.startsWith("column-");
  cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
  inst.candidates = inst.candidates.filter(keep);
  cov.cells = cov.cells.filter((c) => keep(c.item));

  // 根拠が無ければ「列挙していない」と区別できないので落とす。
  const bare = reconcile(cov, bundled);
  expect(bare.ok).toBe(false);
  expect(bare.problems.join("\n")).toMatch(/必須ルール context-menu-open の候補が 0 件/);

  // 根拠を書けば通る。フラグを偽って true にする以外の逃げ道が要る。
  inst.enumeration.justified_absences = [
    {
      scope: "menu-target",
      reason:
        "データ行・列ヘッダ・空白領域のいずれで右クリックしてもメニューが出ないことを実 UI で確認した",
    },
  ];
  expect(reconcile(cov, bundled).problems).toEqual([]);

  // 根拠が空なら通さない。
  inst.enumeration.justified_absences = [{ scope: "menu-target", reason: "  " }];
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(/reason が空/);
});

test("要素が候補にならないことも根拠付きでだけ通す（要素スコープの免除）", () => {
  const cov = datagridCoverage();
  const inst = cov.components[0].instances[0];
  const column = inst.enumeration.elements.column[1];
  for (const key of Object.keys(column.flags)) column.flags[key] = false;
  const keep = (id) => !id.includes("/name");
  cov.components[0].items = cov.components[0].items.filter((i) => keep(i.id));
  inst.candidates = inst.candidates.filter(keep);
  cov.cells = cov.cells.filter((c) => keep(c.item));
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(/要素 name がどの候補にも現れない/);
  inst.enumeration.justified_absences = [
    {
      scope: "column/name",
      reason: "定義に在るが表示・操作のいずれも有効でないことを実 UI で確認した",
    },
  ];
  expect(reconcile(cov, bundled).problems).toEqual([]);
});

test("使われない justified_absences は残さない（古い免除が効いて見える状態を作らない）", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.justified_absences = [
    { scope: "column/price", reason: "もう成り立たない根拠" },
  ];
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(
    /justified_absences の column\/price は効いていない/,
  );
});

test("軸に要素が在るのに軸ごとの免除は使えない（要素ごとの根拠を要求する）", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.justified_absences = [
    { scope: "column", reason: "列は見ない" },
  ];
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(
    /軸ごとの免除は使えない（要素ごとの scope にする）/,
  );
});

test("列挙できないインスタンスがあるとき余剰は判定しない（本当の原因を覆い隠さない）", () => {
  const cov = datagridCoverage();
  cov.components[0].instances[0].enumeration.complete = false;
  cov.components[0].instances[0].enumeration.incomplete_reason = "列定義が動的生成で追えない";
  const joined = reconcile(cov, bundled).problems.join("\n");
  expect(joined).toMatch(/列挙が未完了/);
  expect(joined).not.toMatch(/余剰/);
});

test("来歴（enumeration.source）の欠落は失敗させる", () => {
  const cov = datagridCoverage();
  delete cov.components[0].instances[0].enumeration.source.condition;
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(/source.condition が空/);
});

test("profile キーの欠落は暗黙の汎用扱いにせず失敗させる", () => {
  const cov = datagridCoverage();
  delete cov.components[0].profile;
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(/profile キーが無い/);
});

test("適合プロファイルが無い部品は理由付きで未検証として記録される", () => {
  const withReason = {
    slug: "order-list",
    components: [
      {
        id: "chart",
        profile: null,
        profile_absent_reason: "Chart のプロファイルが未整備。gaps.md の未検証領域に記録した",
        items: [],
        instances: [],
      },
    ],
    cells: [],
  };
  const ok = reconcile(withReason, bundled);
  expect(ok.problems).toEqual([]);
  expect(ok.components[0]).toMatchObject({ component: "chart", profile: null, judged: false });
  // 理由が無ければ免除しない。
  const noReason = structuredClone(withReason);
  delete noReason.components[0].profile_absent_reason;
  expect(reconcile(noReason, bundled).problems.join("\n")).toMatch(/profile_absent_reason が空/);
});

test("同値クラス: 束ねてよい軸・全候補の所属・根拠を検査する", () => {
  const cov = datagridCoverage();
  const ids = cov.components[0].instances[0].candidates;
  const key = (id) => `orders/${id}`;
  // 束ねてはいけない軸（sort-direction）で束ねる。
  cov.components[0].equivalence_classes = [
    {
      id: "sort",
      axis: "sort-direction",
      rationale: "方向は同じ描画",
      members: [key("column-sort/price/asc"), key("column-sort/price/desc")],
      representative: key("column-sort/price/asc"),
    },
  ];
  const bad = reconcile(cov, bundled);
  expect(bad.problems.join("\n")).toMatch(/軸 sort-direction は reducible_axes にない/);
  expect(bad.problems.join("\n")).toMatch(/がどの同値クラスにも属していない/);

  // 陽性コントロール: 列軸で束ね、全候補を過不足なく分類すれば通る。
  cov.components[0].equivalence_classes = ids.map((id) => ({
    id: `c-${id}`,
    axis: "column",
    rationale: "現行 UI で同じセルレンダラ・同じ書式であることを確認した",
    members: [key(id)],
    representative: key(id),
  }));
  expect(reconcile(cov, bundled).problems).toEqual([]);
});

test("同値クラスは宣言した軸以外で束ねられない", () => {
  const cov = datagridCoverage();
  const key = (id) => `orders/${id}`;
  cov.components[0].equivalence_classes = [
    {
      id: "mixed",
      axis: "column",
      rationale: "同じ書式",
      // column 軸だけでなく sort-direction も違うメンバーを混ぜる。
      members: [key("column-sort/price/asc"), key("column-sort/name/desc")],
      representative: key("column-sort/price/asc"),
    },
  ];
  expect(reconcile(cov, bundled).problems.join("\n")).toMatch(
    /軸 column 以外（sort-direction）でも束ねている/,
  );
});

test("プロファイルの形式検査: 誤記したフラグ・未定義の軸・区切り文字を弾く", () => {
  const base = {
    id: "x",
    version: "1",
    applies_to: "テスト用",
    axes: [{ id: "a", kind: "element", flags: ["on"] }],
    candidate_rules: [{ id: "r", axes: ["a"], guard: { "a.on": true } }],
    required_rules: ["r"],
    equivalence: { reducible_axes: ["a"] },
  };
  expect(validateProfile(base, "x.json")).toEqual([]);
  const typo = structuredClone(base);
  typo.candidate_rules[0].guard = { "a.onn": true };
  // 誤記したフラグ名は「該当なし」＝候補ゼロで静かに通るため、形式検査で落とす。
  expect(validateProfile(typo, "x.json").join("\n")).toMatch(/宣言の無いフラグ onn/);
  const unknownAxis = structuredClone(base);
  unknownAxis.candidate_rules[0].axes = ["nope"];
  expect(validateProfile(unknownAxis, "x.json").join("\n")).toMatch(/未定義の軸 nope/);
  const separator = structuredClone(base);
  separator.axes.push({ id: "b", kind: "enum", values: ["a/b"] });
  expect(validateProfile(separator, "x.json").join("\n")).toMatch(/候補 id が衝突する/);
});

/**
 * 一時ディレクトリにプロファイルと被覆表を書いて CLI を実行する。
 * プロファイルディレクトリ（@profiles）と成果物ディレクトリを分ける——同じにすると
 * 被覆表がプロファイルとして読み込まれ、検証したい経路と別の理由で落ちる。
 */
function runCli(args, { profiles = {}, files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "coverage-expand-"));
  const profilesDir = join(root, "profiles");
  mkdirSync(profilesDir);
  const write = (dir, name, content) => {
    const path = join(dir, name);
    writeFileSync(
      path,
      typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    );
    return path;
  };
  for (const [name, content] of Object.entries(profiles)) write(profilesDir, name, content);
  /** @type {Record<string, string>} */
  const paths = {};
  for (const [name, content] of Object.entries(files)) paths[name] = write(root, name, content);
  const resolved = args.map((a) => paths[a] ?? (a === "@profiles" ? profilesDir : a));
  return {
    root,
    paths,
    ...spawnSync(process.execPath, [script, ...resolved], { encoding: "utf8" }),
  };
}

test("新しい仮想部品のプロファイルを、共通処理と中心ドキュメントを変えずに追加できる", () => {
  // DataGrid に一切似ていない仮想部品（ノードと展開状態を軸に持つツリー）。
  // coverage-expand.mjs にも references/coverage-profiles.md にも手を入れていない。
  const treeview = {
    id: "treeview",
    version: "1",
    name: "ツリービュー",
    applies_to: "ノードごとに展開可否と選択可否が設定される階層表示部品",
    axes: [
      { id: "node", kind: "element", name: "ノード", flags: ["expandable", "selectable"] },
      { id: "state", kind: "enum", name: "展開状態", values: ["collapsed", "expanded"] },
    ],
    enumeration: {
      sources: ["current-source", "app-ui"],
      procedure: "ツリー定義のノード配列を読む",
      pitfalls: ["折りたたまれた子ノードを列挙から落とす"],
      fail_closed: "読めなければ complete: false ＋ incomplete_reason",
    },
    candidate_rules: [
      {
        id: "node-expand",
        name: "展開",
        axes: ["node", "state"],
        guard: { "node.expandable": true },
      },
      { id: "node-select", name: "選択", axes: ["node"], guard: { "node.selectable": true } },
    ],
    required_rules: ["node-select"],
    equivalence: { reducible_axes: ["node"], constraints: ["同じ深さのノードだけ束ねる"] },
  };
  const nodeEnum = {
    source: {
      kind: "current-source",
      ref: "src/tree/nodes.ts",
      version: "rev-1",
      extracted_at: "2026-09-03T00:00:00Z",
      condition: "nodes 配列の全要素。折りたたみ済みの子も辿った",
    },
    complete: true,
    elements: {
      node: [
        { id: "root", flags: { expandable: true, selectable: true } },
        { id: "leaf", flags: { expandable: false, selectable: true } },
      ],
    },
  };
  const candidates = [
    "node-expand/root/collapsed",
    "node-expand/root/expanded",
    "node-select/root",
    "node-select/leaf",
  ];
  const coverage = {
    slug: "org-tree",
    components: [
      {
        id: "tree",
        profile: "treeview",
        profile_version: "1",
        items: candidates.map((id) => ({
          id,
          candidate: {
            rule: id.split("/")[0],
            axes: id.startsWith("node-expand")
              ? { node: id.split("/")[1], state: id.split("/")[2] }
              : { node: id.split("/")[1] },
          },
        })),
        instances: [
          { id: "org", page: "組織", locator: "org.tree", enumeration: nodeEnum, candidates },
        ],
      },
    ],
    cells: candidates.map((id) => ({
      component: "tree",
      item: id,
      instance: "org",
      value: "present",
      evidence: "実 UI で操作し DOM 変化を確認",
      covered_by: [`e2e/org.spec.ts > ${id}`],
    })),
  };
  const ok = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    profiles: { "treeview.json": treeview },
    files: { "component-coverage.json": coverage },
  });
  expect(ok.stderr).toBe("");
  expect(ok.status).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, candidates: 4, unmeasured: 0 });

  // 陰性コントロール: 同じ仮想部品でノードを 1 つ落とすと失敗する（常に通す実装を弾く）。
  const short = structuredClone(coverage);
  short.components[0].items = short.components[0].items.filter((i) => i.id !== "node-select/leaf");
  short.components[0].instances[0].candidates = candidates.filter((i) => i !== "node-select/leaf");
  short.cells = short.cells.filter((c) => c.item !== "node-select/leaf");
  const bad = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    profiles: { "treeview.json": treeview },
    files: { "component-coverage.json": short },
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/候補 node-select\/leaf に対応する項目が被覆表に無い/);
});

test("壊れたプロファイルを静かに無視せず exit 2 で落ちる（候補ゼロで素通りさせない）", () => {
  const r = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    profiles: { "broken.json": "{ not json" },
    files: { "component-coverage.json": datagridCoverage() },
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/JSON として読めない/);
});

test("プロファイルが 1 件も読めない場合も合格に倒さない", () => {
  const r = runCli(["--profiles", "@profiles", "--coverage", "component-coverage.json"], {
    files: { "component-coverage.json": datagridCoverage() },
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/プロファイルが 1 件も読み込めなかった/);
});

test("CLI --write は candidates と conformance を書き戻す（測定値には触れない）", () => {
  const cov = datagridCoverage();
  // 書き戻し前は candidates を持たない状態にしておく。
  delete cov.components[0].instances[0].candidates;
  const r = runCli(
    ["--coverage", "component-coverage.json", "--write", "--profiles", bundledProfiles],
    {
      files: { "component-coverage.json": cov },
    },
  );
  expect(r.status).toBe(0);
  const written = JSON.parse(readFileSync(r.paths["component-coverage.json"], "utf8"));
  expect(written.components[0].instances[0].candidates).toHaveLength(12);
  expect(written.conformance).toMatchObject({ tool: "coverage-expand", ok: true, unmeasured: 0 });
  // 測定値は書き換えない。
  expect(written.cells[0]).toMatchObject({ value: "present" });
});

test("CLI: 引数不足・重複指定は exit 2", () => {
  expect(spawnSync(process.execPath, [script], { encoding: "utf8" }).status).toBe(2);
  const dup = runCli(
    ["--coverage", "component-coverage.json", "--coverage", "component-coverage.json"],
    {
      files: { "component-coverage.json": datagridCoverage() },
    },
  );
  expect(dup.status).toBe(2);
  expect(dup.stderr).toMatch(/複数回指定/);
});

test("CLI --list-profiles は同梱プロファイルを列挙する", () => {
  const r = spawnSync(process.execPath, [script, "--list-profiles"], { encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).profiles.map((p) => p.id)).toContain("datagrid");
});
