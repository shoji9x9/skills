// 共通部品の改修が、どの機能のどの撮影組（ページ × 状態 × ビューポート）に影響するかを導くチェック（原本）。
//
// 何のためか: 共通部品を 1 行直すと、証跡がリポジトリ全体のコミット SHA に結びついているため
// **その部品を使うかどうかに関わらず全ページの証跡が古くなり**、撮り直しとトリアージを全ページで回すことになる。
// 入力は、改修を「部品 × インスタンス × 状態 × プロパティ」で宣言した変更宣言と、既にある記録である。
// 変更宣言の形式の原本は、parity-component の assets/component-change-template.json である。
// 既にある記録は、部品の metadata.json の instances と、各機能の metadata.json の capture_conditions.pages / capture_scope である。
// ここから、**撮り直すべき組だけ**と、**影響しない機能とその理由**を導く。
//
// parity-suite に置く理由: 証跡の鮮度検査（artifact-health-check / component-comparison-check）が
// 同じスキル内からこのモジュールを import して、機能ごとの影響を再計算するため。
//
// **「判定できない」を「影響なし」として扱わない**。capture_scope が無い機能と、
// 部品 metadata に無いインスタンス id は、判定不能として返す。ページの path の照合は完全一致で、
// 前後の空白・末尾スラッシュも正規化しない（正規化の規則を足すと、どちらの側が正しいかをここで決めることになる）。
// 部品 metadata の instances[].page と機能の capture_conditions.pages[].path は、同じ語彙（target の baseURL からの
// 相対パス）で書く取り決めである。ここで書き方の違いを吸収しない。片側で吸収すると、吸収しきれない書き方
// （baseURL のパス接頭辞など）が「どれとも一致しない＝影響なし」と誤って判定される。スキーム付きの絶対 URL は入力の誤り（exit 2）にする。
// どの機能のページとも一致しない影響インスタンスは unmatched_instances と findings に載せ、
// 実行全体を判定不能（exit 1）にする。未着手の機能のページと書き方の食い違いを、ここでは区別できないためである。
// 各機能の verdict は変えない（別のページのインスタンスが一致しないことで、その機能自身の判定は変えない）。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON だけで、ブラウザは駆動しない。
// TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 全機能を判定できた、1 ＝ 判定不能が 1 件以上（どの機能のページとも一致しない影響インスタンスを含む）、2 ＝ 使い方の誤り・入力が読めない・変更宣言の型崩れ。

import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isArray } from "./lib/is-array.mjs";
import { cliIo, parseFlagPairs } from "./lib/check-cli.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { errorMessage } from "./lib/errors.mjs";
import { isPlaceholder, isPlainObject, nonEmptyString } from "./lib/guards.mjs";

/**
 * ツールのバージョン（原本）。判定規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** 出力の `tool`。 */
export const TOOL = "component-impact";

/**
 * 変更宣言の `kind` の語彙。`align-to-current` は現行に合わせ直す修正、`new-appearance` は利用側の要求で足す新しい見た目。
 * 原本は parity-component の references/amend.md。
 */
export const KINDS = /** @type {const} */ (["align-to-current", "new-appearance"]);

/** 変更宣言の `kind`。KINDS から導く（語彙を二重に持たない）。 @typedef {(typeof KINDS)[number]} ChangeKind */

/**
 * 変更宣言の `kind` の語彙に入っているか。
 * @param {unknown} value
 * @returns {value is ChangeKind}
 */
export function isChangeKind(value) {
  return KINDS.some((k) => k === value);
}

/** 組 id の区切り（capture_scope / noise_baseline と同じ `<page>|<state>|<viewport>`）。 */
export const PAIR_SEPARATOR = "|";

/**
 * 文字列の配列を取り出す。validateChange を通った宣言では配列で、要素はすべて文字列なので、元の配列と同じ要素になる。
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
  return isArray(value) ? value.filter((element) => typeof element === "string") : [];
}

/**
 * 変更宣言の文字列の欄を検査し、誤りを errors へ足す関数の組を作る。
 * @param {string[]} errors
 * @returns {{ text: (key: string, value: unknown) => void, textList: (key: string, value: unknown, options?: { nonEmpty?: boolean }) => string[] }}
 */
function textCheckers(errors) {
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
    if (!isArray(value)) {
      errors.push(`${key} が配列でない`);
      return [];
    }
    if (options.nonEmpty && value.length === 0) {
      errors.push(`${key} が空（影響する範囲を宣言できない）`);
    }
    value.forEach((element, index) => text(`${key}[${index}]`, element));
    return value.filter((element) => nonEmptyString(element));
  };
  return { text, textList };
}

