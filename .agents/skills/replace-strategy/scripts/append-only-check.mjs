// 追記専用（非破壊追記）の成果物が縮んでいないことを、git の履歴と突き合わせて確かめる。
// 判定の規則は、このファイルで定義する。
//
// スキル群は決定を積み上げる成果物を持ち、そこへの書き込みを「非破壊追記」と定めている。
// しかし、追記であることを確かめるツールが無いと、積み上げた文書を丸ごと書き直してもチェックは失敗しない。
// 失われるのは過去の決定（なぜ許容したのか・いつ誰が承認したのか）で、現在の状態しか見ない収束の判定は通ってしまう。
//
// 処理の流れは次のとおりである。
//
// 1. 追記専用の成果物を、機械可読な一覧（assets/append-only-manifest.json）から読む。
//    --exclude <id> で項目を外せる。一覧に無い id と、全項目の除外は exit 2 にする。外した id は出力に必ず出す。
// 2. 一覧のパターンに一致する追跡ファイルを列挙し、比較元の版（デフォルトは HEAD）の内容を git から取得する。
// 3. 比較元に在った「単位」が、現在も全部残っているかを数える（多重度まで見る）。
// 4. 比較元に在ったファイルが消えていれば、失敗にする。
//
// 突き合わせの単位は、一覧の unit で決める。全部を行として比べると、その場の更新が「失われた行」と誤って判定される。
// その場の更新とは、各文書の原本が明示的に求めている更新（版の +1・状態列の 未→済・Issue 列の 未起票→番号・最終更新の日時）である。
// すると、決定を 1 つも捨てていない成果物で、収束が止まる。unit は次の 3 つである。
//
// - lines（デフォルト）: 空白を畳んだ行の多重集合。書き換えずに積み上げるだけの台帳に使う。
//   原本が**移動を定めている**領域は、registry_groups に鍵のグループを挙げて、要素の単位に展開する。
//   例えば設定ファイルの intentional_diffs では、棚卸しで人が pending の文言を keep や may_change へ移す。
//   mutable_blocks（配下を単位から外す）は、その削除を誰も数えなくてよい領域にだけ使う。
// - markdown-structure: 見出し・表の列名・表の行（先頭のセルを鍵にする）・定義の箇条書きの鍵・それ以外の散文の行。
//   セルの値と箇条書きの値はその場で更新してよいが、行・列・節は消せない。
// - json-arrays: arrays に挙げた配列の要素（深い等価で比べる）。version のようなスカラは更新してよいが、
//   積み上げた要素（changes[] や component_diff_exceptions[]）は消せない。
//   要素が同じかを深い等価で決めるので、2 つの要素の間でフィールドを入れ替える書き換えも、縮小として失敗にする
//   （どの例外を誰がいつ承認したかの付け替えに当たる）。
//   key を指定した配列は、鍵で要素を対応づけて、フィールドごとに突き合わせる。デフォルトは「鍵以外は変えない」である。
//   原本が更新を認めている項目だけを、fill_only と transitions で開ける。
//   fill_only は、空から空でない値への変更だけを許す（既に入っている値の差し替えは失敗にする）。
//   transitions は、明示した <変更前>-><変更後> だけを許す（例: unmeasured.entries の blocking->accepted）。
//   markdown-structure の表の行も同じように、鍵（先頭のセル）だけでなく、行 × 列のセルを単位にする。
//   原本がその場の更新を定めている列だけを、mutable_columns で外す（鍵だけを見ると、残りのセルを自由に書き換えられる）。
//   「空欄で追記し、後で人が決定を埋める」列は、fill_only_columns に挙げる（空のセルから空でない値への変更だけを許す）。
//   mutable_columns に置くと、決めた値の書き換えまで通ってしまう。
//   どちらにも置かないと、空欄を埋めるだけの正規の編集が縮小と誤って判定される。
//   同じ鍵の行は、出現した順で区別する（区別しないと、同じ鍵の 2 行の間でセルを入れ替えても単位が変わらない）。
//   json-arrays は、pinned_values で単独の値（スカラーやオブジェクト）も固定できる。
//   単独の値は配列の要素と違って積み上がらないので、多重集合では「消えた」を数えられず、何に書き換えても通っていた。
//   例えば parity の性能の許容幅の下限（performance.floors）は利用者の決定で、採取から導けないので、
//   手で緩めると本物の回帰が許容幅の中に入る。そこで、値を変えてよいのは、同じ commit で履歴の配列（history）に
//   要素を追記し、その最後の要素が変えた後の値を記録しているときだけにする。
//   履歴の既存の要素は、消すことも書き換えることもできない（先頭からの並びが比較元と一致することを求める）。
//
// - jsonc-tree: JSONC（コメントと末尾のカンマを許す JSON。スキルの設定ファイル）を、値の木として読む。
//   単位は、キーがあること（`<key: パス>`）・スカラの値（`パス = 値`。配列の添字は `[]` に畳む）・コメントの本文である。
//   値を消すか書き換えるか、コメントを消すと失敗にする。キー・値・配列の要素・コメントを足すのは通る。
//   配列の添字を畳むのは、lines の行の多重集合と同じく、要素を足しても既にある単位を数え直させないためである。
//   registry_groups・growable_containers・mutable_blocks は lines と同じ意味で、キーパスは最上位からの完全なパスで書く。
//   registry_groups と mutable_blocks の配列の中のコメントは、単位にしない（鍵をまたいで要素を移すと、移動先に置き場所が無い）。
//
// 行の突き合わせは、空白を畳んでから（連続する空白を 1 つにし、前後を除いてから）行う。
// Markdown の表は、フォーマッタが桁を詰め直すので、素の文字列で比べると整形だけで失敗する。
// 空行は比べない（節の間隔は決定ではない）。
//
// 行が単位のときだけ、「フロー形式のコンテナ（key: [a, b]）が育った」ことによる行の書き換えを、縮小に数えない。
// 空のリストとして作られるキーへ最初の要素を足す書き手は、必ずこの形を通る（intentional_diffs.pending・keep・may_change・component_diffs）。
// 棚卸しで pending から keep へ移した文言も、keep の行の書き換えになる。
// 緩めるのは、元の要素がすべて現在の側にも在るときだけで、要素を 1 つでも消せば失敗にする。
// フロー形式のコンテナは、**1 行で閉じているものだけ**を読む。折り返したものは読めたことにせず、行のまま突き合わせる。
// 失敗したときは、「復元せず 1 行に書き直す」と案内する。
// 読めたことにすると、折り返しの中身が空に見えて、追記が縮小と誤って判定されるためである。
//
// 追記の中身が妥当かは見ない。消えていないことだけを数える。
//
// 判定できないときは失敗として扱う（exit 2）。git が使えない・比較元の版を読めない・対象が 0 件・
// 一覧の unit が語彙にない・比較元のツリーに在るのに内容を取り出せないファイルがある、のどれかに当たるときである。
//
// 決定論的に動く（乱数と現在時刻に依存しない）。TypeScript の構文は使わない（型は JSDoc で書く）。

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isArray } from "./lib/is-array.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { errorMessage } from "./lib/errors.mjs";
import { isPlainObject, nonEmptyString } from "./lib/guards.mjs";
import { parseJsonOrThrow } from "./lib/json.mjs";
import { ConfigError, parseJsonc } from "./skill-config/skill-config.mjs";
import * as jsonc from "./skill-config/vendor/jsonc-parser.mjs";

/**
 * ツールのバージョン（このファイルで定義する）。判定のロジックや出力の形を変えたら上げる。
 * @type {string}
 */
export const VERSION = "15";

/** 走査で辿らないディレクトリ名。 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** 突き合わせの単位（一覧の unit）。 */
export const UNITS = ["lines", "markdown-structure", "json-arrays", "jsonc-tree"];

/**
 * 一覧に書くキーパスの形（ルートからの完全なパス）。`-` だけのセグメントは
 * リスト要素へ積むマーカーと同じ綴りなので拒む。名指しすると全リスト要素が同じ鍵を共有し、
 * 兄弟を区別できなくなる。
 */
const KEY_PATH = /^(?!-+(?:\.|$))[A-Za-z0-9_-]+(\.(?!-+(?:\.|$))[A-Za-z0-9_-]+)*$/;

/** mutable_blocks で外したキーを鍵だけの単位へ畳むときの接頭辞（実在の行と衝突しない綴り）。 */
const MUTABLE_BLOCK_PREFIX = "<mutable-block: ";

/** growable_containers の鍵の単位の接頭辞。 */
const GROWABLE_PREFIX = "<container: ";

/** growable_containers の要素の単位の接頭辞。 */
const GROWABLE_ITEM_PREFIX = "<item: ";

/** registry_groups の鍵の単位の接頭辞。 */
const REGISTRY_PREFIX = "<registry: ";

/** registry_groups の要素の単位の接頭辞（グループ内で共通。鍵をまたぐ移動を許すため）。 */
const REGISTRY_ITEM_PREFIX = "<registry-item: ";

/** 使い方の誤り・型崩れ・判定不能（exit 2）。 */
export class UsageError extends Error {}

/**
 * 実パスに解決する（解決できなければ渡された値のまま返す）。
 * git が返すトップレベルはシンボリックリンクを解決した形なので、片側だけ未解決だと prefix が取れない。
 * @param {string} p
 * @returns {string}
 */
function realpathOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * glob を正規表現へ変換する（`**` は複数階層、`*` は 1 階層に一致）。
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  let out = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 1;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    out += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
}

/**
 * パターンのうち先頭の固定部分（最初のワイルドカードより前のディレクトリ）を返す。
 * 走査の起点を絞るために使う（リポジトリ全体を歩かない）。
 * @param {string} pattern
 * @returns {string}
 */
export function literalPrefix(pattern) {
  const star = pattern.indexOf("*");
  const head = star === -1 ? pattern : pattern.slice(0, star);
  const slash = head.lastIndexOf("/");
  return slash === -1 ? "" : head.slice(0, slash);
}

/**
 * 起点の直下を再帰的に列挙し、ルートからの相対パス（POSIX 区切り）を返す。
 * @param {string} root
 * @param {string} startRel
 * @returns {string[]}
 */
function listFiles(root, startRel) {
  const start = startRel === "" ? root : join(root, startRel);
  if (!existsSync(start) || !statSync(start).isDirectory()) return [];
  /** @type {string[]} */
  const out = [];
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(current, entry.name));
        continue;
      }
      if (entry.isFile()) out.push(relative(root, join(current, entry.name)).split(sep).join("/"));
    }
  };
  walk(start);
  return out;
}

/**
 * @typedef {{ id: string, itemKey: string, paths: string[] }} RegistryGroup
 * @typedef {{ path: string, prefixes: string[], lines: string[] }} WrappedContainer
 * @typedef {{ raw: string, trimmed: string, indent: number, structural: boolean }} YamlLine
 * @typedef {{ li: number, raw: string, trimmed: string, key: string, path: string, indent: number }} YamlKeyLine
 * @typedef {{ id: string, indent: number, itemKey: string, current: { body: string[], raw: string[] } | null }} RegistryReader
 * @typedef {{
 *   srcLines: string[],
 *   li: number,
 *   targets: Set<string>,
 *   growableTargets: Set<string>,
 *   registryPaths: Map<string, string>,
 *   registryItemKeys: Map<string, string>,
 *   wrappedOut: WrappedContainer[],
 *   kept: string[],
 *   stack: { indent: number, key: string }[],
 *   excludeIndent: number | null,
 *   scalarIndent: number | null,
 *   registry: RegistryReader | null,
 * }} YamlStripState
 */

/**
 * YAML のキーパス（ドット区切り）で指定したブロック（そのキーの行と配下）を外す。
 *
 * 追記専用の取り決めは「積み上げた決定を消さない」ことである。しかし、同じファイルに
 * **原本が削除を定めている領域**が含まれることがある。例えば設定ファイルの `intentional_diffs.pending` では、
 * 棚卸しで人が `keep` や `may_change` へ文言を移すので、要素が減るのが正規の運用である。
 * 行の多重集合で見ると、この移動は「`item`・`slug`・`added_by`・`added_at` の 4 行が失われた」と誤って判定され、
 * **正しく棚卸しした実行が失敗する**。失敗した後に指示どおり復元すると、記録した保留が消える（データを失う方向へ誘導される）。
 * そこで、一覧の mutable_blocks に挙げたキーパスの**配下**だけを単位から外し、キーの行は鍵だけの単位
 * （`<mutable-block: <パス>>`）に畳む。キーを丸ごと消す破壊は失敗にし、表現の揺れ（`pending: []` ⇄ `pending:`）では失敗にしない。
 * 棚卸しは、要素が増える方向にも減る方向にも動くためである。
 *
 * **外した領域の要素が消えても、検出するものが無い。** `pending-triage-check.mjs` は**現在の** `pending` を母集合にするので、
 * 棚卸しを経ずに丸ごと消された要素は、そもそも対象にならない（`parity-diff` の棚卸しも同じ母集合を読む）。
 * 「別の工程が数える」に任せると、保留の記録を警告なしに消せる状態になる。
 * そのため `intentional_diffs.pending` は、このオプションではなく `registry_groups` で扱う。
 * 鍵をまたぐ移動は通し、どの鍵からも無くなったときだけ失敗にする。
 * `mutable_blocks` を使ってよいのは、**配下の削除を誰も数えなくてよいと原本が定めている**領域だけである。
 *
 * あわせて、`growable_containers` に挙げたキーパスのフロー形式のコンテナを、**要素ごとの単位に展開する**
 * （`keep: ["a", "b"] # c` は、鍵の単位 1 つと要素の単位 2 つになる）。要素を足しても単位が増えるだけなので通り、
 * 要素を消せば単位が失われて失敗する。**緩和を鍵で名指しするのは、ここだけである。**
 * 行の多重集合は、同じ名前の兄弟（`targets[].forbidden_actions` など）を 1 つの鍵に畳む。
 * そのため、鍵を名指しせずに「育った」を判定すると、**兄弟の間で要素を移しただけの編集**（片方を空にして、もう片方へ足す）まで通る。
 * 名指ししたパスは文書の中で一意なので、この取り違えは起きない。
 *
 * **YAML のパーサは持たない**（配布スキルの依存を増やさないため）。インデントでブロックを切るので、意図して見ていないものがある。
 * ブロックスカラー（`|`・`>`）は、本文をキーの行として読まないように配下ごと飛ばす。
 * リスト要素（`- …`）は、配下のキーが親のパスを継がないようにマーカーを積む。
 * アンカー・別名・複数の文書（`---`）・フロー形式の入れ子（`{ a: { b: [] } }`）は解釈しない。
 * 解釈できなかったパスは対象に一致しないので、**チェックは厳しい側（行が単位のまま）として扱われる**。
 * @param {string} text
 * @param {{ blocks: string[], growable?: string[], registryGroups?: RegistryGroup[], wrappedOut?: WrappedContainer[] }} options
 *   `blocks` は単位から外すキーパス。**ルート（文書の先頭）からの完全なパス**で書く。
 *   部分一致や末尾の一致では探さないので、実在の入れ子（例: skills.replace-strategy.intentional_diffs.pending）を書く。
 *   `growable` は要素ごとの単位に展開するキーパス（同じく、ルートからの完全なパス）。
 *   `registryGroups` は鍵をまたぐ移動を許すグループ。
 *   `wrappedOut` は連結しても閉じないフロー形式のコンテナを積む先（診断用。どこに属するかを判定する材料を伴う）。
 * @returns {string} 変換した後の行を、改行で連結したもの。
 */
