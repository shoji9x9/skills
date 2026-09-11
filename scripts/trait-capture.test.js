// 静止画に写らない computed style を固定集合に入れ、解決しない名前で fail closed する回帰テスト（Issue #342）。

import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/trait-capture.mjs");
const { FIXED_PROPERTIES, captureTraits } = await import(script);

// captureElement は locator.evaluate に文字列化して渡る純関数なので、
// evaluate を「渡された関数をブラウザ相当のスタブへ当てる」偽ロケータで実行して検証する。
function fakeLocator(
  styles,
  { pseudoContent = "none", pseudoStyles = styles, origin = "http://legacy.example:8811" } = {},
) {
  return {
    evaluate(fn, props) {
      const el = {
        getBoundingClientRect: () => ({ x: 1, y: 2, width: 3, height: 4 }),
      };
      const previousStyle = globalThis.getComputedStyle;
      const previousLocation = globalThis.location;
      globalThis.getComputedStyle = (_element, pseudo) => ({
        content: pseudo ? pseudoContent : "normal",
        getPropertyValue: (prop) => (pseudo ? pseudoStyles : styles)[prop] ?? "",
      });
      globalThis.location = { origin };
      try {
        return Promise.resolve(fn(el, props));
      } finally {
        globalThis.getComputedStyle = previousStyle;
        globalThis.location = previousLocation;
      }
    },
  };
}

// 実測（Chrome 経由）: cursor: url(cur.png) の計算値は自分のオリジンで絶対化され、
// 同じ CSS が http://127.0.0.1:8811 と :8822 で別文字列になる。
const cursorOn = (origin, path) => `url("${origin}/${path}"), pointer`;

function allResolved(overrides = {}) {
  return Object.fromEntries(FIXED_PROPERTIES.map((prop) => [prop, overrides[prop] ?? "0px"]));
}

test.each(["cursor", "user-select", "pointer-events"])(
  "静止画に写らない %s が固定集合に入っている",
  (prop) => {
    expect(FIXED_PROPERTIES).toContain(prop);
  },
);

test("固定集合に重複が無い", () => {
  expect(new Set(FIXED_PROPERTIES).size).toBe(FIXED_PROPERTIES.length);
});

// 集合に名前があることだけを見るテストでは、captureElement のループが特定の名前を読み落とす
// 変異を捕まえられない。3 プロパティとも computed へ入って差分になることを同じ形で確かめる。
test.each([
  ["cursor", "pointer", "default"],
  ["user-select", "none", "auto"],
  ["pointer-events", "none", "auto"],
])(
  "%s の差は computed に現れる（画素に写らない差を特性照合へ渡す）",
  async (prop, before, after) => {
    const [legacy] = await captureTraits([
      { name: "detail.save", locator: fakeLocator(allResolved({ [prop]: before })) },
    ]);
    const [replacement] = await captureTraits([
      { name: "detail.save", locator: fakeLocator(allResolved({ [prop]: after })) },
    ]);

    expect(legacy.computed[prop]).toBe(before);
    expect(replacement.computed[prop]).toBe(after);
    expect(legacy.computed[prop]).not.toBe(replacement.computed[prop]);
  },
);

test("擬似要素は content が none なら null になる", async () => {
  const [trait] = await captureTraits([
    { name: "detail.save", locator: fakeLocator(allResolved()) },
  ]);
  expect(trait.before).toBeNull();
  expect(trait.after).toBeNull();
  expect(trait.rect).toEqual({ x: 1, y: 2, width: 3, height: 4 });
});

test("解決しないプロパティ名は空文字で通さず論理名付きで落ちる", async () => {
  const styles = allResolved();
  delete styles["user-select"];

  await expect(
    captureTraits([{ name: "detail.save", locator: fakeLocator(styles) }]),
  ).rejects.toThrow(/detail\.save[\s\S]*user-select/);
});

