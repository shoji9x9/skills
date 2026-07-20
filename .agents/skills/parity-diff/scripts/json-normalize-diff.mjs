// API / バッチの構造比較（正本）。正規化してから決定論的に差分パスを列挙する。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新を効かせるため）。
//
// 何をするか: 現行応答 current.json と新側応答 new.json を、指定パスの除外（揮発項目）→
// 必要なら指定配列のソート（並び順が意図的差異と宣言されている場合のみ）→ 深い比較、の順で
// 突き合わせ、差分パスと both 値を列挙する。api-resource / batch モードで使う。
//
// 何をしないか: しきい値で差分を潰さない。宣言の無い並び順差を勝手にソートで消さない。
//
// 決定論的: 乱数・現在時刻に依存しない。オブジェクトのキーは union をソートして走査するため、
// キー順の違いは差分にしない（値の違いだけを差分にする）。配列は index 順で比較する
// （順序差を差分にする。--sort-arrays を指定したパスだけ順序を正規化する）。
// TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * ツールのバージョン（正本）。比較ロジック・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/** 値が存在しない（キー欠落）ことを示すセンチネル文字列。 */
export const ABSENT = "(absent)";

/**
 * ドット記法パスのセグメント配列を返す。"data.*.updated_at" → ["data","*","updated_at"]。
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
 * @param {unknown} node
 * @param {string[]} segs
 * @returns {unknown}
 */
export function removePath(node, segs) {
  if (segs.length === 0 || node === null || typeof node !== "object") return node;
  const [head, ...rest] = segs;
  if (Array.isArray(node)) {
    return node
      .map((el, i) => {
        if (head === "*") return rest.length === 0 ? undefined : removePath(el, rest);
        const idx = Number(head);
        if (Number.isInteger(idx)) {
          if (idx < 0 || idx >= node.length) return el;
          // 配列 index 指定の除去は、その要素だけ null 化する（穴を作らない）。
          return i === idx ? (rest.length === 0 ? null : removePath(el, rest)) : el;
        }
        return el;
      })
      .filter((el) => !(head === "*" && rest.length === 0 && el === undefined));
  }
  const out = {};
  for (const key of Object.keys(node)) {
    if (head === "*") {
      out[key] = rest.length === 0 ? undefined : removePath(node[key], rest);
    } else if (key === head) {
      if (rest.length === 0) continue; // このキーを落とす
      out[key] = removePath(node[key], rest);
    } else {
      out[key] = node[key];
    }
  }
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

/**
 * オブジェクトのキーを再帰的に昇順へ正規化した複製を返す（ソートキー生成用）。
 * @param {unknown} v
 * @returns {unknown}
 */
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v !== null && typeof v === "object") {
    const out = {};
    for (const key of Object.keys(v).sort()) out[key] = canonicalize(v[key]);
    return out;
  }
  return v;
}

/**
 * 指定パスにある配列を、キー順を正規化した安定 JSON 文字列キーでソートした複製を返す
 * （宣言済みの並び順差の正規化）。素の JSON.stringify だと同じ集合でもキー挿入順の違いで
 * ソート順が変わり、current/new の並びが揃わず偽の差分が出るため、キーを昇順に正規化してから
 * 文字列化する。
 * @param {unknown} node
 * @param {string[]} segs
 * @returns {unknown}
 */
export function sortArrayAtPath(node, segs) {
  if (node === null || typeof node !== "object") return node;
  if (segs.length === 0) {
    if (Array.isArray(node)) {
      return [...node].sort((a, b) => {
        const ka = JSON.stringify(canonicalize(a));
        const kb = JSON.stringify(canonicalize(b));
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
    }
    return node;
  }
  const [head, ...rest] = segs;
  if (Array.isArray(node)) {
    return node.map((el, idx) => {
      if (head === "*" || Number(head) === idx) return sortArrayAtPath(el, rest);
      return el;
    });
  }
  const out = {};
  for (const key of Object.keys(node)) {
    out[key] = key === head || head === "*" ? sortArrayAtPath(node[key], rest) : node[key];
  }
  return out;
}

/**
 * 2 つの値を深く比較し、差分パスと both 値を out へ積む。決定論的（キーは昇順）。
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} path
 * @param {Array<{ path:string, current:unknown, new:unknown }>} out
 */
export function deepDiff(a, b, path, out) {
  const aObj = a !== null && typeof a === "object";
  const bObj = b !== null && typeof b === "object";
  if (aObj && bObj && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a)) {
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i += 1) {
        const childPath = path ? `${path}.${i}` : String(i);
        deepDiff(i < a.length ? a[i] : ABSENT, i < b.length ? b[i] : ABSENT, childPath, out);
      }
      return;
    }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      const av = Object.prototype.hasOwnProperty.call(a, key) ? a[key] : ABSENT;
      const bv = Object.prototype.hasOwnProperty.call(b, key) ? b[key] : ABSENT;
      deepDiff(av, bv, childPath, out);
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
  const out = [];
  deepDiff(current, next, "", out);
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  return out.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exit(main(process.argv.slice(2)));
}