export function stripYamlBlocks(text, options) {
  const { blocks, growable = [], registryGroups = [], wrappedOut = [] } = options;
  if (blocks.length === 0 && growable.length === 0 && registryGroups.length === 0) return text;
  const st = newYamlStripState(text.split("\n"), { blocks, growable, registryGroups, wrappedOut });
  for (st.li = 0; st.li < st.srcLines.length; st.li += 1) {
    stripYamlLine(st, yamlLine(st.srcLines[st.li]));
  }
  flushRegistryItem(st);
  return st.kept.join("\n");
}

/**
 * stripYamlBlocks の走査の状態を作る。
 * @param {string[]} srcLines
 * @param {{ blocks: string[], growable: string[], registryGroups: RegistryGroup[], wrappedOut: WrappedContainer[] }} options
 * @returns {YamlStripState}
 */
function newYamlStripState(srcLines, options) {
  /** @type {Map<string, string>} キーパス → グループ id */
  const registryPaths = new Map();
  /** @type {Map<string, string>} グループ id → 要素の照合キー */
  const registryItemKeys = new Map();
  for (const group of options.registryGroups) {
    registryItemKeys.set(group.id, group.itemKey);
    for (const path of group.paths) registryPaths.set(path.trim(), group.id);
  }
  return {
    srcLines,
    li: 0,
    // 実在の行と衝突しない形にする（YAML のキーにこの綴りは現れない）。
    targets: new Set(options.blocks.map((b) => b.trim())),
    growableTargets: new Set(options.growable.map((b) => b.trim())),
    registryPaths,
    registryItemKeys,
    wrappedOut: options.wrappedOut,
    kept: [],
    // 現在のキーパス
    stack: [],
    // 除外中のブロックを開いたキー行のインデント
    excludeIndent: null,
    // ブロックスカラーの本文を飛ばす基準インデント
    scalarIndent: null,
    // ブロック形式のレジストリを読み進めている状態。`current` は読みかけの要素の行である。
    // `body` は畳んだ行（照合キーを探す対象）、`raw` は読めなかったときに単位へ戻す元の行である。
    registry: null,
  };
}

/**
 * 1 行を、構造の判定に使う形にする。
 *
 * 空行・コメントは構造に属さないので**ブロックを閉じない**。閉じると、間にコメントを挟んだだけで
 * 除外が切れ、続きの行が単位に戻る（設定ファイルのテンプレートは要素の書き方をコメントで示す）。
 * @param {string} raw
 * @returns {YamlLine}
 */
function yamlLine(raw) {
  const trimmed = raw.trim();
  return {
    raw,
    trimmed,
    indent: raw.length - raw.trimStart().length,
    structural: trimmed !== "" && !trimmed.startsWith("#"),
  };
}

/**
 * リスト要素（`- …`）の行か。
 * @param {string} trimmed
 * @returns {boolean}
 */
function isListItem(trimmed) {
  return trimmed === "-" || trimmed.startsWith("- ");
}

/**
 * 構造の行が、そのインデントで開いたブロックを閉じるか。
 * リスト要素は親キーと同じインデントに置けるので、`- ` で始まる同インデントの行は配下として扱う。
 * @param {YamlLine} line
 * @param {number} blockIndent
 * @returns {boolean}
 */
function closesBlock(line, blockIndent) {
  return line.indent < blockIndent || (line.indent === blockIndent && !isListItem(line.trimmed));
}

/**
 * 1 行を処理する。ブロックスカラーの本文・除外中のブロック・読みかけのレジストリの順に、行を受け取る処理を決める。
 * @param {YamlStripState} st
 * @param {YamlLine} line
 */
function stripYamlLine(st, line) {
  if (skipScalarBody(st, line)) return;
  if (skipExcludedLine(st, line)) return;
  if (collectRegistryLine(st, line)) return;
  if (!line.structural) {
    st.kept.push(line.raw);
    return;
  }
  stripStructuralLine(st, line);
}

/**
 * ブロックスカラーの本文を飛ばす（除外中でなければ、行のまま単位に残す）。本文として扱ったら true を返す。
 * @param {YamlStripState} st
 * @param {YamlLine} line
 * @returns {boolean}
 */
function skipScalarBody(st, line) {
  if (st.scalarIndent === null) return false;
  if (line.structural && line.indent <= st.scalarIndent) {
    st.scalarIndent = null;
    return false;
  }
  if (st.excludeIndent === null) st.kept.push(line.raw);
  return true;
}

/**
 * mutable_blocks で除外中のブロックの配下を飛ばす。配下として扱ったら true を返す。
 * @param {YamlStripState} st
 * @param {YamlLine} line
 * @returns {boolean}
 */
function skipExcludedLine(st, line) {
  if (st.excludeIndent === null) return false;
  // 空行・コメントは**ブロックを閉じないが、単位からも落とさない**。落とすと、外した領域の後ろに続く
  // コメント（次の構造行までは閉じないので配下として扱われる）を警告なしに消せるようになる。
  // 設定ファイルの原本は「既存のキー・値・コメントは変更しない」を要求しているので、コメントは守る側に残す。
  if (!line.structural) {
    st.kept.push(line.raw);
    return true;
  }
  if (!closesBlock(line, st.excludeIndent)) return true;
  st.excludeIndent = null;
  return false;
}

/**
 * ブロック形式のレジストリの配下を読み進める。配下として扱ったら true を返す。
 * @param {YamlStripState} st
 * @param {YamlLine} line
 * @returns {boolean}
 */
function collectRegistryLine(st, line) {
  const registry = st.registry;
  if (registry === null) return false;
  if (!line.structural) {
    st.kept.push(line.raw);
    return true;
  }
  if (closesBlock(line, registry.indent)) {
    flushRegistryItem(st);
    st.registry = null;
    return false;
  }
  if (isListItem(line.trimmed)) {
    flushRegistryItem(st);
    registry.current = {
      body: [line.trimmed === "-" ? "" : line.trimmed.slice(2).trim()],
      raw: [line.raw],
    };
  } else if (registry.current !== null) {
    // 要素の追随行。**照合キーは 1 行目とは限らない**（YAML のキー順は自由）ので、
    // 要素の全行を集めてから探す。追随フィールド（`slug` / `added_by` 等）は
    // 棚卸しの移動先に無いので単位にはしない。
    registry.current.body.push(line.trimmed);
    registry.current.raw.push(line.raw);
  } else {
    // リストではない構造（マッピング等）。解釈できないので**行のまま単位に残す**
    // （捨てると配下を丸ごと消しても通る。他の解釈できない場合と同じく、厳しい側として扱う）。
    st.kept.push(line.raw);
  }
  return true;
}

/**
 * 読みかけの要素を確定して単位へ落とす。
 * @param {YamlStripState} st
 */
function flushRegistryItem(st) {
  const registry = st.registry;
  if (registry === null || registry.current === null) return;
  const { body: lines, raw: rawLines } = registry.current;
  registry.current = null;
  const value = registryKeyValue(lines, registry.itemKey);
  // **1 行に収まっていない値は、読めたことにしない。** 照合キーの値が空（次の行以降へ続くプレーンな複数行のスカラー）、
  // ブロックスカラーの指示子（`|`・`>`）、閉じない引用符のときは、`code.slice(prefix.length)` が本文を取りこぼす。
  // 畳むと本文が単位から消え、**要素を丸ごと消しても、文言を正反対に差し替えても通る**。
  // 実測では、main は exit 1、畳むと exit 0 になり、判定できないのに合格として扱っていた。要素の行は `kept` に戻らないので、行としても残らない。
  // ここだけ緩い側（単位ゼロ）として扱っていたので、他の解釈できない場合と同じく、**集めた行をそのまま単位に戻す**。
  // 厳しい側なので棚卸しの移動は通らなくなるが、`pending` の要素の形の原本は、1 行のスカラの鍵 4 つである。
  if (!isSingleLineScalar(value)) {
    for (const line of rawLines) st.kept.push(line);
    return;
  }
  if (value !== "") st.kept.push(`${REGISTRY_ITEM_PREFIX}${registry.id}> ${unquote(value)}`);
}

/**
 * ブロック形式の要素の行から、照合キーの値を取り出す。
 *
 * **要素の行末コメントは単位にしない**（キーの行のコメントは守るので、扱いが非対称になる）。
 * 要素は鍵をまたいで移動する設計で、移動先（`keep: ["<文言>"]`）には注記の置き場所が無い。
 * 守ると、注記の付いた要素を棚卸ししただけで、縮小と誤って判定される。注記の付いた要素の誤検出が再発し、
 * 指示どおり復元すると保留の記録が消える。注記を消せることと引き換えに、正規の棚卸しを通す。
 * @param {string[]} lines 要素の行（畳んだもの）
 * @param {string} itemKey 照合キー
 * @returns {string} 行末コメントを切った後の値
 */
function registryKeyValue(lines, itemKey) {
  const prefix = `${itemKey}:`;
  for (const line of lines) {
    const { code } = splitTrailingComment(line);
    if (code.startsWith(prefix)) return code.slice(prefix.length).trim();
  }
  // 照合キーが見つからない要素は、素のスカラ（`- <文言>`）として読む。
  return splitTrailingComment(lines[0] ?? "").code;
}

/**
 * 構造の行（空行・コメント以外）を、キーパスに従って単位へ変える。
 * @param {YamlStripState} st
 * @param {YamlLine} line
 */
function stripStructuralLine(st, line) {
  const { raw, trimmed, indent } = line;
  while (st.stack.length > 0 && st.stack[st.stack.length - 1].indent >= indent) st.stack.pop();
  const m = /^([A-Za-z0-9_.-]+):(\s.*|)$/.exec(trimmed);
  // リスト要素（`- …`）は**マーカーを積む**。積まないと、その配下のキーが親のパスを継ぎ、
  // `intentional_diffs:` がリストだった場合の `- name: a` 配下の `pending:` が
  // `intentional_diffs.pending` として外れる（外しすぎ）。`-` はキーに現れないので衝突しない。
  if (isListItem(trimmed)) {
    st.stack.push({ indent, key: "-" });
    st.kept.push(raw);
    return;
  }
  if (m === null) {
    st.kept.push(raw);
    return;
  }
  const key = m[1];
  const path = [...st.stack.map((s) => s.key), key].join(".");
  st.stack.push({ indent, key });
  /** @type {YamlKeyLine} */
  const keyLine = { li: st.li, raw, trimmed, key, path, indent };
  if (st.targets.has(path)) {
    stripMutableBlock(st, keyLine);
    return;
  }
  const registryId = st.registryPaths.get(path);
  if (registryId !== undefined) {
    expandRegistry(st, keyLine, registryId);
    return;
  }
  if (st.growableTargets.has(path) && expandGrowable(st, keyLine)) return;
  // ブロックスカラー指示子は `|2-` / `|-2` のようにインデント指示子とチョップ指示子が任意の順に付く。
  // 取りこぼしても、**外れる側とは判定されない**。本文はスカラのキーの配下にあるので、本文行をキーとして
  // 読んでもパスにそのキー名（`note.` 等）が入り、対象のキーパスとは一致しないため
  // （実測で再現を作れなかったので回帰テストは置いていない。ここは仕様への準拠として直してある）。
  if (/^[|>](?:[-+]?\d*|\d*[-+]?)$/.test(m[2].trim())) st.scalarIndent = indent;
  st.kept.push(raw);
}

/**
 * mutable_blocks に挙げたキーの配下を単位から外す。
 *
 * 配下は外すが、**キーが在り続けること自体は単位に残す**。行ごと外すと、キーを丸ごと消した破壊が
 * 「外した領域」に紛れて通る。ただし行そのものを残すと表現の揺れ（`pending: []` ⇄ `pending:`）で落ちる。
 * 棚卸しは要素が増える方向にも減る方向にも動くので、**鍵だけの単位へ畳む**。
 *
 * 折り返したフロー値は**配下ごと消費する**。閉じ括弧の行は鍵と同じインデントに置けるので
 * インデントによる除外が先に閉じ、1 行へ畳んだだけでその行（`] # c`）の単位が失われる。
 * 外すのは配下の要素なので、要素行の行末注記は単位にしない（独立したコメント行と閉じる行の注記は残す。
 * 除外中の空行・コメント行を単位に残す既存の扱いと揃う）。
 *
 * **値の形で読む対象を絞らない**。`flowValue !== ""` で絞ると、開き括弧が次の行にある形
 * （フォーマッタが畳む形）がブロック形式の側として扱われ、閉じ括弧の行が素の行として単位になる。
 * 形の判定は `readNamedFlow` が一手に持ち、ここは「フロー形式として読めたか（`block` でないか）」だけを見る。
 * @param {YamlStripState} st
 * @param {YamlKeyLine} keyLine
 */
function stripMutableBlock(st, keyLine) {
  st.kept.push(`${MUTABLE_BLOCK_PREFIX}${keyLine.path}>`);
  const { comment } = splitTrailingComment(keyLine.trimmed);
  const flow = readNamedFlow(st.srcLines, keyLine, {
    wrappedOut: st.wrappedOut,
    // **接頭辞は渡さない**。mutable_blocks は配下を単位から外すので、この接頭辞が当たるのは
    // 「鍵を丸ごと消した」ときだけ。当てると破壊に対して「表記を直しても通らない。内容を人が確認して通す」と
    // 案内することになる。折り返しで失われうるのは読みに行った行（`lines`）の方なので、そちらだけで帰属する。
    // **だから mutable_blocks で案内が出るのは、鍵と同じインデントに置いた要素行が失われたときだけ**
    // （除外がそこで閉じて行のまま単位になる。深い要素行は除外されて失われない）。
    // 鍵の行と閉じる行の注記は、独立した単位にするので帰属させず、案内も出さない。配下は単位から外すので、
    // 比較元が読めなくても判定は成り立ち、例に出た注記を戻せば通る（実測: 閉じ忘れ・比較元が閉じていない、
    // のどちらも注記を戻して exit 0。growable では同じ注記が読めない行のまま単位になるので案内が出る）。
    unitPrefixes: [],
    keepItemComments: false,
  });
  if (flow.items !== null && !flow.block) {
    for (const c of flow.comments) st.kept.push(c);
    st.li = flow.last;
    return;
  }
  st.excludeIndent = keyLine.indent;
  // 行末コメントは畳まず単位に残す。一覧の requirement は「既存のキー・値・コメントは変更しない」で、
  // 外すのは配下の**要素**だけ。畳むと、キーの行に付いた注記だけを警告なしに消せるようになる
  // （別行のコメントは守られるので、残さないと同じファイルの中で非対称になる）。
  if (comment !== "") st.kept.push(comment);
}

/**
 * registry_groups に挙げたキーの値を、鍵の単位とグループ共通の要素の単位に展開する。
 * @param {YamlStripState} st
 * @param {YamlKeyLine} keyLine
 * @param {string} registryId
 */
function expandRegistry(st, keyLine, registryId) {
  const { path } = keyLine;
  const { items, comments, last, block } = readNamedFlow(st.srcLines, keyLine, {
    wrappedOut: st.wrappedOut,
    // **要素の接頭辞（`<registry-item: <グループ id>>`）は渡さない**。鍵をまたぐ移動を許すため
    // グループ共通で、鍵を区別できない（`keep` が読めないだけで `pending` の削除にまで案内が付く）。
    // 読めなくなると鍵の単位（`<registry: パス>`）が失われるので、真の陽性はそちらで拾える。
    unitPrefixes: [`${REGISTRY_PREFIX}${path}>`],
    keepItemComments: false,
  });
  // 読めない値・スカラは展開せず行のまま（厳しい側として扱う）。
  if (items === null) {
    st.kept.push(keyLine.raw);
    return;
  }
  st.li = last;
  // 鍵の存在は鍵ごとの単位で守り、要素は**グループ共通の単位**にする。
  // 棚卸しで `pending` の文言が `keep` / `may_change` へ移るのは正規の運用なので鍵をまたいで同じ単位にし、
  // どの鍵にも無くなった（警告なしに消された）ときだけ単位が失われるようにする。
  st.kept.push(`${REGISTRY_PREFIX}${path}>`);
  for (const c of comments) st.kept.push(c);
  const itemKey = st.registryItemKeys.get(registryId) ?? "item";
  for (const item of items) {
    st.kept.push(`${REGISTRY_ITEM_PREFIX}${registryId}> ${registryItemValue(item, itemKey)}`);
  }
  // ブロック形式（`- …`）のときだけ要素の収集へ移る。開き括弧が次の行にあるフロー形式は
  // readNamedFlow が連結して読み切っているので、ここで収集に入ると同じ要素を二重に数える。
  if (block) st.registry = { id: registryId, indent: keyLine.indent, itemKey, current: null };
}

