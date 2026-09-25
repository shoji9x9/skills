// parity-component の eval fixture（採取物）が、実物のツールの出力として互いに整合していることの検査（Issue #354）。
//
// 手で作った採取物は、metadata.json の `traits_property_set` が実物の FIXED_PROPERTIES と違う・
// css-rules.json の宣言が traits.json の計算値と食い違う・element.png がプレースホルダ、という形で
// 壊れてきた。`build` の前提検証はこれらを突き合わせるので、壊れた fixture では eval が目的の分岐へ届かない。
// 採取物は scripts/generate-parity-component-fixtures.js で生成し、ここでは生成物どうしの整合だけを見る
// （CI にブラウザが無いので再生成はしない）。各検査は壊した写しで赤くなることを併せて確かめる。

import { expect, test } from "vitest";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = join(repoRoot, "evals/parity-component/fixtures");
const traitCapture = await import(join(repoRoot, "skills/parity-suite/scripts/trait-capture.mjs"));
const cssRules = await import(
  join(repoRoot, "skills/parity-component/scripts/css-rules-capture.mjs")
);
const axisDiff = await import(join(repoRoot, "skills/parity-component/scripts/axis-diff.mjs"));
const behaviorCompare = await import(
  join(repoRoot, "skills/parity-component/scripts/behavior-compare.mjs")
);
const elementShot = await import(join(repoRoot, "skills/parity-suite/scripts/element-shot.mjs"));

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const TEMPLATE = readJson(join(repoRoot, "skills/parity-component/assets/metadata-template.json"));
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
  // element-shot.mjs の版も突き合わせる。build 手順 1 のツール版判定がこの値を読むので、
  // 欠けていると eval が実装の分岐へ届かず前段で止まる。
  if (tools.element_shot_version !== elementShot.VERSION) {
    problems.push(`element_shot_version ${tools.element_shot_version} ≠ ${elementShot.VERSION}`);
  }
  // テンプレートはコピー先のパスも記録させる（`traits` と対）。版だけ埋めて経路を書かない
  // 採取物を fixture が手本にしてしまうため、パス側も揃っていることを検査する。
  for (const key of ["traits", "element_shot"]) {
    if (typeof tools[key] !== "string" || tools[key] === "") {
      problems.push(`capture.tools.${key} にコピー先のパスが無い`);
    }
  }
  if (tools.css_rules_version !== cssRules.VERSION) {
    problems.push(`css_rules_version ${tools.css_rules_version} ≠ ${cssRules.VERSION}`);
  }
  if (tools.axis_diff_version !== axisDiff.VERSION) {
    problems.push(`axis_diff_version ${tools.axis_diff_version} ≠ ${axisDiff.VERSION}`);
  }
  // `build` の前段ゲートを満たしていること自体も検査する。整合していても、採取未完了や
  // 軸の割り出しが失敗した採取物は、eval を目的の分岐より手前で止める。
  if (meta.capture.complete !== true) problems.push("capture.complete が true でない");
  for (const name of ["axes.json", "component-api.md"]) {
    if (!existsSync(join(dir, name))) problems.push(`${name} が無い`);
  }
  for (const inst of meta.instances) {
    if (
      inst.data &&
      inst.data.dependent === true &&
      !existsSync(join(dir, "baseline", inst.id, "data.json"))
    ) {
      problems.push(`${inst.id}: データ依存なのに data.json が無い`);
    }
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
      // element.shot.json は element.png と同じ run の記録。宣言した element_shot_version の出力と
      // 名乗る以上、記録が在り、その版で、PNG の実寸と一致していなければならない。
      const shotPath = join(base, "element.shot.json");
      const shot = existsSync(shotPath) ? readJson(shotPath) : null;
      if (!shot) {
        problems.push(`${where}: element.shot.json が無い`);
      } else {
        if (shot.tool_version !== elementShot.VERSION) {
          problems.push(
            `${where}: element.shot.json の tool_version ${shot.tool_version} ≠ ${elementShot.VERSION}`,
          );
        }
        if (png && (shot.png?.width !== png.width || shot.png?.height !== png.height)) {
          problems.push(`${where}: element.shot.json の png が element.png の実寸と合わない`);
        }
        // 記録の契約全体を、対になる採取物から組み立て直した期待値と突き合わせる（キーの過不足も含む）。
        // fixture は最上位フレームの要素だけなので page_rect = traits.rect・frame_depth = 0、clip は
        // 記録した撮影条件のビューポートで element-shot.mjs の planElementClip が決める値。
        // 寸法が同じ別の撮影の記録を差し込んでも、rect / clip の座標で食い違う。
        const viewport = meta.capture_conditions?.viewports?.[0];
        let expectedClip = null;
        try {
          expectedClip = viewport ? elementShot.planElementClip(traits.rect, viewport) : null;
        } catch (error) {
          // ビューポートの不備は capture_conditions の検査が別に報告する。ここでは再計算できないことだけ残す。
          problems.push(
            `${where}: element.shot.json の clip を撮影条件から再計算できない（${error.message}）`,
          );
        }
        if (png && expectedClip) {
          const expected = elementShot.buildShotRecord({
            clip: expectedClip,
            png,
            rect: traits.rect,
            page_rect: traits.rect,
            frame_depth: 0,
            animations: meta.capture_conditions.animations,
          });
          const keys = [...new Set([...Object.keys(expected), ...Object.keys(shot)])].sort();
          const differ = keys.filter((k) => !isDeepStrictEqual(shot[k], expected[k]));
          if (differ.length > 0) {
            problems.push(`${where}: element.shot.json が採取物と合わない（${differ.join(", ")}）`);
          }
        }
      }
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
  // キーの集合はスキーマの正本（assets/metadata-template.json）から取る。検査する項目を手で選ぶと、
  // 選び漏れた項目（viewer_environment / masks 等）の欠落・型崩れが合格する。
  const sameKeys = (value, template) =>
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Object.keys(template).sort());
  if (
    !sameKeys(conditions, TEMPLATE.capture_conditions) ||
    typeof conditions.viewer_environment !== "string" ||
    !/^(一致|未確認|乖離: .+)$/.test(conditions.viewer_environment) ||
    !Array.isArray(conditions.masks) ||
    conditions.masks.some((m) => typeof m !== "string" || m === "") ||
    !Array.isArray(conditions.viewports) ||
    !conditions.viewports.every((v) => sameKeys(v, TEMPLATE.capture_conditions.viewports[0])) ||
    typeof conditions.environment !== "string" ||
    conditions.environment === "" ||
    viewportLabels.length === 0 ||
    viewportLabels.some((l) => typeof l !== "string" || l === "") ||
    // ラベルは noise_baseline と照合する側のキー。重複すると別寸法の 2 ビューポートを区別できない
    new Set(viewportLabels).size !== viewportLabels.length ||
    conditions.viewports.some(
      (v) =>
        !(
          v &&
          Number.isFinite(v.width) &&
          v.width > 0 &&
          Number.isFinite(v.height) &&
          v.height > 0
        ),
    ) ||
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
  // 形の壊れた行は捨てずに問題にする。除外してから突き合わせると、期待する行が揃っている限り
  // 壊れた余分な行が metadata.json に残ったまま合格する。
  const noiseRows = Array.isArray(meta.noise_baseline) ? meta.noise_baseline : [];
  const malformedNoise = noiseRows.filter(
    (n) =>
      !sameKeys(n, TEMPLATE.noise_baseline[0]) ||
      typeof n.instance !== "string" ||
      typeof n.state !== "string" ||
      typeof n.viewport !== "string" ||
      // 画素差分量は 0 以上の数、特性照合の差分は 0 以上の件数（整数）
      !(Number.isFinite(n.pixel) && n.pixel >= 0) ||
      !(Number.isInteger(n.traits) && n.traits >= 0),
  );
  if (malformedNoise.length > 0) {
    problems.push(`noise_baseline に形の壊れた行が ${malformedNoise.length} 件ある`);
  }
  const recordedNoise = noiseRows
    .filter((n) => !malformedNoise.includes(n))
    .map((n) => `${n.instance}\u001f${n.state}\u001f${n.viewport}`)
    .sort();
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
  if (derived.ok !== true) {
    problems.push(`axis-diff --baseline が ok でない: ${derived.problems.join(" / ")}`);
  }
  if (JSON.stringify(readJson(join(dir, "axes.json"))) !== JSON.stringify(derived)) {
    problems.push("axes.json が axis-diff --baseline の出力と一致しない");
  }
  // metadata.json の axes は要約の全体を再導出結果と突き合わせる。項目を個別に選ぶと、
  // 選ばなかった項目（not_compared 等）が古いまま・空のまま合格する。
  const expectedAxes = {
    ok: derived.ok,
    variable: derived.variable.length,
    fixed: derived.fixed.length,
    measured: derived.measured,
    not_compared: derived.not_compared,
  };
  const { path: _path, ...recordedAxes } = meta.axes || {};
  if (JSON.stringify(recordedAxes) !== JSON.stringify(expectedAxes)) {
    problems.push("metadata.json の axes の要約が axes.json と一致しない");
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
    "cascade-conflict/.replace/components/button",
    "catalog-unset/.replace/components/button",
  ]);
});

