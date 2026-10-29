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

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
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
  // HOME が無いか空なら、ユーザーのデータベースのホームを使う。os.homedir() は渡した env ではなくプロセスの HOME を読むので使わない。
  // 同梱のシェルも同じ規則で決める（HOME を外したサブシェルで ~ を展開する）。
  // どちらでも絶対パスにならなければ、人ごとの層は読まない（userHomeDecided・ignoresUserLayer）
  return join(env.HOME || databaseHome(), ".config");
}

/**
 * 人ごとの層の置き場所が、絶対パスに決まるか。決まらないと cwd からの相対パスになり、リポジトリの層のファイルと同じパスを指しうる。
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function userHomeDecided(env) {
  return isAbsolute(userConfigHome(env));
}

/**
 * ユーザーのデータベース（passwd）のホーム。エントリが無ければ空文字。
 * @returns {string}
 */
function databaseHome() {
  if (databaseHomeCache === undefined) {
    try {
      databaseHomeCache = userInfo().homedir;
    } catch {
      databaseHomeCache = "";
    }
  }
  return databaseHomeCache;
}

/** databaseHome の結果。プロセスの間は変わらないので、passwd の照会を 1 回にする。 @type {string | undefined} */
let databaseHomeCache;

/** 人ごとの層を読まないことを、プログラムが子プロセスに伝える環境変数（eval のランナーの隔離に使う）。 */
export const IGNORE_USER_ENV = "SHOJI9X9_SKILLS_IGNORE_USER_CONFIG";

/**
 * 人ごとの層を読まないか。環境変数の値は 1 だけを受け付ける。
 * 環境変数が無くても、人ごとの層の置き場所が絶対パスに決まらなければ読まない。
 * 置き場所を変える変数にすると、人ごとの層の置き場所が 2 つになるので、読まないことだけを表す。
 * 1 以外の値（空・0 など）を、読む・読まないのどちらかとして扱うと、隔離したつもりで隔離されないことがあるので止める。
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function ignoresUserLayer(env) {
  const v = env[IGNORE_USER_ENV];
  if (v === undefined) return !userHomeDecided(env);
  if (v === "1") return true;
  throw new ConfigError(
    `環境変数 ${IGNORE_USER_ENV} は 1 だけを受け付ける（${JSON.stringify(v)}）。人ごとの層を読むなら変数を消す`,
  );
}

/**
 * 人ごとの層を読まない理由。
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function ignoreReason(env) {
  return env[IGNORE_USER_ENV] === "1"
    ? `${IGNORE_USER_ENV}=1`
    : "HOME と XDG_CONFIG_HOME から、置き場所を絶対パスに決められない";
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
  const raw = readSchemaFile(path, name);
  /** @type {Record<string, PropertySchema>} */
  const properties = {};
  for (const [key, prop] of Object.entries(raw.properties)) {
    properties[key] = parseProperty(prop, `${path}: properties.${key}`);
  }
  const legacy = isRecord(raw["x-legacy"]) ? raw["x-legacy"] : {};
  return { name, properties, ...parseLegacy(legacy, path) };
}

/**
 * スキーマのファイルを JSON として読み、properties を持つオブジェクトであることを確かめる。
 * @param {string} path
 * @param {string} name
 * @returns {Record<string, unknown> & { properties: Record<string, unknown> }}
 */
function readSchemaFile(path, name) {
  if (!existsSync(path)) {
    throw new ConfigError(`${path}: 設定 ${JSON.stringify(name)} のスキーマが無い`);
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`${path}: JSON として読めない（${String(e)}）`);
  }
  if (!isRecord(raw)) throw new ConfigError(`${path}: properties を持つオブジェクトでない`);
  const properties = raw.properties;
  if (!isRecord(properties)) throw new ConfigError(`${path}: properties を持つオブジェクトでない`);
  return { ...raw, properties };
}

/**
 * スキーマの 1 つのキーの定義を読む。
 * @param {unknown} prop
 * @param {string} where
 * @returns {PropertySchema}
 */
function parseProperty(prop, where) {
  if (!isRecord(prop)) throw new ConfigError(`${where} がオブジェクトでない`);
  const layers = prop["x-layers"];
  if (!isArray(layers) || layers.length === 0 || !layers.every(isFileLayer)) {
    throw new ConfigError(`${where}["x-layers"] が local・user・repo の空でない配列でない`);
  }
  const env = prop["x-env"];
  if (env !== undefined && typeof env !== "string") {
    throw new ConfigError(`${where}["x-env"] が文字列でない`);
  }
  checkPatterns(prop, where);
  return { layers, env, schema: prop };
}

/**
 * スキーマの x-legacy（旧い置き場所と外した環境変数）を読む。
 * @param {Record<string, unknown>} legacy
 * @param {string} path
 * @returns {{ legacyFiles: LegacyFile[]; legacyEnv: LegacyEnv[] }}
 */
