// parity-suite の部品改修の影響判定（component-impact.mjs）の回帰テスト（Issue #454）。
//
// 共通部品を 1 行直すと全ページの証跡が古くなる。変更宣言から撮り直すべき組だけを導き、
// 影響しない機能は理由付きで外す。判定は fail-closed で、判定できない入力を「影響なし」に倒さない。
//
// fixture は同梱テンプレート（parity-component / parity-suite の assets/metadata-template.json、
// parity-component の assets/component-change-template.json）を読んで値だけ埋める。
// 判定に要る列だけの切り詰めた形にすると、実装が別の列を読み始めたときに実在しない形を固定する。
// 「落とす入力」と「通す入力」を両側に置く（片側だけでは常に落とす／常に通す実装と区別できない）。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import {
  main,
  computeImpact,
  validateChange,
  VERSION,
} from "../skills/parity-suite/scripts/component-impact.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** @param {string} path */
const readTemplate = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const changeTemplate = readTemplate(
  "skills/parity-component/assets/component-change-template.json",
);
const componentTemplate = readTemplate("skills/parity-component/assets/metadata-template.json");
const featureTemplate = readTemplate("skills/parity-suite/assets/metadata-template.json");

/**
 * 変更宣言。雛形の全キーを埋めた形に、差し替えたい値だけ上書きする。
 * 部品 button の hover の影を、list ページのインスタンス pager-next に対して現行へ合わせ直した改修。
 * @param {Record<string, unknown>} [override]
 */
function changeOf(override = {}) {
  const change = structuredClone(changeTemplate);
  delete change._note;
  Object.assign(change, {
    id: "hover-shadow",
    slug: "button",
    kind: "align-to-current",
    reason: "hover の外周の影を現行に合わせた",
    instances: ["pager-next"],
    variants: ["fill-orange"],
    states: ["hover"],
    properties: ["box-shadow"],
    usages: ["/orders"],
    usages_source: "grep -rl 'components/Button' src/pages",
    files: ["src/components/Button.tsx"],
    commits: { before: "a1b2c3d", after: "e4f5a6b" },
    margin_px: 4,
    cross_measurement: {
      record: ".replace/components/button/cross.json",
      instances: 2,
      states: ["hover"],
    },
    catalog_verification: {
      record: ".replace/components/button/parity.md#hover-shadow",
      outside_scope_identical: true,
      inside_matches_current: true,
    },
    ...override,
  });
  return change;
}

/**
 * 部品 metadata。instances[] は雛形の要素を複製して id / page / locator だけ埋める。
 * @param {{id:string, page:string, locator:string}[]} [instances]
 */
function componentOf(
  instances = [
    { id: "pager-next", page: "/orders", locator: "button: 次へ" },
    { id: "search-submit", page: "/search", locator: "button: 検索" },
  ],
) {
  const metadata = structuredClone(componentTemplate);
  metadata.slug = "button";
  const shape = metadata.instances[0];
  metadata.instances = instances.map((instance) => ({ ...structuredClone(shape), ...instance }));
  // 部品が採った状態の語彙（変更宣言の states はこの中から書く）
  metadata.capture.states = ["default", "hover"];
  return metadata;
}

/**
 * 機能の metadata。capture_scope[] は雛形の要素を複製して page / state / viewport だけ埋める。
 * @param {{ pages?: {name:string, path:string}[], scope?: [string, string, string][], mode?: string }} [options]
 */
function featureOf(options = {}) {
  const metadata = structuredClone(featureTemplate);
  metadata.mode = options.mode ?? "feature";
  const conditions = metadata.capture_conditions;
  const pageShape = conditions.pages[0];
  conditions.pages = (options.pages ?? [{ name: "list", path: "/orders" }]).map((page) => ({
    ...structuredClone(pageShape),
    ...page,
  }));
  conditions.states = ["default", "hover"];
  const scopeShape = conditions.capture_scope[0];
  conditions.capture_scope = (
    options.scope ?? [
      ["list", "default", "desktop"],
      ["list", "hover", "desktop"],
      ["list", "hover", "mobile"],
    ]
  ).map(([page, state, viewport]) => ({ ...structuredClone(scopeShape), page, state, viewport }));
  return metadata;
}