// 本体側は全部解決させ、擬似要素側だけを欠かす。本体側も欠かすと pick(null) が先に落ちるため、
// 擬似要素の分岐を無効化しても green のままになる（弁別できない）。
test("擬似要素側だけで解決しないプロパティ名も落ちる", async () => {
  const pseudoStyles = allResolved();
  delete pseudoStyles.cursor;

  await expect(
    captureTraits([
      {
        name: "detail.save",
        locator: fakeLocator(allResolved(), { pseudoContent: '"x"', pseudoStyles }),
      },
    ]),
  ).rejects.toThrow(/detail\.save[\s\S]*::before[\s\S]*cursor/);
});

test("同一オリジンの url() は畳まれ、現・新のホスト違いが偽の差分にならない", async () => {
  const [legacy] = await captureTraits([
    {
      name: "detail.save",
      locator: fakeLocator(
        allResolved({ cursor: cursorOn("http://legacy.example:8811", "cur.png") }),
        {
          origin: "http://legacy.example:8811",
        },
      ),
    },
  ]);
  const [replacement] = await captureTraits([
    {
      name: "detail.save",
      locator: fakeLocator(
        allResolved({ cursor: cursorOn("http://new.example:3000", "cur.png") }),
        {
          origin: "http://new.example:3000",
        },
      ),
    },
  ]);

  expect(legacy.computed.cursor).toBe('url("<same-origin>/cur.png"), pointer');
  expect(legacy.computed.cursor).toBe(replacement.computed.cursor);
});

test("同一オリジンでもパスが違えば差分として残る（畳んで本物の差を消さない）", async () => {
  const [legacy] = await captureTraits([
    {
      name: "detail.save",
      locator: fakeLocator(
        allResolved({ cursor: cursorOn("http://legacy.example:8811", "cur.png") }),
        {
          origin: "http://legacy.example:8811",
        },
      ),
    },
  ]);
  const [replacement] = await captureTraits([
    {
      name: "detail.save",
      locator: fakeLocator(
        allResolved({ cursor: cursorOn("http://new.example:3000", "other.png") }),
        {
          origin: "http://new.example:3000",
        },
      ),
    },
  ]);

  expect(legacy.computed.cursor).not.toBe(replacement.computed.cursor);
});

test.each([
  ["data URI", 'url("data:image/gif;base64,R0lGODlhAQABAAAAACw="), auto'],
  ["別オリジン", 'url("https://cdn.example.com/x.png"), auto'],
  ["自オリジンを前方一致で含む別ホスト", 'url("http://legacy.example:8811.evil/x.png"), auto'],
  [
    "他オリジン URL のパスに自オリジンが現れる値",
    'url("https://cdn.example/redirect/http://legacy.example:8811/x.png"), auto',
  ],
  [
    "url() の外に自オリジンが現れる値",
    'url("https://cdn.example/x.png") http://legacy.example:8811/note, auto',
  ],
])("%s の url() は畳まず原文のまま残す", async (_name, value) => {
  const [trait] = await captureTraits([
    {
      name: "detail.save",
      locator: fakeLocator(allResolved({ cursor: value }), {
        origin: "http://legacy.example:8811",
      }),
    },
  ]);
  expect(trait.computed.cursor).toBe(value);
});

// origin が http(s) でないときは畳まない。"" を含めるのはガードの弁別のため——ガードを外すと
// 空オリジンが value.includes("/") に化けて、あらゆるスラッシュを印へ置換し値を壊す。
test.each([
  ["file:// 等で origin が null", "null"],
  ["origin が空", ""],
])("%s のときは畳まず原文のまま残す（黙って一致させない）", async (_name, origin) => {
  const value = cursorOn("http://legacy.example:8811", "cur.png");
  const [trait] = await captureTraits([
    { name: "detail.save", locator: fakeLocator(allResolved({ cursor: value }), { origin }) },
  ]);
  expect(trait.computed.cursor).toBe(value);
});
