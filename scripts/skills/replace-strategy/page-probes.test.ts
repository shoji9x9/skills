// replace-strategy の role-probe.mjs・asset-probe.mjs の CLI と、lib/page-function.mjs のテスト。
//
// 2 つのプローブは、stdout に出した関数式のソースを chrome-devtools MCP の evaluate_script に渡して使う。
// ページへはソースだけが渡るので、ソースがモジュールの名前を参照していると、ページで ReferenceError になる。
// そこで、stdout のソースをモジュールの外の vm のコンテキストで評価し、ページのグローバルの偽物を与えて呼ぶ。
// 実ブラウザでの値の確かめは、この偽物では代えられない（計算後スタイル・CSSOM・Resource Timing を持たない）。
// ここで確かめるのは、ソースが自己完結していることと、本体とヘルパーのつなぎ方である。
// 本体とヘルパーが参照するトップレベルの名前を一覧（ROLE_PROBE_PAGE・ASSET_PROBE_PAGE）に入れ忘れると、
// その名前を参照する行を実行したときだけ、ページで ReferenceError になる。
// この入れ忘れを見つけるため、プローブのファイルを TypeScript の構文木と型チェッカーで読み、本体から参照をたどって届くトップレベルの名前が
// すべて一覧にあることと、一覧の名前がすべて届くことを確かめる。偽物のページが通らない分岐の参照も、ここで見つかる。
// 加えて、偽物のページで実行したときに、一覧の各ヘルパーが少なくとも 1 回呼ばれることを確かめる。

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "vitest";
import { pageFunctionSource } from "../../../skills/replace-strategy/scripts/lib/page-function.mjs";
import {
  ASSET_PROBE_PAGE,
  assetProbeInPage,
} from "../../../skills/replace-strategy/scripts/asset-probe.mjs";
import {
  ROLE_PROBE_PAGE,
  roleProbeInPage,
} from "../../../skills/replace-strategy/scripts/role-probe.mjs";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const SCRIPTS = fileURLToPath(
  new URL("../../../skills/replace-strategy/scripts/", import.meta.url),
);

/** プローブの CLI を起動し、stdout を返す。 */
function runCli(name: string) {
  const r = spawnSync(process.execPath, [SCRIPTS + name], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
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

test("pageFunctionSource: ヘルパーと定数をローカルの宣言に並べ、同じ名前で呼び合う、外の名前を参照しない関数式を返す", () => {
  const LIMIT = [2, "x"];
  function twice(n: number) {
    return n * LIMIT.length;
  }
  const half = (n: number) => n / 2;
  function main() {
    return { value: half(twice(21)), limit: LIMIT };
  }
  const source = pageFunctionSource(main, { twice, half, LIMIT });
  expect(source.startsWith("() => {")).toBe(true);
  expect(evaluateInPage(source, {})).toEqual({ value: 21, limit: [2, "x"] });
});

test("pageFunctionSource: 宣言できない名前と、関数の名前と一致しない名前を拒む", () => {
  const main = () => null;
  function helper() {
    return 1;
  }
  for (const name of ["my-helper", "1st", "", "class", "await", "arguments"]) {
    expect(() => pageFunctionSource(main, { [name]: 1 })).toThrow(
      `ページへ渡すヘルパーの名前 ${JSON.stringify(name)} は、宣言できる識別子でない`,
    );
  }
  expect(() => pageFunctionSource(main, { other: helper })).toThrow(
    'ページへ渡すヘルパーの other は、関数の名前（"helper"）と一致しない',
  );
  expect(() => pageFunctionSource(main, { $ok_1: 1, helper })).not.toThrow();
});

test("pageFunctionSource: 式として読めない関数のソース（メソッドの短縮形・組み込みの関数）を、組み立てるときに拒む", () => {
  const main = () => null;
  const { shorthand } = {
    shorthand() {
      return 1;
    },
  };
  expect(() => pageFunctionSource(main, { shorthand })).toThrow(SyntaxError);
  const { max } = Math;
  expect(() => pageFunctionSource(main, { max })).toThrow(SyntaxError);
});

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
    CSSRule: { FONT_FACE_RULE: 5, IMPORT_RULE: 3 },
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

/** ページで実行する本体（pageFunctionSource の main と同じ型）。 */
type PageMain = () => unknown;

/**
 * 構文木で、識別子が指すトップレベルの宣言の名前を返す。トップレベルの宣言を指さない識別子なら null。
 * 省略したプロパティ（`{ text }`）は、プロパティではなく値の側の宣言を見る。
 */
function topLevelNameOf(id: ts.Identifier, checker: ts.TypeChecker, names: Map<ts.Node, string>) {
  const symbol =
    ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
      ? checker.getShorthandAssignmentValueSymbol(id.parent)
      : checker.getSymbolAtLocation(id);
  for (const declaration of symbol?.declarations ?? []) {
    const name = names.get(declaration);
    if (name !== undefined) return name;
  }
  return null;
}

/** ファイルのトップレベルの関数・変数の宣言と、import した名前を、宣言のノードから名前への表にする。 */
function topLevelDeclarations(sf: ts.SourceFile) {
  const names = new Map<ts.Node, string>();
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.set(statement, statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.set(d, d.name.text);
      }
    } else if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const e of bindings.elements) names.set(e, e.name.text);
      }
    }
  }
  return names;
}

