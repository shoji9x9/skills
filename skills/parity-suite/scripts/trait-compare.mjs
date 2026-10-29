// 特性照合（原本）。trait-capture.mjs の採取結果 2 つを決定論的に比較する。
// 原本はこのスキル側にあり、実行時はプロジェクトの
// `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う（配布スキルは、実行時に使う成果物を同梱する）。
// コピー先はコピー専用のサブディレクトリで、プロジェクト自作ツールと同居させない（修正しない規約のため）。
//
// 使いどころ:
//   - ノイズ基準値の測定: 現行を同一条件で 2 回採り、その差分量を metadata.json に記録する
//   - 強度チェック: スタイル注入後のキャプチャをベースライン相手に照合し、差分ツールが既知の差を赤にできるか確認する
//   - parity-diff: 現・新の照合に同じ関数/CLI をそのまま再利用する（検証済み差分ツールの引き継ぎ）
//
// 相対幾何の原則: 絶対座標は比較しない。要素対ごとの関係（左右・上下・端揃え）を両側で導出し、
// 関係が変わった対だけを差分にする。位置がページ全体でずれても、要素同士の関係が保たれていれば差分にしない。
//
// 文字の持ち主（text_owners。trait-capture.mjs VERSION 5 以降）: 名前を付けた要素の計算値は、文字を描いている
// 子孫の書体・大きさを持たない。両側の text_owners を**並び順（i 番目どうし）**で突き合わせ、
// 書体・大きさ・行の高さの計算値と、文字の寸法（行の数 lines、幅の合計 advance と高さ glyph_height は
// alignTolerance 付き）の差を kind "text" で出す。外接矩形（rect）は折り返しや間に挟まる子要素で膨らむので比べない。
// DOM の道筋（path）では突き合わせない。入れ子の深さが違う現・新（span に文字を持つ現行と、要素自身が
// 文字を持つ新側）の比較こそが目的だからである。文字列が違う組は寸法を比べない（別の文字の幅は比べられない）が、
// 書体の差は出す。件数の違いは、はみ出した側の行を 1 件ずつ出す。
// 片側だけが text_owners を持つ（採取ツールのバージョン違い）なら kind "missing" で出し、警告なしに比較を省かない。
//
// スクロールする領域（scroll。trait-capture.mjs VERSION 6 以降）では、次の差を kind "scroll" で出す。
// スクロールする領域かどうか（null か否か）、はみ出しの有無、スクロールバーが取った幅・高さ（alignTolerance 付き）、
// 見た目の宣言と ::-webkit-scrollbar 系の計算値である。片側だけがキーを持つ（採取ツールのバージョン違い）なら text_owners と同じく kind "missing"。
//
// 決定論的: 乱数・現在時刻に依存しない。Playwright に依存しない（純粋な JS）。
// TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 利用者のプロジェクトへ 1 ファイルだけコピーして使うので、隣のファイルを import せず、
// `scripts/lib/` の helper（配列とオブジェクトの型ガード、引数の読み取り、CLI の起動の判定）を同じ内容でここに持つ（一致は identical-copies の組で確かめる）。
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
  if (!arg.startsWith("-") || arg === "-") return pushPositional(arg, i, state);
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
    const step = pushPositional(arg, 0, state);
    if ("error" in step) return step.error;
  }
  return undefined;
}

/**
 * 位置引数を足す。上限を超えたら誤りの文を返す。
 * @param {string} arg
 * @param {number} i
 * @param {FlagState} state
 * @returns {{ next: number } | { error: string }}
 */
