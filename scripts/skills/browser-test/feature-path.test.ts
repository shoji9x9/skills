// browser-test の機能マップの path のパターン（config-schemas/browser-test.schema.json）が、環境の url の外のホストを指す値を拒否するかのテスト。
//
// path は環境の url と結合して開く。`//host` や `/\host` は、URL として解決すると環境のホストを置き換える。
// 拒否する文字を 1 つずつ足すと、別の綴り（バックスラッシュ・タブなど）で抜けるので、パターンは URL のパスに使う文字の許可リストにしてある。
// ここでは、受け付けた値を WHATWG URL で解決し、ホストが環境のホストのままであることを確かめる。
//
// | 軸 | 値 |
// | --- | --- |
// | 2 文字目 | / / \ / タブ / 空白 / 許可リストの文字 |
// | 3 文字目以降 | 無い / ホスト名に見える文字列 |
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { isRecord } from "../../lib/guards.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const ENV_URL = "http://localhost:5173";

function featurePathPattern(): RegExp {
  const schema: unknown = JSON.parse(
    readFileSync(
      join(repoRoot, "skills/browser-test/config-schemas/browser-test.schema.json"),
      "utf8",
    ),
  );
  const path = ["properties", "features", "items", "properties", "path", "pattern"].reduce<unknown>(
    (node, key) => (isRecord(node) ? node[key] : undefined),
    schema,
  );
  if (typeof path !== "string") throw new Error("features の path の pattern を読めない");
  // skill-config.mjs と同じ u フラグで作る。
  return new RegExp(path, "u");
}

const pattern = featurePathPattern();
const hostOf = (value: string) => new URL(value, ENV_URL).host;

describe("機能マップの path", () => {
  test.each(["/", "/settings", "/a/b?x=1#h", "/%2F%2Fevil", "/@evil.example"])(
    "%s は受け付け、環境のホストのまま開く",
    (value) => {
      expect(pattern.test(value)).toBe(true);
      expect(hostOf(value)).toBe("localhost:5173");
    },
  );

  test.each([
    { name: "2 文字目が /", value: "//evil.example/x" },
    { name: "2 文字目がバックスラッシュ", value: "/\\evil.example/x" },
    { name: "2 文字目がタブ", value: "/\t/evil.example" },
    { name: "2 文字目が空白", value: "/ /x" },
    { name: "途中にバックスラッシュ", value: "/a\\b" },
    { name: "/ で始まらない", value: "settings" },
  ])("$name の値は受け付けない", ({ value }) => {
    expect(pattern.test(value)).toBe(false);
  });

  test("受け付けた値は、2 文字目と 3 文字目の組み合わせによらず、環境のホストのまま開く", () => {
    const chars = Array.from("Ab0._~!$&'()*+,;=:@%-/?#\\\t ");
    const accepted: string[] = [];
    for (const a of chars)
      for (const b of chars)
        for (const rest of ["", "evil.example"]) {
          const value = `/${a}${b}${rest}`;
          if (pattern.test(value)) accepted.push(value);
        }
    // 0 件だと何も確かめていないので、受け付けた値があることも確かめる。
    expect(accepted.length).toBeGreaterThan(100);
    expect(accepted.filter((v) => hostOf(v) !== "localhost:5173")).toEqual([]);
  });
});
