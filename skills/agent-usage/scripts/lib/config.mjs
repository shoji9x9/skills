// 設定の読み込み。リポジトリの設定（.agent-usage/config.json）と、人ごとの設定（ユーザーの設定ディレクトリ）を分ける。
// どちらも、知らないキーと型の誤りをエラーにする。綴りを誤ったキーが警告なしにデフォルトとして扱われるのを防ぐ。

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isArray } from "./is-array.mjs";
import { isValidTimeZone, systemTimeZone } from "./time.mjs";

/** 人の ID の形。setup で入力された ID もこの形でなければ受け付けない（記録のパスに使うため）。 */
export const PERSON_ID_RE = /^p-[0-9a-f]{8}$/;

/** 単価の欄。値は USD / 100 万トークン。 */
export const PRICE_FIELDS = /** @type {const} */ ([
  "input",
  "output",
  "cacheRead",
  "cacheWrite5m",
  "cacheWrite1h",
]);

/** @typedef {Partial<Record<(typeof PRICE_FIELDS)[number], number>>} Price */

/**
 * @typedef {object} RepoConfig
 * @property {Record<string, Price>} pricing モデルごとの単価
 * @property {Record<string, number>} reviewPricing レビューツールごとの 1 回あたりの推定額（USD）
 * @property {{ external: boolean }} ci
 * @property {number} activityWindowMinutes 人の活動の前後に「人がいた」とみなす幅（分）
 * @property {Record<string, string>} reviewTools レビューの作者の login → ツール
 * @property {Record<string, { name: string }>} people 人の ID → 表示名
 * @property {Record<string, string>} aliases 人の ID → 同じ人としてまとめる先の ID
 * @property {DefaultDecision | null} defaultDecision 判断の無いブランチの扱い。null なら、コミットの前に止めて確かめる
 */

/** @typedef {"record" | "decline"} DefaultDecision */

/**
 * @typedef {object} UserConfig
 * @property {string} personId
 * @property {string} timeZone
 * @property {"none" | "user"} billing 課金 API の実額を記録するか（user は個人のプランの premium request usage）
 * @property {DefaultDecision} [defaultDecision] 判断の無いブランチの扱い。リポジトリの設定より優先する
 */

