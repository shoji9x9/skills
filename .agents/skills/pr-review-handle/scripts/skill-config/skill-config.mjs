#!/usr/bin/env node
// shoji9x9/skills の配布スキルの設定を読み書きする。
// 置き場所・層・解決の順序・書き込みの決まりの説明は、同じスキルの references/config-files.md にある。
//
// このファイルは、設定を読む配布スキルがすべて同じ内容で持つ（identical-copies の組で確かめる）。
// 配布スキルは利用者のプロジェクトに依存を install できないので、JSONC のパーサ（jsonc-parser）を
// vendor/ に同梱し、このファイルもスキルの中で完結させる。
//
// 使い方は usage を参照。終了コード: 0=成功 / 1=設定の誤り（知らないキー・型の誤り・置けない層・旧い場所） /
// 2=引数の誤り / 3=値が無い（get で、どの層にも無く、デフォルトも無い）。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as jsonc from "./vendor/jsonc-parser.mjs";

/** 配布元の名前空間。他の配布元のスキルと置き場所が重ならないようにする。 */
export const NAMESPACE = "shoji9x9";

/** ファイルの層。前にあるものほど優先する。 */
export const FILE_LAYERS = /** @type {const} */ (["local", "user", "repo"]);

/** @typedef {(typeof FILE_LAYERS)[number]} FileLayer */
/** @typedef {FileLayer | "cli" | "env" | "default"} Source */

/** 設定ファイルの誤り。CLI は exit 1 にする。 */
export class ConfigError extends Error {}

/** 引数の誤り。CLI は exit 2 にする。 */
class UsageError extends Error {}

const DEFAULT_SCHEMA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "config-schemas",
);

// is-array-js:begin
/**
 * `T` のうち配列の部分。`unknown` と `any` は `unknown[]`、配列を含みうる型は `unknown[]` との交差にする。
 * @template T
 * @typedef {0 extends 1 & T ? unknown[] : unknown extends T ? unknown[] : T extends readonly unknown[] ? T : never[] extends T ? T & unknown[] : never} ArrayPart
 */

/**
 * 型ガードの述語に使う形。述語の型は引数の型に代入できる必要があるので、代入できる場合だけ `ArrayPart<T>` にする。
 * @template T
 * @typedef {ArrayPart<T> extends T ? ArrayPart<T> : never} ArrayNarrowed
 */

/**
 * 配列か。配列なら、入力の型の配列の部分に絞る。
 * @template T
 * @param {T} value
 * @returns {value is ArrayNarrowed<T>}
 */
function isArray(value) {
  return Array.isArray(value);
}
// is-array-js:end

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return typeof v === "object" && v !== null && !isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is string[]}
 */
function isStringArray(v) {
  return isArray(v) && v.every((x) => typeof x === "string");
}

// ---------------------------------------------------------------------------
// 置き場所

/**
 * 人ごとの設定のディレクトリ。XDG Base Directory に従い、`XDG_CONFIG_HOME` が空か相対パスなら使わない。
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function userConfigHome(env) {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && isAbsolute(xdg)) return xdg;
  return join(env.HOME || homedir(), ".config");
}

/** 人ごとの層を読まないことを、プログラムが子プロセスに伝える環境変数（eval のランナーの隔離に使う）。 */
export const IGNORE_USER_ENV = "SHOJI9X9_SKILLS_IGNORE_USER_CONFIG";

/**
 * 人ごとの層を読まないか。値は 1 だけを受け付ける。
 * 置き場所を変える変数にすると、人ごとの層の置き場所が 2 つになるので、読まないことだけを表す。
 * 1 以外の値（空・0 など）を、読む・読まないのどちらかとして扱うと、隔離したつもりで隔離されないことがあるので止める。
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function ignoresUserLayer(env) {
  const v = env[IGNORE_USER_ENV];
  if (v === undefined) return false;
  if (v === "1") return true;
  throw new ConfigError(
    `環境変数 ${IGNORE_USER_ENV} は 1 だけを受け付ける（${JSON.stringify(v)}）。人ごとの層を読むなら変数を消す`,
  );
}

/**
 * 3 つの層のファイルのパス。
 * @param {string} root リポジトリのルート
 * @param {string} name 設定の名前（スキル名か common）
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<FileLayer, string>}
 */
export function configPaths(root, name, env) {
  const repoDir = join(root, ".config", "skills", NAMESPACE);
  return {
    local: join(repoDir, `${name}.local.jsonc`),
    user: join(userConfigHome(env), "skills", NAMESPACE, `${name}.jsonc`),
    repo: join(repoDir, `${name}.jsonc`),
  };
}

/**
 * cwd を含むリポジトリのルート。git の外なら cwd。
 * @param {string} cwd
 * @returns {string}
 */
export function findRoot(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
    if (out) return out;
  } catch {
    // git の外か、git が無い。cwd を使う
  }
  return cwd;
}