function parseLegacy(legacy, path) {
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
  return { legacyFiles, legacyEnv };
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
 * スキーマの中の pattern が、正規表現（u フラグ）として読めるかを確かめる。
 * 読めないまま検証すると、ConfigError でない SyntaxError で止まり、理由を示さずに終わる。
 * @param {unknown} schema
 * @param {string} where
 */
function checkPatterns(schema, where) {
  if (isArray(schema)) {
    schema.forEach((s, i) => checkPatterns(s, `${where}[${i}]`));
    return;
  }
  if (!isRecord(schema)) return;
  for (const [k, v] of Object.entries(schema)) {
    if (k === "pattern" && typeof v === "string") {
      try {
        new RegExp(v, "u");
      } catch (e) {
        throw new ConfigError(`${where}.pattern が正規表現として読めない（${String(e)}）`);
      }
    } else checkPatterns(v, `${where}.${k}`);
  }
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
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    return [`${where}: 型が ${JSON.stringify(schema.type)} でない（${jsonType(value)}）`];
  }
  /** @type {ValueCheck} */
  const check = { value, schema, where };
  return [
    ...literalErrors(check),
    ...numberErrors(check),
    ...stringErrors(check),
    ...arrayErrors(check),
    ...objectErrors(check),
    ...alternativeErrors(check),
  ];
}

/**
 * validateValue のキーワードごとの検証に渡す、検証する値・スキーマ・誤りの位置。
 * @typedef {object} ValueCheck
 * @property {unknown} value
 * @property {Record<string, unknown>} schema
 * @property {string} where
 */

/**
 * enum と const を検証する。
 * @param {ValueCheck} check
 * @returns {string[]}
 */
function literalErrors({ value, schema, where }) {
  /** @type {string[]} */
  const errors = [];
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
  return errors;
}

/**
 * 数の minimum と maximum を検証する。
 * @param {ValueCheck} check
 * @returns {string[]}
 */
function numberErrors({ value, schema, where }) {
  if (typeof value !== "number") return [];
  /** @type {string[]} */
  const errors = [];
  if (typeof schema.minimum === "number" && value < schema.minimum)
    errors.push(`${where}: ${schema.minimum} より小さい`);
  if (typeof schema.maximum === "number" && value > schema.maximum)
    errors.push(`${where}: ${schema.maximum} より大きい`);
  return errors;
}

/**
 * 文字列の minLength と pattern を検証する。
 * @param {ValueCheck} check
 * @returns {string[]}
 */
function stringErrors({ value, schema, where }) {
  if (typeof value !== "string") return [];
  /** @type {string[]} */
  const errors = [];
  if (typeof schema.minLength === "number" && value.length < schema.minLength)
    errors.push(`${where}: ${schema.minLength} 文字より短い`);
  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
    errors.push(`${where}: ${JSON.stringify(value)} が /${schema.pattern}/ に合わない`);
  }
  return errors;
}

/**
 * 配列の minItems と items を検証する。
 * @param {ValueCheck} check
 * @returns {string[]}
 */
function arrayErrors({ value, schema, where }) {
  if (!isArray(value)) return [];
  /** @type {string[]} */
  const errors = [];
  if (typeof schema.minItems === "number" && value.length < schema.minItems)
    errors.push(`${where}: 要素が ${schema.minItems} 個より少ない`);
  if (schema.items !== undefined)
    value.forEach((item, i) => errors.push(...validateValue(item, schema.items, `${where}[${i}]`)));
  return errors;
}

/**
 * オブジェクトの required・properties・additionalProperties を検証する。
 * @param {ValueCheck} check
 * @returns {string[]}
 */
function objectErrors({ value, schema, where }) {
  if (!isRecord(value)) return [];
  /** @type {string[]} */
  const errors = [];
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
  return errors;
}

/**
 * anyOf と oneOf を検証する。
 * @param {ValueCheck} check
 * @returns {string[]}
 */
function alternativeErrors({ value, schema, where }) {
  /** @type {string[]} */
  const errors = [];
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

/** UTF-8 の BOM。Windows のエディタは、保存するファイルの先頭に付けることがある。 */
const BOM = "\uFEFF";

/**
 * 先頭の BOM を外す。JSONC のパーサは BOM を読めない文字として扱う。
 * @param {string} text
 * @returns {string}
 */
function stripBom(text) {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
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
  return validateLayer({ schema, layer, path }, parseJsonc(stripBom(readText(path)), path));
}

/**
 * 設定ファイルを読む。ディレクトリや読めないファイルは、スタックトレースで終わらずに ConfigError にする。
 * @param {string} path
 * @returns {string}
 */
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    throw new ConfigError(`${path}: 読めない（${e instanceof Error ? e.message : String(e)}）`);
  }
}

/**
 * 検証する層のファイル。
 * @typedef {object} LayerFile
 * @property {ConfigSchema} schema
 * @property {FileLayer} layer
 * @property {string} path 失敗のメッセージに使う
 */

/**
 * 1 つの層のファイルの中身を検証する。知らないキー・置けない層のキー・スキーマに合わない値は ConfigError にする。
 * @param {LayerFile} file
 * @param {unknown} value ファイルを読んだ値
 * @returns {Record<string, unknown>}
 */
