// 大きな JSON 成果物（被覆表・反応の被覆表など）の配列へ、要素を 1 件ずつ足す・差し替える・消す・読む（正本）。
// 正本は parity-suite にあり、スキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
//
// なぜ要るか（Issue #468）: 被覆表を Write で本文ごと書き直すと、書いた本文がそのままエージェントの文脈に積まれる。
// 表は測るたびに 1 行ずつ育つので、書き直すたびに全文が積み増され、費用がターン数の 2 乗で増える。
// 1 行ぶんの断片だけを渡して差し替え、読むときも 1 行だけを引けば、表の全文は文脈に載らない。
//
// 何をするか:
//   upsert: --from の断片（1 要素）を、--key の値が一致する要素と差し替える。一致が無ければ末尾に足す
//   remove: --match に一致する要素を消す
//   get:    --match に一致する要素を 1 件だけ出力する
//   keys:   配列の全要素の鍵を 1 行 1 件で出力する
//   書き換えたら最上位の conformance を消す——照合結果は表の内容に対する記録なので、書き換えた表に残すと
//   照合し直していない表が照合済みに見える（照合スクリプトを通し直すまで未照合として扱わせる）
//
// 配列の指し方（--array）: "." 区切りのキー。配列の中の 1 要素を経由するときは name[field=value] で選ぶ
//   例: operations / feedback_calls.call_sites / cells / components[id=grid].instances
//   選んだ要素が 0 件・複数件なら止める（先勝ちにしない）。value が "]" や '"' を含むなら JSON 文字列で書く（components[id="grid[mobile]"]）
//
// fail-closed: 鍵の欠落・空・型崩れ・既存要素の鍵の重複は書き込まずに止める（鍵が潰れて別の行を上書きしないため）。
// 終了コード: 0 ＝ 成功、1 ＝ get / remove で一致する要素が無い、2 ＝ 使い方の誤り・ファイルや構造の不備。
//
// 決定論的: 乱数・現在時刻に依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

class UsageError extends Error {}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 鍵の材料として使える値か。文字列（空でない）と整数だけを受ける（call_sites の line / column は整数）。
 * @param {unknown} v
 * @returns {boolean}
 */
function keyValue(v) {
  return (typeof v === "string" && v.trim() !== "") || Number.isInteger(v);
}

/**
 * --array の指し方を解析する。
 * @param {string} spec
 * @returns {{ name: string, select: { field: string, value: string } | null }[]}
 */
export function parseArrayPath(spec) {
  /** @type {{ name: string, select: { field: string, value: string } | null }[]} */
  const segments = [];
  // 選ぶ値は裸（"]" と '"' を含まない）か JSON 文字列（"grid[mobile]" のように "]" を含む id 用）
  const re = /^([A-Za-z_][\w-]*)(?:\[([A-Za-z_][\w-]*)=(?:("(?:[^"\\]|\\.)*")|([^\]"]+))\])?/;
  let rest = spec;
  for (;;) {
    const m = re.exec(rest);
    if (!m) throw new UsageError(`--array の形が読めない: ${spec}`);
    /** @type {string | undefined} */
    let value = m[4];
    if (m[3] !== undefined) {
      try {
        value = JSON.parse(m[3]);
      } catch {
        throw new UsageError(`--array の選ぶ値が JSON 文字列として読めない: ${m[3]}`);
      }
    }
    segments.push({
      name: m[1],
      select: m[2] === undefined ? null : { field: m[2], value: /** @type {string} */ (value) },
    });
    rest = rest.slice(m[0].length);
    if (rest === "") break;
    if (!rest.startsWith(".")) throw new UsageError(`--array の形が読めない: ${spec}`);
    rest = rest.slice(1);
  }
  if (segments[segments.length - 1].select !== null) {
    throw new UsageError(`--array の末尾は配列のキーにする（要素の選択で終えない）: ${spec}`);
  }
  return segments;
}