// build の前提は全インスタンスの behaviors.json を要求する（Issue #446）。欠けた fixture では build 系の eval が
// 前提判定で止まり目的の分岐へ届かないので、基準側が behavior-compare.mjs の検査を通ることを確かめる。
// 突き合わせ表は渡さない（基準側の不備だけを見る）ので、期待する finding は comparison-missing の 1 件だけ。
test.each(componentDirs.map((d) => [d.slice(fixturesRoot.length + 1), d]))(
  "操作の結果の基準が behavior-compare.mjs の基準側の検査を通る: %s",
  (_, dir) => {
    const { metadata, behaviors } = behaviorCompare.loadBaseline(dir);
    const result = behaviorCompare.compareBehaviors({
      metadata,
      behaviors,
      comparison: null,
      target: "any",
    });
    expect(result.structural).toBe(false);
    expect(result.counts.cells).toBeGreaterThan(0);
    expect(result.findings.map((f) => f.code)).toEqual(["comparison-missing"]);
  },
);

test.each(componentDirs.map((d) => [d.slice(fixturesRoot.length + 1), d]))(
  "採取物が実物のツールの出力として整合している: %s",
  (_, dir) => {
    expect(checkComponent(dir)).toEqual([]);
  },
);

// --- 陽性コントロール: 壊した写しで各検査が赤くなる ---