/**
 * growable_containers に挙げたキーのフロー形式のコンテナを、鍵の単位と要素の単位に展開する。
 * 値がフロー形式でない（ブロック形式・スカラ）ときは展開せず false を返す（呼び出し側が行のまま残す）。
 * @param {YamlStripState} st
 * @param {YamlKeyLine} keyLine
 * @returns {boolean}
 */
function expandGrowable(st, keyLine) {
  const { path } = keyLine;
  const { items, comments, last } = readNamedFlow(st.srcLines, keyLine, {
    wrappedOut: st.wrappedOut,
    // 育つコンテナは行末コメントの削除も落とす要求なので、要素行の注記も単位に残す。
    unitPrefixes: [`${GROWABLE_PREFIX}${path}>`, `${GROWABLE_ITEM_PREFIX}${path}>`],
    keepItemComments: true,
  });
  if (items === null) return false;
  st.li = last;
  // 鍵（＋行末コメント）と要素を別々の単位にする。要素を足すと単位が増えるだけで通り、
  // 落とすと単位が失われて落ちる。
  st.kept.push(`${GROWABLE_PREFIX}${path}>`);
  // 行末コメントは**鍵の単位に連結せず独立した単位にする**。連結すると、同じ注記を上の行へ
  // 出しただけの編集が「単位の消失」になり、mutable_blocks 側（独立した単位）と非対称になる。
  for (const c of comments) st.kept.push(c);
  for (const item of items) st.kept.push(`${GROWABLE_ITEM_PREFIX}${path}> ${item}`);
  return true;
}

/**
 * 次の構造行（空行・コメント行を飛ばした最初の行）を返す。無ければ空文字。
 *
 * 開き括弧が次の行にある形の判定に使う。**1 行だけ見ると、鍵と `[` の間に空行・コメント行が
 * 1 行入っただけでブロック形式と判定され、フロー表記の誤検出が案内も出ないまま残る**
 * （`joinWrappedFlow` は途中の空行・コメント行をまたぐので、そちらとも非対称になる）。
 * @param {string[]} lines
 * @param {number} li 鍵の行の添字
 * @returns {string}
 */
function nextStructuralLine(lines, li) {
  for (let i = li + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) return trimmed;
  }
  return "";
}

/**
 * 折り返されたフロー形式のコンテナを、続きの行を連結して 1 つの値として読む。
 *
 * **連結するのは名指しした鍵（`growable_containers` / `registry_groups`）の値だけ。**
 * 折り返しを読めないままにすると、比較元の折り返した行がそのまま単位になる。
 * すると、要素を足した編集も 1 行に畳んだ編集も「行が失われた」と誤って判定される（旧版と修正版の両方で実測した）。
 * 自由度を広げるのは、この 1 つの軸（**名指しした鍵の値が何行に渡るか**）に限る。
 * 鍵のブロックを抜けても閉じなければ、今までどおり読めなかったことにする（判定できないときは失敗として扱う）。
 * 途中の空行・コメント行も**同じ軸の内側**なので連結を続ける。ここで打ち切ると、
 * 比較元の折り返し行がそのまま単位になり、**案内どおり 1 行へ書き直しても落ちる**
 * （実測: 追記で lost=1、1 行へ書き直して lost=3）。実行できない指示を出す側として扱わない。
 * @param {string[]} lines 文書の全行。
 * @param {{ start: number, head: string, keyIndent: number }} key `start` は鍵の行の添字、
 *   `head` は鍵の行（行末コメントを切った後）、`keyIndent` は鍵の行のインデント。
 * @param {string[]} scannedOut 読みに行った行（正規化済み）を積む先。読めなかったときに、どこに属するかの判定に使う。
 * @returns {{ items: string[], comments: string[], lineComments: string[], closing: string[], last: number } | "trailing" | null}
 *   `null` は、閉じないまま兄弟の構造へ出たか、文書が終わったことを表す。
 *   `"trailing"` は、閉じた後に余りがあることを表す（案内の文面が変わるので区別する）。
 *   `items` は連結して読めた要素、`comments` は要素の行の**行末**の注記、`lineComments` は独立したコメントの行である。
 *   `closing` は閉じる行の注記（＝鍵の注記）、`last` は消費した最後の行の添字である。
 */
function joinWrappedFlow(lines, key, scannedOut) {
  let joined = key.head;
  /** @type {string[]} 要素行に付いていた**行末**の注記（registry では単位にしない）。 */
  const comments = [];
  /** @type {string[]} 独立したコメント行（**常に単位にする**。消えたら落とす）。 */
  const lineComments = [];
  for (let i = key.start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    // 空行は値の途中に書ける（単位にはならない）。コメント行は単位として残す。
    if (trimmed === "") continue;
    if (trimmed.startsWith("#")) {
      // **帰属材料には入れない**。連結が失敗したときは閉じ括弧が無いので、この注記がコンテナの
      // 内にあったのか外（次の構造行の手前）にあったのかを区別できない。入れると、外の注記を
      // 消しただけで「復元せず閉じ括弧を補う」が付く（閉じ直しても消した注記は戻らないので行き止まりの指示）。
      lineComments.push(trimmed);
      continue;
    }
    // 鍵のブロックを抜けた＝**兄弟の構造**（新しい鍵・リスト要素）が同じか浅いインデントに現れた。
    // インデントだけでは打ち切らない。フロー形式の要素は鍵と同じインデントに置かれることがあり、それを読むパーサがある
    // （`a:\n  keep: [\n  "x"\n  ]` は js-yaml 4 で `{"a":{"keep":["x"]}}`。js-yaml 5 は字下げの不足として拒む）。打ち切るとフロー表記の誤検出が
    // そのまま残るうえ、打ち切らせた行は帰属材料に入らないので案内すら出ない。
    // **打ち切らせた行は `scannedOut` に入れない**。コンテナの外にある兄弟の構造行なので、
    // 帰属材料に混ぜるとその行を消しただけで「復元せず閉じ括弧を補う」が付く（無関係な鍵の正規の削除に当たる）。
    const sibling =
      /^[A-Za-z0-9_.-]+:(\s|$)/.test(trimmed) || trimmed === "-" || trimmed.startsWith("- ");
    if (indent <= key.keyIndent && sibling) return null;
    scannedOut.push(normalizeLine(trimmed));
    const split = splitTrailingComment(trimmed);
    joined = `${joined} ${split.code}`;
    const flow = scanFlow(joined.slice(joined.indexOf(":") + 1).trim());
    // 読めた要素はここで返す。呼び出し側で連結した後の文字列をもう一度取り出して読み直すと、値の切り出し方が
    // 2 箇所に分かれて片方だけ直る余地が残るので、読み方はこの 1 箇所に閉じる。
    // **閉じる行の注記は鍵の注記**（1 行で書けば鍵の行末に来る）なので、要素行の注記と分けて返す。
    if (flow.items !== null) {
      return {
        items: flow.items,
        comments,
        lineComments,
        closing: split.comment === "" ? [] : [split.comment],
        last: i,
      };
    }
    if (split.comment !== "") comments.push(split.comment);
    // 閉じた後に余りがある（`[a] b`）。**閉じてはいる**ので「閉じていない」とは案内しない。
    if (flow.reason !== "unclosed") return "trailing";
  }
  return null;
}

/**
 * 名指しした鍵の値をフロー形式のコンテナとして読む。読めなければ `items` が `null`
 * （呼び出し側は行のまま単位に残す）。
 *
 * 連結しても閉じないコンテナは `wrappedOut` へ積む。行のまま突き合わせると、要素を足した編集が
 * **直前の要素の行に付くカンマ**の書き換えとして縮小に見えるので、落ちたときに「復元せず閉じ括弧を補う」と
 * 案内するための材料。**帰属できる単位（読みに行った行と、このコンテナの要素が作る単位の接頭辞）まで
 * 一緒に積む**。ファイル単位で案内を出すと、同じファイルの**無関係な鍵**で起きた正規の削除にまで
 * 「復元せず閉じ括弧を補う」が付き、記録した決定を消させないというツールの目的と逆向きの指示になる。
 * @param {string[]} lines 文書の全行。
 * @param {YamlKeyLine} keyLine 鍵の行（添字・前後の空白を除いた行・鍵・鍵パス・インデント）
 * @param {{ wrappedOut: WrappedContainer[], unitPrefixes: string[], keepItemComments: boolean }} options
 *   `unitPrefixes` = このコンテナの要素が作る単位の接頭辞（帰属判定に使う）。
 *   `keepItemComments` = 折り返した要素行の行末コメントを単位にするか（鍵の行の注記は常に単位にする）。
 * @returns {{ items: string[] | null, comments: string[], last: number, block: boolean }}
 *   `block` = 鍵の行に値が無く、フロー形式でもない（ブロック形式として読む）
 */
function readNamedFlow(lines, keyLine, options) {
  const { li, trimmed, key, path, indent: keyIndent } = keyLine;
  const first = splitTrailingComment(trimmed);
  const comments = first.comment === "" ? [] : [first.comment];
  const value = first.code.slice(key.length + 1).trim();
  // 鍵の行に値が無い形は 2 つある。**開き括弧が次の行にあるフロー形式**（YAML のフォーマッタは
  // 1 行に収まらないコンテナをこの形へ畳む）と、ブロック形式（`- …`）。前者をブロック形式として
  // 扱うと中身が行のまま単位になり、要素を足しただけの編集が縮小と誤って判定されるうえ、 `wrappedOut` にも
  // 積まれないので「復元せず閉じ括弧を補う」案内すら出ない（フロー表記の誤検出と同じ害が残る）。
  const openedNext = value === "" && /^[[{]/.test(nextStructuralLine(lines, li));
  if (value === "" && !openedNext) return { items: [], comments, last: li, block: true };
  const flow = value === "" ? { items: null, reason: "unclosed" } : scanFlow(value);
  if (flow.reason !== "unclosed") return { items: flow.items, comments, last: li, block: false };
  /** @type {string[]} 読みに行った行（鍵の行を含む）。読めなかったときの帰属判定に使う。 */
  const scanned = [normalizeLine(trimmed)];
  const joined = joinWrappedFlow(lines, { start: li, head: first.code, keyIndent }, scanned);
  if (joined === null || joined === "trailing") {
    // 「閉じていないので 1 行で閉じる」と案内できるのは**閉じていない**ときだけ。
    // `trailing` は閉じた後に余りがある形で、1 行へ畳んでも同じく読めないので、その案内は指示にならない。
    if (joined === null) {
      options.wrappedOut.push({ path, prefixes: options.unitPrefixes, lines: scanned });
    }
    return { items: null, comments, last: li, block: false };
  }
  return {
    items: joined.items,
    // 要素行の注記を単位にするかは成果物の要求で分かれる。**registry は単位にしない**。
    // `flushRegistryItem` がブロック形式で同じ判断をしており（移動先に置き場所が無く、注記の付いた要素の誤検出になる）、
    // フロー形式だけが守ると、正規の棚卸し（pending の文言を keep へ移す）が表記を変えただけで落ちる。
    // 独立したコメント行（`joined.lineComments`）は**どちらの成果物でも単位にする**。
    // 要素に付いた注記と違って移動先の問題が無く、単位から外すと、折り返したコンテナの中の注記だけを
    // 警告なしに消せるようになる（main では失敗にしていた形を通してしまう）。
    comments: options.keepItemComments
      ? [...comments, ...joined.lineComments, ...joined.comments, ...joined.closing]
      : [...comments, ...joined.lineComments, ...joined.closing],
    last: joined.last,
    block: false,
  };
}

/**
 * 行を突き合わせ用に正規化する（空白を畳む。空行は落とす）。
 * @param {string} text
 * @param {{ mutableBlocks?: string[], growableContainers?: string[], registryGroups?: RegistryGroup[], wrappedOut?: WrappedContainer[] }} [options]
 *   `mutableBlocks` は単位から外す YAML のキーパス（上の stripYamlBlocks を参照）。
 *   `growableContainers` は要素ごとの単位へ展開する YAML のキーパス（同上）。`registryGroups` も同上。
 *   `wrappedOut` は連結しても閉じないフロー形式のコンテナを積む先（診断用。どこに属するかを判定する材料を伴う）。
 * @returns {Map<string, number>} 正規化した行 → 出現回数
 */
export function normalizeLines(text, options = {}) {
  const {
    mutableBlocks = [],
    growableContainers = [],
    registryGroups = [],
    wrappedOut = [],
  } = options;
  const src =
    mutableBlocks.length === 0 && growableContainers.length === 0 && registryGroups.length === 0
      ? text
      : stripYamlBlocks(text, {
          blocks: mutableBlocks,
          growable: growableContainers,
          registryGroups,
          wrappedOut,
        });
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "") continue;
    addUnit(counts, line);
  }
  return counts;
}

/**
 * フロー形式のコンテナ（`[a, "b"]` / `{}`）の要素を取り出す。
 *
 * 入れ子・引用符を数えるだけの簡易スキャナで、YAML の全機能（アンカー・別名・複数行）は解釈しない。
 * **読み切れなければ `null`**（判定不能）を返し、呼び出し側は厳しい側＝縮小として扱う。
 * 閉じ括弧まで揃っているかを見るのは**この関数の責務**なので、呼び出し側に事前条件は無い。
 * 任意の文字列を渡してよく、フロー形式として読めなければ `null` が返る
 * （「閉じていることを確かめてから渡す」と読める書き方にすると、`null` 判定を握り潰す実装を誘う）。
 * @param {string} raw 任意の文字列（`[` / `{` で始まり同じ行で閉じていなければ `null`）
 * @returns {string[] | null}
 */
export function flowItems(raw) {
  return scanFlow(raw).items;
}

/**
 * フロー形式のコンテナを読む（`flowItems` と、折り返しの検出に共通する処理）。
 *
 * **閉じ括弧の位置まで見る。** 以前は `raw.slice(1, -1)` で、末尾の 1 文字を閉じ括弧と決め打ちしていた。
 * 1 行に収まっていないコンテナ（フォーマッタや長い値で折り返されたもの）を、「読めた」ことにしていた。
 * `[` は空コンテナ（`[]`）、`[ "a",` は要素 1 件の完全な読みとして返り、
 * 要素を足しただけの編集が縮小と誤って判定された。読めない形は `null` を返し、呼び出し側は行のまま突き合わせる。
 * @param {string} raw
 * @returns {{ items: string[] | null, reason: null | "not-flow" | "unclosed" | "trailing" }}
 *   `unclosed` = 同じ行で閉じていない（折り返されたコンテナ）、`trailing` = 閉じた後に余りがある
 */
