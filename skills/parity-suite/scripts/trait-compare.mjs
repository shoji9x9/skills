// 特性照合（正本）。trait-capture.mjs の採取結果 2 つを決定論的に比較する。
// 正本はこのスキル側にあり、実行時はプロジェクトの
// `<parity_suite_dir>/parity/lib/tools/` へコピーして使う（配布スキルの成果物同梱規約）。
//
// 使いどころ:
//   - ノイズ基準値の測定: 現行を同一条件で 2 回採り、その差分量を metadata.json に記録する
//   - 強度ゲート: スタイル注入後のキャプチャをベースライン相手に照合し、差分器が既知の差を赤にできるか確認する
//   - parity-diff: 現・新の照合に同じ関数/CLI をそのまま再利用する（検証済み差分器の引き継ぎ）
//
// 相対幾何の原則: 絶対座標は比較しない。要素対ごとの関係（左右・上下・端揃え）を両側で導出し、
// 関係が変わった対だけを差分にする。位置がページ全体でずれても、要素同士の関係が保たれていれば差分にしない。
//
// 決定論的: 乱数・現在時刻に依存しない。Playwright に依存しない（純粋な JS）。
// TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * ツールのバージョン（正本）。比較ロジック・差分形状を変えたら上げる。
 * metadata.json の differ.trait_compare に記録する「バージョン」はこの値を使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "1";

/**
 * @typedef {object} Trait
 * @property {string} name
 * @property {Record<string,string>} computed
 * @property {Record<string,string> | null} [before]
 * @property {Record<string,string> | null} [after]
 * @property {{ x:number, y:number, width:number, height:number }} rect
 */

/**
 * @typedef {object} Diff
 * @property {string} name  - 要素の論理名。幾何差分は "A | B" の対で表す。
 * @property {'property'|'pseudo'|'geometry'|'missing'|'duplicate'} kind
 * @property {string} [prop]
 * @property {string} [expected]
 * @property {string} [actual]
 */

/**
 * 3 値の順序関係を許容誤差付きで返す。
 * @param {number} p
 * @param {number} q
 * @param {number} tol
 * @returns {'lt'|'gt'|'eq'}
 */
function order(p, q, tol) {
  if (p < q - tol) return "lt";
  if (p > q + tol) return "gt";
  return "eq";
}

/**
 * 要素対 (a, b) の相対関係を導出する（絶対座標は含めない）。
 * @param {{ x:number, y:number, width:number, height:number }} a
 * @param {{ x:number, y:number, width:number, height:number }} b
 * @param {number} tol
 */
function relate(a, b, tol) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return {
    horizontal: order(a.x + a.width / 2, b.x + b.width / 2, tol),
    vertical: order(a.y + a.height / 2, b.y + b.height / 2, tol),
    leftAligned: String(Math.abs(a.x - b.x) <= tol),
    rightAligned: String(Math.abs(ax2 - bx2) <= tol),
    topAligned: String(Math.abs(a.y - b.y) <= tol),
    bottomAligned: String(Math.abs(ay2 - by2) <= tol),
  };
}

/**
 * 2 つの computed style マップを比較して property 差分を積む。
 * @param {string} name
 * @param {'property'|'pseudo'} kind
 * @param {string} prefix - pseudo のときの接頭辞（例 "::before/"）。property のときは ""。
 * @param {Record<string,string>} expectedMap
 * @param {Record<string,string>} actualMap
 * @param {Diff[]} out
 */
function diffStyleMap(name, kind, prefix, expectedMap, actualMap, out) {
  const keys = new Set([...Object.keys(expectedMap), ...Object.keys(actualMap)]);
  for (const key of [...keys].sort()) {
    const expected = expectedMap[key];
    const actual = actualMap[key];
    if (expected !== actual) {
      out.push({
        name,
        kind,
        prop: prefix + key,
        expected: String(expected),
        actual: String(actual),
      });
    }
  }
}

/**
 * 擬似要素（::before / ::after）の差分を積む。null（生成コンテンツ無し）の有無も差分にする。
 * @param {string} name
 * @param {string} pseudo - "::before" | "::after"
 * @param {Record<string,string>|null|undefined} expected
 * @param {Record<string,string>|null|undefined} actual
 * @param {Diff[]} out
 */
function diffPseudo(name, pseudo, expected, actual, out) {
  const exists = (v) => (v ? "present" : "absent");
  if (Boolean(expected) !== Boolean(actual)) {
    out.push({
      name,
      kind: "pseudo",
      prop: pseudo,
      expected: exists(expected),
      actual: exists(actual),
    });
    return;
  }
  if (expected && actual) {
    diffStyleMap(name, "pseudo", pseudo + "/", expected, actual, out);
  }
}

/**
 * baseline と capture を比較して差分配列を返す。決定論的。
 * @param {Trait[]} baselineEntries
 * @param {Trait[]} captureEntries
 * @param {{ alignTolerance?: number }} [options]
 * @returns {Diff[]}
 */
