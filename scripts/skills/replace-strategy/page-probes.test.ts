// replace-strategy の role-probe.mjs・asset-probe.mjs の CLI と、lib/page-function.mjs のテスト。
//
// 2 つのプローブは、stdout に出した関数式のソースを chrome-devtools MCP の evaluate_script に渡して使う。
// ページへはソースだけが渡るので、ソースがモジュールの名前を参照していると、ページで ReferenceError になる。
// そこで、stdout のソースをモジュールの外の vm のコンテキストで評価し、ページのグローバルの偽物を与えて呼ぶ。
// 実ブラウザでの値の確かめは、この偽物では代えられない（計算後スタイル・CSSOM・Resource Timing を持たない）。
// ここで確かめるのは、ソースが自己完結していることと、本体とヘルパーのつなぎ方である。
// ヘルパーの呼び出しを `h.` を付けずに書くと、その行を実行したときだけページで ReferenceError になる。
// このため、本体とヘルパーのソースから `h.<名前>` の参照（呼び出し元と呼び出し先の組）を挙げ、
// 偽物のページで実行したときにすべての組が少なくとも 1 回実行されたことを確かめる。

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
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

test("pageFunctionSource: ヘルパーを h で呼び合い、定数を JSON で埋め込んだ、外の名前を参照しない関数式を返す", () => {
  const LIMIT = [2, "x"];
  function twice(h: { LIMIT: unknown[] }, n: number) {
    return n * h.LIMIT.length;
  }
  function main(h: { twice: typeof twice; LIMIT: unknown[] }) {
    return { value: h.twice(h, 21), limit: h.LIMIT };
  }
  const source = pageFunctionSource(main, { twice, LIMIT });
  expect(source.startsWith("() => (")).toBe(true);
  expect(evaluateInPage(source, {})).toEqual({ value: 42, limit: [2, "x"] });
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

/** ページで実行する本体。テストはソースにするだけで、Node では呼ばない（pageFunctionSource の main と同じ型）。 */
type PageMain = (h: never) => unknown;

/**
 * 本体とヘルパーのソースから、`h.<名前>` で参照する関数のヘルパーを「呼び出し元->呼び出し先」の組で挙げる。
 * 本体の組の呼び出し元は "main" にする。
 */
function referencedPairs(main: PageMain, helpers: Record<string, unknown>) {
  const functionNames = new Set(
    Object.entries(helpers)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name),
  );
  const pairs = new Set<string>();
  const sources: [string, unknown][] = [["main", main], ...Object.entries(helpers)];
  for (const [caller, value] of sources) {
    if (typeof value !== "function") continue;
    for (const m of String(value).matchAll(/\bh\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
      if (functionNames.has(m[1])) pairs.add(`${caller}->${m[1]}`);
    }
  }
  return pairs;
}

/**
 * pageFunctionSource が組み立てたヘルパーを vm のコンテキストで評価し、各ヘルパーを包んで本体を呼ぶ。
 * 包んだヘルパーは、呼ばれるたびに「呼び出し元->呼び出し先」の組を記録する。
 * ヘルパーの本体は vm の中で評価するので、`h.` を付けない参照はモジュールの名前に解決されず ReferenceError になる。
 */
function runTraced(main: PageMain, helpers: Record<string, unknown>, globals: object) {
  const context = vm.createContext({ ...globals });
  const build: unknown = vm.runInContext(
    pageFunctionSource((h: unknown) => h, helpers),
    context,
  );
  const mainInPage: unknown = vm.runInContext(`(${String(main)})`, context);
  if (typeof build !== "function" || typeof mainInPage !== "function") {
    throw new TypeError("ソースが関数式でない");
  }
  const inPage: unknown = build();
  if (typeof inPage !== "object" || inPage === null) throw new TypeError("ヘルパーの一覧でない");
  const calls = new Set<string>();
  const stack = ["main"];
  const traced: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(inPage)) {
    traced[name] =
      typeof value === "function"
        ? (...args: unknown[]) => {
            calls.add(`${stack.at(-1)}->${name}`);
            stack.push(name);
            try {
              return value(...args);
            } finally {
              stack.pop();
            }
          }
        : value;
  }
  const result: unknown = JSON.parse(JSON.stringify(mainInPage(traced)));
  return { result, calls };
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
  const main = (h: unknown) => h;
  for (const value of [/a/u, new Map([["k", 1]]), new Set([1]), undefined, Number.NaN]) {
    expect(() => pageFunctionSource(main, { VALUE: value })).toThrow(
      /ヘルパーの VALUE は、関数でも JSON で往復できる値でもない/u,
    );
  }
  expect(pageFunctionSource(main, { LIST: [1, "a", null, { k: true }] })).toContain(
    'LIST: [1,"a",null,{"k":true}]',
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

test("asset-probe: 疑似要素・SVG・スタイルシート・link・Resource Timing を持つページで、h を通した呼び出しがすべて実行される", () => {
  const { result, calls } = runTraced(assetProbeInPage, ASSET_PROBE_PAGE, fakeAssetPage());
  const expected = referencedPairs(assetProbeInPage, ASSET_PROBE_PAGE);
  expect(expected).toContain("walkRules->visitSheet");
  expect([...expected].filter((pair) => !calls.has(pair))).toEqual([]);
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

test("role-probe: aria-labelledby・label・button の value・内容テキスト・(role, name) の重複を持つページで、h を通した呼び出しがすべて実行される", () => {
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
  const { result, calls } = runTraced(roleProbeInPage, ROLE_PROBE_PAGE, {
    document: {
      querySelectorAll: () => [labelled, withLabel, submit, heading, ...more, unnamed],
      body: {},
      getElementById: (id: string) => (id === "lbl" ? { textContent: " Save  now " } : null),
    },
    location: { pathname: "/form" },
    getComputedStyle: () => fakeStyle(),
  });
  const expected = referencedPairs(roleProbeInPage, ROLE_PROBE_PAGE);
  expect(expected).toContain("accessibleName->labelsName");
  expect([...expected].filter((pair) => !calls.has(pair))).toEqual([]);
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