const copyFixture = () => {
  const dir = join(makeTempDir("parity-component-fixture-"), "button");
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
  // 実物の FIXED_PROPERTIES に無い名前を選ぶ（集合に足された名前を使うと、重複で長さが変わる
  // せいで通ってしまい、「実物に無い名前を検出した」ことの証拠にならない）。
  edit(join(dir, "metadata.json"), (m) => {
    expect(m.capture.tools.traits_property_set).not.toContain("letter-spacing");
    m.capture.tools.traits_property_set.push("letter-spacing");
  });
  expect(checkComponent(dir)).toContain(
    "traits_property_set が trait-capture.mjs の FIXED_PROPERTIES と一致しない",
  );
});

test("陽性コントロール: 記録されていない element_shot_version を検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m) => {
    // 「値が違う」ではなく「キーごと無い」形で壊す。element-shot.mjs は今回の追加なので、
    // 既存の fixture がキーを持たないまま通り抜けるのがいちばん起きやすい壊れ方。
    delete m.capture.tools.element_shot_version;
  });
  expect(checkComponent(dir)).toContain(`element_shot_version undefined ≠ ${elementShot.VERSION}`);
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

test("陽性コントロール: element.shot.json の欠落・版違い・実寸違いを検出する", () => {
  const dir = copyFixture();
  rmSync(join(dir, "baseline/orders-search/default/element.shot.json"));
  edit(join(dir, "baseline/users-create/default/element.shot.json"), (r) => {
    r.tool_version = "5";
  });
  edit(join(dir, "baseline/users-create/hover/element.shot.json"), (r) => {
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
  ["clip の座標", (r) => (r.clip.x += 3), "clip"],
  ["rect の欠落", (r) => delete r.rect, "rect"],
  ["page_rect の座標", (r) => (r.page_rect.y += 1), "page_rect"],
  ["frame_depth", (r) => (r.frame_depth = 1), "frame_depth"],
  ["animations", (r) => (r.animations = "allow"), "animations"],
  ["余計なキー", (r) => (r.extra = true), "extra"],
])("陽性コントロール: element.shot.json の契約違反を検出する: %s", (_label, mutate, key) => {
  const dir = copyFixture();
  edit(join(dir, "baseline/users-create/default/element.shot.json"), mutate);
  expect(checkComponent(dir).join("\n")).toContain(
    `users-create / default: element.shot.json が採取物と合わない（${key}）`,
  );
});

test("陽性コントロール: 寸法が同じ別の撮影の記録を差し込むと検出する", () => {
  const dir = copyFixture();
  // 同じボタン・同じ寸法で状態だけ違う記録（hover）を default に差し込む。rect が同じなら差は出ないので、
  // 別インスタンスの記録を使う（寸法は同じでも位置が違う）。
  const from = readFileSync(join(dir, "baseline/orders-search/default/element.shot.json"), "utf8");
  const to = join(dir, "baseline/users-create/default/element.shot.json");
  const a = JSON.parse(from);
  const b = JSON.parse(readFileSync(to, "utf8"));
  writeFileSync(to, JSON.stringify({ ...a, png: b.png }));
  expect(checkComponent(dir).join("\n")).toContain(
    "users-create / default: element.shot.json が採取物と合わない",
  );
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

test("陽性コントロール: 採取未完了の fixture を検出する", () => {
  for (const complete of [false, undefined]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m) => {
      m.capture.complete = complete;
    });
    expect(checkComponent(dir)).toContain("capture.complete が true でない");
  }
});

test("陽性コントロール: 寸法の無い・不正なビューポートを検出する", () => {
  for (const viewport of [
    { label: "desktop" },
    { label: "desktop", width: 0, height: 800 },
    { label: "desktop", width: 1280, height: -1 },
    { label: "desktop", width: "1280", height: 800 },
  ]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m) => {
      m.capture_conditions.viewports = [viewport];
    });
    expect(checkComponent(dir)).toContain("capture_conditions が採取の条件として埋まっていない");
  }
});

