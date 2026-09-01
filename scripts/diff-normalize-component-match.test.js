// parity-diff の component_diffs T が要素（component）で照合されることの回帰テスト（Issue #273）。
//
// 照合が property ＋ 値だけで行われていたため、ある要素のために宣言した T が
// 値の偶然一致する別要素の差分にも当たっていた。結果は 2 つの誤分類で、前者が重大:
//   - 偽陰性: 別要素の本物の回帰を absorbed_T として吸収し、exit 0 で収束条件を満たしてしまう
//   - 偽陽性: 別要素の差分を unexplained から deviates_T（未修正回帰）へ格上げする
//
// 照合キーの欠落は「どの要素にも合う」ではなく不一致（fail-closed）。黙って無効化せず
// stderr の警告として出すところまでを固定する（警告が無いと、吸収されたのか
// 掛からなかったのかが宣言側から見えない）。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-diff/scripts/diff-normalize.mjs");
const { matchComponentT, matchesComponentPattern, validateComponentDiffs } = await import(script);

/** margin-top: 0px → 2px を 1 要素（filter-popup）にだけ宣言した T。 */
const popupT = {
  component: "filter-popup",
  property: "margin-top",
  current: "0px",
  new: "2px",
  reason: "popup only",
};

const diff = (name, actual) => ({ name, prop: "margin-top", expected: "0px", actual });

test("宣言した要素の差分は従来どおり吸収する（照合が死んでいないことの陽性コントロール）", () => {
  expect(matchComponentT(diff("filter-popup", "2px"), [popupT])).toEqual({
    status: "absorbed_T",
    rule: popupT,
  });
});

test("宣言した要素が T から逸脱していれば deviates_T として浮かせる", () => {
  expect(matchComponentT(diff("filter-popup", "5.2969px"), [popupT])).toEqual({
    status: "deviates_T",
    rule: popupT,
  });
});

test("別要素の同値の差分を吸収しない（偽陰性: 回帰を抱えたまま収束する）", () => {
  expect(matchComponentT(diff("clear-button", "2px"), [popupT])).toBeNull();
});

test("別要素の逸脱値を deviates_T へ格上げしない（偽陽性: 無関係な宣言で回帰扱いになる）", () => {
  expect(matchComponentT(diff("clear-button", "5.2969px"), [popupT])).toBeNull();
});

test("glob は前方一致の複数インスタンスに効き、範囲外の要素には効かない", () => {
  const globT = { ...popupT, component: "filter-popup-*" };
  expect(matchComponentT(diff("filter-popup-clear", "2px"), [globT])).not.toBeNull();
  expect(matchComponentT(diff("filter-popup-body", "2px"), [globT])).not.toBeNull();
  expect(matchComponentT(diff("clear-button", "2px"), [globT])).toBeNull();
  // glob 無しは完全一致。前方一致で広がらない。
  expect(matchesComponentPattern("filter-popup", "filter-popup-clear")).toBe(false);
});

test("glob 以外の正規表現メタ文字はリテラルとして扱う", () => {
  expect(matchesComponentPattern("a.b", "axb")).toBe(false);
  expect(matchesComponentPattern("a.b", "a.b")).toBe(true);
  expect(matchesComponentPattern("btn(1)", "btn(1)")).toBe(true);
  expect(matchesComponentPattern("a*c", "a.b.c")).toBe(true);
});

test('幾何差分の name（"A | B" の対）は両側を照合候補にする', () => {
  expect(matchesComponentPattern("filter-popup", "filter-popup | clear-button")).toBe(true);
  expect(matchesComponentPattern("clear-button", "filter-popup | clear-button")).toBe(true);
  expect(matchesComponentPattern("submit-button", "filter-popup | clear-button")).toBe(false);
});

test("component の欠落・空は wildcard ではなく不一致（fail-closed）", () => {
  for (const component of [undefined, "", "   "]) {
    const t = { ...popupT, component };
    expect(matchComponentT(diff("filter-popup", "2px"), [t])).toBeNull();
    expect(matchComponentT(diff("clear-button", "2px"), [t])).toBeNull();
  }
});

test("論理名を持たない Diff には掛からない", () => {
  expect(matchComponentT({ ...diff("filter-popup", "2px"), name: undefined }, [popupT])).toBeNull();
});

test("照合に使えない宣言は理由付きで列挙する（0 件・非オブジェクトも含む）", () => {
  expect(validateComponentDiffs([popupT])).toEqual([]);
  expect(validateComponentDiffs([])).toEqual([]);
  expect(validateComponentDiffs(undefined)).toEqual([]);
  expect(validateComponentDiffs([{ ...popupT, component: undefined }])).toEqual([
    expect.stringContaining("component_diffs[0]: missing component — not used for matching"),
  ]);
  expect(validateComponentDiffs([popupT, null])).toEqual(["component_diffs[1]: not an object"]);
});

/**
 * CLI を 1 回走らせる。分類・終了コード・stderr は同じ実行の観測でしか結び付かない
 * （関数単体では exit code も警告も出ない）。
 */
function runCli(componentDiffs, diffs) {
  const dir = mkdtempSync(join(tmpdir(), "diff-normalize-"));
  const registries = join(dir, "registries.json");
  const input = join(dir, "diffs.json");
  writeFileSync(
    registries,
    JSON.stringify({
      intentional_diffs: { keep: [], may_change: [], pending: [] },
      component_diffs: componentDiffs,
      component_diff_exceptions: [],
      component_diff_exception_causes: [],
    }),
  );
  writeFileSync(input, JSON.stringify(diffs));
  const r = spawnSync(
    process.execPath,
    [
      script,
      input,
      "--registries",
      registries,
      "--slug",
      "demo",
      "--page",
      "main",
      "--viewport",
      "1280x800",
    ],
    { encoding: "utf8" },
  );
  return { status: r.status, stderr: r.stderr, classified: JSON.parse(r.stdout) };
}

test("CLI: 別要素の回帰は unexplained として残り exit 1 になる（収束条件を満たさない）", () => {
  const r = runCli([popupT], [diff("clear-button", "2px")]);
  expect(r.classified[0].classification).toBe("unexplained");
  expect(r.classified[0].matched_rule).toBeNull();
  expect(r.status).toBe(1);
});

test("CLI: 宣言した要素の差分は absorbed_T で exit 0（陽性コントロール）", () => {
  const r = runCli([popupT], [diff("filter-popup", "2px")]);
  expect(r.classified[0].classification).toBe("absorbed_T");
  expect(r.status).toBe(0);
});

test("CLI: component を欠いた宣言は黙って無効化せず stderr へ警告を出す", () => {
  const r = runCli([{ ...popupT, component: undefined }], [diff("filter-popup", "2px")]);
  expect(r.stderr).toContain(
    "warning: component_diffs[0]: missing component — not used for matching",
  );
  expect(r.classified[0].classification).toBe("unexplained");
  expect(r.status).toBe(1);
});

test("CLI: 宣言が健全なら component_diffs の警告は出ない", () => {
  const r = runCli([popupT], [diff("filter-popup", "2px")]);
  expect(r.stderr).not.toContain("component_diffs[");
});