function pushPositional(arg, i, state) {
  if (state.positionals.length >= (state.spec.positionals ?? 0))
    return { error: `不明な引数: ${arg}` };
  state.positionals.push(arg);
  return { next: i };
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
 * ツールのバージョン（原本）。比較ロジック・差分形状を変えたら上げる。
 * metadata.json の differ.trait_compare に記録する「バージョン」はこの値を使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "4";

/**
 * @typedef {object} Trait
 * @property {string} name
 * @property {Record<string,string> | null} [computed]  - 採取は必ず書く。比較は欠けを空として扱う
 * @property {Record<string,string> | null} [before]
 * @property {Record<string,string> | null} [after]
 * @property {{ x:number, y:number, width:number, height:number } | null} [rect]  - 採取は必ず書く。旧スキーマ・手編集では欠け、比較は欠けを診断にする
 * @property {TextOwner[]} [text_owners]
 * @property {Scroll | null} [scroll]
 */

/**
 * @typedef {object} Scroll
 * @property {boolean} overflowing_x
 * @property {boolean} overflowing_y
 * @property {number} vertical_bar_px
 * @property {number} horizontal_bar_px
 * @property {Record<string,string>} style
 * @property {Record<string, Record<string,string>> | "unsupported"} webkit
 */

/**
 * @typedef {object} TextOwner
 * @property {string} [path]
 * @property {string} [tag]
 * @property {string} text
 * @property {Record<string,string>} style
 * @property {number} [advance]
 * @property {number | null} [glyph_height]
 * @property {number} [lines]
 * @property {{ x:number, y:number, width:number, height:number }} [rect]
 */

/**
 * @typedef {object} Diff
 * @property {string} name  - 要素の論理名。幾何差分は "A | B" の対で表す。
 * @property {'property'|'pseudo'|'geometry'|'missing'|'duplicate'|'text'|'scroll'} kind
 * @property {string} [prop]  - kind "text" は "text[<i>]/<項目>" である（i は text_owners の並び順）。
 *   kind "scroll" は "scroll"（スクロールする領域かどうか）・"scroll/<項目>"・"scroll/<擬似要素>/<プロパティ>" のどれかである。
 * @property {string} [expected]
 * @property {string} [actual]
 * @property {string} [text]  - kind "text" のとき、ベースライン側のその行の文字（どの文字の差かを読むための診断材料）
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
 * @returns {Record<string, string>}
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
 * 1 つの論理名の比較で、差分関数どうしが受け渡す文脈。
 * @typedef {object} DiffContext
 * @property {string} name  - 要素の論理名
 * @property {number} tol  - 寸法を比べるときの許容誤差（alignTolerance）
 * @property {Diff[]} out  - 差分を積む先
 */

/**
 * 2 つの computed style マップを比較して property 差分を積む。
 * @param {{ name: string, kind: 'property'|'pseudo', prefix: string }} target
 *   prefix は pseudo のときの接頭辞（例 "::before/"）。property のときは ""。
 * @param {{ expected: Record<string,string>, actual: Record<string,string> }} maps
 * @param {Diff[]} out
 */
function diffStyleMap({ name, kind, prefix }, { expected: expectedMap, actual: actualMap }, out) {
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
 * 2 つの computed style マップの差分を、property 差分として新しい配列に集める。
 * 呼び出し側が kind と prop を付け替えて積む（text・scroll の差分に使う）。
 * @param {string} name
 * @param {Record<string,string>} expected
 * @param {Record<string,string>} actual
 * @returns {Diff[]}
 */
function styleDiffsOf(name, expected, actual) {
  /** @type {Diff[]} */
  const diffs = [];
  diffStyleMap({ name, kind: "property", prefix: "" }, { expected, actual }, diffs);
  return diffs;
}

/**
 * 擬似要素（::before / ::after）の差分を積む。null（生成コンテンツ無し）の有無も差分にする。
 * @param {DiffContext} ctx
 * @param {string} pseudo - "::before" | "::after"
 * @param {{ expected: Record<string,string>|null|undefined, actual: Record<string,string>|null|undefined }} pair
 */
function diffPseudo({ name, out }, pseudo, { expected, actual }) {
  /** @param {unknown} v */
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
    diffStyleMap({ name, kind: "pseudo", prefix: pseudo + "/" }, { expected, actual }, out);
  }
}

/**
 * 同じ文字列の持ち主の組について、文字の寸法（行の数・幅の合計・高さ）の差を積む。
 * @param {DiffContext} ctx
 * @param {string} prefix - "text[<i>]"
 * @param {{ expected: TextOwner, actual: TextOwner }} pair
 */
function diffTextOwnerSize({ name, tol, out }, prefix, { expected, actual }) {
  // 折り返しの行数が違えば幅の合計・高さは比べても意味が無いので、行数の差だけを出す
  if (expected.lines !== actual.lines) {
    out.push({
      name,
      kind: "text",
      prop: `${prefix}/lines`,
      expected: String(expected.lines),
      actual: String(actual.lines),
      text: expected.text,
    });
    return;
  }
  /** @type {Array<"advance" | "glyph_height">} */
  const sizeKeys = ["advance", "glyph_height"];
  for (const key of sizeKeys) {
    const e = expected[key];
    const a = actual[key];
    if (typeof e !== "number" || typeof a !== "number" || Math.abs(e - a) > tol) {
      out.push({
        name,
        kind: "text",
        prop: `${prefix}/${key}`,
        expected: String(e),
        actual: String(a),
        text: expected.text,
      });
    }
  }
}

/**
 * i 番目の文字の持ち主の組について、kind "text" の差分を積む。片側にしか無ければ在否の差を出す。
 * @param {DiffContext} ctx
 * @param {string} prefix - "text[<i>]"
 * @param {{ expected: TextOwner | undefined, actual: TextOwner | undefined }} pair - 件数が違えば、短い側は undefined
 */
function diffTextOwnerPair(ctx, prefix, { expected, actual }) {
  const { name, out } = ctx;
  // 呼び出し元は長い側の件数まで回すので、片側は必ずある。両側とも無い（null の要素など）なら、比べずに止める。
  const present = expected || actual;
  if (!present) throw new TypeError(`trait compare: ${prefix} の文字の持ち主が両側とも無い`);
  if (!expected || !actual) {
    out.push({
      name,
      kind: "text",
      prop: prefix,
      expected: expected ? "present" : "absent",
      actual: actual ? "present" : "absent",
      text: present.text,
    });
    return;
  }
  for (const d of styleDiffsOf(name, expected.style, actual.style)) {
    out.push({ ...d, kind: "text", prop: `${prefix}/${d.prop}`, text: expected.text });
  }
  if (expected.text !== actual.text) return;
  diffTextOwnerSize(ctx, prefix, { expected, actual });
}

/**
 * 文字の持ち主（text_owners）を i 番目どうしで突き合わせて kind "text" の差分を積む（冒頭の説明を参照）。
 * @param {DiffContext} ctx
 * @param {TextOwner[]} expectedOwners
 * @param {TextOwner[]} actualOwners
 */
function diffTextOwners(ctx, expectedOwners, actualOwners) {
  const count = Math.max(expectedOwners.length, actualOwners.length);
  for (let i = 0; i < count; i += 1) {
    diffTextOwnerPair(ctx, `text[${i}]`, { expected: expectedOwners[i], actual: actualOwners[i] });
  }
}

/**
 * scroll の差を kind "scroll" で 1 件積む。
 * @param {DiffContext} ctx
 * @param {string} prop
 * @param {{ expected: unknown, actual: unknown }} pair
 */
function pushScroll({ name, out }, prop, { expected, actual }) {
  out.push({ name, kind: "scroll", prop, expected: String(expected), actual: String(actual) });
}

/**
 * はみ出しの有無と、スクロールバーが取った幅・高さ（alignTolerance 付き）の差を積む。
 * @param {DiffContext} ctx
 * @param {Scroll} expected
 * @param {Scroll} actual
 */
function diffScrollBars(ctx, expected, actual) {
  /** @type {Array<"overflowing_x" | "overflowing_y">} */
  const overflowKeys = ["overflowing_x", "overflowing_y"];
  for (const key of overflowKeys) {
    if (expected[key] !== actual[key])
      pushScroll(ctx, `scroll/${key}`, { expected: expected[key], actual: actual[key] });
  }
  /** @type {Array<"vertical_bar_px" | "horizontal_bar_px">} */
  const barKeys = ["vertical_bar_px", "horizontal_bar_px"];
  for (const key of barKeys) {
    const e = expected[key];
    const a = actual[key];
    if (typeof e !== "number" || typeof a !== "number" || Math.abs(e - a) > ctx.tol) {
      pushScroll(ctx, `scroll/${key}`, { expected: e, actual: a });
    }
  }
}

/**
 * ::-webkit-scrollbar 系の計算値の差を、擬似要素ごとに積む。
 * @param {DiffContext} ctx
 * @param {Scroll["webkit"]} ew
 * @param {Scroll["webkit"]} aw
 */
function diffScrollWebkit(ctx, ew, aw) {
  if (typeof ew !== "object" || typeof aw !== "object" || !ew || !aw) {
    // 片側だけ（または両側とも）擬似要素を読めない。両側 unsupported は比べられないだけで差ではない
    if (ew !== aw) {
      pushScroll(ctx, "scroll/webkit", {
        expected: typeof ew === "string" ? ew : "present",
        actual: typeof aw === "string" ? aw : "present",
      });
    }
    return;
  }
  for (const pseudo of [...new Set([...Object.keys(ew), ...Object.keys(aw)])].sort()) {
    for (const d of styleDiffsOf(ctx.name, ew[pseudo] || {}, aw[pseudo] || {})) {
      ctx.out.push({ ...d, kind: "scroll", prop: `scroll/${pseudo}/${d.prop}` });
    }
  }
}

/**
 * スクロールする領域の特性（scroll）の差を kind "scroll" で積む（冒頭の説明を参照）。
 * @param {DiffContext} ctx
 * @param {Scroll | null} expected
 * @param {Scroll | null} actual
 */
function diffScroll(ctx, expected, actual) {
  if (!expected || !actual) {
    if (Boolean(expected) !== Boolean(actual)) {
      pushScroll(ctx, "scroll", {
        expected: expected ? "present" : "absent",
        actual: actual ? "present" : "absent",
      });
    }
    return;
  }
  diffScrollBars(ctx, expected, actual);
  for (const d of styleDiffsOf(ctx.name, expected.style, actual.style))
    ctx.out.push({ ...d, kind: "scroll", prop: `scroll/${d.prop}` });
  diffScrollWebkit(ctx, expected.webkit, actual.webkit);
}

/**
 * 論理名の重複を、baseline と capture のそれぞれについて kind "duplicate" で積む。
 * 論理名の重複は authoring ミス（Map が後勝ちで潰れ、先勝ち分の退行が隠れる）。
 * 警告なしに比較を続けず、診断として差分に出す。
 * @param {Trait[]} baselineEntries
 * @param {Trait[]} captureEntries
 * @param {Diff[]} out
 */
function pushDuplicates(baselineEntries, captureEntries, out) {
  /** @type {Array<[string, Trait[]]>} */
  const sides = [
    ["baseline", baselineEntries],
    ["capture", captureEntries],
  ];
  for (const [label, entries] of sides) {
    const counts = new Map();
    for (const e of entries) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    for (const [name, count] of counts) {
      if (count > 1) {
        out.push({ name, kind: "duplicate", prop: label, expected: "1", actual: String(count) });
      }
    }
  }
}

/**
 * 片側だけがキーを持つ（採取ツールのバージョン違い）ことを kind "missing" で積む。
 * @param {{ name: string, out: Diff[] }} ctx
 * @param {string} prop
 * @param {{ expected: boolean, actual: boolean }} has
 */
function pushOneSided({ name, out }, prop, { expected, actual }) {
  out.push({
    name,
    kind: "missing",
    prop,
    expected: expected ? "present" : "absent",
    actual: actual ? "present" : "absent",
  });
}

/**
 * 両側にある 1 つの論理名について、text_owners を照合する。片側だけが持つなら kind "missing" で出す。
 * @param {DiffContext} ctx
 * @param {Trait} base
 * @param {Trait} cap
 */
function diffEntryTextOwners(ctx, base, cap) {
  const baseOwners = base.text_owners;
  const capOwners = cap.text_owners;
  const baseHas = isArray(baseOwners);
  const capHas = isArray(capOwners);
  if (baseHas && capHas) {
    diffTextOwners(ctx, baseOwners, capOwners);
  } else if (baseHas !== capHas) {
    pushOneSided(ctx, "text_owners", { expected: baseHas, actual: capHas });
  }
}

/**
 * 両側にある 1 つの論理名について、scroll を照合する。片側だけがキーを持つなら kind "missing" で出す。
 * @param {DiffContext} ctx
 * @param {Trait} base
 * @param {Trait} cap
 */
function diffEntryScroll(ctx, base, cap) {
  // scroll は null（スクロールする領域でない）を正規の値に持つので、キーの在否でバージョン違いを見る
  const baseHasScroll = Object.hasOwn(base, "scroll");
  const capHasScroll = Object.hasOwn(cap, "scroll");
  if (baseHasScroll && capHasScroll) {
    diffScroll(ctx, base.scroll ?? null, cap.scroll ?? null);
  } else if (baseHasScroll !== capHasScroll) {
    pushOneSided(ctx, "scroll", { expected: baseHasScroll, actual: capHasScroll });
  }
}

/**
 * 両側にある 1 つの論理名について、プロパティ・擬似要素・文字の持ち主・スクロールする領域の差を積む。
 * @param {DiffContext} ctx
 * @param {Trait} base
 * @param {Trait} cap
 */
function diffEntry(ctx, base, cap) {
  const { name, out } = ctx;
  diffStyleMap(
    { name, kind: "property", prefix: "" },
    { expected: base.computed || {}, actual: cap.computed || {} },
    out,
  );
  diffPseudo(ctx, "::before", { expected: base.before, actual: cap.before });
  diffPseudo(ctx, "::after", { expected: base.after, actual: cap.after });
  diffEntryTextOwners(ctx, base, cap);
  diffEntryScroll(ctx, base, cap);
}

/**
 * 両側に存在し rect を持つ要素を、baseline の並び順で集める。
 * rect を欠くエントリ（旧スキーマ・手編集）はクラッシュさせず診断を出して幾何比較から除く。
 * @param {Trait[]} baselineEntries
 * @param {Map<string, Trait>} capByName
 * @param {Diff[]} out
 * @returns {{ name: string, baseRect: NonNullable<Trait["rect"]>, capRect: NonNullable<Trait["rect"]> }[]}
 */
function sharedRects(baselineEntries, capByName, out) {
  const shared = [];
  const seen = new Set();
  for (const e of baselineEntries) {
    if (seen.has(e.name) || !capByName.has(e.name)) continue;
    seen.add(e.name);
    const baseRect = e.rect;
    const capRect = capByName.get(e.name)?.rect;
    if (!baseRect || !capRect) {
      pushOneSided({ name: e.name, out }, "rect", {
        expected: Boolean(baseRect),
        actual: Boolean(capRect),
      });
      continue;
    }
    shared.push({ name: e.name, baseRect, capRect });
  }
  return shared;
}

/**
 * 要素対の関係が変わったものだけを kind "geometry" で積む。
 * @param {{ name: string, baseRect: NonNullable<Trait["rect"]>, capRect: NonNullable<Trait["rect"]> }[]} shared
 * @param {number} tol
 * @param {Diff[]} out
 */
function diffGeometry(shared, tol, out) {
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

  // 0. 論理名の重複を診断として出す。
  pushDuplicates(baselineEntries, captureEntries, out);

  // 1. プロパティ・擬似要素の差分（baseline の並び順で走査 = 決定論的）。
  for (const base of baselineEntries) {
    const cap = capByName.get(base.name);
    if (!cap) {
      out.push({ name: base.name, kind: "missing", expected: "present", actual: "absent" });
      continue;
    }
    diffEntry({ name: base.name, tol, out }, base, cap);
  }

  // 2. capture 側にしか無い要素（余分）も欠落として拾う。
  for (const cap of captureEntries) {
    if (!baseByName.has(cap.name)) {
      out.push({ name: cap.name, kind: "missing", expected: "absent", actual: "present" });
    }
  }

  // 3. 相対幾何: 両側に存在し rect を持つ要素対の関係が変わったものだけを差分にする。
  diffGeometry(sharedRects(baselineEntries, capByName, out), tol, out);

  return out;
}

// is-plain-object-js:begin
/**
 * JSON オブジェクト（null と配列を除く）か。配列は typeof で "object" を通るため明示的に弾く。
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !isArray(v);
}
// is-plain-object-js:end

/**
 * @param {unknown} v
 * @returns {v is Record<string, string>}
 */
function isStringRecord(v) {
  return isPlainObject(v) && Object.values(v).every((x) => typeof x === "string");
}

/**
 * @param {unknown} v
 * @returns {v is { x:number, y:number, width:number, height:number }}
 */
function isRect(v) {
  return (
    isPlainObject(v) &&
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    typeof v.width === "number" &&
    typeof v.height === "number"
  );
}

/**
 * 省いてよい欄が、無いか、指定の形か。
 * @param {unknown} v
 * @param {(x: unknown) => boolean} check
 */
const absentOr = (v, check) => v === undefined || check(v);

/**
 * @param {unknown} v
 * @returns {v is TextOwner}
 */
function isTextOwner(v) {
  if (!isPlainObject(v) || typeof v.text !== "string" || !isStringRecord(v.style)) return false;
  /** @param {unknown} x */
  const isString = (x) => typeof x === "string";
  /** @param {unknown} x */
  const isNumber = (x) => typeof x === "number";
  // 文字の高さは、採れなかった値（canvas の fontBoundingBoxAscent を持たないブラウザの NaN）が JSON で null になる。
  // 比較は数でない値を差分として出す（両側とも null でも、比べられないとして差分にする）ので、null も受け付ける。
  // 幅の合計と行の数は、採取が必ず数で記録するので数だけを受け付ける。ただし、文字の高さが NaN のブラウザでは、
  // 行の数が 0 に数えられる（行の判定に高さを使う）。そのため、片側だけがそのブラウザだと、行の数の差が先に出る。
  /** @param {unknown} x */
  const isNumberOrNull = (x) => x === null || typeof x === "number";
  return (
    absentOr(v.path, isString) &&
    absentOr(v.tag, isString) &&
    absentOr(v.advance, isNumber) &&
    absentOr(v.glyph_height, isNumberOrNull) &&
    absentOr(v.lines, isNumber) &&
    absentOr(v.rect, isRect)
  );
}

/**
 * @param {unknown} v
 * @returns {v is Scroll}
 */
function isScroll(v) {
  if (!isPlainObject(v)) return false;
  const { webkit } = v;
  return (
    typeof v.overflowing_x === "boolean" &&
    typeof v.overflowing_y === "boolean" &&
    typeof v.vertical_bar_px === "number" &&
    typeof v.horizontal_bar_px === "number" &&
    isStringRecord(v.style) &&
    (webkit === "unsupported" ||
      (isPlainObject(webkit) && Object.values(webkit).every(isStringRecord)))
  );
}

/**
 * 採取結果の 1 件として compareTraits に渡せるか。比較が読む欄を、Trait の型どおりにすべて確かめる。
 * 比較が欠けを許す欄（computed・before・after・rect・scroll の null や欠け、text_owners の欠け）は、
 * 欠けていてもよい（旧スキーマ・手編集の入力。rect の欠けは比較が差分として報告する）。
 * @param {unknown} v
 * @returns {v is Trait}
 */
function isTrait(v) {
  if (!isPlainObject(v) || typeof v.name !== "string") return false;
  /** @param {(x: unknown) => boolean} check */
  const nullableOr = (check) => (/** @type {unknown} */ x) => x === null || check(x);
  return (
    absentOr(v.computed, nullableOr(isStringRecord)) &&
    absentOr(v.before, nullableOr(isStringRecord)) &&
    absentOr(v.after, nullableOr(isStringRecord)) &&
    absentOr(v.rect, nullableOr(isRect)) &&
    absentOr(v.scroll, nullableOr(isScroll)) &&
    absentOr(v.text_owners, (x) => isArray(x) && x.every(isTextOwner))
  );
}

/**
 * 要素がすべて採取結果の形なら、その配列を返す。形の違う要素があれば、最初の位置を返す（入力を 1 回だけ走査する）。
 * @param {unknown[]} entries
 * @returns {Trait[] | number}
 */
function asTraits(entries) {
  /** @type {Trait[]} */
  const traits = [];
  for (const [i, e] of entries.entries()) {
    if (!isTrait(e)) return i;
    traits.push(e);
  }
  return traits;
}

/**
 * 形の違う要素を、どの入力の何番目かとともに報告する（直す箇所を利用者が探さずに済むように）。
 * @param {"baseline" | "capture"} side
 * @param {number} at
 */
function invalidEntry(side, at) {
  process.stderr.write(
    `error: ${side}[${at}] is not a trait entry ` +
      "(name, computed, before, after, rect, text_owners or scroll does not match the trait schema)\n",
  );
  return 2;
}

const USAGE =
  "usage: node trait-compare.mjs <baseline.json> <capture.json> [--align-tolerance <px>]\n";

/**
 * main の引数を、入力ファイルと --align-tolerance の値に分ける。
 * 引数の誤りと、--align-tolerance が負か数でないときは、stderr へ書いて null を返す。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ files: string[], alignTolerance: number | undefined } | null}
 */
function parseCompareArgs(argv) {
  const parsed = parseFlags(argv, { values: ["--align-tolerance"], positionals: 2 });
  if (parsed.error !== undefined) {
    process.stderr.write(`error: ${parsed.error}\n${USAGE}`);
    return null;
  }
  const raw = parsed.strings["--align-tolerance"];
  const alignTolerance = raw === undefined ? undefined : Number(raw);
  if (alignTolerance !== undefined && (!Number.isFinite(alignTolerance) || alignTolerance < 0)) {
    process.stderr.write("error: --align-tolerance must be a non-negative number\n");
    return null;
  }
  return { files: parsed.positionals, alignTolerance };
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
  const parsed = parseCompareArgs(argv);
  if (parsed === null) return 2;
  const { files, alignTolerance } = parsed;
  if (files.length !== 2) {
    process.stderr.write(USAGE);
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
  if (!isArray(baseline) || !isArray(capture)) {
    process.stderr.write("error: both inputs must be JSON arrays of trait entries\n");
    return 2;
  }
  const baseTraits = asTraits(baseline);
  if (typeof baseTraits === "number") return invalidEntry("baseline", baseTraits);
  const capTraits = asTraits(capture);
  if (typeof capTraits === "number") return invalidEntry("capture", capTraits);
  const diffs = compareTraits(baseTraits, capTraits, { alignTolerance });
  process.stdout.write(JSON.stringify(diffs, null, 2) + "\n");
  return diffs.length > 0 ? 1 : 0;
}

// CLI として起動されたかは、両辺を実パスに解決してから突き合わせて判定する。起動時のパス（process.argv[1]）は
// シンボリックリンクを解決せず、--preserve-symlinks-main では import.meta.url も解決しない。片側だけを解決すると、
// シンボリックリンクから起動したときに main() が呼ばれず、何も出力せずに exit 0 で終わる。
// 1 ファイルだけコピーして使うので import せず、parity-suite スキルの `scripts/lib/cli.mjs` の印の間と同じ関数をここに持つ。
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
  process.exit(main(process.argv.slice(2)));
}