/**
 * usages が target の baseURL からの相対パスで書かれていることを検査する。
 * @param {Record<string, unknown>} c
 * @param {string[]} errors
 * @returns {void}
 */
function checkUsages(c, errors) {
  if (isArray(c.usages)) {
    const absolute = c.usages.filter((u) => typeof u === "string" && isAbsoluteUrl(u));
    if (absolute.length > 0) {
      errors.push(
        `usages は target の baseURL からの相対パスで書く（capture_conditions.pages[].path と同じ語彙）。絶対 URL: ${absolute.join(", ")}`,
      );
    }
  }
}

/**
 * instances も usages も空の宣言を誤りにする。
 * @param {Record<string, unknown>} c
 * @param {string[]} errors
 * @returns {void}
 */
function checkAffectedRange(c, errors) {
  if (isArray(c.instances) && isArray(c.usages)) {
    if (c.instances.length === 0 && c.usages.length === 0) {
      errors.push(
        "instances も usages も空（どのページにも影響しない改修は宣言できない。影響先を数え損ねた宣言と区別できない）",
      );
    }
  }
}

/**
 * commits.before / commits.after と margin_px を検査する。
 * @param {Record<string, unknown>} c
 * @param {string[]} errors
 * @returns {void}
 */
function checkCommitsAndMargin(c, errors) {
  if (!isPlainObject(c.commits)) {
    errors.push("commits がオブジェクトでない");
  } else {
    const commits = c.commits;
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
}

/**
 * cross_measurement と catalog_verification の記録を検査する。
 * @param {Record<string, unknown>} c
 * @param {string[]} errors
 * @param {ReturnType<typeof textCheckers>} check
 * @returns {void}
 */
function checkVerificationRecords(c, errors, check) {
  if (!isPlainObject(c.cross_measurement)) {
    errors.push("cross_measurement がオブジェクトでない");
  } else {
    const m = c.cross_measurement;
    check.text("cross_measurement.record", m.record);
    if (typeof m.instances !== "number" || !Number.isInteger(m.instances) || m.instances < 0) {
      errors.push(
        `cross_measurement.instances が 0 以上の整数でない: ${JSON.stringify(m.instances)}`,
      );
    }
    check.textList("cross_measurement.states", m.states, { nonEmpty: true });
  }
  if (!isPlainObject(c.catalog_verification)) {
    errors.push("catalog_verification がオブジェクトでない");
  } else {
    const v = c.catalog_verification;
    check.text("catalog_verification.record", v.record);
    for (const key of ["outside_scope_identical", "inside_matches_current"]) {
      if (typeof v[key] !== "boolean") {
        errors.push(`catalog_verification.${key} が真偽値でない: ${JSON.stringify(v[key])}`);
      }
    }
  }
}

/**
 * 変更宣言の型を検証する。問題が無ければ空配列。
 *
 * 型の誤り・キーの欠落は「影響なし」として扱わず、使い方の誤り（exit 2）にする。読み違えた宣言から導いた
 * 「影響なし」は、その後の撮り直しを警告なしに省かせる。
 * @param {unknown} change
 * @returns {string[]}
 */
export function validateChange(change) {
  /** @type {string[]} */
  const errors = [];
  if (!isPlainObject(change)) {
    return ["変更宣言が JSON オブジェクトでない"];
  }
  const c = change;
  const check = textCheckers(errors);
  const { text, textList } = check;

  text("id", c.id);
  text("slug", c.slug);
  if (typeof c.kind !== "string" || !isChangeKind(c.kind)) {
    errors.push(`kind が ${KINDS.join(" / ")} のどれでもない: ${JSON.stringify(c.kind)}`);
  }
  text("reason", c.reason);
  textList("instances", c.instances);
  textList("variants", c.variants);
  textList("states", c.states, { nonEmpty: true });
  textList("properties", c.properties, { nonEmpty: true });
  textList("usages", c.usages);
  checkUsages(c, errors);
  text("usages_source", c.usages_source);
  textList("files", c.files, { nonEmpty: true });
  checkAffectedRange(c, errors);
  checkCommitsAndMargin(c, errors);
  checkVerificationRecords(c, errors, check);
  return errors;
}

/**
 * 部品 metadata の型を検証する（CLI の入力検査。computeImpact 自身は型崩れを判定不能として扱う）。
 * @param {unknown} metadata
 * @returns {string[]}
 */
export function validateComponentMetadata(metadata) {
  if (!isPlainObject(metadata)) {
    return ["部品 metadata が JSON オブジェクトでない"];
  }
  const m = metadata;
  if (!isArray(m.instances)) {
    return ["部品 metadata の instances が配列でない"];
  }
  const absolute = m.instances
    .filter(isPlainObject)
    .filter((i) => typeof i.page === "string" && isAbsoluteUrl(i.page));
  if (absolute.length > 0) {
    return [
      `部品 metadata の instances[].page は target の baseURL からの相対パスで書く（capture_conditions.pages[].path と同じ語彙）。絶対 URL: ${absolute
        .map((i) => `${String(i.id)}（${String(i.page)}）`)
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
 * 部品 metadata の slug と、宣言した状態が部品の採った状態の語彙にあるかを確かめる。問題が無ければ null。
 * @param {Record<string, unknown>} change
 * @param {Record<string, unknown>} m - 部品 metadata
 * @returns {string | null}
 */
function componentStateProblem(change, m) {
  if (m.slug !== undefined && m.slug !== change.slug) {
    return `部品 metadata の slug（${JSON.stringify(m.slug)}）が変更宣言の slug（${JSON.stringify(change.slug)}）と違う`;
  }
  // 宣言した状態は部品が採った状態（capture.states）の語彙で書く。綴り違いの状態はどの撮影組にも当たらず、
  // 「その状態を撮っていない＝影響なし」と誤って判定される。そのため、語彙に無い状態は判定不能にする
  const captureStates = isPlainObject(m.capture) ? m.capture.states : undefined;
  if (!isArray(captureStates) || !captureStates.every((st) => nonEmptyString(st))) {
    return "部品 metadata の capture.states が状態名の配列でない（宣言した状態を部品の語彙と突き合わせられない）";
  }
  const unknownStates = stringList(change.states).filter(
    (st) => !captureStates.some((c) => c === st),
  );
  if (unknownStates.length > 0) {
    return `変更宣言の states に部品 metadata の capture.states（${captureStates.join(", ")}）に無い状態がある: ${unknownStates.join(", ")}`;
  }
  return null;
}

/**
 * 変更宣言のインスタンス id を部品 metadata の instances で引く。
 * @param {Record<string, unknown>} change
 * @param {Record<string, unknown>} m - 部品 metadata
 * @returns {{ resolved: {id:string, page:string, locator:unknown}[], problems: string[] }}
 */
function lookupInstances(change, m) {
  /** @type {string[]} */
  const problems = [];
  /** @type {{id:string, page:string, locator:unknown}[]} */
  const resolved = [];
  const byId = instancesById(m);
  for (const id of new Set(stringList(change.instances))) {
    const instance = lookupInstance(id, byId.get(id) ?? []);
    if (typeof instance === "string") problems.push(instance);
    else resolved.push(instance);
  }
  return { resolved, problems };
}

/**
 * 部品 metadata の instances を id ごとにまとめる。id が文字列でない要素は飛ばす。
 * @param {Record<string, unknown>} m - 部品 metadata
 * @returns {Map<string, Record<string, unknown>[]>}
 */
function instancesById(m) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const byId = new Map();
  for (const record of isArray(m.instances) ? m.instances : []) {
    // 配列の要素は id を持たないので、下の id の判定で飛ばす場合と同じになる
    if (!isPlainObject(record)) continue;
    if (typeof record.id !== "string") continue;
    byId.set(record.id, [...(byId.get(record.id) ?? []), record]);
  }
  return byId;
}

/**
 * 1 つのインスタンス id を、同じ id を持つ instances の要素から取得する。
 * @param {string} id
 * @param {Record<string, unknown>[]} found - 同じ id を持つ instances の要素
 * @returns {{id:string, page:string, locator:unknown} | string} 取得したインスタンス（取得できなければ理由）
 */
function lookupInstance(id, found) {
  if (found.length === 0) {
    return `インスタンス ${id} が部品 metadata の instances に無い（どのページのものか分からない）`;
  }
  if (found.length > 1) {
    return `インスタンス ${id} が部品 metadata の instances に 2 つ以上ある（どのページのものか決まらない）`;
  }
  const page = found[0].page;
  if (!nonEmptyString(page) || isPlaceholder(page)) {
    return `インスタンス ${id} の page が読めない: ${JSON.stringify(page)}`;
  }
  return { id, page, locator: found[0].locator ?? null };
}

/**
 * 変更宣言のインスタンス id を部品 metadata で引く。
 * @param {Record<string, unknown>} change
 * @param {unknown} componentMetadata
 * @returns {{ resolved: {id:string, page:string, locator:unknown}[], problems: string[] }}
 */
function resolveInstances(change, componentMetadata) {
  const metadataErrors = validateComponentMetadata(componentMetadata);
  // isPlainObject の否定は validateComponentMetadata が誤りを返す場合に含まれる（型の絞り込みのためだけに並べる）
  if (metadataErrors.length > 0 || !isPlainObject(componentMetadata)) {
    return { resolved: [], problems: metadataErrors };
  }
  const problem = componentStateProblem(change, componentMetadata);
  if (problem !== null) return { resolved: [], problems: [problem] };
  return lookupInstances(change, componentMetadata);
}

/**
 * 撮り直す組（ページ × 状態 × ビューポート）。region_known は影響インスタンスで領域が分かるか（usages だけなら false）。
 * @typedef {{ pair: string, page: string, state: string, viewport: string,
 *             instances: { id: string, locator: unknown }[], region_known: boolean }} ImpactPair
 */

/**
 * 1 機能の判定結果。
 * @typedef {{ feature: string, verdict: "affected"|"unaffected"|"undeterminable", pairs: ImpactPair[], reasons: string[] }} FeatureImpact
 */

/**
 * 撮った組（capture_scope の 1 要素）。
 * @typedef {{page:string, state:string, viewport:string}} ScopeEntry
 */

/**
 * 判定不能の結果。
 * @param {string} slug
 * @param {string[]} reasons
 * @returns {FeatureImpact}
 */
function undeterminable(slug, reasons) {
  return { feature: slug, verdict: "undeterminable", pairs: [], reasons };
}

/**
 * 機能 metadata から capture_conditions を取り出す。視覚採取物を持たない mode と、読めない metadata は結果を返す。
 * @param {string} slug
 * @param {unknown} metadata
 * @returns {{ result: FeatureImpact } | { conditions: Record<string, unknown> & { capture_scope: unknown[], pages: unknown[] } }}
 */
function captureConditionsOf(slug, metadata) {
  if (metadata === null || metadata === undefined) {
    return {
      result: undeterminable(slug, [
        "metadata.json が無い（どの組を撮ったか分からない。「影響なし」として扱わない）",
      ]),
    };
  }
  if (!isPlainObject(metadata)) {
    return { result: undeterminable(slug, ["metadata.json が JSON オブジェクトでない"]) };
  }
  const m = metadata;
  if (m.mode === "api-resource" || m.mode === "batch") {
    return {
      result: {
        feature: slug,
        verdict: "unaffected",
        pairs: [],
        reasons: [
          `mode が ${m.mode}（視覚採取物を持たないので部品の見た目の改修は比較結果に影響しない）`,
        ],
      },
    };
  }
  if (m.mode !== "feature") {
    return { result: undeterminable(slug, [`mode が読めない: ${JSON.stringify(m.mode)}`]) };
  }
  return scopedConditionsOf(slug, m.capture_conditions);
}

/**
 * capture_conditions が capture_scope と pages の配列を持つことを確かめる。
 * @param {string} slug
 * @param {unknown} conditions
 * @returns {{ result: FeatureImpact } | { conditions: Record<string, unknown> & { capture_scope: unknown[], pages: unknown[] } }}
 */
function scopedConditionsOf(slug, conditions) {
  if (!isPlainObject(conditions)) {
    return {
      result: undeterminable(slug, [
        "capture_conditions が無い（どのページ × 状態を撮ったか分からない）",
      ]),
    };
  }
  const cc = conditions;
  const scope = cc.capture_scope;
  if (!isArray(scope)) {
    return {
      result: undeterminable(slug, [
        "capture_conditions.capture_scope が無い・配列でない（どの組を撮ったか分からない。「影響なし」として扱わない）",
      ]),
    };
  }
  const pages = cc.pages;
  if (!isArray(pages)) {
    return {
      result: undeterminable(slug, [
        "capture_conditions.pages が無い・配列でない（ページの path が分からない）",
      ]),
    };
  }
  return { conditions: { ...cc, capture_scope: scope, pages } };
}

/**
 * capture_conditions.pages からページ名 → path の対応を作る。読めない要素・重複があれば判定不能の理由を返す。
 * @param {unknown[]} pages
 * @returns {{ pathByName: Map<string, string> } | { problem: string }}
 */
function pathsByPageName(pages) {
  /** @type {Map<string, string>} */
  const pathByName = new Map();
  for (const page of pages) {
    // 配列の要素は name を持たないので、{} と同じく下の判定で判定不能になる
    /** @type {Record<string, unknown>} */
    const p = isPlainObject(page) ? page : {};
    if (
      !nonEmptyString(p.name) ||
      typeof p.path !== "string" ||
      isPlaceholder(p.path) ||
      isPlaceholder(p.name)
    ) {
      return { problem: `capture_conditions.pages に読めない要素がある: ${JSON.stringify(page)}` };
    }
    if (pathByName.has(p.name)) {
      return {
        problem: `capture_conditions.pages に ${p.name} が 2 つ以上ある（path が決まらない）`,
      };
    }
    pathByName.set(p.name, p.path);
  }
  return { pathByName };
}

/**
 * capture_scope をページごとにまとめる。読めない要素・区切り文字を含む値・pages に無いページがあれば判定不能の理由を返す。
 * @param {unknown[]} scope
 * @param {Map<string, string>} pathByName
 * @returns {{ scopeByPage: Map<string, ScopeEntry[]> } | { problem: string }}
 */
function scopeEntriesByPage(scope, pathByName) {
  /** @type {Map<string, ScopeEntry[]>} */
  const scopeByPage = new Map();
  for (const entry of scope) {
    /** @type {Record<string, unknown>} */
    const e = isPlainObject(entry) ? entry : {};
    if (!nonEmptyString(e.page) || !nonEmptyString(e.state) || !nonEmptyString(e.viewport)) {
      return {
        problem: `capture_scope に page / state / viewport の読めない要素がある: ${JSON.stringify({ page: e.page, state: e.state, viewport: e.viewport })}`,
      };
    }
    // 組 id は page|state|viewport を区切り文字でつなぐので、値に区切り文字を含むと別の組が同じ id になり、
    // 重複除去で片方が警告なしに消える（影響する組が 1 つ減る）
    const withSeparator = [e.page, e.state, e.viewport].filter((v) => v.includes(PAIR_SEPARATOR));
    if (withSeparator.length > 0) {
      return {
        problem: `capture_scope の page / state / viewport に組 id の区切り文字「${PAIR_SEPARATOR}」を含む値がある: ${withSeparator.join(", ")}（別の組と同じ id になり取りこぼす）`,
      };
    }
    if (!pathByName.has(e.page)) {
      return {
        problem: `capture_scope のページ ${e.page} が capture_conditions.pages に無い（path が分からない）`,
      };
    }
    const list = scopeByPage.get(e.page) ?? [];
    list.push({ page: e.page, state: e.state, viewport: e.viewport });
    scopeByPage.set(e.page, list);
  }
  return { scopeByPage };
}

/**
 * 1 ページの撮った組のうち、宣言した状態のものを重複なく返す。
 * @param {ScopeEntry[]} entries
 * @param {Set<string>} states
 * @returns {ScopeEntry[]}
 */
function hitEntries(entries, states) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!states.has(entry.state)) return false;
    const id = pairId(entry.page, entry.state, entry.viewport);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * ページごとに撮り直す組と、撮り直さない理由を集める。
 * @param {{ pathByName: Map<string, string>, scopeByPage: Map<string, ScopeEntry[]> }} pages
 * @param {Record<string, unknown>} change
 * @param {{id:string, page:string, locator:unknown}[]} instances
 * @returns {{ pairs: ImpactPair[], reasons: string[] }}
 */
function collectPairs({ pathByName, scopeByPage }, change, instances) {
  const states = new Set(stringList(change.states));
  const usages = new Set(stringList(change.usages));
  /** @type {ImpactPair[]} */
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
    const hit = hitEntries(scopeByPage.get(name) ?? [], states);
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
  return { pairs, reasons };
}

/**
 * 1 機能の影響を導く。
 * @param {{ slug: string, metadata: unknown, change: Record<string, unknown>, instances: {id:string, page:string, locator:unknown}[] }} input
 * @returns {FeatureImpact}
 */
function judgeFeature({ slug, metadata, change, instances }) {
  const read = captureConditionsOf(slug, metadata);
  if ("result" in read) return read.result;
  const cc = read.conditions;
  const paths = pathsByPageName(cc.pages);
  if ("problem" in paths) return undeterminable(slug, [paths.problem]);
  const { pathByName } = paths;
  const scope = scopeEntriesByPage(cc.capture_scope, pathByName);
  if ("problem" in scope) return undeterminable(slug, [scope.problem]);
  const { pairs, reasons } = collectPairs(
    { pathByName, scopeByPage: scope.scopeByPage },
    change,
    instances,
  );
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
 * 機能 metadata の一覧から、capture_conditions.pages[].path をすべて集める。読めない metadata・要素は飛ばす。
 * @param {unknown[]} universe
 * @returns {Set<unknown>}
 */
function capturedPathsOf(universe) {
  const capturedPaths = new Set();
  for (const metadata of universe) {
    const conditions = isPlainObject(metadata) ? metadata.capture_conditions : undefined;
    const pages = isPlainObject(conditions) ? conditions.pages : undefined;
    if (!isArray(pages)) continue;
    for (const page of pages) {
      if (isPlainObject(page) && typeof page.path === "string") capturedPaths.add(page.path);
    }
  }
  return capturedPaths;
}

/**
 * どの機能のページとも一致しない影響インスタンスと usages を、findings の文にする。
 * @param {{id:string, page:string}[]} unmatched
 * @param {string[]} unmatchedUsages
 * @returns {string[]}
 */
function unmatchedFindings(unmatched, unmatchedUsages) {
  return [
    ...unmatched.map(
      (instance) =>
        `影響インスタンス ${instance.id} のページ ${instance.page} がどの機能の capture_conditions.pages[].path とも一致しない（未着手の機能のページか、書き方の食い違いかを区別できないので判定不能にする）`,
    ),
    ...unmatchedUsages.map(
      (usage) =>
        `usages のページ ${usage} がどの機能の capture_conditions.pages[].path とも一致しない（未着手の機能のページか、書き方の食い違いかを区別できないので判定不能にする）`,
    ),
  ];
}

/**
 * 変更宣言から機能ごとの影響を導く（純関数）。
 *
 * 変更宣言は validateChange を通ったものを渡す。通らない宣言を渡すと例外を投げる
 * （`error.code === "invalid-change"`、`error.errors` に理由）。型崩れを、判定不能や影響なしと同じ扱いにしないためである。
 *
 * `pageUniverse`（任意）は unmatched_instances の判定にだけ使う機能 metadata の一覧。`--feature` で 1 機能に
 * 絞った実行でも、他の機能のページにあるインスタンスを「一致しない」に数えないために渡す。省略時は features。
 * @param {{ change: unknown, componentMetadata: unknown, features: {slug: string, metadata: unknown}[], pageUniverse?: unknown[] }} input
 * @returns {{ tool: string, version: string, change_id: string, slug: string, features: FeatureImpact[], findings: string[], unmatched_instances: {id:string, page:string}[], unmatched_usages: string[] }}
 */
export function computeImpact({ change, componentMetadata, features, pageUniverse }) {
  const errors = validateChange(change);
  // isPlainObject の否定は validateChange が誤りを返す場合に含まれる（型の絞り込みのためだけに並べる）
  if (errors.length > 0 || !isPlainObject(change)) {
    const error = new Error(`変更宣言が不正: ${errors.join(" / ")}`);
    Object.assign(error, { code: "invalid-change", errors });
    throw error;
  }
  const c = change;
  const { resolved, problems } = resolveInstances(c, componentMetadata);
  const sorted = [...features].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  /** @type {FeatureImpact[]} */
  const results = sorted.map(({ slug, metadata }) =>
    problems.length > 0
      ? undeterminable(
          slug,
          problems.map((problem) => `影響インスタンスを引けない: ${problem}`),
        )
      : judgeFeature({ slug, metadata, change: c, instances: resolved }),
  );
  // どの機能のページの path とも一致しなかった影響インスタンス。未着手の機能のページなら正当だが、
  // 部品 metadata の page と capture_conditions.pages[].path の書き方が違う（baseURL のパス接頭辞等）と
  // 全機能が警告なしに影響なしになる。区別できないので findings に載せて実行全体を判定不能にする
  // （各機能の verdict は変えない）。
  const universe = isArray(pageUniverse) ? pageUniverse : sorted.map((f) => f.metadata);
  const capturedPaths = capturedPathsOf(universe);
  const unmatched = resolved
    .filter((instance) => !capturedPaths.has(instance.page))
    .map((instance) => ({ id: instance.id, page: instance.page }));
  // usages も同じ扱い。綴り違いの usages はどの機能とも一致せず、usages だけに頼る宣言では全機能が警告なしに影響なしになる
  const unmatchedUsages = stringList(c.usages).filter((usage) => !capturedPaths.has(usage));
  return {
    tool: TOOL,
    version: VERSION,
    change_id: String(c.id),
    slug: String(c.slug),
    features: results,
    findings: [...problems, ...unmatchedFindings(unmatched, unmatchedUsages)],
    unmatched_instances: unmatched,
    unmatched_usages: unmatchedUsages,
  };
}

const USAGE =
  "usage: component-impact.mjs --change <change.json> --component-metadata <.replace/components/<slug>/metadata.json> --parity-root <.replace/parity> [--feature <slug>] [--out <path>]";

/** 引数・入力の誤り。main が stderr へ知らせて exit 2 にする（判定結果ではないので出力の JSON には混ぜない）。 */
class InputError extends Error {}

/**
 * main の入出力。
 * @typedef {{ readFile: (path: string) => string, readdir: (path: string) => string[], isDirectory: (path: string) => boolean, exists: (path: string) => boolean, writeFile: (path: string, s: string) => void, cwd: string, write: (s: string) => void, writeErr: (s: string) => void }} Io
 */

/**
 * 差し替えの無い入出力をデフォルトで埋める。
 * @param {{ readFile?: (path: string) => string, readdir?: (path: string) => string[], isDirectory?: (path: string) => boolean, exists?: (path: string) => boolean, writeFile?: (path: string, s: string) => void, cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} deps
 * @returns {Io}
 */
function resolveIo(deps) {
  return {
    ...cliIo(deps),
    readdir: deps.readdir ?? ((p) => readdirSync(p)),
    isDirectory:
      deps.isDirectory ??
      ((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      }),
    exists: deps.exists ?? ((p) => existsSync(p)),
    writeFile: deps.writeFile ?? ((p, s) => writeFileSync(p, s)),
  };
}

/**
 * 引数を読む。不明な引数・値の無い引数・重複・必須の欠けは InputError を投げる。
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  const parsed = parseFlagPairs(argv, [
    "--change",
    "--component-metadata",
    "--parity-root",
    "--feature",
    "--out",
  ]);
  if (parsed.error !== undefined) throw new InputError(parsed.error);
  const { args } = parsed;
  for (const key of ["--change", "--component-metadata", "--parity-root"]) {
    if (!args[key]) throw new InputError(`${key} は必須`);
  }
  return args;
}

/**
 * JSON を読む。読めなければ理由を返す。
 * @param {Io} io
 * @param {string} path
 * @returns {{ ok: true, value: unknown } | { ok: false, message: string }}
 */
function readJson(io, path) {
  try {
    return { ok: true, value: JSON.parse(io.readFile(resolve(io.cwd, path))) };
  } catch (error) {
    return { ok: false, message: `${path} を読めない: ${errorMessage(error)}` };
  }
}

/**
 * JSON を読み、読めなければ InputError を投げる。
 * @param {Io} io
 * @param {string} path
 * @returns {unknown}
 */
function readJsonOrThrow(io, path) {
  const read = readJson(io, path);
  if (!read.ok) throw new InputError(read.message);
  return read.value;
}

/**
 * 変更宣言と部品 metadata を読み、検証する。
 * @param {Io} io
 * @param {Record<string, string>} args
 * @returns {{ change: unknown, component: unknown }}
 */
function readChangeAndComponent(io, args) {
  const change = readJsonOrThrow(io, args["--change"]);
  const changeErrors = validateChange(change);
  if (changeErrors.length > 0) {
    throw new InputError(
      `変更宣言 ${args["--change"]} が不正:\n  - ${changeErrors.join("\n  - ")}`,
    );
  }
  const component = readJsonOrThrow(io, args["--component-metadata"]);
  const componentErrors = validateComponentMetadata(component);
  if (componentErrors.length > 0) {
    throw new InputError(`${args["--component-metadata"]}: ${componentErrors.join(" / ")}`);
  }
  // どちらも直前の検証で JSON オブジェクトだと確かめてある
  const componentSlug = isPlainObject(component) ? component.slug : undefined;
  const changeSlug = isPlainObject(change) ? change.slug : undefined;
  if (componentSlug !== undefined && componentSlug !== changeSlug) {
    throw new InputError(
      `${args["--component-metadata"]} の slug（${JSON.stringify(componentSlug)}）が変更宣言の slug（${JSON.stringify(changeSlug)}）と違う（別の部品の metadata を渡している）`,
    );
  }
  return { change, component };
}

/**
 * parity-root の下の機能のディレクトリ名を並べる。
 * @param {Io} io
 * @param {string} root
 * @returns {string[]}
 */
function featureDirs(io, root) {
  return io
    .readdir(root)
    .filter((name) => io.isDirectory(join(root, name)))
    .sort();
}

/**
 * 判定する機能の slug を決める。
 * @param {Io} io
 * @param {Record<string, string>} args
 * @param {string} root
 * @returns {string[]}
 */
function targetSlugs(io, args, root) {
  if (!io.isDirectory(root)) {
    throw new InputError(`--parity-root ${args["--parity-root"]} がディレクトリでない`);
  }
  /** @type {string[]} */
  let slugs;
  if (args["--feature"] !== undefined) {
    if (!io.isDirectory(join(root, args["--feature"]))) {
      throw new InputError(
        `--feature ${args["--feature"]} のディレクトリが ${args["--parity-root"]} に無い`,
      );
    }
    slugs = [args["--feature"]];
  } else {
    slugs = featureDirs(io, root);
  }
  if (slugs.length === 0) {
    // 機能 0 件を「全部影響なし」として扱わない。
    throw new InputError(`${args["--parity-root"]} に機能のディレクトリが 1 つも無い`);
  }
  return slugs;
}

/**
 * --feature で絞った実行で unmatched_instances の判定に使う、全機能の metadata を読む。
 * 読めない metadata はページを足さないだけにする（一致しないインスタンスが残れば判定不能になる）。
 * @param {Io} io
 * @param {string} root
 * @returns {unknown[]}
 */
function readPageUniverse(io, root) {
  /** @type {unknown[]} */
  const pageUniverse = [];
  for (const name of featureDirs(io, root)) {
    const path = join(root, name, "metadata.json");
    if (!io.exists(path)) continue;
    const metadata = readJson(io, path);
    if (metadata.ok) pageUniverse.push(metadata.value);
  }
  return pageUniverse;
}

/**
 * 判定する機能の metadata を読む。metadata.json が無い機能は metadata を null にする。
 * @param {Io} io
 * @param {string} root
 * @param {string[]} slugs
 * @returns {{slug:string, metadata:unknown}[]}
 */
function readFeatures(io, root, slugs) {
  /** @type {{slug:string, metadata:unknown}[]} */
  const features = [];
  for (const slug of slugs) {
    const path = join(root, slug, "metadata.json");
    if (!io.exists(path)) {
      // 採取前の機能である可能性もあるが、撮った組が分からないので影響なしとは言えない。
      features.push({ slug, metadata: null });
      continue;
    }
    features.push({ slug, metadata: readJsonOrThrow(io, path) });
  }
  return features;
}

/**
 * 結果を --out か stdout へ書く。
 * @param {Io} io
 * @param {Record<string, string>} args
 * @param {string} text
 * @returns {void}
 */
function writeResult(io, args, text) {
  if (args["--out"] === undefined) {
    io.write(text);
    return;
  }
  try {
    io.writeFile(resolve(io.cwd, args["--out"]), text);
  } catch (error) {
    throw new InputError(`${args["--out"]} へ書けない: ${errorMessage(error)}`);
  }
}

/**
 * 引数を確かめた後の処理。引数・入力の誤りは InputError を投げる。
 * @param {Io} io
 * @param {string[]} argv
 * @returns {number}
 */
function run(io, argv) {
  const args = parseArgs(argv);
  const { change, component } = readChangeAndComponent(io, args);
  const root = resolve(io.cwd, args["--parity-root"]);
  const slugs = targetSlugs(io, args, root);
  // unmatched_instances の判定には、--feature で絞っても全機能のページを使う
  // （他の機能のページのインスタンスを「どこにも一致しない」に数えない）。
  const pageUniverse = args["--feature"] !== undefined ? readPageUniverse(io, root) : [];
  const features = readFeatures(io, root, slugs);
  const result = computeImpact({
    change,
    componentMetadata: component,
    features,
    ...(args["--feature"] !== undefined ? { pageUniverse } : {}),
  });
  writeResult(io, args, `${JSON.stringify(result, null, 2)}\n`);
  return result.features.some((feature) => feature.verdict === "undeterminable") ||
    result.unmatched_instances.length > 0 ||
    result.unmatched_usages.length > 0
    ? 1
    : 0;
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ readFile?: (path: string) => string, readdir?: (path: string) => string[], isDirectory?: (path: string) => boolean, exists?: (path: string) => boolean, writeFile?: (path: string, s: string) => void, cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const io = resolveIo(deps);
  try {
    return run(io, argv);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    io.writeErr(`error: ${error.message}\n${USAGE}\n`);
    return 2;
  }
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
