// API とバッチの構造を比べる（原本）。正規化してから、差分のパスを決定論的に列挙する。
// 原本はこのスキルの中にあり、スキルのディレクトリから直接実行する。
// プロジェクトへはコピーしない。gh skill update の自動更新を反映させるためである。
//
// 現行の応答 current.json と新側の応答 new.json を、次の順で比べ、差分のパスと両方の値を列挙する。
// api-resource と batch のモードで使う。
// 1. 指定したパス（揮発する項目）を除く。
// 2. 並び順が意図的差異と宣言されている場合だけ、指定した配列をソートする。
// 3. 深く比較する。
//
// しきい値で差分を消さない。宣言されていない並び順の差を、勝手にソートして消さない。
//
// 乱数と現在時刻に依存しない。オブジェクトのキーは両方の和集合をソートしてたどるので、
// キーの順の違いは差分にせず、値の違いだけを差分にする。配列は index の順に比べる。
// 順序の差は差分にし、--sort-arrays で指定したパスだけ順序を正規化する。
// TypeScript の構文は使わない（型は JSDoc で書く）。

import { readFileSync } from "node:fs";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { isPlainObject } from "./lib/guards.mjs";
import { canonicalize } from "./lib/json.mjs";

/**
 * ツールのバージョン（原本）。比較の処理や出力の形を変えたら上げる。
 *
 * @type {string}
 */
export const VERSION = "3";

/** 値が存在しない（キーや要素が無い）ことを、出力の current・new に書く表記。 */
export const ABSENT = "(absent)";

/**
 * 比べる間だけ使う、値が存在しないことの印。
 * JSON の値には Symbol が現れないので、本当の値が "(absent)" という文字列でも欠落と区別できる。
 */
const MISSING = Symbol("absent");

/**
 * ドット記法パスのセグメント配列を返す。"data.*.updated_at" → ["data","*","updated_at"]。
 *
 * @param {string} path
 * @returns {string[]}
 */
function segments(path) {
  return String(path)
    .split(".")
    .filter((s) => s.length > 0);
}

/**
 * オブジェクト/配列から指定パス（* ワイルドカード対応）のキーを非破壊で除去した複製を返す。
 *
 * @param {unknown} node
 * @param {string[]} segs
 * @returns {unknown}
 */