/** @returns {RepoConfig} */
export function defaultRepoConfig() {
  return {
    pricing: {},
    reviewPricing: {},
    ci: { external: false },
    activityWindowMinutes: 15,
    reviewTools: {},
    people: {},
    aliases: {},
    defaultDecision: null,
  };
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
export function isRecord(v) {
  return typeof v === "object" && v !== null && !isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isNonNegative(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * @param {unknown} v
 * @param {string} where
 * @returns {DefaultDecision}
 */
function parseDefaultDecision(v, where) {
  if (v !== "record" && v !== "decline") throw new Error(`${where}: record か decline でない`);
  return v;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {readonly string[]} allowed
 * @param {string} where
 */
function rejectUnknownKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new Error(`${where}: 知らないキー ${JSON.stringify(k)}`);
  }
}

/**
 * @param {unknown} v
 * @param {string} where
 * @returns {Record<string, unknown>}
 */
function requireRecord(v, where) {
  if (!isRecord(v)) throw new Error(`${where}: オブジェクトでない`);
  return v;
}

/**
 * @param {unknown} v
 * @param {string} where
 * @returns {Price}
 */
export function parsePrice(v, where) {
  const obj = requireRecord(v, where);
  rejectUnknownKeys(obj, PRICE_FIELDS, where);
  /** @type {Price} */
  const price = {};
  for (const f of PRICE_FIELDS) {
    if (!(f in obj)) continue;
    const n = obj[f];
    if (!isNonNegative(n)) throw new Error(`${where}.${f}: 0 以上の数でない`);
    price[f] = n;
  }
  if (price.input === undefined || price.output === undefined) {
    throw new Error(`${where}: input と output は必須`);
  }
  return price;
}

/**
 * リポジトリの設定を検証して返す。省いたキーはデフォルトにする。
 * @param {unknown} raw
 * @param {string} where
 * @returns {RepoConfig}
 */
export function parseRepoConfig(raw, where = "config.json") {
  const obj = requireRecord(raw, where);
  rejectUnknownKeys(
    obj,
    [
      "$comment",
      "pricing",
      "reviewPricing",
      "ci",
      "activityWindowMinutes",
      "reviewTools",
      "people",
      "aliases",
      "defaultDecision",
    ],
    where,
  );
  const cfg = defaultRepoConfig();
  if (obj.pricing !== undefined) {
    for (const [model, p] of Object.entries(requireRecord(obj.pricing, `${where}.pricing`))) {
      cfg.pricing[model] = parsePrice(p, `${where}.pricing.${model}`);
    }
  }
  if (obj.reviewPricing !== undefined) {
    for (const [tool, n] of Object.entries(
      requireRecord(obj.reviewPricing, `${where}.reviewPricing`),
    )) {
      if (!isNonNegative(n)) throw new Error(`${where}.reviewPricing.${tool}: 0 以上の数でない`);
      cfg.reviewPricing[tool] = n;
    }
  }
  if (obj.ci !== undefined) {
    const ci = requireRecord(obj.ci, `${where}.ci`);
    rejectUnknownKeys(ci, ["external"], `${where}.ci`);
    if (ci.external !== undefined) {
      if (typeof ci.external !== "boolean")
        throw new Error(`${where}.ci.external: true か false でない`);
      cfg.ci.external = ci.external;
    }
  }
  if (obj.activityWindowMinutes !== undefined) {
    const n = obj.activityWindowMinutes;
    if (!isNonNegative(n)) throw new Error(`${where}.activityWindowMinutes: 0 以上の数でない`);
    cfg.activityWindowMinutes = n;
  }
  for (const key of /** @type {const} */ (["reviewTools", "aliases"])) {
    if (obj[key] === undefined) continue;
    for (const [k, v] of Object.entries(requireRecord(obj[key], `${where}.${key}`))) {
      if (typeof v !== "string" || v === "")
        throw new Error(`${where}.${key}.${k}: 空でない文字列でない`);
      cfg[key][k] = v;
    }
  }
  if (obj.people !== undefined) {
    for (const [id, p] of Object.entries(requireRecord(obj.people, `${where}.people`))) {
      const person = requireRecord(p, `${where}.people.${id}`);
      rejectUnknownKeys(person, ["name"], `${where}.people.${id}`);
      if (typeof person.name !== "string" || person.name === "") {
        throw new Error(`${where}.people.${id}.name: 空でない文字列でない`);
      }
      cfg.people[id] = { name: person.name };
    }
  }
  // null は、置いていないのと同じに扱う（値を外すつもりで null を書いた設定で止めない）
  if (obj.defaultDecision !== undefined && obj.defaultDecision !== null) {
    cfg.defaultDecision = parseDefaultDecision(obj.defaultDecision, `${where}.defaultDecision`);
  }
  for (const [from, to] of Object.entries(cfg.aliases)) {
    if (cfg.aliases[to] !== undefined)
      throw new Error(`${where}.aliases: ${from} → ${to} の先がさらに別名になっている`);
  }
  // 別名の先は記録のディレクトリ名（records/<person>/）になるので、人の ID の形だけを受け付ける
  for (const [from, to] of Object.entries(cfg.aliases)) {
    if (!PERSON_ID_RE.test(to))
      throw new Error(`${where}.aliases.${from}: ${to} が p- と 16 進数 8 桁の形でない`);
  }
  return cfg;
}

/**
 * リポジトリの設定を読む。ファイルが無ければデフォルト。
 * @param {string} path
 * @returns {RepoConfig}
 */
export function loadRepoConfig(path) {
  if (!existsSync(path)) return defaultRepoConfig();
  return parseRepoConfig(JSON.parse(readFileSync(path, "utf8")), path);
}

/**
 * 人ごとの設定の置き場所。`AGENT_USAGE_CONFIG_DIR` があればそれを使う（テストと、置き場所を変えたい人のため）。
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function userConfigPath(env = process.env) {
  const base = env.AGENT_USAGE_CONFIG_DIR
    ? env.AGENT_USAGE_CONFIG_DIR
    : join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "agent-usage");
  return join(base, "config.json");
}

/**
 * @param {unknown} raw
 * @param {string} where
 * @returns {UserConfig}
 */
export function parseUserConfig(raw, where) {
  const obj = requireRecord(raw, where);
  rejectUnknownKeys(obj, ["personId", "timeZone", "billing", "defaultDecision"], where);
  if (typeof obj.personId !== "string" || !PERSON_ID_RE.test(obj.personId)) {
    throw new Error(`${where}.personId: p- と 16 進数 8 桁の形でない`);
  }
  const timeZone = obj.timeZone === undefined ? systemTimeZone() : obj.timeZone;
  if (typeof timeZone !== "string" || !isValidTimeZone(timeZone)) {
    throw new Error(`${where}.timeZone: IANA のタイムゾーンの名前でない`);
  }
  const billing = obj.billing === undefined ? "none" : obj.billing;
  if (billing !== "none" && billing !== "user")
    throw new Error(`${where}.billing: none か user でない`);
  /** @type {UserConfig} */
  const config = { personId: obj.personId, timeZone, billing };
  if (obj.defaultDecision !== undefined && obj.defaultDecision !== null) {
    config.defaultDecision = parseDefaultDecision(obj.defaultDecision, `${where}.defaultDecision`);
  }
  return config;
}

/** @returns {string} */
export function newPersonId() {
  return `p-${randomBytes(4).toString("hex")}`;
}

/**
 * 人ごとの設定を読む。ファイルが無ければ null（作らない）。
 * @param {string} path
 * @returns {UserConfig | null}
 */
function readUserConfig(path) {
  if (!existsSync(path)) return null;
  return parseUserConfig(JSON.parse(readFileSync(path, "utf8")), path);
}

/**
 * 人ごとの設定を読む。無ければ null を返し、作らない。
 * @param {NodeJS.ProcessEnv} env
 * @returns {UserConfig | null}
 */
export function loadUserConfig(env = process.env) {
  return readUserConfig(userConfigPath(env));
}

/**
 * 人ごとの設定を読む。無ければ ID を作って保存し、作ったことを返す。
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ config: UserConfig; created: boolean; path: string }}
 */
export function loadOrCreateUserConfig(env = process.env) {
  const path = userConfigPath(env);
  const existing = readUserConfig(path);
  if (existing !== null) return { config: existing, created: false, path };
  const config = {
    personId: newPersonId(),
    timeZone: systemTimeZone(),
    billing: /** @type {const} */ ("none"),
  };
  saveUserConfig(path, config);
  return { config, created: true, path };
}

/**
 * 判断の無いブランチの扱いと、それを決めた設定のパス。人の設定、リポジトリの設定の順に見る。どちらにも無ければ null。
 * 人の設定は読むだけで、無くても作らない（コミットの前の確認から呼ぶため）。
 * @param {string} repoConfigPath
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ decision: DefaultDecision; source: string } | null}
 */
export function defaultDecisionOf(repoConfigPath, env = process.env) {
  const userPath = userConfigPath(env);
  const user = readUserConfig(userPath);
  if (user !== null && user.defaultDecision !== undefined)
    return { decision: user.defaultDecision, source: userPath };
  const repo = loadRepoConfig(repoConfigPath);
  return repo.defaultDecision === null
    ? null
    : { decision: repo.defaultDecision, source: repoConfigPath };
}

/**
 * @param {string} path
 * @param {UserConfig} config
 */
export function saveUserConfig(path, config) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
