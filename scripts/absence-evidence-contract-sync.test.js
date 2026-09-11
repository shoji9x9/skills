import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// absent セルの証拠スキーマは、記録側（parity-suite の coverage-expand.mjs）と
// 収束判定側（parity-diff の coverage-check.mjs）の 2 つの独立したゲートが検査する。
// 配布スキルは実行時に参照する成果物を自分の中に同梱する規約のため共有モジュールに
// できず、実体が複製される。片方だけ直すと「記録側は通すが収束側が弾く」（またはその逆）
// が起き、被覆表を作った側は conformance を得たのに収束できない状態になる。
// ここで両者の契約部分がバイト単位で一致することを決定論的に検査する。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCES = {
  "coverage-check": join(repoRoot, "skills/parity-diff/scripts/coverage-check.mjs"),
  "coverage-expand": join(repoRoot, "skills/parity-suite/scripts/coverage-expand.mjs"),
};

/** 契約を構成する関数（実装がそのまま検査規則）。 */
const SHARED_FUNCTIONS = ["absentEvidenceProblem", "firedEvidenceProblem"];

/** 契約の語彙（どちらか片方だけ広げると受理範囲がずれる）。 */
const SHARED_CONSTANTS = ["APPLICABLE_STATE_SOURCE_KINDS", "FIRED_ACTION_METHODS", "FIRED_SIGNALS"];

/**
 * 名前付き関数の本体を波括弧の対応で切り出す。行頭 "}" 決め打ちだと、
 * 本文中の文字列・テンプレートリテラルが増えたときに黙って短く切れる。
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`関数 ${name} が見つからない`);
  const open = source.indexOf("{", start);
  if (open === -1) throw new Error(`関数 ${name} の本体が見つからない`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`関数 ${name} の波括弧が閉じていない`);
}

/**
 * `const NAME = ...;` の宣言行を切り出す。
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
function constantDeclaration(source, name) {
  const start = source.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`定数 ${name} が見つからない`);
  const end = source.indexOf(";", start);
  if (end === -1) throw new Error(`定数 ${name} の宣言が閉じていない`);
  return source.slice(start, end + 1);
}

const sources = Object.fromEntries(
  Object.entries(SOURCES).map(([name, path]) => [name, readFileSync(path, "utf8")]),
);

test("陽性コントロール: 契約の抽出が実体を捉えている（空振りで一致と報告しない）", () => {
  for (const [tool, source] of Object.entries(sources)) {
    for (const fn of SHARED_FUNCTIONS) {
      const body = functionBody(source, fn);
      expect(body.length, `${tool} の ${fn}`).toBeGreaterThan(500);
      expect(body, `${tool} の ${fn}`).toContain("return null;");
    }
    for (const name of SHARED_CONSTANTS) {
      expect(constantDeclaration(source, name), `${tool} の ${name}`).toContain("[");
    }
  }
});

test.each(SHARED_FUNCTIONS)("%s は両ゲートで同一実装である", (fn) => {
  const [a, b] = Object.values(sources).map((source) => functionBody(source, fn));
  expect(a).toBe(b);
});

test.each(SHARED_CONSTANTS)("%s は両ゲートで同一語彙である", (name) => {
  const [a, b] = Object.values(sources).map((source) => constantDeclaration(source, name));
  expect(a).toBe(b);
});
