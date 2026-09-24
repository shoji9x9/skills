// 共通部品の改修が、どの機能のどの撮影組（ページ × 状態 × ビューポート）に効くかを導く検査（正本）。Issue #454。
//
// 何のためか: 共通部品を 1 行直すと、証跡がリポジトリ全体のコミット SHA に結びついているため
// **その部品を使うかどうかに関わらず全ページの証跡が古くなり**、撮り直しとトリアージを全ページで回すことになる。
// 改修を「部品 × インスタンス × 状態 × プロパティ」で宣言した変更宣言（parity-component の
// assets/component-change-template.json が形式の正本）と、既にある記録（部品の metadata.json の instances、
// 各機能の metadata.json の capture_conditions.pages / capture_scope）から、**撮り直すべき組だけ**と
// **影響しない機能とその理由**を導く。
//
// parity-suite に置く理由: 証跡の鮮度検査（artifact-health-check / component-comparison-check）が
// 同じスキル内からこのモジュールを import して、機能ごとの影響を再計算するため。
//
// 判定は fail-closed。**「判定できない」を「影響なし」に倒さない**——capture_scope が無い機能、
// 部品 metadata で引けないインスタンス id は判定不能として返す。ページの path の照合は完全一致で、
// 前後の空白・末尾スラッシュも正規化しない（正規化の規則を足すと、どちらの側が正しいかをここで決めることになる）。
// 部品 metadata の instances[].page と機能の capture_conditions.pages[].path は同じ語彙（target の baseURL からの
// 相対パス）で書く契約で、ここで書き方を橋渡ししない——片側で吸収すると、吸収しきれない書き方（baseURL の
// パス接頭辞等）が「どれとも一致しない＝影響なし」に化ける。スキーム付きの絶対 URL は入力の誤り（exit 2）にする。
// どの機能のページとも一致しない影響インスタンスは unmatched_instances と findings に載せ、
// 実行全体を判定不能（exit 1）にする——未着手の機能のページと書き方の食い違いを、ここでは区別できないため。各機能の verdict はそのまま
// （別のページのインスタンスが一致しないことで、その機能自身の判定は変えない）。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON だけで、ブラウザは駆動しない。
// TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 全機能を判定できた、1 ＝ 判定不能が 1 件以上（どの機能のページとも一致しない影響インスタンスを含む）、2 ＝ 使い方の誤り・入力が読めない・変更宣言の型崩れ。

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** 出力の `tool`。 */
export const TOOL = "component-impact";

/**
 * 変更宣言の `kind` の語彙。`align-to-current` は現行に合わせ直す修正、`new-appearance` は利用側の要求で足す新しい見た目。
 * 正本は parity-component の references/amend.md。
 */
export const KINDS = ["align-to-current", "new-appearance"];

/** 組 id の区切り（capture_scope / noise_baseline と同じ `<page>|<state>|<viewport>`）。 */
export const PAIR_SEPARATOR = "|";

/**
 * 空でない文字列か。
 * @param {unknown} value
 * @returns {value is string}
 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * 雛形のプレースホルダ（`<...>`）のまま残った文字列か。
 *
 * **プレースホルダを値として受けない**——usages に `<...>` が残ると、どのページの path とも一致せず
 * 「その部品を使うページが無い」と同じ見え方になって影響なしに倒れる。
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlaceholder(value) {
  return typeof value === "string" && /^\s*<[\s\S]*>\s*$/.test(value);
}

/**
 * 変更宣言の型を検証する。問題が無ければ空配列。
 *
 * 型崩れ・キーの欠落は「影響なし」に倒さず使い方の誤り（exit 2）にする——読み違えた宣言から導いた
 * 「影響なし」は、その後の撮り直しを黙って省かせる。
 * @param {unknown} change
 * @returns {string[]}
 */
