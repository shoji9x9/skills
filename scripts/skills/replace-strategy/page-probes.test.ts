// replace-strategy の role-probe.mjs・asset-probe.mjs の CLI と、lib/page-function.mjs のテスト。
//
// 2 つのプローブは、stdout に出した関数式のソースを chrome-devtools MCP の evaluate_script に渡して使う。
// ページで実行するコードは page/ の <名前>.page.mjs に置き、CLI がその本文を関数式で包んで出す。
// ここでは、stdout のソースをモジュールの外の vm のコンテキストで評価し、ページのグローバルの偽物を与えて呼ぶ。
// 実ブラウザでの値の確かめは、この偽物では代えられない（計算後スタイル・CSSOM・Resource Timing を持たない）。
// 宣言していない名前の参照（偽物のページが通らない分岐の参照も含む）と、使われないヘルパーは、
// oxlint の no-undef・no-unused-vars がページ用のファイルで見つける（no-undef は oxlint.config.ts の override で当てる）。
// ページ用のファイルに oxlint を実行するテストを置き、その検出はミューテーションテスト（page-probes.mutations.json）で示す。

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { expect, test, vi } from "vitest";
import { runOxlint } from "../../gates/code/oxlint-plugin/run-oxlint.ts";
import {
  pageFunctionSource,
  runProbeCli,
} from "../../../skills/replace-strategy/scripts/lib/page-function.mjs";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const SCRIPTS = fileURLToPath(
  new URL("../../../skills/replace-strategy/scripts/", import.meta.url),
);

/** プローブの CLI を起動する。 */
function spawnCli(name: string, args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPTS + name, ...args], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
}

/** プローブの CLI を引数なしで起動し、stdout を返す。 */
function runCli(name: string) {
  const r = spawnCli(name);
  expect(r.status, r.stderr).toBe(0);
  expect(r.stderr).toBe("");
  return r.stdout;
}

/** ソースを globals だけを持つコンテキストで評価して呼び、evaluate_script と同じく JSON で返す。 */
function evaluateInPage(source: string, globals: Record<string, unknown>): unknown {
  const fn: unknown = vm.runInNewContext(source, { ...globals });
  if (typeof fn !== "function") throw new TypeError("ソースが関数式でない");
  return JSON.parse(JSON.stringify(fn()));
}

/** 計算後スタイルの偽物。指定の無いプロパティは空文字を返す。 */
function fakeStyle(values: Record<string, string> = {}) {
  return {
    display: values["display"] ?? "block",
    visibility: "visible",
    getPropertyValue: (prop: string) => values[prop] ?? "",
  };
}

/** 要素の偽物。親を持たず、10×10 の矩形で描かれている。 */
function fakeElement(tagName: string, attrs: Record<string, string>, props: object = {}) {
  return {
    tagName,
    textContent: "",
    isConnected: true,
    parentElement: null,
    shadowRoot: null,
    closest: () => null,
    matches: () => false,
    getAttribute: (name: string) => attrs[name] ?? null,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    ...props,
  };
}

/** lines を書いたページ用のファイルを一時ディレクトリに置き、その URL を返す。 */
function writePageFile(lines: string[]) {
  const file = join(makeTempDir("page-function-"), "probe.page.mjs");
  writeFileSync(file, lines.join("\n"));
  return pathToFileURL(file);
}