/**
 * computeImpact を 1 機能で回して、その機能の結果を返す。
 * @param {unknown} metadata
 * @param {{ change?: unknown, component?: unknown }} [inputs]
 */
function judgeOne(metadata, inputs = {}) {
  const result = computeImpact({
    change: inputs.change ?? changeOf(),
    componentMetadata: inputs.component ?? componentOf(),
    features: [{ slug: "orders", metadata }],
  });
  return result.features[0];
}

/**
 * main をメモリ上のファイルで回す。files のキーは /w 起点の絶対パス。
 * @param {string[]} argv
 * @param {Record<string, string>} files
 */
function run(argv, files) {
  let output = "";
  let errors = "";
  /** @type {Record<string, string>} */
  const written = {};
  const dirs = new Set(["/w"]);
  for (const path of Object.keys(files)) {
    let dir = dirname(path);
    while (dir !== "/" && !dirs.has(dir)) {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }
  const code = main(argv, {
    cwd: "/w",
    readFile: (path) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path];
    },
    readdir: (path) =>
      [...dirs, ...Object.keys(files)]
        .filter((p) => dirname(p) === path && p !== path)
        .map((p) => p.slice(path.length + 1)),
    isDirectory: (path) => dirs.has(path),
    exists: (path) => path in files || dirs.has(path),
    writeFile: (path, s) => {
      written[path] = s;
    },
    write: (s) => {
      output += s;
    },
    writeErr: (s) => {
      errors += s;
    },
  });
  return { code, result: output === "" ? null : JSON.parse(output), errors, written };
}

const baseArgs = [
  "--change",
  "c.json",
  "--component-metadata",
  "comp.json",
  "--parity-root",
  "parity",
];

/**
 * CLI 入力の既定セット（機能 orders と search）。
 * @param {Record<string, unknown>} [override]
 */
function filesOf(override = {}) {
  return {
    "/w/c.json": JSON.stringify(changeOf()),
    "/w/comp.json": JSON.stringify(componentOf()),
    "/w/parity/orders/metadata.json": JSON.stringify(featureOf()),
    "/w/parity/search/metadata.json": JSON.stringify(
      featureOf({
        pages: [{ name: "search", path: "/search" }],
        scope: [["search", "default", "desktop"]],
      }),
    ),
    ...override,
  };
}

test("VERSION は文字列", () => {
  expect(typeof VERSION).toBe("string");
});

test("陰性コントロール: 雛形を埋めた変更宣言は型検査を通る（常に落とす実装ではない）", () => {
  expect(validateChange(changeOf())).toEqual([]);
});

test("同梱の雛形そのまま（プレースホルダ）は型検査で落ちる", () => {
  const errors = validateChange(changeTemplate);
  expect(errors.some((e) => e.includes("プレースホルダ"))).toBe(true);
  expect(errors.some((e) => e.startsWith("kind"))).toBe(true);
  expect(errors.some((e) => e.startsWith("margin_px"))).toBe(true);
  expect(errors.some((e) => e.startsWith("commits.before"))).toBe(true);
});

test("インスタンスのページに一致: 宣言した状態の組だけが影響する組（領域が分かる）", () => {
  const feature = judgeOne(featureOf());
  expect(feature.verdict).toBe("affected");
  expect(feature.pairs).toEqual([
    {
      pair: "list|hover|desktop",
      page: "list",
      state: "hover",
      viewport: "desktop",
      instances: [{ id: "pager-next", locator: "button: 次へ" }],
      region_known: true,
    },
    {
      pair: "list|hover|mobile",
      page: "list",
      state: "hover",
      viewport: "mobile",
      instances: [{ id: "pager-next", locator: "button: 次へ" }],
      region_known: true,
    },
  ]);
  // default は宣言した状態ではないので組に入らない。
  expect(feature.pairs.map((p) => p.state)).not.toContain("default");
});

