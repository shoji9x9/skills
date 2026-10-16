// parity-diff の component_diffs T が要素（component）で照合されることの回帰テスト（Issue #273）。
//
// 照合が property ＋ 値だけで行われていたため、ある要素のために宣言した T が
// 値の偶然一致する別要素の差分にも当たっていた。結果は 2 つの誤分類で、前者が重大:
//   - 偽陰性: 別要素の本物の回帰を absorbed_T として吸収し、exit 0 で収束条件を満たしてしまう
//   - 偽陽性: 別要素の差分を unexplained から deviates_T（未修正回帰）へ格上げする
//
// 照合キーの欠落は「どの要素にも合う」ではなく不一致として扱う。警告なしに無効化せず、
// stderr の警告として出すところまでを固定する（警告が無いと、吸収されたのか
// 掛からなかったのかが宣言側から見えない）。
//
// 分岐ごとの入力は、照合の純関数を同じプロセスで呼んで確かめる。戻り値は CLI の出力の一部と同じ意味を持つ。
// 対応は次のとおりである。
//   - matchComponentT の status と rule: classification と matched_rule
//   - matchException の戻り値: absorbed_exception の matched_rule
//   - matchNoise の trait_diffs: noise_candidate の matched_rule の数
//   - validateComponentDiffs・validateNoiseBaseline の各行: stderr の warning 行
//   - matchesComponentPattern: その宣言が matched_rule に入るか
// 終了コードと stderr は、CLI を子プロセスで起動して数件だけ確かめる。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { invalidInput } from "../../lib/testing/test-input.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import {
  matchComponentT,
  matchException,
  matchNoise,
  matchesComponentPattern,
  validateComponentDiffs,
  validateNoiseBaseline,
} from "../../../skills/parity-diff/scripts/diff-normalize.mjs";
import type { ComponentDiff } from "../../../skills/parity-diff/scripts/diff-normalize.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/parity-diff/scripts/diff-normalize.mjs");

/** margin-top: 0px → 2px を 1 要素（filter-popup）にだけ宣言した T。 */
const popupT = {
  component: "filter-popup",
  property: "margin-top",
  current: "0px",
  new: "2px",
  reason: "popup only",
};

const diff = (name: string, actual: string) => ({
  name,
  prop: "margin-top",
  expected: "0px",
  actual,
});

type Classified = { classification: string; matched_rule: unknown };

const CTX_ARGS = ["--page", "main", "--viewport", "1280x800"];

/**
 * registries.json と Diff の配列を書いて CLI を 1 回実行する。分類・終了コード・stderr は
 * 同じ実行の観測でしか結び付かない（関数単体では exit code も警告も出ない）。
 */
