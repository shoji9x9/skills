// parity-component の eval fixture（採取物）が、実物のツールの出力として互いに整合していることの検査（Issue #354）。
//
// 手で作った採取物は、次の形で不正になってきた。metadata.json の `traits_property_set` が実物の
// FIXED_PROPERTIES と違う・css-rules.json の宣言が traits.json の計算値と食い違う・element.png がプレースホルダ。`build` の前提検証はこれらを突き合わせるので、不正な fixture では eval が目的の分岐へ届かない。
// 採取物は scripts/eval/fixtures/generate-parity-component-fixtures.ts で生成し、ここでは生成物どうしの整合だけを見る
// （CI にブラウザが無いので再生成はしない）。各検査は、わざと不正にしたコピーで赤くなることを併せて確かめる。

import { assert, expect, test } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { invalidInput, removeField } from "../../lib/testing/test-input.ts";
import * as axisDiff from "../../../skills/parity-component/scripts/axis-diff.mjs";
import * as behaviorCompare from "../../../skills/parity-component/scripts/behavior-compare.mjs";
import { loadBaseline } from "../../../skills/parity-component/scripts/lib/baseline.mjs";
import * as elementShot from "../../../skills/parity-suite/scripts/element-shot.mjs";
import {
  type CaptureConditions,
  checkComponent,
  componentDirs,
  copyFixture,
  type CssRules,
  edit,
  fixturesRoot,
  type Metadata,
  type NoiseRow,
  type ShotRecord,
  type Viewport,
} from "./parity-component-fixtures-helpers.ts";
import { readJson } from "../read-json-helpers.ts";

test("baseline を持つ fixture を見つけている（検査対象が 0 件で緑にしない）", () => {
  expect(componentDirs.map((d) => d.slice(fixturesRoot.length + 1)).sort()).toEqual([
    "breaking-change-request/.replace/components/button",
    "cascade-conflict/.replace/components/button",
    "catalog-unset/.replace/components/button",
    "lifecycle-binding/.replace/components/button",
  ]);
});

// build の前提は全インスタンスの behaviors.json を要求する（Issue #446）。欠けた fixture では build 系の eval が
// 前提判定で止まり目的の分岐へ届かないので、基準側が behavior-compare.mjs の検査を通ることを確かめる。
// 突き合わせ表は渡さない（基準側の不備だけを見る）ので、期待する finding は comparison-missing の 1 件だけ。
test.each(componentDirs.map((d) => [d.slice(fixturesRoot.length + 1), d]))(
  "操作の結果の基準が behavior-compare.mjs の基準側の検査を通る: %s",
  (_, dir) => {
    const { metadata, byInstance: behaviors } = loadBaseline(dir, "behaviors.json");
    const result = behaviorCompare.compareBehaviors({
      metadata,
      behaviors,
      comparison: null,
      target: "any",
    });
    expect(result.structural).toBe(false);
    expect(result.counts.cells).toBeGreaterThan(0);
    expect(result.findings.map((finding) => finding.code)).toEqual(["comparison-missing"]);
  },
);

test.each(componentDirs.map((d) => [d.slice(fixturesRoot.length + 1), d]))(
  "採取物が実物のツールの出力として整合している: %s",
  (_, dir) => {
    expect(checkComponent(dir)).toEqual([]);
  },
);

// --- 検出されることの確認: わざと不正にしたコピーで各検査が赤くなる ---

test("陽性: 実物に無いプロパティを含む traits_property_set を検出する", () => {
  const dir = copyFixture();
  // 実物の FIXED_PROPERTIES に無い名前を選ぶ（集合に足された名前を使うと、重複で長さが変わる
  // せいで通ってしまい、「実物に無い名前を検出した」ことの証拠にならない）。
  edit(join(dir, "metadata.json"), (m: Metadata) => {
    expect(m.capture.tools.traits_property_set).not.toContain("letter-spacing");
    m.capture.tools.traits_property_set.push("letter-spacing");
  });
  expect(checkComponent(dir)).toContain(
    "traits_property_set が trait-capture.mjs の FIXED_PROPERTIES と一致しない",
  );
});