// ---------------------------------------------------------------------------
// スキーマ

/**
 * @typedef {object} PropertySchema
 * @property {FileLayer[]} layers 置ける層
 * @property {string | undefined} env 値を受け取る環境変数（プログラムが子プロセスに渡す値だけ）
 * @property {Record<string, unknown>} schema JSON Schema の部分集合
 */

/**
 * @typedef {object} LegacyFile
 * @property {string} path `{root}` か `{user_config_home}` で始まるパス
 * @property {string} steps 移行の手順
 */

/**
 * @typedef {object} LegacyEnv
 * @property {string} name 外した環境変数
 * @property {string} steps 移行の手順
 */

/**
 * @typedef {object} ConfigSchema
 * @property {string} name
 * @property {Record<string, PropertySchema>} properties
 * @property {LegacyFile[]} legacyFiles
 * @property {LegacyEnv[]} legacyEnv
 */

/**
 * @param {unknown} v
 * @returns {v is FileLayer}
 */
function isFileLayer(v) {
  return FILE_LAYERS.some((l) => l === v);
}

/**
 * スキーマを読む。スキーマ自身の誤りも ConfigError にする（同梱物の誤りを警告なしに受け入れない）。
 * @param {string} schemaDir
 * @param {string} name
 * @returns {ConfigSchema}
 */
export function loadSchema(schemaDir, name) {
  const path = join(schemaDir, `${name}.schema.json`);
  if (!existsSync(path)) {
    throw new ConfigError(`${path}: 設定 ${JSON.stringify(name)} のスキーマが無い`);
  }
  /** @type {unknown} */
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(raw) || !isRecord(raw.properties)) {
    throw new ConfigError(`${path}: properties を持つオブジェクトでない`);
  }
  /** @type {Record<string, PropertySchema>} */
  const properties = {};
  for (const [key, prop] of Object.entries(raw.properties)) {
    if (!isRecord(prop)) throw new ConfigError(`${path}: properties.${key} がオブジェクトでない`);
    const layers = prop["x-layers"];
    if (!isArray(layers) || layers.length === 0 || !layers.every(isFileLayer)) {
      throw new ConfigError(
        `${path}: properties.${key}["x-layers"] が local・user・repo の空でない配列でない`,
      );
    }
    const env = prop["x-env"];
    if (env !== undefined && typeof env !== "string") {
      throw new ConfigError(`${path}: properties.${key}["x-env"] が文字列でない`);
    }
    properties[key] = { layers, env, schema: prop };
  }
  const legacy = isRecord(raw["x-legacy"]) ? raw["x-legacy"] : {};
  /** @type {LegacyFile[]} */
  const legacyFiles = [];
  for (const f of isArray(legacy.files) ? legacy.files : []) {
    if (!isRecord(f) || typeof f.path !== "string" || typeof f.steps !== "string") {
      throw new ConfigError(`${path}: x-legacy.files の要素が {path, steps} でない`);
    }
    legacyFiles.push({ path: f.path, steps: f.steps });
  }
  /** @type {LegacyEnv[]} */
  const legacyEnv = [];
  for (const e of isArray(legacy.env) ? legacy.env : []) {
    if (!isRecord(e) || typeof e.name !== "string" || typeof e.steps !== "string") {
      throw new ConfigError(`${path}: x-legacy.env の要素が {name, steps} でない`);
    }
    legacyEnv.push({ name: e.name, steps: e.steps });
  }
  return { name, properties, legacyFiles, legacyEnv };
}

/**
 * JSON の値の型の名前（JSON Schema の type の語彙）。
 * @param {unknown} v
 * @returns {string}
 */
