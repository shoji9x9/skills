// parity-component の eval fixture（採取物）が、実物のツールの出力として互いに整合していることの検査（Issue #354）。
//
// 手で作った採取物は、metadata.json の `traits_property_set` が実物の FIXED_PROPERTIES と違う・
// css-rules.json の宣言が traits.json の計算値と食い違う・element.png がプレースホルダ、という形で
// 壊れてきた。`build` の前提検証はこれらを突き合わせるので、壊れた fixture では eval が目的の分岐へ届かない。
// 採取物は scripts/generate-parity-component-fixtures.js で生成し、ここでは生成物どうしの整合だけを見る
// （CI にブラウザが無いので再生成はしない）。各検査は壊した写しで赤くなることを併せて確かめる。

import { expect, test } from "vitest";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = join(repoRoot, "skills/parity-component/evals/fixtures");
const traitCapture = await import(join(repoRoot, "skills/parity-suite/scripts/trait-capture.mjs"));
const cssRules = await import(
  join(repoRoot, "skills/parity-component/scripts/css-rules-capture.mjs")
);
const axisDiff = await import(join(repoRoot, "skills/parity-component/scripts/axis-diff.mjs"));

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sorted = (values) => [...values].sort();

// PNG の IHDR から幅と高さを読む（署名 8 バイト → 長さ 4 → "IHDR" 4 → 幅 4 → 高さ 4）。
function pngSize(path) {
  const buf = readFileSync(path);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature)) return null;
  if (buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * 1 部品分の採取物ディレクトリを検査し、見つかった不整合を返す（空なら整合）。
 * @param {string} dir `.replace/components/<slug>/`
 * @returns {string[]}
 */
function checkComponent(dir) {
  const problems = [];
  const meta = readJson(join(dir, "metadata.json"));
  const tools = meta.capture.tools;
  if (tools.traits_version !== traitCapture.VERSION) {
    problems.push(`traits_version ${tools.traits_version} ≠ ${traitCapture.VERSION}`);
  }
  if (tools.css_rules_version !== cssRules.VERSION) {
    problems.push(`css_rules_version ${tools.css_rules_version} ≠ ${cssRules.VERSION}`);
  }
  if (tools.axis_diff_version !== axisDiff.VERSION) {
    problems.push(`axis_diff_version ${tools.axis_diff_version} ≠ ${axisDiff.VERSION}`);
  }
  const expectedProperties = sorted(traitCapture.FIXED_PROPERTIES);
  if (JSON.stringify(sorted(tools.traits_property_set)) !== JSON.stringify(expectedProperties)) {
    problems.push("traits_property_set が trait-capture.mjs の FIXED_PROPERTIES と一致しない");
  }

  let unresolved = 0;
  let inaccessible = 0;
  for (const inst of meta.instances) {
    const skipped = new Set((inst.unreachable_states || []).map((u) => u.state));
    for (const state of meta.capture.states.filter((s) => !skipped.has(s))) {
      const where = `${inst.id} / ${state}`;
      const base = join(dir, "baseline", inst.id, state);
      const traits = readJson(join(base, "traits.json"));
      const rules = readJson(join(base, "css-rules.json"));
      unresolved += rules.unresolved.length;
      inaccessible += rules.inaccessible.length;

      if (
        JSON.stringify(sorted(Object.keys(traits.computed))) !== JSON.stringify(expectedProperties)
      ) {
        problems.push(`${where}: traits.json の computed のキーが FIXED_PROPERTIES と一致しない`);
      }
      if (rules.tool_version !== cssRules.VERSION) {
        problems.push(`${where}: css-rules.json の tool_version ${rules.tool_version}`);
      }

      // その状態で成立する宣言（状態擬似クラスがその状態だけ・擬似要素なし・条件なし）が
      // 設定するプロパティは、計算値がその宣言値のどれかと一致するはず。
      // 一致しなければ、規則と計算値が別々に作られている（実物の採取ではありえない組み合わせ）。
      const active = new Set(state === "default" ? [] : [state]);
      const declared = new Map();
      const add = (d) => declared.set(d.property, [...(declared.get(d.property) || []), d.value]);
      for (const rule of rules.matched) {
        if (rule.pseudo_element || rule.conditions.length > 0) continue;
        if (!rule.states.every((s) => active.has(s))) continue;
        rule.declarations.forEach(add);
      }
      rules.inline_declarations.forEach(add);
      for (const [property, values] of declared) {
        if (!Object.hasOwn(traits.computed, property)) continue;
        if (!values.includes(traits.computed[property])) {
          problems.push(
            `${where}: ${property} の計算値 ${traits.computed[property]} が当たっている宣言（${values.join(", ")}）に無い`,
          );
        }
      }

      const png = existsSync(join(base, "element.png")) ? pngSize(join(base, "element.png")) : null;
      if (!png) {
        problems.push(`${where}: element.png が PNG でない`);
      } else if (
        Math.abs(png.width - traits.rect.width) >= 1 ||
        Math.abs(png.height - traits.rect.height) >= 1
      ) {
        problems.push(
          `${where}: element.png（${png.width}×${png.height}）が rect（${traits.rect.width}×${traits.rect.height}）と合わない`,
        );
      }
    }
  }

  // 撮影条件とノイズ基準値は `build` の照合が同一条件を再現する材料。`capture.complete: true` なのに
  // null のまま（プレースホルダ）だと、比較へ進む前提が欠けたまま完了を名乗る。
  const conditions = meta.capture_conditions;
  const viewportLabels =
    conditions && Array.isArray(conditions.viewports)
      ? conditions.viewports.map((v) => v && v.label)
      : [];
  if (
    !conditions ||
    typeof conditions.environment !== "string" ||
    conditions.environment === "" ||
    viewportLabels.length === 0 ||
    viewportLabels.some((l) => typeof l !== "string" || l === "") ||
    conditions.animations !== "disabled" ||
    conditions.element_screenshot !== true
  ) {
    problems.push("capture_conditions が採取の条件として埋まっていない");
  }
  const expectedNoise = meta.instances
    .flatMap((inst) => {
      const skipped = new Set((inst.unreachable_states || []).map((u) => u.state));
      return meta.capture.states.filter((s) => !skipped.has(s)).map((s) => [inst.id, s]);
    })
    .flatMap(([id, st]) => viewportLabels.map((vp) => `${id}\u001f${st}\u001f${vp}`))
    .sort();
  const recordedNoise = Array.isArray(meta.noise_baseline)
    ? meta.noise_baseline
        .filter((n) => n && Number.isFinite(n.pixel) && Number.isFinite(n.traits))
        .map((n) => `${n.instance}\u001f${n.state}\u001f${n.viewport}`)
        .sort()
    : [];
  if (
    JSON.stringify(recordedNoise) !== JSON.stringify(expectedNoise) ||
    expectedNoise.length === 0
  ) {
    problems.push("noise_baseline が比較の母集合 × ビューポートを 1 件ずつ覆っていない");
  }

  const gaps = meta.capture_gaps || {};
  if (gaps.unresolved_selectors !== unresolved || gaps.inaccessible_sheets !== inaccessible) {
    problems.push("capture_gaps が css-rules.json の件数と一致しない");
  }

  const derived = axisDiff.diffAxes(axisDiff.assembleFromBaseline(dir));
  if (JSON.stringify(readJson(join(dir, "axes.json"))) !== JSON.stringify(derived)) {
    problems.push("axes.json が axis-diff --baseline の出力と一致しない");
  }
  const { variable, fixed, measured, ok } = meta.axes;
  if (
    ok !== derived.ok ||
    variable !== derived.variable.length ||
    fixed !== derived.fixed.length ||
    measured !== derived.measured
  ) {
    problems.push("metadata.json の axes の件数が axes.json と一致しない");
  }
  return problems;
}

// baseline を持つ部品の採取物を全 fixture から集める（0 件を合格に倒さない）。
const componentDirs = readdirSync(fixturesRoot)
  .map((name) => join(fixturesRoot, name, ".replace/components"))
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => readdirSync(dir).map((slug) => join(dir, slug)))
  .filter((dir) => existsSync(join(dir, "baseline")));