test("usages にだけあるページ: 影響する組だが領域は分からない（instances 空・region_known false）", () => {
  const feature = judgeOne(
    featureOf({
      pages: [{ name: "detail", path: "/orders/detail" }],
      scope: [
        ["detail", "hover", "desktop"],
        ["detail", "default", "desktop"],
      ],
    }),
    { change: changeOf({ usages: ["/orders", "/orders/detail"] }) },
  );
  expect(feature.verdict).toBe("affected");
  expect(feature.pairs).toEqual([
    {
      pair: "detail|hover|desktop",
      page: "detail",
      state: "hover",
      viewport: "desktop",
      instances: [],
      region_known: false,
    },
  ]);
  expect(feature.reasons.some((r) => r.includes("usages にあるが影響インスタンスが無い"))).toBe(
    true,
  );
});

test("インスタンスのページでも usages でもないページ: 影響なし・理由付き", () => {
  const feature = judgeOne(
    featureOf({
      pages: [{ name: "admin", path: "/admin" }],
      scope: [["admin", "hover", "desktop"]],
    }),
  );
  expect(feature.verdict).toBe("unaffected");
  expect(feature.pairs).toEqual([]);
  expect(feature.reasons).toEqual([
    "ページ admin（/admin）は影響インスタンスのページでも usages でもない（path は完全一致で照合）",
  ]);
});

test("部品を使うが宣言した状態を撮っていない: 影響なし・理由付き", () => {
  const feature = judgeOne(
    featureOf({
      pages: [{ name: "detail", path: "/orders/detail" }],
      scope: [["detail", "default", "desktop"]],
    }),
    { change: changeOf({ usages: ["/orders", "/orders/detail"] }) },
  );
  expect(feature.verdict).toBe("unaffected");
  expect(feature.reasons).toEqual([
    "ページ detail（/orders/detail）は部品を使うが、宣言した状態（hover）を撮っていない",
  ]);
});

test("path は完全一致: 末尾スラッシュが違えば一致しない（正規化しない仕様を固定する）", () => {
  // 部品の page は /orders、機能の path は /orders/。usages にも無い → 影響なし。
  const feature = judgeOne(
    featureOf({
      pages: [{ name: "list", path: "/orders/" }],
      scope: [["list", "hover", "desktop"]],
    }),
    { change: changeOf({ usages: ["/orders/detail"] }) },
  );
  expect(feature.verdict).toBe("unaffected");
  expect(feature.reasons[0]).toContain("path は完全一致");
  // 一致しなかったインスタンスは判定に使わず一覧で見せる。
  const result = computeImpact({
    change: changeOf({ usages: ["/orders/detail"] }),
    componentMetadata: componentOf(),
    features: [
      {
        slug: "orders",
        metadata: featureOf({
          pages: [{ name: "list", path: "/orders/" }],
          scope: [["list", "hover", "desktop"]],
        }),
      },
    ],
  });
  // 対象は変更宣言の instances だけ（search-submit は宣言外なので載らない）。
  expect(result.unmatched_instances).toEqual([{ id: "pager-next", page: "/orders" }]);
});

test.each([
  ["http の絶対 URL", "http://current.example.test/orders"],
  ["https の絶対 URL", "https://current.example.test/orders?tab=1#top"],
  ["プロトコル相対の URL", "//current.example.test/orders"],
])("部品の page が%s: 語彙を橋渡しせず、全機能を判定不能にする", (_label, page) => {
  const component = componentOf([{ id: "pager-next", page, locator: "button: 次へ" }]);
  const result = computeImpact({
    change: changeOf({ usages: [] }),
    componentMetadata: component,
    features: [{ slug: "orders", metadata: featureOf() }],
  });
  expect(result.features.every((f) => f.verdict === "undeterminable")).toBe(true);
  expect(result.features[0].reasons.join("\n")).toContain("相対パスで書く");
});