/**
 * プローブのファイルを読み、本体から参照をたどって届くトップレベルの名前（本体を除く）を返す。
 * 名前は型チェッカーで宣言に解決するので、プロパティの名前・同じ名前のローカルの変数・JSDoc の型は数えない。
 */
function reachableTopLevelNames(file: string, mainName: string) {
  const program = ts.createProgram([file], {
    allowJs: true,
    noLib: true,
    noResolve: true,
    noEmit: true,
  });
  const sf = program.getSourceFile(file);
  if (sf === undefined) throw new TypeError(`${file} を読めない`);
  const checker = program.getTypeChecker();
  const names = topLevelDeclarations(sf);
  const nodeOf = new Map([...names].map(([node, name]) => [name, node]));
  const reached = new Set<string>();
  const queue = [mainName];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    const node = nodeOf.get(name);
    if (node === undefined) throw new TypeError(`${file} のトップレベルに ${name} が無い`);
    const visit = (n: ts.Node): void => {
      const target = ts.isIdentifier(n) ? topLevelNameOf(n, checker, names) : null;
      if (target !== null && target !== mainName && !reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(node, visit);
  }
  return reached;
}

/**
 * 本体から届くトップレベルの名前と、ヘルパーの一覧を突き合わせる。
 * missing は一覧に無いのに参照される名前（ページで ReferenceError になる）、unused は一覧にあるのに参照されない名前。
 */
function compareWithList(file: string, main: PageMain, helpers: Record<string, unknown>) {
  const reached = reachableTopLevelNames(file, main.name);
  const listed = Object.keys(helpers);
  return {
    reached,
    missing: [...reached].filter((name) => !listed.includes(name)),
    unused: listed.filter((name) => !reached.has(name)),
  };
}

/**
 * ヘルパーの関数を、呼ばれたら名前を __trace に渡してから元の関数を呼ぶ関数に置き換えた一覧を返す。
 * 置き換えた関数は、ソース（`Function.prototype.toString`）と名前が元の関数と対応するように、ソースから作る。
 */
function tracedHelpers(helpers: Record<string, unknown>) {
  const traced: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(helpers)) {
    traced[name] =
      typeof value === "function"
        ? vm.runInNewContext(
            `(function ${name}(...args) { __trace(${JSON.stringify(name)}); return (${String(value)})(...args); })`,
          )
        : value;
  }
  return traced;
}

/**
 * ヘルパーを包んだ一覧で pageFunctionSource のソースを作り、globals だけを持つ vm のコンテキストで評価して呼ぶ。
 * 呼ばれたヘルパーの名前を calls に集める。一覧に無い名前の参照は、モジュールの名前に解決されず ReferenceError になる。
 */
function runTraced(main: PageMain, helpers: Record<string, unknown>, globals: object) {
  const calls = new Set<string>();
  const context = vm.createContext({ ...globals, __trace: (name: string) => calls.add(name) });
  const fn: unknown = vm.runInContext(pageFunctionSource(main, tracedHelpers(helpers)), context);
  if (typeof fn !== "function") throw new TypeError("ソースが関数式でない");
  const result: unknown = JSON.parse(JSON.stringify(fn()));
  const notCalled = Object.entries(helpers)
    .filter(([name, value]) => typeof value === "function" && !calls.has(name))
    .map(([name]) => name);
  return { result, notCalled };
}

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