test("pageFunctionSource: 最後の export の行だけを外し、コメントと複数行のリテラルを含む本文をそのまま関数式で包み、トップレベルの宣言を同じ名前で呼び合って本体の返り値を返す", () => {
  const file = writePageFile([
    "// 先頭の説明",
    "/**",
    " * JSDoc のブロック",
    " */",
    'const LIMIT = [2, "x"]; // 行の途中のコメント',
    "  /* 字下げした 1 行のブロック */",
    "function twice(n) { return n * LIMIT.length; }",
    "/* 閉じの後ろにコードがある行 */ const half = (n) => n / 2;",
    "const cdn = `https:",
    "//cdn.example/app.js`;",
    "function mainInPage() { return { value: half(twice(21)), limit: LIMIT, cdn }; }",
    "",
    "export { mainInPage };",
    "",
  ]);
  const source = pageFunctionSource(file, "mainInPage");
  expect(source).toBe(
    [
      "() => {",
      "// 先頭の説明",
      "/**",
      " * JSDoc のブロック",
      " */",
      'const LIMIT = [2, "x"]; // 行の途中のコメント',
      "  /* 字下げした 1 行のブロック */",
      "function twice(n) { return n * LIMIT.length; }",
      "/* 閉じの後ろにコードがある行 */ const half = (n) => n / 2;",
      "const cdn = `https:",
      "//cdn.example/app.js`;",
      "function mainInPage() { return { value: half(twice(21)), limit: LIMIT, cdn }; }",
      "",
      "return mainInPage();",
      "}",
    ].join("\n"),
  );
  expect(evaluateInPage(source, {})).toEqual({
    value: 21,
    limit: [2, "x"],
    cdn: "https:\n//cdn.example/app.js",
  });
});

test.each([
  [
    "最後の行に本体の export が無い",
    ["function mainInPage() { return 1; }"],
    /最後の行が「export \{ mainInPage \};」でない/u,
  ],
  [
    "最後の行が別の名前を export する",
    ["function mainInPage() { return 1; }", "export { other };"],
    /最後の行が「export \{ mainInPage \};」でない/u,
  ],
  [
    "本体の export の後ろにコードがある",
    ["function mainInPage() { return 1; }", "export { mainInPage };", "const after = 1;"],
    /最後の行が「export \{ mainInPage \};」でない/u,
  ],
  [
    "最後の行のほかに export がある",
    ["export const extra = 1;", "function mainInPage() { return 1; }", "export { mainInPage };"],
    /構文として読めない/u,
  ],
  [
    "import がある",
    [
      '  import { a } from "./a.mjs";',
      "function mainInPage() { return a; }",
      "export { mainInPage };",
    ],
    /構文として読めない/u,
  ],
  [
    "行の途中に export がある",
    ["const a = 1; export { a };", "function mainInPage() { return a; }", "export { mainInPage };"],
    /構文として読めない/u,
  ],
  [
    "import.meta を参照する",
    ["function mainInPage() { return import.meta.url; }", "export { mainInPage };"],
    /構文として読めない/u,
  ],
])("pageFunctionSource: 例外を投げる（%s）", (_label, lines, message) => {
  expect(() => pageFunctionSource(writePageFile(lines), "mainInPage")).toThrow(message);
});

test("pageFunctionSource: 複数行のテンプレートリテラルの中で行頭に export と書いた行は、構文として読めるので受け付ける", () => {
  const source = pageFunctionSource(
    writePageFile([
      "function mainInPage() {",
      "  return `一覧",
      "export は文字列の中`;",
      "}",
      "export { mainInPage };",
    ]),
    "mainInPage",
  );
  expect(vm.runInNewContext(`(${source})()`)).toBe("一覧\nexport は文字列の中");
});

test.each([
  ["role-probe.mjs", "role-probe.page.mjs"],
  ["asset-probe.mjs", "asset-probe.page.mjs"],
])(
  "%s の CLI: ページ用のファイルの最後の行のほかをそのまま包み、構文として読めるソースを出す",
  (name, pageName) => {
    const text = readFileSync(SCRIPTS + "page/" + pageName, "utf8");
    const source = runCli(name).trimEnd();
    expect(() => new vm.Script(`(${source})`)).not.toThrow();
    // 包んだ本文は、ページ用のファイルから最後の行（本体の export）を外したものと一致する
    const body = source.slice("() => {\n".length, source.lastIndexOf("\nreturn "));
    const original = text.trimEnd().split("\n").slice(0, -1).join("\n");
    expect(body).toBe(original);
  },
);