function validateLayer({ schema, layer, path }, value) {
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
    // 1 回の置換で両方を置き換える。置き換えた文字列（$ を含むパスや、{user_config_home} を含むルート）は、もう一度読まない
    const path = f.path.replace(/\{root\}|\{user_config_home\}/g, (m) =>
      m === "{root}" ? root : userConfigHome(env),
    );
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
 * @property {ConfigSchema} [schema] 読み込んだスキーマ（呼び出し側が先に読んでいれば、読み直さない）
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
  const schema = opts.schema ?? loadSchema(opts.schemaDir ?? DEFAULT_SCHEMA_DIR, opts.name);
  checkLegacy(schema, root, env);
  const paths = configPaths(root, opts.name, env);
  const ignoreUser = ignoresUserLayer(env);
  if (ignoreUser) {
    const warn = opts.warn ?? ((s) => process.stderr.write(s));
    warn(`note: 人ごとの層（${paths.user}）を読まない（${ignoreReason(env)}）\n`);
  }
  /** @type {Partial<Record<FileLayer, Record<string, unknown> | null>>} */
  const layers = {};
  for (const layer of FILE_LAYERS) {
    layers[layer] = layer === "user" && ignoreUser ? null : readLayer(schema, layer, paths[layer]);
  }
  /** @type {Record<string, Resolved>} */
  const out = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const r = resolveKey(key, prop, { cli: opts.cli, env, layers, paths });
    if (r !== undefined) out[key] = r;
  }
  return out;
}

/**
 * resolveKey が値を探す先。
 * @typedef {object} ResolveSources
 * @property {Record<string, unknown> | undefined} cli
 * @property {NodeJS.ProcessEnv} env
 * @property {Partial<Record<FileLayer, Record<string, unknown> | null>>} layers 読んだ層のファイル（無い層は null）
 * @property {Record<FileLayer, string>} paths
 */

/**
 * 1 つのキーの値を、CLI → 環境変数 → ファイルの層 → デフォルトの順に探す。値もデフォルトも無ければ undefined。
 * @param {string} key
 * @param {PropertySchema} prop
 * @param {ResolveSources} sources
 * @returns {Resolved | undefined}
 */