test("陽性コントロール: 失敗した軸の割り出しを整合して記録していても検出する", () => {
  // axes.json と metadata.axes を同じ失敗結果に揃えると、一致の検査だけでは通ってしまう。
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m) => {
    m.instances[0].unreachable_states = [{ state: "hover" }]; // reason の無い不正な宣言
  });
  const failed = axisDiff.diffAxes(axisDiff.assembleFromBaseline(dir));
  expect(failed.ok).toBe(false);
  writeFileSync(join(dir, "axes.json"), JSON.stringify(failed));
  edit(join(dir, "metadata.json"), (m) => {
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

test("陽性コントロール: component-api.md とデータ依存の data.json の欠落を検出する", () => {
  const dir = copyFixture();
  rmSync(join(dir, "component-api.md"));
  edit(join(dir, "metadata.json"), (m) => {
    m.instances[0].data = { dependent: true, rows: 3, extract_path: null };
  });
  const problems = checkComponent(dir);
  expect(problems).toContain("component-api.md が無い");
  expect(problems).toContain(
    `${readJson(join(dir, "metadata.json")).instances[0].id}: データ依存なのに data.json が無い`,
  );
});

test("陽性コントロール: 重複したビューポートのラベルを検出する", () => {
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m) => {
    const [vp] = m.capture_conditions.viewports;
    m.capture_conditions.viewports = [vp, { ...vp, width: 390, height: 844 }];
    // 同じラベルの行を 2 つずつ持たせ、ノイズ行の突き合わせだけでは弾けない状態にする
    m.noise_baseline = m.noise_baseline.flatMap((row) => [row, { ...row }]);
  });
  expect(checkComponent(dir)).toContain("capture_conditions が採取の条件として埋まっていない");
});

