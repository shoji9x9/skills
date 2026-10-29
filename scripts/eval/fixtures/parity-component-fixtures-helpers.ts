// parity-component-fixtures.test.ts のヘルパー（1 部品分の採取物を検査し、不正にしたコピーを作る）。
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { errorMessage } from "../../lib/errors.ts";
import { readJson } from "../read-json-helpers.ts";
import * as traitCapture from "../../../skills/parity-suite/scripts/trait-capture.mjs";
import * as cssRules from "../../../skills/parity-component/scripts/css-rules-capture.mjs";
import * as axisDiff from "../../../skills/parity-component/scripts/axis-diff.mjs";
import * as elementShot from "../../../skills/parity-suite/scripts/element-shot.mjs";
import { isArray } from "../../lib/is-array.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const fixturesRoot = join(repoRoot, "evals/parity-component/fixtures");

// The parts of the capture files this reads. Fields a check validates itself are `unknown`.
export type Viewport = { label?: unknown; width: number; height: number; [key: string]: unknown };
export type CaptureConditions = {
  viewer_environment?: unknown;
  masks?: unknown;
  viewports: Viewport[];
  environment?: unknown;
  // element-shot.mjs の buildShotRecord が文字列で受け取る。欠けた fixture は陽性の検査が欄を消して作る。
  animations: string;
  element_screenshot?: unknown;
  [key: string]: unknown;
};
export type NoiseRow = {
  instance?: unknown;
  state?: unknown;
  viewport?: unknown;
  pixel: number;
  traits: number;
  [key: string]: unknown;
};
type Instance = {
  id: string;
  data?: { dependent?: unknown; [key: string]: unknown } | null;
  unreachable_states?: { state: string; reason?: string }[];
};
export type Metadata = {
  capture: {
    complete?: unknown;
    states: string[];
    tools: { traits_property_set: string[]; [key: string]: unknown };
    [key: string]: unknown;
  };
  instances: Instance[];
  capture_conditions: CaptureConditions;
  noise_baseline: NoiseRow[];
  capture_gaps?: { unresolved_selectors?: unknown; inaccessible_sheets?: unknown } | null;
  axes?: Record<string, unknown> | null;
  [key: string]: unknown;
};
type Declaration = { property: string; value: unknown };
export type CssRules = {
  tool_version?: unknown;
  unresolved: unknown[];
  inaccessible: unknown[];
  matched: {
    pseudo_element?: unknown;
    conditions: unknown[];
    states: string[];
    declarations: Declaration[];
  }[];
  inline_declarations: Declaration[];
};
type Traits = {
  computed: Record<string, unknown>;
  rect: { x: number; y: number; width: number; height: number; [key: string]: unknown };
};
export type ShotRecord = {
  tool_version?: unknown;
  png?: { width: number; height: number };
  clip: { x: number; [key: string]: unknown };
  rect?: unknown;
  page_rect: { y: number; [key: string]: unknown };
  frame_depth?: unknown;
  animations?: unknown;
  [key: string]: unknown;
};
type Template = {
  capture_conditions: { viewports: object[] };
  noise_baseline: object[];
};
type PngSize = { width: number; height: number };

/** 1 つのインスタンスの 1 つの状態について、検査が読む採取物。 */
type StateCapture = {
  where: string;
  base: string;
  state: string;
  traits: Traits;
  rules: CssRules;
  png: PngSize | null;
  meta: Metadata;
};

const TEMPLATE = readJson<Template>(
  join(repoRoot, "skills/parity-component/assets/metadata-template.json"),
);
const sorted = (values: Iterable<string>) => [...values].sort();
const EXPECTED_PROPERTIES = sorted(traitCapture.FIXED_PROPERTIES);

