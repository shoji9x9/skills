// 設定の読み込み。設定は shoji9x9/skills の共通の置き場所（references/config-files.md）の agent-usage.jsonc に置き、
// 同梱の skill-config.mjs で読み書きする。知らないキー・型の誤り・置けない層は、skill-config.mjs がスキーマ
// （config-schemas/agent-usage.schema.json）でエラーにする。ここでは、スキーマで表せない検証だけを行う。

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isArray } from "./is-array.mjs";
import { isValidTimeZone, systemTimeZone } from "./time.mjs";
import {
  ConfigError,
  FILE_LAYERS,
  checkLegacy,
  configPaths,
  ignoresUserLayer,
  loadConfig,
  readLayer,
  loadSchema,
  validateValue,
  writeConfig,
} from "../skill-config/skill-config.mjs";

/** 設定の名前（`.config/skills/shoji9x9/<名前>.jsonc`）。 */
export const CONFIG_NAME = "agent-usage";

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
 * @returns {v is number & { readonly __isNonNegative: true }}
 */
function isNonNegative(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * 単価を検証する。同梱の単価（assets/pricing.json）を読むのに使う。設定ファイルの単価はスキーマが検証する。
 * @param {unknown} v
 * @param {string} where
 * @returns {Price}
 */
export function parsePrice(v, where) {
  if (!isRecord(v)) throw new Error(`${where}: オブジェクトでない`);
  for (const k of Object.keys(v)) {
    if (!PRICE_FIELDS.some((f) => f === k))
      throw new Error(`${where}: 知らないキー ${JSON.stringify(k)}`);
  }
  /** @type {Price} */
  const price = {};
  for (const f of PRICE_FIELDS) {
    if (!(f in v)) continue;
    const n = v[f];
    if (!isNonNegative(n)) throw new Error(`${where}.${f}: 0 以上の数でない`);
    price[f] = n;
  }
  if (price.input === undefined || price.output === undefined) {
    throw new Error(`${where}: input と output は必須`);
  }
  return price;
}

const SCHEMA_DIR = fileURLToPath(new URL("../../config-schemas", import.meta.url));

/** リポジトリの設定（記録と集計の方針）のキー。defaultDecision はどの層にも置ける。 */
const REPO_KEYS = /** @type {const} */ ([
  "pricing",
  "reviewPricing",
  "ci",
  "activityWindowMinutes",
  "reviewTools",
  "people",
  "aliases",
  "defaultDecision",
]);

/** 人ごとの設定のキー。 */
const USER_KEYS = /** @type {const} */ (["personId", "timeZone", "billing"]);

/**
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 */
function resolved(root, env) {
  return loadConfig({ name: CONFIG_NAME, root, env, schemaDir: SCHEMA_DIR });
}

/**
 * 解決した値のうち、keys のものだけをオブジェクトにする。値を取ったファイルの 1 つ（keys の後ろのキーのもの）も返す。
 * @param {ReturnType<typeof resolved>} r
 * @param {readonly string[]} keys
 * @returns {{ raw: Record<string, unknown>; where: string }}
 */
function pick(r, keys) {
  /** @type {Record<string, unknown>} */
  const raw = {};
  let where = CONFIG_NAME;
  for (const k of keys) {
    const v = r[k];
    if (v === undefined || v.source === "default") continue;
    raw[k] = v.value;
    if (v.path !== null) where = v.path;
  }
  return { raw, where };
}

/**
 * 値をスキーマで検証する（知らないキーと型の誤り）。
 * @param {Record<string, unknown>} obj
 * @param {readonly string[]} allowed
 * @param {string} where
 */
function validateKeys(obj, allowed, where) {
  const schema = loadSchema(SCHEMA_DIR, CONFIG_NAME);
  /** @type {string[]} */
  const errors = [];
  for (const [k, v] of Object.entries(obj)) {
    const prop = allowed.includes(k) ? schema.properties[k] : undefined;
    if (prop === undefined) errors.push(`${where}: 知らないキー ${JSON.stringify(k)}`);
    else errors.push(...validateValue(v, prop.schema, `${where}: ${k}`));
  }
  if (errors.length > 0) throw new ConfigError(errors.join("\n"));
}

/**
 * リポジトリの設定の値を検証して返す。省いたキーはデフォルトにする。
 * 知らないキーと型の誤りはスキーマで、スキーマで表せない誤り（別名の先がさらに別名）はここで検出する。
 * @param {unknown} raw
 * @param {string} [where]
 * @returns {RepoConfig}
 */
export function parseRepoConfig(raw, where = CONFIG_NAME) {
  if (!isRecord(raw)) throw new ConfigError(`${where}: オブジェクトでない`);
  validateKeys(raw, REPO_KEYS, where);
  const cfg = defaultRepoConfig();
  if (isRecord(raw.pricing)) {
    for (const [model, p] of Object.entries(raw.pricing))
      cfg.pricing[model] = parsePrice(p, `${where}: pricing.${model}`);
  }
  if (isRecord(raw.reviewPricing)) {
    for (const [k, n] of Object.entries(raw.reviewPricing))
      if (isNonNegative(n)) cfg.reviewPricing[k] = n;
  }
  if (isRecord(raw.ci) && typeof raw.ci.external === "boolean") cfg.ci.external = raw.ci.external;
  if (isNonNegative(raw.activityWindowMinutes))
    cfg.activityWindowMinutes = raw.activityWindowMinutes;
  for (const key of /** @type {const} */ (["reviewTools", "aliases"])) {
    const v = raw[key];
    if (isRecord(v))
      for (const [k, s] of Object.entries(v)) if (typeof s === "string") cfg[key][k] = s;
  }
  if (isRecord(raw.people)) {
    for (const [id, p] of Object.entries(raw.people))
      if (isRecord(p) && typeof p.name === "string") cfg.people[id] = { name: p.name };
  }
  // null は、置いていないのと同じに扱う（値を外すつもりで null を書いた設定で止めない）
  if (raw.defaultDecision === "record" || raw.defaultDecision === "decline")
    cfg.defaultDecision = raw.defaultDecision;
  for (const [from, to] of Object.entries(cfg.aliases)) {
    if (cfg.aliases[to] !== undefined)
      throw new ConfigError(`${where}: aliases: ${from} → ${to} の先がさらに別名になっている`);
  }
  return cfg;
}

/**
 * リポジトリの設定を読む。設定ファイルがどの層にも無ければデフォルト。
 * @param {string} root リポジトリのルート
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {RepoConfig}
 */
export function loadRepoConfig(root, env = process.env) {
  const { raw, where } = pick(resolved(root, env), REPO_KEYS);
  return parseRepoConfig(raw, where);
}

/**
 * 人ごとの設定の値を検証して返す。人の ID は必須で、タイムゾーンは省くとマシンのタイムゾーンにする。
 * @param {unknown} raw
 * @param {string} [where]
 * @returns {UserConfig}
 */
export function parseUserConfig(raw, where = CONFIG_NAME) {
  if (!isRecord(raw)) throw new ConfigError(`${where}: オブジェクトでない`);
  validateKeys(raw, USER_KEYS, where);
  if (typeof raw.personId !== "string") throw new ConfigError(`${where}: personId が無い`);
  const timeZone = raw.timeZone === undefined ? systemTimeZone() : raw.timeZone;
  if (typeof timeZone !== "string" || !isValidTimeZone(timeZone))
    throw new ConfigError(`${where}: timeZone が IANA のタイムゾーンの名前でない`);
  return { personId: raw.personId, timeZone, billing: raw.billing === "user" ? "user" : "none" };
}

/**
 * 人ごとの設定のファイル（`${XDG_CONFIG_HOME:-~/.config}/skills/shoji9x9/agent-usage.jsonc`）。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function userConfigPath(env = process.env) {
  // 人ごとの層の場所はリポジトリに依らないので、ルートには何を渡してもよい
  return configPaths("/", CONFIG_NAME, env).user;
}

/**
 * 人の設定（人の ID）があるか。人の ID は人ごとの層にだけ置けるので、そのファイルだけを読む。
 * 人ごとの層を読まない（SHOJI9X9_SKILLS_IGNORE_USER_CONFIG=1）なら、loadUserConfig と同じく無いものとして扱う。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function hasPerson(env = process.env) {
  if (ignoresUserLayer(env)) return false;
  const path = userConfigPath(env);
  if (!existsSync(path)) return false;
  const v = readLayer(loadSchema(SCHEMA_DIR, CONFIG_NAME), "user", path);
  return v !== null && typeof v.personId === "string";
}

/**
 * 人ごとの設定を読む。人の ID が無ければ null（作らない）。
 * タイムゾーンは、このリポジトリだけの値（.local.jsonc）、人ごとの値、マシンのタイムゾーンの順に決める。
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {UserConfig | null}
 */
export function loadUserConfig(root, env = process.env) {
  const r = resolved(root, env);
  if (typeof r.personId?.value !== "string") return null;
  const { raw, where } = pick(r, USER_KEYS);
  return parseUserConfig(raw, where);
}

/**
 * 人ごとの層に書いたタイムゾーン。無いか、人ごとの層を読まないなら undefined。
 * setup はこの値を引き継ぐ。.local.jsonc の値（このリポジトリだけの値）を人ごとの層へ書き写さないため、解決した値は使わない。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | undefined}
 */
export function userLayerTimeZone(env = process.env) {
  if (ignoresUserLayer(env)) return undefined;
  const v = readLayer(loadSchema(SCHEMA_DIR, CONFIG_NAME), "user", userConfigPath(env));
  return typeof v?.timeZone === "string" ? v.timeZone : undefined;
}

/** @returns {string} */
export function newPersonId() {
  return `p-${randomBytes(4).toString("hex")}`;
}

/**
 * 人ごとの層に値を書く。setup が利用者の指定した値で書くので、既にある値も置き換える。
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @param {Partial<UserConfig>} values
 * @returns {string} 書いたファイル
 */
export function saveUserConfig(root, env, values) {
  let path = userConfigPath(env);
  // キーごとに書くので、後のキーの誤りで止まると、前のキーだけを書いた設定が残る。
  // 書く前に、すべてのキーが人ごとの層に置けることと、値がスキーマに合うことを確かめる
  const schema = loadSchema(SCHEMA_DIR, CONFIG_NAME);
  const userKeys = Object.keys(schema.properties).filter((k) =>
    schema.properties[k].layers.includes("user"),
  );
  validateKeys(
    Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)),
    userKeys,
    path,
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    path = writeConfig({
      name: CONFIG_NAME,
      root,
      env,
      schemaDir: SCHEMA_DIR,
      layer: "user",
      keyPath: [key],
      value,
      mode: "set",
      replace: true,
    }).path;
  }
  return path;
}

