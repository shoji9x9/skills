// 追記専用（非破壊追記）の成果物が縮んでいないことを git の履歴と突き合わせて確かめる（正本）。
//
// スキル群は決定を積み上げる成果物を持ち、そこへの書き込みを「非破壊追記」と定めているが、
// 追記であることを確かめる道具が無いと、積み上げた文書を丸ごと書き直しても何も落ちない。
// 失われるのは過去の決定（なぜ許容したのか・いつ誰が承認したのか）で、現在の状態しか見ない
// 収束判定は通ってしまう。
//
// 何をするか:
//   1. 追記専用の成果物を機械可読な一覧（assets/append-only-manifest.json）から読む
//   2. 一覧のパターンに一致する追跡ファイルを列挙し、比較元の版（既定 HEAD）の内容を git から取る
//   3. 比較元に在った「単位」が現在も全部残っているかを数える（多重度まで見る）
//   4. 比較元に在ったファイルが消えていれば落とす
//
// 突き合わせの単位は一覧の unit で決める。全部を行として比べると、正本が明示的に求めている
// その場の更新（版の +1・状態列の 未→済・Issue 列の 未起票→番号・最終更新の日時）が
// 「失われた行」に化け、決定を 1 つも捨てていない成果物で収束が止まる:
//   - lines（既定）: 空白を畳んだ行の多重集合。書き換えず積み上げるだけの台帳に使う。
//     正本が**移動を定めている**領域（設定ファイルの intentional_diffs は棚卸しで人が pending の文言を
//     keep / may_change へ移す）は registry_groups に鍵のグループを挙げて要素の単位へ展開する。
//     mutable_blocks（配下を単位から外す）は、その削除を誰も数えなくてよい領域にだけ使う
//   - markdown-structure: 見出し・表の列名・表の行（先頭セルを鍵にする）・定義箇条書きの鍵・
//     それ以外の散文行。セルの値と箇条書きの値はその場で更新してよいが、行・列・節は消せない
//   - json-arrays: arrays に挙げた配列の要素（深い等価）。version のようなスカラは更新してよいが、
//     積み上げた要素（changes[] / component_diff_exceptions[]）は消せない。
//     要素の同一性を深い等価で取るので、2 つの要素の間でフィールドを入れ替える書き換え
//     （どの例外を誰がいつ承認したかの付け替え）も縮小として落ちる。
//     key を指定した配列は鍵で要素を対応づけ、フィールドごとに突き合わせる。既定は「鍵以外は不変」で、
//     正本が更新を認めている項目だけを fill_only（空 → 非空だけ。既に入っている値の差し替えは落とす）と
//     transitions（明示した <変更前>-><変更後> だけ。unmeasured.entries の blocking->accepted）で開ける。
//     markdown-structure の表の行も同様に、鍵（先頭セル）だけでなく行 × 列のセルを単位にし、
//     正本がその場の更新を定めている列だけ mutable_columns で外す（鍵だけだと残りのセルが自由に書き換わる）。
//     同じ鍵の行は出現順で区別する（区別しないと、同じ鍵の 2 行の間でセルを入れ替えても単位が変わらない）
//
// 行の突き合わせは空白を畳んで（連続する空白を 1 つに、前後を除去して）から行う——
// Markdown の表はフォーマッタが桁を詰め直すため、素の文字列比較では整形だけで落ちる。
// 空行は比較しない（節の間隔は決定ではない）。
//
// 行が単位のときだけ、「フロー形式のコンテナ（key: [a, b]）が育った」ことによる行の書き換えを縮小に数えない——
// 空リストとして作られるキーへ最初の要素を足す書き手は必ずこの形を通り（intentional_diffs.pending /
// keep / may_change / component_diffs）、棚卸しで pending から keep へ移した文言も keep の行の書き換えになる。
// 緩めるのは元の要素がすべて現在側にも在るときだけで、要素を 1 つでも落とせば落ちる。
//
// 何をしないか: 追記の中身の妥当性は見ない。消えていないことだけを数える。
//
// fail-closed: git が使えない・比較元の版を読めない・対象 0 件・一覧の unit が語彙外・
//              比較元の木に在るのに内容を取り出せないファイルは合格に倒さない（exit 2）。
//
// 決定論的: 乱数・現在時刻に依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定ロジック・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "9";

/** 走査で辿らないディレクトリ名。 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** 突き合わせの単位（一覧の unit）。 */
export const UNITS = ["lines", "markdown-structure", "json-arrays"];

/**
 * 一覧に書くキーパスの形（ルートからの完全なパス）。`-` だけのセグメントは
 * リスト要素へ積むマーカーと同じ綴りなので拒む——名指しすると全リスト要素が同じ鍵を共有し、
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
 * @param {unknown} v
 * @returns {boolean}
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

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
 * YAML のキーパス（ドット区切り）で指定したブロック——そのキー行と配下——を落とす。
 *
 * 追記専用の契約は「積み上げた決定を消さない」ことだが、**正本が削除を定めている領域**が
 * 同じファイルに混ざることがある（設定ファイルの `intentional_diffs.pending` は、棚卸しで人が
 * `keep` / `may_change` へ文言を移すため要素が減るのが正規の運用）。行の多重集合で見ると、この移動は
 * 「`item` / `slug` / `added_by` / `added_at` の 4 行が失われた」に化け、**正しく棚卸しした実行が落ちる**。
 * 落ちたあと指示どおり復元すると、記録した保留が消える（データを失う方向へ誘導される）。
 * そこで一覧の mutable_blocks に挙げたキーパスの**配下**だけを単位から外し、キー行は鍵だけの単位
 * （`<mutable-block: <パス>>`）へ畳む——キーを丸ごと消した破壊は落ち、表現の揺れ（`pending: []` ⇄ `pending:`。
 * 棚卸しは要素が増える方向にも減る方向にも動く）では落ちない。
 *
 * **外した領域の要素の消失には検出主体が無い。** `pending-triage-check.mjs` は**現在の** `pending` を母集合にするので、
 * 棚卸しを経ずに丸ごと消された要素はそもそも対象にならない（`parity-diff` の棚卸しも同じ母集合を読む）。
 * 「別の工程が数える」に委ねると、保留の記録を黙って消せる状態になる——だから `intentional_diffs.pending` は
 * このオプションではなく `registry_groups` で扱う（鍵をまたぐ移動は通し、どの鍵にも無くなったときだけ落ちる）。
 * `mutable_blocks` を使ってよいのは、**配下の削除を誰も数えなくてよいと正本が定めている**領域だけ。
 *
 * あわせて `growable_containers` に挙げたキーパスのフロー形式コンテナを**要素ごとの単位へ展開する**
 * （`keep: ["a", "b"] # c` → 鍵の単位 1 つと要素の単位 2 つ）。要素を足すと単位が増えるだけなので通り、
 * 要素を落とせば単位が失われて落ちる。**緩和を鍵で名指しするのはここだけ**——
 * 行の多重集合は同名の兄弟（`targets[].forbidden_actions` 等）を 1 つの鍵に畳むので、
 * 鍵を名指しせずに「育った」を判定すると、**兄弟の間で要素が移動しただけの編集**（片方を空にして
 * もう片方へ足す）まで通る。名指ししたパスは文書内で一意なので、この取り違えが起きない。
 *
 * **YAML のパーサは持たない**（配布スキルに依存を増やさないため）。インデントでブロックを切るので、
 * 意図的に見ていないものがある: ブロックスカラー（`|` / `>`）は本文をキー行として読まないよう配下ごと飛ばし、
 * リスト要素（`- …`）は配下のキーが親のパスを継がないようマーカーを積むが、
 * アンカー・別名・複数文書（`---`）・フロー形式の入れ子（`{ a: { b: [] } }`）は解釈しない。
 * 解釈できなかったパスは対象に一致しないので、**検査は厳しい側（行が単位のまま）へ倒れる**。
 * @param {string} text
 * @param {string[]} blocks 単位から外すキーパス。**ルート（文書の先頭）からの完全なパス**で書く——
 *   部分一致・末尾一致では引かないので、実在の入れ子（例: skills.replace-strategy.intentional_diffs.pending）を書く
 * @param {string[]} [growable] 要素ごとの単位へ展開するキーパス（同じくルートからの完全なパス）
 * @returns {string} 変換後の行を改行で連結したもの
 */