test.each([
  ["role-probe.mjs", "--url"],
  ["asset-probe.mjs", "/orders"],
])(
  "%s の CLI: 引数を付けると、ソースを出さずに理由と使い方を stderr に出して exit 2 で終わる",
  (name, arg) => {
    const r = spawnCli(name, [arg, "x"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(
      `未知の引数: ${arg}\nusage: node ${name}（引数を取らない。stdout に evaluate_script へ渡す関数式を出す）\n`,
    );
  },
);

test("role-probe の CLI: 名前のある要素と無い要素を数え、role ごとの件数と名前の無い標本を返す", () => {
  const named = fakeElement("BUTTON", { role: "button", "aria-label": " Save " });
  const unnamed = fakeElement("DIV", { tabindex: "0" });
  const result = evaluateInPage(runCli("role-probe.mjs"), {
    document: { querySelectorAll: () => [named, unnamed], body: {}, getElementById: () => null },
    location: { pathname: "/page" },
    getComputedStyle: () => fakeStyle(),
  });
  expect(result).toEqual({
    url: "/page",
    total: 2,
    named: 1,
    unnamed: 1,
    ratio: 0.5,
    duplicatePairs: [],
    byRole: { button: { total: 1, named: 1 }, "(no role)": { total: 1, named: 0 } },
    unnamedSamples: [{ tag: "div", role: null, path: "div:nth-child(1)" }],
  });
});

test("role-probe の CLI: 対象の要素が無いページでは割合を null にする", () => {
  const result = evaluateInPage(runCli("role-probe.mjs"), {
    document: { querySelectorAll: () => [], body: {} },
    location: { pathname: "/" },
    getComputedStyle: () => fakeStyle(),
  });
  expect(result).toMatchObject({ total: 0, named: 0, unnamed: 0, ratio: null, byRole: {} });
});

test("asset-probe の CLI: 描かれた img を src ごとに数え、走査したプロパティの一覧と網羅性 unknown を返す", () => {
  const img = fakeElement("IMG", {}, { currentSrc: "https://example.test/a.png" });
  const document = {
    baseURI: "https://example.test/page",
    body: {},
    documentElement: {},
    querySelectorAll: (selector: string) => (selector === "*" ? [img] : []),
    styleSheets: [],
    adoptedStyleSheets: [],
    fonts: [],
  };
  const result = evaluateInPage(runCli("asset-probe.mjs"), {
    document,
    location: { pathname: "/page" },
    URL,
    CSSFontFaceRule: FakeFontFaceRule,
    CSSImportRule: FakeImportRule,
    HTMLLinkElement: class {},
    performance: { getEntriesByType: () => [] },
    getComputedStyle: (_el: unknown, pseudo: string | null) =>
      fakeStyle(pseudo ? { content: "none" } : {}),
  });
  expect(result).toMatchObject({
    url: "/page",
    images: [
      {
        count: 1,
        rendered: 1,
        samples: [{ path: "img:nth-child(1)", rendered: true }],
        src: "https://example.test/a.png",
        kind: "img",
      },
    ],
    urlRefs: [],
    glyphs: [],
    fontFaces: [],
    resources: [],
    resourcesCompleteness: "unknown",
    shadowRoots: 0,
    unreadableSheets: [],
  });
  expect(result).toHaveProperty(
    "urlPropsScanned",
    expect.arrayContaining(["background-image", "content"]),
  );
});

/** 規則の一覧を持つスタイルシートの偽物。rules が null なら、cssRules の参照で SecurityError を投げる。 */
function fakeSheet(href: string | null, rules: object[] | null) {
  return {
    href,
    get cssRules() {
      if (rules === null) throw new Error("SecurityError");
      return rules;
    },
  };
}

/** @font-face と @import の規則の偽物。asset-probe は規則の種類をクラスで見分けるので、グローバルにこのクラスを渡す。 */
class FakeFontFaceRule {}
class FakeImportRule {}

/** link 要素の偽物。asset-probe は HTMLLinkElement のインスタンスだけを読むので、グローバルにこのクラスを渡す。 */
class FakeLink {
  rel: string;
  href: string;
  constructor(rel: string, href: string) {
    this.rel = rel;
    this.href = href;
  }
  getAttribute() {
    return null;
  }
}

/**
 * asset-probe が読む要素と計算後スタイルの偽物。img・断片を指す SVG の use・外部を指す SVG の image と、
 * background-image を持ち、::before に私用領域の文字、::after に url() を描く div を持つ。
 */
function fakeAssetElements() {
  const img = fakeElement("IMG", {}, { currentSrc: "https://example.test/a.png" });
  const styled = fakeElement("DIV", {});
  const elements = [
    img,
    fakeElement("use", { href: "#icon" }),
    fakeElement("image", { href: "/img/b.png" }),
    styled,
  ];
  const pseudoStyles: Record<string, Record<string, string>> = {
    "::before": { content: `"${String.fromCodePoint(0xf00d)}"`, "font-family": "Icons" },
    "::after": { content: "url(https://example.test/after.png)" },
  };
  const ownStyle = { "background-image": 'url("https://example.test/bg.png")' };
  const getComputedStyle = (el: unknown, pseudo: string | null) => {
    if (pseudo) return fakeStyle(el === styled ? pseudoStyles[pseudo] : { content: "none" });
    return fakeStyle(el === styled ? ownStyle : {});
  };
  return { elements, getComputedStyle };
}

/**
 * asset-probe が読むスタイルシートの偽物。@font-face（シートの URL を基準にした相対 URL）・
 * 読めないシートへの @import・@media の中の @font-face を持つ。adoptedStyleSheets にも同じシートを置く。
 */
function fakeAssetSheets() {
  const fontFace = (src: string) =>
    Object.assign(new FakeFontFaceRule(), {
      style: fakeStyle({ "font-family": "Icons", src }),
    });
  const unreadable = fakeSheet("https://cdn.example.test/x.css", null);
  return [
    fakeSheet("https://example.test/css/a.css", [
      fontFace('url("../fonts/i.woff2")'),
      Object.assign(new FakeImportRule(), { styleSheet: unreadable }),
      { cssRules: [fontFace("url(/fonts/m.woff)")] },
    ]),
  ];
}

/** asset-probe を当てるページのグローバルの偽物。 */
function fakeAssetPage() {
  const { elements, getComputedStyle } = fakeAssetElements();
  const links = [
    new FakeLink("icon", "https://example.test/favicon.ico"),
    new FakeLink("manifest", "https://example.test/app.webmanifest"),
  ];
  const sheets = fakeAssetSheets();
  const document = {
    baseURI: "https://example.test/page",
    body: {},
    documentElement: {},
    querySelectorAll: (selector: string) => (selector === "*" ? elements : links),
    styleSheets: sheets,
    adoptedStyleSheets: sheets,
    fonts: [{ status: "loaded", family: "Icons", weight: "400", style: "normal" }],
  };
  const resources = [
    { name: "https://example.test/a.png", initiatorType: "img" },
    { name: "https://example.test/api", initiatorType: "fetch" },
  ];
  return {
    document,
    location: { pathname: "/page" },
    URL,
    CSSFontFaceRule: FakeFontFaceRule,
    CSSImportRule: FakeImportRule,
    HTMLLinkElement: FakeLink,
    performance: { getEntriesByType: () => resources },
    getComputedStyle,
  };
}

test("asset-probe の CLI: 疑似要素・SVG・スタイルシート・link・Resource Timing を持つページで、各々の資産を数える", () => {
  const result = evaluateInPage(runCli("asset-probe.mjs"), fakeAssetPage());
  expect(result).toMatchObject({
    images: [
      { src: "https://example.test/a.png", kind: "img" },
      { src: "https://example.test/img/b.png", kind: "svg-image" },
    ],
    localFragmentRefs: [{ url: "#icon", property: "use", pseudo: null }],
    urlRefs: [
      { url: "https://example.test/bg.png", property: "background-image", pseudo: null },
      { url: "https://example.test/after.png", property: "content", pseudo: "::after" },
    ],
    glyphs: [{ pseudo: "::before", fontFamily: "Icons", codepoints: ["U+F00D"], privateUse: true }],
    fontFaces: [
      { family: "Icons", src: ["https://example.test/fonts/i.woff2"] },
      { family: "Icons", src: ["https://example.test/fonts/m.woff"] },
    ],
    unreadableSheets: ["https://cdn.example.test/x.css"],
    icons: [{ rel: "icon", href: "https://example.test/favicon.ico" }],
    manifests: [{ href: "https://example.test/app.webmanifest", iconsInspected: false }],
    resources: [{ url: "https://example.test/a.png", matchedBy: "extension" }],
    unclassifiedResources: [{ url: "https://example.test/api" }],
  });
});

test("role-probe の CLI: aria-labelledby・label・button の value・内容テキスト・(role, name) の重複を持つページで、名前と重複を数える", () => {
  const labelled = fakeElement("BUTTON", { role: "button", "aria-labelledby": "lbl missing" });
  const withLabel = fakeElement(
    "INPUT",
    { role: "textbox" },
    { labels: [{ textContent: " Name " }, { textContent: "" }] },
  );
  const submit = fakeElement("INPUT", { role: "button" }, { type: "submit", value: " Send " });
  const heading = fakeElement(
    "H2",
    {},
    { textContent: "Title", matches: (s: string) => s.startsWith("h1") },
  );
  const more = [1, 2].map(() => fakeElement("A", { role: "link", "aria-label": "More" }));
  const unnamed = fakeElement("DIV", { tabindex: "0" });
  const result = evaluateInPage(runCli("role-probe.mjs"), {
    document: {
      querySelectorAll: () => [labelled, withLabel, submit, heading, ...more, unnamed],
      body: {},
      getElementById: (id: string) => (id === "lbl" ? { textContent: " Save  now " } : null),
    },
    location: { pathname: "/form" },
    getComputedStyle: () => fakeStyle(),
  });
  expect(result).toMatchObject({
    total: 7,
    named: 6,
    duplicatePairs: [{ role: "link", name: "More", count: 2 }],
    byRole: {
      button: { total: 2, named: 2 },
      textbox: { total: 1, named: 1 },
      heading: { total: 1, named: 1 },
      link: { total: 2, named: 2 },
      "(no role)": { total: 1, named: 0 },
    },
  });
});

test("page/*.page.mjs: oxlint が宣言していない名前の参照と使われないヘルパーを報告しない（ページ用の override が当たる）", () => {
  const files = ["role-probe.page.mjs", "asset-probe.page.mjs"].map((f) => SCRIPTS + "page/" + f);
  expect(runOxlint(files, { timeout: CHILD_TIMEOUT_MS })).toEqual([]);
});

test("プローブの CLI: ソースを組み立てられないと、スタックトレースを出さずに理由を stderr に出して exit 2 で終わる", () => {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const code = runProbeCli([], {
      source: () => {
        throw new Error("page/x.page.mjs が無い");
      },
      usage: "usage: x",
    });
    expect(code).toBe(2);
    expect(stderr.mock.calls.map((c) => String(c[0]))).toEqual([
      "ページ用のソースを組み立てられない: page/x.page.mjs が無い\n",
    ]);
    expect(stdout).not.toHaveBeenCalled();
  } finally {
    stderr.mockRestore();
    stdout.mockRestore();
  }
});
