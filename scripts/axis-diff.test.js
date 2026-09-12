// 固定軸・可変軸の割り出しが、未測定を固定側へ倒さないことの回帰テスト（Issue #326）。
//
// この割り出しが壊れる方向は「可変を固定と言う」側に偏る——片方のインスタンスでしか採って
// いない軸は、突き合わせる相手が居ないので黙って「割れていない」に見える。
// 引数にすべき軸が固定として落ちると、実装は現行に在るバリアントを持たないまま完成し、
// 誤りは人が現行と見比べるまで出ない（Issue #326 の往復 1）。
// そのため本テストは値の一致より **fail-closed の側**（problems に残るか）を厚く見る。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-component/scripts/axis-diff.mjs");
const { VERSION, diffAxes, flattenTraits } = await import(script);

const traits = (
  computed,
  { before = null, after = null, rect = { x: 0, y: 0, width: 80, height: 32 } } = {},
) => ({
  computed,
  before,
  after,
  rect,
});

const instance = (id, states) => ({ id, states });
const state = (name, t) => ({ state: name, traits: t });

const findAxis = (list, axis, forState = "default") =>
  list.find((entry) => entry.axis === axis && entry.state === forState);

test("インスタンス間で割れた軸を可変、割れない軸を固定として出す", () => {
  const result = diffAxes({
    component: "button",
    instances: [
      instance("orders", [
        state("default", traits({ color: "rgb(0, 0, 0)", "background-color": "rgb(1, 1, 1)" })),
      ]),
      instance("users", [
        state("default", traits({ color: "rgb(0, 0, 0)", "background-color": "rgb(2, 2, 2)" })),
      ]),
    ],
  });
  expect(result.ok).toBe(true);
  expect(findAxis(result.fixed, "color").value).toBe("rgb(0, 0, 0)");
  expect(findAxis(result.variable, "background-color").values).toEqual([
    { instance: "orders", value: "rgb(1, 1, 1)" },
    { instance: "users", value: "rgb(2, 2, 2)" },
  ]);
  expect(result.tool_version).toBe(VERSION);
});

test("インスタンスが 1 件なら固定と可変を区別せず落とす", () => {
  const result = diffAxes({
    component: "button",
    instances: [instance("orders", [state("default", traits({ color: "rgb(0, 0, 0)" }))])],
  });
  expect(result.ok).toBe(false);
  expect(result.problems.join("\n")).toContain("2 件以上");
  // 1 件しか無いのに「固定軸が 1 つ見つかった」と報告しないこと（これが固定側へ倒す経路）。
  expect(result.fixed).toHaveLength(0);
});

test("片方でしか採っていない状態を固定軸にしない", () => {
  const result = diffAxes({
    component: "button",
    instances: [
      instance("orders", [
        state("default", traits({ color: "rgb(0, 0, 0)" })),
        state("hover", traits({ color: "rgb(9, 9, 9)" })),
      ]),
      instance("users", [state("default", traits({ color: "rgb(0, 0, 0)" }))]),
    ],
  });
  expect(result.ok).toBe(false);
  expect(result.problems.join("\n")).toContain("未採取の状態 hover");
  expect(findAxis(result.fixed, "color", "hover")).toBeUndefined();
  expect(findAxis(result.variable, "color", "hover")).toBeUndefined();
});

test("片方でしか採っていない軸を固定にしない", () => {
  const result = diffAxes({
    component: "button",
    instances: [
      instance("orders", [state("default", traits({ color: "rgb(0, 0, 0)", cursor: "pointer" }))]),
      instance("users", [state("default", traits({ color: "rgb(0, 0, 0)" }))]),
    ],
  });
  expect(result.ok).toBe(false);
  expect(result.problems.join("\n")).toContain("1/2 件でしか採れていない");
  expect(findAxis(result.fixed, "cursor")).toBeUndefined();
});

test("id が無い・重複しているインスタンスを落とす", () => {
  const missing = diffAxes({
    instances: [
      instance("", [state("default", traits({ color: "a" }))]),
      instance("b", [state("default", traits({ color: "a" }))]),
    ],
  });
  expect(missing.problems.join("\n")).toContain("id の無いインスタンス");

  const duplicated = diffAxes({
    instances: [
      instance("same", [state("default", traits({ color: "a" }))]),
      instance("same", [state("default", traits({ color: "b" }))]),
    ],
  });
  expect(duplicated.problems.join("\n")).toContain("id が重複している");
});

