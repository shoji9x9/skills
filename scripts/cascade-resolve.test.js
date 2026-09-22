// css-rules.json のカスケード解決の回帰テスト（Issue #433）。
//
// 実装が見落としていたのは 2 形:
//   - インラインの非 !important が、!important 付き規則に負ける（button の width 10px vs 25px）
//   - 同一セレクタ・同一プロパティを後段のテーマが再宣言して上書きする
//     （radio-button の box-shadow、feedback-message の top / opacity）
// どちらも「最初に見つかった宣言を採る」読み方だと実際の描画と逆になる。
// 各テストは「正しい勝者」と併せて「素朴な読み方なら別の値になる」ことも確かめる
// （負けた側が losers に残らない入力で測ると、この検査は何も実証しない）。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-component/scripts/cascade-resolve.mjs");
const { VERSION, resolveCascade, specificity, compareSpecificity, UndecidableSelector } =
  await import(script);

/** css-rules-capture.mjs 相当の入力を組む（tool_version は実物の対応版に合わせる）。 */
function doc({ matched = [], inline = [] } = {}) {
  return {
    name: "component@instance",
    tool_version: "4",
    matched: matched.map((rule, index) => ({
      order: rule.order ?? index,
      selector: rule.selector,
      original_selector: rule.selector,
      states: rule.states ?? [],
      pseudo_element: rule.pseudo_element ?? null,
      conditions: rule.conditions ?? [],
      layers: rule.layers ?? [],
      href: rule.href ?? null,
      declarations: rule.declarations,
    })),
    unresolved: [],
    inaccessible: [],
    inline_declarations: inline,
    shadow_host: false,
    slotted: false,
    counts: {},
    shadow_root: false,
  };
}

const decl = (property, value, important = false) => ({ property, value, important });

function resolve(document, property, states = ["default"]) {
  const report = resolveCascade(document, { states, properties: [property] });
  return report.results.find((r) => r.property === property);
}

test("VERSION を持つ", () => {
  expect(VERSION).toBe("1");
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
  expect(result.winner.value).toBe("25px");
  expect(result.winner.tier).toBe("rule !important");

  // 陽性コントロール: インラインだけを読む素朴な実装が採っていた値が、負けた側として残っている。
  expect(result.losers.map((l) => l.value)).toContain("10px");
});

test("インラインの非 !important は非 !important 規則には勝つ", () => {
  const input = doc({
    matched: [{ order: 674, selector: ".SearchBoxButton", declarations: [decl("width", "25px")] }],
    inline: [decl("width", "10px")],
  });
  const result = resolve(input, "width");
  expect(result.winner.value).toBe("10px");
  expect(result.winner.tier).toBe("inline");
});

test("インラインの !important は規則の !important にも勝つ", () => {
  const input = doc({
    matched: [{ order: 674, selector: "#a.b.c", declarations: [decl("width", "25px", true)] }],
    inline: [decl("width", "10px", true)],
  });
  expect(resolve(input, "width").winner.value).toBe("10px");
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
  expect(result.winner.value).toBe("none");
  expect(result.winner.origin).toBe("LiverpoolTheme/Theme.LiverpoolTheme.css");
  // 陽性コントロール: 最初に見つかった宣言（新側が実装していた inset の影）は負けている。
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
  expect(resolve(input, "top").winner.value).toBe("5px");
  expect(
    resolve(input, "top")
      .losers.map((l) => l.value)
      .sort(),
  ).toEqual(["0px", "2px"]);
  expect(resolve(input, "opacity").winner.value).toBe("0.5");
});