export function stripYamlBlocks(text, blocks, growable = [], registryGroups = []) {
  if (blocks.length === 0 && growable.length === 0 && registryGroups.length === 0) return text;
  // 実在の行と衝突しない形にする（YAML のキーにこの綴りは現れない）。
  const targets = new Set(blocks.map((b) => b.trim()));
  const growableTargets = new Set(growable.map((b) => b.trim()));
  /** @type {Map<string, string>} キーパス → グループ id */
  const registryPaths = new Map();
  /** @type {Map<string, string>} グループ id → 要素の照合キー */
  const registryItemKeys = new Map();
  for (const group of registryGroups) {
    registryItemKeys.set(group.id, group.itemKey);
    for (const path of group.paths) registryPaths.set(path.trim(), group.id);
  }
  /**
   * @type {{ id: string, indent: number, itemKey: string, current: string[] | null } | null}
   * ブロック形式のレジストリを読み進めている状態（`current` は読みかけの要素の行）
   */
  let registry = null;
  /** 読みかけの要素を確定して単位へ落とす。 */
  const flushRegistryItem = () => {
    if (registry === null || registry.current === null) return;
    const lines = registry.current;
    registry.current = null;
    const prefix = `${registry.itemKey}:`;
    /** @type {string | null} */
    let value = null;
    for (const line of lines) {
      const { code } = splitTrailingComment(line);
      if (value === null && code.startsWith(prefix)) value = code.slice(prefix.length).trim();
    }
    // **要素の行末コメントは単位にしない**（キー行のコメントは守るのと非対称）。
    // 要素は鍵をまたいで移動する設計で、移動先（`keep: ["<文言>"]`）に注記の置き場所が無い。
    // 守ると、注記の付いた要素を棚卸ししただけで縮小に化ける（#426 の誤検出が再発し、
    // 指示どおり復元すると保留の記録が消える）。注記を消せることと引き換えに、正規の棚卸しを通す。
    // 照合キーが見つからない要素は素のスカラ（`- <文言>`）として読む。
    if (value === null) {
      const { code } = splitTrailingComment(lines[0] ?? "");
      value = code;
    }
    if (value !== "") kept.push(`${REGISTRY_ITEM_PREFIX}${registry.id}> ${unquote(value)}`);
  };
  /** @type {{ indent: number, key: string }[]} 現在のキーパス */
  const stack = [];
  /** @type {string[]} */
  const kept = [];
  /** @type {number | null} 除外中のブロックを開いたキー行のインデント */
  let excludeIndent = null;
  /** @type {number | null} ブロックスカラーの本文を飛ばす基準インデント */
  let scalarIndent = null;
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    // 空行・コメントは構造に属さないので**ブロックを閉じない**——閉じると、間にコメントを挟んだだけで
    // 除外が切れ、続きの行が単位に戻る（設定ファイルのテンプレートは要素の書き方をコメントで示す）。
    const structural = trimmed !== "" && !trimmed.startsWith("#");
    if (scalarIndent !== null) {
      if (structural && indent <= scalarIndent) scalarIndent = null;
      else {
        if (excludeIndent === null) kept.push(raw);
        continue;
      }
    }
    if (excludeIndent !== null) {
      // 空行・コメントは**ブロックを閉じないが、単位からも落とさない**——落とすと、外した領域の後ろに続く
      // コメント（次の構造行までは閉じないので配下として扱われる）が黙って消せるようになる。
      // 設定ファイルの正本は「既存のキー・値・コメントは変更しない」を要求しているので、コメントは守る側に残す。
      if (!structural) {
        kept.push(raw);
        continue;
      }
      // リスト要素は親キーと同じインデントに置けるので、`- ` で始まる同インデントの行は配下として扱う。
      const listItem = trimmed === "-" || trimmed.startsWith("- ");
      const closes = indent < excludeIndent || (indent === excludeIndent && !listItem);
      if (!closes) continue;
      excludeIndent = null;
    }
    if (registry !== null) {
      if (!structural) {
        kept.push(raw);
        continue;
      }
      const listItem = trimmed === "-" || trimmed.startsWith("- ");
      const closes = indent < registry.indent || (indent === registry.indent && !listItem);
      if (!closes) {
        if (listItem) {
          flushRegistryItem();
          registry.current = [trimmed === "-" ? "" : trimmed.slice(2).trim()];
        } else if (registry.current !== null) {
          // 要素の追随行。**照合キーは 1 行目とは限らない**（YAML のキー順は自由）ので、
          // 要素の全行を集めてから探す。追随フィールド（`slug` / `added_by` 等）は
          // 棚卸しの移動先に無いので単位にはしない。
          registry.current.push(trimmed);
        } else {
          // リストではない構造（マッピング等）。解釈できないので**行のまま単位に残す**
          // （捨てると配下を丸ごと消しても通る。他の解釈不能ケースと同じく厳しい側へ倒す）。
          kept.push(raw);
        }
        continue;
      }
      flushRegistryItem();
      registry = null;
    }
    if (!structural) {
      kept.push(raw);
      continue;
    }
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const m = /^([A-Za-z0-9_.-]+):(\s.*|)$/.exec(trimmed);
    // リスト要素（`- …`）は**マーカーを積む**。積まないと、その配下のキーが親のパスを継ぎ、
    // `intentional_diffs:` がリストだった場合の `- name: a` 配下の `pending:` が
    // `intentional_diffs.pending` として外れる（外しすぎ）。`-` はキーに現れないので衝突しない。
    if (trimmed === "-" || trimmed.startsWith("- ")) {
      stack.push({ indent, key: "-" });
      kept.push(raw);
      continue;
    }
    if (m === null) {
      kept.push(raw);
      continue;
    }
    const key = m[1];
    const path = [...stack.map((s) => s.key), key].join(".");
    stack.push({ indent, key });
    if (targets.has(path)) {
      // 配下は外すが、**キーが在り続けること自体は単位に残す**——行ごと外すと、キーを丸ごと消した破壊が
      // 「外した領域」に紛れて通る。ただし行そのものを残すと表現の揺れ（`pending: []` ⇄ `pending:`）で落ちる。
      // 棚卸しは要素が増える方向にも減る方向にも動くので、**鍵だけの単位へ畳む**。
      excludeIndent = indent;
      kept.push(`${MUTABLE_BLOCK_PREFIX}${path}>`);
      // 行末コメントは畳まず単位に残す——一覧の requirement は「既存のキー・値・コメントは変更しない」で、
      // 外すのは配下の**要素**だけ。畳むとキー行に付いた注記だけが黙って消せるようになる
      // （別行のコメントは守られるので、残さないと同じファイルの中で非対称になる）。
      const { comment } = splitTrailingComment(trimmed);
      if (comment !== "") kept.push(comment);
      continue;
    }
    const registryId = registryPaths.get(path);
    if (registryId !== undefined) {
      const { code, comment } = splitTrailingComment(trimmed);
      const value = code.slice(key.length + 1).trim();
      const items =
        value === ""
          ? []
          : value.startsWith("[") || value.startsWith("{")
            ? flowItems(value)
            : null;
      // 読めない値・スカラは展開せず行のまま（厳しい側へ倒す）。
      if (items === null) {
        kept.push(raw);
        continue;
      }
      // 鍵の存在は鍵ごとの単位で守り、要素は**グループ共通の単位**にする——
      // 棚卸しで `pending` の文言が `keep` / `may_change` へ移るのは正規の運用なので鍵をまたいで同じ単位にし、
      // どの鍵にも無くなった（黙って消された）ときだけ単位が失われるようにする。
      kept.push(`${REGISTRY_PREFIX}${path}>`);
      if (comment !== "") kept.push(comment);
      const flowItemKey = registryItemKeys.get(registryId) ?? "item";
      for (const item of items) {
        kept.push(`${REGISTRY_ITEM_PREFIX}${registryId}> ${registryItemValue(item, flowItemKey)}`);
      }
      if (value === "") {
        registry = {
          id: registryId,
          indent,
          itemKey: registryItemKeys.get(registryId) ?? "item",
          current: null,
        };
      }
      continue;
    }
    if (growableTargets.has(path)) {
      const { code, comment } = splitTrailingComment(trimmed);
      const value = code.slice(key.length + 1).trim();
      const items =
        value.startsWith("[") || value.startsWith("{")
          ? flowItems(value)
          : value === ""
            ? []
            : null;
      if (items !== null) {
        // 鍵（＋行末コメント）と要素を別々の単位にする。要素を足すと単位が増えるだけで通り、
        // 落とすと単位が失われて落ちる。値がフロー形式でない（ブロック形式・スカラ）ときは展開せず行のまま。
        kept.push(`${GROWABLE_PREFIX}${path}>`);
        // 行末コメントは**鍵の単位に連結せず独立した単位にする**——連結すると、同じ注記を上の行へ
        // 出しただけの編集が「単位の消失」になり、mutable_blocks 側（独立した単位）と非対称になる。
        if (comment !== "") kept.push(comment);
        for (const item of items) kept.push(`${GROWABLE_ITEM_PREFIX}${path}> ${item}`);
        continue;
      }
    }
    // ブロックスカラー指示子は `|2-` / `|-2` のようにインデント指示子とチョップ指示子が任意の順に付く。
    // 取りこぼしても**外れる側には倒れない**——本文はスカラのキーの配下にあるので、本文行をキーとして
    // 読んでもパスにそのキー名（`note.` 等）が入り、対象のキーパスとは一致しないため
    // （実測で再現を作れなかったので回帰テストは置いていない。ここは仕様への準拠として直してある）。
    if (/^[|>](?:[-+]?\d*|\d*[-+]?)$/.test(m[2].trim())) scalarIndent = indent;
    kept.push(raw);
  }
  flushRegistryItem();
  return kept.join("\n");
}