// PNG の IHDR から幅と高さを読む（署名 8 バイト → 長さ 4 → "IHDR" 4 → 幅 4 → 高さ 4）。
function pngSize(path: string) {
  const buf = readFileSync(path);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature)) return null;
  if (buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** metadata.json に記録したツールのバージョンとコピー先のパスを、同梱のツールと突き合わせる。 */
function checkTools(tools: Metadata["capture"]["tools"], problems: string[]) {
  if (tools.traits_version !== traitCapture.VERSION) {
    problems.push(`traits_version ${String(tools.traits_version)} ≠ ${traitCapture.VERSION}`);
  }
  // element-shot.mjs のバージョンも突き合わせる。build 手順 1 のツール版判定がこの値を読むので、
  // 欠けていると eval が実装の分岐へ届かず前段で止まる。
  if (tools.element_shot_version !== elementShot.VERSION) {
    problems.push(
      `element_shot_version ${String(tools.element_shot_version)} ≠ ${elementShot.VERSION}`,
    );
  }
  // テンプレートはコピー先のパスも記録させる（`traits` と対）。バージョンだけ埋めてパスを書かない
  // 採取物を fixture が手本にしてしまうため、パス側も揃っていることを検査する。
  for (const key of ["traits", "element_shot"]) {
    if (typeof tools[key] !== "string" || tools[key] === "") {
      problems.push(`capture.tools.${key} にコピー先のパスが無い`);
    }
  }
  if (tools.css_rules_version !== cssRules.VERSION) {
    problems.push(`css_rules_version ${String(tools.css_rules_version)} ≠ ${cssRules.VERSION}`);
  }
  if (tools.axis_diff_version !== axisDiff.VERSION) {
    problems.push(`axis_diff_version ${String(tools.axis_diff_version)} ≠ ${axisDiff.VERSION}`);
  }
}

/** `build` の前段のチェックが求めるもの（採取の完了・付属のファイル・特性の集合）を検査する。 */
function checkPrerequisites(dir: string, meta: Metadata, problems: string[]) {
  // `build` の前段のチェックを満たしていること自体も検査する。整合していても、採取未完了や
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
  if (
    JSON.stringify(sorted(meta.capture.tools.traits_property_set)) !==
    JSON.stringify(EXPECTED_PROPERTIES)
  ) {
    problems.push("traits_property_set が trait-capture.mjs の FIXED_PROPERTIES と一致しない");
  }
}

/** 到達不能と宣言した状態を除いた、比較する状態の一覧。 */
function comparedStates(meta: Metadata, inst: Instance) {
  const skipped = new Set((inst.unreachable_states || []).map((u) => u.state));
  return meta.capture.states.filter((s) => !skipped.has(s));
}

/** traits.json のキーと、その状態で成立する css-rules.json の宣言を、計算値と突き合わせる。 */
function checkDeclarations(capture: StateCapture, problems: string[]) {
  const { where, state, traits, rules } = capture;
  if (
    JSON.stringify(sorted(Object.keys(traits.computed))) !== JSON.stringify(EXPECTED_PROPERTIES)
  ) {
    problems.push(`${where}: traits.json の computed のキーが FIXED_PROPERTIES と一致しない`);
  }
  if (rules.tool_version !== cssRules.VERSION) {
    problems.push(`${where}: css-rules.json の tool_version ${String(rules.tool_version)}`);
  }

  // その状態で成立する宣言（状態擬似クラスがその状態だけ・擬似要素なし・条件なし）が
  // 設定するプロパティは、計算値がその宣言値のどれかと一致するはず。
  // 一致しなければ、規則と計算値が別々に作られている（実物の採取ではありえない組み合わせ）。
  const active = new Set(state === "default" ? [] : [state]);
  const declared = new Map<string, unknown[]>();
  const add = (d: Declaration) =>
    declared.set(d.property, [...(declared.get(d.property) || []), d.value]);
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
        `${where}: ${property} の計算値 ${String(traits.computed[property])} が当たっている宣言（${values.join(", ")}）に無い`,
      );
    }
  }
}