test("状態が重複しているインスタンスを落とす", () => {
  const result = diffAxes({
    instances: [
      instance("a", [
        state("default", traits({ color: "x" })),
        state("default", traits({ color: "y" })),
      ]),
      instance("b", [state("default", traits({ color: "x" }))]),
    ],
  });
  expect(result.problems.join("\n")).toContain("状態が重複している");
});

test("traits を持たない採取を落とす", () => {
  const result = diffAxes({
    instances: [
      instance("a", [{ state: "default" }]),
      instance("b", [state("default", traits({ color: "x" }))]),
    ],
  });
  expect(result.problems.join("\n")).toContain("traits が無い");
});

test("擬似要素で描いているかどうかが可変軸として出る", () => {
  // 現行が標準のチェックボックスで、別インスタンスが ::before で描いている、という差
  // （Issue #326 の往復 4）は計算値の比較だけでは軸にならない。存在自体を軸にする。
  const result = diffAxes({
    instances: [
      instance("a", [state("default", traits({ color: "x" }, { before: null }))]),
      instance("b", [state("default", traits({ color: "x" }, { before: { content: '"✓"' } }))]),
    ],
  });
  const axis = findAxis(result.variable, "::before/<present>");
  expect(axis.values.map((v) => v.value)).toEqual(["false", "true"]);
});

test("擬似要素を測っていない採取を『不在』として固定軸にしない", () => {
  // `before` / `after` のキーごと無い採取（手で組んだマニフェスト等）を `null`（測って不在）と
  // 同一視すると、`<present>: "false"` が全インスタンスで揃って固定軸になり ok: true で通る。
  // これは本ツールが防ごうとしている「未測定が固定軸に化ける」経路そのもの。
  const notMeasured = { computed: { color: "x" }, rect: { width: 1, height: 1 } };
  const measuredAbsent = {
    computed: { color: "x" },
    before: null,
    after: null,
    rect: { width: 1, height: 1 },
  };

  expect(flattenTraits(notMeasured)["::before/<present>"]).toBeUndefined();
  expect(flattenTraits(measuredAbsent)["::before/<present>"]).toBe("false");

  // 全インスタンスで未測定なら、軸そのものを出さない（固定とも可変とも主張しない）。
  const allUnmeasured = diffAxes({
    instances: [
      instance("a", [state("default", notMeasured)]),
      instance("b", [state("default", notMeasured)]),
    ],
  });
  expect(findAxis(allUnmeasured.fixed, "::before/<present>")).toBeUndefined();
  expect(findAxis(allUnmeasured.variable, "::before/<present>")).toBeUndefined();

  // 片方だけ未測定なら「一部でしか採れていない軸」として落とす。
  const mixed = diffAxes({
    instances: [
      instance("a", [state("default", notMeasured)]),
      instance("b", [state("default", measuredAbsent)]),
    ],
  });
  expect(mixed.ok).toBe(false);
  expect(mixed.problems.join("\n")).toContain("::before/<present>");
  expect(findAxis(mixed.fixed, "::before/<present>")).toBeUndefined();
});

test("絶対座標は軸にせず、寸法は軸にする", () => {
  const flat = flattenTraits(
    traits({ color: "x" }, { rect: { x: 10, y: 20, width: 80, height: 32 } }),
  );
  expect(flat["rect/x"]).toBeUndefined();
  expect(flat["rect/y"]).toBeUndefined();
  expect(flat["rect/width"]).toBe("80");
  expect(flat["rect/height"]).toBe("32");
});

// --- CLI ---

function runCli(manifest, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), "axis-diff-"));
  const path = join(dir, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest));
  return spawnSync(process.execPath, [script, path, ...extraArgs], { encoding: "utf8" });
}

test("CLI: 問題が無ければ 0、あれば 1 で終わる", () => {
  const ok = runCli({
    component: "button",
    instances: [
      instance("a", [state("default", traits({ color: "x" }))]),
      instance("b", [state("default", traits({ color: "y" }))]),
    ],
  });
  expect(ok.status).toBe(0);
  expect(JSON.parse(ok.stdout).variable).toHaveLength(1);

  const ng = runCli({
    component: "button",
    instances: [instance("a", [state("default", traits({ color: "x" }))])],
  });
  expect(ng.status).toBe(1);
  expect(ng.stderr).toContain("採取へ戻す");
});

test("CLI: 引数が無ければ usage と exit 2", () => {
  const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("usage:");
});