test("陽性: 記録されていない element_shot_version を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m: Metadata) => {
    // 「値が違う」ではなく「キーごと無い」形で不正にする。element-shot.mjs は今回の追加なので、
    // 既存の fixture がキーを持たないまま通り抜けるのが、いちばん起きやすい誤り。
    delete m.capture.tools.element_shot_version;
  });
  expect(checkComponent(dir)).toContain(`element_shot_version undefined ≠ ${elementShot.VERSION}`);
});

test("陽性: 計算値と食い違う規則の宣言を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "baseline/users-create/hover/css-rules.json"), (r: CssRules) => {
    const hover = r.matched.find((m) => m.states.includes("hover"));
    assert.exists(hover, "fixture の css-rules.json に hover の規則が無い");
    hover.declarations[0].value = "rgb(0, 70, 130)";
  });
  expect(checkComponent(dir).join("\n")).toContain(
    "users-create / hover: background-color の計算値 rgb(221, 221, 221) が当たっている宣言",
  );
});

test("陽性: rect と合わない element.png を検出する", () => {
  const dir = copyFixture();
  const other = readFileSync(join(dir, "baseline/orders-search/default/element.png"));
  writeFileSync(join(dir, "baseline/users-create/default/element.png"), other);
  expect(checkComponent(dir).join("\n")).toContain("users-create / default: element.png");
});

test("陽性: element.shot.json の欠落・版違い・実寸違いを検出する", () => {
  const dir = copyFixture();
  rmSync(join(dir, "baseline/orders-search/default/element.shot.json"));
  edit(join(dir, "baseline/users-create/default/element.shot.json"), (r: ShotRecord) => {
    r.tool_version = "5";
  });
  edit(join(dir, "baseline/users-create/hover/element.shot.json"), (r: ShotRecord) => {
    assert.exists(r.png, "fixture の element.shot.json に png が無い");
    r.png.width += 1;
  });
  const problems = checkComponent(dir).join("\n");
  expect(problems).toContain("orders-search / default: element.shot.json が無い");
  expect(problems).toContain("users-create / default: element.shot.json の tool_version 5");
  expect(problems).toContain(
    "users-create / hover: element.shot.json の png が element.png の実寸と合わない",
  );
});

test.each([
  ["clip の座標", (r: ShotRecord) => (r.clip.x += 3), "clip"],
  ["rect の欠落", (r: ShotRecord) => delete r.rect, "rect"],
  ["page_rect の座標", (r: ShotRecord) => (r.page_rect.y += 1), "page_rect"],
  ["frame_depth", (r: ShotRecord) => (r.frame_depth = 1), "frame_depth"],
  ["animations", (r: ShotRecord) => (r.animations = "allow"), "animations"],
  ["余計なキー", (r: ShotRecord) => (r.extra = true), "extra"],
])("陽性: element.shot.json の仕様違反を検出する: %s", (_label, mutate, key) => {
  const dir = copyFixture();
  edit(join(dir, "baseline/users-create/default/element.shot.json"), mutate);
  expect(checkComponent(dir).join("\n")).toContain(
    `users-create / default: element.shot.json が採取物と合わない（${key}）`,
  );
});

test("陽性: 寸法が同じ別の撮影の記録を差し込むと検出する", () => {
  const dir = copyFixture();
  // 同じボタン・同じ寸法で状態だけ違う記録（hover）を default に差し込む。rect が同じなら差は出ないので、
  // 別インスタンスの記録を使う（寸法は同じでも位置が違う）。
  const from = readFileSync(join(dir, "baseline/orders-search/default/element.shot.json"), "utf8");
  const to = join(dir, "baseline/users-create/default/element.shot.json");
  const a = parseJsonAs<ShotRecord>(from);
  const b = parseJsonAs<ShotRecord>(readFileSync(to, "utf8"));
  writeFileSync(to, JSON.stringify({ ...a, png: b.png }));
  expect(checkComponent(dir).join("\n")).toContain(
    "users-create / default: element.shot.json が採取物と合わない",
  );
});