/** 記録した撮影条件のビューポートから clip を計算し直す。計算できなければ null を返す。 */
function planClip(capture: StateCapture, problems: string[]) {
  const viewport = capture.meta.capture_conditions?.viewports?.[0];
  try {
    return viewport ? elementShot.planElementClip(capture.traits.rect, viewport) : null;
  } catch (error) {
    // ビューポートの不備は capture_conditions の検査が別に報告する。ここでは再計算できないことだけ残す。
    problems.push(
      `${capture.where}: element.shot.json の clip を撮影条件から再計算できない（${errorMessage(error)}）`,
    );
    return null;
  }
}

/** element.shot.json の記録の全体を、対になる採取物から組み立て直した期待値と突き合わせる。 */
function compareShotRecord(capture: StateCapture, shot: ShotRecord, problems: string[]) {
  // fixture は最上位フレームの要素だけなので page_rect = traits.rect・frame_depth = 0、clip は
  // 記録した撮影条件のビューポートで element-shot.mjs の planElementClip が決める値。
  // 寸法が同じ別の撮影の記録を差し込んでも、rect / clip の座標で食い違う。
  const { where, traits, png } = capture;
  const expectedClip = planClip(capture, problems);
  if (!png || !expectedClip) return;
  const expected = elementShot.buildShotRecord({
    clip: expectedClip,
    png,
    rect: traits.rect,
    page_rect: traits.rect,
    frame_depth: 0,
    animations: capture.meta.capture_conditions.animations,
  });
  // キーの過不足も比べるので、どちらも文字列のキーで引ける記録として読む。
  const actualFields: Record<string, unknown> = shot;
  const expectedFields: Record<string, unknown> = expected;
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(shot)])].sort();
  const differ = keys.filter((k) => !isDeepStrictEqual(actualFields[k], expectedFields[k]));
  if (differ.length > 0) {
    problems.push(`${where}: element.shot.json が採取物と合わない（${differ.join(", ")}）`);
  }
}

/** element.shot.json が在り、宣言したバージョンで、element.png の実寸と一致することを検査する。 */
function checkShot(capture: StateCapture, problems: string[]) {
  // element.shot.json は element.png と同じ run の記録。宣言した element_shot_version の出力と
  // 名乗る以上、記録が在り、そのバージョンで、PNG の実寸と一致していなければならない。
  const { where, base, png } = capture;
  const shotPath = join(base, "element.shot.json");
  const shot = existsSync(shotPath) ? readJson<ShotRecord>(shotPath) : null;
  if (!shot) {
    problems.push(`${where}: element.shot.json が無い`);
    return;
  }
  if (shot.tool_version !== elementShot.VERSION) {
    problems.push(
      `${where}: element.shot.json の tool_version ${String(shot.tool_version)} ≠ ${elementShot.VERSION}`,
    );
  }
  if (png && (shot.png?.width !== png.width || shot.png?.height !== png.height)) {
    problems.push(`${where}: element.shot.json の png が element.png の実寸と合わない`);
  }
  // 記録の仕様全体を、対になる採取物から組み立て直した期待値と突き合わせる（キーの過不足も含む）。
  compareShotRecord(capture, shot, problems);
}