test("CLI: 余った位置引数を黙って先勝ちにしない", () => {
  // 2 つ渡して片方を黙って捨てると、渡したつもりのファイルが読まれないまま exit 0 になる。
  const ok = runCli({
    instances: [
      instance("a", [state("default", traits({ color: "x" }))]),
      instance("b", [state("default", traits({ color: "y" }))]),
    ],
  });
  expect(ok.status).toBe(0);

  const dir = mkdtempSync(join(tmpdir(), "axis-diff-"));
  const first = join(dir, "one.json");
  const second = join(dir, "two.json");
  for (const p of [first, second]) writeFileSync(p, JSON.stringify({ instances: [] }));
  const r = spawnSync(process.execPath, [script, first, second], { encoding: "utf8" });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("マニフェストは 1 つだけ");
});

test("CLI: 読めないマニフェストを成功に倒さない", () => {
  const dir = mkdtempSync(join(tmpdir(), "axis-diff-"));
  const path = join(dir, "broken.json");
  writeFileSync(path, "{ not json");
  const r = spawnSync(process.execPath, [script, path], { encoding: "utf8" });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("マニフェストを読めない");
});

test("状態名が不正な採取を黙って捨てず問題として数える", () => {
  // 全インスタンスの状態名が壊れていると、捨ててから突き合わせる実装では
  // 「状態 0 件・軸 0 件・問題 0 件」になり、1 件も測っていないのに ok: true を返す。
  const result = diffAxes({
    component: "button",
    instances: [
      { id: "a", states: [{ state: null, traits: traits({ color: "red" }) }] },
      { id: "b", states: [{ state: "", traits: traits({ color: "blue" }) }] },
    ],
  });
  expect(result.ok).toBe(false);
  expect(result.problems.join("\n")).toContain("状態名が不正な採取");
  expect(result.problems.join("\n")).toContain("採取された状態が 1 つも無い");
});

test("有効な状態がある場合でも、混ざった不正な採取を見逃さない", () => {
  const result = diffAxes({
    component: "button",
    instances: [
      instance("a", [
        state("default", traits({ color: "red" })),
        { state: 42, traits: traits({ color: "x" }) },
      ]),
      instance("b", [state("default", traits({ color: "blue" }))]),
    ],
  });
  expect(result.ok).toBe(false);
  expect(result.problems.join("\n")).toContain("状態名が不正な採取が 1 件");
});

test("空の traits から 0 軸しか取れない採取を fail-closed にする", () => {
  // traits: {} を 2 件渡すと軸が 1 つも立たず、表が空のまま problems も空になり
  // 「比較対象が無いのに ok: true」を返していた（build は axes.ok だけを前提に進む）。
  const result = diffAxes({
    component: "button",
    instances: [
      { id: "a", states: [{ state: "default", traits: {} }] },
      { id: "b", states: [{ state: "default", traits: {} }] },
    ],
  });
  expect(result.ok).toBe(false);
  // 必須フィールドの検査が先に効くので、より具体的な理由で落ちる（ok: false は変わらない）。
  expect(result.problems.join("\n")).toContain("採取に computed と rect が無い");
  expect(result.fixed).toHaveLength(0);
  expect(result.variable).toHaveLength(0);
});

test("合格は問題の不在ではなく測れた件数で決める", () => {
  // 退化した入力を 1 件ずつ塞ぐのではなく、突き合わせられた軸が 0 件なら合格にしない。
  const ok = diffAxes({
    component: "button",
    instances: [
      instance("a", [state("default", traits({ color: "x" }))]),
      instance("b", [state("default", traits({ color: "y" }))]),
    ],
  });
  expect(ok.ok).toBe(true);
  expect(ok.measured).toBe(ok.fixed.length + ok.variable.length);
  expect(ok.measured).toBeGreaterThan(0);

  // rect も computed も空で、擬似要素キーも無い＝軸が 1 つも立たない
  const none = diffAxes({
    component: "button",
    instances: [
      { id: "a", states: [{ state: "default", traits: { computed: {}, rect: {} } }] },
      { id: "b", states: [{ state: "default", traits: { computed: {}, rect: {} } }] },
    ],
  });
  expect(none.ok).toBe(false);
  expect(none.measured).toBe(0);
  expect(none.problems.join("\n")).toContain("突き合わせられた軸が 0 件");
});