export function removePath(node, segs) {
  if (segs.length === 0 || node === null || typeof node !== "object") return node;
  const [head, ...rest] = segs;
  if (isArray(node)) {
    return node
      .map((el, i) => {
        if (head === "*") return rest.length === 0 ? undefined : removePath(el, rest);
        const idx = Number(head);
        if (Number.isInteger(idx)) {
          if (idx < 0 || idx >= node.length) return el;
          // 配列の index を指定した除去は、その要素だけを null にする（配列に空きを作らない）。
          return i === idx ? (rest.length === 0 ? null : removePath(el, rest)) : el;
        }
        return el;
      })
      .filter((el) => !(head === "*" && rest.length === 0 && el === undefined));
  }
  // 先頭の検査で null と非オブジェクトを、直前の分岐で配列を返しているので、ここには到達しない。
  if (!isPlainObject(node)) return node;
  // `Object.fromEntries` で組む（`out[key] = ...` で組むと `__proto__` のキーがプロトタイプの設定として扱われて消え、
  // そのキーの差分を警告なしに見逃す）。
  /** @type {[string, unknown][]} */
  const entries = [];
  for (const key of Object.keys(node)) {
    if (head === "*") {
      if (rest.length === 0) continue; // すべてのキーを落とす
      entries.push([key, removePath(node[key], rest)]);
    } else if (key === head) {
      if (rest.length === 0) continue; // このキーを落とす
      entries.push([key, removePath(node[key], rest)]);
    } else {
      entries.push([key, node[key]]);
    }
  }
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

/**
 * 指定パスにある配列を、キー順を正規化した安定 JSON 文字列キーでソートした複製を返す
 * （宣言済みの並び順差の正規化）。素の JSON.stringify だと同じ集合でもキー挿入順の違いで
 * ソート順が変わり、current/new の並びが揃わず偽の差分が出るため、キーを昇順に正規化してから
 * 文字列化する。
 *
 * @param {unknown} node
 * @param {string[]} segs
 * @returns {unknown}
 */
export function sortArrayAtPath(node, segs) {
  if (node === null || typeof node !== "object") return node;
  if (segs.length === 0) {
    if (isArray(node)) {
      return [...node].sort((a, b) => {
        const ka = JSON.stringify(canonicalize(a));
        const kb = JSON.stringify(canonicalize(b));
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
    }
    return node;
  }
  const [head, ...rest] = segs;
  if (isArray(node)) {
    return node.map((el, idx) => {
      if (head === "*" || Number(head) === idx) return sortArrayAtPath(el, rest);
      return el;
    });
  }
  // 先頭の検査で null と非オブジェクトを、直前の分岐で配列を返しているので、ここには到達しない。
  if (!isPlainObject(node)) return node;
  // removePath と同じく、`__proto__` のキーを消さないために `Object.fromEntries` で組む。
  return Object.fromEntries(
    Object.keys(node).map((key) => [
      key,
      key === head || head === "*" ? sortArrayAtPath(node[key], rest) : node[key],
    ]),
  );
}

/**
 * 2 つの配列の同じ位置の要素を組にする。片方にしか無い位置は、もう片方を MISSING にする。
 *
 * @param {unknown[]} x
 * @param {unknown[]} y
 * @returns {Array<{ key:string, xv:unknown, yv:unknown }>}
 */
function arrayChildPairs(x, y) {
  const len = Math.max(x.length, y.length);
  const pairs = [];
  for (let i = 0; i < len; i += 1) {
    pairs.push({
      key: String(i),
      xv: i < x.length ? x[i] : MISSING,
      yv: i < y.length ? y[i] : MISSING,
    });
  }
  return pairs;
}

/**
 * 2 つの JSON オブジェクトの同じキーの値を、キーの昇順に組にする。片方にしか無いキーは、もう片方を MISSING にする。
 *
 * @param {Record<string, unknown>} x
 * @param {Record<string, unknown>} y
 * @returns {Array<{ key:string, xv:unknown, yv:unknown }>}
 */
function objectChildPairs(x, y) {
  const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
  return keys.map((key) => ({
    key,
    xv: Object.prototype.hasOwnProperty.call(x, key) ? x[key] : MISSING,
    yv: Object.prototype.hasOwnProperty.call(y, key) ? y[key] : MISSING,
  }));
}

/**
 * deepDiff が中へ進む子の組を返す。両方が配列か、両方が JSON オブジェクトのときだけ中へ進む。
 * 片方だけが配列なら null を返し、呼び出し側が値ごと比べる。
 *
 * @param {unknown} x
 * @param {unknown} y
 * @returns {Array<{ key:string, xv:unknown, yv:unknown }> | null}
 */
function childPairs(x, y) {
  if (isArray(x) && isArray(y)) return arrayChildPairs(x, y);
  if (isPlainObject(x) && isPlainObject(y)) return objectChildPairs(x, y);
  return null;
}

/**
 * 2 つの値を深く比較し、差分のパスと、現行と新側の値の組の配列を返す。キーは昇順にたどるので、結果の順序は入力で決まる。
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {Array<{ path:string, current:unknown, new:unknown }>}
 */
export function deepDiff(a, b) {
  /** @type {Array<{ path:string, current:unknown, new:unknown }>} */
  const out = [];
  // 再帰ごとに変わるのはパスだけなので、out はこの関数の中に置き、内側の関数はパスだけを受け取る。
  /**
   * @param {unknown} x
   * @param {unknown} y
   * @param {string} path - 比べる位置のパス
   */
  const walk = (x, y, path) => {
    const children = childPairs(x, y);
    if (children !== null) {
      for (const { key, xv, yv } of children) walk(xv, yv, path ? `${path}.${key}` : key);
      return;
    }
    // JSON.stringify(MISSING) は undefined なので、片側だけに無い値は、もう片方が "(absent)" という文字列でも差分になる。
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      out.push({ path, current: x === MISSING ? ABSENT : x, new: y === MISSING ? ABSENT : y });
    }
  };
  walk(a, b, "");
  return out;
}

/**
 * CLI の引数を、位置引数と --ignore・--sort-arrays の値に分ける。どちらの名前も繰り返してよい。
 * 誤り（知らない名前・値の無い名前・3 つ目の位置引数）は文字列で返す。
 *
 * @param {string[]} argv
 * @returns {{ positionals:string[], ignore:string[], sortArrays:string[], error?: undefined } | { error: string }}
 */
function parseArgs(argv) {
  const names = ["--ignore", "--sort-arrays"];
  const parsed = parseFlags(argv, { values: names, repeat: names, positionals: 2 });
  if (parsed.error !== undefined) return { error: parsed.error };
  const list = (/** @type {string} */ name) => {
    const value = parsed.flags[name];
    return isArray(value) ? value : [];
  };
  return {
    positionals: parsed.positionals,
    ignore: list("--ignore"),
    sortArrays: list("--sort-arrays"),
  };
}

/**
 * 現行と新側の値に、パスごとに同じ変換を順に当てる。空のパスは飛ばす。
 *
 * @param {[unknown, unknown]} pair - 現行と新側の値
 * @param {string[]} paths
 * @param {(node:unknown, segs:string[]) => unknown} transform
 * @returns {[unknown, unknown]}
 */
function applyAtPaths([current, next], paths, transform) {
  for (const p of paths) {
    if (!p) continue;
    const segs = segments(p);
    current = transform(current, segs);
    next = transform(next, segs);
  }
  return [current, next];
}

/**
 * CLI エントリ。
 * `node json-normalize-diff.mjs <current.json> <new.json> [--ignore <path>...] [--sort-arrays <path>...]`
 * 差分があれば exit 1、無ければ exit 0、入力エラーは exit 2。
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {number} exit code
 */
export function main(argv) {
  const usage =
    "usage: node json-normalize-diff.mjs <current.json> <new.json> [--ignore <path>]... [--sort-arrays <path>]...\n";
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    process.stderr.write(`error: ${parsed.error}\n${usage}`);
    return 2;
  }
  const { positionals, ignore, sortArrays } = parsed;
  if (positionals.length !== 2) {
    process.stderr.write(usage);
    return 2;
  }
  let current;
  let next;
  try {
    current = JSON.parse(readFileSync(positionals[0], "utf8"));
    next = JSON.parse(readFileSync(positionals[1], "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: cannot read inputs: ${message}\n`);
    return 2;
  }
  [current, next] = applyAtPaths([current, next], ignore, removePath);
  [current, next] = applyAtPaths([current, next], sortArrays, sortArrayAtPath);
  const out = deepDiff(current, next);
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  return out.length > 0 ? 1 : 0;
}

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