test("pageFunctionSource: JSON で往復できない値（RegExp・Map・Set・undefined）を渡すと、名前を添えて例外を投げる", () => {
  const main = () => null;
  for (const value of [/a/u, new Map([["k", 1]]), new Set([1]), undefined, Number.NaN]) {
    expect(() => pageFunctionSource(main, { VALUE: value })).toThrow(
      /ヘルパーの VALUE は、関数でも JSON で往復できる値でもない/u,
    );
  }
  expect(pageFunctionSource(main, { LIST: [1, "a", null, { k: true }] })).toContain(
    'const LIST = [1,"a",null,{"k":true}];',
  );
});

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
  const fontFace = (src: string) => ({
    type: 5,
    style: fakeStyle({ "font-family": "Icons", src }),
  });
  const unreadable = fakeSheet("https://cdn.example.test/x.css", null);
  return [
    fakeSheet("https://example.test/css/a.css", [
      fontFace('url("../fonts/i.woff2")'),
      { type: 3, styleSheet: unreadable },
      { type: 4, cssRules: [fontFace("url(/fonts/m.woff)")] },
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
    CSSRule: { FONT_FACE_RULE: 5, IMPORT_RULE: 3 },
    HTMLLinkElement: FakeLink,
    performance: { getEntriesByType: () => resources },
    getComputedStyle,
  };
}

test("asset-probe: 疑似要素・SVG・スタイルシート・link・Resource Timing を持つページで、一覧の各ヘルパーが 1 回以上呼ばれる", () => {
  const { result, notCalled } = runTraced(assetProbeInPage, ASSET_PROBE_PAGE, fakeAssetPage());
  expect(notCalled).toEqual([]);
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

test("role-probe: aria-labelledby・label・button の value・内容テキスト・(role, name) の重複を持つページで、一覧の各ヘルパーが 1 回以上呼ばれる", () => {
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
  const { result, notCalled } = runTraced(roleProbeInPage, ROLE_PROBE_PAGE, {
    document: {
      querySelectorAll: () => [labelled, withLabel, submit, heading, ...more, unnamed],
      body: {},
      getElementById: (id: string) => (id === "lbl" ? { textContent: " Save  now " } : null),
    },
    location: { pathname: "/form" },
    getComputedStyle: () => fakeStyle(),
  });
  expect(notCalled).toEqual([]);
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

test("role-probe: 本体から参照をたどって届くトップレベルの名前が ROLE_PROBE_PAGE と一致する", () => {
  const { reached, missing, unused } = compareWithList(
    SCRIPTS + "role-probe.mjs",
    roleProbeInPage,
    ROLE_PROBE_PAGE,
  );
  // 本体から直接と、ヘルパーを経て届く名前と、定数が数えられていること（検出できることの確認）。
  expect(reached).toContain("tally");
  expect(reached).toContain("labelsName");
  expect(reached).toContain("IMPLICIT_ROLES");
  expect({ missing, unused }).toEqual({ missing: [], unused: [] });
});

test("asset-probe: 本体から参照をたどって届くトップレベルの名前が ASSET_PROBE_PAGE と一致する", () => {
  const { reached, missing, unused } = compareWithList(
    SCRIPTS + "asset-probe.mjs",
    assetProbeInPage,
    ASSET_PROBE_PAGE,
  );
  expect(reached).toContain("visitSheet");
  expect(reached).toContain("MAX_SAMPLES");
  expect({ missing, unused }).toEqual({ missing: [], unused: [] });
});

test("compareWithList: 一覧に無い参照（偽物のページが通らない分岐・import した名前）と、参照されない一覧の名前を報告する", () => {
  const dir = makeTempDir("page-probes-");
  const file = join(dir, "probe.mjs");
  writeFileSync(
    file,
    [
      'import { outside } from "./other.mjs";',
      "const LIMIT = 3;",
      "function listed(el) { return el ? LIMIT : 0; }",
      "function forgotten() { return 1; }",
      "function unusedHelper() { return 2; }",
      "function shadowed() { return 3; }",
      "export function main() {",
      "  const shadowed = 0;",
      "  const out = { listed: listed(1), shadowed };",
      "  if (out.listed > 99) return forgotten() + outside();",
      "  return out;",
      "}",
      "",
    ].join("\n"),
  );
  const main = () => null;
  Object.defineProperty(main, "name", { value: "main" });
  const r = compareWithList(file, main, { LIMIT: 3, listed: () => 0, unusedHelper: () => 0 });
  expect(r.missing.sort()).toEqual(["forgotten", "outside"]);
  expect(r.unused).toEqual(["unusedHelper"]);
});