test("陽性コントロール: 期待する行が揃っていても形の壊れた余分なノイズ行を検出する", () => {
  for (const extra of [
    null,
    { instance: "orders-search", state: "default", viewport: "desktop", pixel: "0", traits: 0 },
  ]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m) => {
      m.noise_baseline.push(extra);
    });
    expect(checkComponent(dir)).toContain("noise_baseline に形の壊れた行が 1 件ある");
  }
});

test("陽性コントロール: 負のノイズ値と整数でない特性差分件数を検出する", () => {
  for (const patch of [{ pixel: -1 }, { traits: -1 }, { traits: 0.5 }]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m) => {
      Object.assign(m.noise_baseline[0], patch);
    });
    expect(checkComponent(dir)).toContain("noise_baseline に形の壊れた行が 1 件ある");
  }
});

test("陽性コントロール: 到達不能の宣言があるのに not_compared が空の要約を検出する", () => {
  // 正当な宣言で not_compared が非空になる状態を作り、axes.json はそれに合わせて再導出、
  // metadata.json の axes だけを古い（空の not_compared の）ままにする。
  const dir = copyFixture();
  edit(join(dir, "metadata.json"), (m) => {
    m.instances[0].unreachable_states = [
      { state: "disabled", reason: "その画面では無効にできない" },
    ];
  });
  const id = readJson(join(dir, "metadata.json")).instances[0].id;
  rmSync(join(dir, "baseline", id, "disabled"), { recursive: true });
  const derived = axisDiff.diffAxes(axisDiff.assembleFromBaseline(dir));
  expect(derived.ok).toBe(true);
  expect(derived.not_compared).toEqual([{ instance: id, state: "disabled" }]);
  writeFileSync(join(dir, "axes.json"), JSON.stringify(derived));
  edit(join(dir, "metadata.json"), (m) => {
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

test("陽性コントロール: capture_conditions の全項目の欠落・型崩れを検出する", () => {
  const mutations = [
    (c) => delete c.viewer_environment,
    (c) => (c.viewer_environment = null),
    (c) => (c.viewer_environment = "たぶん一致"),
    (c) => delete c.masks,
    (c) => (c.masks = null),
    (c) => (c.masks = [""]),
    (c) => (c.masks = "none"),
    (c) => delete c.animations,
    (c) => (c.unknown_field = true),
    (c) => (c.viewports[0].dpr = 1),
  ];
  for (const mutate of mutations) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m) => mutate(m.capture_conditions));
    expect(checkComponent(dir), String(mutate)).toContain(
      "capture_conditions が採取の条件として埋まっていない",
    );
  }
});

test("capture_conditions の正当な値の変化は通す", () => {
  // 過剰修正の検知: 契約が許す値（乖離の宣言・マスクの列挙）では落とさない。
  for (const mutate of [
    (c) => (c.viewer_environment = "乖離: 利用者は Windows 既定フォント（gaps.md 参照）"),
    (c) => (c.viewer_environment = "未確認"),
    (c) => (c.masks = ["[data-testid=timestamp]"]),
  ]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m) => mutate(m.capture_conditions));
    expect(checkComponent(dir), String(mutate)).toEqual([]);
  }
});

test("陽性コントロール: ノイズ行の未知・欠落キーを検出する", () => {
  for (const mutate of [(row) => (row.extra = 1), (row) => delete row.viewport]) {
    const dir = copyFixture();
    edit(join(dir, "metadata.json"), (m) => mutate(m.noise_baseline[0]));
    expect(checkComponent(dir).join("\n"), String(mutate)).toContain("noise_baseline");
  }
});