export function validateChange(change) {
  /** @type {string[]} */
  const errors = [];
  if (!change || typeof change !== "object" || Array.isArray(change)) {
    return ["変更宣言が JSON オブジェクトでない"];
  }
  const c = /** @type {Record<string, unknown>} */ (change);
  /**
   * @param {string} key
   * @param {unknown} value
   */
  const text = (key, value) => {
    if (!nonEmptyString(value)) {
      errors.push(`${key} が空でない文字列でない`);
    } else if (isPlaceholder(value)) {
      errors.push(`${key} が雛形のプレースホルダのまま: ${value}`);
    }
  };
  /**
   * @param {string} key
   * @param {unknown} value
   * @param {{ nonEmpty?: boolean }} [options]
   * @returns {string[]}
   */
  const textList = (key, value, options = {}) => {
    if (!Array.isArray(value)) {
      errors.push(`${key} が配列でない`);
      return [];
    }
    if (options.nonEmpty && value.length === 0) {
      errors.push(`${key} が空（影響する範囲を宣言できない）`);
    }
    value.forEach((element, index) => text(`${key}[${index}]`, element));
    return value.filter((element) => nonEmptyString(element));
  };

  text("id", c.id);
  text("slug", c.slug);
  if (typeof c.kind !== "string" || !KINDS.includes(c.kind)) {
    errors.push(`kind が ${KINDS.join(" / ")} のどれでもない: ${JSON.stringify(c.kind)}`);
  }
  text("reason", c.reason);
  textList("instances", c.instances);
  textList("variants", c.variants);
  textList("states", c.states, { nonEmpty: true });
  textList("properties", c.properties, { nonEmpty: true });
  textList("usages", c.usages);
  if (Array.isArray(c.usages)) {
    const absolute = c.usages.filter((u) => typeof u === "string" && isAbsoluteUrl(u));
    if (absolute.length > 0) {
      errors.push(
        `usages は target の baseURL からの相対パスで書く（capture_conditions.pages[].path と同じ語彙）。絶対 URL: ${absolute.join(", ")}`,
      );
    }
  }
  text("usages_source", c.usages_source);
  textList("files", c.files, { nonEmpty: true });
  if (Array.isArray(c.instances) && Array.isArray(c.usages)) {
    if (c.instances.length === 0 && c.usages.length === 0) {
      errors.push(
        "instances も usages も空（どのページにも効かない改修は宣言できない。影響先を数え損ねた宣言と区別できない）",
      );
    }
  }
  if (!c.commits || typeof c.commits !== "object" || Array.isArray(c.commits)) {
    errors.push("commits がオブジェクトでない");
  } else {
    const commits = /** @type {Record<string, unknown>} */ (c.commits);
    for (const side of ["before", "after"]) {
      const sha = commits[side];
      if (typeof sha !== "string" || !/^[0-9a-f]{7,64}$/.test(sha)) {
        errors.push(
          `commits.${side} がコミット SHA（16 進 7〜64 桁）でない: ${JSON.stringify(sha)}`,
        );
      }
    }
  }
  if (typeof c.margin_px !== "number" || !Number.isFinite(c.margin_px) || c.margin_px < 0) {
    errors.push(`margin_px が 0 以上の数でない: ${JSON.stringify(c.margin_px)}`);
  }
  if (
    !c.cross_measurement ||
    typeof c.cross_measurement !== "object" ||
    Array.isArray(c.cross_measurement)
  ) {
    errors.push("cross_measurement がオブジェクトでない");
  } else {
    const m = /** @type {Record<string, unknown>} */ (c.cross_measurement);
    text("cross_measurement.record", m.record);
    if (typeof m.instances !== "number" || !Number.isInteger(m.instances) || m.instances < 0) {
      errors.push(
        `cross_measurement.instances が 0 以上の整数でない: ${JSON.stringify(m.instances)}`,
      );
    }
    textList("cross_measurement.states", m.states, { nonEmpty: true });
  }
  if (
    !c.catalog_verification ||
    typeof c.catalog_verification !== "object" ||
    Array.isArray(c.catalog_verification)
  ) {
    errors.push("catalog_verification がオブジェクトでない");
  } else {
    const v = /** @type {Record<string, unknown>} */ (c.catalog_verification);
    text("catalog_verification.record", v.record);
    for (const key of ["outside_scope_identical", "inside_matches_current"]) {
      if (typeof v[key] !== "boolean") {
        errors.push(`catalog_verification.${key} が真偽値でない: ${JSON.stringify(v[key])}`);
      }
    }
  }
  return errors;
}