function scanFlow(raw) {
  const text = raw.trim();
  const open = text[0];
  if (open !== "[" && open !== "{") return { items: null, reason: "not-flow" };
  const close = open === "[" ? "]" : "}";
  /** @type {FlowScan} */
  const scan = { items: [], depth: 0, quote: null, cur: "" };
  let closedAt = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (!scanFlowChar(scan, text[i])) continue;
    // 外側が閉じた。開き括弧と種類が合わない閉じ方（`[a}`）は読めたことにしない。
    if (text[i] !== close) return { items: null, reason: "unclosed" };
    closedAt = i;
    break;
  }
  // 引用符・括弧が同じ行で閉じていない（折り返されたコンテナ）。読めたことにしない。
  if (scan.quote !== null || closedAt === -1) return { items: null, reason: "unclosed" };
  // 閉じた後に余りがある（`[a] b`）。1 行に収まったコンテナとしては読めない。
  if (closedAt !== text.length - 1) return { items: null, reason: "trailing" };
  scan.items.push(scan.cur);
  return { items: scan.items.map(flowItemText).filter((x) => x !== ""), reason: null };
}

/**
 * @typedef {{ items: string[], depth: number, quote: string | null, cur: string }} FlowScan
 */

/**
 * フロー形式のコンテナを 1 文字進める。外側の括弧が閉じたら true を返す。
 * @param {FlowScan} scan
 * @param {string} ch
 * @returns {boolean}
 */
function scanFlowChar(scan, ch) {
  if (scan.quote !== null) {
    scan.cur += ch;
    if (ch === scan.quote) scan.quote = null;
    return false;
  }
  // 引用符は**値の開始**でだけ開く。`opensQuoteAt` と同じ判定を同じ実装（`opensQuoteAfter`）で行う。
  // 「要素の先頭」に狭めると、マッピングの値（`{item: "…"}`）では、直前の `item:` があるので引用符が開かない。
  // すると値の中のカンマがペアの区切りと誤って判定される（`registryItemValue` が単位を `"順序は id` のような断片へ畳み、
  // 棚卸しが失敗し、文言の差し替えが警告なしに通る）。`don't` のアポストロフィは値の途中なので今までどおり値の一部。
  if ((ch === '"' || ch === "'") && opensQuoteAfter(scan.cur)) {
    scan.quote = ch;
    scan.cur += ch;
    return false;
  }
  if (ch === "[" || ch === "{") {
    scan.depth += 1;
    // 外側の開き括弧は要素のテキストに入れない（入れ子の括弧は要素の一部なので入れる）。
    if (scan.depth > 1) scan.cur += ch;
    return false;
  }
  if (ch === "]" || ch === "}") {
    scan.depth -= 1;
    if (scan.depth > 0) {
      scan.cur += ch;
      return false;
    }
    return true;
  }
  if (ch === "," && scan.depth === 1) {
    scan.items.push(scan.cur);
    scan.cur = "";
    return false;
  }
  scan.cur += ch;
  return false;
}

/**
 * フロー形式のコンテナの要素を、単位にするテキストへ整える。
 * @param {string} v
 * @returns {string}
 */
function flowItemText(v) {
  const t = v.trim();
  const quoted =
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")));
  if (quoted) return t.slice(1, -1);
  // 入れ子のコンテナは**正規形へ組み直す**。要素自身が折り返されると末尾カンマや余分な空白が
  // 残り、内容を 1 文字も変えていない整形だけで別の単位になる（コンテナは閉じているので
  // 案内も出ず、書き手は「復元」へ向かう。フロー表記の誤検出で避けたかった向き）。
  const nested = scanFlow(t);
  if (nested.items === null) return t;
  return t[0] === "[" ? `[${nested.items.join(", ")}]` : `{${nested.items.join(", ")}}`;
}

/**
 * フロー形式の登録要素から照合キーの値を取り出す。
 *
 * ブロック形式は flushRegistryItem が `item_key:` の行を探すが、フロー形式
 * （`pending: [{item: <文言>, slug: …}]`）は 1 要素が 1 つの文字列として返るので、同じ抜き出しをここで行う。
 * 行わないと、マッピングの全文が単位になり、追随フィールド（`slug`・`added_by`・`added_at`）ごと突き合わせることになる。
 * すると、棚卸しで鍵をまたいで移した要素（移動先に追随フィールドは無い）が、「失われた」と誤って判定される。
 * ブロック形式で通る棚卸しが表記を変えただけで落ちる非対称が残り、注記の付いた要素の誤検出がフロー表記のまま生き残る。
 * @param {string} raw 要素のテキスト（flowItems が引用符を剥がした後）
 * @param {string} itemKey 照合キー
 * @returns {string} 単位にする値
 */
function registryItemValue(raw, itemKey) {
  const t = raw.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return unquote(t);
  const pairs = flowItems(t);
  // 読めないマッピング・照合キーの無いマッピングは**全文を単位に残す**（他の解釈できない場合と同じく、厳しい側として扱う。
  // 鍵をまたぐ移動は追随フィールドまで一致したときだけ通る）。
  if (pairs === null) return t;
  for (const pair of pairs) {
    const sep = pair.indexOf(":");
    if (sep === -1) continue;
    if (unquote(pair.slice(0, sep)) !== itemKey) continue;
    return unquote(pair.slice(sep + 1));
  }
  return t;
}

/**
 * その値が**1 行に収まったスカラ**かを見る（`kept` へ畳んでよいか）。
 *
 * YAML のパーサを持たないので、1 行を超える値は読めない。読めない値を畳むと本文が単位から消えるため、
 * この判定が false のものは、畳まずに行のまま残す（厳しい側として扱う）。
 * @param {string} value 行末コメントを切った後の値
 * @returns {boolean}
 */
function isSingleLineScalar(value) {
  // 空 = 値が次行以降へ続くプレーンな多行スカラー。`|` / `>` = ブロックスカラー（本文は次行以降）。
  if (value === "" || value.startsWith("|") || value.startsWith(">")) return false;
  const quote = value[0];
  // 閉じない引用符も 1 行に収まっていない（`flowItems` が未終端を読めたことにしないのと同じ規則）。
  if (quote === '"' || quote === "'") return value.length >= 2 && value.endsWith(quote);
  return true;
}

/**
 * スカラの引用符を剥がす（フロー形式の要素と同じ規則）。
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  const t = value.trim();
  const quoted =
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")));
  return quoted ? t.slice(1, -1) : t;
}

/**
 * 行末コメント（YAML の ` # …`）を切り離す。引用符の中の `#` はコメントにしない。
 * @param {string} line 正規化済みの 1 行
 * @returns {{ code: string, comment: string }}
 */
export function splitTrailingComment(line) {
  /** @type {string | null} */
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if ((ch === '"' || ch === "'") && opensQuoteAt(line, i)) {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || line[i - 1] === " ")) {
      return { code: line.slice(0, i).trimEnd(), comment: line.slice(i).trim() };
    }
  }
  return { code: line, comment: "" };
}

/**
 * その位置の引用符が**値の開始**かを見る（YAML のプレーンスカラーでは引用符は特別扱いされない）。
 *
 * 位置に関わらず開き引用符として扱うと、`keep: [don't rename] # …` のアポストロフィで行末まで閉じず、
 * コメントも値も読めないまま、緩和が警告なしに外れる。逆に「閉じなければ引用符を無視して読み直す」形にすると、
 * **同じ値でも、同じ行の別の要素によってモードが変わり**、比較元と現在で読み方が割れる。
 * 例えば `["a, b"]` は 1 要素、`["a, b", don't]` は 3 要素に割れるので、要素を足しただけで縮小に見える。
 * そこで直前の非空白文字で判定する。値の開始（行頭・`:`・`,`・`[`・`{` の直後）だけを開き引用符にする。
 * @param {string} line
 * @param {number} i
 * @returns {boolean}
 */
function opensQuoteAt(line, i) {
  return opensQuoteAfter(line.slice(0, i));
}

/**
 * 直前までのテキストを見て、次に来る引用符が**値の開始**かを判定する（`opensQuoteAt` と `flowItems` に共通する判定）。
 *
 * 2 箇所で同じ規則だと書きながら別々に実装していたために、片方（`flowItems`）だけが「要素の先頭」に狭まり、
 * マッピングの値の引用符が開かなくなっていた。**判定を共有して規則が 1 つであることを実装で保証する。**
 * @param {string} before
 * @returns {boolean}
 */
function opensQuoteAfter(before) {
  for (let j = before.length - 1; j >= 0; j -= 1) {
    const c = before[j];
    if (c === " ") continue;
    return c === ":" || c === "," || c === "[" || c === "{";
  }
  return true;
}

/**
 * 正規化した 1 行（空白を畳む）。
 * @param {string} raw
 * @returns {string}
 */
