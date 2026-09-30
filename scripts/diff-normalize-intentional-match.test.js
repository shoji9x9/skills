// parity-diff の意図的差異レジストリが構造化した照合キー（match）で当たることの回帰テスト（Issue #496）。
//
// 照合が「宣言の文全体が差分の "<name> <prop>" に含まれるか」だけだったため、理由を添えた宣言
// （書くべきとされている形）は原理的に一度も当たらず、登録済みの差分も unexplained のまま残っていた。
// 照合は match（element / property は必須、page / state / viewport は任意）で行い、散文の item は人が読む。
// match の欠けたキーは「どれにでも合う」ではなく照合に使わない（fail-closed）。散文だけの宣言が
// 当たらなかったことは stderr に数えて出す（宣言の書き方の誤りと本物の未説明の差を区別するため）。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-diff/scripts/diff-normalize.mjs");
const {
  matchIntentional,
  intentionalEntryMatch,
  validateIntentionalDiffs,
  countMatchesMissingCtx,
} = await import(script);

const ctx = { page: "main", state: "default", viewport: "1280x800" };

/** 実測の形: 理由を添えた文の宣言（Issue #496 の再現手順 1）。 */
const PROSE = "heading の border-style: 現行 none・新側 solid。幅は両側 0px で描かれない";

const borderDiff = { name: "heading", kind: "property", prop: "border-top-style" };

const declared = (match, item = PROSE) => ({ item, match });

test("理由を添えた散文の宣言は、match があれば当たる", () => {
  const registry = {
    may_change: [declared({ element: "heading", property: "border-*-style" })],
  };
  expect(matchIntentional(borderDiff, registry, ctx)).toEqual({
    group: "may_change",
    entry: PROSE,
    index: 0,
    by: "match",
  });
});

test("match の無い散文の宣言は当たらない（修正前の再現。文全体の包含でしか照合されない）", () => {
  expect(matchIntentional(borderDiff, { may_change: [PROSE] }, ctx)).toBeNull();
  expect(matchIntentional(borderDiff, { may_change: [{ item: PROSE }] }, ctx)).toBeNull();
});

test("短い散文の宣言は従来どおり文全体の包含で当たる（後方互換）", () => {
  expect(matchIntentional(borderDiff, { keep: ["heading border-top-style"] }, ctx)).toMatchObject({
    group: "keep",
    by: "text",
  });
});

test("match があるときは item の文面では照合しない（別要素の差分を吸収しない）", () => {
  // item の文面は "<name> <prop>" を含むが、match は別の要素を指す。
  const entry = declared(
    { element: "footer", property: "border-top-style" },
    "heading border-top-style",
  );
  expect(matchIntentional(borderDiff, { keep: [entry] }, ctx)).toBeNull();
});

test("element は論理名に対する完全一致・glob・幾何差分の対の両側で当たる", () => {
  const pairDiff = { name: "heading | toolbar", prop: "gap-y" };
  const hit = (element, d = borderDiff) =>
    matchIntentional(d, { keep: [declared({ element, property: d.prop })] }, ctx) !== null;
  expect(hit("heading")).toBe(true);
  expect(hit("head*")).toBe(true);
  expect(hit("head")).toBe(false); // glob でなければ前方一致で広がらない
  expect(hit("toolbar", pairDiff)).toBe(true);
  expect(hit("sidebar", pairDiff)).toBe(false);
});

test("property は完全一致か glob で当たり、別のプロパティには当たらない", () => {
  const hit = (property) =>
    matchIntentional(borderDiff, { keep: [declared({ element: "heading", property })] }, ctx) !==
    null;
  expect(hit("border-top-style")).toBe(true);
  expect(hit("BORDER-TOP-STYLE")).toBe(true);
  expect(hit("border-*")).toBe(true);
  expect(hit("border-top")).toBe(false);
  expect(hit("margin-*")).toBe(false);
});