/**
 * 部品 metadata の型を検証する（CLI の入力検査。computeImpact 自身は型崩れを判定不能として扱う）。
 * @param {unknown} metadata
 * @returns {string[]}
 */
export function validateComponentMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return ["部品 metadata が JSON オブジェクトでない"];
  }
  const m = /** @type {Record<string, unknown>} */ (metadata);
  if (!Array.isArray(m.instances)) {
    return ["部品 metadata の instances が配列でない"];
  }
  const absolute = m.instances.filter(
    (i) => i && typeof i === "object" && typeof i.page === "string" && isAbsoluteUrl(i.page),
  );
  if (absolute.length > 0) {
    return [
      `部品 metadata の instances[].page は target の baseURL からの相対パスで書く（capture_conditions.pages[].path と同じ語彙）。絶対 URL: ${absolute
        .map((i) => `${i.id}（${i.page}）`)
        .join(", ")}`,
    ];
  }
  return [];
}

/**
 * スキーム付き（`http:` 等）かプロトコル相対（`//host`）の絶対 URL か。
 * @param {string} page
 * @returns {boolean}
 */
function isAbsoluteUrl(page) {
  return /^[a-z][a-z0-9+.-]*:/i.test(page) || page.startsWith("//");
}

/**
 * 組 id。
 * @param {string} page
 * @param {string} state
 * @param {string} viewport
 * @returns {string}
 */
function pairId(page, state, viewport) {
  return [page, state, viewport].join(PAIR_SEPARATOR);
}

/**
 * 変更宣言のインスタンス id を部品 metadata で引く。
 * @param {Record<string, unknown>} change
 * @param {unknown} componentMetadata
 * @returns {{ resolved: {id:string, page:string, locator:unknown}[], problems: string[] }}
 */
function resolveInstances(change, componentMetadata) {
  /** @type {string[]} */
  const problems = [];
  /** @type {{id:string, page:string, locator:unknown}[]} */
  const resolved = [];
  const metadataErrors = validateComponentMetadata(componentMetadata);
  if (metadataErrors.length > 0) {
    return { resolved, problems: metadataErrors };
  }
  const m = /** @type {Record<string, unknown>} */ (componentMetadata);
  if (m.slug !== undefined && m.slug !== change.slug) {
    problems.push(
      `部品 metadata の slug（${JSON.stringify(m.slug)}）が変更宣言の slug（${JSON.stringify(change.slug)}）と違う`,
    );
    return { resolved, problems };
  }
  // 宣言した状態は部品が採った状態（capture.states）の語彙で書く。綴り違いの状態はどの撮影組にも当たらず、
  // 「その状態を撮っていない＝影響なし」に化けるので、語彙に無い状態は判定不能にする
  const captureStates = /** @type {any} */ (m.capture)?.states;
  if (!Array.isArray(captureStates) || !captureStates.every((st) => nonEmptyString(st))) {
    problems.push(
      "部品 metadata の capture.states が状態名の配列でない（宣言した状態を部品の語彙と突き合わせられない）",
    );
    return { resolved, problems };
  }
  const unknownStates = /** @type {string[]} */ (change.states).filter(
    (st) => !captureStates.includes(st),
  );
  if (unknownStates.length > 0) {
    problems.push(
      `変更宣言の states に部品 metadata の capture.states（${captureStates.join(", ")}）に無い状態がある: ${unknownStates.join(", ")}`,
    );
    return { resolved, problems };
  }
  /** @type {Map<string, Record<string, unknown>[]>} */
  const byId = new Map();
  for (const instance of /** @type {unknown[]} */ (m.instances)) {
    if (!instance || typeof instance !== "object") continue;
    const record = /** @type {Record<string, unknown>} */ (instance);
    if (typeof record.id !== "string") continue;
    byId.set(record.id, [...(byId.get(record.id) ?? []), record]);
  }
  for (const id of new Set(/** @type {string[]} */ (change.instances))) {
    const found = byId.get(id) ?? [];
    if (found.length === 0) {
      problems.push(
        `インスタンス ${id} が部品 metadata の instances に無い（どのページのものか分からない）`,
      );
      continue;
    }
    if (found.length > 1) {
      problems.push(
        `インスタンス ${id} が部品 metadata の instances に 2 つ以上ある（どのページのものか決まらない）`,
      );
      continue;
    }
    const page = found[0].page;
    if (!nonEmptyString(page) || isPlaceholder(page)) {
      problems.push(`インスタンス ${id} の page が読めない: ${JSON.stringify(page)}`);
      continue;
    }
    resolved.push({ id, page, locator: found[0].locator ?? null });
  }
  return { resolved, problems };
}