/**
 * 表の中の配列を引く。末尾のキーが無ければ create のときだけ空配列を作る。
 * @param {Record<string, unknown>} table
 * @param {string} spec
 * @param {boolean} create
 * @returns {unknown[]}
 */
export function resolveArray(table, spec, create) {
  const segments = parseArrayPath(spec);
  /** @type {Record<string, unknown>} */
  let node = table;
  for (const [i, seg] of segments.entries()) {
    const last = i === segments.length - 1;
    if (last) {
      if (!Object.hasOwn(node, seg.name)) {
        if (!create) throw new UsageError(`${spec}: ${seg.name} が無い`);
        node[seg.name] = [];
      }
      const arr = node[seg.name];
      if (!Array.isArray(arr)) throw new UsageError(`${spec}: ${seg.name} が配列でない`);
      return arr;
    }
    const child = node[seg.name];
    if (seg.select === null) {
      if (!isPlainObject(child)) throw new UsageError(`${spec}: ${seg.name} がオブジェクトでない`);
      node = child;
      continue;
    }
    if (!Array.isArray(child)) throw new UsageError(`${spec}: ${seg.name} が配列でない`);
    const { field, value } = seg.select;
    const hits = child.filter((e) => isPlainObject(e) && e[field] === value);
    if (hits.length !== 1) {
      throw new UsageError(
        `${spec}: ${seg.name}[${field}=${value}] に一致する要素が ${hits.length} 件（1 件でなければ選ばない）`,
      );
    }
    node = /** @type {Record<string, unknown>} */ (hits[0]);
  }
  throw new UsageError(`--array が空: ${spec}`);
}

/**
 * 要素の鍵を JSON の組で返す（区切り文字の連結は値に区切り文字があると別の鍵に潰れるため）。鍵が読めなければ null。
 * @param {unknown} e
 * @param {string[]} fields
 * @returns {string | null}
 */
function keyOf(e, fields) {
  if (!isPlainObject(e)) return null;
  const values = fields.map((f) => e[f]);
  if (!values.every(keyValue)) return null;
  return JSON.stringify(values);
}

/**
 * 既存の配列の鍵を索引にする。鍵が読めない要素・重複があれば止める。
 * @param {unknown[]} arr
 * @param {string[]} fields
 * @param {string} spec
 * @returns {Map<string, number>}
 */