test("擬似要素の有無だけが立つ採取を「測れた」と数えない", () => {
  // { before: null, after: null } は ::before/::after の <present> 軸を 2 本生むため、
  // 「軸が 1 件以上」だけを条件にすると measured 2 / ok: true で通る。
  // 本体のスタイルも幾何も測っていないので、採取ツールが必ず返すフィールドで弾く。
  const result = diffAxes({
    component: "button",
    instances: [
      { id: "a", states: [{ state: "default", traits: { before: null, after: null } }] },
      { id: "b", states: [{ state: "default", traits: { before: null, after: null } }] },
    ],
  });
  expect(result.ok).toBe(false);
  expect(result.measured).toBe(0);
  expect(result.problems.join("\n")).toContain("computed と rect が無い");
});

test("computed はあるが rect が無い採取も弾く", () => {
  const result = diffAxes({
    component: "button",
    instances: [
      { id: "a", states: [{ state: "default", traits: { computed: { color: "x" } } }] },
      { id: "b", states: [{ state: "default", traits: { computed: { color: "y" } } }] },
    ],
  });
  expect(result.ok).toBe(false);
  expect(result.problems.join("\n")).toContain("rect が無い");
});

test("配列の traits を「レコード形」として通さない", () => {
  // typeof [] === "object" なので、配列は型検査を素通りし numeric key が軸になる。
  const result = diffAxes({
    component: "button",
    instances: [
      {
        id: "a",
        states: [{ state: "default", traits: { computed: ["x"], rect: { width: 1, height: 1 } } }],
      },
      {
        id: "b",
        states: [{ state: "default", traits: { computed: ["y"], rect: { width: 1, height: 1 } } }],
      },
    ],
  });
  expect(result.ok).toBe(false);
  expect(result.problems.join("\n")).toContain("computed が無い");
});

test("宣言された到達不能な状態は欠落ではなく除外として扱う", () => {
  // そのインスタンスで作れない状態を宣言どおりマニフェストから外すと、
  // 「全インスタンスで同じ状態集合」を要求する実装では build へ永久に進めなくなる。
  const result = diffAxes({
    component: "button",
    instances: [
      {
        id: "a",
        states: [state("default", traits({ color: "x" })), state("hover", traits({ color: "h" }))],
      },
      {
        id: "b",
        unreachable_states: [{ state: "hover", reason: "この画面では常に活性" }],
        states: [state("default", traits({ color: "y" }))],
      },
    ],
  });
  expect(result.ok).toBe(true);
  expect(result.problems).toHaveLength(0);
  expect(result.not_compared).toEqual([{ instance: "b", state: "hover" }]);
  // 突き合わせる相手が居ない状態は、固定とも可変とも言わない。
  expect(result.fixed.some((f) => f.state === "hover")).toBe(false);
  expect(result.variable.some((v) => v.state === "hover")).toBe(false);
  // 全インスタンスで到達できる状態は従来どおり割り出す。
  expect(result.variable.some((v) => v.state === "default" && v.axis === "color")).toBe(true);
});

test("宣言の無い欠落は従来どおり問題にする", () => {
  const result = diffAxes({
    component: "button",
    instances: [
      {
        id: "a",
        states: [state("default", traits({ color: "x" })), state("hover", traits({ color: "h" }))],
      },
      { id: "b", states: [state("default", traits({ color: "y" }))] },
    ],
  });
  expect(result.ok).toBe(false);
  expect(result.problems.join("\n")).toContain("未採取の状態 hover");
});

test("契約どおりのオブジェクト形で宣言された到達不能状態を受ける", () => {
  // 成果物の契約（metadata.json / references/instances.md）は { state, reason } のオブジェクト形。
  // 文字列だけを拾うと、正しく宣言された除外が「未採取の状態」に化けて build を塞ぐ。
  const result = diffAxes({
    component: "button",
    instances: [
      {
        id: "a",
        states: [state("default", traits({ color: "x" })), state("hover", traits({ color: "h" }))],
      },
      {
        id: "b",
        unreachable_states: [{ state: "hover", reason: "この画面では常に活性" }],
        states: [state("default", traits({ color: "y" }))],
      },
    ],
  });
  expect(result.ok).toBe(true);
  expect(result.problems).toHaveLength(0);
  expect(result.not_compared).toEqual([{ instance: "b", state: "hover" }]);
});

test("理由の無い除外宣言を受理しない（唯一の緩和経路を広げない）", () => {
  for (const declared of [["hover"], [{ state: "hover" }], [{ state: "hover", reason: "  " }]]) {
    const result = diffAxes({
      component: "button",
      instances: [
        {
          id: "a",
          states: [
            state("default", traits({ color: "x" })),
            state("hover", traits({ color: "h" })),
          ],
        },
        {
          id: "b",
          unreachable_states: declared,
          states: [state("default", traits({ color: "y" }))],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("契約の形でない");
  }
});