/** element.png が PNG で、traits.json の rect と同じ寸法であることを検査する。 */
function checkPng({ where, png, traits }: StateCapture, problems: string[]) {
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

/** 比較する全インスタンス × 状態の採取物を検査し、css-rules.json の未解決と読めないシートの件数を返す。 */
function checkBaselines(dir: string, meta: Metadata, problems: string[]) {
  const gaps = { unresolved: 0, inaccessible: 0 };
  for (const inst of meta.instances) {
    for (const state of comparedStates(meta, inst)) {
      const base = join(dir, "baseline", inst.id, state);
      const rules = readJson<CssRules>(join(base, "css-rules.json"));
      gaps.unresolved += rules.unresolved.length;
      gaps.inaccessible += rules.inaccessible.length;
      const capture: StateCapture = {
        where: `${inst.id} / ${state}`,
        base,
        state,
        traits: readJson<Traits>(join(base, "traits.json")),
        rules,
        png: existsSync(join(base, "element.png")) ? pngSize(join(base, "element.png")) : null,
        meta,
      };
      checkDeclarations(capture, problems);
      checkShot(capture, problems);
      checkPng(capture, problems);
    }
  }
  return gaps;
}

// キーの集合はスキーマの原本（assets/metadata-template.json）から取る。検査する項目を手で選ぶと、
// 選び漏れた項目（viewer_environment / masks 等）の欠落・型崩れが合格する。
const sameKeys = (value: unknown, template: object) =>
  typeof value === "object" &&
  value !== null &&
  !isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Object.keys(template).sort());

/** viewer_environment と masks が、テンプレートの許す値で埋まっているか。 */
function viewerFieldsFilled(conditions: CaptureConditions) {
  return (
    typeof conditions.viewer_environment === "string" &&
    /^(一致|未確認|乖離: .+)$/.test(conditions.viewer_environment) &&
    isArray(conditions.masks) &&
    conditions.masks.every((m) => typeof m === "string" && m !== "")
  );
}

/** ビューポートのラベルが 1 件以上あり、空でない文字列で、重複しないか。 */
function labelsFilled(viewportLabels: unknown[]) {
  return (
    viewportLabels.length > 0 &&
    viewportLabels.every((l) => typeof l === "string" && l !== "") &&
    // ラベルは noise_baseline と照合する側のキー。重複すると別寸法の 2 ビューポートを区別できない
    new Set(viewportLabels).size === viewportLabels.length
  );
}

/** ビューポートの寸法が正の有限の数か。 */
const hasPositiveSize = (v: Viewport) =>
  v && Number.isFinite(v.width) && v.width > 0 && Number.isFinite(v.height) && v.height > 0;

/** capture_conditions が採取の条件として埋まっているか。 */
function conditionsFilled(conditions: CaptureConditions, viewportLabels: unknown[]) {
  return (
    sameKeys(conditions, TEMPLATE.capture_conditions) &&
    viewerFieldsFilled(conditions) &&
    isArray(conditions.viewports) &&
    conditions.viewports.every((v) => sameKeys(v, TEMPLATE.capture_conditions.viewports[0])) &&
    typeof conditions.environment === "string" &&
    conditions.environment !== "" &&
    labelsFilled(viewportLabels) &&
    conditions.viewports.every(hasPositiveSize) &&
    conditions.animations === "disabled" &&
    conditions.element_screenshot === true
  );
}

/** 撮影条件を検査し、ビューポートのラベルの一覧を返す。 */
function checkCaptureConditions(conditions: CaptureConditions, problems: string[]) {
  // 撮影条件とノイズ基準値は `build` の照合が同一条件を再現する材料。`capture.complete: true` なのに
  // null のまま（プレースホルダ）だと、比較へ進む前提が欠けたまま完了を名乗る。
  const viewportLabels =
    conditions && isArray(conditions.viewports)
      ? conditions.viewports.map((v) => v && v.label)
      : [];
  if (!conditionsFilled(conditions, viewportLabels)) {
    problems.push("capture_conditions が採取の条件として埋まっていない");
  }
  return viewportLabels;
}

/** ノイズ基準値の 1 行の形が不正か。 */
const malformedNoiseRow = (n: NoiseRow) =>
  !sameKeys(n, TEMPLATE.noise_baseline[0]) ||
  typeof n.instance !== "string" ||
  typeof n.state !== "string" ||
  typeof n.viewport !== "string" ||
  // 画素差分量は 0 以上の数、特性照合の差分は 0 以上の件数（整数）
  !(Number.isFinite(n.pixel) && n.pixel >= 0) ||
  !(Number.isInteger(n.traits) && n.traits >= 0);