/**
 * 1 機能の影響を導く。
 * @param {string} slug
 * @param {unknown} metadata
 * @param {Record<string, unknown>} change
 * @param {{id:string, page:string, locator:unknown}[]} instances
 * @returns {{ feature: string, verdict: "affected"|"unaffected"|"undeterminable", pairs: object[], reasons: string[] }}
 */
function judgeFeature(slug, metadata, change, instances) {
  /**
   * @param {string[]} reasons
   */
  const undeterminable = (reasons) => ({
    feature: slug,
    verdict: /** @type {const} */ ("undeterminable"),
    pairs: [],
    reasons,
  });
  if (metadata === null || metadata === undefined) {
    return undeterminable([
      "metadata.json が無い（どの組を撮ったか分からない。「影響なし」に倒さない）",
    ]);
  }
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return undeterminable(["metadata.json が JSON オブジェクトでない"]);
  }
  const m = /** @type {Record<string, unknown>} */ (metadata);
  if (m.mode === "api-resource" || m.mode === "batch") {
    return {
      feature: slug,
      verdict: "unaffected",
      pairs: [],
      reasons: [
        `mode が ${m.mode}（視覚採取物を持たないので部品の見た目の改修は比較結果に効かない）`,
      ],
    };
  }
  if (m.mode !== "feature") {
    return undeterminable([`mode が読めない: ${JSON.stringify(m.mode)}`]);
  }
  const conditions = m.capture_conditions;
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) {
    return undeterminable(["capture_conditions が無い（どのページ × 状態を撮ったか分からない）"]);
  }
  const cc = /** @type {Record<string, unknown>} */ (conditions);
  if (!Array.isArray(cc.capture_scope)) {
    return undeterminable([
      "capture_conditions.capture_scope が無い・配列でない（どの組を撮ったか分からない。「影響なし」に倒さない）",
    ]);
  }
  if (!Array.isArray(cc.pages)) {
    return undeterminable([
      "capture_conditions.pages が無い・配列でない（ページの path が分からない）",
    ]);
  }
  /** @type {Map<string, string>} */
  const pathByName = new Map();
  for (const page of cc.pages) {
    const p = page && typeof page === "object" ? /** @type {Record<string, unknown>} */ (page) : {};
    if (
      !nonEmptyString(p.name) ||
      typeof p.path !== "string" ||
      isPlaceholder(p.path) ||
      isPlaceholder(p.name)
    ) {
      return undeterminable([
        `capture_conditions.pages に読めない要素がある: ${JSON.stringify(page)}`,
      ]);
    }
    if (pathByName.has(p.name)) {
      return undeterminable([
        `capture_conditions.pages に ${p.name} が 2 つ以上ある（path が決まらない）`,
      ]);
    }
    pathByName.set(p.name, p.path);
  }
  /** @type {Map<string, {page:string, state:string, viewport:string}[]>} */
  const scopeByPage = new Map();
  for (const entry of cc.capture_scope) {
    const e =
      entry && typeof entry === "object" ? /** @type {Record<string, unknown>} */ (entry) : {};
    if (!nonEmptyString(e.page) || !nonEmptyString(e.state) || !nonEmptyString(e.viewport)) {
      return undeterminable([
        `capture_scope に page / state / viewport の読めない要素がある: ${JSON.stringify({ page: e.page, state: e.state, viewport: e.viewport })}`,
      ]);
    }
    // 組 id は page|state|viewport を区切り文字でつなぐので、値に区切り文字を含むと別の組が同じ id になり、
    // 重複除去で片方が黙って落ちる（影響する組が 1 つ減る）
    const withSeparator = [e.page, e.state, e.viewport].filter((v) => v.includes(PAIR_SEPARATOR));
    if (withSeparator.length > 0) {
      return undeterminable([
        `capture_scope の page / state / viewport に組 id の区切り文字「${PAIR_SEPARATOR}」を含む値がある: ${withSeparator.join(", ")}（別の組と同じ id になり取りこぼす）`,
      ]);
    }
    if (!pathByName.has(e.page)) {
      return undeterminable([
        `capture_scope のページ ${e.page} が capture_conditions.pages に無い（path が分からない）`,
      ]);
    }
    const list = scopeByPage.get(e.page) ?? [];
    list.push({ page: e.page, state: e.state, viewport: e.viewport });
    scopeByPage.set(e.page, list);
  }
  const states = new Set(/** @type {string[]} */ (change.states));
  const usages = new Set(/** @type {string[]} */ (change.usages));
  /** @type {object[]} */
  const pairs = [];
  /** @type {string[]} */
  const reasons = [];
  for (const [name, path] of pathByName) {
    const onPage = instances.filter((instance) => instance.page === path);
    const byUsage = onPage.length === 0 && usages.has(path);
    if (onPage.length === 0 && !byUsage) {
      reasons.push(
        `ページ ${name}（${path}）は影響インスタンスのページでも usages でもない（path は完全一致で照合）`,
      );
      continue;
    }
    const seen = new Set();
    const hit = (scopeByPage.get(name) ?? []).filter((entry) => {
      if (!states.has(entry.state)) return false;
      const id = pairId(entry.page, entry.state, entry.viewport);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (hit.length === 0) {
      reasons.push(
        `ページ ${name}（${path}）は部品を使うが、宣言した状態（${[...states].join(", ")}）を撮っていない`,
      );
      continue;
    }
    for (const entry of hit) {
      pairs.push({
        pair: pairId(entry.page, entry.state, entry.viewport),
        page: entry.page,
        state: entry.state,
        viewport: entry.viewport,
        instances: onPage.map((instance) => ({ id: instance.id, locator: instance.locator })),
        region_known: !byUsage,
      });
    }
    if (byUsage) {
      reasons.push(
        `ページ ${name}（${path}）は usages にあるが影響インスタンスが無い（領域が分からないので従来のトリアージへ回す）`,
      );
    }
  }
  if (pathByName.size === 0) {
    reasons.push("capture_conditions.pages が空（撮ったページが無い）");
  }
  return {
    feature: slug,
    verdict: pairs.length > 0 ? "affected" : "unaffected",
    pairs,
    reasons,
  };
}

/**
 * 変更宣言から機能ごとの影響を導く（純関数）。
 *
 * 変更宣言は validateChange を通ったものを渡す。通らない宣言を渡すと例外を投げる
 * （`error.code === "invalid-change"`、`error.errors` に理由）——型崩れを判定不能や影響なしに混ぜない。
 *
 * `pageUniverse`（任意）は unmatched_instances の判定にだけ使う機能 metadata の一覧。`--feature` で 1 機能に
 * 絞った実行でも、他の機能のページにあるインスタンスを「一致しない」に数えないために渡す。省略時は features。
 * @param {{ change: unknown, componentMetadata: unknown, features: {slug: string, metadata: unknown}[], pageUniverse?: unknown[] }} input
 * @returns {{ tool: string, version: string, change_id: string, slug: string, features: {feature:string, verdict:string, pairs:object[], reasons:string[]}[], findings: string[], unmatched_instances: {id:string, page:string}[], unmatched_usages: string[] }}
 */
export function computeImpact({ change, componentMetadata, features, pageUniverse }) {
  const errors = validateChange(change);
  if (errors.length > 0) {
    const error = new Error(`変更宣言が不正: ${errors.join(" / ")}`);
    Object.assign(error, { code: "invalid-change", errors });
    throw error;
  }
  const c = /** @type {Record<string, unknown>} */ (change);
  const { resolved, problems } = resolveInstances(c, componentMetadata);
  const sorted = [...features].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const results = sorted.map(({ slug, metadata }) =>
    problems.length > 0
      ? {
          feature: slug,
          verdict: /** @type {const} */ ("undeterminable"),
          pairs: [],
          reasons: problems.map((problem) => `影響インスタンスを引けない: ${problem}`),
        }
      : judgeFeature(slug, metadata, c, resolved),
  );
  // どの機能のページの path とも一致しなかった影響インスタンス。未着手の機能のページなら正当だが、
  // 部品 metadata の page と capture_conditions.pages[].path の書き方が違う（baseURL のパス接頭辞等）と
  // 全機能が黙って影響なしになる。区別できないので findings に載せて実行全体を判定不能にする
  // （各機能の verdict は変えない）。
  const capturedPaths = new Set();
  const universe = Array.isArray(pageUniverse) ? pageUniverse : sorted.map((f) => f.metadata);
  for (const metadata of universe) {
    const pages = /** @type {any} */ (metadata)?.capture_conditions?.pages;
    if (!Array.isArray(pages)) continue;
    for (const page of pages) {
      if (page && typeof page.path === "string") capturedPaths.add(page.path);
    }
  }
  const unmatched = resolved
    .filter((instance) => !capturedPaths.has(instance.page))
    .map((instance) => ({ id: instance.id, page: instance.page }));
  // usages も同じ扱い。綴り違いの usages はどの機能とも一致せず、usages だけに頼る宣言では全機能が黙って影響なしになる
  const unmatchedUsages = /** @type {string[]} */ (c.usages).filter(
    (usage) => !capturedPaths.has(usage),
  );
  return {
    tool: TOOL,
    version: VERSION,
    change_id: /** @type {string} */ (c.id),
    slug: /** @type {string} */ (c.slug),
    features: results,
    findings: [
      ...problems,
      ...unmatched.map(
        (instance) =>
          `影響インスタンス ${instance.id} のページ ${instance.page} がどの機能の capture_conditions.pages[].path とも一致しない（未着手の機能のページか、書き方の食い違いかを区別できないので判定不能にする）`,
      ),
      ...unmatchedUsages.map(
        (usage) =>
          `usages のページ ${usage} がどの機能の capture_conditions.pages[].path とも一致しない（未着手の機能のページか、書き方の食い違いかを区別できないので判定不能にする）`,
      ),
    ],
    unmatched_instances: unmatched,
    unmatched_usages: unmatchedUsages,
  };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ readFile?: (path: string) => string, readdir?: (path: string) => string[], isDirectory?: (path: string) => boolean, exists?: (path: string) => boolean, writeFile?: (path: string, s: string) => void, cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const readdir = deps.readdir ?? ((p) => readdirSync(p));
  const isDirectory =
    deps.isDirectory ??
    ((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  const exists = deps.exists ?? ((p) => existsSync(p));
  const writeFile = deps.writeFile ?? ((p, s) => writeFileSync(p, s));
  const cwd = deps.cwd ?? process.cwd();
  const write = deps.write ?? ((s) => process.stdout.write(s));
  const writeErr = deps.writeErr ?? ((s) => process.stderr.write(s));
  const usage =
    "usage: component-impact.mjs --change <change.json> --component-metadata <.replace/components/<slug>/metadata.json> --parity-root <.replace/parity> [--feature <slug>] [--out <path>]";
  /**
   * 引数・入力の誤りを stderr へ知らせる（判定結果ではないので出力の JSON には混ぜない）。
   * @param {string} message
   * @returns {number}
   */
  const fail = (message) => {
    writeErr(`error: ${message}\n${usage}\n`);
    return 2;
  };
  const known = ["--change", "--component-metadata", "--parity-root", "--feature", "--out"];
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--") || !known.includes(key)) {
      return fail(`不明な引数: ${key}`);
    }
    const value = argv[i + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      return fail(`${key} に値がない`);
    }
    if (args[key] !== undefined) {
      return fail(`${key} が複数ある`);
    }
    args[key] = value;
    i += 1;
  }
  for (const key of ["--change", "--component-metadata", "--parity-root"]) {
    if (!args[key]) return fail(`${key} は必須`);
  }
  /**
   * @param {string} path
   * @returns {{ ok: true, value: unknown } | { ok: false, message: string }}
   */
  const readJson = (path) => {
    try {
      return { ok: true, value: JSON.parse(readFile(resolve(cwd, path))) };
    } catch (error) {
      return { ok: false, message: `${path} を読めない: ${error && error.message}` };
    }
  };
  const change = readJson(args["--change"]);
  if (!change.ok) return fail(change.message);
  const changeErrors = validateChange(change.value);
  if (changeErrors.length > 0) {
    return fail(`変更宣言 ${args["--change"]} が不正:\n  - ${changeErrors.join("\n  - ")}`);
  }
  const component = readJson(args["--component-metadata"]);
  if (!component.ok) return fail(component.message);
  const componentErrors = validateComponentMetadata(component.value);
  if (componentErrors.length > 0) {
    return fail(`${args["--component-metadata"]}: ${componentErrors.join(" / ")}`);
  }
  const componentSlug = /** @type {Record<string, unknown>} */ (component.value).slug;
  const changeSlug = /** @type {Record<string, unknown>} */ (change.value).slug;
  if (componentSlug !== undefined && componentSlug !== changeSlug) {
    return fail(
      `${args["--component-metadata"]} の slug（${JSON.stringify(componentSlug)}）が変更宣言の slug（${JSON.stringify(changeSlug)}）と違う（別の部品の metadata を渡している）`,
    );
  }
  const root = resolve(cwd, args["--parity-root"]);
  if (!isDirectory(root)) {
    return fail(`--parity-root ${args["--parity-root"]} がディレクトリでない`);
  }
  /** @type {string[]} */
  let slugs;
  if (args["--feature"] !== undefined) {
    if (!isDirectory(join(root, args["--feature"]))) {
      return fail(
        `--feature ${args["--feature"]} のディレクトリが ${args["--parity-root"]} に無い`,
      );
    }
    slugs = [args["--feature"]];
  } else {
    slugs = readdir(root)
      .filter((name) => isDirectory(join(root, name)))
      .sort();
  }
  if (slugs.length === 0) {
    // 機能 0 件を「全部影響なし」に倒さない。
    return fail(`${args["--parity-root"]} に機能のディレクトリが 1 つも無い`);
  }
  /** @type {{slug:string, metadata:unknown}[]} */
  const features = [];
  // unmatched_instances の判定には、--feature で絞っても全機能のページを使う
  // （他の機能のページのインスタンスを「どこにも一致しない」に数えない）。読めない metadata は
  // ページを足さないだけ（一致しないインスタンスが残れば判定不能に倒れる）。
  /** @type {unknown[]} */
  const pageUniverse = [];
  if (args["--feature"] !== undefined) {
    for (const name of readdir(root)
      .filter((n) => isDirectory(join(root, n)))
      .sort()) {
      const path = join(root, name, "metadata.json");
      if (!exists(path)) continue;
      const metadata = readJson(path);
      if (metadata.ok) pageUniverse.push(metadata.value);
    }
  }
  for (const slug of slugs) {
    const path = join(root, slug, "metadata.json");
    if (!exists(path)) {
      // 採取前の機能かもしれないが、撮った組が分からないので影響なしとは言えない。
      features.push({ slug, metadata: null });
      continue;
    }
    const metadata = readJson(path);
    if (!metadata.ok) return fail(metadata.message);
    features.push({ slug, metadata: metadata.value });
  }
  const result = computeImpact({
    change: change.value,
    componentMetadata: component.value,
    features,
    ...(args["--feature"] !== undefined ? { pageUniverse } : {}),
  });
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (args["--out"] !== undefined) {
    try {
      writeFile(resolve(cwd, args["--out"]), text);
    } catch (error) {
      return fail(`${args["--out"]} へ書けない: ${error && error.message}`);
    }
  } else {
    write(text);
  }
  return result.features.some((feature) => feature.verdict === "undeterminable") ||
    result.unmatched_instances.length > 0 ||
    result.unmatched_usages.length > 0
    ? 1
    : 0;
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動でサイレント no-op にしない）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
