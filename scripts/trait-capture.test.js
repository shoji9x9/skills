// 静止画に写らない computed style を固定集合に入れ、解決しない名前で fail closed する回帰テスト（Issue #342）。

import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/trait-capture.mjs");
const { FIXED_PROPERTIES, captureTraits } = await import(script);

// captureElement は locator.evaluate に文字列化して渡る純関数なので、
// evaluate を「渡された関数をブラウザ相当のスタブへ当てる」偽ロケータで実行して検証する。
function fakeLocator(styles, { pseudoContent = "none", pseudoStyles = styles } = {}) {
  return {
    evaluate(fn, props) {
      const el = {
        getBoundingClientRect: () => ({ x: 1, y: 2, width: 3, height: 4 }),
      };
      const previous = globalThis.getComputedStyle;
      globalThis.getComputedStyle = (_element, pseudo) => ({
        content: pseudo ? pseudoContent : "normal",
        getPropertyValue: (prop) => (pseudo ? pseudoStyles : styles)[prop] ?? "",
      });
      try {
        return Promise.resolve(fn(el, props));
      } finally {
        globalThis.getComputedStyle = previous;
      }
    },
  };
}

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

test("cursor の差は computed に現れる（画素に写らない差を特性照合へ渡す）", async () => {
  const [legacy] = await captureTraits([
    { name: "detail.save", locator: fakeLocator(allResolved({ cursor: "pointer" })) },
  ]);
  const [replacement] = await captureTraits([
    { name: "detail.save", locator: fakeLocator(allResolved({ cursor: "default" })) },
  ]);

  expect(legacy.computed.cursor).toBe("pointer");
  expect(replacement.computed.cursor).toBe("default");
  expect(legacy.computed.cursor).not.toBe(replacement.computed.cursor);
});

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