test("詳細度は出現順より強い（後勝ちだけで決めない）", () => {
  const input = doc({
    matched: [
      { order: 10, selector: "#main .btn", declarations: [decl("color", "red")] },
      { order: 900, selector: ".btn", declarations: [decl("color", "blue")] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.winner.value).toBe("red");
  expect(result.winner.specificity).toEqual([1, 1, 0]);
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
  expect(resolve(input, "color", ["default"]).winner.value).toBe("blue");
  expect(resolve(input, "color", ["default"]).state_gated).toBe(1);
  expect(resolve(input, "color", ["hover"]).winner.value).toBe("green");
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
  expect(own.winner.value).toBe("red");
  expect(after.winner.value).toBe("green");
  expect(after.winner.source).toBe("rule");
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
  expect(result.winner.value).toBe("blue");
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
  expect(resolve(input, "color").winner.value).toBe("green");
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
  expect(result.winner.value).toBe("20px");
});

test("--property は CSS カスタムプロパティも受け取る", () => {
  const input = doc({
    matched: [{ order: 1, selector: ".btn", declarations: [decl("--brand", "red")] }],
  });
  const dir = mkdtempSync(join(tmpdir(), "cascade-"));
  const path = join(dir, "css-rules.json");
  writeFileSync(path, JSON.stringify(input));
  const out = spawnSync(
    process.execPath,
    [script, "--css-rules", path, "--state", "default", "--property", "--brand"],
    { encoding: "utf8" },
  );
  expect(out.status, out.stderr).toBe(0);
  expect(JSON.parse(out.stdout).results[0].winner.value).toBe("red");

  // 陽性コントロール: 既知のフラグ名は値として受け取らない（取り違えを黙って飲まない）。
  const swallowed = spawnSync(
    process.execPath,
    [script, "--css-rules", path, "--state", "default", "--property", "--all"],
    { encoding: "utf8" },
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

test("詳細度の比較", () => {
  expect(compareSpecificity([1, 0, 0], [0, 9, 9])).toBeGreaterThan(0);
  expect(compareSpecificity([0, 1, 0], [0, 1, 0])).toBe(0);
  expect(compareSpecificity([0, 0, 1], [0, 1, 0])).toBeLessThan(0);
});

function runCli(args, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cascade-resolve-"));
  const paths = {};
  for (const [name, content] of Object.entries(files)) {
    paths[name] = join(dir, name);
    writeFileSync(paths[name], JSON.stringify(content));
  }
  const resolved = args.map((a) => (paths[a] === undefined ? a : paths[a]));
  return spawnSync(process.execPath, [script, ...resolved], { encoding: "utf8" });
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
  expect(JSON.parse(ok.stdout).results[0].winner.value).toBe("red");

  const bad = runCli(["--css-rules", "in.json", "--state", "default", "--property", "color"], {
    "in.json": doc({
      matched: [{ order: 1, selector: ".a, .b", declarations: [decl("color", "red")] }],
    }),
  });
  expect(bad.status).toBe(1);
  expect(JSON.parse(bad.stdout).counts.undecidable).toBe(1);
});

test("CLI: 読めないファイルは exit 2", () => {
  const out = runCli(["--css-rules", "/nonexistent/css-rules.json", "--state", "default", "--all"]);
  expect(out.status).toBe(2);
  expect(out.stderr).toMatch(/cannot read/);
});

// --- codex レビュー #435 の 3 件 -------------------------------------------
//
// いずれも「黙って誤った勝者を exit 0 で返す」形。落とす入力と、通さねばならない入力を
// 同じ数だけ置く（片方だけだと「全部 undecidable にする実装」と区別が付かない）。

test("恒常状態（:enabled 等）で門番された宣言を不成立に倒さない", () => {
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

  // 陽性コントロール: 素朴にディレクトリ名だけで門番すると blue を勝者として返していた。
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
  expect(result.winner.value).toBe("green");
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
  expect(result.winner.value).toBe("blue");
});

test("一時的な状態（:hover 等）は従来どおり不成立に倒す", () => {
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
  expect(result.winner.value).toBe("blue");
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
  expect(result.reasons.join(" ")).toMatch(/anonymous cascade layers/);

  // 陽性コントロール: 名前付きなら同一レイヤと判定でき、後勝ちで解決する。
  const named = doc({
    matched: [
      { order: 1, selector: ".btn", layers: ["app"], declarations: [decl("color", "blue")] },
      { order: 2, selector: ".btn", layers: ["app"], declarations: [decl("color", "green")] },
    ],
  });
  expect(resolve(named, "color").winner.value).toBe("green");
});

test("無名レイヤでも候補が 1 件なら解決する（競合が無いので同一性を問う必要がない）", () => {
  const input = doc({
    matched: [{ order: 1, selector: ".btn", layers: [""], declarations: [decl("color", "blue")] }],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("resolved");
  expect(result.winner.value).toBe("blue");
});

test("16 進エスケープはエスケープ全体を消費して数える", () => {
  // `.\31 23` はクラス「123」1 つ。2 文字固定で進めると残り「23」を型セレクタに数えて [0,1,1] になる。
  expect(specificity(".\\31 23")).toEqual([0, 1, 0]);
  expect(specificity("#\\31 2 .b")).toEqual([1, 1, 0]);
  expect(specificity(".\\.a")).toEqual([0, 1, 0]); // 1 文字エスケープは従来どおり
  expect(specificity(".\\31 23 div")).toEqual([0, 1, 1]); // 終端空白の後ろの型セレクタは数える
});

test("エスケープの誤読が勝者を変えていたことを回帰で固定する", () => {
  // 誤読すると `.\31 23` の詳細度が [0,1,1] になり、[0,1,0] の .btn より強く読まれる。
  const input = doc({
    matched: [
      { order: 1, selector: ".\\31 23", declarations: [decl("color", "green")] },
      { order: 2, selector: ".btn", declarations: [decl("color", "blue")] },
    ],
  });
  const result = resolve(input, "color");
  expect(result.status).toBe("resolved");
  // 同詳細度なので後勝ち＝ blue。誤読していると green（型セレクタぶん強い）になる。
  expect(result.winner.value).toBe("blue");
});