function resolveKey(key, prop, { cli, env, layers, paths }) {
  const fromCli = cli?.[key];
  if (fromCli !== undefined) {
    const errors = validateValue(fromCli, prop.schema, `CLI の ${key}`);
    if (errors.length > 0) throw new ConfigError(errors.join("\n"));
    return { value: fromCli, source: "cli", path: null };
  }
  const raw = prop.env === undefined ? undefined : env[prop.env];
  if (raw !== undefined && raw !== "") {
    const value = coerceEnv(raw, prop.schema);
    const errors = validateValue(value, prop.schema, `環境変数 ${prop.env}`);
    if (errors.length > 0) throw new ConfigError(errors.join("\n"));
    return { value, source: "env", path: null };
  }
  for (const layer of FILE_LAYERS) {
    const data = layers[layer];
    if (data != null && Object.hasOwn(data, key))
      return { value: data[key], source: layer, path: paths[layer] };
  }
  if ("default" in prop.schema)
    return { value: prop.schema.default, source: "default", path: null };
  return undefined;
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
  const top = writableTop(schema, opts);
  const path = writablePath(root, env, opts);
  const raw = existsSync(path) ? readText(path) : "";
  // BOM は外して編集し、書くときに戻す（ファイルの他の部分と同じく、書き込みで変えない）
  const bom = raw.startsWith(BOM) ? BOM : "";
  // 中身の無いファイル（touch で作ったものなど）は、ファイルが無いときと同じく {} から書く。
  // コメントだけのファイルは、コメントを消さないように、読み取りと同じ「空のファイル」で止める
  const text = stripBom(raw).trim() === "" ? "{}\n" : stripBom(raw);
  const current = parseJsonc(text, path);
  const existing = valueAt(current, opts.keyPath);
  const reason =
    opts.mode === "set"
      ? setUnchanged(opts, existing, path)
      : appendUnchanged(opts, existing, path);
  if (reason !== undefined) {
    // 書かずに返すとき（同じ値が既にある・--unique-by の要素が既にある）も、書こうとしたキーの外の誤りは見逃さない。
    // 書く前のファイル全体は検証しない。誤った状態を書き込みで直す操作（空の配列に最初の要素を足すなど）を止めるからである
    // set で同じ値が既にあるなら、その値も含めてファイル全体を検証する。
    // append で同じ要素が既にあるなら、書こうとした最上位のキーは外す（その配列には、正規の書き込みで直す途中の状態がありうる）
    const file = { schema, layer: opts.layer, path };
    if (opts.mode === "set") validateLayer(file, current);
    else if (isRecord(current)) {
      const { [top]: _written, ...others } = current;
      validateLayer(file, others);
    }
    return { path, changed: false, reason };
  }
  const edits = editsFor(text, { ...opts, exists: existing !== undefined }, path);
  const next = jsonc.applyEdits(text, edits);
  const checkPath = `${path}（書き込んだ後）`;
  validateLayer({ schema, layer: opts.layer, path: checkPath }, parseJsonc(next, checkPath));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${bom}${next.endsWith("\n") ? next : `${next}\n`}`);
  return { path, changed: true, reason: opts.mode === "set" ? "書いた" : "足した" };
}

/**
 * 書くキーの最上位の名前を返す。スキーマに無いキーと、その層に置けないキーは ConfigError にする。
 * @param {ConfigSchema} schema
 * @param {WriteOptions} opts
 * @returns {string}
 */
function writableTop(schema, opts) {
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
  return top;
}

/**
 * 書く層のファイルのパスを返す。読まない人ごとの層・gitignore されていない .local.jsonc・リポジトリの外を指す置き場所は ConfigError にする。
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @param {WriteOptions} opts
 * @returns {string}
 */
function writablePath(root, env, opts) {
  if (opts.layer === "user" && ignoresUserLayer(env)) {
    throw new ConfigError(`人ごとの層に書かない（${ignoreReason(env)}）`);
  }
  const path = configPaths(root, opts.name, env)[opts.layer];
  if (opts.layer === "local") requireIgnored(root, path);
  if (opts.layer !== "user") requireInsideRoot(root, path);
  return path;
}

/**
 * set で書かずに返す理由。同じ値が既にあれば理由を返し、違う値が既にあれば（--replace が無いとき）ConfigError にする。
 * @param {WriteOptions} opts
 * @param {unknown} existing 書くキーに既にある値
 * @param {string} path
 * @returns {string | undefined}
 */
function setUnchanged(opts, existing, path) {
  if (existing === undefined || opts.replace) return undefined;
  if (JSON.stringify(existing) === JSON.stringify(opts.value)) return "同じ値が既にある";
  throw new ConfigError(
    `${path}: ${opts.keyPath.join(".")} は既に ${JSON.stringify(existing)} になっている。既にあるキーは変えない（変えるなら人が確かめてから --replace を付ける）`,
  );
}

/**
 * append で書かずに返す理由。--unique-by の欄が同じ要素が既にあれば理由を返す。
 * @param {WriteOptions} opts
 * @param {unknown} existing 書くキーに既にある値
 * @param {string} path
 * @returns {string | undefined}
 */
function appendUnchanged(opts, existing, path) {
  if (existing !== undefined && !isArray(existing))
    throw new ConfigError(`${path}: ${opts.keyPath.join(".")} が配列でない`);
  if (opts.uniqueBy === undefined) return undefined;
  const list = isArray(existing) ? existing : [];
  const key = opts.uniqueBy;
  // 文字列だけの要素は、key の欄だけを書いた要素の短い書き方として扱う（intentional_diffs の "文言" と {"item": "文言"} など）。
  // 足す値が文字列のときも同じに扱う
  const keyOf = (/** @type {unknown} */ x) => (isRecord(x) ? x[key] : x);
  const want =
    isRecord(opts.value) || typeof opts.value === "string" ? keyOf(opts.value) : undefined;
  if (want === undefined) throw new UsageError(`--unique-by ${key}: 足す要素に ${key} が無い`);
  if (list.some((x) => JSON.stringify(keyOf(x)) === JSON.stringify(want)))
    return `${key} が同じ要素が既にある`;
  return undefined;
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
  const last = (container.children ?? []).at(-1);
  if (last === undefined) return appendToEmpty(text, container, member);
  const end = last.offset + last.length;
  const inline = !text.slice(container.offset, last.offset).includes("\n");
  if (inline) return [{ offset: end, length: 0, content: `, ${member("", true)}` }];
  const { at, hasComma } = afterLastMember(text, end);
  const child = lineIndent(text, last.offset);
  const added = `\n${child}${member(child, false)}${hasComma ? "," : ""}`;
  if (hasComma) return [{ offset: at, length: 0, content: added }];
  return [
    { offset: end, length: 0, content: "," },
    { offset: at, length: 0, content: added },
  ];
}

/**
 * 要素の無いオブジェクトか配列に、最初の要素を足す編集。
 * @param {string} text
 * @param {jsonc.Node} container
 * @param {(indent: string, inline: boolean) => string} member
 * @returns {jsonc.Edit[]}
 */
function appendToEmpty(text, container, member) {
  const close = container.offset + container.length - 1;
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

/**
 * 空白とタブを読み飛ばした位置。
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function skipBlanks(text, offset) {
  let j = offset;
  while (text[j] === " " || text[j] === "\t") j++;
  return j;
}

/**
 * 最後の要素（end で終わる）の後ろで、次の要素を足す位置と、最後の要素の後に「,」があるか。
 * 足す位置は、「,」と、同じ行のコメントの後ろにする。
 * @param {string} text
 * @param {number} end
 * @returns {{ at: number; hasComma: boolean }}
 */
function afterLastMember(text, end) {
  let j = skipBlanks(text, end);
  const hasComma = text[j] === ",";
  if (hasComma) j = skipBlanks(text, j + 1);
  // 同じ行で閉じるブロックコメントは読み進める。その後ろの行コメントも、最後の要素に付いたまま残す
  let closedBlock = false;
  while (text.startsWith("/*", j)) {
    const closeComment = text.indexOf("*/", j);
    const nl = text.indexOf("\n", j);
    if (closeComment === -1 || (nl !== -1 && closeComment > nl)) break;
    j = skipBlanks(text, closeComment + 2);
    closedBlock = true;
  }
  if (text.startsWith("//", j)) {
    const nl = text.indexOf("\n", j);
    return { at: nl === -1 ? text.length : nl, hasComma };
  }
  if (!closedBlock && !hasComma) return { at: end, hasComma };
  return { at: j, hasComma };
}

/**
 * 値を書く編集を作る。
 * - set で値がある（--replace）: 値の範囲を置き換える
 * - set で値が無い: 在る中で最も深いオブジェクトに、残りのパスを入れ子にした値を足す
 * - append: 配列があれば末尾に要素を足し、無ければ要素 1 つの配列を set と同じく足す
 * @param {string} text
 * @param {Pick<WriteOptions, "keyPath" | "value" | "mode"> & { exists: boolean }} write exists は keyPath に値があるか
 * @param {string} where
 * @returns {jsonc.Edit[]}
 */
function editsFor(text, { keyPath, value, mode, exists }, where) {
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
 * リポジトリの層のファイルが、リポジトリの中の実体であることを確かめる。
 * 書き込み先かその途中のディレクトリがシンボリックリンクでリポジトリの外を指すと、set と append がリポジトリの外のファイルを書き換えるので止める。
 * @param {string} root
 * @param {string} path
 */
function requireInsideRoot(root, path) {
  // 指す先がまだ無いリンクも、書くとリンクをたどって先にファイルを作るので、existsSync ではなく lstat で確かめる
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new ConfigError(`${path}: シンボリックリンクには書かない（実体のファイルを置く）`);
  let dir = dirname(path);
  // 途中のディレクトリも lstat でたどる。existsSync は指す先がまだ無いリンクを「無い」と答え、その上のディレクトリで確かめてしまう
  while (lstatSync(dir, { throwIfNoEntry: false }) === undefined && dirname(dir) !== dir)
    dir = dirname(dir);
  if (!existsSync(dir))
    throw new ConfigError(
      `${path}: 置き場所の途中の ${dir} が、指す先の無いシンボリックリンクになっている。書かない`,
    );
  const real = relative(realpathSync(root), realpathSync(dir));
  if (real.startsWith("..") || isAbsolute(real))
    throw new ConfigError(
      `${path}: 置き場所のディレクトリがリポジトリの外を指している（${realpathSync(dir)}）。書かない`,
    );
}

/**
 * `.local.jsonc` が gitignore されていなければ止める（自分だけの値を commit しないため）。
 * @param {string} root
 * @param {string} path
 */
function requireIgnored(root, path) {
  const r = spawnSync("git", ["check-ignore", "-q", "--no-index", relative(root, path)], {
    cwd: root,
    stdio: "ignore",
    timeout: 10_000,
  });
  if (r.status === 0) return;
  // 1 だけが「gitignore されていない」。git のリポジトリの外（128）や git の起動の失敗を、.gitignore に足せば直るものとして案内しない
  if (r.status !== 1) {
    throw new ConfigError(
      `${path}: gitignore されているかを確かめられない（git check-ignore の終了コード ${r.status ?? "なし"}${r.error ? `、${r.error.message}` : ""}）。.local.jsonc は git のリポジトリの中にだけ書く`,
    );
  }
  throw new ConfigError(
    `${path} が gitignore されていない。.gitignore に /.config/skills/${NAMESPACE}/*.local.jsonc を足してから書く（references/config-files.md「人ごと・リポジトリ限定の層」）`,
  );
}

// ---------------------------------------------------------------------------
// CLI

const usage = `usage: skill-config.mjs get <name> <key-path> [--raw] [--cli-value <JSON>]
  skill-config.mjs dump <name>
  skill-config.mjs validate <name>
  skill-config.mjs paths <name>
  skill-config.mjs set <name> <key-path> <JSON> --layer <local|user|repo> [--replace]
  skill-config.mjs append <name> <key-path> <JSON> --layer <local|user|repo> [--unique-by <field>]
common options: --root <dir>（リポジトリのルート）  --schema-dir <dir>
- で始まる値（負の数など）は、-- の後に置く（例: set <name> <key> --layer repo -- -1）`;

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
    const { pos, flags } = parseArgs(argv);
    if (flags["-h"] || flags["--help"]) {
      io.out(`${usage}\n`);
      return 0;
    }
    return runCommand(commandContext(pos, flags, io));
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

/** 値を取るオプション。 */
const VALUED_FLAGS = new Set(["--root", "--schema-dir", "--layer", "--cli-value", "--unique-by"]);

/** 値を取らないオプション。 */
const BARE_FLAGS = new Set(["--raw", "--replace", "-h", "--help"]);

/**
 * サブコマンドに関係するオプション。ここに無いサブコマンドには、ここに挙げたオプションを渡せない。
 * @type {Record<string, string[]>}
 */
const COMMAND_FLAGS = {
  get: ["--raw", "--cli-value"],
  set: ["--layer", "--replace"],
  append: ["--layer", "--unique-by"],
};

/**
 * 引数を位置引数とオプションに分ける。オプションは parseFlags で読み、誤りは UsageError にする。
 * -- の後は、parseFlags がすべて位置引数にする（負の数の JSON 値 -1 などを渡すため）。
 * 位置引数の数は、サブコマンドごとに commandContext と expectArgs で確かめるので、ここでは数えない。
 * @param {string[]} argv
 * @returns {{ pos: string[]; flags: Record<string, string | true> }}
 */
function parseArgs(argv) {
  const parsed = parseFlags(argv, {
    values: [...VALUED_FLAGS],
    bools: [...BARE_FLAGS],
    positionals: Number.POSITIVE_INFINITY,
  });
  if (parsed.error !== undefined) throw new UsageError(parsed.error);
  // 繰り返してよい名前（repeat）を渡さないので、値は strings と bools にだけ入る
  return { pos: parsed.positionals, flags: { ...parsed.strings, ...parsed.bools } };
}

// parse-flags-js:begin
/**
 * CLI が受け付ける引数。
 * - values: 値を 1 つ取る名前。同じ名前の 2 回目は誤りにする
 * - repeat: values のうち、繰り返してよい名前。値は配列で返す
 * - bools: 値を取らない名前。同じ名前の 2 回目は誤りにする
 * - dashValues: values のうち、`--` で始まる値を受け付ける名前（CSS のカスタムプロパティなど）
 * - positionals: 位置引数（`-` で始まらない引数・`-` だけの引数・`--` より後の引数）の最大の数（省略すると 0）
 * - equals: true なら `--名前=値` の形も受け付ける
 * @typedef {{ values?: readonly string[], repeat?: readonly string[], bools?: readonly string[], dashValues?: readonly string[], positionals?: number, equals?: boolean }} FlagSpec
 */

/**
 * `--名前 値` の引数を読む。誤りがあれば、error に理由を入れて返す。
 * 誤りの文は、未知の名前と多すぎる位置引数が「不明な引数: <引数>」、値の無い名前が「<名前> に値が無い」、
 * 同じ名前の 2 回目が「<名前> が重複している」、値を取らない名前に `=値` を付けたものが「<名前> は値を取らない」である。値が無いとは、名前が末尾にあって値が続かない・値が空白だけ・その CLI が受け付ける名前と同じ・
 * `--` で始まる（dashValues の名前を除く）のどれかである。`--` だけの引数はオプションの終わりで、その後はすべて位置引数にする。名前は値より先に確かめる。値を先に確かめると、値の無い未知の引数を
 * 「値が無い」と報告し、受け付ける引数のように読める。必須の引数と値の中身は、各 CLI が受け取った後に確かめる。
 * @param {readonly string[]} argv
 * @param {FlagSpec} spec
 * 結果は、名前の種類ごとの表（strings は値を 1 つ取る名前、lists は繰り返してよい名前、bools は値を取らない名前）と
 * 位置引数である。表のキーは `--` を含む名前である。
 * @returns {ParsedFlags | { error: string }}
 */
function parseFlags(argv, spec) {
  /** @type {FlagState} */
  const state = { spec, seen: new Set(), strings: {}, lists: {}, bools: {}, positionals: [] };
  for (let i = 0; i < argv.length; i += 1) {
    // 位置引数を取らない CLI では、`--` も受け付けない引数として扱う。
    if (argv[i] === "--" && (spec.positionals ?? 0) > 0) {
      const error = pushRest(argv.slice(i + 1), state);
      if (error) return { error };
      break;
    }
    const step = readFlagArg(argv, i, state);
    if ("error" in step) return { error: step.error };
    i = step.next;
  }
  const { strings, lists, bools, positionals } = state;
  return { strings, lists, bools, positionals };
}

/**
 * parseFlags の結果。
 * @typedef {{ strings: Record<string, string>, lists: Record<string, string[]>, bools: Record<string, true>, positionals: string[], error?: undefined }} ParsedFlags
 */

/**
 * parseFlags が読み進める途中の状態。seen は、読んだ名前（同じ名前の 2 回目を見つけるため）である。
 * @typedef {Omit<ParsedFlags, "error"> & { spec: FlagSpec, seen: Set<string> }} FlagState
 */

/**
 * argv[i] を 1 つ読み、値を読んだなら次の位置を、誤りなら理由を返す。
 * @param {readonly string[]} argv
 * @param {number} i
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function readFlagArg(argv, i, state) {
  const arg = argv[i];
  // `-` だけの引数は、標準入力を指す位置引数として扱う。
  if (!arg.startsWith("-") || arg === "-") {
    const error = pushPositional(arg, state);
    return error ? { error } : { next: i };
  }
  const eq = state.spec.equals && arg.startsWith("--") ? arg.indexOf("=") : -1;
  if (eq <= 0 && state.spec.bools?.includes(arg)) return setBoolFlag(arg, i, state);
  const inline = eq > 0 ? { name: arg.slice(0, eq), value: arg.slice(eq + 1) } : null;
  return readValueFlag({ argv, i, inline }, state);
}

/**
 * 値を取る名前を読む。inline は `--名前=値` の形の名前と値で、無ければ次の要素を値にする。
 * @param {{ argv: readonly string[], i: number, inline: { name: string, value: string } | null }} at
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function readValueFlag({ argv, i, inline }, state) {
  const name = inline?.name ?? argv[i];
  if (inline && state.spec.bools?.includes(name)) return { error: `${name} は値を取らない` };
  if (!(state.spec.values?.includes(name) ?? false)) return { error: `不明な引数: ${argv[i]}` };
  const value = inline ? inline.value : argv[i + 1];
  if (value === undefined || missingValue(name, value, state.spec))
    return { error: `${name} に値が無い` };
  const error = storeFlagValue(name, value, state);
  return error ? { error } : { next: inline ? i : i + 1 };
}

/**
 * `--` より後の引数をすべて位置引数として足す。上限を超えたら、最初に超えた引数の誤りの文を返す。
 * @param {readonly string[]} rest
 * @param {FlagState} state
 * @returns {string | undefined}
 */
function pushRest(rest, state) {
  for (const arg of rest) {
    const error = pushPositional(arg, state);
    if (error) return error;
  }
  return undefined;
}

/**
 * 位置引数を足す。上限を超えたら誤りの文を返す。
 * @param {string} arg
 * @param {FlagState} state
 * @returns {string | undefined}
 */
function pushPositional(arg, state) {
  if (state.positionals.length >= (state.spec.positionals ?? 0)) return `不明な引数: ${arg}`;
  state.positionals.push(arg);
  return undefined;
}

/**
 * 値を取らない名前を bools に入れる。2 回目なら誤りの文を返す。
 * @param {string} name
 * @param {number} i
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function setBoolFlag(name, i, state) {
  if (state.seen.has(name)) return { error: `${name} が重複している` };
  state.seen.add(name);
  state.bools[name] = true;
  return { next: i };
}

/**
 * 値を取る名前の値を strings か lists に入れる。繰り返してよい名前は配列に足し、それ以外の 2 回目は誤りの文を返す。
 * @param {string} name
 * @param {string} value
 * @param {FlagState} state
 * @returns {string | undefined}
 */
function storeFlagValue(name, value, state) {
  if (state.spec.repeat?.includes(name)) {
    state.lists[name] = [...(state.lists[name] ?? []), value];
    return undefined;
  }
  if (state.seen.has(name)) return `${name} が重複している`;
  state.seen.add(name);
  state.strings[name] = value;
  return undefined;
}

/**
 * 値を、値の書き忘れとして扱うか。空白だけの値と、その CLI が受け付ける名前と同じ値（`-h` を含む）は、書き忘れとして扱う。
 * `--` で始まる値も書き忘れとして扱うが、dashValues の名前は受け付ける（CSS のカスタムプロパティなど）。
 * @param {string} name
 * @param {string} value
 * @param {FlagSpec} spec
 * @returns {boolean}
 */
function missingValue(name, value, spec) {
  // `--`（オプションの終わり）は、dashValues の名前でも値として受け付けない。
  if (value.trim() === "" || value === "--") return true;
  if ((spec.values?.includes(value) ?? false) || (spec.bools?.includes(value) ?? false))
    return true;
  return value.startsWith("--") && !(spec.dashValues?.includes(name) ?? false);
}
// parse-flags-js:end

/**
 * サブコマンドの実行に渡す引数と共通の設定。
 * @typedef {object} CommandContext
 * @property {string} cmd
 * @property {string[]} rest サブコマンドと設定の名前の後の位置引数
 * @property {Record<string, string | true>} flags
 * @property {{ name: string; root: string; env: NodeJS.ProcessEnv; schemaDir: string; warn: (s: string) => void }} base
 *   loadConfig と writeConfig に共通で渡すオプション
 * @property {Io} io
 */

/**
 * 位置引数とオプションから、サブコマンドの実行に渡すものを作る。
 * @param {string[]} pos
 * @param {Record<string, string | true>} flags
 * @param {Io} io
 * @returns {CommandContext}
 */
function commandContext(pos, flags, io) {
  const [cmd, name, ...rest] = pos;
  if (cmd === undefined || name === undefined)
    throw new UsageError("サブコマンドと設定の名前が要る");
  checkCommandFlags(cmd, flags);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    throw new UsageError(`設定の名前 ${JSON.stringify(name)} が小文字の英数字とハイフンでない`);
  const root = typeof flags["--root"] === "string" ? flags["--root"] : findRoot(io.cwd);
  const schemaDir =
    typeof flags["--schema-dir"] === "string" ? flags["--schema-dir"] : DEFAULT_SCHEMA_DIR;
  const base = { name, root, env: io.env, schemaDir, warn: io.err };
  return { cmd, rest, flags, base, io };
}

/**
 * サブコマンドに関係しないオプションは、無視せずに止める（set の --unique-by や get の --layer が反映されたと思わせない）。
 * @param {string} cmd
 * @param {Record<string, string | true>} flags
 */
function checkCommandFlags(cmd, flags) {
  for (const f of Object.keys(flags)) {
    if (f === "--root" || f === "--schema-dir") continue;
    if (Object.hasOwn(COMMAND_FLAGS, cmd) && !COMMAND_FLAGS[cmd].includes(f))
      throw new UsageError(`${cmd} に ${f} は渡せない`);
    if (
      !Object.hasOwn(COMMAND_FLAGS, cmd) &&
      Object.values(COMMAND_FLAGS).some((l) => l.includes(f))
    )
      throw new UsageError(`${cmd} に ${f} は渡せない`);
  }
}

/**
 * @param {CommandContext} ctx
 * @param {number} n 位置引数の数
 */
function expectArgs(ctx, n) {
  if (ctx.rest.length !== n) throw new UsageError(`${ctx.cmd} の引数の数が違う`);
}

/**
 * サブコマンドを実行し、終了コードを返す。
 * @param {CommandContext} ctx
 * @returns {number}
 */
function runCommand(ctx) {
  const { cmd } = ctx;
  switch (cmd) {
    case "get":
      expectArgs(ctx, 1);
      return runGet(ctx);
    case "dump":
      expectArgs(ctx, 0);
      ctx.io.out(`${JSON.stringify(loadConfig(ctx.base), null, 2)}\n`);
      return 0;
    case "validate":
      expectArgs(ctx, 0);
      return runValidate(ctx);
    case "paths":
      expectArgs(ctx, 0);
      return runPaths(ctx);
    case "set":
    case "append":
      expectArgs(ctx, 2);
      return runWrite(ctx, cmd);
    default:
      throw new UsageError(`知らないサブコマンド ${cmd}`);
  }
}

/**
 * get を実行する。層は最上位のキーごとに選ぶ。入れ子のパスは、選んだ層の値の中をたどる。
 * @param {CommandContext} ctx
 * @returns {number}
 */
function runGet({ rest, flags, base, io }) {
  const { name, schemaDir } = base;
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
  const r = loadConfig({ ...base, cli, schema })[key];
  const value = innerValue(r?.value, inner);
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

/**
 * 値の中を、入れ子のパスでたどる。たどれなければ undefined。
 * @param {unknown} value
 * @param {(string | number)[]} inner
 * @returns {unknown}
 */
function innerValue(value, inner) {
  let cur = value;
  for (const part of inner) {
    if (typeof part === "number" && isArray(cur)) cur = cur[part];
    else if (typeof part === "string" && isRecord(cur) && Object.hasOwn(cur, part)) cur = cur[part];
    else cur = undefined;
  }
  return cur;
}

/**
 * validate を実行する。
 * @param {CommandContext} ctx
 * @returns {number}
 */
function runValidate({ base, io }) {
  const { name, root } = base;
  loadConfig(base);
  // 読まなかった人ごとの層のファイルは、検証していないので並べない（読まない旨は loadConfig が note で出す）
  const ignoreUser = ignoresUserLayer(io.env);
  const present = Object.entries(configPaths(root, name, io.env)).filter(
    ([l, p]) => !(l === "user" && ignoreUser) && existsSync(p),
  );
  io.out(
    `ok: ${name} の設定はスキーマに合う（${present.length === 0 ? "設定ファイルは無い" : present.map(([l, p]) => `${l}=${p}`).join(" ")}）\n`,
  );
  return 0;
}

/**
 * paths を実行する。
 * @param {CommandContext} ctx
 * @returns {number}
 */
function runPaths({ base, io }) {
  const { name, root } = base;
  // 読まない人ごとの層のパスは出さない（そこに書いても読まれず、相対パスならリポジトリの層と取り違える）
  const ignoreUser = ignoresUserLayer(io.env);
  for (const [l, p] of Object.entries(configPaths(root, name, io.env))) {
    if (l === "user" && ignoreUser)
      io.err(`note: 人ごとの層（${p}）を読まない（${ignoreReason(io.env)}）\n`);
    else io.out(`${l}=${p}\n`);
  }
  return 0;
}

/**
 * set と append を実行する。
 * @param {CommandContext} ctx
 * @param {"set" | "append"} mode
 * @returns {number}
 */
function runWrite({ rest, flags, base, io }, mode) {
  const layer = flags["--layer"];
  if (layer !== "local" && layer !== "user" && layer !== "repo")
    throw new UsageError("--layer に local・user・repo のどれかが要る");
  const r = writeConfig({
    ...base,
    layer,
    keyPath: parseKeyPath(rest[0]),
    value: parseJsonArg(rest[1], "値"),
    mode,
    replace: flags["--replace"] === true,
    uniqueBy: typeof flags["--unique-by"] === "string" ? flags["--unique-by"] : undefined,
  });
  io.out(`${r.changed ? "changed" : "unchanged"}: ${r.path}（${r.reason}）\n`);
  return 0;
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