test("どの機能のページとも一致しないインスタンスは findings に載り、機能の verdict は変えない", () => {
  // baseURL のパス接頭辞（/app）を含めて書いたパス。機能の /orders と一致しない。
  const component = componentOf([
    { id: "pager-next", page: "/app/orders", locator: "button: 次へ" },
  ]);
  const result = computeImpact({
    change: changeOf({ usages: [] }),
    componentMetadata: component,
    features: [{ slug: "orders", metadata: featureOf() }],
  });
  expect(result.features[0].verdict).toBe("unaffected");
  expect(result.unmatched_instances).toEqual([{ id: "pager-next", page: "/app/orders" }]);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]).toContain("pager-next");
});

test("CLI: 部品の page が絶対 URL なら入力の誤りとして exit 2", () => {
  const component = componentOf([
    { id: "pager-next", page: "http://current.example.test/orders", locator: "button: 次へ" },
  ]);
  const { code } = run(baseArgs, filesOf({ "/w/comp.json": JSON.stringify(component) }));
  expect(code).toBe(2);
});

test("CLI: どの機能のページとも一致しない影響インスタンスがあれば exit 1（影響なしに倒さない）", () => {
  const component = componentOf([
    { id: "pager-next", page: "/app/orders", locator: "button: 次へ" },
  ]);
  const { code, result } = run(
    baseArgs,
    filesOf({
      "/w/comp.json": JSON.stringify(component),
      // usages は機能 search のページと一致させ、一致しないのはインスタンスだけにする（usages の検査と区別する）
      "/w/c.json": JSON.stringify(changeOf({ usages: ["/search"] })),
    }),
  );
  expect(code).toBe(1);
  expect(result.features.every((f) => f.verdict === "unaffected")).toBe(true);
  expect(result.unmatched_instances).toEqual([{ id: "pager-next", page: "/app/orders" }]);
});

test("CLI: --feature で絞っても、他の機能のページにあるインスタンスは一致しないに数えない", () => {
  // pager-next は orders のページ。search に絞った実行でも exit 0。
  const { code, result } = run([...baseArgs, "--feature", "search"], filesOf());
  expect(code).toBe(0);
  expect(result.unmatched_instances).toEqual([]);
});

test("path は完全一致: 前後の空白も正規化しない", () => {
  const feature = judgeOne(
    featureOf({
      pages: [{ name: "list", path: " /orders" }],
      scope: [["list", "hover", "desktop"]],
    }),
    { change: changeOf({ usages: ["/orders/detail"] }) },
  );
  expect(feature.verdict).toBe("unaffected");
});

test.each([
  ["capture_scope が無い", (m) => delete m.capture_conditions.capture_scope],
  ["capture_scope が配列でない", (m) => (m.capture_conditions.capture_scope = { page: "list" })],
  ["capture_conditions が無い", (m) => delete m.capture_conditions],
  ["pages が無い", (m) => delete m.capture_conditions.pages],
  [
    "pages の path が雛形のまま",
    (m) => (m.capture_conditions.pages[0].path = "<baseURL からの相対パス>"),
  ],
  [
    "pages に同じ name が 2 つ",
    (m) => m.capture_conditions.pages.push({ name: "list", path: "/x" }),
  ],
  ["capture_scope の state が欠落", (m) => delete m.capture_conditions.capture_scope[0].state],
  [
    "capture_scope のページが pages に無い",
    (m) => (m.capture_conditions.capture_scope[0].page = "ghost"),
  ],
  ["mode が読めない", (m) => (m.mode = "<feature | api-resource | batch>")],
])("判定不能（影響なしに倒さない）: %s", (_label, mutate) => {
  const metadata = featureOf();
  mutate(metadata);
  const feature = judgeOne(metadata);
  expect(feature.verdict).toBe("undeterminable");
  expect(feature.pairs).toEqual([]);
  expect(feature.reasons.length).toBeGreaterThan(0);
});