test("page / state / viewport は書いたときだけ実行の組と突き合わせる", () => {
  const hit = (extra, runCtx = ctx) =>
    matchIntentional(
      borderDiff,
      { keep: [declared({ element: "heading", property: "border-top-style", ...extra })] },
      runCtx,
    ) !== null;
  expect(hit({})).toBe(true);
  expect(hit({ page: "main" })).toBe(true);
  expect(hit({ page: "detail" })).toBe(false);
  expect(hit({ viewport: "1280x800" })).toBe(true);
  expect(hit({ viewport: "375x812" })).toBe(false);
  expect(hit({ state: "hover" })).toBe(false);
  // state は両側で既定値 default を補う。
  expect(hit({ state: "default" }, { page: "main", viewport: "1280x800" })).toBe(true);
  // 実行側に page / viewport が無ければ、書いた宣言はどの組の差分か確かめられないので当たらない。
  expect(hit({ page: "main" }, { viewport: "1280x800" })).toBe(false);
  expect(hit({ viewport: "1280x800" }, { page: "main" })).toBe(false);
});

test("壊れた match は照合に使わない（欠けたキーはワイルドカードにならない）", () => {
  const broken = [
    { item: PROSE, match: null },
    { item: PROSE, match: "heading border-top-style" },
    { item: PROSE, match: [] },
    declared({ property: "border-top-style" }),
    declared({ element: "heading" }),
    declared({ element: "", property: "border-top-style" }),
    declared({ element: "heading", property: "   " }),
    declared({ element: "heading", property: "border-top-style", page: "" }),
    declared({ element: "heading", property: "border-top-style", page: 1 }),
    declared({ element: "heading", property: "border-top-style", selector: ".h1" }),
  ];
  for (const entry of broken) {
    expect(intentionalEntryMatch(entry)).toHaveProperty("invalid");
    expect(matchIntentional(borderDiff, { keep: [entry] }, ctx)).toBeNull();
  }
  expect(validateIntentionalDiffs({ keep: broken })).toHaveLength(broken.length);
});

test("item の無い match だけの宣言は照合に使わない（どの宣言で許容したかを追えない）", () => {
  for (const entry of [
    { match: { element: "heading", property: "border-top-style" } },
    { item: "  ", match: { element: "heading", property: "border-top-style" } },
  ]) {
    expect(intentionalEntryMatch(entry)).toEqual({
      invalid: "missing item (the prose declaration is required alongside match)",
    });
    expect(matchIntentional(borderDiff, { keep: [entry] }, ctx)).toBeNull();
  }
});

test("健全な宣言・散文だけの宣言は警告しない（0 件・非配列も含む）", () => {
  expect(
    validateIntentionalDiffs({
      keep: [
        PROSE,
        { item: PROSE },
        declared({ element: "heading", property: "border-top-style" }),
      ],
      may_change: [],
    }),
  ).toEqual([]);
  expect(validateIntentionalDiffs({})).toEqual([]);
  expect(validateIntentionalDiffs(undefined)).toEqual([]);
});

test("pending の要素も match で当たり、分類の群の優先順は keep → may_change → pending", () => {
  const match = { element: "heading", property: "border-top-style" };
  const pending = {
    item: PROSE,
    match,
    slug: "orders",
    added_by: "parity-replace",
    added_at: "2026-09-27",
  };
  expect(matchIntentional(borderDiff, { pending: [pending] }, ctx)).toMatchObject({
    group: "pending",
  });
  expect(
    matchIntentional(borderDiff, { may_change: [declared(match)], pending: [pending] }, ctx),
  ).toMatchObject({ group: "may_change" });
});

