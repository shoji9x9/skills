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
import { isPlainObject } from "./lib/guards.mjs";
import { canonicalize } from "./lib/json.mjs";

/**
 * ツールのバージョン（原本）。比較の処理や出力の形を変えたら上げる。
 *
 * @type {string}
 */
export const VERSION = "2";

/** 値が存在しない（キー欠落）ことを示すセンチネル文字列。 */
export const ABSENT = "(absent)";

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
 * 2 つの値を深く比較し、差分パスと both 値を out へ積む。決定論的（キーは昇順）。
 *
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} path
 * @param {Array<{ path:string, current:unknown, new:unknown }>} out
 */
export function deepDiff(a, b, path, out) {
  const aObj = a !== null && typeof a === "object";
  const bObj = b !== null && typeof b === "object";
  if (aObj && bObj && isArray(a) === isArray(b)) {
    // 外側の条件で a と b の配列かどうかは揃っている。
    if (isArray(a) && isArray(b)) {
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i += 1) {
        const childPath = path ? `${path}.${i}` : String(i);
        deepDiff(i < a.length ? a[i] : ABSENT, i < b.length ? b[i] : ABSENT, childPath, out);
      }
      return;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) {
        const childPath = path ? `${path}.${key}` : key;
        const av = Object.prototype.hasOwnProperty.call(a, key) ? a[key] : ABSENT;
        const bv = Object.prototype.hasOwnProperty.call(b, key) ? b[key] : ABSENT;
        deepDiff(av, bv, childPath, out);
      }
    }
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push({ path, current: a, new: b });
  }
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
  const positionals = [];
  const ignore = [];
  const sortArrays = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--ignore") {
      ignore.push(argv[i + 1]);
      i += 1;
    } else if (a === "--sort-arrays") {
      sortArrays.push(argv[i + 1]);
      i += 1;
    } else {
      positionals.push(a);
    }
  }
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
  for (const p of ignore) {
    if (!p) continue;
    current = removePath(current, segments(p));
    next = removePath(next, segments(p));
  }
  for (const p of sortArrays) {
    if (!p) continue;
    current = sortArrayAtPath(current, segments(p));
    next = sortArrayAtPath(next, segments(p));
  }
  /** @type {Array<{ path:string, current:unknown, new:unknown }>} */
  const out = [];
  deepDiff(current, next, "", out);
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  return out.length > 0 ? 1 : 0;
}

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