function runRaw(registries: unknown, diffs: unknown, args: string[] = CTX_ARGS) {
  const dir = makeTempDir("diff-normalize-");
  const registriesPath = join(dir, "registries.json");
  const input = join(dir, "diffs.json");
  writeFileSync(registriesPath, JSON.stringify(registries));
  writeFileSync(input, JSON.stringify(diffs));
  const r = spawnSync(
    process.execPath,
    [script, input, "--registries", registriesPath, "--slug", "demo", ...args],
    { encoding: "utf8", timeout: 30_000 },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** component_diffs だけを持つ registries.json で実行し、分類を読む。 */
function runCli(componentDiffs: unknown, diffs: unknown[]) {
  const r = runRaw(
    {
      intentional_diffs: { keep: [], may_change: [], pending: [] },
      component_diffs: componentDiffs,
      component_diff_exceptions: [],
      component_diff_exception_causes: [],
    },
    diffs,
  );
  return { status: r.status, stderr: r.stderr, classified: parseJsonAs<Classified[]>(r.stdout) };
}

test("宣言した要素が T から逸脱していれば deviates_T として浮かせる", () => {
  expect(matchComponentT(diff("filter-popup", "5.2969px"), [popupT])).toEqual({
    status: "deviates_T",
    rule: popupT,
  });
});

test("別要素の逸脱値を deviates_T へ格上げしない（偽陽性: 無関係な宣言で回帰扱いになる）", () => {
  expect(matchComponentT(diff("clear-button", "5.2969px"), [popupT])).toBeNull();
});

test("glob は前方一致の複数インスタンスに当たり、範囲外の要素には当たらない", () => {
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

test("component の欠落・空は wildcard ではなく不一致（欠けたら一致しないとして扱う）", () => {
  for (const component of [undefined, "", "   "]) {
    const t = invalidInput<ComponentDiff>({ ...popupT, component });
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
  expect(validateComponentDiffs(invalidInput(undefined))).toEqual([]);
  expect(validateComponentDiffs([{ ...popupT, component: undefined }])).toEqual([
    expect.stringContaining("component_diffs[0]: missing component — not used for matching"),
  ]);
  expect(validateComponentDiffs([popupT, invalidInput<object>(null)])).toEqual([
    "component_diffs[1]: not an object",
  ]);
});

test("CLI: 別要素の回帰は unexplained として残り exit 1 になる（収束条件を満たさない）", () => {
  const r = runCli([popupT], [diff("clear-button", "2px")]);
  expect(r.classified[0].classification).toBe("unexplained");
  expect(r.classified[0].matched_rule).toBeNull();
  expect(r.status).toBe(1);
});

test("CLI: 宣言した要素の差分は absorbed_T で exit 0（誤検知しないことの確認）", () => {
  const r = runCli([popupT], [diff("filter-popup", "2px")]);
  expect(r.classified[0].classification).toBe("absorbed_T");
  expect(r.classified[0].matched_rule).toEqual(popupT);
  expect(r.status).toBe(0);
});

test("CLI: component を欠いた宣言は警告なしに無効化せず stderr へ警告を出す", () => {
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

test("インスタンス例外の object でない要素は照合に使わず、後ろの例外で照合を続ける", () => {
  const ex = {
    slug: "demo",
    page: "main",
    viewport: "1280x800",
    element: "filter-popup",
    property: "margin-top",
    current: "0px",
    new: "2px",
    cause: "c1",
  };
  const causes = [{ id: "c1", reason: "popup only", evidence: "ticket-1" }];
  const ctx = { slug: "demo", page: "main", viewport: "1280x800" };
  expect(matchException(diff("filter-popup", "2px"), [null, "x", ex], ctx, causes)).toEqual({
    ...ex,
    cause_reason: "popup only",
    cause_evidence: "ticket-1",
  });
});

// 原因を解決できない例外と、根拠（evidence）が空の原因を指す例外は、照合に使わない（根拠の無い吸収をしない）。
test.each([
  ["cause が無い", { cause: undefined }, [{ id: "c1", reason: "r", evidence: "e" }]],
  ["cause が空文字", { cause: "" }, [{ id: "", reason: "r", evidence: "e" }]],
  ["cause が文字列でない", { cause: 1 }, [{ id: 1, reason: "r", evidence: "e" }]],
  ["causes に同じ id が無い", { cause: "c1" }, [{ id: "c2", reason: "r", evidence: "e" }]],
  ["evidence が空白だけ", { cause: "c1" }, [{ id: "c1", reason: "r", evidence: "  " }]],
  ["evidence が文字列でない", { cause: "c1" }, [{ id: "c1", reason: "r", evidence: 1 }]],
  ["causes が配列でない", { cause: "c1" }, { c1: { reason: "r", evidence: "e" } }],
])("インスタンス例外の原因を解決できない（%s）なら、照合に使わない", (_case, cause, causes) => {
  const ex = {
    slug: "demo",
    page: "main",
    viewport: "1280x800",
    element: "filter-popup",
    property: "margin-top",
    current: "0px",
    new: "2px",
    ...cause,
  };
  const ctx = { slug: "demo", page: "main", viewport: "1280x800" };
  expect(matchException(diff("filter-popup", "2px"), [ex], ctx, causes)).toBeNull();
});

test("インスタンス例外の原因の reason が文字列でなければ、空の reason で照合する（根拠があれば使う）", () => {
  const ex = {
    slug: "demo",
    page: "main",
    viewport: "1280x800",
    element: "filter-popup",
    property: "margin-top",
    current: "0px",
    new: "2px",
    cause: "c1",
  };
  const causes = [{ id: "c1", reason: 1, evidence: " ticket-1 " }];
  const ctx = { slug: "demo", page: "main", viewport: "1280x800" };
  expect(matchException(diff("filter-popup", "2px"), [ex], ctx, causes)).toEqual({
    ...ex,
    cause_reason: "",
    cause_evidence: "ticket-1",
  });
});

test.each([
  ["null", null],
  ["文字列", "x"],
  ["配列", []],
])("ノイズ基準値の object でない行（%s）は照合に使わず、後ろの行で照合を続ける", (_name, bad) => {
  expect(matchNoise([bad, { page: "main", trait_diffs: 3 }], { page: "main" })).toEqual({
    trait_diffs: 3,
  });
  // 軸を指定しない実行でも、object でない行を最初の行として当てない（後ろの正しい行を隠さない）。
  expect(matchNoise([bad, { trait_diffs: 3 }], {})).toEqual({ trait_diffs: 3 });
  expect(validateNoiseBaseline([{ trait_diffs: 3 }, bad])).toEqual([
    "noise_baseline[1]: not an object — not used for matching",
  ]);
});

test("CLI: object でない要素を含む Diff の配列は入力エラー（exit 2）にする", () => {
  const r = runRaw({ component_diffs: [popupT] }, [diff("filter-popup", "2px"), null], []);
  expect(r.stderr).toContain("<trait-diffs.json> must be a JSON array of trait diffs");
  expect(r.status).toBe(2);
});