test("同梱の機能 metadata の雛形そのまま（capture_scope がプレースホルダ）は判定不能", () => {
  const metadata = structuredClone(featureTemplate);
  metadata.mode = "feature";
  expect(judgeOne(metadata).verdict).toBe("undeterminable");
});

test("mode が api-resource / batch の機能は影響なし（視覚採取物を持たない）", () => {
  for (const mode of ["api-resource", "batch"]) {
    const metadata = featureOf({ mode });
    delete metadata.capture_conditions;
    const feature = judgeOne(metadata);
    expect(feature.verdict).toBe("unaffected");
    expect(feature.reasons[0]).toContain(mode);
  }
});

test("部品 metadata で引けないインスタンス id: 全機能が判定不能", () => {
  const result = computeImpact({
    change: changeOf({ instances: ["pager-next", "ghost"] }),
    componentMetadata: componentOf(),
    features: [
      { slug: "orders", metadata: featureOf() },
      {
        slug: "admin",
        metadata: featureOf({
          pages: [{ name: "admin", path: "/admin" }],
          scope: [["admin", "hover", "desktop"]],
        }),
      },
    ],
  });
  expect(result.features.map((f) => f.verdict)).toEqual(["undeterminable", "undeterminable"]);
  expect(result.findings[0]).toContain("ghost");
});

test("部品 metadata で同じ id が 2 つ: 判定不能", () => {
  const component = componentOf([
    { id: "pager-next", page: "/orders", locator: "a" },
    { id: "pager-next", page: "/admin", locator: "b" },
  ]);
  expect(judgeOne(featureOf(), { component }).verdict).toBe("undeterminable");
});

test("複数機能: 機能ごとに判定し slug 順に並べる", () => {
  const features = [
    {
      slug: "search",
      metadata: featureOf({
        pages: [{ name: "search", path: "/search" }],
        scope: [["search", "hover", "desktop"]],
      }),
    },
    {
      slug: "admin",
      metadata: featureOf({
        pages: [{ name: "admin", path: "/admin" }],
        scope: [["admin", "hover", "desktop"]],
      }),
    },
    { slug: "orders", metadata: featureOf() },
  ];
  // search-submit（/search）は変更宣言の instances に無く、/search は usages にも無い。
  const narrow = computeImpact({ change: changeOf(), componentMetadata: componentOf(), features });
  expect(narrow.features.map((f) => [f.feature, f.verdict])).toEqual([
    ["admin", "unaffected"],
    ["orders", "affected"],
    ["search", "unaffected"],
  ]);
  expect(narrow.change_id).toBe("hover-shadow");
  expect(narrow.slug).toBe("button");
  // search-submit も宣言すれば search も影響する組を持つ。
  const wide = computeImpact({
    change: changeOf({ instances: ["pager-next", "search-submit"] }),
    componentMetadata: componentOf(),
    features,
  });
  expect(wide.features.map((f) => [f.feature, f.verdict])).toEqual([
    ["admin", "unaffected"],
    ["orders", "affected"],
    ["search", "affected"],
  ]);
  expect(wide.features[2].pairs[0].instances).toEqual([
    { id: "search-submit", locator: "button: 検索" },
  ]);
});