export function compareTraits(baselineEntries, captureEntries, options = {}) {
  const tol = options.alignTolerance ?? 1;
  const baseByName = new Map(baselineEntries.map((e) => [e.name, e]));
  const capByName = new Map(captureEntries.map((e) => [e.name, e]));
  /** @type {Diff[]} */
  const out = [];

  // 0. 論理名の重複は authoring ミス（Map が後勝ちで潰れ、先勝ち分の退行が隠れる）。
  //    黙って比較を続けず、診断として差分に出す。
  for (const [label, entries] of [
    ["baseline", baselineEntries],
    ["capture", captureEntries],
  ]) {
    const counts = new Map();
    for (const e of entries) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    for (const [name, count] of counts) {
      if (count > 1) {
        out.push({ name, kind: "duplicate", prop: label, expected: "1", actual: String(count) });
      }
    }
  }

  // 1. プロパティ・擬似要素の差分（baseline の並び順で走査 = 決定論的）。
  for (const base of baselineEntries) {
    const cap = capByName.get(base.name);
    if (!cap) {
      out.push({ name: base.name, kind: "missing", expected: "present", actual: "absent" });
      continue;
    }
    diffStyleMap(base.name, "property", "", base.computed || {}, cap.computed || {}, out);
    diffPseudo(base.name, "::before", base.before, cap.before, out);
    diffPseudo(base.name, "::after", base.after, cap.after, out);
  }

  // 2. capture 側にしか無い要素（余分）も欠落として拾う。
  for (const cap of captureEntries) {
    if (!baseByName.has(cap.name)) {
      out.push({ name: cap.name, kind: "missing", expected: "absent", actual: "present" });
    }
  }

  // 3. 相対幾何: 両側に存在し rect を持つ要素対の関係が変わったものだけを差分にする。
  //    rect を欠くエントリ（旧スキーマ・手編集）はクラッシュさせず診断を出して幾何比較から除く。
  const shared = [];
  const seen = new Set();
  for (const e of baselineEntries) {
    if (seen.has(e.name) || !capByName.has(e.name)) continue;
    seen.add(e.name);
    const baseRect = e.rect;
    const capRect = capByName.get(e.name).rect;
    if (!baseRect || !capRect) {
      out.push({
        name: e.name,
        kind: "missing",
        prop: "rect",
        expected: baseRect ? "present" : "absent",
        actual: capRect ? "present" : "absent",
      });
      continue;
    }
    shared.push({ name: e.name, baseRect, capRect });
  }
  for (let i = 0; i < shared.length; i += 1) {
    const a = shared[i];
    for (let j = i + 1; j < shared.length; j += 1) {
      const b = shared[j];
      const baseRel = relate(a.baseRect, b.baseRect, tol);
      const capRel = relate(a.capRect, b.capRect, tol);
      for (const key of Object.keys(baseRel)) {
        if (baseRel[key] !== capRel[key]) {
          out.push({
            name: a.name + " | " + b.name,
            kind: "geometry",
            prop: key,
            expected: baseRel[key],
            actual: capRel[key],
          });
        }
      }
    }
  }

  return out;
}

/**
 * CLI エントリ。
 * `node trait-compare.mjs <baseline.json> <capture.json> [--align-tolerance <px>]` で差分を
 * JSON 出力し、差分があれば exit 1、無ければ exit 0、入力エラーは exit 2。
 * ファイルは trait-capture の採取結果配列。--align-tolerance は metadata.json の
 * differ.align_tolerance に記録した値を渡す（省略時 1。記録値と CLI 指定を一致させること）。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {number} exit code
 */
export function main(argv) {
  const usage =
    "usage: node trait-compare.mjs <baseline.json> <capture.json> [--align-tolerance <px>]\n";
  const files = [];
  let alignTolerance;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--align-tolerance") {
      alignTolerance = Number(argv[i + 1]);
      if (!Number.isFinite(alignTolerance) || alignTolerance < 0) {
        process.stderr.write("error: --align-tolerance must be a non-negative number\n");
        return 2;
      }
      i += 1;
    } else {
      files.push(argv[i]);
    }
  }
  if (files.length !== 2) {
    process.stderr.write(usage);
    return 2;
  }
  let baseline;
  let capture;
  try {
    baseline = JSON.parse(readFileSync(files[0], "utf8"));
    capture = JSON.parse(readFileSync(files[1], "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: cannot read inputs: ${message}\n`);
    return 2;
  }
  if (!Array.isArray(baseline) || !Array.isArray(capture)) {
    process.stderr.write("error: both inputs must be JSON arrays of trait entries\n");
    return 2;
  }
  const diffs = compareTraits(baseline, capture, { alignTolerance });
  process.stdout.write(JSON.stringify(diffs, null, 2) + "\n");
  return diffs.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  process.exit(main(process.argv.slice(2)));
}