/**
 * 行を突き合わせ用に正規化する（空白を畳む。空行は落とす）。
 * @param {string} text
 * @param {string[]} [mutableBlocks] 単位から外す YAML のキーパス（上記 stripYamlBlocks）
 * @param {string[]} [growableContainers] 要素ごとの単位へ展開する YAML のキーパス（同上）
 * @returns {Map<string, number>} 正規化した行 → 出現回数
 */
export function normalizeLines(
  text,
  mutableBlocks = [],
  growableContainers = [],
  registryGroups = [],
) {
  const src =
    mutableBlocks.length === 0 && growableContainers.length === 0 && registryGroups.length === 0
      ? text
      : stripYamlBlocks(text, mutableBlocks, growableContainers, registryGroups);
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "") continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/**
 * フロー形式のコンテナ（`[a, "b"]` / `{}`）の要素を取り出す。
 *
 * 入れ子・引用符を数えるだけの簡易スキャナで、YAML の全機能（アンカー・別名・複数行）は解釈しない。
 * **読み切れなければ `null`**（判定不能）を返し、呼び出し側は厳しい側＝縮小として扱う。
 * @param {string} raw `[` か `{` で始まり対応する括弧で終わる文字列
 * @returns {string[] | null}
 */
export function flowItems(raw) {
  const inner = raw.slice(1, -1).trim();
  if (inner === "") return [];
  /** @type {string[]} */
  const items = [];
  let depth = 0;
  /** @type {string | null} */
  let quote = null;
  let cur = "";
  for (const ch of inner) {
    if (quote !== null) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    // 引用符は**値の開始**でだけ開く。`opensQuoteAt` と同じ判定を同じ実装（`opensQuoteAfter`）で行う——
    // 「要素の先頭」に狭めると、マッピングの値（`{item: "…"}`）では引用符が直前の `item:` に阻まれて開かず、
    // 値の中のカンマがペアの区切りに化ける（`registryItemValue` が単位を `"順序は id` のような断片へ畳み、
    // 棚卸しが落ち、文言の差し替えが無音で通る）。`don't` のアポストロフィは値の途中なので今までどおり値の一部。
    if ((ch === '"' || ch === "'") && opensQuoteAfter(cur)) {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      items.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  // 引用符・括弧が閉じていない（1 行に収まっていない値）。読めたことにしない。
  if (quote !== null || depth !== 0) return null;
  items.push(cur);
  return items
    .map((v) => {
      const t = v.trim();
      const quoted =
        t.length >= 2 &&
        ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")));
      return quoted ? t.slice(1, -1) : t;
    })
    .filter((x) => x !== "");
}

/**
 * フロー形式の登録要素から照合キーの値を取り出す。
 *
 * ブロック形式は flushRegistryItem が `item_key:` の行を探すが、フロー形式
 * （`pending: [{item: <文言>, slug: …}]`）は 1 要素が 1 つの文字列として返るので、同じ抜き出しをここで行う。
 * 行わないとマッピング全文が単位になり、追随フィールド（`slug` / `added_by` / `added_at`）ごと突き合わせることになって、
 * 棚卸しで鍵をまたいで移した要素（移動先に追随フィールドは無い）が「失われた」に化ける——
 * ブロック形式で通る棚卸しが表記を変えただけで落ちる非対称が残り、#426 の誤検出がフロー表記のまま生き残る。
 * @param {string} raw 要素のテキスト（flowItems が引用符を剥がした後）
 * @param {string} itemKey 照合キー
 * @returns {string} 単位にする値
 */
function registryItemValue(raw, itemKey) {
  const t = raw.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return unquote(t);
  const pairs = flowItems(t);
  // 読めないマッピング・照合キーの無いマッピングは**全文を単位に残す**（他の解釈不能ケースと同じく厳しい側へ倒す。
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
 * コメントも値も読めないまま緩和が無音で外れる。逆に「閉じなければ引用符を無視して取り直す」形にすると、
 * **同じ値でも同じ行の別の要素次第でモードが変わり**、比較元と現在で読み方が割れる
 * （`["a, b"]` は 1 要素、`["a, b", don't]` は 3 要素に割れて、要素を足しただけで縮小に見える）。
 * そこで直前の非空白文字で判定する——値の開始（行頭・`:`・`,`・`[`・`{` の直後）だけを開き引用符にする。
 * @param {string} line
 * @param {number} i
 * @returns {boolean}
 */
function opensQuoteAt(line, i) {
  return opensQuoteAfter(line.slice(0, i));
}

/**
 * 直前までのテキストを見て、次に来る引用符が**値の開始**かを判定する（`opensQuoteAt` と `flowItems` の共通の正本）。
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
 * Markdown の構造単位を数える。
 *
 * 落とさせない相手は「節・列・行・行の決定内容・箇条書きの鍵・散文」。
 * 行の同一性は先頭セル（slug・種類・箇所などの鍵）で見るが、**鍵だけを残すと残りのセルが
 * 自由に書き換えられる**（決定の出どころ・方針・理由を丸ごと差し替えても行は在る）。
 * そこで行 × 列のセルも単位にし、正本がその場の更新を定めている列だけ mutableColumns で外す。
 * 列を足す非破壊更新は新しい単位が増えるだけなので落ちない。
 * 箇条書きも鍵と値の両方を守り、正本が更新を定めている項目だけ mutableBullets で外す。散文は行そのもの。
 * @param {string} text
 * @param {string[]} [mutableColumns] 値の更新を正本が認めている列名（"*" でセルを契約の対象外）
 * @param {string[]} [mutableBullets] 値の更新を正本が認めている箇条書きの鍵（"*" で値を契約の対象外）
 * @returns {Map<string, number>} 単位 → 出現回数
 */
export function markdownUnits(text, mutableColumns = [], mutableBullets = []) {
  const mutable = new Set(mutableColumns.map((c) => c.trim()));
  const mutableBullet = new Set(mutableBullets.map((c) => c.trim()));
  // "*" は「中身は契約の対象外」（一覧の requirement が節・列・行・ヘッダ項目だけを守ると定めている成果物）。
  const allCellsMutable = mutable.has("*");
  const allBulletsMutable = mutableBullet.has("*");
  /** @type {Map<string, number>} 同じ鍵の箇条書きが何度目か */
  const bulletOccurrences = new Map();
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @param {string} key */
  const add = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);

  /** @type {string[]} */
  const headings = [];
  /** @type {string[]} */
  let columns = [];
  /** @type {Map<string, number>} 同じ鍵の行が何度目か */
  const rowOccurrences = new Map();
  let tableIndex = -1;
  let inTable = false;
  for (const raw of text.split("\n")) {
    const line = normalizeLine(raw);
    if (line === "") {
      inTable = false;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1].length;
      headings.length = Math.min(headings.length, level - 1);
      while (headings.length < level - 1) headings.push("");
      headings.push(heading[2].trim());
      tableIndex = -1;
      inTable = false;
      add(`H:${headings.join(" > ")}`);
      continue;
    }
    const path = headings.join(" > ");
    if (line.startsWith("|") && line.endsWith("|")) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue; // 区切り行は列を足すと変わる
      const cells = tableCells(line);
      if (!inTable) {
        inTable = true;
        tableIndex += 1;
        columns = cells;
        for (const cell of cells) add(`C:${path}#${tableIndex}|${cell}`);
        continue;
      }
      const rowKey = cells[0] ?? "";
      add(`R:${path}#${tableIndex}|${rowKey}`);
      // 同じ鍵の行は出現順で区別する。区別しないと列ごとの多重集合になり、
      // 同じ鍵を持つ 2 行の間でセルを入れ替えても単位が変わらない
      // （assets.md は方針を覆した行と現在の行が同じ「種類」で 2 行並ぶ——正本が想定する形）。
      // 追記専用の台帳なので既存行の並びは変わらず、出現順は安定した識別子になる。
      const seenKey = `${path}#${tableIndex}|${rowKey}`;
      const occurrence = rowOccurrences.get(seenKey) ?? 0;
      rowOccurrences.set(seenKey, occurrence + 1);
      if (!allCellsMutable) {
        for (const [i, cell] of cells.entries()) {
          if (i === 0) continue; // 先頭セルは鍵そのもの
          const column = columns[i] ?? `#${i}`;
          if (mutable.has(column)) continue; // 正本がその場の更新を定めている列
          add(`R:${seenKey}@${occurrence}|${column}=${cell}`);
        }
      }
      continue;
    }
    inTable = false;
    const bullet = /^[-*+]\s+([^:：]{1,80})[:：](.*)$/.exec(line);
    if (bullet !== null) {
      // 鍵は強調・コードの記号を落として安定させる（`- **インスタンス件数**:` と `- インスタンス件数:` を同じ鍵にする）。
      const bulletKey = bullet[1].trim().replace(/^[*`\s]+|[*`\s]+$/g, "");
      add(`B:${path}|${bulletKey}`);
      if (!allBulletsMutable && !mutableBullet.has(bulletKey)) {
        // 鍵だけを守ると値（決定の中身）が自由に書き換わる。
        // 正本がその場の更新を定めている項目だけ mutable_bullets で外す。
        const seenBullet = `${path}|${bulletKey}`;
        const n = bulletOccurrences.get(seenBullet) ?? 0;
        bulletOccurrences.set(seenBullet, n + 1);
        add(`B:${seenBullet}@${n}=${bullet[2].trim()}`);
      }
      continue;
    }
    add(`L:${line}`);
  }
  return counts;
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
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * JSON の指定した配列の要素を数える。
 * @param {string} text
 * @param {string[]} paths
 * @param {string} label 失敗メッセージ用（ファイル名＋版）
 * @param {string | null} [key] 指定すると要素そのものではなくこの項目の値を同一性にする
 * @returns {Map<string, number>} 単位 → 出現回数
 */
export function jsonArrayUnits(text, paths, label, key = null) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new UsageError(
      `JSON として読めないため追記であることを確かめられない: ${label}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const path of paths) {
    const value = atPath(parsed, path);
    if (value === undefined || value === null) continue; // まだ無い＝積み上げた要素も無い
    if (!Array.isArray(value)) {
      throw new UsageError(`一覧が配列と宣言した ${path} が配列でない: ${label}`);
    }
    for (const element of value) {
      let unit;
      if (key === null) {
        unit = `${path}|${canonicalJson(element)}`;
      } else {
        // 鍵が引けない要素を素通りさせない（全要素が同じ鍵へ潰れて 1 件が全件を満たす形を作らない）。
        if (!isPlainObject(element) || !nonEmptyString(element[key])) {
          throw new UsageError(
            `一覧が key: ${key} と宣言した ${path} の要素に、空でない文字列の ${key} が無い: ${label}`,
          );
        }
        unit = `${path}|${key}=${String(element[key]).trim()}`;
      }
      counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * JSON の指定した配列を鍵で対応づけ、フィールド単位で突き合わせる。
 *
 * 鍵だけを同一性にすると、鍵以外のフィールドが自由に書き換えられる（承認済みの項目の
 * 理由・承認者・承認日時を差し替えても鍵は残る）。そこで既定は「鍵以外は不変」にし、
 * 正本が更新を定めている項目だけを fill_only（空 → 非空だけ）と transitions（明示した値の遷移だけ）で開ける。
 * @param {string} beforeText
 * @param {string} afterText
 * @param {{ arrays: string[], key: string, fillOnly: string[], transitions: Record<string, string[]> }} artifact
 * @param {{ before: string, after: string }} labels
 * @returns {string[]} findings
 */
export function compareKeyedArrays(beforeText, afterText, artifact, labels) {
  /** @type {string[]} */
  const findings = [];
  const fillOnly = new Set(artifact.fillOnly);
  for (const path of artifact.arrays) {
    const before = keyedElements(beforeText, path, artifact.key, labels.before);
    const after = keyedElements(afterText, path, artifact.key, labels.after);
    for (const [key, baseList] of before) {
      const nowList = after.get(key) ?? [];
      if (nowList.length < baseList.length) {
        findings.push(
          `${path} の要素が失われている（${artifact.key}=${key}: 比較元 ${baseList.length} 件 → 現在 ${nowList.length} 件）`,
        );
      }
      // 同じ鍵が複数ある場合は並び順で対応づける（追記専用なので既存の並びは変わらない）。
      for (const [i, baseElement] of baseList.entries()) {
        const nowElement = nowList[i];
        if (nowElement === undefined) continue; // 件数の減少は上で数えた
        for (const field of Object.keys(baseElement)) {
          const from = baseElement[field];
          const to = nowElement[field];
          if (canonicalJson(from) === canonicalJson(to)) continue;
          const allowed = artifact.transitions[field];
          if (allowed !== undefined) {
            if (allowed.includes(`${stringify(from)}->${stringify(to)}`)) continue;
            findings.push(
              `${path} の ${field} が宣言に無い遷移で書き換えられている（${artifact.key}=${key}: ${stringify(from)} → ${stringify(to)}）`,
            );
            continue;
          }
          if (fillOnly.has(field)) {
            // 空 → 非空（記録の充填）だけ許す。既に入っている値の差し替えは決定の書き換え。
            if (!nonEmptyValue(from)) continue;
            findings.push(
              `${path} の ${field} が空でない値から書き換えられている（${artifact.key}=${key}: ${stringify(from)} → ${stringify(to)}）`,
            );
            continue;
          }
          findings.push(
            `${path} の ${field} が書き換えられている（${artifact.key}=${key}: ${stringify(from)} → ${stringify(to)}）`,
          );
        }
      }
    }
  }
  return findings;
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
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * 配列を鍵ごとの要素リストにする。
 * @param {string} text
 * @param {string} path
 * @param {string} key
 * @param {string} label
 * @returns {Map<string, Record<string, unknown>[]>}
 */
function keyedElements(text, path, key, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new UsageError(
      `JSON として読めないため追記であることを確かめられない: ${label}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
  /** @type {Map<string, Record<string, unknown>[]>} */
  const out = new Map();
  const value = atPath(parsed, path);
  if (value === undefined || value === null) return out;
  if (!Array.isArray(value))
    throw new UsageError(`一覧が配列と宣言した ${path} が配列でない: ${label}`);
  for (const element of value) {
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
 * 一覧の unit に従って単位を数える。
 * @param {string} text
 * @param {{ unit: string, arrays: string[], key?: string | null, mutableColumns?: string[], mutableBullets?: string[], mutableBlocks?: string[] }} artifact
 * @param {string} label
 * @returns {Map<string, number>}
 */
export function unitsOf(text, artifact, label) {
  if (artifact.unit === "markdown-structure") {
    return markdownUnits(text, artifact.mutableColumns ?? [], artifact.mutableBullets ?? []);
  }
  if (artifact.unit === "json-arrays") {
    return jsonArrayUnits(text, artifact.arrays, label, artifact.key ?? null);
  }
  return normalizeLines(
    text,
    artifact.mutableBlocks ?? [],
    artifact.growableContainers ?? [],
    artifact.registryGroups ?? [],
  );
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
 * 一覧を読む。
 * @param {string} manifestPath
 * @returns {{ id: string, pattern: string, unit: string, arrays: string[], key: string | null, fillOnly: string[], transitions: Record<string, string[]>, mutableColumns: string[], mutableBullets: string[], mutableBlocks: string[], growableContainers: string[], registryGroups: { id: string, itemKey: string, paths: string[] }[], requirement: string, source: string }[]}
 */
export function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) throw new UsageError(`一覧が無い: ${manifestPath}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new UsageError(
      `一覧が JSON として壊れている: ${manifestPath}（${e instanceof Error ? e.message : String(e)}）`,
    );
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.artifacts)) {
    throw new UsageError(`一覧に artifacts 配列が無い: ${manifestPath}`);
  }
  /** @type {Set<string>} */
  const seenIds = new Set();
  return parsed.artifacts.map((a, i) => {
    if (!isPlainObject(a)) throw new UsageError(`artifacts[${i}] がオブジェクトでない`);
    if (!nonEmptyString(a.id) || !nonEmptyString(a.pattern)) {
      throw new UsageError(`artifacts[${i}] の id / pattern が空`);
    }
    // **id は一覧の中で一意**——重複を許すと「同じ id なら同じ項目」という前提が崩れ、
    // 同じファイルに当たった突き合わせ方の違う 2 項目が無音で先勝ちに決まる
    // （緩い規則＝mutable_columns の多い方が先に来ると、厳しい規則が守るはずの列への破壊的編集が検出から外れる）。
    const id = String(a.id).trim();
    if (seenIds.has(id)) {
      throw new UsageError(
        `artifacts[${i}] の id が一覧の中で重複している: ${id}（突き合わせ方の食い違いが無音で先勝ちに決まる）`,
      );
    }
    seenIds.add(id);
    // unit を持たない旧い一覧は lines（このツールの初版の突き合わせ方）として読む。
    const unit = a.unit === undefined || a.unit === null ? "lines" : a.unit;
    if (!UNITS.includes(/** @type {string} */ (unit))) {
      throw new UsageError(
        `artifacts[${i}] の unit が語彙外（${UNITS.join(" / ")}）: ${JSON.stringify(a.unit)}`,
      );
    }
    /** @type {string[]} */
    let arrays = [];
    /** @type {string | null} */
    let key = null;
    /** @type {string[]} */
    let fillOnly = [];
    /** @type {Record<string, string[]>} */
    const transitions = {};
    /** @type {string[]} */
    let mutableColumns = [];
    /** @type {string[]} */
    let mutableBullets = [];
    /** @type {string[]} */
    let mutableBlocks = [];
    /** @type {string[]} */
    let growableContainers = [];
    /** @type {{ id: string, itemKey: string, paths: string[] }[]} */
    let registryGroups = [];
    if (unit === "json-arrays") {
      if (!Array.isArray(a.arrays) || a.arrays.length === 0) {
        throw new UsageError(`artifacts[${i}] の unit が json-arrays なのに arrays が空`);
      }
      for (const path of a.arrays) {
        if (!nonEmptyString(path)) throw new UsageError(`artifacts[${i}].arrays に空の要素がある`);
      }
      arrays = a.arrays.map((x) => String(x).trim());
      if (a.key !== undefined && a.key !== null) {
        if (!nonEmptyString(a.key)) throw new UsageError(`artifacts[${i}].key が空`);
        key = String(a.key).trim();
      }
      if (a.fill_only !== undefined && a.fill_only !== null) {
        if (key === null)
          throw new UsageError(`artifacts[${i}] は key が無いのに fill_only がある`);
        if (!Array.isArray(a.fill_only))
          throw new UsageError(`artifacts[${i}].fill_only が配列でない`);
        for (const f of a.fill_only) {
          if (!nonEmptyString(f))
            throw new UsageError(`artifacts[${i}].fill_only に空の要素がある`);
        }
        fillOnly = a.fill_only.map((x) => String(x).trim());
      }
      if (a.transitions !== undefined && a.transitions !== null) {
        if (key === null)
          throw new UsageError(`artifacts[${i}] は key が無いのに transitions がある`);
        if (!isPlainObject(a.transitions)) {
          throw new UsageError(`artifacts[${i}].transitions がオブジェクトでない`);
        }
        for (const [field, list] of Object.entries(a.transitions)) {
          if (!Array.isArray(list) || list.length === 0) {
            throw new UsageError(`artifacts[${i}].transitions.${field} が空の配列`);
          }
          for (const t of list) {
            // 「<変更前>-><変更後>」だけを受ける。曖昧な表記を黙って通さない。
            if (!nonEmptyString(t) || !/^[^>]+->[^>]+$/.test(String(t).trim())) {
              throw new UsageError(
                `artifacts[${i}].transitions.${field} の要素が <変更前>-><変更後> の形でない: ${JSON.stringify(t)}`,
              );
            }
          }
          transitions[field] = list.map((x) => String(x).trim());
        }
      }
      if (
        a.mutable_columns !== undefined ||
        a.mutable_bullets !== undefined ||
        a.mutable_blocks !== undefined ||
        a.growable_containers !== undefined ||
        a.registry_groups !== undefined
      ) {
        throw new UsageError(
          `artifacts[${i}] の unit が json-arrays なのに mutable_columns / mutable_bullets / mutable_blocks / growable_containers / registry_groups がある`,
        );
      }
    } else {
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
      if (a.mutable_columns !== undefined && a.mutable_columns !== null) {
        if (unit !== "markdown-structure") {
          throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに mutable_columns がある`);
        }
        if (!Array.isArray(a.mutable_columns)) {
          throw new UsageError(`artifacts[${i}].mutable_columns が配列でない`);
        }
        for (const c of a.mutable_columns) {
          if (!nonEmptyString(c))
            throw new UsageError(`artifacts[${i}].mutable_columns に空の要素がある`);
        }
        mutableColumns = a.mutable_columns.map((x) => String(x).trim());
      }
      if (a.registry_groups !== undefined && a.registry_groups !== null) {
        if (unit !== "lines") {
          throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに registry_groups がある`);
        }
        if (!Array.isArray(a.registry_groups)) {
          throw new UsageError(`artifacts[${i}].registry_groups が配列でない`);
        }
        /** @type {Set<string>} */
        const seenGroupIds = new Set();
        /** @type {Set<string>} */
        const seenPaths = new Set();
        for (const group of a.registry_groups) {
          if (
            !isPlainObject(group) ||
            !nonEmptyString(group.id) ||
            !nonEmptyString(group.item_key)
          ) {
            throw new UsageError(`artifacts[${i}].registry_groups の要素に id / item_key が無い`);
          }
          const id = String(group.id).trim();
          // id が重なると別グループの要素が同じ単位に畳まれ、鍵をまたぐ移動の範囲が黙って広がる。
          if (seenGroupIds.has(id)) {
            throw new UsageError(`artifacts[${i}].registry_groups の id が重複している: ${id}`);
          }
          seenGroupIds.add(id);
          if (!Array.isArray(group.paths) || group.paths.length === 0) {
            throw new UsageError(`artifacts[${i}].registry_groups[${id}].paths が空`);
          }
          for (const path of group.paths) {
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
          }
        }
        registryGroups = a.registry_groups.map((g) => ({
          id: String(g.id).trim(),
          itemKey: String(g.item_key).trim(),
          paths: g.paths.map((x) => String(x).trim()),
        }));
      }
      if (a.growable_containers !== undefined && a.growable_containers !== null) {
        if (unit !== "lines") {
          throw new UsageError(
            `artifacts[${i}] の unit が ${unit} なのに growable_containers がある`,
          );
        }
        if (!Array.isArray(a.growable_containers)) {
          throw new UsageError(`artifacts[${i}].growable_containers が配列でない`);
        }
        for (const b of a.growable_containers) {
          if (!nonEmptyString(b))
            throw new UsageError(`artifacts[${i}].growable_containers に空の要素がある`);
          if (!KEY_PATH.test(String(b).trim())) {
            throw new UsageError(
              `artifacts[${i}].growable_containers の要素がキーパスの形でない: ${JSON.stringify(b)}`,
            );
          }
        }
        growableContainers = a.growable_containers.map((x) => String(x).trim());
      }
      if (a.mutable_blocks !== undefined && a.mutable_blocks !== null) {
        if (unit !== "lines") {
          throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに mutable_blocks がある`);
        }
        if (!Array.isArray(a.mutable_blocks)) {
          throw new UsageError(`artifacts[${i}].mutable_blocks が配列でない`);
        }
        for (const b of a.mutable_blocks) {
          if (!nonEmptyString(b))
            throw new UsageError(`artifacts[${i}].mutable_blocks に空の要素がある`);
          // キーパス以外（先頭・末尾のドット、空のセグメント）は黙って「一致しないパス」になり、
          // 外したつもりの領域が単位に残る。書いた側の誤りとして落とす。
          if (!KEY_PATH.test(String(b).trim())) {
            throw new UsageError(
              `artifacts[${i}].mutable_blocks の要素がキーパスの形でない: ${JSON.stringify(b)}`,
            );
          }
        }
        mutableBlocks = a.mutable_blocks.map((x) => String(x).trim());
      }
      if (a.mutable_bullets !== undefined && a.mutable_bullets !== null) {
        if (unit !== "markdown-structure") {
          throw new UsageError(`artifacts[${i}] の unit が ${unit} なのに mutable_bullets がある`);
        }
        if (!Array.isArray(a.mutable_bullets)) {
          throw new UsageError(`artifacts[${i}].mutable_bullets が配列でない`);
        }
        for (const c of a.mutable_bullets) {
          if (!nonEmptyString(c))
            throw new UsageError(`artifacts[${i}].mutable_bullets に空の要素がある`);
        }
        mutableBullets = a.mutable_bullets.map((x) => String(x).trim());
      }
    }
    // **3 つのオプションの間でパスは重ならない。完全一致だけでなく祖先・子孫の重なりも落とす。**
    // 重なると同じキーに 2 通りの単位が当たり、実装の分岐順で先勝ちが決まる（緩い方が勝つと、
    // 検出できていたはずの削除が無音で通る）。祖先の側はとくに危ない——`mutable_blocks` は配下を丸ごと
    // 単位から外すので、子孫に書いた `growable_containers` / `registry_groups` の展開はそこへ到達せず、
    // **その配下の削除がすべて通る**（実測: `a.b` を外した状態で `a.b.c` を空にし `a.b.d` を消しても失われた単位 0）。
    // 一覧をコピーして `--manifest` で渡す運用でコピー側に祖先を足した瞬間に成立するため、使い方の誤りとして落とす。
    // グループ内・グループ間の重複を exit 2 にしているのと同じ理由。
    /** @type {{ path: string, option: string }[]} 既に見たパスと由来のオプション名 */
    const pathOwners = [];
    for (const [option, paths] of [
      ["mutable_blocks", mutableBlocks],
      ["growable_containers", growableContainers],
      ["registry_groups", registryGroups.flatMap((g) => g.paths)],
    ]) {
      for (const path of /** @type {string[]} */ (paths)) {
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
        pathOwners.push({ path, option: /** @type {string} */ (option) });
      }
    }
    return {
      id: String(a.id).trim(),
      pattern: String(a.pattern).trim(),
      unit: String(unit),
      arrays,
      key,
      fillOnly,
      transitions,
      mutableColumns,
      mutableBullets,
      mutableBlocks,
      growableContainers,
      registryGroups,
      requirement: nonEmptyString(a.requirement) ? String(a.requirement).trim() : "",
      source: nonEmptyString(a.source) ? String(a.source).trim() : "",
    };
  });
}