test("陽性: 採取物から導けない axes.json を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "axes.json"), (a: { fixed: unknown[] }) => a.fixed.pop());
  expect(checkComponent(dir)).toContain("axes.json が axis-diff --baseline の出力と一致しない");
});

test("陽性: null の撮影条件とノイズ基準値を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m: Metadata) => {
    // わざと null（テンプレートのプレースホルダ）を渡す
    m.capture_conditions = invalidInput(null);
    m.noise_baseline = invalidInput(null);
  });
  const problems = checkComponent(dir);
  expect(problems).toContain("capture_conditions が採取の条件として埋まっていない");
  expect(problems).toContain("noise_baseline が比較の母集合 × ビューポートを 1 件ずつ覆っていない");
});

test("陽性: 組み合わせが欠けたノイズ基準値を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m: Metadata) => m.noise_baseline.pop());
  expect(checkComponent(dir)).toContain(
    "noise_baseline が比較の母集合 × ビューポートを 1 件ずつ覆っていない",
  );
});

test("陽性: 採取未完了の fixture を検出する", () => {
  for (const complete of [false, undefined]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m: Metadata) => {
      m.capture.complete = complete;
    });
    expect(checkComponent(dir)).toContain("capture.complete が true でない");
  }
});

test("陽性: 寸法の無い・不正なビューポートを検出する", () => {
  for (const viewport of [
    { label: "desktop" },
    { label: "desktop", width: 0, height: 800 },
    { label: "desktop", width: 1280, height: -1 },
    { label: "desktop", width: "1280", height: 800 },
  ]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m: Metadata) => {
      // わざと寸法の欠けた・不正なビューポートを渡す
      m.capture_conditions.viewports = [invalidInput<Viewport>(viewport)];
    });
    expect(checkComponent(dir)).toContain("capture_conditions が採取の条件として埋まっていない");
  }
});

test("陽性: 失敗した軸の割り出しを整合して記録していても検出する", () => {
  // axes.json と metadata.axes を同じ失敗結果に揃えると、一致の検査だけでは通ってしまう。
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m: Metadata) => {
    m.instances[0].unreachable_states = [{ state: "hover" }]; // reason の無い不正な宣言
  });
  const failed = axisDiff.diffAxes(axisDiff.assembleFromBaseline(dir));
  expect(failed.ok).toBe(false);
  writeFileSync(join(dir, "axes.json"), JSON.stringify(failed));
  edit(join(dir, "metadata.json"), (m: Metadata) => {
    m.axes = {
      ...m.axes,
      ok: failed.ok,
      variable: failed.variable.length,
      fixed: failed.fixed.length,
      measured: failed.measured,
    };
  });
  const problems = checkComponent(dir);
  expect(problems).not.toContain("axes.json が axis-diff --baseline の出力と一致しない");
  expect(problems.join("\n")).toContain("axis-diff --baseline が ok でない");
});

test("陽性: component-api.md とデータ依存の data.json の欠落を検出する", () => {
  const dir = copyFixture();
  rmSync(join(dir, "component-api.md"));
  edit(join(dir, "metadata.json"), (m: Metadata) => {
    m.instances[0].data = { dependent: true, rows: 3, extract_path: null };
  });
  const problems = checkComponent(dir);
  expect(problems).toContain("component-api.md が無い");
  expect(problems).toContain(
    `${readJson<Metadata>(join(dir, "metadata.json")).instances[0].id}: データ依存なのに data.json が無い`,
  );
});

test("陽性: 重複したビューポートのラベルを検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m: Metadata) => {
    const [vp] = m.capture_conditions.viewports;
    m.capture_conditions.viewports = [vp, { ...vp, width: 390, height: 844 }];
    // 同じラベルの行を 2 つずつ持たせ、ノイズ行の突き合わせだけでは弾けない状態にする
    m.noise_baseline = m.noise_baseline.flatMap((row) => [row, { ...row }]);
  });
  expect(checkComponent(dir)).toContain("capture_conditions が採取の条件として埋まっていない");
});