/**
 * 人ごとの設定を読む。人の ID が無ければ作って人ごとの層に保存し、作ったことを返す。
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ config: UserConfig; created: boolean; path: string }}
 */
export function loadOrCreateUserConfig(root, env = process.env) {
  const path = userConfigPath(env);
  const existing = loadUserConfig(root, env);
  if (existing !== null) return { config: existing, created: false, path };
  // タイムゾーンも書いておく（後でマシンのタイムゾーンが変わっても、記録の日付の区切りを変えない）
  saveUserConfig(root, env, { personId: newPersonId(), timeZone: systemTimeZone() });
  const config = loadUserConfig(root, env);
  if (config === null) throw new ConfigError(`${path}: 人の ID を書いたのに読めない`);
  return { config, created: true, path };
}

/**
 * 判断の無いブランチの扱いと、それを決めた設定のファイル。どの層にも無ければ null。
 * 層の順は共通の解決の順序（.local.jsonc → 人ごと → リポジトリ）に従う。
 * ただし null は置いていないのと同じに扱い、下の層を見る（値を外すつもりで null を書いた層で、下の層の値を隠さない）。
 * 人の設定は読むだけで作らない。
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ decision: DefaultDecision; source: string } | null}
 */
export function defaultDecisionOf(root, env = process.env) {
  // コミットのたびに Hook から呼ばれるので、各層のファイルは 1 回だけ読む。
  // loadConfig と同じく、旧い置き場所を確かめ、値を取らない層も含めてすべての層を検証する（agent-usage には環境変数の層が無い）
  const schema = loadSchema(SCHEMA_DIR, CONFIG_NAME);
  checkLegacy(schema, root, env);
  const paths = configPaths(root, CONFIG_NAME, env);
  const ignoreUser = ignoresUserLayer(env);
  // 人ごとの層を読まないなら、loadConfig と同じく人ごとの値も当てない
  const layers = FILE_LAYERS.filter((layer) => !(layer === "user" && ignoreUser)).map((layer) => ({
    layer,
    value: readLayer(schema, layer, paths[layer]),
  }));
  for (const { layer, value } of layers) {
    const d = value?.defaultDecision;
    if (d === "record" || d === "decline") return { decision: d, source: paths[layer] };
  }
  return null;
}