test.each([
  ["kind が語彙外", { kind: "fix" }, "kind"],
  ["id が欠落", { id: undefined }, "id"],
  ["states が空", { states: [] }, "states"],
  ["states が配列でない", { states: "hover" }, "states"],
  ["instances も usages も空", { instances: [], usages: [] }, "instances も usages も空"],
  ["usages がプレースホルダ", { usages: ["<新側でこの部品を使うページのパス>"] }, "usages[0]"],
  [
    "commits.after が SHA でない",
    { commits: { before: "a1b2c3d", after: "HEAD" } },
    "commits.after",
  ],
  ["margin_px が文字列", { margin_px: "4" }, "margin_px"],
  ["files が空", { files: [] }, "files"],
  [
    "catalog_verification の真偽値が文字列",
    {
      catalog_verification: {
        record: "r",
        outside_scope_identical: "true",
        inside_matches_current: true,
      },
    },
    "catalog_verification.outside_scope_identical",
  ],
])("変更宣言の型崩れは exit 2: %s", (_label, override, needle) => {
  const change = changeOf(override);
  expect(validateChange(change).some((e) => e.includes(needle))).toBe(true);
  expect(() => computeImpact({ change, componentMetadata: componentOf(), features: [] })).toThrow(
    /変更宣言が不正/,
  );
  const { code, errors, result } = run(baseArgs, filesOf({ "/w/c.json": JSON.stringify(change) }));
  expect(code).toBe(2);
  expect(result).toBeNull();
  expect(errors).toContain(needle);
});

test("陰性コントロール: instances が空でも usages があれば宣言できる", () => {
  expect(validateChange(changeOf({ instances: [] }))).toEqual([]);
  expect(validateChange(changeOf({ usages: [] }))).toEqual([]);
});

test("CLI: 全機能を判定できれば exit 0、出力形状", () => {
  const { code, result } = run(baseArgs, filesOf());
  expect(code).toBe(0);
  expect(result.tool).toBe("component-impact");
  expect(result.version).toBe(VERSION);
  expect(result.features.map((f) => [f.feature, f.verdict])).toEqual([
    ["orders", "affected"],
    ["search", "unaffected"],
  ]);
});

test("CLI: 判定不能が 1 件でもあれば exit 1", () => {
  const broken = featureOf();
  delete broken.capture_conditions.capture_scope;
  const { code, result } = run(
    baseArgs,
    filesOf({ "/w/parity/search/metadata.json": JSON.stringify(broken) }),
  );
  expect(code).toBe(1);
  expect(result.features.find((f) => f.feature === "search").verdict).toBe("undeterminable");
});

test("CLI: metadata.json の無い機能ディレクトリは判定不能（exit 1）", () => {
  const files = filesOf();
  const { code, result } = run(baseArgs, { ...files, "/w/parity/draft/notes.md": "" });
  expect(code).toBe(1);
  const draft = result.features.find((f) => f.feature === "draft");
  expect(draft.verdict).toBe("undeterminable");
  expect(draft.reasons[0]).toContain("metadata.json が無い");
});

test("CLI: 引けないインスタンス id は exit 1（使い方の誤りではなく判定不能）", () => {
  const { code, result } = run(
    baseArgs,
    filesOf({ "/w/c.json": JSON.stringify(changeOf({ instances: ["ghost"] })) }),
  );
  expect(code).toBe(1);
  expect(result.features.every((f) => f.verdict === "undeterminable")).toBe(true);
});

test("CLI: --feature で 1 機能に絞る", () => {
  const { code, result } = run([...baseArgs, "--feature", "search"], filesOf());
  expect(code).toBe(0);
  expect(result.features.map((f) => f.feature)).toEqual(["search"]);
});

test("CLI: --feature のディレクトリが無ければ exit 2", () => {
  const { code, errors } = run([...baseArgs, "--feature", "ghost"], filesOf());
  expect(code).toBe(2);
  expect(errors).toContain("--feature ghost");
});

test("CLI: 機能 0 件は exit 2（全部影響なしに倒さない）", () => {
  const files = filesOf();
  delete files["/w/parity/orders/metadata.json"];
  delete files["/w/parity/search/metadata.json"];
  files["/w/parity/README.md"] = "";
  const { code, errors } = run(baseArgs, files);
  expect(code).toBe(2);
  expect(errors).toContain("1 つも無い");
});

test("CLI: --out に書き、stdout には出さない", () => {
  const { code, result, written } = run([...baseArgs, "--out", "impact.json"], filesOf());
  expect(code).toBe(0);
  expect(result).toBeNull();
  expect(JSON.parse(written["/w/impact.json"]).features).toHaveLength(2);
});