function indexArray(arr, fields, spec) {
  /** @type {Map<string, number>} */
  const index = new Map();
  for (const [i, e] of arr.entries()) {
    const k = keyOf(e, fields);
    if (k === null) {
      throw new UsageError(
        `${spec}[${i}] の鍵（${fields.join(", ")}）が欠けている・空・型崩れ（表を直してから使う）`,
      );
    }
    if (index.has(k)) {
      throw new UsageError(
        `${spec} に鍵 ${k} の要素が重複している（どちらを差し替えるか決めない）`,
      );
    }
    index.set(k, i);
  }
  return index;
}

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @param {{ readFile?: (p: string) => string, writeFile?: (p: string, s: string) => void, readStdin?: () => string, cwd?: string }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const writeFile =
    deps.writeFile ??
    ((p, s) => {
      // 途中で落ちても表が半分だけ書かれた状態を残さない
      const tmp = `${p}.tmp-${process.pid}`;
      writeFileSync(tmp, s);
      renameSync(tmp, p);
    });
  const readStdin = deps.readStdin ?? (() => readFileSync(0, "utf8"));
  const cwd = deps.cwd ?? process.cwd();
  const usage = [
    "usage: table-upsert.mjs upsert --file <json> --array <path> [--key <field,...>] --from <断片.json | ->",
    "       table-upsert.mjs remove --file <json> --array <path> [--key <field,...>] --match <json>",
    "       table-upsert.mjs get    --file <json> --array <path> [--key <field,...>] --match <json>",
    "       table-upsert.mjs keys   --file <json> --array <path> [--key <field,...>]",
  ].join("\n");
  const [command, ...rest] = argv;
  if (!["upsert", "remove", "get", "keys"].includes(command ?? "")) {
    process.stderr.write(`error: サブコマンドが無い・不明: ${command ?? ""}\n${usage}\n`);
    return 2;
  }
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (!["--file", "--array", "--key", "--from", "--match"].includes(a)) {
      process.stderr.write(`error: 不明な引数 ${a}\n${usage}\n`);
      return 2;
    }
    const v = rest[i + 1];
    // "-" は --from の標準入力の指定なので値として受ける
    if (v === undefined || v === "" || (v.startsWith("--") && v !== "-")) {
      process.stderr.write(`error: ${a} に値が無い\n${usage}\n`);
      return 2;
    }
    opts[a.slice(2)] = v;
    i += 1;
  }
  try {
    if (!opts.file || !opts.array) throw new UsageError("--file と --array が要る");
    if (command === "upsert" && !opts.from) throw new UsageError("upsert には --from が要る");
    if ((command === "remove" || command === "get") && !opts.match) {
      throw new UsageError(`${command} には --match が要る`);
    }
    const fields = (opts.key ?? "id").split(",").map((f) => f.trim());
    if (fields.some((f) => f === "") || new Set(fields).size !== fields.length) {
      throw new UsageError(`--key が空・重複を含む: ${opts.key}`);
    }
    const path = resolve(cwd, opts.file);
    let table;
    try {
      table = JSON.parse(readFile(path));
    } catch (e) {
      throw new UsageError(`表を読めない: ${opts.file}（${e instanceof Error ? e.message : e}）`);
    }
    if (!isPlainObject(table)) throw new UsageError(`表がオブジェクトでない: ${opts.file}`);
    const arr = resolveArray(table, opts.array, command === "upsert");
    const index = indexArray(arr, fields, opts.array);

    if (command === "keys") {
      for (const k of index.keys()) process.stdout.write(`${k}\n`);
      return 0;
    }

    /** @type {Record<string, unknown>} */
    let probe;
    if (command === "upsert") {
      const text = opts.from === "-" ? readStdin() : readFile(resolve(cwd, opts.from));
      try {
        probe = JSON.parse(text);
      } catch (e) {
        throw new UsageError(
          `断片を読めない: ${opts.from}（${e instanceof Error ? e.message : e}）`,
        );
      }
      if (!isPlainObject(probe)) throw new UsageError("断片が 1 要素のオブジェクトでない");
    } else {
      try {
        probe = JSON.parse(opts.match);
      } catch (e) {
        throw new UsageError(`--match を読めない（${e instanceof Error ? e.message : e}）`);
      }
      if (!isPlainObject(probe)) throw new UsageError("--match がオブジェクトでない");
    }
    const key = keyOf(probe, fields);
    if (key === null) {
      throw new UsageError(
        `${command === "upsert" ? "断片" : "--match"} の鍵（${fields.join(", ")}）が欠けている・空・型崩れ`,
      );
    }
    const at = index.get(key);

    if (command === "get") {
      if (at === undefined) {
        process.stderr.write(`error: ${opts.array} に鍵 ${key} の要素が無い\n`);
        return 1;
      }
      process.stdout.write(`${JSON.stringify(arr[at], null, 2)}\n`);
      return 0;
    }

    let action;
    if (command === "remove") {
      if (at === undefined) {
        process.stderr.write(`error: ${opts.array} に鍵 ${key} の要素が無い\n`);
        return 1;
      }
      arr.splice(at, 1);
      action = "removed";
    } else if (at === undefined) {
      arr.push(probe);
      action = "appended";
    } else {
      arr[at] = probe;
      action = "replaced";
    }
    const conformanceRemoved = Object.hasOwn(table, "conformance");
    delete table.conformance;
    writeFile(path, `${JSON.stringify(table, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({ tool: "table-upsert", action, array: opts.array, key, count: arr.length, conformance_removed: conformanceRemoved })}\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : e}\n${usage}\n`);
    return 2;
  }
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
  process.exit(main(process.argv.slice(2)));
}