function normalizeLine(raw) {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * 表の行をセルへ割る（先頭と末尾の空セルを落とす）。
 * @param {string} line
 * @returns {string[]}
 */
function tableCells(line) {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length > 0 && cells[0] === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/**
 * 多重集合の単位を 1 つ数える。
 * @param {Map<string, number>} counts
 * @param {string} unit
 */
function addUnit(counts, unit) {
  counts.set(unit, (counts.get(unit) ?? 0) + 1);
}

/**
 * @typedef {{
 *   counts: Map<string, number>,
 *   mutable: Set<string>,
 *   fillOnly: Set<string>,
 *   mutableBullet: Set<string>,
 *   allCellsMutable: boolean,
 *   allBulletsMutable: boolean,
 *   headings: string[],
 *   columns: string[],
 *   rowOccurrences: Map<string, number>,
 *   bulletOccurrences: Map<string, number>,
 *   tableIndex: number,
 *   inTable: boolean,
 * }} MarkdownState
 */

/**
 * Markdown の構造単位を数える。
 *
 * 落とさせない相手は「節・列・行・行の決定内容・箇条書きの鍵・散文」。
 * 行の同一性は先頭セル（slug・種類・箇所などの鍵）で見るが、**鍵だけを残すと残りのセルが
 * 自由に書き換えられる**（決定の出どころ・方針・理由を丸ごと差し替えても行は在る）。
 * そこで行 × 列のセルも単位にし、原本がその場の更新を定めている列だけを mutableColumns で外す。
 * 列を足す非破壊更新は新しい単位が増えるだけなので落ちない。
 * 空欄で追記して後で決定を埋める列は fillOnlyColumns に挙げ、**空セルだけ**を単位にしない。
 * 空 → 非空は単位が増えるだけなので通り、入っている値の差し替え・消去は単位の消失として落ちる。
 * 箇条書きも鍵と値の両方を守り、原本が更新を定めている項目だけを mutableBullets で外す。散文は行そのもの。
 * @param {string} text 文書の本文。
 * @param {{ mutableColumns?: string[], mutableBullets?: string[], fillOnlyColumns?: string[] }} [options]
 *   `mutableColumns` は値の更新を原本が認めている列名（"*" なら、セルを取り決めの対象外にする）。
 *   `mutableBullets` は値の更新を原本が認めている箇条書きの鍵（"*" なら、値を取り決めの対象外にする）。
 *   `fillOnlyColumns` は空 → 非空だけを許す列名。
 * @returns {Map<string, number>} 単位 → 出現回数
 */
export function markdownUnits(text, options = {}) {
  const { mutableColumns = [], mutableBullets = [], fillOnlyColumns = [] } = options;
  const mutable = new Set(mutableColumns.map((c) => c.trim()));
  const mutableBullet = new Set(mutableBullets.map((c) => c.trim()));
  /** @type {MarkdownState} */
  const md = {
    counts: new Map(),
    mutable,
    fillOnly: new Set(fillOnlyColumns.map((c) => c.trim())),
    mutableBullet,
    // "*" は「中身は取り決めの対象外」（一覧の requirement が節・列・行・ヘッダ項目だけを守ると定めている成果物）。
    allCellsMutable: mutable.has("*"),
    allBulletsMutable: mutableBullet.has("*"),
    headings: [],
    columns: [],
    // 同じ鍵の行が何度目か
    rowOccurrences: new Map(),
    // 同じ鍵の箇条書きが何度目か
    bulletOccurrences: new Map(),
    tableIndex: -1,
    inTable: false,
  };
  for (const raw of text.split("\n")) markdownLine(md, normalizeLine(raw));
  return md.counts;
}

/**
 * 正規化した 1 行を、見出し・表・箇条書き・散文のどれかの単位にする。
 * @param {MarkdownState} md
 * @param {string} line
 */
function markdownLine(md, line) {
  if (line === "") {
    md.inTable = false;
    return;
  }
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading !== null) {
    markdownHeading(md, heading);
    return;
  }
  const path = md.headings.join(" > ");
  if (line.startsWith("|") && line.endsWith("|")) {
    markdownTableLine(md, path, line);
    return;
  }
  md.inTable = false;
  const bullet = /^[-*+]\s+([^:：]{1,80})[:：](.*)$/.exec(line);
  if (bullet !== null) {
    markdownBullet(md, path, bullet);
    return;
  }
  addUnit(md.counts, `L:${line}`);
}

/**
 * 見出しを単位にし、見出しの階層を進める。
 * @param {MarkdownState} md
 * @param {RegExpExecArray} heading
 */
function markdownHeading(md, heading) {
  const level = heading[1].length;
  md.headings.length = Math.min(md.headings.length, level - 1);
  while (md.headings.length < level - 1) md.headings.push("");
  md.headings.push(heading[2].trim());
  md.tableIndex = -1;
  md.inTable = false;
  addUnit(md.counts, `H:${md.headings.join(" > ")}`);
}

/**
 * 表の 1 行（列名の行か、データの行）を単位にする。
 * @param {MarkdownState} md
 * @param {string} path 見出しのパス
 * @param {string} line
 */
function markdownTableLine(md, path, line) {
  if (/^\|[\s:|-]+\|$/.test(line)) return; // 区切り行は列を足すと変わる
  const cells = tableCells(line);
  if (!md.inTable) {
    md.inTable = true;
    md.tableIndex += 1;
    md.columns = cells;
    for (const cell of cells) addUnit(md.counts, `C:${path}#${md.tableIndex}|${cell}`);
    return;
  }
  const rowKey = cells[0] ?? "";
  addUnit(md.counts, `R:${path}#${md.tableIndex}|${rowKey}`);
  // 同じ鍵の行は出現順で区別する。区別しないと列ごとの多重集合になり、
  // 同じ鍵を持つ 2 行の間でセルを入れ替えても単位が変わらない
  // （assets.md は方針を覆した行と現在の行が同じ「種類」で 2 行並ぶ。原本が想定する形である）。
  // 追記専用の台帳なので既存行の並びは変わらず、出現順は安定した識別子になる。
  const seenKey = `${path}#${md.tableIndex}|${rowKey}`;
  const occurrence = md.rowOccurrences.get(seenKey) ?? 0;
  md.rowOccurrences.set(seenKey, occurrence + 1);
  if (!md.allCellsMutable) addRowCells(md, `${seenKey}@${occurrence}`, cells);
}

/**
 * データの行の、先頭以外のセルを単位にする。
 * @param {MarkdownState} md
 * @param {string} rowId 行の鍵と出現順
 * @param {string[]} cells
 */
function addRowCells(md, rowId, cells) {
  for (const [i, cell] of cells.entries()) {
    if (i === 0) continue; // 先頭セルは鍵そのもの
    const column = md.columns[i] ?? `#${i}`;
    if (md.mutable.has(column)) continue; // 原本がその場の更新を定めている列
    // 未記入は空セルだけ。`-`（該当なし）と `未確認` は決めた値・記録として守る。
    // `-` も未記入に数えると、決定済みの行の「該当なし」をその場で値へ書き換えられる。
    if (md.fillOnly.has(column) && cell === "") continue;
    addUnit(md.counts, `R:${rowId}|${column}=${cell}`);
  }
}

/**
 * 定義の箇条書き（`- 鍵: 値`）の鍵と値を単位にする。
 * @param {MarkdownState} md
 * @param {string} path 見出しのパス
 * @param {RegExpExecArray} bullet
 */
function markdownBullet(md, path, bullet) {
  // 鍵は強調・コードの記号を落として安定させる（`- **インスタンス件数**:` と `- インスタンス件数:` を同じ鍵にする）。
  const bulletKey = bullet[1].trim().replace(/^[*`\s]+|[*`\s]+$/g, "");
  addUnit(md.counts, `B:${path}|${bulletKey}`);
  // 鍵だけを守ると値（決定の中身）が自由に書き換わる。
  // 原本がその場の更新を定めている項目だけを mutable_bullets で外す。
  if (md.allBulletsMutable || md.mutableBullet.has(bulletKey)) return;
  const seenBullet = `${path}|${bulletKey}`;
  const n = md.bulletOccurrences.get(seenBullet) ?? 0;
  md.bulletOccurrences.set(seenBullet, n + 1);
  addUnit(md.counts, `B:${seenBullet}@${n}=${bullet[2].trim()}`);
}

/**
 * ドット区切りのパスで JSON の値を辿る。
 * @param {unknown} value
 * @param {string} path
 * @returns {unknown}
 */
function atPath(value, path) {
  let current = value;
  for (const key of path.split(".")) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * 鍵の順序に依らない JSON 文字列（要素の同一性に使う）。
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
  if (isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * 一覧が配列と宣言したパスの値を読む。まだ無ければ空とみなす（積み上げた要素も無い）。
 * @param {unknown} parsed
 * @param {string} path
 * @param {string} label 失敗メッセージ用（ファイル名＋版）
 * @returns {unknown[]}
 */
function declaredArrayAt(parsed, path, label) {
  const value = atPath(parsed, path);
  if (value === undefined || value === null) return [];
  if (!isArray(value)) {
    throw new UsageError(`一覧が配列と宣言した ${path} が配列でない: ${label}`);
  }
  return value;
}

/**
 * JSON の指定した配列の要素を数える。
 * @param {string} text
 * @param {{ arrays: string[], key?: string | null }} spec `key` を指定すると、要素そのものではなくこの項目の値を同一性にする
 * @param {string} label 失敗メッセージ用（ファイル名＋版）
 * @returns {Map<string, number>} 単位 → 出現回数
 */
export function jsonArrayUnits(text, spec, label) {
  const parsed = parseJsonForAppendCheck(text, label);
  const key = spec.key ?? null;
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const path of spec.arrays) {
    for (const element of declaredArrayAt(parsed, path, label)) {
      addUnit(counts, jsonArrayElementUnit(element, { path, key, label }));
    }
  }
  return counts;
}

/**
 * 配列の要素 1 つを単位にする。
 * @param {unknown} element
 * @param {{ path: string, key: string | null, label: string }} ctx
 * @returns {string}
 */
function jsonArrayElementUnit(element, ctx) {
  const { path, key, label } = ctx;
  if (key === null) return `${path}|${canonicalJson(element)}`;
  // 鍵が引けない要素を素通りさせない（全要素が同じ鍵へ潰れて 1 件が全件を満たす形を作らない）。
  if (!isPlainObject(element) || !nonEmptyString(element[key])) {
    throw new UsageError(
      `一覧が key: ${key} と宣言した ${path} の要素に、空でない文字列の ${key} が無い: ${label}`,
    );
  }
  return `${path}|${key}=${String(element[key]).trim()}`;
}

/**
 * JSON の指定した配列を鍵で対応づけ、フィールド単位で突き合わせる。
 *
 * 鍵だけを同一性にすると、鍵以外のフィールドが自由に書き換えられる（承認済みの項目の
 * 理由・承認者・承認日時を差し替えても鍵は残る）。そこで、デフォルトは「鍵以外は変えない」にする。
 * 原本が更新を定めている項目だけを、fill_only（空から空でない値への変更だけ）と transitions（明示した値の遷移だけ）で開ける。
 * @param {{ before: string, after: string }} texts 比較元と現在の本文
 * @param {{ arrays: string[], key: string, fillOnly: string[], transitions: Record<string, string[]> }} artifact
 * @param {{ before: string, after: string }} labels
 * @returns {string[]} findings
 */
export function compareKeyedArrays(texts, artifact, labels) {
  /** @type {string[]} */
  const findings = [];
  const fillOnly = new Set(artifact.fillOnly);
  for (const path of artifact.arrays) {
    const before = keyedElements(texts.before, { path, key: artifact.key }, labels.before);
    const after = keyedElements(texts.after, { path, key: artifact.key }, labels.after);
    for (const [key, baseList] of before) {
      const nowList = after.get(key) ?? [];
      if (nowList.length < baseList.length) {
        findings.push(
          `${path} の要素が失われている（${artifact.key}=${key}: 比較元 ${baseList.length} 件 → 現在 ${nowList.length} 件）`,
        );
      }
      const ctx = { path, key, artifact, fillOnly };
      // 同じ鍵が複数ある場合は並び順で対応づける（追記専用なので既存の並びは変わらない）。
      for (const [i, baseElement] of baseList.entries()) {
        const nowElement = nowList[i];
        if (nowElement === undefined) continue; // 件数の減少は上で数えた
        findings.push(...keyedElementFindings(ctx, baseElement, nowElement));
      }
    }
  }
  return findings;
}

/**
 * 鍵で対応づけた 2 つの要素を、比較元の要素のフィールドごとに突き合わせる。
 * @param {{ path: string, key: string, artifact: { key: string, transitions: Record<string, string[]> }, fillOnly: Set<string> }} ctx
 * @param {Record<string, unknown>} baseElement
 * @param {Record<string, unknown>} nowElement
 * @returns {string[]} findings
 */
function keyedElementFindings(ctx, baseElement, nowElement) {
  /** @type {string[]} */
  const findings = [];
  for (const field of Object.keys(baseElement)) {
    const finding = keyedFieldFinding(ctx, field, {
      from: baseElement[field],
      to: nowElement[field],
    });
    if (finding !== null) findings.push(finding);
  }
  return findings;
}

/**
 * フィールド 1 つの変更が、宣言で許した変更かを見る。許さない変更なら finding を返す。
 * @param {{ path: string, key: string, artifact: { key: string, transitions: Record<string, string[]> }, fillOnly: Set<string> }} ctx
 * @param {string} field
 * @param {{ from: unknown, to: unknown }} change
 * @returns {string | null}
 */
function keyedFieldFinding(ctx, field, change) {
  const { path, key, artifact } = ctx;
  const { from, to } = change;
  if (canonicalJson(from) === canonicalJson(to)) return null;
  const allowed = artifact.transitions[field];
  if (allowed !== undefined) {
    if (allowed.includes(`${stringify(from)}->${stringify(to)}`)) return null;
    return `${path} の ${field} が宣言に無い遷移で書き換えられている（${artifact.key}=${key}: ${stringify(from)} → ${stringify(to)}）`;
  }
  if (ctx.fillOnly.has(field)) {
    // 空 → 非空（記録の充填）だけ許す。既に入っている値の差し替えは決定の書き換え。
    if (!nonEmptyValue(from)) return null;
    return `${path} の ${field} が空でない値から書き換えられている（${artifact.key}=${key}: ${stringify(from)} → ${stringify(to)}）`;
  }
  return `${path} の ${field} が書き換えられている（${artifact.key}=${key}: ${stringify(from)} → ${stringify(to)}）`;
}

/**
 * 表示用に値を短く文字列化する。
 * @param {unknown} v
 * @returns {string}
 */
function stringify(v) {
  const s = typeof v === "string" ? v : canonicalJson(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function nonEmptyValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (isArray(v)) return v.length > 0;
  return true;
}

/**
 * 配列を鍵ごとの要素リストにする。
 * @param {string} text
 * @param {{ path: string, key: string }} spec
 * @param {string} label
 * @returns {Map<string, Record<string, unknown>[]>}
 */
function keyedElements(text, spec, label) {
  const { path, key } = spec;
  const parsed = parseJsonForAppendCheck(text, label);
  /** @type {Map<string, Record<string, unknown>[]>} */
  const out = new Map();
  for (const element of declaredArrayAt(parsed, path, label)) {
    if (!isPlainObject(element) || !nonEmptyString(element[key])) {
      throw new UsageError(
        `一覧が key: ${key} と宣言した ${path} の要素に、空でない文字列の ${key} が無い: ${label}`,
      );
    }
    const k = String(element[key]).trim();
    const list = out.get(k);
    if (list === undefined) out.set(k, [element]);
    else list.push(element);
  }
  return out;
}

/**
 * JSON として読む（読めなければ判定不能）。
 * @param {string} text
 * @param {string} label
 * @returns {unknown}
 */
function parseJsonForAppendCheck(text, label) {
  return parseJsonOrThrow(
    text,
    (message) =>
      new UsageError(
        `JSON として読めないため追記であることを確かめられない: ${label}（${message}）`,
      ),
  );
}

/**
 * 履歴の配列を読む。まだ無ければ空とみなす（最初の変更で作られる）。
 * @param {unknown} doc
 * @param {string} path
 * @param {string} label
 * @returns {unknown[]}
 */
function historyAt(doc, path, label) {
  const value = atPath(doc, path);
  if (value === undefined || value === null) return [];
  if (!isArray(value)) {
    throw new UsageError(`一覧が履歴と宣言した ${path} が配列でない: ${label}`);
  }
  return value;
}

/**
 * pinned_values で固定した単独の値を突き合わせる。
 *
 * 値を変えてよいのは、履歴（history）に要素を追記し、最後の要素が今の値を記録しているときだけである。
 * 最後の要素は、グループの全パスについて、パスの最後のセグメントを名前にした項目に今の値を持つ
 * （`performance.floors` なら `floors`）。値を消した変更は、その項目を持たない要素で記録する。
 * 履歴の既存の要素は、値を変えないときも、先頭からの並びが比較元と一致しなければならない。
 * 値が無い（undefined）ことと null は、同じ値として扱う。
 * @param {{ before: string, after: string }} texts 比較元と現在の本文
 * @param {{ paths: string[], history: string }[]} groups
 * @param {{ before: string, after: string }} labels
 * @returns {string[]} findings
 */
export function comparePinnedValues(texts, groups, labels) {
  /** @type {string[]} */
  const findings = [];
  if (groups.length === 0) return findings;
  const docs = {
    before: parseJsonForAppendCheck(texts.before, labels.before),
    after: parseJsonForAppendCheck(texts.after, labels.after),
  };
  for (const group of groups) findings.push(...pinnedGroupFindings(docs, group, labels));
  return findings;
}

/**
 * pinned_values の 1 グループを突き合わせる。
 * @param {{ before: unknown, after: unknown }} docs 比較元と現在の文書
 * @param {{ paths: string[], history: string }} group
 * @param {{ before: string, after: string }} labels
 * @returns {string[]} findings
 */
function pinnedGroupFindings(docs, group, labels) {
  const { before, after } = docs;
  const baseHistory = historyAt(before, group.history, labels.before);
  const nowHistory = historyAt(after, group.history, labels.after);
  const findings = existingHistoryFindings(group.history, baseHistory, nowHistory);
  const changed = group.paths.filter(
    (p) => canonicalJson(atPath(before, p)) !== canonicalJson(atPath(after, p)),
  );
  const appended = nowHistory.length > baseHistory.length;
  if (changed.length > 0 && !appended) {
    for (const p of changed) {
      findings.push(
        `${p} が ${group.history} への追記なしに書き換えられている（${stringify(atPath(before, p))} → ${stringify(atPath(after, p))}）`,
      );
    }
    return findings;
  }
  if (!appended) return findings;
  findings.push(
    ...appendedHistoryFindings(after, group, { baseLength: baseHistory.length, nowHistory }),
  );
  return findings;
}

/**
 * 履歴の既存の要素が、先頭から比較元と同じ並びで残っているかを見る。
 * @param {string} historyPath
 * @param {unknown[]} baseHistory
 * @param {unknown[]} nowHistory
 * @returns {string[]} findings
 */
function existingHistoryFindings(historyPath, baseHistory, nowHistory) {
  /** @type {string[]} */
  const findings = [];
  for (const [i, element] of baseHistory.entries()) {
    if (i >= nowHistory.length) {
      findings.push(
        `${historyPath} の要素が失われている（比較元 ${baseHistory.length} 件 → 現在 ${nowHistory.length} 件）`,
      );
      break;
    }
    if (canonicalJson(element) !== canonicalJson(nowHistory[i])) {
      findings.push(`${historyPath} の ${i} 番目の要素が書き換えられている`);
    }
  }
  return findings;
}

/**
 * 履歴に追記した要素の形と、最後の要素が今の値を記録しているかを見る。
 * @param {unknown} after 現在の文書
 * @param {{ paths: string[], history: string }} group
 * @param {{ baseLength: number, nowHistory: unknown[] }} history
 * @returns {string[]} findings
 */
function appendedHistoryFindings(after, group, history) {
  const { baseLength, nowHistory } = history;
  /** @type {string[]} */
  const findings = [];
  // 値の中身が正しい決定かは見ないが、追記した要素は記録として読める形（オブジェクト）でなければならない。
  // 最後の要素だけを見ると、同じ変更で読めない要素を並べて足しても通る。
  for (let k = baseLength; k < nowHistory.length - 1; k += 1) {
    if (!isPlainObject(nowHistory[k])) {
      findings.push(`${group.history} に追記した ${k} 番目の要素がオブジェクトでない`);
    }
  }
  // 追記した最後の要素が今の値と合わなければ、記録と実体が食い違う（記録だけ足して値を別に書き換える形を通さない）。
  const last = nowHistory[nowHistory.length - 1];
  if (!isPlainObject(last)) {
    findings.push(`${group.history} の最後の要素がオブジェクトでない`);
    return findings;
  }
  for (const p of group.paths) {
    const field = lastSegment(p);
    if (canonicalJson(last[field]) === canonicalJson(atPath(after, p))) continue;
    findings.push(
      `${group.history} の最後の要素の ${field} が ${p} の今の値と合わない（履歴 ${stringify(last[field])} / 今 ${stringify(atPath(after, p))}）`,
    );
  }
  return findings;
}

/**
 * @param {string} path
 * @returns {string}
 */
function lastSegment(path) {
  return path.slice(path.lastIndexOf(".") + 1);
}

/**
 * @typedef {{
 *   add: (unit: string) => void,
 *   blockSet: Set<string>,
 *   growableSet: Set<string>,
 *   registryOf: Map<string, RegistryGroup>,
 * }} JsoncWalk
 */

/**
 * JSONC の値の木を単位に分ける（unit: jsonc-tree）。
 * @param {string} text
 * @param {{ blocks: string[], growable: string[], registryGroups: RegistryGroup[] }} options
 *   `blocks` は配下を単位から外すキーパス、`growable` は要素ごとの単位に展開するキーパス（追記だけを許す配列）、
 *   `registryGroups` は鍵をまたぐ移動を許すグループ。
 * @param {string} label 失敗メッセージ用（ファイル名＋版）
 * @returns {Map<string, number>}
 */
export function jsoncTreeUnits(text, options, label) {
  const { blocks, growable, registryGroups } = options;
  const value = parseJsoncForAppendCheck(text, label);
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Map<string, RegistryGroup>} */
  const registryOf = new Map();
  for (const g of registryGroups) for (const path of g.paths) registryOf.set(path, g);
  /** @type {JsoncWalk} */
  const tree = {
    add: (unit) => addUnit(counts, unit),
    blockSet: new Set(blocks),
    growableSet: new Set(growable),
    registryOf,
  };
  // 最上位の値の型も単位にする（{} を [] や null にする書き換えを落とす）
  addJsoncContainer(tree, value, "<最上位>");
  walkJsonc(tree, value, { path: "", exact: true });
  // コメント。registry_groups と mutable_blocks の配列の中にあるものは数えない。
  addJsoncComments(tree, text, [...blocks, ...registryGroups.flatMap((g) => g.paths)]);
  return counts;
}

/**
 * JSONC として読む（読めなければ判定不能）。
 * @param {string} text
 * @param {string} label
 * @returns {unknown}
 */
function parseJsoncForAppendCheck(text, label) {
  try {
    return parseJsonc(text, label);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    throw new UsageError(`JSONC として読めないため追記であることを確かめられない: ${e.message}`);
  }
}

/**
 * 配列とオブジェクトは、型も単位にする。空の配列やオブジェクトは他に単位を持たないので、
 * null やスカラへの書き換えで消える単位が無く、追記として通ってしまうためである。
 * @param {JsoncWalk} tree
 * @param {unknown} v
 * @param {string} path
 */
function addJsoncContainer(tree, v, path) {
  if (isArray(v)) tree.add(`<array: ${path}>`);
  else if (isPlainObject(v)) tree.add(`<object: ${path}>`);
}

/**
 * 値の木を辿って、キー・スカラの値・コンテナの型を単位にする。
 * @param {JsoncWalk} tree
 * @param {unknown} v
 * @param {{ path: string, exact: boolean }} at `path` は添字を `[]` に畳んだパス、
 *   `exact` は添字を含まない（一覧のキーパスと突き合わせられる）か
 */
function walkJsonc(tree, v, at) {
  if (isPlainObject(v)) {
    for (const [k, child] of Object.entries(v)) walkJsoncEntry(tree, { k, child }, at);
    return;
  }
  if (isArray(v)) {
    for (const element of v) {
      addJsoncContainer(tree, element, `${at.path}[]`);
      walkJsonc(tree, element, { path: `${at.path}[]`, exact: false });
    }
    return;
  }
  tree.add(`${at.path} = ${JSON.stringify(v)}`);
}

/**
 * オブジェクトの 1 つのキーと、その配下を単位にする。
 * @param {JsoncWalk} tree
 * @param {{ k: string, child: unknown }} entry
 * @param {{ path: string, exact: boolean }} at 親のパス
 */
function walkJsoncEntry(tree, entry, at) {
  const { k, child } = entry;
  // 区切りの文字（. [ ] など）を含むキーは JSON の文字列で書く。そのまま連ねると、{"b.c": 1} と {"b": {"c": 1}} が同じ単位になり、
  // 入れ子の値を消して同じ字面のキーを足す書き換えを追記として通す
  const segment = /^[^.[\]"\s<>=]+$/.test(k) ? k : JSON.stringify(k);
  const p = at.path === "" ? segment : `${at.path}.${segment}`;
  tree.add(`<key: ${p}>`);
  if (at.exact && tree.blockSet.has(p)) return;
  addJsoncContainer(tree, child, p);
  const group = at.exact ? tree.registryOf.get(p) : undefined;
  if (at.exact && (tree.growableSet.has(p) || group !== undefined) && isArray(child)) {
    for (const element of child) tree.add(jsoncItemUnit(p, element, group));
    return;
  }
  walkJsonc(tree, child, { path: p, exact: at.exact });
}

/**
 * growable_containers か registry_groups に挙げた配列の要素を、単位にする。
 * @param {string} p 配列のキーパス
 * @param {unknown} element
 * @param {RegistryGroup | undefined} group registry_groups のグループ（growable_containers なら undefined）
 * @returns {string}
 */
function jsoncItemUnit(p, element, group) {
  if (group === undefined) return `${GROWABLE_ITEM_PREFIX}${p}> ${canonicalJson(element)}`;
  const item =
    typeof element === "string"
      ? element.trim()
      : isPlainObject(element) && typeof element[group.itemKey] === "string"
        ? String(element[group.itemKey]).trim()
        : canonicalJson(element);
  return `${REGISTRY_ITEM_PREFIX}${group.id}> ${item}`;
}

/**
 * コメントの本文を単位にする。外すキーパスの値の範囲にあるコメントは数えない。
 * @param {JsoncWalk} tree
 * @param {string} text
 * @param {string[]} skippedPaths
 */
function addJsoncComments(tree, text, skippedPaths) {
  const root = jsonc.parseTree(text, [], { allowTrailingComma: true });
  /** @type {[number, number][]} */
  const skipped = [];
  for (const path of skippedPaths) {
    const node = root === undefined ? undefined : jsonc.findNodeAtLocation(root, path.split("."));
    if (node !== undefined) skipped.push([node.offset, node.offset + node.length]);
  }
  const scanner = jsonc.createScanner(text, false);
  for (let kind = scanner.scan(); kind !== jsonc.SyntaxKind.EOF; kind = scanner.scan()) {
    if (kind !== jsonc.SyntaxKind.LineCommentTrivia && kind !== jsonc.SyntaxKind.BlockCommentTrivia)
      continue;
    const offset = scanner.getTokenOffset();
    if (skipped.some(([start, end]) => offset >= start && offset < end)) continue;
    const body = normalizeLine(text.slice(offset, offset + scanner.getTokenLength()));
    if (body !== "") tree.add(`<comment> ${body}`);
  }
}

/**
 * 一覧の unit に従って単位を数える。
 * @param {string} text
 * @param {{ unit: string, arrays: string[], key?: string | null, mutableColumns?: string[], fillOnlyColumns?: string[], mutableBullets?: string[], mutableBlocks?: string[], growableContainers?: string[], registryGroups?: RegistryGroup[] }} artifact
 * @param {{ label: string, wrappedOut?: WrappedContainer[] }} context `label` は失敗メッセージ用（ファイル名＋版）。
 *   `wrappedOut` は連結しても閉じないフロー形式のコンテナを積む先（診断用。帰属判定の材料を伴う）。
 * @returns {Map<string, number>}
 */
export function unitsOf(text, artifact, context) {
  const { label, wrappedOut = [] } = context;
  if (artifact.unit === "markdown-structure") {
    return markdownUnits(text, {
      mutableColumns: artifact.mutableColumns ?? [],
      mutableBullets: artifact.mutableBullets ?? [],
      fillOnlyColumns: artifact.fillOnlyColumns ?? [],
    });
  }
  if (artifact.unit === "json-arrays") {
    return jsonArrayUnits(text, { arrays: artifact.arrays, key: artifact.key ?? null }, label);
  }
  if (artifact.unit === "jsonc-tree") {
    return jsoncTreeUnits(
      text,
      {
        blocks: artifact.mutableBlocks ?? [],
        growable: artifact.growableContainers ?? [],
        registryGroups: artifact.registryGroups ?? [],
      },
      label,
    );
  }
  return normalizeLines(text, {
    mutableBlocks: artifact.mutableBlocks ?? [],
    growableContainers: artifact.growableContainers ?? [],
    registryGroups: artifact.registryGroups ?? [],
    wrappedOut,
  });
}

/**
 * git コマンドを実行する。
 * @param {string} root
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function git(root, args) {
  const r = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) throw new UsageError(`git を実行できない: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * 一覧の pinned_values を読む。
 *
 * 履歴の最後の要素は、パスの最後のセグメントを項目名にして値を記録するので、グループの中で最後のセグメントが重なると
 * どちらの値の記録かを区別できない。固定するパスと履歴が重なる・入れ子になると、履歴への追記がそのまま値の変更になる。
 * 同じ項目の arrays と重なると、同じ値に配列の規則（fill_only など）と固定の規則が両方当たり、結果が食い違う。
 * どれも、使い方の誤りとして落とす。
 * @param {unknown} raw
 * @param {number} i
 * @param {string[]} arrays 同じ項目の arrays（重なりの検査に使う）
 * @returns {{ paths: string[], history: string }[]}
 */
function readPinnedValues(raw, i, arrays) {
  if (!isArray(raw) || raw.length === 0) {
    throw new UsageError(`artifacts[${i}].pinned_values が空でない配列でない`);
  }
  /** @type {string[]} 同じ項目の arrays と、すべてのグループのパスと履歴（重なりの検査に使う） */
  const seen = [...arrays];
  /** @param {string} path */
  const claim = (path) => {
    for (const prev of seen) {
      if (prev === path || path.startsWith(`${prev}.`) || prev.startsWith(`${path}.`)) {
        throw new UsageError(
          `artifacts[${i}].pinned_values のパスが arrays か他のパスと重なっている（同じか入れ子）: ${prev} / ${path}`,
        );
      }
    }
    seen.push(path);
  };
  return raw.map((group) => {
    if (!isPlainObject(group) || !isArray(group.paths) || group.paths.length === 0) {
      throw new UsageError(`artifacts[${i}].pinned_values の要素に空でない paths が無い`);
    }
    if (!nonEmptyString(group.history) || !KEY_PATH.test(String(group.history).trim())) {
      throw new UsageError(
        `artifacts[${i}].pinned_values の history がキーパスの形でない: ${JSON.stringify(group.history)}`,
      );
    }
    /** @type {Set<string>} */
    const fields = new Set();
    const paths = group.paths.map((path) => {
      if (!nonEmptyString(path) || !KEY_PATH.test(String(path).trim())) {
        throw new UsageError(
          `artifacts[${i}].pinned_values の paths の要素がキーパスの形でない: ${JSON.stringify(path)}`,
        );
      }
      const p = String(path).trim();
      const field = lastSegment(p);
      if (fields.has(field)) {
        throw new UsageError(
          `artifacts[${i}].pinned_values の同じグループで、paths の最後のセグメントが重なっている: ${field}`,
        );
      }
      fields.add(field);
      claim(p);
      return p;
    });
    const history = String(group.history).trim();
    claim(history);
    return { paths, history };
  });
}

/**
 * @typedef {{
 *   arrays: string[],
 *   key: string | null,
 *   fillOnly: string[],
 *   transitions: Record<string, string[]>,
 *   mutableColumns: string[],
 *   fillOnlyColumns: string[],
 *   mutableBullets: string[],
 *   mutableBlocks: string[],
 *   growableContainers: string[],
 *   registryGroups: RegistryGroup[],
 *   pinnedValues: { paths: string[], history: string }[],
 * }} ArtifactOptions
 * @typedef {ArtifactOptions & { id: string, pattern: string, unit: string, requirement: string, source: string }} ManifestArtifact
 */

/** mutable_columns・fill_only_columns・mutable_bullets を書ける unit。 */
const MARKDOWN_ONLY = ["markdown-structure"];

/** registry_groups・growable_containers・mutable_blocks を書ける unit。 */
const KEY_PATH_UNITS = ["lines", "jsonc-tree"];

/**
 * 一覧を読む。
 * @param {string} manifestPath
 * @returns {ManifestArtifact[]}
 */
export function readManifest(manifestPath) {
  const artifacts = loadManifestArtifacts(manifestPath);
  /** @type {Set<string>} */
  const seenIds = new Set();
  return artifacts.map((a, i) => readManifestArtifact(a, i, seenIds));
}

/**
 * 一覧のファイルを JSON として読み、artifacts の配列を返す。
 * @param {string} manifestPath
 * @returns {unknown[]}
 */
function loadManifestArtifacts(manifestPath) {
  if (!existsSync(manifestPath)) throw new UsageError(`一覧が無い: ${manifestPath}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new UsageError(`一覧を JSON として読めない: ${manifestPath}（${errorMessage(e)}）`);
  }
  if (!isPlainObject(parsed) || !isArray(parsed.artifacts)) {
    throw new UsageError(`一覧に artifacts 配列が無い: ${manifestPath}`);
  }
  return parsed.artifacts;
}

/**
 * 一覧の項目 1 つを読む。
 * @param {unknown} a
 * @param {number} i
 * @param {Set<string>} seenIds 既に読んだ項目の id
 * @returns {ManifestArtifact}
 */
function readManifestArtifact(a, i, seenIds) {
  if (!isPlainObject(a)) throw new UsageError(`artifacts[${i}] がオブジェクトでない`);
  if (!nonEmptyString(a.id) || !nonEmptyString(a.pattern)) {
    throw new UsageError(`artifacts[${i}] の id / pattern が空`);
  }
  // **id は一覧の中で一意**。重複を許すと「同じ id なら同じ項目」という前提が成り立たなくなり、
  // 同じファイルに当たった突き合わせ方の違う 2 項目が無音で先勝ちに決まる
  // （緩い規則＝mutable_columns の多い方が先に来ると、厳しい規則が守るはずの列への破壊的編集が検出から外れる）。
  const id = String(a.id).trim();
  if (seenIds.has(id)) {
    throw new UsageError(
      `artifacts[${i}] の id が一覧の中で重複している: ${id}（突き合わせ方の食い違いが無音で先勝ちに決まる）`,
    );
  }
  seenIds.add(id);
  const unit = readUnit(a, i);
  const options =
    unit === "json-arrays" ? readJsonArraysOptions(a, i) : readTextOptions(a, { i, unit });
  checkOptionPathOverlap(i, options);
  return {
    id,
    pattern: String(a.pattern).trim(),
    unit: String(unit),
    ...options,
    requirement: nonEmptyString(a.requirement) ? String(a.requirement).trim() : "",
    source: nonEmptyString(a.source) ? String(a.source).trim() : "",
  };
}

/**
 * 一覧の項目の unit を読む。
 * @param {Record<string, unknown>} a
 * @param {number} i
 * @returns {string}
 */
function readUnit(a, i) {
  // unit を持たない旧い一覧は lines（このツールの初版の突き合わせ方）として読む。
  const unit = a.unit === undefined || a.unit === null ? "lines" : a.unit;
  // UNITS は文字列だけなので、typeof は型を絞るためだけにある（判定は変わらない）。
  if (typeof unit !== "string" || !UNITS.includes(unit)) {
    throw new UsageError(
      `artifacts[${i}] の unit が語彙外（${UNITS.join(" / ")}）: ${JSON.stringify(a.unit)}`,
    );
  }
  return unit;
}

/**
 * オプションのデフォルト（どの unit でも、書かなかったオプションはこの値になる）。
 * @returns {ArtifactOptions}
 */
function defaultArtifactOptions() {
  return {
    arrays: [],
    key: null,
    fillOnly: [],
    transitions: {},
    mutableColumns: [],
    fillOnlyColumns: [],
    mutableBullets: [],
    mutableBlocks: [],
    growableContainers: [],
    registryGroups: [],
    pinnedValues: [],
  };
}

/**
 * 一覧の項目の、文字列の配列のオプションを読む。
 * @param {unknown} value
 * @param {string} where 失敗メッセージに出す位置（`artifacts[0].fill_only` など）
 * @param {boolean} [keyPath] 要素をキーパスの形に限るか
 * @returns {string[]}
 */
function readStringList(value, where, keyPath = false) {
  if (!isArray(value)) throw new UsageError(`${where} が配列でない`);
  for (const item of value) {
    if (!nonEmptyString(item)) throw new UsageError(`${where} に空の要素がある`);
    // キーパス以外（先頭・末尾のドット、空のセグメント）は、警告なしに「一致しないパス」になり、
    // 外したつもりの領域が単位に残る。書いた側の誤りとして落とす。
    if (keyPath && !KEY_PATH.test(String(item).trim())) {
      throw new UsageError(`${where} の要素がキーパスの形でない: ${JSON.stringify(item)}`);
    }
  }
  return value.map((x) => String(x).trim());
}

/**
 * unit が json-arrays の項目のオプションを読む。
 * @param {Record<string, unknown>} a
 * @param {number} i
 * @returns {ArtifactOptions}
 */
function readJsonArraysOptions(a, i) {
  if (!isArray(a.arrays) || a.arrays.length === 0) {
    throw new UsageError(`artifacts[${i}] の unit が json-arrays なのに arrays が空`);
  }
  const arrays = readStringList(a.arrays, `artifacts[${i}].arrays`);
  const key = readArrayKey(a, i);
  const fillOnly = readFillOnly(a, i, key);
  const transitions = readTransitions(a, i, key);
  const pinnedValues =
    a.pinned_values !== undefined && a.pinned_values !== null
      ? readPinnedValues(a.pinned_values, i, arrays)
      : [];
  rejectTextOptions(a, i);
  return { ...defaultArtifactOptions(), arrays, key, fillOnly, transitions, pinnedValues };
}

/**
 * json-arrays の key を読む。
 * @param {Record<string, unknown>} a
 * @param {number} i
 * @returns {string | null}
 */
function readArrayKey(a, i) {
  if (a.key === undefined || a.key === null) return null;
  if (!nonEmptyString(a.key)) throw new UsageError(`artifacts[${i}].key が空`);
  return String(a.key).trim();
}

/**
 * json-arrays の fill_only を読む。
 * @param {Record<string, unknown>} a
 * @param {number} i
 * @param {string | null} key
 * @returns {string[]}
 */
function readFillOnly(a, i, key) {
  if (a.fill_only === undefined || a.fill_only === null) return [];
  if (key === null) throw new UsageError(`artifacts[${i}] は key が無いのに fill_only がある`);
  return readStringList(a.fill_only, `artifacts[${i}].fill_only`);
}

/**
 * json-arrays の transitions を読む。
 * @param {Record<string, unknown>} a
 * @param {number} i
 * @param {string | null} key
 * @returns {Record<string, string[]>}
 */
function readTransitions(a, i, key) {
  /** @type {Record<string, string[]>} */
  const transitions = {};
  if (a.transitions === undefined || a.transitions === null) return transitions;
  if (key === null) throw new UsageError(`artifacts[${i}] は key が無いのに transitions がある`);
  if (!isPlainObject(a.transitions)) {
    throw new UsageError(`artifacts[${i}].transitions がオブジェクトでない`);
  }
  for (const [field, list] of Object.entries(a.transitions)) {
    const where = `artifacts[${i}].transitions.${field}`;
    if (!isArray(list) || list.length === 0) throw new UsageError(`${where} が空の配列`);
    for (const t of list) {
      // 「<変更前>-><変更後>」だけを受ける。曖昧な表記を警告なしに通さない。
      if (!nonEmptyString(t) || !/^[^>]+->[^>]+$/.test(String(t).trim())) {
        throw new UsageError(
          `${where} の要素が <変更前>-><変更後> の形でない: ${JSON.stringify(t)}`,
        );
      }
    }
    transitions[field] = list.map((x) => String(x).trim());
  }
  return transitions;
}

/**
 * unit が json-arrays の項目に、他の unit のオプションがあれば使い方の誤りにする。
 * @param {Record<string, unknown>} a
 * @param {number} i
 */
function rejectTextOptions(a, i) {
  if (
    a.mutable_columns !== undefined ||
    a.fill_only_columns !== undefined ||
    a.mutable_bullets !== undefined ||
    a.mutable_blocks !== undefined ||
    a.growable_containers !== undefined ||
    a.registry_groups !== undefined
  ) {
    throw new UsageError(
      `artifacts[${i}] の unit が json-arrays なのに mutable_columns / fill_only_columns / mutable_bullets / mutable_blocks / growable_containers / registry_groups がある`,
    );
  }
}

/**
 * unit が json-arrays 以外の項目のオプションを読む。
 * @param {Record<string, unknown>} a
 * @param {{ i: number, unit: string }} ctx
 * @returns {ArtifactOptions}
 */
function readTextOptions(a, ctx) {
  rejectJsonArraysOptions(a, ctx);
  const mutableColumns = readUnitOption(a, ctx, { name: "mutable_columns", units: MARKDOWN_ONLY });
  const fillOnlyColumns = readUnitOption(a, ctx, {
    name: "fill_only_columns",
    units: MARKDOWN_ONLY,
  });
  checkFillOnlyColumns(ctx.i, fillOnlyColumns, mutableColumns);
  const registryGroups = readRegistryGroups(a, ctx);
  const growableContainers = readUnitOption(a, ctx, {
    name: "growable_containers",
    units: KEY_PATH_UNITS,
    keyPath: true,
  });
  const mutableBlocks = readUnitOption(a, ctx, {
    name: "mutable_blocks",
    units: KEY_PATH_UNITS,
    keyPath: true,
  });
  const mutableBullets = readUnitOption(a, ctx, { name: "mutable_bullets", units: MARKDOWN_ONLY });
  return {
    ...defaultArtifactOptions(),
    mutableColumns,
    fillOnlyColumns,
    mutableBullets,
    mutableBlocks,
    growableContainers,
    registryGroups,
  };
}

/**
 * unit が json-arrays 以外の項目に、json-arrays のオプションがあれば使い方の誤りにする。
 * @param {Record<string, unknown>} a
 * @param {{ i: number, unit: string }} ctx
 */
function rejectJsonArraysOptions(a, ctx) {
  const { i, unit } = ctx;
  if (a.arrays !== undefined && a.arrays !== null) {
    throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに arrays がある`);
  }
  if (a.key !== undefined && a.key !== null) {
    throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに key がある`);
  }
  if (a.fill_only !== undefined || a.transitions !== undefined) {
    throw new UsageError(
      `artifacts[${i}] の unit が ${unit} なのに fill_only / transitions がある`,
    );
  }
  if (a.pinned_values !== undefined) {
    throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに pinned_values がある`);
  }
}

/**
 * 書ける unit が決まっている、文字列の配列のオプションを読む。書いていなければ空の配列を返す。
 * @param {Record<string, unknown>} a
 * @param {{ i: number, unit: string }} ctx
 * @param {{ name: string, units: string[], keyPath?: boolean }} spec
 * @returns {string[]}
 */
function readUnitOption(a, ctx, spec) {
  const value = a[spec.name];
  if (value === undefined || value === null) return [];
  if (!spec.units.includes(ctx.unit)) {
    throw new UsageError(`artifacts[${ctx.i}] の unit が ${ctx.unit} なのに ${spec.name} がある`);
  }
  return readStringList(value, `artifacts[${ctx.i}].${spec.name}`, spec.keyPath ?? false);
}

/**
 * fill_only_columns の "*" と、mutable_columns との重なりを使い方の誤りにする。
 * @param {number} i
 * @param {string[]} fillOnlyColumns
 * @param {string[]} mutableColumns
 */
function checkFillOnlyColumns(i, fillOnlyColumns, mutableColumns) {
  // "*" は「全列を空 → 非空だけ」と「取り決めの対象外」のどちらにも読めるので受けない。
  if (fillOnlyColumns.includes("*")) {
    throw new UsageError(`artifacts[${i}].fill_only_columns に "*" がある（列名で名指しする）`);
  }
  // 同じ列を両方に書くと、緩い方（mutable_columns）が警告なしに優先され、決めた値の書き換えが通る。
  const overlap = mutableColumns.includes("*")
    ? fillOnlyColumns
    : fillOnlyColumns.filter((c) => mutableColumns.includes(c));
  if (overlap.length > 0) {
    throw new UsageError(
      `artifacts[${i}] の同じ列が mutable_columns と fill_only_columns の両方にある: ${overlap.join(" / ")}`,
    );
  }
}

/**
 * registry_groups を読む。
 * @param {Record<string, unknown>} a
 * @param {{ i: number, unit: string }} ctx
 * @returns {RegistryGroup[]}
 */
function readRegistryGroups(a, ctx) {
  const { i, unit } = ctx;
  const raw = a.registry_groups;
  if (raw === undefined || raw === null) return [];
  if (!KEY_PATH_UNITS.includes(unit)) {
    throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに registry_groups がある`);
  }
  if (!isArray(raw)) throw new UsageError(`artifacts[${i}].registry_groups が配列でない`);
  /** @type {{ groupIds: Set<string>, paths: Set<string> }} */
  const seen = { groupIds: new Set(), paths: new Set() };
  return raw.map((group) => readRegistryGroup(group, i, seen));
}

/**
 * registry_groups の要素 1 つを読む。
 * @param {unknown} group
 * @param {number} i
 * @param {{ groupIds: Set<string>, paths: Set<string> }} seen 既に読んだグループの id とパス
 * @returns {RegistryGroup}
 */
function readRegistryGroup(group, i, seen) {
  if (!isPlainObject(group) || !nonEmptyString(group.id) || !nonEmptyString(group.item_key)) {
    throw new UsageError(`artifacts[${i}].registry_groups の要素に id / item_key が無い`);
  }
  const id = String(group.id).trim();
  // id が重なると別グループの要素が同じ単位に畳まれ、鍵をまたぐ移動の範囲が警告なしに広がる。
  if (seen.groupIds.has(id)) {
    throw new UsageError(`artifacts[${i}].registry_groups の id が重複している: ${id}`);
  }
  seen.groupIds.add(id);
  if (!isArray(group.paths) || group.paths.length === 0) {
    throw new UsageError(`artifacts[${i}].registry_groups[${id}].paths が空`);
  }
  const paths = group.paths.map((path) => readRegistryPath(path, { i, id }, seen.paths));
  return { id, itemKey: String(group.item_key).trim(), paths };
}

/**
 * registry_groups の paths の要素 1 つを読む。
 * @param {unknown} path
 * @param {{ i: number, id: string }} ctx
 * @param {Set<string>} seenPaths すべてのグループで既に読んだパス
 * @returns {string}
 */
function readRegistryPath(path, ctx, seenPaths) {
  const { i, id } = ctx;
  if (!nonEmptyString(path) || !KEY_PATH.test(String(path).trim())) {
    throw new UsageError(
      `artifacts[${i}].registry_groups[${id}].paths の要素がキーパスの形でない: ${JSON.stringify(path)}`,
    );
  }
  const p = String(path).trim();
  // 同じパスが 2 つのグループに属すると、どちらの単位になるかが並び順で決まる。
  if (seenPaths.has(p)) {
    throw new UsageError(
      `artifacts[${i}].registry_groups のパスが複数のグループに属している: ${p}`,
    );
  }
  seenPaths.add(p);
  return p;
}

/**
 * **3 つのオプションの間でパスは重ならない。完全一致だけでなく祖先・子孫の重なりも落とす。**
 * 重なると、同じキーに 2 通りの単位が当たり、実装の分岐の順で先に当たった方に決まる。緩い方が当たると、
 * 検出できていたはずの削除が警告なしに通る。祖先の側はとくに危ない。`mutable_blocks` は配下を丸ごと
 * 単位から外すので、子孫に書いた `growable_containers` / `registry_groups` の展開は、そこへ到達しない。
 * すると、**その配下の削除がすべて通る**（実測: `a.b` を外した状態で `a.b.c` を空にし `a.b.d` を消しても失われた単位 0）。
 * 一覧をコピーして `--manifest` で渡す運用でコピー側に祖先を足した瞬間に成立するため、使い方の誤りとして落とす。
 * グループ内・グループ間の重複を exit 2 にしているのと同じ理由。
 * @param {number} i
 * @param {ArtifactOptions} options
 */
function checkOptionPathOverlap(i, options) {
  /** @type {{ path: string, option: string }[]} 既に見たパスと由来のオプション名 */
  const pathOwners = [];
  /** @type {[string, string[]][]} */
  const optionPaths = [
    ["mutable_blocks", options.mutableBlocks],
    ["growable_containers", options.growableContainers],
    ["registry_groups", options.registryGroups.flatMap((g) => g.paths)],
  ];
  for (const [option, paths] of optionPaths) {
    for (const path of paths) {
      for (const prev of pathOwners) {
        // 祖先・子孫は「一方がもう一方 + `.` で始まる」で判定する（`a.b` と `a.bc` は重ならない）。
        const overlaps =
          prev.path === path ||
          path.startsWith(`${prev.path}.`) ||
          prev.path.startsWith(`${path}.`);
        if (!overlaps) continue;
        const how = prev.path === path ? "同じキーパス" : "入れ子になったキーパス";
        throw new UsageError(
          `artifacts[${i}] の${how}が ${prev.option} と ${option} の両方にある: ${prev.path} / ${path}`,
        );
      }
      pathOwners.push({ path, option });
    }
  }
}

/**
 * @param {{ root: string, manifestPath: string, base: string, exclude?: string[] }} opts
 * @returns {{ findings: string[], notes: string[], checked: number }}
 */
export function check(opts) {
  const { root, manifestPath, base } = opts;
  const exclude = opts.exclude ?? [];
  const artifacts = selectArtifacts(manifestPath, exclude);
  const prefix = repoPrefix(root, base);

  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];
  if (exclude.length > 0) notes.push(`一覧から外した項目（突き合わせない）: ${exclude.join(", ")}`);

  const trackedFiles = trackedFilesAt(root, base, prefix);
  const byFile = assignArtifacts(root, artifacts, trackedFiles);
  const targets = [...byFile.keys()].sort();
  if (targets.length === 0) {
    throw new UsageError(
      `追記専用の成果物が 1 件も見つからない（対象 0 件を合格として扱わない）: root=${root} 一覧=${manifestPath}`,
    );
  }

  /** @type {CheckContext} */
  const ctx = { root, base, prefix, trackedSet: new Set(trackedFiles), findings, notes };
  let checked = 0;
  for (const file of targets) {
    const artifact = byFile.get(file);
    // targets は byFile のキーなので必ず見つかる（型を絞るためだけの分岐で、到達しない）。
    if (artifact === undefined) throw new Error(`byFile に無いファイル: ${file}`);
    if (compareArtifactFile(ctx, file, artifact)) checked += 1;
  }

  notes.push(
    `一覧の ${artifacts.length} パターンに一致した ${targets.length} 件のうち、比較元にも在る ${checked} 件を突き合わせた`,
  );
  if (checked === 0) {
    findings.push(
      `比較元 ${base} に在る追記専用の成果物が 0 件（突き合わせが 1 件も成立していない）`,
    );
  }
  return { findings, notes, checked };
}

/**
 * @typedef {{ root: string, base: string, prefix: string, trackedSet: Set<string>, findings: string[], notes: string[] }} CheckContext
 */

/**
 * 一覧を読み、--exclude の項目を外す。
 * @param {string} manifestPath
 * @param {string[]} exclude
 * @returns {ManifestArtifact[]}
 */
function selectArtifacts(manifestPath, exclude) {
  // 一覧の形の検査（id の重複・パスの入れ子）は除外の前に全項目へ当てる。
  const declared = readManifest(manifestPath);
  if (declared.length === 0) throw new UsageError(`一覧の artifacts が 0 件: ${manifestPath}`);
  // 除外は緩和の手段なので、閉じた集合にする。一覧に無い id は、綴り違いでも警告なしに何も外さないことになるので、エラーにする。
  const unknown = exclude.filter((id) => !declared.some((a) => a.id === id));
  if (unknown.length > 0) {
    throw new UsageError(
      `--exclude の id が一覧に無い: ${unknown.join(", ")}（一覧=${manifestPath}）`,
    );
  }
  const artifacts = declared.filter((a) => !exclude.includes(a.id));
  if (artifacts.length === 0) {
    throw new UsageError(
      `--exclude で一覧の項目がすべて外れた（何も突き合わせずに合格として扱わない）`,
    );
  }
  return artifacts;
}

/**
 * root が git の作業ツリーの中にあり、比較元の版を解決できることを確かめ、トップレベルから root までの prefix を返す。
 *
 * root がリポジトリのトップレベルとは限らない（.replace が monorepo の一階層下に在る等）。
 * ls-tree はデフォルトで cwd 相対のパスを返す一方、`git show <rev>:<path>` の path はトップレベル起点なので、
 * 揃えずに混在させると、全件が「比較元に無い＝新規」と誤って判定され、突き合わせが 1 件も成立しない。
 * そこで --full-tree でトップレベル起点に揃え、root までの prefix で相互に変換する。
 * @param {string} root
 * @param {string} base
 * @returns {string} 空文字か、`/` で終わる prefix
 */
function repoPrefix(root, base) {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    throw new UsageError(`git リポジトリではないため追記であることを確かめられない: ${root}`);
  }
  const baseRev = git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
  if (baseRev.status !== 0) {
    throw new UsageError(`比較元の版を解決できない: ${base}（${baseRev.stderr.trim()}）`);
  }
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || top.stdout.trim() === "") {
    throw new UsageError(`リポジトリのトップレベルを解決できない: ${root}（${top.stderr.trim()}）`);
  }
  const prefixRel = relative(realpathOrSelf(top.stdout.trim()), realpathOrSelf(root))
    .split(sep)
    .join("/");
  if (prefixRel.startsWith("..") || isAbsolute(prefixRel)) {
    throw new UsageError(
      `--root がリポジトリの外を指している: ${root}（トップレベル ${top.stdout.trim()}）`,
    );
  }
  return prefixRel === "" ? "" : `${prefixRel}/`;
}

/**
 * 比較元の版に在る、root の配下のファイルを、root からの相対パスで返す。
 * 比較元に在って作業ツリーから消えたファイルも対象にする（消失は縮小の極端な形）。
 * @param {string} root
 * @param {string} base
 * @param {string} prefix
 * @returns {string[]}
 */
function trackedFilesAt(root, base, prefix) {
  const tracked = git(root, ["ls-tree", "-r", "--name-only", "--full-tree", "-z", base]);
  if (tracked.status !== 0) {
    throw new UsageError(`比較元の版のファイル一覧を取れない: ${base}（${tracked.stderr.trim()}）`);
  }
  return tracked.stdout
    .split("\0")
    .filter((f) => f !== "" && (prefix === "" || f.startsWith(prefix)))
    .map((f) => f.slice(prefix.length));
}

/**
 * 作業ツリーと比較元のファイルに、一覧の項目を割り当てる。
 * @param {string} root
 * @param {ManifestArtifact[]} artifacts
 * @param {string[]} trackedFiles
 * @returns {Map<string, ManifestArtifact>}
 */
function assignArtifacts(root, artifacts, trackedFiles) {
  /** @type {Map<string, ManifestArtifact>} */
  const byFile = new Map();
  // 同じ木を一覧のパターン数だけ歩かない（.replace/*.md が 4 パターンとも同じ起点になる）。
  /** @type {Map<string, string[]>} */
  const walked = new Map();
  /** @param {string} startRel */
  const listCached = (startRel) => {
    const hit = walked.get(startRel);
    if (hit !== undefined) return hit;
    const files = listFiles(root, startRel);
    walked.set(startRel, files);
    return files;
  };
  for (const artifact of artifacts) {
    const re = globToRegExp(artifact.pattern);
    for (const file of listCached(literalPrefix(artifact.pattern))) {
      if (re.test(file)) assignArtifact(byFile, file, artifact);
    }
    for (const file of trackedFiles) {
      if (re.test(file)) assignArtifact(byFile, file, artifact);
    }
  }
  return byFile;
}

/**
 * ファイルに一覧の項目を割り当てる。突き合わせ方の違う項目が同じファイルに当たったら、使い方の誤りにする。
 * @param {Map<string, ManifestArtifact>} byFile
 * @param {string} file
 * @param {ManifestArtifact} artifact
 */
function assignArtifact(byFile, file, artifact) {
  const prev = byFile.get(file);
  if (prev === undefined) {
    byFile.set(file, artifact);
    return;
  }
  // **同じ項目を 2 度見たときだけ飛ばす**（作業ツリーと比較元の両方から同じ file が来る）。
  // id で飛ばすと、id が重なった別項目の突き合わせ方の食い違いが下の検査に届かず無音で先勝ちになる。
  if (prev === artifact) return;
  if (comparisonDiffers(prev, artifact)) {
    // 先勝ちにすると一覧の並び替えで判定が変わる。突き合わせ方が割れたら止める。
    throw new UsageError(
      `同じファイルに突き合わせ方の違う一覧の項目が当たっている: ${file}（${prev.id}: ${prev.unit} / ${artifact.id}: ${artifact.unit}）`,
    );
  }
}

/**
 * 2 つの項目の突き合わせ方（unit とオプション）が違うか。
 * @param {ManifestArtifact} prev
 * @param {ManifestArtifact} artifact
 * @returns {boolean}
 */
function comparisonDiffers(prev, artifact) {
  return (
    prev.unit !== artifact.unit ||
    prev.arrays.join(",") !== artifact.arrays.join(",") ||
    prev.key !== artifact.key ||
    prev.fillOnly.join(",") !== artifact.fillOnly.join(",") ||
    canonicalJson(prev.transitions) !== canonicalJson(artifact.transitions) ||
    prev.mutableColumns.join(",") !== artifact.mutableColumns.join(",") ||
    prev.fillOnlyColumns.join(",") !== artifact.fillOnlyColumns.join(",") ||
    prev.mutableBullets.join(",") !== artifact.mutableBullets.join(",") ||
    prev.mutableBlocks.join(",") !== artifact.mutableBlocks.join(",") ||
    prev.growableContainers.join(",") !== artifact.growableContainers.join(",") ||
    canonicalJson(prev.registryGroups) !== canonicalJson(artifact.registryGroups) ||
    canonicalJson(prev.pinnedValues) !== canonicalJson(artifact.pinnedValues)
  );
}

/**
 * ファイル 1 つを比較元と突き合わせ、findings と notes に積む。比較元にも在って突き合わせたら true を返す。
 * @param {CheckContext} ctx
 * @param {string} file
 * @param {ManifestArtifact} artifact
 * @returns {boolean}
 */
function compareArtifactFile(ctx, file, artifact) {
  const { root, base, findings } = ctx;
  const before = git(root, ["show", `${base}:${ctx.prefix}${file}`]);
  if (before.status !== 0) {
    if (ctx.trackedSet.has(file)) {
      // 比較元の木に在るのに取り出せない。「新規」として扱うと、縮小を数えられないまま通ってしまう。
      throw new UsageError(
        `比較元 ${base} の木に在るのに内容を取り出せない: ${file}（${before.stderr.trim()}）`,
      );
    }
    ctx.notes.push(`新規（比較元 ${base} に無い）: ${file}`);
    return false;
  }
  const abs = join(root, file);
  if (!existsSync(abs)) {
    findings.push(`追記専用の成果物が消えている: ${file}（比較元 ${base} には在る）`);
    return true;
  }
  const texts = { before: before.stdout, after: readFileSync(abs, "utf8") };
  const labels = { before: `${file}@${base}`, after: file };
  if (artifact.unit === "json-arrays") {
    const pinned = comparePinnedValues(texts, artifact.pinnedValues, labels);
    for (const finding of pinned) findings.push(`${finding}: ${file}`);
  }
  if (artifact.unit === "json-arrays" && artifact.key !== null) {
    // 鍵で対応づけてフィールドごとに見る（多重集合では「鍵以外の書き換え」を表現できない）。
    const keyed = compareKeyedArrays(
      texts,
      {
        arrays: artifact.arrays,
        key: artifact.key,
        fillOnly: artifact.fillOnly,
        transitions: artifact.transitions,
      },
      labels,
    );
    for (const finding of keyed) findings.push(`${finding}: ${file}`);
    return true;
  }
  const lost = lostUnitsFinding(texts, artifact, { file, base });
  if (lost !== null) findings.push(lost);
  return true;
}

/**
 * 比較元に在った単位が現在も残っているかを数え、失われていれば finding を返す。
 * @param {{ before: string, after: string }} texts
 * @param {ManifestArtifact} artifact
 * @param {{ file: string, base: string }} where ファイルの相対パスと比較元の版
 * @returns {string | null}
 */
function lostUnitsFinding(texts, artifact, where) {
  const { file, base } = where;
  /**
   * @type {WrappedContainer[]}
   * 連結しても閉じないフロー形式のコンテナ。**比較元と現在で分けて集める**。
   * 比較元側にあると、比較元の行がそのまま単位なので**どう直しても通らない**（案内の指示が実行できない）。
   * `lines` / `prefixes` は、失われた単位をそのコンテナへ帰属させるための材料。
   */
  const wrappedBefore = [];
  /** @type {WrappedContainer[]} */
  const wrappedAfter = [];
  const beforeUnits = unitsOf(texts.before, artifact, {
    label: `${file}@${base}`,
    wrappedOut: wrappedBefore,
  });
  const afterUnits = unitsOf(texts.after, artifact, { label: file, wrappedOut: wrappedAfter });
  const loss = countLostUnits(beforeUnits, afterUnits, {
    before: wrappedBefore,
    after: wrappedAfter,
  });
  if (loss.count === 0) return null;
  const hint = wrappedHint(loss, base);
  return `追記専用の成果物から ${loss.count} 件（unit: ${artifact.unit}）が失われている: ${file}（例: ${loss.examples.join(" / ")}）${hint}`;
}

/**
 * 失われた単位を数え、読めなかったコンテナのうち、失われた単位を帰属できたもののキーパスを集める。
 * @param {Map<string, number>} beforeUnits
 * @param {Map<string, number>} afterUnits
 * @param {{ before: WrappedContainer[], after: WrappedContainer[] }} wrapped
 * @returns {{ count: number, examples: string[], blamedBefore: Set<string>, blamedAfter: Set<string> }}
 */
function countLostUnits(beforeUnits, afterUnits, wrapped) {
  /** @type {string[]} */
  const examples = [];
  /** @type {Set<string>} 失われた単位を帰属できた、比較元の読めないコンテナのキーパス。 */
  const blamedBefore = new Set();
  /** @type {Set<string>} 同じく現在側。 */
  const blamedAfter = new Set();
  let count = 0;
  for (const [unit, n] of beforeUnits) {
    const now = afterUnits.get(unit) ?? 0;
    if (now >= n) continue;
    count += n - now;
    if (examples.length < 3) examples.push(unit.length > 120 ? `${unit.slice(0, 117)}...` : unit);
    // その消失が読めなかったコンテナ由来か（読みに行った行そのもの、またはそのコンテナの
    // 要素が作る単位）を見る。ファイル単位で案内を出すと無関係な鍵の削除にまで付く。
    blameWrapped(unit, wrapped.before, blamedBefore);
    blameWrapped(unit, wrapped.after, blamedAfter);
  }
  return { count, examples, blamedBefore, blamedAfter };
}

/**
 * 失われた単位が、読めなかったコンテナの読みに行った行か、そのコンテナの要素が作る単位なら、そのキーパスを集める。
 * @param {string} unit
 * @param {WrappedContainer[]} list
 * @param {Set<string>} blamed
 */
function blameWrapped(unit, list, blamed) {
  for (const w of list) {
    if (w.lines.includes(unit) || w.prefixes.some((prefix) => unit.startsWith(prefix))) {
      blamed.add(w.path);
    }
  }
}

/**
 * 読めなかったコンテナに帰属できた消失について、直し方の案内を作る。
 *
 * 折り返されたコンテナがあると、要素を足しただけの編集も**直前の要素の行に付くカンマ**の
 * 書き換えとして縮小に見える。指示どおり復元すると記録した決定が消えるので、
 * 書き直す方向を名指しで案内する。
 * 比較元側に読めないコンテナがあると、比較元の行がそのまま単位なので**どの編集でも通らない**。
 * 「直せば通る」と読める案内を出さず、人の確認で通す方法を示す。
 * **現在側の案内を比較元側で抑止しない**。別の鍵のコンテナをこの変更で壊したなら、それは閉じ直せば
 * 通る部分なので名指しする（抑止すると、閉じ直せば通るコンテナが一度も案内されない）。
 * 同じ鍵が両側に在るときだけ比較元側に寄せる（閉じ直しても比較元の行は戻らない）。
 * @param {{ blamedBefore: Set<string>, blamedAfter: Set<string> }} loss
 * @param {string} base
 * @returns {string}
 */
function wrappedHint(loss, base) {
  const { blamedBefore, blamedAfter } = loss;
  const afterOnly = [...blamedAfter].filter((path) => !blamedBefore.has(path));
  // 直し方は「閉じ括弧を補う」に限る。**1 行へ畳むは示さない**。growable_containers は要素行の
  // 行末注記も単位なので、畳むと注記の単位が消えて落ちる（実測: 追記＋閉じ忘れで lost=5、
  // 1 行へ畳むと lost=1 で案内も消える、閉じ直すと exit 0）。閉じ直しはどの成果物でも通る。
  return (
    (afterOnly.length === 0
      ? ""
      : `\n      閉じていないフロー形式のコンテナがある: ${afterOnly.join(" / ")}` +
        " — 復元せず閉じ括弧を補う（折り返したまま、閉じ括弧までを同じ鍵のブロックに収める）") +
    (blamedBefore.size === 0
      ? ""
      : `\n      比較元 ${base} に閉じていないフロー形式のコンテナがある: ${[...blamedBefore].join(" / ")}` +
        " — この検査では縮んだか判定できない（表記を直しても通らない）。内容を人が確認して通す")
  );
}

/** 同梱の一覧（原本）。 */
export function defaultManifestPath() {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "assets",
    "append-only-manifest.json",
  );
}

/**
 * @param {string[]} argv
 * @returns {{ root: string, manifest: string, base: string, exclude: string[] }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  /** @type {string[]} */
  const exclude = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--exclude") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--") || value.trim() === "") {
        throw new UsageError(`${arg} に値が無い`);
      }
      if (exclude.includes(value)) throw new UsageError(`--exclude の id が重複している: ${value}`);
      exclude.push(value);
      i += 1;
      continue;
    }
    if (arg === "--root" || arg === "--manifest" || arg === "--base") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} に値が無い`);
      opts[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new UsageError(`不明な引数: ${arg}`);
  }
  if (!nonEmptyString(opts.root)) throw new UsageError("--root は必須（走査の起点を推測させない）");
  return {
    root: resolve(opts.root),
    manifest: opts.manifest !== undefined ? resolve(opts.manifest) : defaultManifestPath(),
    base: opts.base ?? "HEAD",
    exclude,
  };
}

/** 使い方（stderr に出す）。 */
const usage = [
  "usage: append-only-check.mjs --root <dir> [--manifest <path>] [--base <rev>] [--exclude <id>]...",
  "  --root      リポジトリルート（必須。走査の起点を推測させない）",
  "  --manifest  追記専用の成果物の一覧（既定: スキル同梱の assets/append-only-manifest.json）",
  "  --base      比較元の版（既定: HEAD）",
  "  --exclude   突き合わせない一覧の項目の id（繰り返し可。一覧に無い id・全項目の除外は exit 2）",
  "exit: 0 = 縮んでいない / 1 = 単位が失われている・成果物が消えている・比較元に在る成果物が 0 件 / 2 = 使い方の誤り・判定不能・作業ツリーの対象 0 件",
].join("\n");

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  try {
    const args = parseArgs(argv);
    const { findings, notes } = check({
      root: args.root,
      manifestPath: args.manifest,
      base: args.base,
      exclude: args.exclude,
    });
    for (const note of notes) process.stdout.write(`note: ${note}\n`);
    for (const finding of findings) process.stdout.write(`warn: ${finding}\n`);
    if (findings.length > 0) {
      process.stdout.write(
        `error: 追記専用の成果物が ${findings.length} 件で縮んでいる — 過去の決定が失われている\n`,
      );
      return 1;
    }
    process.stdout.write(`ok: 追記専用の成果物は縮んでいない（append-only-check ${VERSION}）\n`);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`error: ${e.message}\n${usage}\n`);
      return 2;
    }
    throw e;
  }
}

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