test.each([
  [
    "必須引数の欠落",
    ["--change", "c.json", "--parity-root", "parity"],
    "--component-metadata は必須",
  ],
  ["不明な引数", [...baseArgs, "--verbose", "x"], "不明な引数"],
  ["値の無い引数", [...baseArgs, "--feature"], "--feature に値がない"],
  ["引数の重複", [...baseArgs, "--change", "c.json"], "--change が複数ある"],
])("CLI: 使い方の誤りは exit 2: %s", (_label, argv, needle) => {
  const { code, errors } = run(argv, filesOf());
  expect(code).toBe(2);
  expect(errors).toContain(needle);
});

test("CLI: 読めない JSON は exit 2", () => {
  const { code, errors } = run(baseArgs, filesOf({ "/w/parity/orders/metadata.json": "{" }));
  expect(code).toBe(2);
  expect(errors).toContain("parity/orders/metadata.json を読めない");
});

test("CLI: 部品 metadata の slug が変更宣言と違えば exit 2", () => {
  const component = componentOf();
  component.slug = "checkbox";
  const { code, errors } = run(baseArgs, filesOf({ "/w/comp.json": JSON.stringify(component) }));
  expect(code).toBe(2);
  expect(errors).toContain("slug");
});

test("CLI: 部品 metadata の instances が配列でなければ exit 2", () => {
  const component = componentOf();
  component.instances = {};
  const { code } = run(baseArgs, filesOf({ "/w/comp.json": JSON.stringify(component) }));
  expect(code).toBe(2);
});

test("CLI: usages だけに頼る宣言で、usages がどの機能のページとも一致しなければ exit 1（影響なしに倒さない）", () => {
  const { code, result } = run(
    baseArgs,
    filesOf({ "/w/c.json": JSON.stringify(changeOf({ instances: [], usages: ["/ordres"] })) }),
  );
  expect(code).toBe(1);
  expect(result.unmatched_usages).toEqual(["/ordres"]);
  expect(result.findings.join("\n")).toContain("usages のページ /ordres");
});

test("CLI: usages が全部どれかの機能のページと一致すれば unmatched_usages は空で exit 0", () => {
  const { code, result } = run(baseArgs, filesOf());
  expect(code).toBe(0);
  expect(result.unmatched_usages).toEqual([]);
});

test("CLI: usages が絶対 URL なら入力の誤りとして exit 2", () => {
  const { code } = run(
    baseArgs,
    filesOf({
      "/w/c.json": JSON.stringify(changeOf({ usages: ["http://current.example.test/orders"] })),
    }),
  );
  expect(code).toBe(2);
});

test("変更宣言の states に部品の capture.states に無い状態（綴り違い）: 撮っていない＝影響なしに倒さず全機能を判定不能にする", () => {
  const result = computeImpact({
    change: changeOf({ states: ["hovre"] }),
    componentMetadata: componentOf(),
    features: [{ slug: "orders", metadata: featureOf() }],
  });
  expect(result.features.every((f) => f.verdict === "undeterminable")).toBe(true);
  expect(result.features[0].reasons.join("\n")).toContain(
    "capture.states（default, hover）に無い状態がある: hovre",
  );
});

test("CLI: 変更宣言の states が部品の語彙に無ければ exit 1", () => {
  const { code } = run(
    baseArgs,
    filesOf({ "/w/c.json": JSON.stringify(changeOf({ states: ["hovre"] })) }),
  );
  expect(code).toBe(1);
});

test("部品 metadata の capture.states が状態名の配列でない: 全機能を判定不能にする", () => {
  const component = componentOf();
  delete component.capture.states;
  const result = computeImpact({
    change: changeOf(),
    componentMetadata: component,
    features: [{ slug: "orders", metadata: featureOf() }],
  });
  expect(result.features.every((f) => f.verdict === "undeterminable")).toBe(true);
  expect(result.features[0].reasons.join("\n")).toContain("capture.states が状態名の配列でない");
});