test("baseline を持つ fixture を見つけている（検査対象が 0 件で緑にしない）", () => {
  expect(componentDirs.map((d) => d.slice(fixturesRoot.length + 1)).sort()).toEqual([
    "breaking-change-request/.replace/components/button",
    "catalog-unset/.replace/components/button",
  ]);
});

test.each(componentDirs.map((d) => [d.slice(fixturesRoot.length + 1), d]))(
  "採取物が実物のツールの出力として整合している: %s",
  (_, dir) => {
    expect(checkComponent(dir)).toEqual([]);
  },
);

// --- 陽性コントロール: 壊した写しで各検査が赤くなる ---

const copyFixture = () => {
  const dir = join(mkdtempSync(join(tmpdir(), "parity-component-fixture-")), "button");
  cpSync(componentDirs[0], dir, { recursive: true });
  return dir;
};
const edit = (path, mutate) => {
  const value = readJson(path);
  mutate(value);
  writeFileSync(path, JSON.stringify(value));
};

test("陽性コントロール: 実物に無いプロパティを含む traits_property_set を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m) => m.capture.tools.traits_property_set.push("box-shadow"));
  expect(checkComponent(dir)).toContain(
    "traits_property_set が trait-capture.mjs の FIXED_PROPERTIES と一致しない",
  );
});

test("陽性コントロール: 計算値と食い違う規則の宣言を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "baseline/users-create/hover/css-rules.json"), (r) => {
    const hover = r.matched.find((m) => m.states.includes("hover"));
    hover.declarations[0].value = "rgb(0, 70, 130)";
  });
  expect(checkComponent(dir).join("\n")).toContain(
    "users-create / hover: background-color の計算値 rgb(221, 221, 221) が当たっている宣言",
  );
});

test("陽性コントロール: rect と合わない element.png を検出する", () => {
  const dir = copyFixture();
  const other = readFileSync(join(dir, "baseline/orders-search/default/element.png"));
  writeFileSync(join(dir, "baseline/users-create/default/element.png"), other);
  expect(checkComponent(dir).join("\n")).toContain("users-create / default: element.png");
});

test("陽性コントロール: 採取物から導けない axes.json を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "axes.json"), (a) => a.fixed.pop());
  expect(checkComponent(dir)).toContain("axes.json が axis-diff --baseline の出力と一致しない");
});

test("陽性コントロール: null の撮影条件とノイズ基準値を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m) => {
    m.capture_conditions = null;
    m.noise_baseline = null;
  });
  const problems = checkComponent(dir);
  expect(problems).toContain("capture_conditions が採取の条件として埋まっていない");
  expect(problems).toContain("noise_baseline が比較の母集合 × ビューポートを 1 件ずつ覆っていない");
});

test("陽性コントロール: 組み合わせが欠けたノイズ基準値を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m) => m.noise_baseline.pop());
  expect(checkComponent(dir)).toContain(
    "noise_baseline が比較の母集合 × ビューポートを 1 件ずつ覆っていない",
  );
});
