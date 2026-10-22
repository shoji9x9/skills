// replace-strategy の role-probe.mjs・asset-probe.mjs の CLI と、lib/page-function.mjs のテスト。
//
// 2 つのプローブは、stdout に出した関数式のソースを chrome-devtools MCP の evaluate_script に渡して使う。
// ページへはソースだけが渡るので、ソースがモジュールの名前を参照していると、ページで ReferenceError になる。
// そこで、stdout のソースをモジュールの外の vm のコンテキストで評価し、ページのグローバルの偽物を与えて呼ぶ。
// 実ブラウザでの値の確かめは、この偽物では代えられない（計算後スタイル・CSSOM・Resource Timing を持たない）。
// ここで確かめるのは、ソースが自己完結していることと、本体とヘルパーのつなぎ方である。

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { expect, test } from "vitest";
import { pageFunctionSource } from "../../../skills/replace-strategy/scripts/lib/page-function.mjs";
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
