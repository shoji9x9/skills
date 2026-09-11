import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// absent セルの証拠スキーマは、記録側（parity-suite の coverage-expand.mjs）と
// 収束判定側（parity-diff の coverage-check.mjs）の 2 つの独立したゲートが検査する。
// 配布スキルは実行時に参照する成果物を自分の中に同梱する規約のため共有モジュールに
// できず、実体が複製される。片方だけ直すと「記録側は通すが収束側が弾く」（またはその逆）
// が起き、被覆表を作った側は conformance を得たのに収束できない状態になる。
//
// 抽出はソースの構文解析ではなく**明示マーカーの探索**で行う。波括弧やセミコロンを
// 数える方式は、文字列・テンプレートリテラル・正規表現・コメント内の同じ文字で
// 途中終了しうる——そして両コピーが同じ前半を共有していれば、切り詰められた範囲だけを
// 比較して「一致」と報告する（分岐した後半を黙って見逃す fail-open）。マーカー方式なら
// 抽出範囲がソースの字句に依存しない。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const START = "// ===== absence-evidence-contract:start =====";
const END = "// ===== absence-evidence-contract:end =====";

const SOURCES = {
  "coverage-check": join(repoRoot, "skills/parity-diff/scripts/coverage-check.mjs"),
  "coverage-expand": join(repoRoot, "skills/parity-suite/scripts/coverage-expand.mjs"),
};

/** 契約領域に必ず含まれるはずの要素（抽出が空振り・切り詰めしていないことの陽性コントロール）。 */
const REQUIRED_MEMBERS = [
  "const APPLICABLE_STATE_SOURCE_KINDS =",
  "const FIRED_ACTION_METHODS =",
  "const FIRED_SIGNALS =",
  "function inAllowlist(",
  "function firedEvidenceProblem(",
  "function absentEvidenceProblem(",
];

/**
 * マーカーで囲まれた契約領域を切り出す。マーカーが欠落・重複・逆順のときは、
 * 「一致」へ倒さず投げる（検査が動いていない状態を合格にしない）。
 * @param {string} source
 * @param {string} tool
 * @returns {string}
 */
function contractRegion(source, tool) {
  const starts = source.split(START).length - 1;
  const ends = source.split(END).length - 1;
  if (starts !== 1 || ends !== 1) {
    throw new Error(`${tool}: 契約マーカーが 1 組ではない（start=${starts} end=${ends}）`);
  }
  const from = source.indexOf(START);
  const to = source.indexOf(END);
  if (to < from) throw new Error(`${tool}: 契約マーカーが逆順`);
  return source.slice(from, to + END.length);
}

const regions = Object.fromEntries(
  Object.entries(SOURCES).map(([tool, path]) => [
    tool,
    contractRegion(readFileSync(path, "utf8"), tool),
  ]),
);

test.each(Object.keys(SOURCES))(
  "陽性コントロール: %s の契約領域が実体を含む（空振り・切り詰めを一致と報告しない）",
  (tool) => {
    // 長さの下限は置かない。契約の意味ではなく実装サイズに依存し、コメント整理や
    // 共通化だけで落ちる。空振り・切り詰めは REQUIRED_MEMBERS と構文検査が捕まえる。
    const region = regions[tool];
    for (const member of REQUIRED_MEMBERS) {
      expect(region, `${tool} に ${member} が無い`).toContain(member);
    }
  },
);

test.each(Object.keys(SOURCES))(
  "陽性コントロール: %s の契約領域が構文として閉じている（途中で切れた範囲を比較しない）",
  (tool) => {
    // 終了マーカーを関数本体の途中へ移すと、領域は同じ前半を共有したまま短くなる。
    // 「END で終わるか」は contractRegion が END まで切り出す以上つねに真で何も示さない。
    // コンパイルできるかで終端を検証する（実行はしない）。切り詰められた領域は必ず構文エラーになる。
    expect(() => new Script(regions[tool], { filename: `${tool}-contract.js` })).not.toThrow();
  },
);

test("absent 証拠スキーマの契約は両ゲートで同一である", () => {
  const [a, b] = Object.values(regions);
  expect(a).toBe(b);
});