test("陽性: 期待する行が揃っていても形の不正な余分なノイズ行を検出する", () => {
  for (const extra of [
    null,
    { instance: "orders-search", state: "default", viewport: "desktop", pixel: "0", traits: 0 },
  ]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m: Metadata) => {
      // わざと形の不正な行を渡す
      m.noise_baseline.push(invalidInput<NoiseRow>(extra));
    });
    expect(checkComponent(dir)).toContain("noise_baseline に形の不正な行が 1 件ある");
  }
});

test("陽性: 負のノイズ値と整数でない特性差分件数を検出する", () => {
  for (const patch of [{ pixel: -1 }, { traits: -1 }, { traits: 0.5 }]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m: Metadata) => {
      Object.assign(m.noise_baseline[0], patch);
    });
    expect(checkComponent(dir)).toContain("noise_baseline に形の不正な行が 1 件ある");
  }
});

test("陽性: 到達不能の宣言があるのに not_compared が空の要約を検出する", () => {
  // 正当な宣言で not_compared が非空になる状態を作り、axes.json はそれに合わせて再導出、
  // metadata.json の axes だけを古い（空の not_compared の）ままにする。
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m: Metadata) => {
    m.instances[0].unreachable_states = [
      { state: "disabled", reason: "その画面では無効にできない" },
    ];
  });
  const id = readJson<Metadata>(join(dir, "metadata.json")).instances[0].id;
  rmSync(join(dir, "baseline", id, "disabled"), { recursive: true });
  const derived = axisDiff.diffAxes(axisDiff.assembleFromBaseline(dir));
  expect(derived.ok).toBe(true);
  expect(derived.not_compared).toEqual([{ instance: id, state: "disabled" }]);
  writeFileSync(join(dir, "axes.json"), JSON.stringify(derived));
  edit(join(dir, "metadata.json"), (m: Metadata) => {
    m.axes = {
      ...m.axes,
      ok: derived.ok,
      variable: derived.variable.length,
      fixed: derived.fixed.length,
      measured: derived.measured,
      not_compared: [],
    };
  });
  const problems = checkComponent(dir);
  expect(problems).not.toContain("axes.json が axis-diff --baseline の出力と一致しない");
  expect(problems).toContain("metadata.json の axes の要約が axes.json と一致しない");
});

test("陽性: capture_conditions の全項目の欠落・型崩れを検出する", () => {
  const mutations: ((c: CaptureConditions) => unknown)[] = [
    (c) => delete c.viewer_environment,
    (c) => (c.viewer_environment = null),
    (c) => (c.viewer_environment = "たぶん一致"),
    (c) => delete c.masks,
    (c) => (c.masks = null),
    (c) => (c.masks = [""]),
    (c) => (c.masks = "none"),
    (c) => removeField(c, "animations"),
    (c) => (c.unknown_field = true),
    (c) => (c.viewports[0].dpr = 1),
  ];
  for (const mutate of mutations) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m: Metadata) => mutate(m.capture_conditions));
    expect(checkComponent(dir), String(mutate)).toContain(
      "capture_conditions が採取の条件として埋まっていない",
    );
  }
});

test("capture_conditions の正当な値の変化は通す", () => {
  // 過剰修正の検知: 仕様が許す値（乖離の宣言・マスクの列挙）では落とさない。
  for (const mutate of [
    (c: CaptureConditions) =>
      (c.viewer_environment = "乖離: 利用者は Windows 既定フォント（gaps.md 参照）"),
    (c: CaptureConditions) => (c.viewer_environment = "未確認"),
    (c: CaptureConditions) => (c.masks = ["[data-testid=timestamp]"]),
  ]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m: Metadata) => mutate(m.capture_conditions));
    expect(checkComponent(dir), String(mutate)).toEqual([]);
  }
});

test("陽性: ノイズ行の未知・欠落キーを検出する", () => {
  for (const mutate of [
    (row: NoiseRow) => (row.extra = 1),
    (row: NoiseRow) => delete row.viewport,
  ]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m: Metadata) => mutate(m.noise_baseline[0]));
    expect(checkComponent(dir).join("\n"), String(mutate)).toContain("noise_baseline");
  }
});