function jsonType(v) {
  if (v === null) return "null";
  if (isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

/**
 * @param {unknown} v
 * @param {unknown} t
 * @returns {boolean}
 */
function matchesType(v, t) {
  const actual = jsonType(v);
  const types = isArray(t) ? t : [t];
  return types.some((x) => x === actual || (x === "number" && actual === "integer"));
}

/**
 * JSON Schema の部分集合で検証し、誤りを列挙する。
 * 扱うキーワード: type・enum・const・properties・additionalProperties・required・items・minItems・
 * minimum・maximum・minLength・pattern・anyOf・oneOf。それ以外のキーワード（description・default・x-*）は無視する。
 * @param {unknown} value
 * @param {unknown} schema
 * @param {string} where
 * @returns {string[]}
 */
export function validateValue(value, schema, where) {
  if (!isRecord(schema)) return [];
  /** @type {string[]} */
  const errors = [];
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    return [`${where}: 型が ${JSON.stringify(schema.type)} でない（${jsonType(value)}）`];
  }
  if (
    isArray(schema.enum) &&
    !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))
  ) {
    errors.push(
      `${where}: ${JSON.stringify(value)} は ${schema.enum.map((e) => JSON.stringify(e)).join("・")} のどれでもない`,
    );
  }
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    errors.push(`${where}: ${JSON.stringify(schema.const)} でない`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      errors.push(`${where}: ${schema.minimum} より小さい`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      errors.push(`${where}: ${schema.maximum} より大きい`);
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      errors.push(`${where}: ${schema.minLength} 文字より短い`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${where}: ${JSON.stringify(value)} が /${schema.pattern}/ に合わない`);
    }
  }
  if (isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      errors.push(`${where}: 要素が ${schema.minItems} 個より少ない`);
    if (schema.items !== undefined)
      value.forEach((item, i) =>
        errors.push(...validateValue(item, schema.items, `${where}[${i}]`)),
      );
  }
  if (isRecord(value)) {
    const props = isRecord(schema.properties) ? schema.properties : {};
    if (isStringArray(schema.required)) {
      for (const r of schema.required)
        if (!Object.hasOwn(value, r)) errors.push(`${where}: ${r} が無い`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (Object.hasOwn(props, k)) errors.push(...validateValue(v, props[k], `${where}.${k}`));
      else if (schema.additionalProperties === false)
        errors.push(`${where}: 知らないキー ${JSON.stringify(k)}`);
      else if (isRecord(schema.additionalProperties))
        errors.push(...validateValue(v, schema.additionalProperties, `${where}.${k}`));
    }
  }
  for (const kw of /** @type {const} */ (["anyOf", "oneOf"])) {
    const alts = schema[kw];
    if (!isArray(alts)) continue;
    const results = alts.map((s) => validateValue(value, s, where));
    const ok = results.filter((r) => r.length === 0).length;
    if (kw === "anyOf" ? ok === 0 : ok !== 1) {
      const detail = results
        .map((r, i) => `  候補 ${i + 1}: ${r.join(" / ") || "合う"}`)
        .join("\n");
      errors.push(
        `${where}: ${kw === "anyOf" ? "どの候補にも合わない" : "ちょうど 1 つの候補に合わない"}\n${detail}`,
      );
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 読み取り

/**
 * テキストの位置（0 始まりのオフセット）を「行:列」にする。
 * @param {string} text
 * @param {number} offset
 * @returns {string}
 */
function lineCol(text, offset) {
  const before = text.slice(0, offset).split("\n");
  return `${before.length}:${(before.at(-1) ?? "").length + 1}`;
}

/** @type {jsonc.ParseOptions} */
const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false };

/**
 * JSONC を読む。構文の誤りとキーの重複を ConfigError にする。
 * @param {string} text
 * @param {string} where
 * @returns {unknown}
 */
export function parseJsonc(text, where) {
  if (jsonc.stripComments(text).trim() === "") throw new ConfigError(`${where}: 空のファイル`);
  /** @type {jsonc.ParseError[]} */
  const errors = [];
  const tree = jsonc.parseTree(text, errors, PARSE_OPTIONS);
  if (errors.length > 0) {
    const e = errors[0];
    throw new ConfigError(
      `${where}:${lineCol(text, e.offset)}: JSONC として読めない（${jsonc.printParseErrorCode(e.error)}）`,
    );
  }
  if (tree === undefined) throw new ConfigError(`${where}: 値が無い`);
  /** @param {jsonc.Node} node */
  const walk = (node) => {
    if (node.type === "object") {
      const seen = new Set();
      for (const p of node.children ?? []) {
        const keyNode = p.children?.[0];
        if (keyNode === undefined) continue;
        if (seen.has(keyNode.value)) {
          throw new ConfigError(
            `${where}:${lineCol(text, keyNode.offset)}: キー ${JSON.stringify(keyNode.value)} が重複している`,
          );
        }
        seen.add(keyNode.value);
      }
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(tree);
  return jsonc.getNodeValue(tree);
}

/**
 * 1 つの層のファイルを検証する。ファイルが無ければ null。
 * @param {ConfigSchema} schema
 * @param {FileLayer} layer
 * @param {string} path
 * @returns {Record<string, unknown> | null}
 */
export function readLayer(schema, layer, path) {
  if (!existsSync(path)) return null;
  const value = parseJsonc(readFileSync(path, "utf8"), path);
  if (!isRecord(value)) throw new ConfigError(`${path}: 最上位がオブジェクトでない`);
  /** @type {string[]} */
  const errors = [];
  for (const [key, v] of Object.entries(value)) {
    if (key === "$schema") continue;
    const prop = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    if (prop === undefined) {
      errors.push(
        `${path}: 知らないキー ${JSON.stringify(key)}（${schema.name} に置けるキー: ${Object.keys(schema.properties).join("・")}）`,
      );
      continue;
    }
    if (!prop.layers.includes(layer)) {
      errors.push(
        `${path}: ${key} は ${layerLabel(layer)} の層に置けない（置ける層: ${prop.layers.map(layerLabel).join("・")}）`,
      );
      continue;
    }
    errors.push(...validateValue(v, prop.schema, `${path}: ${key}`));
  }
  if (errors.length > 0) throw new ConfigError(errors.join("\n"));
  return value;
}

/**
 * @param {FileLayer} layer
 * @returns {string}
 */
function layerLabel(layer) {
  return { local: "人ごと・リポジトリ限定（.local.jsonc）", user: "人ごと", repo: "リポジトリ" }[
    layer
  ];
}

/**
 * 旧い置き場所の設定と、外した環境変数が残っていれば、移行の手順を付けて ConfigError にする。
 * 旧い設定を警告なしに無視すると、デフォルトの値で動いてしまうためである。
 * @param {ConfigSchema} schema
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 */
export function checkLegacy(schema, root, env) {
  /** @type {string[]} */
  const found = [];
  // 見るのはこの配布元（NAMESPACE）の skills.yml だけにする。他の配布元の .config/skills/<名前>/ のファイルは、このスキルの旧い設定ではない
  const yml = join(root, ".config", "skills", NAMESPACE, "skills.yml");
  if (existsSync(yml)) {
    found.push(
      `${yml} が残っている。skills.<スキル名> の節を .config/skills/${NAMESPACE}/<スキル名>.jsonc に、skills.common の節を common.jsonc に移し、skills.yml を消す。` +
        "キーの名前と値は変わらない（YAML のアンカーは使えないので、展開して書く）。",
    );
  }
  const ignoreUser = ignoresUserLayer(env);
  for (const f of schema.legacyFiles) {
    // 人ごとの層を読まないなら、人ごとの旧い置き場所も見ない
    if (ignoreUser && f.path.startsWith("{user_config_home}")) continue;
    const path = f.path.replace("{root}", root).replace("{user_config_home}", userConfigHome(env));
    if (existsSync(path)) found.push(`${path} が残っている。${f.steps}`);
  }
  for (const e of schema.legacyEnv) {
    if (env[e.name] !== undefined) found.push(`環境変数 ${e.name} は使わなくなった。${e.steps}`);
  }
  if (found.length > 0) {
    throw new ConfigError(
      `旧い場所の設定が残っているので止める（references/config-files.md「移行」）。\n${found.map((s) => `- ${s}`).join("\n")}`,
    );
  }
}

/**
 * 環境変数の文字列を、キーの型に合わせて値にする。
 * @param {string} raw
 * @param {Record<string, unknown>} schema
 * @returns {unknown}
 */
function coerceEnv(raw, schema) {
  const types = isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("boolean")) {
    if (["true", "on", "1"].includes(raw)) return true;
    if (["false", "off", "0"].includes(raw)) return false;
  }
  if ((types.includes("integer") || types.includes("number")) && /^-?\d+(\.\d+)?$/.test(raw))
    return Number(raw);
  return raw;
}

/**
 * @typedef {object} Resolved
 * @property {unknown} value
 * @property {Source} source
 * @property {string | null} path 値を取った設定ファイル（ファイルの層だけ）
 */

/**
 * @typedef {object} LoadOptions
 * @property {string} name 設定の名前
 * @property {string} [root] リポジトリのルート（省くと cwd から求める）
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [schemaDir]
 * @property {Record<string, unknown>} [cli] CLI のオプションで渡された値（キー → 値）
 * @property {(s: string) => void} [warn] 注意の出力先（デフォルトは stderr）
 */

/**
 * 設定を読み、キーごとに解決した値と出所を返す。値もデフォルトも無いキーは含めない。
 * 解決の順序: CLI → 環境変数 → 人ごと・リポジトリ限定 → 人ごと → リポジトリ → デフォルト。
 * 値を取らなかった層のファイルも、すべて検証する（綴りの誤りをどの層でも見逃さない）。
 * @param {LoadOptions} opts
 * @returns {Record<string, Resolved>}
 */
export function loadConfig(opts) {
  const env = opts.env ?? process.env;
  const root = opts.root ?? findRoot(process.cwd());
  const schema = loadSchema(opts.schemaDir ?? DEFAULT_SCHEMA_DIR, opts.name);
  checkLegacy(schema, root, env);
  const paths = configPaths(root, opts.name, env);
  /** @type {Partial<Record<FileLayer, Record<string, unknown> | null>>} */
  const layers = {};
  const ignoreUser = ignoresUserLayer(env);
  if (ignoreUser) {
    const warn = opts.warn ?? ((s) => process.stderr.write(s));
    warn(`note: 人ごとの層（${paths.user}）を読まない（${IGNORE_USER_ENV}=1）\n`);
  }
  for (const layer of FILE_LAYERS) {
    layers[layer] = layer === "user" && ignoreUser ? null : readLayer(schema, layer, paths[layer]);
  }
  /** @type {Record<string, Resolved>} */
  const out = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const cli = opts.cli?.[key];
    if (cli !== undefined) {
      const errors = validateValue(cli, prop.schema, `CLI の ${key}`);
      if (errors.length > 0) throw new ConfigError(errors.join("\n"));
      out[key] = { value: cli, source: "cli", path: null };
      continue;
    }
    const raw = prop.env === undefined ? undefined : env[prop.env];
    if (raw !== undefined && raw !== "") {
      const value = coerceEnv(raw, prop.schema);
      const errors = validateValue(value, prop.schema, `環境変数 ${prop.env}`);
      if (errors.length > 0) throw new ConfigError(errors.join("\n"));
      out[key] = { value, source: "env", path: null };
      continue;
    }
    const layer = FILE_LAYERS.find((l) => {
      const data = layers[l];
      return data != null && Object.hasOwn(data, key);
    });
    const data = layer === undefined ? undefined : layers[layer];
    if (layer !== undefined && data != null) {
      out[key] = { value: data[key], source: layer, path: paths[layer] };
      continue;
    }
    if ("default" in prop.schema)
      out[key] = { value: prop.schema.default, source: "default", path: null };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 書き込み

/**
 * キーのパスを配列にする。`a.b.0.c` の形か、JSON の配列（`["a", 0]`。キーに `.` を含むとき）を受け付ける。
 * @param {string} spec
 * @returns {(string | number)[]}
 */
export function parseKeyPath(spec) {
  if (spec.startsWith("[")) {
    const bad = new UsageError(`キーのパス ${spec} が、文字列と整数の空でない JSON の配列でない`);
    /** @type {unknown} */
    let arr;
    try {
      arr = JSON.parse(spec);
    } catch {
      throw bad;
    }
    if (!isArray(arr) || arr.length === 0) throw bad;
    /** @type {(string | number)[]} */
    const out = [];
    for (const part of arr) {
      if (typeof part === "string" || (typeof part === "number" && Number.isInteger(part)))
        out.push(part);
      else throw bad;
    }
    return out;
  }
  const parts = spec.split(".");
  if (parts.some((p) => p === ""))
    throw new UsageError(`キーのパス ${JSON.stringify(spec)} に空の部分がある`);
  return parts.map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

/**
 * @typedef {object} WriteOptions
 * @property {string} name
 * @property {FileLayer} layer
 * @property {(string | number)[]} keyPath
 * @property {unknown} value
 * @property {"set" | "append"} mode set はキーを足す。append は配列の末尾に要素を足す
 * @property {boolean} [replace] set で、既にある値を置き換える（指定しなければ、既にある値は変えずに止める）
 * @property {string} [uniqueBy] append で、この欄が同じ要素が既にあれば足さない
 * @property {string} [root]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [schemaDir]
 */

/**
 * 1 つの層のファイルに、コメントと整形を残したまま値を書く。
 * 書いた後のファイル全体をスキーマで検証し、通らなければ書かない。
 * @param {WriteOptions} opts
 * @returns {{ path: string; changed: boolean; reason: string }}
 */
export function writeConfig(opts) {
  const env = opts.env ?? process.env;
  const root = opts.root ?? findRoot(process.cwd());
  const schema = loadSchema(opts.schemaDir ?? DEFAULT_SCHEMA_DIR, opts.name);
  checkLegacy(schema, root, env);
  const top = opts.keyPath[0];
  if (typeof top !== "string")
    throw new ConfigError(`${opts.name}: キーのパスの最初は最上位のキーの名前にする`);
  const prop = Object.hasOwn(schema.properties, top) ? schema.properties[top] : undefined;
  if (prop === undefined)
    throw new ConfigError(`${opts.name} に ${JSON.stringify(top)} というキーは無い`);
  if (!prop.layers.includes(opts.layer)) {
    throw new ConfigError(
      `${top} は ${layerLabel(opts.layer)} の層に置けない（置ける層: ${prop.layers.map(layerLabel).join("・")}）`,
    );
  }
  if (opts.layer === "user" && ignoresUserLayer(env)) {
    throw new ConfigError(`${IGNORE_USER_ENV}=1 のときは、人ごとの層に書かない`);
  }
  const path = configPaths(root, opts.name, env)[opts.layer];
  if (opts.layer === "local") requireIgnored(root, path);
  const text = existsSync(path) ? readFileSync(path, "utf8") : "{}\n";
  const current = parseJsonc(text, path);
  const existing = valueAt(current, opts.keyPath);
  if (opts.mode === "set") {
    if (existing !== undefined && !opts.replace) {
      if (JSON.stringify(existing) === JSON.stringify(opts.value))
        return { path, changed: false, reason: "同じ値が既にある" };
      throw new ConfigError(
        `${path}: ${opts.keyPath.join(".")} は既に ${JSON.stringify(existing)} になっている。既にあるキーは変えない（変えるなら人が確かめてから --replace を付ける）`,
      );
    }
  } else {
    if (existing !== undefined && !isArray(existing))
      throw new ConfigError(`${path}: ${opts.keyPath.join(".")} が配列でない`);
    const list = isArray(existing) ? existing : [];
    if (opts.uniqueBy !== undefined) {
      const key = opts.uniqueBy;
      const want = isRecord(opts.value) ? opts.value[key] : undefined;
      if (want === undefined) throw new UsageError(`--unique-by ${key}: 足す要素に ${key} が無い`);
      // 文字列だけの要素は、key の欄だけを書いた要素の短い書き方として扱う（intentional_diffs の "文言" と {"item": "文言"} など）
      const keyOf = (/** @type {unknown} */ x) => (isRecord(x) ? x[key] : x);
      if (list.some((x) => JSON.stringify(keyOf(x)) === JSON.stringify(want))) {
        return { path, changed: false, reason: `${key} が同じ要素が既にある` };
      }
    }
  }
  const edits = editsFor(text, opts.keyPath, opts.value, opts.mode, existing !== undefined, path);
  const next = jsonc.applyEdits(text, edits);
  const checkPath = `${path}（書き込んだ後）`;
  const parsed = parseJsonc(next, checkPath);
  if (!isRecord(parsed)) throw new ConfigError(`${checkPath}: 最上位がオブジェクトでない`);
  const errors = validateValue(parsed[top], prop.schema, `${checkPath}: ${top}`);
  if (errors.length > 0) throw new ConfigError(errors.join("\n"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next.endsWith("\n") ? next : `${next}\n`);
  return { path, changed: true, reason: opts.mode === "set" ? "書いた" : "足した" };
}

/**
 * 行の先頭の字下げ（offset を含む行）。
 * @param {string} text
 * @param {number} offset
 * @returns {string}
 */
function lineIndent(text, offset) {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start))?.[0] ?? "";
}

/**
 * 値を JSON にする。複数行なら、2 行目以降に indent を付ける。
 * @param {unknown} value
 * @param {string} indent
 * @param {boolean} inline 1 行に書く
 * @returns {string}
 */
function formatValue(value, indent, inline) {
  return inline
    ? JSON.stringify(value)
    : JSON.stringify(value, null, 2).split("\n").join(`\n${indent}`);
}

/**
 * オブジェクトか配列（container）の末尾に、要素（member。字下げの無い 1 行目から始まる文字列を作る関数）を足す編集。
 * 足す位置は、最後の要素の後の「,」と、同じ行のコメントの後ろにする。
 * jsonc-parser の整形付きの追記は、最後の要素の行末のコメントを、足した要素の行へ移す（コメントが付く要素が変わる）ので使わない。
 * 末尾のカンマの有無と字下げは、最後の要素に合わせる。1 行で書いたオブジェクトや配列には、1 行のまま足す。
 * @param {string} text
 * @param {jsonc.Node} container
 * @param {(indent: string, inline: boolean) => string} member
 * @returns {jsonc.Edit[]}
 */
function appendMember(text, container, member) {
  const children = container.children ?? [];
  const close = container.offset + container.length - 1;
  const last = children.at(-1);
  if (last === undefined) {
    const inner = text.slice(container.offset + 1, close);
    const indent = lineIndent(text, container.offset);
    const child = `${indent}  `;
    if (inner.trim() === "") {
      return [
        {
          offset: container.offset + 1,
          length: inner.length,
          content: `\n${child}${member(child, false)}\n${indent}`,
        },
      ];
    }
    // 中身がコメントだけなら、最後のコメントの後ろに足す
    const end = container.offset + 1 + inner.trimEnd().length;
    return [{ offset: end, length: 0, content: `\n${child}${member(child, false)}` }];
  }
  const end = last.offset + last.length;
  const inline = !text.slice(container.offset, last.offset).includes("\n");
  if (inline) return [{ offset: end, length: 0, content: `, ${member("", true)}` }];
  let j = end;
  while (text[j] === " " || text[j] === "\t") j++;
  const hasComma = text[j] === ",";
  if (hasComma) j++;
  while (text[j] === " " || text[j] === "\t") j++;
  // 同じ行で閉じるブロックコメントは読み進める。その後ろの行コメントも、最後の要素に付いたまま残す
  let closedBlock = false;
  while (text.startsWith("/*", j)) {
    const closeComment = text.indexOf("*/", j);
    const nl = text.indexOf("\n", j);
    if (closeComment === -1 || (nl !== -1 && closeComment > nl)) break;
    j = closeComment + 2;
    closedBlock = true;
    while (text[j] === " " || text[j] === "\t") j++;
  }
  if (text.startsWith("//", j)) {
    const nl = text.indexOf("\n", j);
    j = nl === -1 ? text.length : nl;
  } else if (!closedBlock) {
    j = hasComma ? j : end;
  }
  const child = lineIndent(text, last.offset);
  const added = `\n${child}${member(child, false)}${hasComma ? "," : ""}`;
  if (hasComma) return [{ offset: j, length: 0, content: added }];
  return [
    { offset: end, length: 0, content: "," },
    { offset: j, length: 0, content: added },
  ];
}

/**
 * 値を書く編集を作る。
 * - set で値がある（--replace）: 値の範囲を置き換える
 * - set で値が無い: 在る中で最も深いオブジェクトに、残りのパスを入れ子にした値を足す
 * - append: 配列があれば末尾に要素を足し、無ければ要素 1 つの配列を set と同じく足す
 * @param {string} text
 * @param {(string | number)[]} keyPath
 * @param {unknown} value
 * @param {"set" | "append"} mode
 * @param {boolean} exists keyPath に値があるか
 * @param {string} where
 * @returns {jsonc.Edit[]}
 */
function editsFor(text, keyPath, value, mode, exists, where) {
  const tree = jsonc.parseTree(text, [], PARSE_OPTIONS);
  if (tree === undefined) throw new ConfigError(`${where}: 読めない`);
  const node = exists ? jsonc.findNodeAtLocation(tree, keyPath) : undefined;
  if (node !== undefined) {
    if (mode === "append")
      return appendMember(text, node, (indent, inline) => formatValue(value, indent, inline));
    const indent = lineIndent(text, node.offset);
    return [
      { offset: node.offset, length: node.length, content: formatValue(value, indent, false) },
    ];
  }
  let depth = keyPath.length - 1;
  /** @type {jsonc.Node | undefined} */
  let parent;
  for (; depth >= 0; depth--) {
    parent = depth === 0 ? tree : jsonc.findNodeAtLocation(tree, keyPath.slice(0, depth));
    if (parent !== undefined) break;
  }
  const rest = keyPath.slice(depth);
  if (parent === undefined || parent.type !== "object" || rest.some((k) => typeof k === "number")) {
    throw new ConfigError(
      `${where}: ${keyPath.join(".")} に書けない（足す先がオブジェクトでないか、無い配列の要素を指している。配列の要素は append で足す）`,
    );
  }
  /** @type {unknown} */
  let nested = mode === "append" ? [value] : value;
  for (const k of rest.slice(1).reverse()) nested = { [k]: nested };
  const key = rest[0];
  if (typeof key !== "string") throw new ConfigError(`${where}: ${keyPath.join(".")} に書けない`);
  return appendMember(
    text,
    parent,
    (indent, inline) => `${JSON.stringify(key)}: ${formatValue(nested, indent, inline)}`,
  );
}

/**
 * @param {unknown} root
 * @param {(string | number)[]} keyPath
 * @returns {unknown}
 */
function valueAt(root, keyPath) {
  /** @type {unknown} */
  let cur = root;
  for (const k of keyPath) {
    if (typeof k === "number") {
      if (!isArray(cur)) return undefined;
      cur = cur[k];
    } else {
      if (!isRecord(cur)) return undefined;
      cur = cur[k];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

/**
 * `.local.jsonc` が gitignore されていなければ止める（自分だけの値を commit しないため）。
 * @param {string} root
 * @param {string} path
 */
function requireIgnored(root, path) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", relative(root, path)], {
      cwd: root,
      stdio: "ignore",
      timeout: 10_000,
    });
  } catch {
    throw new ConfigError(
      `${path} が gitignore されていない。.gitignore に /.config/skills/${NAMESPACE}/*.local.jsonc を足してから書く（references/config-files.md「人ごと・リポジトリ限定の層」）`,
    );
  }
}

// ---------------------------------------------------------------------------
// CLI

const usage = `usage: skill-config.mjs get <name> <key-path> [--raw] [--cli-value <JSON>]
  skill-config.mjs dump <name>
  skill-config.mjs validate <name>
  skill-config.mjs paths <name>
  skill-config.mjs set <name> <key-path> <JSON> --layer <local|user|repo> [--replace]
  skill-config.mjs append <name> <key-path> <JSON> --layer <local|user|repo> [--unique-by <field>]
common options: --root <dir>（リポジトリのルート）  --schema-dir <dir>`;

/**
 * @param {string} s
 * @param {string} what
 * @returns {unknown}
 */
function parseJsonArg(s, what) {
  try {
    return JSON.parse(s);
  } catch {
    throw new UsageError(`${what} が JSON でない: ${s}（文字列は "..." で囲む）`);
  }
}

/**
 * @typedef {object} Io
 * @property {(s: string) => void} out
 * @property {(s: string) => void} err
 * @property {NodeJS.ProcessEnv} env
 * @property {string} cwd
 */

/**
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number}
 */
export function main(argv, io) {
  try {
    /** @type {string[]} */
    const pos = [];
    /** @type {Record<string, string | true>} */
    const flags = {};
    const valued = new Set(["--root", "--schema-dir", "--layer", "--cli-value", "--unique-by"]);
    const bare = new Set(["--raw", "--replace", "-h", "--help"]);
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (valued.has(a)) {
        const v = argv[i + 1];
        if (v === undefined || v === "") throw new UsageError(`${a} に値が無い`);
        flags[a] = v;
        i++;
      } else if (bare.has(a)) flags[a] = true;
      else if (a.startsWith("-")) throw new UsageError(`知らないオプション ${a}`);
      else pos.push(a);
    }
    if (flags["-h"] || flags["--help"]) {
      io.out(`${usage}\n`);
      return 0;
    }
    const [cmd, name, ...rest] = pos;
    if (cmd === undefined || name === undefined)
      throw new UsageError("サブコマンドと設定の名前が要る");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
      throw new UsageError(`設定の名前 ${JSON.stringify(name)} が小文字の英数字とハイフンでない`);
    const root = typeof flags["--root"] === "string" ? flags["--root"] : findRoot(io.cwd);
    const schemaDir =
      typeof flags["--schema-dir"] === "string" ? flags["--schema-dir"] : DEFAULT_SCHEMA_DIR;
    const base = { name, root, env: io.env, schemaDir, warn: io.err };
    /** @param {number} n */
    const expectArgs = (n) => {
      if (rest.length !== n) throw new UsageError(`${cmd} の引数の数が違う`);
    };
    switch (cmd) {
      case "get": {
        expectArgs(1);
        // 層は最上位のキーごとに選ぶ。入れ子のパスは、選んだ層の値の中をたどる。
        const [key, ...inner] = parseKeyPath(rest[0]);
        if (typeof key !== "string")
          throw new UsageError(`キーのパス ${rest[0]} の最初が、キーの名前でない`);
        /** @type {Record<string, unknown>} */
        const cli = {};
        if (typeof flags["--cli-value"] === "string") {
          if (inner.length > 0) throw new UsageError("--cli-value は最上位のキーにだけ渡せる");
          cli[key] = parseJsonArg(flags["--cli-value"], "--cli-value");
        }
        const schema = loadSchema(schemaDir, name);
        if (!Object.hasOwn(schema.properties, key))
          throw new ConfigError(`${name} に ${JSON.stringify(key)} というキーは無い`);
        const r = loadConfig({ ...base, cli })[key];
        /** @type {unknown} */
        let value = r?.value;
        for (const part of inner) {
          if (typeof part === "number" && isArray(value)) value = value[part];
          else if (typeof part === "string" && isRecord(value) && Object.hasOwn(value, part))
            value = value[part];
          else value = undefined;
        }
        if (flags["--raw"]) {
          if (r === undefined || value === undefined) return 3;
          io.out(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);
          return 0;
        }
        if (r === undefined || value === undefined) {
          io.out(`source=unset\n`);
          return 3;
        }
        io.out(
          `value=${JSON.stringify(value)}\nsource=${r.source}\n${r.path === null ? "" : `path=${r.path}\n`}`,
        );
        return 0;
      }
      case "dump": {
        expectArgs(0);
        io.out(`${JSON.stringify(loadConfig(base), null, 2)}\n`);
        return 0;
      }
      case "validate": {
        expectArgs(0);
        loadConfig(base);
        const present = Object.entries(configPaths(root, name, io.env)).filter(([, p]) =>
          existsSync(p),
        );
        io.out(
          `ok: ${name} の設定はスキーマに合う（${present.length === 0 ? "設定ファイルは無い" : present.map(([l, p]) => `${l}=${p}`).join(" ")}）\n`,
        );
        return 0;
      }
      case "paths": {
        expectArgs(0);
        for (const [l, p] of Object.entries(configPaths(root, name, io.env))) io.out(`${l}=${p}\n`);
        return 0;
      }
      case "set":
      case "append": {
        expectArgs(2);
        const layer = flags["--layer"];
        if (layer !== "local" && layer !== "user" && layer !== "repo")
          throw new UsageError("--layer に local・user・repo のどれかが要る");
        const r = writeConfig({
          ...base,
          layer,
          keyPath: parseKeyPath(rest[0]),
          value: parseJsonArg(rest[1], "値"),
          mode: cmd,
          replace: flags["--replace"] === true,
          uniqueBy: typeof flags["--unique-by"] === "string" ? flags["--unique-by"] : undefined,
        });
        io.out(`${r.changed ? "changed" : "unchanged"}: ${r.path}（${r.reason}）\n`);
        return 0;
      }
      default:
        throw new UsageError(`知らないサブコマンド ${cmd}`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`error: ${e.message}\n${usage}\n`);
      return 2;
    }
    if (e instanceof ConfigError) {
      io.err(`error: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

// cli-entry-js:begin
/**
 * CLI として起動されたか。
 * @param {string} moduleUrl 呼び出し元のモジュールの URL
 * @returns {boolean}
 */
function isCliEntry(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(moduleUrl);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // 実パスへの解決に失敗したら、起動時のパスのまま突き合わせる（何もせずに終わるより、誤って起動する方を選ぶ）。
    return entry === self;
  }
}
// cli-entry-js:end

if (isCliEntry(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    env: process.env,
    cwd: process.cwd(),
  });
}
