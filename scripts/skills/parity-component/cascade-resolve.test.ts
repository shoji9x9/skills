// css-rules.json のカスケード解決の回帰テスト（Issue #433）。
//
// 実装が見落としていたのは次の 2 つの形である。
//   - `!important` の無いインラインが、`!important` 付き規則に負ける（button の width 10px vs 25px）
//   - 同一セレクタ・同一プロパティを後段のテーマが再宣言して上書きする
//     （radio-button の box-shadow、feedback-message の top / opacity）
// どちらも「最初に見つかった宣言を採る」読み方だと実際の描画と逆になる。
// 各テストは「正しい勝者」と併せて「素朴な読み方なら別の値になる」ことも確かめる
// （負けた側が losers に残らない入力で測ると、この検査は何も実証しない）。

import { assert, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import {
  VERSION,
  resolveCascade,
  specificity,
  statesOutsideSubject,
  UndecidableSelector,
} from "../../../skills/parity-component/scripts/cascade-resolve.mjs";
import type { CascadeResult } from "../../../skills/parity-component/scripts/cascade-resolve.mjs";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/parity-component/scripts/cascade-resolve.mjs");

type Decl = { property: string; value: string; important: boolean };
// CLI の出力のうち、テストが読む欄（形は expect で確かめる）。
type CliReport = { results: { winner: { value: unknown } }[]; counts: { undecidable: number } };
type RuleInput = {
  // 省くと並び順の番号を入れる。null を渡すと、order を読めない規則（cascade-resolve.mjs が null にする）を作る。
  order?: number | null;
  selector: string;
  states?: string[];
  pseudo_element?: string | null;
  conditions?: string[];
  layers?: string[];
  href?: string | null;
  declarations: Decl[];
};
type DocInput = {
  matched?: RuleInput[];
  inline?: Decl[];
  unresolved?: unknown[];
  inaccessible?: unknown[];
};
type CssRulesDoc = {
  name: string;
  tool_version: string;
  matched: unknown[];
  unresolved: unknown[];
  inaccessible: unknown[];
  inline_declarations?: Decl[];
  shadow_host: boolean;
  slotted: boolean;
  counts: Record<string, unknown>;
  shadow_root: boolean;
};

/** css-rules-capture.mjs 相当の入力を組む（tool_version は実物の対応版に合わせる）。 */
function doc({
  matched = [],
  inline = [],
  unresolved = [],
  inaccessible = [],
}: DocInput = {}): CssRulesDoc {
  return {
    name: "component@instance",
    tool_version: "4",
    matched: matched.map((rule, index) => ({
      order: rule.order === undefined ? index : rule.order,
      selector: rule.selector,
      original_selector: rule.selector,
      states: rule.states ?? [],
      pseudo_element: rule.pseudo_element ?? null,
      conditions: rule.conditions ?? [],
      layers: rule.layers ?? [],
      href: rule.href ?? null,
      declarations: rule.declarations,
    })),
    unresolved,
    inaccessible,
    inline_declarations: inline,
    shadow_host: false,
    slotted: false,
    counts: {},
    shadow_root: false,
  };
}

const decl = (property: string, value: string, important = false): Decl => ({
  property,
  value,
  important,
});

function resolve(document: CssRulesDoc, property: string, states = ["default"]) {
  const report = resolveCascade(document, { states, properties: [property] });
  const result = report.results.find((r) => r.property === property);
  assert.exists(result, `${property} の結果が無い`);
  return result;
}

/** 勝者を返す。`winner` は resolved 以外で null なので、在ることを確かめる。 */
function winnerOf(result: CascadeResult) {
  assert.exists(result.winner, `${result.property} の勝者が無い（${result.status}）`);
  return result.winner;
}

test("VERSION を持つ", () => {
  expect(VERSION).toBe("3");
});

test("button: !important 付き規則がインラインの非 !important に勝つ", () => {
  // .replace/components/button/baseline/main-list-add-condition/default/css-rules.json の実測形。
  const input = doc({
    matched: [
      { order: 674, selector: ".SearchBoxButton", declarations: [decl("width", "25px", true)] },
    ],
    inline: [decl("width", "10px", false)],
  });
  const result = resolve(input, "width");
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("25px");
  expect(winnerOf(result).tier).toBe("rule !important");

  // 検出できることの確認: インラインだけを読む素朴な実装が採っていた値が、負けた側として残っている。
  expect(result.losers.map((l) => l.value)).toContain("10px");
});

test("インラインの非 !important は非 !important 規則には勝つ", () => {
  const input = doc({
    matched: [{ order: 674, selector: ".SearchBoxButton", declarations: [decl("width", "25px")] }],
    inline: [decl("width", "10px")],
  });
  const result = resolve(input, "width");
  expect(winnerOf(result).value).toBe("10px");
  expect(winnerOf(result).tier).toBe("inline");
});

test("インラインの !important は規則の !important にも勝つ", () => {
  const input = doc({
    matched: [{ order: 674, selector: "#a.b.c", declarations: [decl("width", "25px", true)] }],
    inline: [decl("width", "10px", true)],
  });
  expect(winnerOf(resolve(input, "width")).value).toBe("10px");
});

test("radio-button: 後段テーマの再宣言が勝つ（同一セレクタ・同一プロパティ）", () => {
  const input = doc({
    matched: [
      {
        order: 674,
        selector: ".radio-outer",
        href: "Theme.Patterns_SilkUI.css",
        declarations: [decl("box-shadow", "rgb(204, 204, 204) 0px 0px 0px 1px inset")],
      },
      {
        order: 1892,
        selector: ".radio-outer",
        href: "LiverpoolTheme/Theme.LiverpoolTheme.css",
        declarations: [decl("box-shadow", "none")],
      },
    ],
  });
  const result = resolve(input, "box-shadow");
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("none");
  expect(winnerOf(result).origin).toBe("LiverpoolTheme/Theme.LiverpoolTheme.css");
  // 検出できることの確認: 最初に見つかった宣言（新側が実装していた inset の影）は負けている。
  expect(result.losers[0].value).toMatch(/inset/);
});

test("feedback-message: 3 層の上書きで最後の層が勝つ（top / opacity）", () => {
  const input = doc({
    matched: [
      {
        order: 100,
        selector: ".close",
        href: "base.css",
        declarations: [decl("top", "0px"), decl("opacity", "1")],
      },
      {
        order: 674,
        selector: ".close",
        href: "Theme.Patterns_SilkUI.css",
        declarations: [decl("top", "2px")],
      },
      {
        order: 1892,
        selector: ".close",
        href: "LiverpoolTheme/Theme.LiverpoolTheme.css",
        declarations: [decl("top", "5px"), decl("opacity", "0.5")],
      },
    ],
  });
  expect(winnerOf(resolve(input, "top")).value).toBe("5px");
  expect(
    resolve(input, "top")
      .losers.map((l) => l.value)
      .sort(),
  ).toEqual(["0px", "2px"]);
  expect(winnerOf(resolve(input, "opacity")).value).toBe("0.5");
});

test("詳細度は出現順より強い（後勝ちだけで決めない）", () => {
  const input = doc({
    matched: [
      { order: 10, selector: "#main .btn", declarations: [decl("color", "red")] },
      { order: 900, selector: ".btn", declarations: [decl("color", "blue")] },
    ],
  });
  const result = resolve(input, "color");
  expect(winnerOf(result).value).toBe("red");
  expect(winnerOf(result).specificity).toEqual([1, 1, 0]);
});

test("状態擬似クラスは --state で門番する", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".btn", declarations: [decl("color", "blue")] },
      {
        order: 2,
        selector: ".btn:hover",
        states: ["hover"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  expect(winnerOf(resolve(input, "color", ["default"])).value).toBe("blue");
  expect(resolve(input, "color", ["default"]).state_gated).toBe(1);
  expect(winnerOf(resolve(input, "color", ["hover"])).value).toBe("green");
});

test("擬似要素は要素自身と別に解決し、インラインは擬似要素に入らない", () => {
  const input = doc({
    matched: [
      {
        order: 1,
        selector: ".btn::after",
        pseudo_element: "::after",
        declarations: [decl("color", "green")],
      },
      { order: 2, selector: ".btn", declarations: [decl("color", "blue")] },
    ],
    inline: [decl("color", "red")],
  });
  const report = resolveCascade(input, { states: ["default"], properties: ["color"] });
  const own = report.results.find((r) => r.pseudo_element === null);
  const after = report.results.find((r) => r.pseudo_element === "::after");
  assert.exists(own, "要素自身の結果が無い");
  assert.exists(after, "::after の結果が無い");
  expect(winnerOf(own).value).toBe("red");
  expect(winnerOf(after).value).toBe("green");
  expect(winnerOf(after).source).toBe("rule");
});

test.each([
  [
    "order が null の規則と order が 0 の規則",
    [
      { order: null, selector: ".btn", declarations: [decl("color", "blue")] },
      { order: 0, selector: ".btn", declarations: [decl("color", "green")] },
    ],
  ],
  [
    "order が 0 の規則と order が null の規則（並びが逆）",
    [
      { order: 0, selector: ".btn", declarations: [decl("color", "green")] },
      { order: null, selector: ".btn", declarations: [decl("color", "blue")] },
    ],
  ],
  [
    "order が両方 null の別の規則",
    [
      { order: null, selector: ".btn", declarations: [decl("color", "blue")] },
      { order: null, selector: ".btn", declarations: [decl("color", "green")] },
    ],
  ],
])(
  "同じ詳細度で order が null の規則が並ぶなら、勝者を選ばずに undecidable にする: %s",
  (_name, matched) => {
    const result = resolve(doc({ matched }), "color");
    expect(result.status).toBe("undecidable");
    expect(result.reasons.join(" ")).toMatch(/rule order of .* is missing/);
  },
);

test("order が null の規則でも、詳細度で勝ち負けが決まるなら resolved にする", () => {
  const stronger = resolve(
    doc({
      matched: [
        { order: 0, selector: ".btn", declarations: [decl("color", "green")] },
        { order: null, selector: "#ok", declarations: [decl("color", "blue")] },
      ],
    }),
    "color",
  );
  expect(winnerOf(stronger).value).toBe("blue");
  const weaker = resolve(
    doc({
      matched: [
        { order: null, selector: ".btn", declarations: [decl("color", "blue")] },
        { order: 0, selector: "#ok", declarations: [decl("color", "green")] },
      ],
    }),
    "color",
  );
  expect(winnerOf(weaker).value).toBe("green");
});

test("勝者と同じ詳細度の条件付きの候補の order が null なら、追い越しを判定できないので undecidable にする", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".btn", declarations: [decl("color", "blue")] },
      {
        order: null,
        selector: ".btn",
        conditions: ["(min-width: 768px)"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  // 条件が成り立つかではなく、order が無いことを理由に書く（利用者が @media を調べに行かないように）。
  expect(result.reasons.join(" ")).toMatch(/rule order of .*\.btn.* is missing/);
  expect(result.reasons.join(" ")).not.toMatch(/conditional/);
});

test("勝者の order が null で、同じ詳細度の条件付きの候補に order があっても、追い越しを判定できないので undecidable にする", () => {
  const input = doc({
    matched: [
      { order: null, selector: ".btn", declarations: [decl("color", "blue")] },
      {
        order: 3,
        selector: ".btn",
        conditions: ["(min-width: 768px)"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/rule order of .* is missing/);
});

test("有限の数でない order（NaN）は、読めない order として扱う", () => {
  const input = doc({
    matched: [
      { order: Number.NaN, selector: ".btn", declarations: [decl("color", "blue")] },
      { order: 0, selector: ".btn", declarations: [decl("color", "green")] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/rule order of .* is missing/);
});

test("order が null の 1 つの規則の中で同じプロパティを 2 回書いたなら、後に書いた宣言を勝者にする", () => {
  const input = doc({
    matched: [
      {
        order: null,
        selector: ".x",
        declarations: [decl("color", "red"), decl("color", "blue")],
      },
    ],
  });
  expect(winnerOf(resolve(input, "color")).value).toBe("blue");
});

test("order が null の 1 つの規則の中の後の `all` は、order ではなく `all` を理由に undecidable にする", () => {
  const input = doc({
    matched: [
      {
        order: null,
        selector: ".x",
        declarations: [decl("color", "red"), decl("all", "unset")],
      },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/`all`/);
  expect(result.reasons.join(" ")).not.toMatch(/rule order of/);
});

test("条件付き（@media）の候補が勝ちうるなら undecidable にする", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".btn", declarations: [decl("color", "blue")] },
      {
        order: 2,
        selector: ".btn",
        conditions: ["(min-width: 768px)"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/conditional/);
  expect(result.conditional).toHaveLength(1);
});

test("条件付きでも勝てない候補なら resolved にする（何でも undecidable にしない）", () => {
  const input = doc({
    matched: [
      {
        order: 1,
        selector: ".btn",
        conditions: ["(min-width: 768px)"],
        declarations: [decl("color", "green")],
      },
      { order: 2, selector: "#main .btn", declarations: [decl("color", "blue", true)] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("blue");
});

test("条件付きの候補しか無ければ undecidable（勝者を捏造しない）", () => {
  const input = doc({
    matched: [
      {
        order: 1,
        selector: ".btn",
        conditions: ["(min-width: 768px)"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  expect(resolve(input, "color").status).toBe("undecidable");
});

test("カスケードレイヤをまたぐ競合は undecidable（レイヤの宣言順が入力に無い）", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".btn", layers: ["vendor"], declarations: [decl("color", "blue")] },
      { order: 2, selector: ".btn", layers: ["app"], declarations: [decl("color", "green")] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/cascade layers/);
});

test("同じレイヤの中なら解決する", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".btn", layers: ["app"], declarations: [decl("color", "blue")] },
      { order: 2, selector: ".btn", layers: ["app"], declarations: [decl("color", "green")] },
    ],
  });
  expect(winnerOf(resolve(input, "color")).value).toBe("green");
});

test("詳細度を読めないセレクタは undecidable にする", () => {
  for (const selector of [".a, .b", "& .inner", ".a:nth-child(2n of .b)"]) {
    const input = doc({ matched: [{ order: 1, selector, declarations: [decl("color", "red")] }] });
    const result = resolve(input, "color");
    expect(result.status, selector).toBe("undecidable");
    expect(result.reasons.join(" "), selector).toMatch(/specificity/);
  }
});

test("宣言が無ければ absent（勝者を作らない）", () => {
  const input = doc({
    matched: [{ order: 1, selector: ".btn", declarations: [decl("color", "red")] }],
  });
  const result = resolve(input, "box-shadow");
  expect(result.status).toBe("absent");
  expect(result.winner).toBeNull();
});

test("状態で落ちた候補しか無ければ absent と件数を出す", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".btn:hover", states: ["hover"], declarations: [decl("color", "red")] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("absent");
  expect(result.state_gated).toBe(1);
  expect(result.reasons.join(" ")).toMatch(/state that is not active/);
});

test("--all は候補に現れる全プロパティを解決する", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".btn", declarations: [decl("color", "red"), decl("top", "1px")] },
    ],
  });
  const report = resolveCascade(input, { states: ["default"], properties: null });
  expect(report.results.map((r) => r.property).sort()).toEqual(["color", "top"]);
  expect(report.counts).toEqual({ resolved: 2, undecidable: 0, absent: 0 });
});

test("同じプロパティのインライン宣言が 2 件並んでも落ちない（後勝ち）", () => {
  // インラインの候補は詳細度を持たない（null）。null 同士を詳細度比較へ渡すと TypeError になり、
  // UsageError の exit 2 ではなく素のクラッシュで返る。
  const input = doc({ inline: [decl("width", "10px"), decl("width", "20px")] });
  const result = resolve(input, "width");
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("20px");
});

test("--property は CSS カスタムプロパティも受け取る", () => {
  const input = doc({
    matched: [{ order: 1, selector: ".btn", declarations: [decl("--brand", "red")] }],
  });
  const dir = makeTempDir("cascade-");
  const path = join(dir, "css-rules.json");
  writeFileSync(path, JSON.stringify(input));
  const out = spawnSync(
    process.execPath,
    [script, "--css-rules", path, "--state", "default", "--property", "--brand"],
    { timeout: CHILD_TIMEOUT_MS, encoding: "utf8" },
  );
  expect(out.status, out.stderr).toBe(0);
  expect(parseJsonAs<CliReport>(out.stdout).results[0].winner.value).toBe("red");

  // 検出できることの確認: 既知のフラグ名は値として受け取らない（取り違えを警告なしに受け入れない）。
  const swallowed = spawnSync(
    process.execPath,
    [script, "--css-rules", path, "--state", "default", "--property", "--all"],
    { timeout: CHILD_TIMEOUT_MS, encoding: "utf8" },
  );
  expect(swallowed.status).toBe(2);
  expect(swallowed.stderr).toMatch(/--property requires a value/);
});

test("採取スキーマが違う入力は読まない", () => {
  const stale = { ...doc(), tool_version: "3" };
  expect(() => resolveCascade(stale, { states: ["default"], properties: ["color"] })).toThrow(
    /tool_version/,
  );
});

test("inline_declarations を持たない入力（版 1）は読まない", () => {
  const old = doc();
  delete old.inline_declarations;
  expect(() => resolveCascade(old, { states: ["default"], properties: ["color"] })).toThrow(
    /inline_declarations/,
  );
});

test("詳細度の数え方", () => {
  expect(specificity("*")).toEqual([0, 0, 0]);
  expect(specificity("div")).toEqual([0, 0, 1]);
  expect(specificity(".a")).toEqual([0, 1, 0]);
  expect(specificity("#a")).toEqual([1, 0, 0]);
  expect(specificity("[data-x='y']")).toEqual([0, 1, 0]);
  expect(specificity("a:hover")).toEqual([0, 1, 1]);
  expect(specificity("li::before")).toEqual([0, 0, 2]);
  expect(specificity("li:before")).toEqual([0, 0, 2]);
  expect(specificity(":where(#a, .b) .c")).toEqual([0, 1, 0]);
  expect(specificity(":is(#a, .b) .c")).toEqual([1, 1, 0]);
  expect(specificity(":not(.a, #b)")).toEqual([1, 0, 0]);
  expect(specificity("ul > li + li ~ span")).toEqual([0, 0, 4]);
  expect(specificity(".a:HOVER")).toEqual([0, 2, 0]);
  expect(() => specificity(".a, .b")).toThrow(UndecidableSelector);
  expect(() => specificity("")).toThrow(UndecidableSelector);
});

test("詳細度は桁ごとに比べる（ID 1 つはクラスと型をいくつ並べても上回る）", () => {
  // ID が 1 つの規則と、クラス 9 つと型 9 つの規則を比べる。桁を足し合わせて比べる実装では、後の規則が勝つ。
  const many = `${".c".repeat(9)}${" div".repeat(9)}`;
  const input = doc({
    matched: [
      { order: 1, selector: "#a", declarations: [decl("color", "red")] },
      { order: 2, selector: many, declarations: [decl("color", "blue")] },
    ],
  });
  const result = resolve(input, "color");
  expect(winnerOf(result).value).toBe("red");
  expect(result.losers.map((l) => l.specificity)).toEqual([[0, 9, 9]]);

  // 型が 1 つの規則は、クラスが 1 つの規則に負ける。
  const lower = doc({
    matched: [
      { order: 1, selector: ".a", declarations: [decl("color", "red")] },
      { order: 2, selector: "div", declarations: [decl("color", "blue")] },
    ],
  });
  expect(winnerOf(resolve(lower, "color")).value).toBe("red");
});

function runCli(args: string[], files: Record<string, unknown> = {}) {
  const dir = makeTempDir("cascade-resolve-");
  const paths: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    paths[name] = join(dir, name);
    writeFileSync(paths[name], JSON.stringify(content));
  }
  const resolved = args.map((a) => (paths[a] === undefined ? a : paths[a]));
  return spawnSync(process.execPath, [script, ...resolved], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
}

test("CLI: --state を省くと exit 2（採取した状態を推測しない）", () => {
  const out = runCli(["--css-rules", "in.json", "--all"], { "in.json": doc() });
  expect(out.status).toBe(2);
  expect(out.stderr).toMatch(/--state is required/);
});

test("CLI: --property も --all も無ければ exit 2", () => {
  const out = runCli(["--css-rules", "in.json", "--state", "default"], { "in.json": doc() });
  expect(out.status).toBe(2);
});

test("CLI: --all と --property の併用は exit 2", () => {
  const out = runCli(
    ["--css-rules", "in.json", "--state", "default", "--all", "--property", "color"],
    { "in.json": doc() },
  );
  expect(out.status).toBe(2);
});

test("CLI: undecidable が残れば exit 1、全て決まれば exit 0", () => {
  const ok = runCli(["--css-rules", "in.json", "--state", "default", "--property", "color"], {
    "in.json": doc({
      matched: [{ order: 1, selector: ".btn", declarations: [decl("color", "red")] }],
    }),
  });
  expect(ok.status).toBe(0);
  expect(parseJsonAs<CliReport>(ok.stdout).results[0].winner.value).toBe("red");

  const bad = runCli(["--css-rules", "in.json", "--state", "default", "--property", "color"], {
    "in.json": doc({
      matched: [{ order: 1, selector: ".a, .b", declarations: [decl("color", "red")] }],
    }),
  });
  expect(bad.status).toBe(1);
  expect(parseJsonAs<CliReport>(bad.stdout).counts.undecidable).toBe(1);
});

test("CLI: 読めないファイルは exit 2", () => {
  const out = runCli(["--css-rules", "/nonexistent/css-rules.json", "--state", "default", "--all"]);
  expect(out.status).toBe(2);
  expect(out.stderr).toMatch(/cannot read/);
});

// --- codex レビュー #435 の 3 件 -------------------------------------------
//
// いずれも「警告なしに誤った勝者を exit 0 で返す」形。落とす入力と、通さねばならない入力を
// 同じ数だけ置く（片方だけだと「全部 undecidable にする実装」と区別が付かない）。

test("恒常状態（:enabled 等）を条件にした宣言を不成立として扱わない", () => {
  // css-rules-capture の STATE_PSEUDO_CLASSES は :enabled / :valid / :read-only も states に入れる。
  // これらは要素の性質で、採取ディレクトリ名からは成否が決まらない。
  const input = doc({
    matched: [
      { order: 1, selector: ".btn", declarations: [decl("color", "blue")] },
      {
        order: 2,
        selector: ".btn:enabled",
        states: ["enabled"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/persistent state/);
  expect(result.state_unknown).toHaveLength(1);

  // 検出できることの確認: 素朴にディレクトリ名だけで判定すると blue を勝者として返していた。
  expect(result.winner).toBeNull();
});

test("恒常状態も --state で明示すれば解決する", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".btn", declarations: [decl("color", "blue")] },
      {
        order: 2,
        selector: ".btn:enabled",
        states: ["enabled"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  const result = resolve(input, "color", ["default", "enabled"]);
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("green");
});

test("恒常状態でも勝てない候補なら resolved にする（何でも undecidable にしない）", () => {
  const input = doc({
    matched: [
      {
        order: 1,
        selector: ".btn:enabled",
        states: ["enabled"],
        declarations: [decl("color", "green")],
      },
      { order: 2, selector: "#main .btn", declarations: [decl("color", "blue", true)] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("blue");
});

test("一時的な状態（:hover 等）は従来どおり不成立として扱う", () => {
  // ここを恒常状態と同じ扱いにすると、default の採取で :hover を持つ部品が全部 undecidable になる。
  const input = doc({
    matched: [
      { order: 1, selector: ".btn", declarations: [decl("color", "blue")] },
      {
        order: 2,
        selector: ".btn:hover",
        states: ["hover"],
        declarations: [decl("color", "green")],
      },
      {
        order: 3,
        selector: ".btn:focus-visible",
        states: ["focus-visible"],
        declarations: [decl("color", "red")],
      },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("blue");
  expect(result.state_gated).toBe(2);
  expect(result.state_unknown).toHaveLength(0);
});

test("無名カスケードレイヤをまたぐ競合は undecidable（別レイヤを同一視しない）", () => {
  // css-rules-capture は無名レイヤの名前を空文字で記録するので、別々の無名レイヤが同じ [""] になる。
  const input = doc({
    matched: [
      { order: 1, selector: ".btn", layers: [""], declarations: [decl("color", "blue")] },
      { order: 2, selector: ".btn", layers: [""], declarations: [decl("color", "green")] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/anonymous cascade layer/);

  // 誤検知しないことの確認: 名前付きなら同一レイヤと判定でき、後勝ちで解決する。
  const named = doc({
    matched: [
      { order: 1, selector: ".btn", layers: ["app"], declarations: [decl("color", "blue")] },
      { order: 2, selector: ".btn", layers: ["app"], declarations: [decl("color", "green")] },
    ],
  });
  expect(winnerOf(resolve(named, "color")).value).toBe("green");
});

test("無名レイヤでも候補が 1 件なら解決する（競合が無いので同一性を問う必要がない）", () => {
  const input = doc({
    matched: [{ order: 1, selector: ".btn", layers: [""], declarations: [decl("color", "blue")] }],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("blue");
});

test("16 進エスケープはエスケープ全体を消費して数える", () => {
  // `.\31 23` はクラス「123」1 つ。2 文字固定で進めると残り「23」を型セレクタに数えて [0,1,1] になる。
  expect(specificity(".\\31 23")).toEqual([0, 1, 0]);
  expect(specificity("#\\31 2 .b")).toEqual([1, 1, 0]);
  expect(specificity(".\\.a")).toEqual([0, 1, 0]); // 1 文字エスケープは従来どおり
  expect(specificity(".\\31 23 div")).toEqual([0, 1, 1]); // 終端空白の後ろの型セレクタは数える
});

test("エスケープの誤読が勝者を変えていたことを回帰で固定する", () => {
  // 誤読すると `.\31 23` の詳細度が `[0,1,1]` になり、`[0,1,0]` の .btn より強く読まれる。
  const input = doc({
    matched: [
      { order: 1, selector: ".\\31 23", declarations: [decl("color", "green")] },
      { order: 2, selector: ".btn", declarations: [decl("color", "blue")] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("resolved");
  // 同詳細度なので後勝ち＝ blue。誤読していると green（型セレクタぶん強い）になる。
  expect(winnerOf(result).value).toBe("blue");
});

// --- codex レビュー #435 の 2 ラウンド目 -------------------------------------

test("採取が不完全（inaccessible / unresolved が非ゼロ）なら解決しない", () => {
  const base = { matched: [{ order: 1, selector: ".btn", declarations: [decl("color", "blue")] }] };
  const cases: [string, DocInput][] = [
    [
      "inaccessible",
      { inaccessible: [{ href: "https://cdn.example/theme.css", error: "SecurityError" }] },
    ],
    ["unresolved", { unresolved: [{ selector: ".btn::part(x)", reason: "part-not-evaluated" }] }],
  ];
  for (const [label, extra] of cases) {
    expect(
      () =>
        resolveCascade(doc({ ...base, ...extra }), { states: ["default"], properties: ["color"] }),
      label,
    ).toThrow(/incomplete capture/);
  }
});

test("--allow-incomplete で免除でき、免除したことが出力に残る", () => {
  const input = doc({
    matched: [{ order: 1, selector: ".btn", declarations: [decl("color", "blue")] }],
    inaccessible: [{ href: "https://cdn.example/theme.css", error: "SecurityError" }],
  });
  const report = resolveCascade(input, {
    states: ["default"],
    properties: ["color"],
    allowIncomplete: true,
  });
  expect(winnerOf(report.results[0]).value).toBe("blue");
  expect(report.capture_completeness).toEqual({ inaccessible: 1, unresolved: 0, waived: true });
});

test("採取が完全なら waived: false で通す（何でも止める実装と区別する）", () => {
  const report = resolveCascade(
    doc({ matched: [{ order: 1, selector: ".btn", declarations: [decl("color", "blue")] }] }),
    { states: ["default"], properties: ["color"] },
  );
  expect(report.capture_completeness).toEqual({ inaccessible: 0, unresolved: 0, waived: false });
  expect(report.results[0].status).toBe("resolved");
});

test("共起しうる一時的な状態は不成立として扱わない（:active の採取で :hover も当たっている）", () => {
  const input = doc({
    matched: [
      {
        order: 1,
        selector: ".btn:active",
        states: ["active"],
        declarations: [decl("color", "blue")],
      },
      {
        order: 2,
        selector: ".btn:hover",
        states: ["hover"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  const result = resolve(input, "color", ["active"]);
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/persistent state|would outrank/);

  // 誤検知しないことの確認: :hover も成立していたと分かっているなら明示して解決できる。
  expect(winnerOf(resolve(input, "color", ["active", "hover"])).value).toBe("green");
});

test("共起しない一時的な状態は従来どおり不成立（:hover の採取で :active は当たらない）", () => {
  const input = doc({
    matched: [
      {
        order: 1,
        selector: ".btn:hover",
        states: ["hover"],
        declarations: [decl("color", "blue")],
      },
      {
        order: 2,
        selector: ".btn:active",
        states: ["active"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  const result = resolve(input, "color", ["hover"]);
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("blue");
  expect(result.state_gated).toBe(1);
});

test(":link / :visited / :target は一時的な状態に数えない（要素と履歴の性質）", () => {
  for (const state of ["link", "visited", "target"]) {
    const input = doc({
      matched: [
        { order: 1, selector: ".a", declarations: [decl("color", "blue")] },
        {
          order: 2,
          selector: `.a:${state}`,
          states: [state],
          declarations: [decl("color", "green")],
        },
      ],
    });
    const result = resolve(input, "color");
    expect(result.status, state).toBe("undecidable");
    expect(result.state_unknown, state).toHaveLength(1);
  }
});

test("shorthand は longhand へ展開されて届く（実ブラウザの形を回帰で固定する）", () => {
  // Chrome 149 実測: `.x { margin: 20px }` は margin-top/right/bottom/left の 4 宣言として届く。
  // したがって「longhand の後に shorthand」も order だけで正しく解ける。
  const input = doc({
    matched: [
      { order: 1, selector: ".x", declarations: [decl("margin-top", "10px")] },
      {
        order: 2,
        selector: ".x",
        declarations: [
          decl("margin-top", "20px"),
          decl("margin-right", "20px"),
          decl("margin-bottom", "20px"),
          decl("margin-left", "20px"),
        ],
      },
    ],
  });
  const result = resolve(input, "margin-top");
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("20px");
});

test("`all` は展開されないので、勝ちうるなら undecidable にする", () => {
  // Chrome 149 実測: margin / background / font は展開されるが `all: unset` は `all` のまま届く。
  const input = doc({
    matched: [
      { order: 1, selector: ".x", declarations: [decl("color", "blue")] },
      { order: 2, selector: ".x", declarations: [decl("all", "unset")] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/`all` declaration/);
  expect(result.wildcard).toHaveLength(1);
});

test("`all` が負ける側なら従来どおり解決する", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".x", declarations: [decl("all", "unset")] },
      { order: 2, selector: "#main .x", declarations: [decl("color", "blue", true)] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("blue");
});

test("`all` があるとき、宣言の無いプロパティを absent にしない", () => {
  const input = doc({
    matched: [{ order: 1, selector: ".x", declarations: [decl("all", "unset")] }],
  });
  const result = resolve(input, "box-shadow");
  expect(result.status).toBe("undecidable");
  expect(result.wildcard).toHaveLength(1);
});

test("`all` が無ければ宣言の無いプロパティは従来どおり absent", () => {
  const input = doc({
    matched: [{ order: 1, selector: ".x", declarations: [decl("color", "blue")] }],
  });
  expect(resolve(input, "box-shadow").status).toBe("absent");
});

test("条件付き・`all` の候補が無名レイヤにいても undecidable にする（applying に閉じない）", () => {
  // @media 配下の無名レイヤの `!important` は、後段の無名レイヤの `!important` に逆順で勝ちうる。
  const conditional = doc({
    matched: [
      {
        order: 1,
        selector: ".x",
        layers: [""],
        conditions: ["(min-width: 768px)"],
        declarations: [decl("color", "blue", true)],
      },
      { order: 2, selector: ".x", layers: [""], declarations: [decl("color", "red", true)] },
    ],
  });
  const result = resolve(conditional, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/anonymous cascade layer/);

  // 誤検知しないことの確認: 名前付きレイヤなら同じ形でも解決できる。
  const named = doc({
    matched: [
      {
        order: 1,
        selector: ".x",
        layers: ["vendor"],
        conditions: ["(min-width: 768px)"],
        declarations: [decl("color", "blue")],
      },
      {
        order: 2,
        selector: "#m .x",
        layers: ["vendor"],
        declarations: [decl("color", "red", true)],
      },
    ],
  });
  expect(resolve(named, "color").status).toBe("resolved");
});

test("同じ規則の中では後に書いた宣言が勝つ（`all` が後なら undecidable）", () => {
  // `.x { color: red; all: unset }` は 1 規則なので order が同じ。宣言の並び順で決まる。
  const input = doc({
    matched: [
      { order: 1, selector: ".x", declarations: [decl("color", "red"), decl("all", "unset")] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/`all` declaration/);
});

test("同じ規則で `all` が先なら、後の宣言が勝って resolved", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".x", declarations: [decl("all", "unset"), decl("color", "red")] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("resolved");
  expect(winnerOf(result).value).toBe("red");
});

test("同じ規則で同じプロパティが 2 回宣言されたら後勝ち", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".x", declarations: [decl("color", "red"), decl("color", "blue")] },
    ],
  });
  expect(winnerOf(resolve(input, "color")).value).toBe("blue");
});

test("`all` しか宣言が無い採取物を --all で 0 件合格にしない", () => {
  const input = doc({
    matched: [{ order: 1, selector: ".x", declarations: [decl("all", "unset")] }],
  });
  const report = resolveCascade(input, { states: ["default"], properties: null });
  expect(report.counts.undecidable).toBe(1);
  expect(report.counts.resolved).toBe(0);
  expect(report.results[0].status).toBe("undecidable");
  expect(report.results[0].reasons.join(" ")).toMatch(/`all` declaration/);

  // 誤検知しないことの確認: `all` が無ければ候補ゼロの採取物は結果も 0 件のまま（番兵を無条件に足さない）。
  const empty = resolveCascade(doc(), { states: ["default"], properties: null });
  expect(empty.results).toEqual([]);
});

// --- codex レビュー #435 の 6 ラウンド目 -------------------------------------

test("インラインの `all` もワイルドカードとして扱う", () => {
  const input = doc({ inline: [decl("color", "red"), decl("all", "unset")] });
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.reasons.join(" ")).toMatch(/`all` declaration/);

  // 誤検知しないことの確認: `all` が先なら後の宣言が勝って resolved（何でも undecidable にしない）。
  const before = doc({ inline: [decl("all", "unset"), decl("color", "red")] });
  expect(winnerOf(resolve(before, "color")).value).toBe("red");
});

test("インライン同士は style 属性の並び順で決まる", () => {
  const input = doc({ inline: [decl("color", "red"), decl("color", "blue")] });
  expect(winnerOf(resolve(input, "color")).value).toBe("blue");
});

test("主語の外に付いた状態は成立と扱わない（隣の要素の hover）", () => {
  const input = doc({
    matched: [
      { order: 1, selector: ".target", declarations: [decl("color", "blue")] },
      {
        order: 2,
        selector: ".trigger:hover + .target",
        states: ["hover"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  const result = resolve(input, "color", ["hover"]);
  expect(result.status).toBe("undecidable");
  expect(result.state_unknown).toHaveLength(1);

  // 誤検知しないことの確認: 主語に付いた hover なら従来どおり成立して勝つ。
  const subject = doc({
    matched: [
      { order: 1, selector: ".target", declarations: [decl("color", "blue")] },
      {
        order: 2,
        selector: ".target:hover",
        states: ["hover"],
        declarations: [decl("color", "green")],
      },
    ],
  });
  expect(winnerOf(resolve(subject, "color", ["hover"])).value).toBe("green");
  // default の採取では従来どおり不成立で落ちる。
  expect(winnerOf(resolve(subject, "color", ["default"])).value).toBe("blue");
});

test("statesOutsideSubject は主語の内外を区別する", () => {
  expect(statesOutsideSubject(".trigger:hover + .target", ["hover"])).toEqual(["hover"]);
  expect(statesOutsideSubject(".a:hover .b:hover", ["hover"])).toEqual(["hover"]);
  expect(statesOutsideSubject(":is(.a:hover) .b", ["hover"])).toEqual(["hover"]);
  expect(statesOutsideSubject(".btn:hover", ["hover"])).toEqual([]);
  expect(statesOutsideSubject(".a .b:hover", ["hover"])).toEqual([]);
  expect(statesOutsideSubject(".a .b", [])).toEqual([]);
});

test("文字列でない状態名を持つ規則は、勝者にせず状態が不明な候補にする", () => {
  // 状態名が読めない規則は成否を決められない。名前の判定から外すだけだと、条件の無い規則として勝者になる。
  const input = doc({
    matched: [{ order: 1, selector: ".btn", declarations: [decl("color", "blue")] }],
  });
  input.matched = [
    ...input.matched,
    {
      order: 2,
      selector: ".btn",
      original_selector: ".btn",
      states: [42],
      pseudo_element: null,
      conditions: [],
      layers: [],
      href: null,
      declarations: [decl("color", "green")],
    },
  ];
  const result = resolve(input, "color");
  expect(result.status).toBe("undecidable");
  expect(result.winner).toBeNull();
  expect(result.state_unknown?.map((c) => c.unknown_states)).toEqual([[42]]);
});

test.each([
  ["null", null],
  ["数", 3],
  ["配列", []],
])(
  "オブジェクトでない規則（%s）があれば、読み飛ばさずに判定できないとして止める",
  (_name, rule) => {
    // 読めない規則は、残りの規則より強い宣言を隠しうるので、残りだけで勝者を決めない。
    const input = doc({
      matched: [{ order: 1, selector: ".btn", declarations: [decl("color", "blue")] }],
    });
    input.matched = [...input.matched, rule];
    expect(() => resolveCascade(input, { states: ["default"], properties: ["color"] })).toThrow(
      /`matched\[1\]` is not an object/,
    );
  },
);