/**
 * @param {{ root: string, manifestPath: string, base: string }} opts
 * @returns {{ findings: string[], notes: string[], checked: number }}
 */
export function check(opts) {
  const { root, manifestPath, base } = opts;
  const artifacts = readManifest(manifestPath);
  if (artifacts.length === 0) throw new UsageError(`一覧の artifacts が 0 件: ${manifestPath}`);

  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    throw new UsageError(`git リポジトリではないため追記であることを確かめられない: ${root}`);
  }
  const baseRev = git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
  if (baseRev.status !== 0) {
    throw new UsageError(`比較元の版を解決できない: ${base}（${baseRev.stderr.trim()}）`);
  }

  // root がリポジトリのトップレベルとは限らない（.replace が monorepo の一階層下に在る等）。
  // ls-tree の既定は cwd 相対のパスを返す一方、`git show <rev>:<path>` の path はトップレベル起点なので、
  // 揃えずに混ぜると全件が「比較元に無い＝新規」に化けて、突き合わせが 1 件も成立しない。
  // そこで --full-tree でトップレベル起点に揃え、root までの prefix で相互に変換する。
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
  const prefix = prefixRel === "" ? "" : `${prefixRel}/`;

  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];

  // 比較元に在って作業ツリーから消えたファイルも対象にする（消失は縮小の極端な形）。
  const tracked = git(root, ["ls-tree", "-r", "--name-only", "--full-tree", "-z", base]);
  if (tracked.status !== 0) {
    throw new UsageError(`比較元の版のファイル一覧を取れない: ${base}（${tracked.stderr.trim()}）`);
  }
  const trackedFiles = tracked.stdout
    .split("\0")
    .filter((f) => f !== "" && (prefix === "" || f.startsWith(prefix)))
    .map((f) => f.slice(prefix.length));

  const trackedSet = new Set(trackedFiles);

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

  /** @type {Map<string, { id: string, pattern: string, unit: string, arrays: string[], key: string | null, fillOnly: string[], transitions: Record<string, string[]>, mutableColumns: string[], mutableBullets: string[], mutableBlocks: string[], growableContainers: string[], registryGroups: { id: string, itemKey: string, paths: string[] }[] }>} */
  const byFile = new Map();
  /**
   * @param {string} file
   * @param {{ id: string, pattern: string, unit: string, arrays: string[], key: string | null, fillOnly: string[], transitions: Record<string, string[]>, mutableColumns: string[], mutableBullets: string[], mutableBlocks: string[], growableContainers: string[], registryGroups: { id: string, itemKey: string, paths: string[] }[] }} artifact
   */
  const assign = (file, artifact) => {
    const prev = byFile.get(file);
    if (prev === undefined) {
      byFile.set(file, artifact);
      return;
    }
    // **同じ項目を 2 度見たときだけ飛ばす**（作業ツリーと比較元の両方から同じ file が来る）。
    // id で飛ばすと、id が重なった別項目の突き合わせ方の食い違いが下の検査に届かず無音で先勝ちになる。
    if (prev === artifact) return;
    if (
      prev.unit !== artifact.unit ||
      prev.arrays.join(",") !== artifact.arrays.join(",") ||
      prev.key !== artifact.key ||
      prev.fillOnly.join(",") !== artifact.fillOnly.join(",") ||
      canonicalJson(prev.transitions) !== canonicalJson(artifact.transitions) ||
      prev.mutableColumns.join(",") !== artifact.mutableColumns.join(",") ||
      prev.mutableBullets.join(",") !== artifact.mutableBullets.join(",") ||
      prev.mutableBlocks.join(",") !== artifact.mutableBlocks.join(",") ||
      prev.growableContainers.join(",") !== artifact.growableContainers.join(",") ||
      canonicalJson(prev.registryGroups) !== canonicalJson(artifact.registryGroups)
    ) {
      // 先勝ちにすると一覧の並び替えで判定が変わる。突き合わせ方が割れたら止める。
      throw new UsageError(
        `同じファイルに突き合わせ方の違う一覧の項目が当たっている: ${file}（${prev.id}: ${prev.unit} / ${artifact.id}: ${artifact.unit}）`,
      );
    }
  };
  for (const artifact of artifacts) {
    const re = globToRegExp(artifact.pattern);
    for (const file of listCached(literalPrefix(artifact.pattern))) {
      if (re.test(file)) assign(file, artifact);
    }
    for (const file of trackedFiles) {
      if (re.test(file)) assign(file, artifact);
    }
  }

  const targets = [...byFile.keys()].sort();
  if (targets.length === 0) {
    throw new UsageError(
      `追記専用の成果物が 1 件も見つからない（対象 0 件を合格に倒さない）: root=${root} 一覧=${manifestPath}`,
    );
  }

  let checked = 0;
  for (const file of targets) {
    const artifact =
      /** @type {{ id: string, pattern: string, unit: string, arrays: string[], key: string | null, fillOnly: string[], transitions: Record<string, string[]>, mutableColumns: string[], mutableBullets: string[], mutableBlocks: string[], growableContainers: string[], registryGroups: { id: string, itemKey: string, paths: string[] }[] }} */ (
        byFile.get(file)
      );
    const inBase = trackedSet.has(file);
    const before = git(root, ["show", `${base}:${prefix}${file}`]);
    if (before.status !== 0) {
      if (inBase) {
        // 比較元の木に在るのに取り出せない。「新規」に倒すと縮小が数えられないまま素通りする。
        throw new UsageError(
          `比較元 ${base} の木に在るのに内容を取り出せない: ${file}（${before.stderr.trim()}）`,
        );
      }
      notes.push(`新規（比較元 ${base} に無い）: ${file}`);
      continue;
    }
    checked += 1;
    const abs = join(root, file);
    if (!existsSync(abs)) {
      findings.push(`追記専用の成果物が消えている: ${file}（比較元 ${base} には在る）`);
      continue;
    }
    const afterText = readFileSync(abs, "utf8");
    if (artifact.unit === "json-arrays" && artifact.key !== null) {
      // 鍵で対応づけてフィールドごとに見る（多重集合では「鍵以外の書き換え」を表現できない）。
      const keyed = compareKeyedArrays(
        before.stdout,
        afterText,
        {
          arrays: artifact.arrays,
          key: artifact.key,
          fillOnly: artifact.fillOnly,
          transitions: artifact.transitions,
        },
        { before: `${file}@${base}`, after: file },
      );
      for (const finding of keyed) findings.push(`${finding}: ${file}`);
      continue;
    }
    const beforeUnits = unitsOf(before.stdout, artifact, `${file}@${base}`);
    const afterUnits = unitsOf(afterText, artifact, file);
    /** @type {string[]} */
    const lost = [];
    let lostCount = 0;
    for (const [unit, count] of beforeUnits) {
      const now = afterUnits.get(unit) ?? 0;
      if (now >= count) continue;
      lostCount += count - now;
      if (lost.length < 3) lost.push(unit.length > 120 ? `${unit.slice(0, 117)}...` : unit);
    }
    if (lostCount > 0) {
      findings.push(
        `追記専用の成果物から ${lostCount} 件（unit: ${artifact.unit}）が失われている: ${file}（例: ${lost.join(" / ")}）`,
      );
    }
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

/** 同梱の一覧（正本）。 */
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
 * @returns {{ root: string, manifest: string, base: string }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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
  };
}

/** 使い方（stderr に出す）。 */
const usage = [
  "usage: append-only-check.mjs --root <dir> [--manifest <path>] [--base <rev>]",
  "  --root      リポジトリルート（必須。走査の起点を推測させない）",
  "  --manifest  追記専用の成果物の一覧（既定: スキル同梱の assets/append-only-manifest.json）",
  "  --base      比較元の版（既定: HEAD）",
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