/** ノイズ基準値が、比較の母集合 × ビューポートを 1 件ずつ覆っているかを検査する。 */
function checkNoiseBaseline(meta: Metadata, viewportLabels: unknown[], problems: string[]) {
  const expectedNoise = meta.instances
    .flatMap((inst) => comparedStates(meta, inst).map((s) => [inst.id, s]))
    .flatMap(([id, st]) => viewportLabels.map((vp) => `${id}\u001f${st}\u001f${String(vp)}`))
    .sort();
  // 形が不正な行は捨てずに問題にする。除外してから突き合わせると、期待する行が揃っている限り、
  // 不正な余分な行が metadata.json に残ったまま合格する。
  const noiseRows = isArray(meta.noise_baseline) ? meta.noise_baseline : [];
  const malformedNoise = noiseRows.filter(malformedNoiseRow);
  if (malformedNoise.length > 0) {
    problems.push(`noise_baseline に形の不正な行が ${malformedNoise.length} 件ある`);
  }
  const recordedNoise = noiseRows
    .filter((n) => !malformedNoise.includes(n))
    .map((n) => `${String(n.instance)}\u001f${String(n.state)}\u001f${String(n.viewport)}`)
    .sort();
  if (
    JSON.stringify(recordedNoise) !== JSON.stringify(expectedNoise) ||
    expectedNoise.length === 0
  ) {
    problems.push("noise_baseline が比較の母集合 × ビューポートを 1 件ずつ覆っていない");
  }
}

/** axes.json と metadata.json の axes を、axis-diff --baseline で導き直した結果と突き合わせる。 */
function checkAxes(dir: string, meta: Metadata, problems: string[]) {
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
  const { path: _path, ...recordedAxes }: Record<string, unknown> = meta.axes || {};
  if (JSON.stringify(recordedAxes) !== JSON.stringify(expectedAxes)) {
    problems.push("metadata.json の axes の要約が axes.json と一致しない");
  }
}

/**
 * 1 部品分の採取物ディレクトリを検査し、見つかった不整合を返す（空なら整合）。
 * @param {string} dir `.replace/components/<slug>/`
 * @returns {string[]}
 */
export function checkComponent(dir: string): string[] {
  const problems: string[] = [];
  const meta = readJson<Metadata>(join(dir, "metadata.json"));
  checkTools(meta.capture.tools, problems);
  checkPrerequisites(dir, meta, problems);
  const { unresolved, inaccessible } = checkBaselines(dir, meta, problems);
  const viewportLabels = checkCaptureConditions(meta.capture_conditions, problems);
  checkNoiseBaseline(meta, viewportLabels, problems);
  const gaps: NonNullable<Metadata["capture_gaps"]> = meta.capture_gaps || {};
  if (gaps.unresolved_selectors !== unresolved || gaps.inaccessible_sheets !== inaccessible) {
    problems.push("capture_gaps が css-rules.json の件数と一致しない");
  }
  checkAxes(dir, meta, problems);
  return problems;
}

// baseline を持つ部品の採取物を全 fixture から集める（0 件を合格として扱わない）。
export const componentDirs = readdirSync(fixturesRoot)
  .map((name) => join(fixturesRoot, name, ".replace/components"))
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => readdirSync(dir).map((slug) => join(dir, slug)))
  .filter((dir) => existsSync(join(dir, "baseline")));

// 検出されることの確認に使う。最初の fixture を一時ディレクトリにコピーし、JSON を書き換えて不正にする。

export const copyFixture = () => {
  const dir = join(makeTempDir("parity-component-fixture-"), "button");
  cpSync(componentDirs[0], dir, { recursive: true });
  return dir;
};
export const edit = <T>(path: string, mutate: (value: T) => unknown) => {
  const value = readJson<T>(path);
  mutate(value);
  writeFileSync(path, JSON.stringify(value));
};