/** CLI を 1 回走らせる（分類・終了コード・stderr は同じ実行の観測でしか結び付かない）。 */
function runCli(intentional, diffs, ctxArgs = ["--page", "main", "--viewport", "1280x800"]) {
  const dir = makeTempDir("diff-normalize-intentional-");
  const registries = join(dir, "registries.json");
  const input = join(dir, "diffs.json");
  writeFileSync(
    registries,
    JSON.stringify({
      intentional_diffs: { keep: [], may_change: [], pending: [], ...intentional },
      component_diffs: [],
      component_diff_exceptions: [],
      component_diff_exception_causes: [],
    }),
  );
  writeFileSync(input, JSON.stringify(diffs));
  const r = spawnSync(
    process.execPath,
    [script, input, "--registries", registries, "--slug", "demo", ...ctxArgs],
    { encoding: "utf8" },
  );
  return { status: r.status, stderr: r.stderr, classified: JSON.parse(r.stdout) };
}

const fontDiff = {
  name: "grid-header",
  kind: "property",
  prop: "font-family",
  expected: "Roboto",
  actual: "roboto",
};

test("CLI: match で当たった宣言の差分は absorbed_registry で exit 0（陽性コントロール）", () => {
  const r = runCli(
    { may_change: [declared({ element: "heading", property: "border-top-style" })] },
    [borderDiff],
  );
  expect(r.classified[0].classification).toBe("absorbed_registry");
  expect(r.classified[0].matched_rule).toBe(`intentional_diffs.may_change: ${PROSE}`);
  expect(r.status).toBe(0);
  expect(r.stderr).not.toContain("intentional_diffs");
});

test("CLI: 散文だけの宣言が当たらず未説明が残れば、件数を stderr に出す", () => {
  const r = runCli({ may_change: [PROSE, "grid-header font-family"] }, [borderDiff, fontDiff]);
  expect(r.classified.map((d) => d.classification)).toEqual(["unexplained", "absorbed_registry"]);
  expect(r.stderr).toContain(
    "warning: intentional_diffs: 1 of 2 prose-only declaration(s) (no match key) matched none of the 2 diff(s) while 1 remain unexplained",
  );
  expect(r.status).toBe(1);
});

test("CLI: 未説明が残らなければ、使われなかった散文の宣言があっても警告しない", () => {
  const r = runCli({ may_change: [PROSE, "grid-header font-family"] }, [fontDiff]);
  expect(r.status).toBe(0);
  expect(r.stderr).not.toContain("prose-only");
});

test("CLI: 壊れた match は黙って無効化せず stderr へ警告を出す", () => {
  const r = runCli({ keep: [declared({ property: "border-top-style" })] }, [borderDiff]);
  expect(r.stderr).toContain(
    "warning: intentional_diffs.keep[0]: missing match.element — not used for matching",
  );
  expect(r.classified[0].classification).toBe("unexplained");
  expect(r.status).toBe(1);
});

test("page / viewport を書いた宣言は、実行側にその軸が無ければ数える（当たりようがない）", () => {
  const registry = {
    keep: [
      declared({ element: "heading", property: "border-top-style", page: "main" }),
      declared({ element: "heading", property: "border-top-style", viewport: "1280x800" }),
      declared({ element: "heading", property: "border-top-style" }),
      declared({ property: "border-top-style", page: "main" }), // 壊れた match は別の警告で出るので数えない
      PROSE,
    ],
  };
  expect(countMatchesMissingCtx(registry, {})).toBe(2);
  expect(countMatchesMissingCtx(registry, { page: "main" })).toBe(1);
  expect(countMatchesMissingCtx(registry, { page: "main", viewport: "1280x800" })).toBe(0);
});

test("CLI: --page を省くと、match.page を書いた宣言が当たらないことを stderr に出す", () => {
  const entry = declared({ element: "heading", property: "border-top-style", page: "main" });
  const r = runCli({ may_change: [entry] }, [borderDiff], ["--viewport", "1280x800"]);
  expect(r.classified[0].classification).toBe("unexplained");
  expect(r.stderr).toContain(
    "warning: --page not given; 1 intentional_diffs declaration(s) with match.page / match.viewport cannot be matched (fail-closed)",
  );
  const ok = runCli({ may_change: [entry] }, [borderDiff]);
  expect(ok.stderr).not.toContain("intentional_diffs declaration(s) with match.page");
});
