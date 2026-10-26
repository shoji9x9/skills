// 採取物と工程の健全性を数える（原本）。
// 原本は parity-suite にあり、スキルディレクトリ内から直接実行する（プロジェクトへコピーしない）。
// parity-diff は収束判定でインストール済みの parity-suite から同じスクリプトを呼ぶ。
//
// 何をするか: metadata.json の宣言を読んで、次のものを数え直す。
//   1. 採取物（artifact_health）: 採取物ごとに「読むスペック」と「何から作ったか」の宣言を要求する。
//      読み手は字面の照合（スペックの中に basename が現れるか）で足りる。assertion に使っているかまでは見ない。
//      加工物（kind: derived）は元の実体の sha256 を数え直し、一致しなければ古いものとして落とす。
//      baseline_dir に在るのに entries に無いファイルは未宣言として落とす（宣言の無いものだけを落とす）。
//   2. 反復実行（suite.state_mutating / suite.repeat_run）: 状態を変えるスイートは 2 回続けて緑であることを求める。
//      1 回目は初期状態から始まるため後始末の有無が結果に現れない。
//      記録は suite_fingerprint で「どの版のスイートを回したか」に結びつける。
//      結びつけないと、2 回緑を記録した後にスペックや後始末を変えても、古い記録で緑のまま通る。
//      repeat_run.specs（スペックごとの分類）を持つ成果物は、スペック単位で判定する。
//      2 回を求めるのは状態を変えるスペックだけで、記録はスペックごとの指紋と共通部分の指紋に結びつける。
//      記録する指紋は --fingerprint で出す（手で計算しない）。
//   3. 未測定（unmeasured）: gaps.md の散文と対になる機械可読の宣言。disposition: blocking が残る間は収束させない。
//   4. 工程の成果物（--target）: suite.new_green が真なら、同じ場所に diff-metadata.json が在ることを求める。
//      加えて、それが「いまの新側」（new.commit と loop.iterations）に対応していることを求める
//      （converged が偽でも落とさない）。dataset_version は数値の一致では見ない。陳腐化の原本は
//      golden-dataset の references/versioning.md で、ここでは交差を見るまでもなく確定する形だけを落とす。
//      投入対象でない target は dataset_version: null ＋ dataset_version_exempt で免除される（parity-diff の references/preflight.md）。
//      --carry-to <SHA> を渡すと、diff-metadata.json の new.commit からその版への持ち越しも必ず判定する。
//      部品改修の一括再検証の直後は、replace-metadata.json の new.commit が改修前のままで、食い違いの判定が呼ばれないためである。
//
// 何をしないか: 採取・加工・スイートの実行はしない。ここでは記録と実体を突き合わせるだけ。
//
// 宣言が無い・読み手が無い・元が読めない・対象 0 件・判定不能は、合格として扱わない。
// 後方互換: artifact_health / unmeasured / suite.state_mutating をキーごと持たない旧成果物は
//           その節を判定しない（judged: false。理由を出力に残す）。
//
// 決定論的: 乱数・現在時刻に依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { isArray } from "./lib/is-array.mjs";

import { EVIDENCE_CARRY_FILE, judgeCarry } from "./evidence-carry.mjs";
import { isCliEntry } from "./lib/cli.mjs";
import { errorMessage } from "./lib/errors.mjs";
import { isPlainObject, nonEmptyString, toIterationCount } from "./lib/guards.mjs";
import { realPathOf } from "./lib/paths.mjs";

/**
 * ツールのバージョン（原本）。判定ロジック・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "10";

/** 採取物の種別。derived は元の実体から作った加工物。 */
const ARTIFACT_KINDS = ["captured", "derived"];

/** 未測定の処置。語彙外・欠落は blocking として数える（判定できないものは収束させない）。 */
const DISPOSITIONS = ["blocking", "accepted"];

/**
 * 呼び出し元の工程。同じ記録でも「誰のチェックか」で blocking の扱いが変わる。
 * - diff（デフォルト・最も厳しい）: parity-diff の収束判定。blocking が残る間は収束させない
 * - suite: parity-suite の完了判定。blocking は本スキルが書く出力そのものなので落とさない
 *   （記録の不備は、どちらの工程でも落とす。不備とは、item の空・重複・reason の空・語彙外の disposition・
 *   承認記録の無い accepted である。測定待ちと不正な記録は別物である）
 */
const STAGES = ["diff", "suite"];

/** 反復実行で緑と数える結果。 */
const GREEN = "green";

/** 新側リポジトリがコミットを持たないことを表す語彙上のセンチネル（リポジトリ共通）。 */
const NO_COMMIT = "none";

/** 走査で辿らないディレクトリ名。 */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** 使い方の誤り・型崩れ（exit 2）。 */
export class UsageError extends Error {}

/**
 * 記録の spec_fingerprints から、正規化するとスペック spec になるキーの指紋を文字列で返す。
 * 呼び出し側は、spec_fingerprints がオブジェクトで、そのキーを持つ記録だけを渡す。
 * @param {unknown} prints
 * @param {string} spec
 * @returns {string}
 */
function specFingerprint(prints, spec) {
  if (!isPlainObject(prints)) throw new TypeError("spec_fingerprints がオブジェクトでない");
  const key = Object.keys(prints).find((k) => normalizeRel(k) === spec);
  return String(prints[String(key)]).trim();
}

/**
 * 相対パスが基準ディレクトリの外へ出ないことを確かめてから解決する。
 *
 * **文字列の比較だけでは閉じ込められない**。`baseline_dir` の直下に外を指すシンボリックリンクを
 * 置くと、`resolve()` / `relative()` では中に見える。その後の `readFileSync` はリンクを解いて
 * ルートの外のファイルを読み、そのハッシュを検証に使う（何の finding も出さずに）。
 * 同じファイルの CLI 自己起動判定が `realpathSync` で両辺を実パスに揃えているのと同じ扱いにする。
 * @param {string} baseDir
 * @param {string} relPath
 * @returns {string | null} 基準の外・絶対パス・実パスを解けないなら null
 */
function resolveInside(baseDir, relPath) {
  if (typeof relPath !== "string" || relPath.trim() === "" || isAbsolute(relPath)) return null;
  const resolved = resolve(baseDir, relPath);
  const rel = relative(baseDir, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  const realBase = realPathOf(baseDir);
  const realTarget = realPathOf(resolved);
  if (realBase === null || realTarget === null) return null;
  const realRel = relative(realBase, realTarget);
  if (realRel === "" || realRel.startsWith("..") || isAbsolute(realRel)) return null;
  return resolved;
}

/**
 * ディレクトリ直下を再帰的に列挙し、基準からの相対パスを返す（POSIX 区切りに揃える）。
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(current, entry.name));
      } else if (entry.isFile()) {
        out.push(relative(dir, join(current, entry.name)).split(sep).join("/"));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * JSON を読む。読めない・JSON として不正なら、型の誤り（exit 2）にする。
 * @param {string} path
 * @param {string} label
 * @returns {unknown}
 */
function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new UsageError(`${label} を読めない: ${path}（${errorMessage(e)}）`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${label} が JSON として不正: ${path}（${errorMessage(e)}）`);
  }
}

/**
 * @param {string} path
 * @returns {string} sha256（16 進小文字）
 */
function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * コメントを除いて指紋を取る拡張子。TypeScript（`.ts` / `.mts` / `.cts`）だけにする。TypeScript で JSX を書けるのは
 * `.tsx` だけだが、JavaScript はトランスパイルで拡張子に関係なく JSX を書ける。JSX のテキスト（`<p>http://x</p>`）の `//` は
 * この字句解析ではコメントと区別できず、テキストの書き換えを見逃すので、`.js` 系と `.jsx` / `.tsx` は生バイトで数える。
 */
const JS_FAMILY_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);

/**
 * 残すコメント（指示コメント）か。ツール・コンパイラへの指示はコメントの形でも動きを変えうるので、
 * 除かずに正規形へ残す（残しすぎは回し直しを 1 回増やすだけで、除きすぎは変更を見逃す）。
 * 対象: `///`・`//#`・`/*!`、`@` で始まるもの（`@ts-*`・`@vite-ignore`・JSDoc 冒頭の `@jsx` 等）、
 * 既知のツール名で始まるもの（eslint・istanbul・webpack 等）。
 * @param {string} body `//` の後、またはブロックコメントの開きと閉じの間
 * @returns {boolean}
 */
function isDirectiveComment(body) {
  if (/^[/#!]/.test(body)) return true;
  const t = body.replace(/^[\s*]+/, "");
  return (
    t.startsWith("@") ||
    /^(eslint|istanbul|c8|v8|webpack|vite-|prettier-|jshint|jscs|globals?\b|exported\b|tslint|biome-|oxlint-|deno-|swc-|esbuild-|rollup-|turbopack)/i.test(
      t,
    )
  );
}

/** 直後の `/` を正規表現リテラルの開始と読むキーワード（それ以外の識別子・数値の後は除算）。 */
const REGEX_AFTER_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/**
 * JS / TS 系のソースからコメントを除き、コメントの書き換えで変わらない正規形にする。
 *
 * 指紋を「動きに影響する書き換え」だけで変えるため、正規化を次のように選ぶ。
 * - コメントは空白として扱う（`a/**\/b` を `ab` に潰さない）。
 * - 文字列・テンプレートリテラル（`${}` の入れ子を含む）・正規表現リテラルの外では、空白の連なりを
 *   改行を含むなら `\n` 1 個、含まなければ空白 1 個に畳む。改行の有無は ASI に影響するので残し、
 *   個数・インデント・コメントの行数は捨てる。行末コメントの有無・JSDoc の行数を変えても指紋は変わらない。
 * - 文字列・テンプレート・正規表現の中身は 1 バイトも変えない（`test.skip` の理由のような文字列は
 *   動きに影響する可能性があるため対象外。中の `//` `/*` もコメントとして扱わない）。
 * - `/` が正規表現か除算かは直前の有意なトークンで決める。識別子（上のキーワードを除く）・数値・
 *   文字列・`)` `]` の後は除算、それ以外（`}` を含む）は正規表現。`}` を正規表現として扱うのは、
 *   正規表現を除算と読み違えると `/a\//` の `//` を行コメントとして読み、コードを捨てて変更を見逃すため。
 * - 指示コメント（isDirectiveComment）は除かず残す。
 * 限界: JSX のテキスト（`<p>http://x</p>`）の `//` はコメントと読むので、`.jsx` / `.tsx` には当てない
 * （JS_FAMILY_EXTENSIONS）。
 * 字句解析が閉じない（終わらない文字列・コメント・正規表現）ときは null を返し、呼び出し側は生バイトで指紋を取る。
 * @param {string} src
 * @returns {string | null}
 */
export function stripJsComments(src) {
  /** @type {LexState} */
  const st = { src, n: src.length, i: 0, out: "", pendingWs: "", prev: "re", braces: [] };
  while (st.i < st.n) {
    if (!lexToken(st)) return null;
  }
  return st.out;
}

/**
 * stripJsComments の字句解析の状態。
 * - pendingWs: 次の有意なトークンの前に出す空白（保留中）
 * - prev: 直前の有意なトークン。"div" なら次の `/` は除算、"re" なら正規表現
 * - braces: `{` の入れ子。"t" はテンプレートの `${` で、対応する `}` でテンプレートへ戻る
 * @typedef {{ src: string, n: number, i: number, out: string, pendingWs: "" | " " | "\n", prev: string, braces: string[] }} LexState
 */

/** 改行として数える文字（ASI に影響するので、空白を畳むときに残す）。 */
const LINE_BREAK = /[\n\r\u2028\u2029]/;

/** @param {string} c */
function isLexWs(c) {
  return /\s/.test(c);
}

/** @param {string} c */
function isLexIdent(c) {
  return /[\w$\\]/.test(c) || c.charCodeAt(0) > 0x7f;
}

/**
 * 保留した空白を出してから、トークンを出す。
 * @param {LexState} st
 * @param {string} s
 */
function emitToken(st, s) {
  if (st.pendingWs !== "" && st.out !== "") st.out += st.pendingWs;
  st.pendingWs = "";
  st.out += s;
}

/**
 * 空白を保留する。改行を含むなら `\n`、含まなければ空白 1 個にする。
 * @param {LexState} st
 * @param {boolean} hasNewline
 */
function queueWhitespace(st, hasNewline) {
  if (hasNewline) st.pendingWs = "\n";
  else if (st.pendingWs === "") st.pendingWs = " ";
}

/**
 * 位置 st.i から 1 トークンを読む。字句解析が閉じないときは false を返す。
 * @param {LexState} st
 * @returns {boolean}
 */
function lexToken(st) {
  const c = st.src[st.i];
  if (isLexWs(c)) return lexWhitespace(st);
  if (c === "/" && st.src[st.i + 1] === "/") return lexLineComment(st);
  if (c === "/" && st.src[st.i + 1] === "*") return lexBlockComment(st);
  if (c === "'" || c === '"') return lexQuoted(st, c);
  if (c === "`") return lexTemplateStart(st);
  if (c === "/" && st.prev === "re") return lexRegex(st);
  if (isLexIdent(c)) return lexIdent(st);
  return lexSymbol(st, c);
}

/**
 * @param {LexState} st
 * @returns {boolean}
 */
function lexWhitespace(st) {
  const start = st.i;
  while (st.i < st.n && isLexWs(st.src[st.i])) st.i += 1;
  queueWhitespace(st, LINE_BREAK.test(st.src.slice(start, st.i)));
  return true;
}

/**
 * @param {LexState} st
 * @returns {boolean}
 */
function lexLineComment(st) {
  const start = st.i;
  while (st.i < st.n && !LINE_BREAK.test(st.src[st.i])) st.i += 1;
  // 指示コメントは残す。直前・直後の有意なトークンの読み（prev）はコメントで変えない
  if (isDirectiveComment(st.src.slice(start + 2, st.i)))
    emitToken(st, st.src.slice(start, st.i).trimEnd());
  else queueWhitespace(st, false);
  return true;
}

/**
 * @param {LexState} st
 * @returns {boolean}
 */
function lexBlockComment(st) {
  const end = st.src.indexOf("*/", st.i + 2);
  if (end < 0) return false;
  if (isDirectiveComment(st.src.slice(st.i + 2, end))) emitToken(st, st.src.slice(st.i, end + 2));
  else queueWhitespace(st, LINE_BREAK.test(st.src.slice(st.i + 2, end)));
  st.i = end + 2;
  return true;
}

/**
 * 引用符の文字列を読む。中身は 1 バイトも変えない。
 * @param {LexState} st
 * @param {string} quote
 * @returns {boolean}
 */
function lexQuoted(st, quote) {
  const start = st.i;
  st.i += 1;
  while (st.i < st.n && st.src[st.i] !== quote) {
    if (st.src[st.i] === "\\") st.i += 1;
    else if (st.src[st.i] === "\n") return false;
    st.i += 1;
  }
  if (st.i >= st.n) return false;
  st.i += 1;
  emitToken(st, st.src.slice(start, st.i));
  st.prev = "div";
  return true;
}

/**
 * @param {LexState} st
 * @returns {boolean}
 */
function lexTemplateStart(st) {
  emitToken(st, "`");
  st.i += 1;
  return scanTemplate(st);
}

/**
 * テンプレートの本文を読む。`}` で戻ってきた直後か開始の `` ` `` の直後から。
 * @param {LexState} st
 * @returns {boolean}
 */
function scanTemplate(st) {
  const start = st.i;
  while (st.i < st.n) {
    const c = st.src[st.i];
    if (c === "\\") {
      st.i += 2;
      continue;
    }
    if (c === "`") {
      st.i += 1;
      st.out += st.src.slice(start, st.i);
      st.prev = "div";
      return true;
    }
    if (c === "$" && st.src[st.i + 1] === "{") {
      st.i += 2;
      st.out += st.src.slice(start, st.i);
      st.braces.push("t");
      st.prev = "re";
      return true;
    }
    st.i += 1;
  }
  return false;
}

/**
 * 正規表現リテラル（フラグを含む）を読む。中身は 1 バイトも変えない。
 * @param {LexState} st
 * @returns {boolean}
 */
function lexRegex(st) {
  const start = st.i;
  st.i += 1;
  let inClass = false;
  while (st.i < st.n) {
    const d = st.src[st.i];
    if (d === "\\") st.i += 1;
    else if (d === "\n") return false;
    else if (d === "[") inClass = true;
    else if (d === "]") inClass = false;
    else if (d === "/" && !inClass) break;
    st.i += 1;
  }
  if (st.i >= st.n) return false;
  st.i += 1;
  while (st.i < st.n && isLexIdent(st.src[st.i])) st.i += 1;
  emitToken(st, st.src.slice(start, st.i));
  st.prev = "div";
  return true;
}

/**
 * @param {LexState} st
 * @returns {boolean}
 */
function lexIdent(st) {
  const start = st.i;
  while (st.i < st.n && isLexIdent(st.src[st.i])) st.i += 1;
  const word = st.src.slice(start, st.i);
  emitToken(st, word);
  st.prev = REGEX_AFTER_KEYWORDS.has(word) ? "re" : "div";
  return true;
}

/**
 * 記号 1 文字。`.5` のような数値の小数点も記号として出すが、正規形として決定的なので問題ない。
 * @param {LexState} st
 * @param {string} c
 * @returns {boolean}
 */
function lexSymbol(st, c) {
  if (c === "/" && st.out.endsWith(")")) {
    // `)` の後の `/` は、`(a + b) / 2` なら除算、`if (x) /[//]/.test(v)` なら正規表現で、字句だけでは決まらない。
    // 除算と読んだまま同じ行の残りに `//` `/*` があると、正規表現の中身をコメントとして捨ててコードの変更を
    // 見逃しうる。そのため、その形は読めないものとして扱い、生バイトで指紋を取る（null）
    const eol = st.src.slice(st.i + 1).search(LINE_BREAK);
    const rest = eol < 0 ? st.src.slice(st.i + 1) : st.src.slice(st.i + 1, st.i + 1 + eol);
    if (rest.includes("//") || rest.includes("/*")) return false;
  }
  st.i += 1;
  if (c === "{") st.braces.push("b");
  if (c === "}" && st.braces.pop() === "t") {
    // テンプレートの `${ ... }` を閉じた。空白はテンプレートの本文に属するので、保留した空白は捨てる。
    st.pendingWs = "";
    st.out += "}";
    return scanTemplate(st);
  }
  emitToken(st, c);
  if (c === ")" || c === "]") st.prev = "div";
  else if ((c === "+" || c === "-") && st.src[st.i - 2] === c) st.prev = "div"; // 後置 ++ / --
  else st.prev = "re";
  return true;
}

/**
 * スペックの本文に採取物の名前が「ファイル名として」現れるかを見る。
 * 素の部分文字列の一致にすると、orders.xlsx が orders.xlsx.json にも当たり、
 * 実際には読まれていない採取物が、読み手ありとして通ってしまう。
 * 前後がファイル名を構成しうる文字（英数・. _ -）でないことまで確かめる。
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
export function includesAsName(text, name) {
  const namePart = /[A-Za-z0-9._-]/;
  let from = 0;
  for (;;) {
    const at = text.indexOf(name, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + name.length] ?? "";
    if (!namePart.test(before) && !namePart.test(after)) return true;
    from = at + 1;
  }
}

/**
 * 採取物の節を数え直す。
 * @param {Record<string, unknown>} metadata
 * @param {{ root: string }} ctx
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
export function checkArtifacts(metadata, ctx) {
  if (!("artifact_health" in metadata)) {
    return {
      judged: false,
      findings: [],
      notes: ["artifact_health をキーごと持たない旧成果物のため採取物の節を判定しない"],
    };
  }
  const health = metadata.artifact_health;
  if (!isPlainObject(health)) throw new UsageError("artifact_health がオブジェクトでない");
  if (typeof health.declared !== "boolean")
    throw new UsageError("artifact_health.declared が真偽値でない");
  if (!health.declared) return undeclaredArtifacts(health);

  const baselineDir = resolveBaselineDir(health, ctx.root);
  if (!isArray(health.entries)) throw new UsageError("artifact_health.entries が配列でない");

  /** @type {string[]} */
  const findings = [];
  const present = listBaseline(baselineDir, findings);
  const byPath = indexArtifactEntries(health.entries, findings);

  if (present.length === 0 && byPath.size === 0) {
    findings.push(
      `採取物が 0 件（宣言も実体も無い）。対象 0 件を合格として扱わない: ${baselineDir}`,
    );
  }

  for (const file of present) {
    if (!byPath.has(file))
      findings.push(`採取物が宣言されていない（読み手が居るか分からない）: ${file}`);
  }

  for (const [p, entry] of byPath) {
    findings.push(...artifactEntryFindings({ p, entry, byPath, baselineDir, root: ctx.root }));
  }

  return {
    judged: true,
    findings,
    notes: [`採取物 ${byPath.size} 件を宣言、${present.length} 件を baseline_dir に実測`],
  };
}

/**
 * artifact_health.declared: false の成果物を、理由を確かめてから判定しないで返す。
 * @param {Record<string, unknown>} health
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
function undeclaredArtifacts(health) {
  if (!nonEmptyString(health.reason))
    throw new UsageError(
      "artifact_health.declared: false なのに reason が空（免除の根拠が残らない）",
    );
  return {
    judged: false,
    findings: [],
    notes: [
      `artifact_health.declared: false のため判定しない（理由: ${String(health.reason).trim()}）`,
    ],
  };
}

/**
 * artifact_health.baseline_dir をルートの中に解決する。空・ルートの外・実パスを解けないものは型の誤りにする。
 * @param {Record<string, unknown>} health
 * @param {string} root
 * @returns {string}
 */
function resolveBaselineDir(health, root) {
  if (!nonEmptyString(health.baseline_dir))
    throw new UsageError("artifact_health.baseline_dir が空でない文字列でない");
  const baselineDir = resolveInside(root, String(health.baseline_dir));
  if (baselineDir === null)
    throw new UsageError(
      `artifact_health.baseline_dir がルートの外を指しているか実パスを解決できない: ${String(health.baseline_dir)}`,
    );
  return baselineDir;
}

/**
 * baseline_dir に在るファイルを列挙する。ディレクトリが無ければ所見を足して空を返す。
 * @param {string} baselineDir
 * @param {string[]} findings
 * @returns {string[]}
 */
function listBaseline(baselineDir, findings) {
  if (!existsSync(baselineDir) || !statSync(baselineDir).isDirectory()) {
    findings.push(`artifact_health.declared: true なのに baseline_dir が無い: ${baselineDir}`);
    return [];
  }
  return listFiles(baselineDir);
}

/**
 * artifact_health.entries をパスで引けるようにする。重複は所見を足し、先の宣言を残す。
 * @param {unknown[]} entries
 * @param {string[]} findings
 * @returns {Map<string, Record<string, unknown>>}
 */
function indexArtifactEntries(entries, findings) {
  /** @type {Map<string, Record<string, unknown>>} */
  const byPath = new Map();
  for (const [i, entry] of entries.entries()) {
    if (!isPlainObject(entry))
      throw new UsageError(`artifact_health.entries[${i}] がオブジェクトでない`);
    if (!nonEmptyString(entry.path))
      throw new UsageError(`artifact_health.entries[${i}].path が空でない文字列でない`);
    const p = String(entry.path).trim();
    if (byPath.has(p)) {
      findings.push(`採取物の宣言が重複している（先勝ちにしない）: ${p}`);
      continue;
    }
    byPath.set(p, entry);
  }
  return byPath;
}

/**
 * 宣言された採取物 1 件の実体・kind・読み手・鮮度を数え直す。
 * @param {{ p: string, entry: Record<string, unknown>, byPath: Map<string, Record<string, unknown>>, baselineDir: string, root: string }} a
 * @returns {string[]}
 */
function artifactEntryFindings({ p, entry, byPath, baselineDir, root }) {
  const target = resolveInside(baselineDir, p);
  if (target === null) {
    return [`採取物のパスが baseline_dir の外を指しているか実パスを解決できない: ${p}`];
  }
  if (!existsSync(target)) return [`宣言された採取物の実体が無い: ${p}`];

  /** @type {string[]} */
  const findings = [];
  const kind = entry.kind;
  if (typeof kind !== "string" || !ARTIFACT_KINDS.includes(kind)) {
    findings.push(`採取物の kind が語彙外（${ARTIFACT_KINDS.join(" / ")}）: ${p}`);
  }
  findings.push(...readerFindings(entry, p, root));
  findings.push(...freshnessFindings({ entry, kind, p, byPath, baselineDir }));
  return findings;
}

/**
 * 読み手（字面の照合）を数え直す。
 * @param {Record<string, unknown>} entry
 * @param {string} p
 * @param {string} root
 * @returns {string[]}
 */
function readerFindings(entry, p, root) {
  const readBy = entry.read_by;
  if (readBy !== undefined && readBy !== null && !isArray(readBy)) {
    throw new UsageError(`artifact_health.entries[${p}].read_by が配列でない`);
  }
  const readers = isArray(readBy) ? readBy : [];
  if (readers.length === 0) {
    if (nonEmptyString(entry.unread_reason)) return [];
    return [`読み手が宣言されておらず unread_reason も空（採っただけの採取物になる）: ${p}`];
  }
  const name = basename(p);
  return readers.flatMap((reader) => readerFinding(reader, { name, p, root }));
}

/**
 * read_by の 1 件が指すスペックに、採取物の名前が現れるかを見る。
 * @param {unknown} reader
 * @param {{ name: string, p: string, root: string }} a
 * @returns {string[]}
 */
function readerFinding(reader, { name, p, root }) {
  if (!nonEmptyString(reader)) return [`read_by に空の要素がある: ${p}`];
  const readerRel = String(reader).trim();
  const specPath = resolveInside(root, readerRel);
  // **閉じ込め拒否と不在を同じ文言にしない**。リンク越しにルート外を指す宣言は実体が在るのに
  // ここで null になるため、「無い」と報告すると原因（閉じ込め拒否）に辿り着けない。
  if (specPath === null) {
    return [
      `read_by が指すスペックがルートの外を指しているか実パスを解決できない: ${readerRel}（採取物 ${p}）`,
    ];
  }
  if (!existsSync(specPath)) return [`read_by が指すスペックが無い: ${readerRel}（採取物 ${p}）`];
  let text;
  try {
    text = readFileSync(specPath, "utf8");
  } catch (e) {
    return [`read_by が指すスペックを読めない: ${readerRel}（${errorMessage(e)}）`];
  }
  if (!includesAsName(text, name)) {
    return [
      `read_by が指すスペックに採取物の名前が現れない（字面の照合で不一致）: ${name} ∉ ${readerRel}`,
    ];
  }
  return [];
}

/**
 * 鮮度（何から作ったか）を数え直す。加工物は元の実体の sha256 を宣言と突き合わせる。
 * @param {{ entry: Record<string, unknown>, kind: unknown, p: string, byPath: Map<string, Record<string, unknown>>, baselineDir: string }} a
 * @returns {string[]}
 */
function freshnessFindings({ entry, kind, p, byPath, baselineDir }) {
  const derivedFrom = entry.derived_from;
  if (kind !== "derived") {
    if (derivedFrom === undefined || derivedFrom === null) return [];
    return [`kind: captured なのに derived_from がある（採取か加工かが決まらない）: ${p}`];
  }
  if (derivedFrom === undefined || derivedFrom === null) {
    if (nonEmptyString(entry.freshness_unverified_reason)) return [];
    return [
      `加工物に derived_from が無く freshness_unverified_reason も空（古いかもしれないが未検証としても残らない）: ${p}`,
    ];
  }
  if (!isPlainObject(derivedFrom))
    throw new UsageError(`artifact_health.entries[${p}].derived_from がオブジェクトでない`);
  if (!nonEmptyString(derivedFrom.path) || !nonEmptyString(derivedFrom.sha256)) {
    return [`derived_from の path / sha256 が空: ${p}`];
  }
  const srcRel = String(derivedFrom.path).trim();
  if (!byPath.has(srcRel)) {
    return [`derived_from が宣言されていない採取物を指している: ${srcRel}（加工物 ${p}）`];
  }
  return derivedSourceFindings({ p, srcRel, sha256: derivedFrom.sha256, baselineDir });
}

/**
 * 加工物の元の実体を読み、sha256 を宣言と突き合わせる。
 * @param {{ p: string, srcRel: string, sha256: unknown, baselineDir: string }} a
 * @returns {string[]}
 */
function derivedSourceFindings({ p, srcRel, sha256, baselineDir }) {
  const srcPath = resolveInside(baselineDir, srcRel);
  if (srcPath === null) {
    return [
      `derived_from の実体が baseline_dir の外を指しているか実パスを解決できない: ${srcRel}（加工物 ${p}）`,
    ];
  }
  if (!existsSync(srcPath)) return [`derived_from の実体が無い: ${srcRel}（加工物 ${p}）`];
  const actual = sha256File(srcPath);
  if (actual !== String(sha256).trim().toLowerCase()) {
    return [
      `加工物が古い（元の実体の sha256 が宣言と一致しない）: ${p} ← ${srcRel}（宣言 ${String(sha256).trim()} / 実測 ${actual}）`,
    ];
  }
  return [];
}

/** 反復実行の記録が指す「スイートそのもの」を構成する metadata.suite のキー。 */
const SUITE_SOURCE_KEYS = ["specs", "locator_map", "expectations", "interactions", "tools"];

/**
 * 現在のスイートの指紋を計算する。
 *
 * 2 回緑を記録した後にスペックを書き換えたり後始末を外したりしても、記録だけを見る検査は緑のまま通る。
 * 記録が「どの版のスイートを 2 回回したか」を持たないためで、指紋を記録・照合して初めて
 * 「いまのスイートが 2 回続けて回った」と言える。
 *
 * 列挙は宣言されたパス（suite.specs / locator_map / interactions）から行い、
 * ディレクトリは再帰、並びはソートで固定する。1 つでも実体が無ければ判定不能として null を返す。
 *
 * 既定（接頭辞 `sha256-nc:`）は JS / TS 系のファイルをコメントを除いた正規形（stripJsComments）で数える。
 * 注記を書き換えただけで指紋が変わると、テストの動きが同じなのに現行で 2 回回し直すことになるため。
 * それ以外の拡張子と、字句解析が閉じない JS / TS 系のファイルは生バイトで数える。
 * `legacy: true` は旧方式（接頭辞 `sha256:`・全ファイル生バイト）で、`sha256:` で記録済みの runs と照合するのに使う。
 * @param {Record<string, unknown>} suiteObj
 * @param {string} root
 * @param {{ legacy?: boolean }} [opts]
 * @returns {{ fingerprint: string | null, files: number, missing: string[], unparsed: string[] }}
 */
export function suiteFingerprint(suiteObj, root, opts = {}) {
  const legacy = opts.legacy === true;
  const listed = listSuiteFiles(suiteObj, root);
  if (listed.declared === 0 || listed.missing.length > 0)
    return { fingerprint: null, files: 0, missing: listed.missing, unparsed: [] };
  const files = listed.byKey.flatMap((k) => k.files).sort();
  const d = digestFiles(files, root, legacy);
  return {
    fingerprint: d.fingerprint,
    files: d.fingerprint === null ? 0 : files.length,
    missing: d.missing,
    unparsed: d.unparsed,
  };
}

/**
 * suite の宣言パス（SUITE_SOURCE_KEYS）の下のファイルを列挙する。ディレクトリは再帰、パスは宣言の字面に継ぎ足す。
 * @param {Record<string, unknown>} suiteObj
 * @param {string} root
 * @returns {{ declared: number, missing: string[], byKey: { key: string, rel: string, files: string[] }[] }}
 */
function listSuiteFiles(suiteObj, root) {
  /** @type {string[]} */
  const missing = [];
  /** @type {{ key: string, rel: string, files: string[] }[]} */
  const byKey = [];
  let declared = 0;
  for (const key of SUITE_SOURCE_KEYS) {
    const value = suiteObj[key];
    if (!nonEmptyString(value)) continue;
    declared += 1;
    const rel = String(value).trim();
    const abs = resolveInside(root, rel);
    if (abs === null) {
      missing.push(`${rel}（ルートの外を指しているか実パスを解決できない）`);
      continue;
    }
    if (!existsSync(abs)) {
      missing.push(`${rel}（実体が無い）`);
      continue;
    }
    const isDir = statSync(abs).isDirectory();
    // tools のコピー（trait-capture・element-shot）は、隣の page/ の本体を import する。
    // ファイルで書くと page/ が指紋に入らず、page/ だけを入れ替えても記録が失効しないので、判定できないとして扱う
    if (key === "tools" && !isDir) {
      missing.push(
        `${rel}（suite.tools はコピー専用のディレクトリで書く。ファイルで書くと、隣の page/ が指紋に入らない）`,
      );
      continue;
    }
    const files = isDir ? listFiles(abs).map((f) => `${rel}/${f}`) : [rel];
    byKey.push({ key, rel, files });
  }
  return { declared, missing, byKey };
}

/**
 * ファイルの並びから指紋を計算する（並びは呼び出し側で固定する）。
 * 既定（`sha256-nc:`）は JS / TS 系をコメントを除いた正規形で数え、字句解析が閉じないものは生バイトで数える。
 * @param {string[]} files - root 基準の相対パス
 * @param {string} root
 * @param {boolean} legacy - 旧方式（`sha256:`・全ファイル生バイト）
 * @returns {{ fingerprint: string | null, missing: string[], unparsed: string[] }}
 */
function digestFiles(files, root, legacy) {
  /** @type {string[]} コメントを除けず生バイトで数えた JS / TS 系のファイル */
  const unparsed = [];
  const digest = createHash("sha256");
  for (const rel of files) {
    const abs = resolveInside(root, rel);
    if (abs === null)
      return {
        fingerprint: null,
        missing: [`${rel}（ルートの外を指しているか実パスを解決できない）`],
        unparsed,
      };
    if (!existsSync(abs)) return { fingerprint: null, missing: [`${rel}（実体が無い）`], unparsed };
    let fileHash = null;
    if (!legacy && JS_FAMILY_EXTENSIONS.has(extname(rel).toLowerCase())) {
      const stripped = stripJsComments(readFileSync(abs, "utf8"));
      if (stripped === null) unparsed.push(rel);
      else fileHash = createHash("sha256").update(stripped).digest("hex");
    }
    digest.update(rel);
    digest.update("\0");
    digest.update(fileHash ?? sha256File(abs));
    digest.update("\n");
  }
  const prefix = legacy ? "sha256" : "sha256-nc";
  return { fingerprint: `${prefix}:${digest.digest("hex")}`, missing: [], unparsed };
}

/**
 * Playwright の既定の testMatch（`**\/*.@(spec|test).?(c|m)[jt]s?(x)`）。suite.specs の下でこれに当たるファイルをスペックとして数える。
 * testMatch を変えたプロジェクトのスペックはこれに当たらないことがあるので、分類表（repeat_run.specs）に書いたパスもスペックとして数える。
 */
const SPEC_FILE_PATTERN = /\.(spec|test)\.[cm]?[jt]sx?$/i;

/** JS / TS 系の拡張子。suite.specs の下で命名規則に当たらないこれらのファイルは、スペックか共通部分かの宣言が要る。 */
const JS_TS_FILE_PATTERN = /\.[cm]?[jt]sx?$/i;

/**
 * パスを / 区切りの正規形にする（宣言の字面の揺れ〈末尾の /・./〉で同じファイルを別物として数えない）。
 * @param {string} p
 */
function normalizeRel(p) {
  return posix.normalize(p.trim().split(sep).join("/")).replace(/\/+$/, "");
}

/**
 * パス f が根 r の下（r 自身を含む）にあるか（どちらも normalizeRel 済み）。
 * @param {string} f
 * @param {string} r
 */
function underRel(f, r) {
  return f === r || f.startsWith(`${r}/`);
}

/**
 * スペック単位の指紋を計算する。
 *
 * スイート全体の 1 つの指紋に 2 回の記録を結びつけると、状態を変えないスペックを 1 行変えただけで
 * 状態を変えるスペックまで現行へ 2 回回し直すことになる。2 回目が意味を持つのは状態を変えるスペックだけなので、
 * 記録はスペックごとの指紋と、スペックが共通に読む部分（shared）の指紋に結びつける。
 *
 * - スペック: suite.specs の下で SPEC_FILE_PATTERN に当たるファイルと、分類表に書いたファイル。1 ファイルずつ指紋を取る。
 * - 共通部分（shared）: それ以外の宣言パスの全ファイル。locator_map / expectations / interactions / tools と、
 *   suite.specs の下のスペック以外（スペックが読む共通の関数・fixture）である。変われば全スペックの記録が失効する。
 * - 外すもの: excluded（current プロジェクトが testIgnore で実行しないディレクトリ。新側専用スペックなど）の下。
 *   現行に対して実行しないものは現行の状態を変えられず、記録を失効させる理由にならない。
 * @param {Record<string, unknown>} suiteObj
 * @param {string} root
 * @param {{ declared?: string[], sharedDeclared?: string[], excluded?: string[] }} [opts] - いずれも normalizeRel 済みの root 基準の相対パス
 * @returns {{ shared: string | null, specs: Record<string, string>, specFiles: string[], sharedFiles: number, specsTreeShared: string[], undeclared: string[], missing: string[], unparsed: string[] }}
 */
export function specFingerprints(suiteObj, root, opts = {}) {
  const declared = new Set(opts.declared ?? []);
  const sharedDeclared = new Set(opts.sharedDeclared ?? []);
  const excluded = opts.excluded ?? [];
  const listed = listSuiteFiles(suiteObj, root);
  const empty = {
    shared: null,
    specs: {},
    specFiles: [],
    sharedFiles: 0,
    specsTreeShared: [],
    undeclared: [],
    unparsed: [],
  };
  if (listed.declared === 0 || listed.missing.length > 0)
    return { ...empty, missing: listed.missing };
  const { specFiles, sharedFiles } = classifySuiteFiles(listed.byKey, { declared, excluded });
  const tree = specsTreeSharedFiles(listed.byKey, sharedFiles, sharedDeclared);
  const shared = digestFiles([...sharedFiles].sort(), root, false);
  if (shared.fingerprint === null) return { ...empty, missing: shared.missing };
  const sortedSpecs = [...specFiles].sort();
  const perSpec = digestEachSpec(sortedSpecs, root);
  if (perSpec.missing !== null) return { ...empty, missing: perSpec.missing };
  return {
    shared: shared.fingerprint,
    specs: perSpec.specs,
    specFiles: sortedSpecs,
    sharedFiles: sharedFiles.size,
    specsTreeShared: tree.specsTreeShared.sort(),
    undeclared: tree.undeclared.sort(),
    missing: [],
    unparsed: [...shared.unparsed, ...perSpec.unparsed],
  };
}

/**
 * 宣言パスの下のファイルを、スペックと共通部分（shared）に分ける。excluded の下のスペックは外す。
 * @param {{ key: string, rel: string, files: string[] }[]} byKey
 * @param {{ declared: Set<string>, excluded: string[] }} opts
 * @returns {{ specFiles: Set<string>, sharedFiles: Set<string> }}
 */
function classifySuiteFiles(byKey, { declared, excluded }) {
  /** @type {Set<string>} */
  const specFiles = new Set();
  /** @type {Set<string>} */
  const sharedFiles = new Set();
  for (const { key, files } of byKey) {
    for (const raw of files) {
      const f = normalizeRel(raw);
      if (key === "specs" && excluded.some((e) => underRel(f, e))) continue;
      if (key === "specs" && (SPEC_FILE_PATTERN.test(f) || declared.has(f))) specFiles.add(f);
      else sharedFiles.add(f);
    }
  }
  // 同じファイルが specs と別のキーの両方に入る宣言（tools を specs の下に置く等）は、スペックとして数える
  for (const f of specFiles) sharedFiles.delete(f);
  return { specFiles, sharedFiles };
}

/**
 * suite.specs の下の共通部分と、そのうち宣言の要るファイルを挙げる。
 * @param {{ key: string, rel: string, files: string[] }[]} byKey
 * @param {Set<string>} sharedFiles
 * @param {Set<string>} sharedDeclared
 * @returns {{ specsTreeShared: string[], undeclared: string[] }}
 */
function specsTreeSharedFiles(byKey, sharedFiles, sharedDeclared) {
  // suite.specs の下で命名規則にも分類表にも当たらない JS / TS 系のファイルは、repeat_run.shared_files に宣言していなければ落とす。
  // 字面（test( の呼び出し）でスペックかどうかを推測すると、別名 import（test as it）などで検出できない。
  // すると、状態を変えるスペックが、2 回続けての緑を求められないまま共通部分として扱われる。推測せず宣言を求める
  /** @type {string[]} */
  const specsTreeShared = [];
  /** @type {string[]} */
  const undeclared = [];
  for (const { key, files } of byKey) {
    if (key !== "specs") continue;
    for (const raw of files) {
      const f = normalizeRel(raw);
      if (!sharedFiles.has(f)) continue;
      specsTreeShared.push(f);
      if (JS_TS_FILE_PATTERN.test(f) && !sharedDeclared.has(f)) undeclared.push(f);
    }
  }
  return { specsTreeShared, undeclared };
}

/**
 * スペックごとに指紋を取る。1 つでも実体が無ければ missing を返す。
 * @param {string[]} sortedSpecs
 * @param {string} root
 * @returns {{ specs: Record<string, string>, unparsed: string[], missing: string[] | null }}
 */
function digestEachSpec(sortedSpecs, root) {
  /** @type {Record<string, string>} */
  const specs = {};
  /** @type {string[]} */
  const unparsed = [];
  for (const f of sortedSpecs) {
    const d = digestFiles([f], root, false);
    if (d.fingerprint === null) return { specs, unparsed, missing: d.missing };
    unparsed.push(...d.unparsed);
    specs[f] = d.fingerprint;
  }
  return { specs, unparsed, missing: null };
}

/**
 * 連続する 2 回の記録が、どちらも緑で、別の日時に順に始まったかを数える。
 * @param {Record<string, unknown>[]} tail - 連続する 2 回（オブジェクトであることは呼び出し側で確かめる）
 * @param {string} label - 所見の接頭辞（スペック単位の判定ではスペックのパス）
 * @returns {string[]}
 */
function pairFindings(tail, label) {
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const startedAt = [];
  for (const [i, run] of tail.entries()) {
    if (run.result !== GREEN) {
      findings.push(
        `${label}連続する 2 回のうち ${i + 1} 回目が緑でない（result: ${JSON.stringify(run.result)}）`,
      );
    }
    if (!nonEmptyString(run.started_at)) {
      findings.push(`${label}連続する 2 回のうち ${i + 1} 回目の started_at が空`);
    } else {
      startedAt.push(String(run.started_at).trim());
    }
  }
  if (startedAt.length === 2) {
    if (startedAt[0] === startedAt[1]) {
      findings.push(
        `${label}連続する 2 回の started_at が同じ（1 回の記録のコピーと区別が付かない）: ${startedAt[0]}`,
      );
    } else {
      const t0 = Date.parse(startedAt[0]);
      const t1 = Date.parse(startedAt[1]);
      if (Number.isNaN(t0) || Number.isNaN(t1)) {
        findings.push(`${label}started_at が日時として読めない: ${startedAt.join(" / ")}`);
      } else if (t1 <= t0) {
        findings.push(
          `${label}2 回目の started_at が 1 回目より後になっていない: ${startedAt.join(" → ")}`,
        );
      }
    }
  }
  return findings;
}

/**
 * 分類表（repeat_run.specs）と current_excluded を読む。型崩れは UsageError、記録の不備は所見。
 * @param {Record<string, unknown>} record - suite.repeat_run
 * @param {string} root
 * @param {unknown} specsDecl - suite.specs（current_excluded はこの下に限る）
 * @returns {{ findings: string[], declared: Map<string, boolean>, sharedDeclared: Set<string>, excluded: string[] }}
 */
function readSpecClassification(record, root, specsDecl) {
  const specsRoot = nonEmptyString(specsDecl) ? normalizeRel(String(specsDecl)) : null;
  /** @type {string[]} */
  const findings = [];
  const excluded = readCurrentExcluded(record.current_excluded ?? [], {
    root,
    specsRoot,
    findings,
  });
  const declared = readSpecDeclarations(record.specs, findings);
  const sharedDeclared = readSharedDeclarations(record.shared_files ?? [], { declared, findings });
  return { findings, declared, sharedDeclared, excluded };
}

/**
 * repeat_run.current_excluded を読み、外してよいパス（normalizeRel 済み）を返す。記録の不備は所見に足す。
 * @param {unknown} rawExcluded
 * @param {{ root: string, specsRoot: string | null, findings: string[] }} ctx
 * @returns {string[]}
 */
function readCurrentExcluded(rawExcluded, ctx) {
  const { root, specsRoot, findings } = ctx;
  if (!isArray(rawExcluded)) throw new UsageError("suite.repeat_run.current_excluded が配列でない");
  /** @type {string[]} */
  const excluded = [];
  for (const [i, e] of rawExcluded.entries()) {
    if (!isPlainObject(e))
      throw new UsageError(`suite.repeat_run.current_excluded[${i}] がオブジェクトでない`);
    if (!nonEmptyString(e.path)) {
      findings.push(`current_excluded[${i}] の path が空`);
      continue;
    }
    const rel = String(e.path).trim();
    if (!nonEmptyString(e.reason)) {
      // 外したものは記録を失効させなくなる（緩和）ので、現行に対して実行しない根拠が無いものは外さない
      findings.push(
        `current_excluded の ${rel} に reason が無い（current プロジェクトが実行しない根拠が残らない）。外さずに数える`,
      );
      continue;
    }
    if (resolveInside(root, rel) === null) {
      findings.push(`current_excluded の ${rel} がルートの外を指しているか実パスを解決できない`);
      continue;
    }
    // 外せるのは suite.specs の下（current が実行しないスペックの置き場所）だけ。共通部分（locator_map 等）やその祖先を外すと、
    // 共通部分を変えても記録が失効しなくなる。suite.specs そのものも外せない（全スペックが判定から消える）
    const normalized = normalizeRel(rel);
    if (specsRoot === null || normalized === specsRoot || !underRel(normalized, specsRoot)) {
      findings.push(
        `current_excluded の ${rel} が suite.specs（${specsRoot ?? "未宣言"}）の下でない（外せるのは current が実行しないスペックの置き場所だけ）。外さずに数える`,
      );
      continue;
    }
    excluded.push(normalizeRel(rel));
  }
  return excluded;
}

/**
 * repeat_run.specs を読み、スペック（normalizeRel 済み）→ state_mutating の表を返す。記録の不備は所見に足す。
 * @param {unknown} specs
 * @param {string[]} findings
 * @returns {Map<string, boolean>}
 */
function readSpecDeclarations(specs, findings) {
  if (!isArray(specs)) throw new UsageError("suite.repeat_run.specs が配列でない");
  /** @type {Map<string, boolean>} */
  const declared = new Map();
  for (const [i, e] of specs.entries()) {
    if (!isPlainObject(e))
      throw new UsageError(`suite.repeat_run.specs[${i}] がオブジェクトでない`);
    if (!nonEmptyString(e.path)) {
      findings.push(`repeat_run.specs[${i}] の path が空`);
      continue;
    }
    const rel = normalizeRel(String(e.path));
    if (typeof e.state_mutating !== "boolean")
      throw new UsageError(`suite.repeat_run.specs の ${rel} の state_mutating が真偽値でない`);
    if (!nonEmptyString(e.reason)) {
      findings.push(
        `repeat_run.specs の ${rel} に reason が無い（状態を変えるか変えないかの判断の根拠が残らない）`,
      );
    }
    if (declared.has(rel)) {
      findings.push(`repeat_run.specs に ${rel} が重複している（分類が 1 つに決まらない）`);
      continue;
    }
    declared.set(rel, e.state_mutating);
  }
  return declared;
}

/**
 * repeat_run.shared_files を読み、共通部分と認めるパス（normalizeRel 済み）を返す。記録の不備は所見に足す。
 * @param {unknown} rawShared
 * @param {{ declared: Map<string, boolean>, findings: string[] }} ctx
 * @returns {Set<string>}
 */
function readSharedDeclarations(rawShared, { declared, findings }) {
  if (!isArray(rawShared)) throw new UsageError("suite.repeat_run.shared_files が配列でない");
  /** @type {Set<string>} */
  const sharedDeclared = new Set();
  for (const [i, e] of rawShared.entries()) {
    if (!isPlainObject(e))
      throw new UsageError(`suite.repeat_run.shared_files[${i}] がオブジェクトでない`);
    if (!nonEmptyString(e.path)) {
      findings.push(`repeat_run.shared_files[${i}] の path が空`);
      continue;
    }
    const rel = normalizeRel(String(e.path));
    // 共通部分と宣言すると 2 回続けての緑を求めなくなる（緩和）ので、テストを定義しない根拠が無いものは共通部分と認めない
    if (!nonEmptyString(e.reason)) {
      findings.push(
        `repeat_run.shared_files の ${rel} に reason が無い（テストを定義しない共通の関数だと判断した根拠が残らない）。共通部分と認めない`,
      );
      continue;
    }
    if (declared.has(rel)) {
      findings.push(
        `${rel} が repeat_run.specs と repeat_run.shared_files の両方にある（スペックか共通部分かが決まらない）`,
      );
      continue;
    }
    if (sharedDeclared.has(rel)) {
      findings.push(`repeat_run.shared_files に ${rel} が重複している`);
      continue;
    }
    sharedDeclared.add(rel);
  }
  return sharedDeclared;
}

/**
 * スペック単位の反復実行を数え直す（repeat_run.specs を持つ成果物）。
 *
 * 状態を変えるスペックごとに、そのスペックを含む直近 2 回の記録が緑・別の日時で順に始まり、
 * どちらもそのスペックの指紋と共通部分（shared）の指紋が現在と一致することを求める。
 * 状態を変えないスペックは 1 回の緑（current_green）で足りる。分類されていないスペックは落とす。
 * @param {Record<string, unknown>} suiteObj
 * @param {Record<string, unknown>} record - suite.repeat_run
 * @param {string} root
 * @returns {{ findings: string[], notes: string[] }}
 */
function checkRepeatRunPerSpec(suiteObj, record, root) {
  const { findings, declared, sharedDeclared, excluded } = readSpecClassification(
    record,
    root,
    suiteObj.specs,
  );
  const current = specFingerprints(suiteObj, root, {
    declared: [...declared.keys()],
    sharedDeclared: [...sharedDeclared],
    excluded,
  });
  if (current.shared === null) {
    findings.push(fingerprintUnavailable(current.missing));
    return { findings, notes: [] };
  }
  findings.push(...classificationFindings(current, declared, sharedDeclared));
  const specSet = new Set(current.specFiles);
  const mutating = [...declared].filter(([f, m]) => m && specSet.has(f)).map(([f]) => f);
  if (mutating.length === 0 && [...declared.values()].every((m) => !m)) {
    findings.push(
      "suite.state_mutating: true なのに repeat_run.specs に状態を変えるスペックが 1 件も無い（状態を変えないなら suite.state_mutating: false と reason を書く）",
    );
  }

  const { runRecords, withoutSpecPrints } = readPerSpecRuns(record);
  findings.push(...mutatingSpecFindings(mutating, runRecords, current));
  // 状態を変えないスペックは 1 回の緑で足りるが、その 1 回も現在の版に結びつける。
  // 結びつけないと、状態を変えないスペックを書き換えた（壊した）後も、状態を変えるスペックの記録だけで通る
  const readOnly = current.specFiles.filter((f) => declared.get(f) === false);
  findings.push(...readOnlySpecFindings(readOnly, runRecords, current));
  /** @type {string[]} */
  const notes = [
    `スペック単位で判定: 状態を変えるスペック ${mutating.length} 件は 2 回続けての緑、状態を変えないスペック ${readOnly.length} 件は現在の版での 1 回の緑で足りる（共通部分 ${current.sharedFiles} ファイル、current_excluded ${excluded.length} 件）`,
  ];
  if (withoutSpecPrints > 0) {
    notes.push(
      `spec_fingerprints を持たない実行記録 ${withoutSpecPrints} 件はスペック単位の判定に使わない`,
    );
  }
  if (current.unparsed.length > 0) notes.push(unparsedNote(current.unparsed));
  return { findings, notes };
}

/**
 * 現在のスイートの指紋を計算できないときの所見。
 * @param {string[]} missing
 * @returns {string}
 */
function fingerprintUnavailable(missing) {
  return `現在のスイートの指紋を計算できない（判定不能を合格として扱わない）: ${missing.length > 0 ? `読めない ${missing.join(" / ")}` : "suite.specs / locator_map / interactions がどれも宣言されていない"}`;
}

/**
 * コメントを除けず生バイトで数えたファイルの注記。
 * @param {string[]} unparsed
 * @returns {string}
 */
function unparsedNote(unparsed) {
  return `コメントを除けず生バイトで数えたファイル（字句解析が閉じない）: ${unparsed.join(" / ")}`;
}

/**
 * 分類表（repeat_run.specs / shared_files）と、実際に suite.specs の下に在るファイルとの食い違いを挙げる。
 * @param {{ specFiles: string[], undeclared: string[], specsTreeShared: string[] }} current
 * @param {Map<string, boolean>} declared
 * @param {Set<string>} sharedDeclared
 * @returns {string[]}
 */
function classificationFindings(current, declared, sharedDeclared) {
  /** @type {string[]} */
  const findings = [];
  const specSet = new Set(current.specFiles);
  for (const f of current.specFiles) {
    if (!declared.has(f)) {
      findings.push(
        `repeat_run.specs で分類されていないスペック: ${f}（状態を変えるかどうかが決まらない。state_mutating と reason を書く）`,
      );
    }
  }
  for (const f of current.undeclared) {
    findings.push(
      `suite.specs の下で命名規則（*.spec.* / *.test.*）に当たらず、repeat_run.specs にも repeat_run.shared_files にも無いファイル: ${f}（スペックなら specs に、テストを定義しない共通の関数・fixture なら shared_files に理由を付けて書く）`,
    );
  }
  const treeShared = new Set(current.specsTreeShared);
  for (const f of sharedDeclared) {
    if (!treeShared.has(f)) {
      findings.push(
        `repeat_run.shared_files のファイルが suite.specs の下の共通部分に無い: ${f}（実体が無い・suite.specs の外・current_excluded の下のいずれか）`,
      );
    }
  }
  for (const f of declared.keys()) {
    if (!specSet.has(f)) {
      findings.push(
        `repeat_run.specs のスペックが suite.specs の下に無い: ${f}（実体が無い・suite.specs の外・current_excluded の下のいずれか）`,
      );
    }
  }
  return findings;
}

/**
 * repeat_run.runs を読む。型の誤りは UsageError にする。
 * @param {Record<string, unknown>} record - suite.repeat_run
 * @returns {{ runRecords: Record<string, unknown>[], withoutSpecPrints: number }}
 */
function readPerSpecRuns(record) {
  const runs = record.runs;
  if (runs !== undefined && runs !== null && !isArray(runs))
    throw new UsageError("suite.repeat_run.runs が配列でない");
  const list = isArray(runs) ? runs : [];
  let withoutSpecPrints = 0;
  /** @type {Record<string, unknown>[]} */
  const runRecords = [];
  for (const [i, run] of list.entries()) {
    if (!isPlainObject(run))
      throw new UsageError(`suite.repeat_run.runs[${i}] がオブジェクトでない`);
    runRecords.push(run);
    const prints = run.spec_fingerprints;
    if (prints === undefined || prints === null) {
      withoutSpecPrints += 1;
      continue;
    }
    if (!isPlainObject(prints) || !Object.values(prints).every((v) => nonEmptyString(v))) {
      throw new UsageError(
        `suite.repeat_run.runs[${i}].spec_fingerprints が「スペックのパス → 指紋」のオブジェクトでない`,
      );
    }
    // 正規化すると同じスペックになるキーが 2 つあると、どちらを読むかが挿入順で決まり、矛盾した記録が警告なしに通る（--fingerprint は書かない形）
    const normalizedKeys = Object.keys(prints).map((k) => normalizeRel(k));
    const dup = normalizedKeys.find((k, j) => normalizedKeys.indexOf(k) !== j);
    if (dup !== undefined) {
      throw new UsageError(
        `suite.repeat_run.runs[${i}].spec_fingerprints に同じスペック ${dup} を指すキーが複数ある`,
      );
    }
  }
  return { runRecords, withoutSpecPrints };
}

/**
 * スペック spec を含む実行記録を、記録の順に返す。
 * @param {Record<string, unknown>[]} list
 * @param {string} spec
 * @returns {Record<string, unknown>[]}
 */
function runsWithSpec(list, spec) {
  return list.filter(
    (run) =>
      isPlainObject(run.spec_fingerprints) &&
      Object.keys(run.spec_fingerprints).some((k) => normalizeRel(k) === spec),
  );
}

/**
 * 状態を変えるスペックごとに、直近 2 回の記録が緑で、現在のスペックと共通部分の版に結びつくかを数える。
 * @param {string[]} mutating
 * @param {Record<string, unknown>[]} list - repeat_run.runs（すべてオブジェクト）
 * @param {{ shared: string | null, specs: Record<string, string> }} current
 * @returns {string[]}
 */
function mutatingSpecFindings(mutating, list, current) {
  /** @type {string[]} */
  const findings = [];
  for (const spec of mutating) {
    const hits = runsWithSpec(list, spec);
    if (hits.length < 2) {
      findings.push(
        `状態を変えるスペック ${spec} の実行記録が ${hits.length} 件（そのスペックを 2 回続けて回さないと後始末の有無が結果に現れない）`,
      );
      continue;
    }
    const tail = hits.slice(-2);
    findings.push(...pairFindings(tail, `スペック ${spec}: `));
    const recorded = tail.map((run) => specFingerprint(run.spec_fingerprints, spec));
    if (recorded.some((fp) => fp !== current.specs[spec])) {
      findings.push(
        `状態を変えるスペック ${spec} の 2 回の記録は現在のスペックのものでない（記録 ${recorded.join(" / ")} ≠ 実測 ${current.specs[spec]}）。このスペックを 2 回続けて回し直す`,
      );
    }
    const shared = tail.map((run) =>
      nonEmptyString(run.shared_fingerprint) ? String(run.shared_fingerprint).trim() : null,
    );
    if (shared.some((fp) => fp === null)) {
      findings.push(
        `スペック ${spec} の記録に shared_fingerprint が無い（スペックが共通に読む部分のどの版で回したか対応づかない）`,
      );
    } else if (shared.some((fp) => fp !== current.shared)) {
      findings.push(
        `スペック ${spec} の 2 回の記録は現在の共通部分のものでない（shared_fingerprint ${shared.join(" / ")} ≠ 実測 ${current.shared}）。` +
          "共通部分（locator_map / expectations / interactions / tools・suite.specs の下のスペック以外）を変えたら、状態を変えるスペックをすべて 2 回続けて回し直す",
      );
    }
  }
  return findings;
}

/**
 * 状態を変えないスペックごとに、直近の記録が緑で、現在のスペックと共通部分の版に結びつくかを数える。
 * @param {string[]} readOnly
 * @param {Record<string, unknown>[]} list - repeat_run.runs（すべてオブジェクト）
 * @param {{ shared: string | null, specs: Record<string, string> }} current
 * @returns {string[]}
 */
function readOnlySpecFindings(readOnly, list, current) {
  /** @type {string[]} */
  const findings = [];
  for (const spec of readOnly) {
    const last = runsWithSpec(list, spec).at(-1);
    if (last === undefined) {
      findings.push(
        `状態を変えないスペック ${spec} の実行記録が 0 件（1 回の緑を現在のスペックに結びつける記録が無い）`,
      );
      continue;
    }
    const recorded = specFingerprint(last.spec_fingerprints, spec);
    const shared = nonEmptyString(last.shared_fingerprint)
      ? String(last.shared_fingerprint).trim()
      : null;
    if (last.result !== GREEN) {
      findings.push(
        `状態を変えないスペック ${spec} の直近の記録が緑でない（result: ${JSON.stringify(last.result)}）`,
      );
    } else if (recorded !== current.specs[spec] || shared !== current.shared) {
      findings.push(
        `状態を変えないスペック ${spec} の直近の緑は現在のスペック・共通部分のものでない（spec ${recorded} / shared ${shared} ≠ 実測 ${current.specs[spec]} / ${current.shared}）。このスペックを 1 回回して記録を足す`,
      );
    }
  }
  return findings;
}

/**
 * 状態を変えるスイートの反復実行を数え直す。
 * @param {Record<string, unknown>} metadata
 * @param {{ artifactHealthPresent: boolean, root: string }} ctx
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
export function checkRepeatRun(metadata, ctx) {
  const suite = metadata.suite;
  if (suite !== undefined && suite !== null && !isPlainObject(suite))
    throw new UsageError("suite がオブジェクトでない");
  // suite をキーごと持たない成果物も「state_mutating が無い」と同じ扱いにする（型の誤りとして扱わない）。
  // artifact_health を宣言していれば下の分岐が未検証として落とすので、後方互換のために確かめずに通すことはない。
  const suiteObj = isPlainObject(suite) ? suite : {};
  if (!("state_mutating" in suiteObj)) return withoutStateMutating(ctx.artifactHealthPresent);
  if (typeof suiteObj.state_mutating !== "boolean")
    throw new UsageError("suite.state_mutating が真偽値でない");

  const repeat = suiteObj.repeat_run;
  if (repeat !== undefined && repeat !== null && !isPlainObject(repeat)) {
    throw new UsageError("suite.repeat_run がオブジェクトでない");
  }
  const record = isPlainObject(repeat) ? repeat : {};

  if (!suiteObj.state_mutating) return checkNonMutating(record);

  /** @type {string[]} */
  const findings = [];
  if (record.cleanup_in_suite !== true) {
    findings.push(
      "状態を変えるスイートなのに repeat_run.cleanup_in_suite が true でない（後始末が外のツールに依存すると、回した人が忘れた時点で次の実行が失敗する）",
    );
  }
  // 分類表を持つ成果物はスペック単位で判定する（持たない成果物は従来どおりスイート全体の指紋で判定する）
  if (record.specs !== undefined && record.specs !== null) {
    const perSpec = checkRepeatRunPerSpec(suiteObj, record, ctx.root);
    findings.push(...perSpec.findings);
    return { judged: true, findings, notes: perSpec.notes };
  }
  const whole = checkWholeSuiteRuns(suiteObj, record, ctx.root);
  findings.push(...whole.findings);
  return { judged: true, findings, notes: whole.notes };
}

/**
 * suite.state_mutating をキーごと持たない成果物を扱う。
 * @param {boolean} artifactHealthPresent
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
function withoutStateMutating(artifactHealthPresent) {
  // 判定の根拠は artifact_health の「宣言の有無」ではなく「キーの有無」。
  // declared: false は視覚採取物を持たない成果物（api-resource 等）の免除であって旧成果物ではなく、
  // 書き込み系 API のスイートこそ 2 回続けての緑を要る側なので、ここで外さない。
  if (artifactHealthPresent) {
    return {
      judged: true,
      findings: [
        "artifact_health を持つ成果物なのに suite.state_mutating が無い（状態を変えるかどうかが決まらない）",
      ],
      notes: [],
    };
  }
  return {
    judged: false,
    findings: [],
    notes: ["suite.state_mutating をキーごと持たない旧成果物のため反復実行の節を判定しない"],
  };
}

/**
 * suite.state_mutating: false のスイートを数え直す（2 回続けての緑は求めない）。
 * @param {Record<string, unknown>} record - suite.repeat_run
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
function checkNonMutating(record) {
  /** @type {string[]} */
  const findings = [];
  if (record.specs !== undefined && record.specs !== null && !isArray(record.specs))
    throw new UsageError("suite.repeat_run.specs が配列でない");
  if (
    isArray(record.specs) &&
    record.specs.some((e) => isPlainObject(e) && e.state_mutating === true)
  ) {
    findings.push(
      "suite.state_mutating: false なのに repeat_run.specs に状態を変えるスペックがある（どちらの宣言が正しいか決まらない）",
    );
  }
  if (!nonEmptyString(record.reason)) {
    findings.push(
      "suite.state_mutating: false なのに repeat_run.reason が空（状態を変えないと判断した根拠が残らない）",
    );
  }
  return {
    judged: true,
    findings,
    notes: ["suite.state_mutating: false のため 2 回続けての緑は求めない"],
  };
}

/**
 * 分類表を持たない成果物の反復実行を、スイート全体の指紋で数え直す。
 * @param {Record<string, unknown>} suiteObj
 * @param {Record<string, unknown>} record - suite.repeat_run
 * @param {string} root
 * @returns {{ findings: string[], notes: string[] }}
 */
function checkWholeSuiteRuns(suiteObj, record, root) {
  const runs = record.runs;
  if (runs !== undefined && runs !== null && !isArray(runs))
    throw new UsageError("suite.repeat_run.runs が配列でない");
  const list = isArray(runs) ? runs : [];
  if (list.length < 2) {
    return {
      findings: [
        `状態を変えるスイートの実行記録が ${list.length} 件（2 回続けて回さないと後始末の有無が結果に現れない）`,
      ],
      notes: [],
    };
  }
  /** @type {Record<string, unknown>[]} */
  const tailRecords = [];
  for (const [i, run] of list.slice(-2).entries()) {
    if (!isPlainObject(run))
      throw new UsageError(`suite.repeat_run.runs の末尾 ${i + 1} 件目がオブジェクトでない`);
    tailRecords.push(run);
  }
  const findings = pairFindings(tailRecords, "");
  /** @type {string[]} */
  const notes = [`状態を変えるスイートの実行記録 ${list.length} 件のうち末尾 2 件を判定`];
  const bound = suiteFingerprintBinding(tailRecords, suiteObj, root);
  findings.push(...bound.findings);
  notes.push(...bound.notes);
  return { findings, notes };
}

/**
 * 連続する 2 回の記録を「いまのスイート」に結びつける。指紋が無い旧成果物はこの軸を判定しない（理由は残す）。
 * @param {Record<string, unknown>[]} tailRecords
 * @param {Record<string, unknown>} suiteObj
 * @param {string} root
 * @returns {{ findings: string[], notes: string[] }}
 */
function suiteFingerprintBinding(tailRecords, suiteObj, root) {
  const prints = tailRecords.map((run) => run.suite_fingerprint);
  if (prints.every((p) => p === undefined || p === null)) {
    return {
      findings: [],
      notes: [
        "runs[].suite_fingerprint を持たない旧成果物のため、記録が現在のスイートのものかは判定しない",
      ],
    };
  }
  if (!prints.every((p) => nonEmptyString(p))) {
    return {
      findings: [
        "連続する 2 回のうち片方だけ suite_fingerprint を持つ（どの版のスイートを回したか対応づかない）",
      ],
      notes: [],
    };
  }
  const recorded = prints.map((p) => String(p).trim());
  if (recorded[0] !== recorded[1]) {
    return {
      findings: [
        `連続する 2 回で suite_fingerprint が違う（同じスイートを 2 回続けて回していない）: ${recorded.join(" / ")}`,
      ],
      notes: [],
    };
  }
  return matchSuiteFingerprint(recorded[0], suiteObj, root);
}

/**
 * 記録した指紋を、現在のスイートの指紋と照合する。
 * @param {string} recorded
 * @param {Record<string, unknown>} suiteObj
 * @param {string} root
 * @returns {{ findings: string[], notes: string[] }}
 */
function matchSuiteFingerprint(recorded, suiteObj, root) {
  // 記録の接頭辞で照合の方式を決める。旧方式（sha256:）の記録は旧方式で数え直す
  // （新方式へ一律に切り替えると、スイートを変えていない記録まで全部もう一度測ることになる）。
  const scheme = recorded.startsWith("sha256-nc:")
    ? "nc"
    : recorded.startsWith("sha256:")
      ? "legacy"
      : null;
  if (scheme === null) {
    return {
      findings: [
        `suite_fingerprint の方式を読めない（接頭辞が sha256-nc: でも sha256: でもない）: ${recorded}。--fingerprint の出力で記録し直す`,
      ],
      notes: [],
    };
  }
  const legacy = scheme === "legacy";
  const current = suiteFingerprint(suiteObj, root, { legacy });
  /** @type {{ findings: string[], notes: string[] }} */
  const out = { findings: [], notes: [] };
  if (current.fingerprint === null) {
    out.findings.push(fingerprintUnavailable(current.missing));
  } else if (current.fingerprint !== recorded) {
    out.findings.push(
      `記録した 2 回は現在のスイートのものでない（suite_fingerprint ${recorded} ≠ 実測 ${current.fingerprint}${legacy ? "。旧方式 sha256: の記録なのでコメントの書き換えも差として数えた" : ""}）。スイートを変えたら 2 回続けて回し直す`,
    );
  } else {
    out.notes.push(
      `スイートの指紋が記録と一致（${current.files} ファイル、${legacy ? "旧方式 sha256: の記録なのでコメントも含めて照合" : "JS / TS 系はコメントを除いて照合"}）`,
    );
  }
  if (current.unparsed.length > 0) out.notes.push(unparsedNote(current.unparsed));
  return out;
}

/**
 * 未測定の宣言を数え直す。
 * @param {Record<string, unknown>} metadata
 * @param {{ stage?: string }} [ctx] stage: "suite" なら blocking を落とさない（既定 "diff"）
 * @returns {{ judged: boolean, findings: string[], notes: string[], blocking: number }}
 */
export function checkUnmeasured(metadata, ctx) {
  const stage = ctx?.stage ?? "diff";
  if (!("unmeasured" in metadata)) {
    return {
      judged: false,
      findings: [],
      notes: ["unmeasured をキーごと持たない旧成果物のため未測定の節を判定しない"],
      blocking: 0,
    };
  }
  const decl = metadata.unmeasured;
  if (!isPlainObject(decl)) throw new UsageError("unmeasured がオブジェクトでない");
  if (typeof decl.declared !== "boolean")
    throw new UsageError("unmeasured.declared が真偽値でない");
  if (!decl.declared) {
    if (!nonEmptyString(decl.reason))
      throw new UsageError("unmeasured.declared: false なのに reason が空（免除の根拠が残らない）");
    return {
      judged: false,
      findings: [],
      notes: [`unmeasured.declared: false のため判定しない（理由: ${String(decl.reason).trim()}）`],
      blocking: 0,
    };
  }
  if (!isArray(decl.entries)) throw new UsageError("unmeasured.entries が配列でない");

  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const pending = [];
  let blocking = 0;
  const seen = new Set();
  for (const [i, entry] of decl.entries.entries()) {
    const judged = judgeUnmeasuredEntry(entry, i, seen);
    if (judged.blocking) blocking += 1;
    if (judged.finding !== null) findings.push(judged.finding);
    if (judged.item === null) continue;
    // suite 工程では blocking は「これから測る」の記録なので落とさない（書いた本人のチェックを止めない）。
    // diff 工程では収束を止める（原本: parity-suite の references/coverage.md「未測定を機械可読にする」）。
    if (stage === "suite") pending.push(judged.item);
    else findings.push(`未測定が残っている（disposition: blocking）: ${judged.item}`);
  }
  const notes = [`未測定の宣言 ${decl.entries.length} 件のうち blocking ${blocking} 件`];
  if (pending.length > 0) {
    notes.push(
      `stage: suite のため blocking ${pending.length} 件は落とさない（parity-diff の収束判定が受け取る）: ${pending.join(" / ")}`,
    );
  }
  return { judged: true, findings, notes, blocking };
}

/**
 * 未測定の宣言 1 件を判定する。
 * finding は記録の不備（どの工程でも落とす）、item は disposition: blocking の正規の記録（工程で扱いが変わる）。
 * @param {unknown} entry
 * @param {number} i
 * @param {Set<string>} seen - 既に読んだ item（重複の検出に使い、この関数が足す）
 * @returns {{ blocking: boolean, finding: string | null, item: string | null }}
 */
function judgeUnmeasuredEntry(entry, i, seen) {
  if (!isPlainObject(entry)) throw new UsageError(`unmeasured.entries[${i}] がオブジェクトでない`);
  /** @param {string} finding */
  const invalid = (finding) => ({ blocking: true, finding, item: null });
  const item = nonEmptyString(entry.item) ? String(entry.item).trim() : null;
  if (item === null) return invalid(`unmeasured.entries[${i}].item が空（照合キーが無い）`);
  if (seen.has(item)) return invalid(`未測定の項目が重複している（先勝ちにしない）: ${item}`);
  seen.add(item);
  if (!nonEmptyString(entry.reason)) return invalid(`未測定の理由が空: ${item}`);
  const disposition = entry.disposition;
  if (typeof disposition !== "string" || !DISPOSITIONS.includes(disposition)) {
    return invalid(
      `未測定の disposition が語彙外（${DISPOSITIONS.join(" / ")}）のため blocking として数える: ${item}`,
    );
  }
  if (disposition !== "accepted") return { blocking: true, finding: null, item };
  if (!nonEmptyString(entry.approved_by) || !nonEmptyString(entry.approved_at)) {
    return invalid(
      `accepted なのに approved_by / approved_at が空のため blocking として数える: ${item}`,
    );
  }
  return { blocking: false, finding: null, item: null };
}

/**
 * 整数として読める値に直す（数値・数字だけの文字列を受ける）。版と反復回数の両方で使う。
 * @param {unknown} v
 * @returns {number | null}
 */
function toInteger(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number.parseInt(v.trim(), 10);
  return null;
}

/**
 * 記録済みの版 V より後、現在の版 C までの changes[].affects を集める。
 * 履歴が不正（欠番・重複・affects が配列でない）なときは null を返す。
 * 原本（golden-dataset の references/versioning.md）が「影響なしとして扱わない」と定めているため、
 * 呼び出し側はこれを陳腐化として扱う。
 * @param {unknown} changes
 * @param {number} v
 * @param {number} c
 * @returns {string[] | null}
 */
export function affectsBetween(changes, v, c) {
  if (!isArray(changes)) return null;
  /** @type {Map<number, string[]>} */
  const byVersion = new Map();
  for (const change of changes) {
    if (!isPlainObject(change)) return null;
    const ver = toInteger(change.version);
    if (ver === null || ver < 1) return null;
    if (byVersion.has(ver)) return null;
    if (!isArray(change.affects)) return null;
    for (const a of change.affects) if (!nonEmptyString(a)) return null;
    byVersion.set(
      ver,
      change.affects.map((a) => String(a).trim()),
    );
  }
  for (let i = 1; i <= c; i += 1) if (!byVersion.has(i)) return null;
  /** @type {string[]} */
  const out = [];
  // 1 から c までの版がすべて在ることは、直前で確かめている
  for (let i = v + 1; i <= c; i += 1) out.push(...(byVersion.get(i) ?? []));
  return [...new Set(out)];
}

/**
 * 工程が残す成果物の在否と鮮度を数え直す（--target のときだけ）。
 *
 * new.commit が両側とも SHA で食い違うときは、evidence-carry.mjs の judgeCarry で描画入力の差分から
 * 持ち越せるかを判定する（replace-metadata.json に new.render_inputs があるときだけ。無ければ従来どおり落とす）。
 * component-comparison-check.mjs の comparison-implementation-stale と同じ関数で判定し、2 つのチェックの判定を揃える。
 *
 * carryTo（--carry-to）を渡すと、replace-metadata.json の new.commit とは別に、diff-metadata.json の new.commit から
 * その版への持ち越しを必ず judgeCarry で判定する。部品改修の一括再検証の直後は両方の記録が改修前の版で
 * 一致し、上の食い違いの判定が呼ばれないため、不正な evidence-carry.json がその場で見つからない。
 * 判定できない状態（工程の節を判定しない・記録の版が SHA でない）は合格として扱わない。
 * @param {{ root: string, slugDir: string, target: string, newRepo?: string | null, replaceRoot?: string | null, featureMetadata?: unknown, carryTo?: string | null }} ctx
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
export function checkStage(ctx) {
  const stageDir = join(ctx.slugDir, "new", ctx.target);
  const replacePath = join(stageDir, "replace-metadata.json");
  const carryTo = nonEmptyString(ctx.carryTo) ? ctx.carryTo.trim() : null;
  if (!existsSync(replacePath)) {
    return skipStage(
      `${replacePath} が無いため工程の節を判定しない（新側の工程が回っていない）`,
      carryTo,
    );
  }
  const replaceMeta = readReplaceMetadata(replacePath);
  const replaceSuite = replaceMeta.suite;
  const newGreen = isPlainObject(replaceSuite) ? replaceSuite.new_green : undefined;
  if (newGreen !== true) {
    return skipStage(
      `suite.new_green が真でないため工程の節を判定しない（${replacePath}）`,
      carryTo,
    );
  }

  const diffPath = join(stageDir, "diff-metadata.json");
  if (!existsSync(diffPath)) {
    return {
      judged: true,
      findings: [
        `suite.new_green: true なのに diff-metadata.json が無い（工程の完了が記憶に委ねられている）: ${diffPath}`,
      ],
      notes: [],
    };
  }
  const diffMeta = readJson(diffPath, "diff-metadata.json");
  if (!isPlainObject(diffMeta)) throw new UsageError("diff-metadata.json がオブジェクトでない");

  const s = stageState({ ctx, stageDir, diffPath, carryTo, replaceMeta, diffMeta });
  judgeStageTargets(s);
  const commits = judgeStageCommits(s);
  judgeCarryTo(s, commits.judgedWanted);
  judgeStageIteration(s, commits.versionDelegatedToIteration);
  judgeStageDataset(s);
  return { judged: true, findings: s.findings, notes: s.notes };
}

/**
 * checkStage の判定の途中経過。所見と注記は各段が足す。
 * @typedef {{ ctx: { root: string, slugDir: string, target: string, newRepo?: string | null, replaceRoot?: string | null, featureMetadata?: unknown, carryTo?: string | null }, stageDir: string, diffPath: string, carryTo: string | null, replaceMeta: Record<string, unknown>, diffMeta: Record<string, unknown>, replaceNew: Record<string, unknown> | null, diffNew: Record<string, unknown> | null, findings: string[], notes: string[] }} StageState
 */

/**
 * 判定の途中経過を作る。
 *
 * 同じ target の diff-metadata.json が「いまの新側」に対応しているかを見る。
 * dataset_version だけを鮮度にすると、データセットを変えずに parity-replace が作り直した実装に対して、
 * 前の反復で収束した古い diff-metadata.json が、そのままこのチェックを満たす（差分を採り直していないのに「済んだ」に見える）。
 * 対応づけは、両成果物が既に持っている識別子（新側のコミット SHA と反復回数）で取る。
 * @param {Omit<StageState, "replaceNew" | "diffNew" | "findings" | "notes">} base
 * @returns {StageState}
 */
function stageState(base) {
  return {
    ...base,
    replaceNew: isPlainObject(base.replaceMeta.new) ? base.replaceMeta.new : null,
    diffNew: isPlainObject(base.diffMeta.new) ? base.diffMeta.new : null,
    findings: [],
    notes: [],
  };
}

/**
 * 工程の節を判定しないで返す。--carry-to を渡したときは、持ち越しを確かめないまま通さない。
 * @param {string} reason
 * @param {string | null} carryTo
 * @returns {{ judged: boolean, findings: string[], notes: string[] }}
 */
function skipStage(reason, carryTo) {
  return carryTo === null
    ? { judged: false, findings: [], notes: [reason] }
    : {
        judged: true,
        findings: [`--carry-to ${carryTo} への持ち越しを判定できない（${reason}）`],
        notes: [],
      };
}

/**
 * replace-metadata.json を読み、オブジェクトであることと suite の型を確かめる。
 * @param {string} replacePath
 * @returns {Record<string, unknown>}
 */
function readReplaceMetadata(replacePath) {
  const replaceMeta = readJson(replacePath, "replace-metadata.json");
  if (!isPlainObject(replaceMeta))
    throw new UsageError("replace-metadata.json がオブジェクトでない");
  const replaceSuite = replaceMeta.suite;
  if (replaceSuite !== undefined && replaceSuite !== null && !isPlainObject(replaceSuite)) {
    throw new UsageError("replace-metadata.json の suite がオブジェクトでない");
  }
  return replaceMeta;
}

/**
 * 環境の対応と、未コミット変更の有無を見る。
 * @param {StageState} s
 */
function judgeStageTargets(s) {
  // 環境の対応づけ。同じコミット・同じ反復は環境をまたいで一致しうるので、
  // 両成果物が記録している target 名を --target と突き合わせる
  // （別 target のディレクトリへコピーしただけの成果物が、その環境で差分を採らずに通るのを防ぐ）。
  /** @type {Array<[string, unknown]>} */
  const recordedTargets = [
    ["replace-metadata.json", s.replaceNew === null ? undefined : s.replaceNew.target],
    ["diff-metadata.json", s.diffNew === null ? undefined : s.diffNew.target],
  ];
  for (const [label, value] of recordedTargets) {
    if (!nonEmptyString(value)) {
      s.notes.push(`${label} が new.target を持たないため環境の対応を判定しない（旧成果物）`);
      continue;
    }
    if (String(value).trim() !== s.ctx.target) {
      s.findings.push(
        `${label} が別の環境の成果物（new.target ${String(value).trim()} ≠ --target ${s.ctx.target}）: ${s.stageDir}`,
      );
    }
  }

  // 未コミット変更のある木では「差分を採った実装」を特定できない。
  // コミットの比較方法（一致 / none / 片側欠落）を選ぶ前に落とす。
  // none の枝へ入ると dirty の判定へ到達せず、同じ反復のまま中身だけ変わった実装が素通りする。
  if (s.replaceNew !== null && s.replaceNew.dirty === true) {
    s.findings.push(
      `新側の版を特定できない（replace-metadata.json の new.dirty: true。未コミット変更があるので版の同一性を確かめられない）: ${s.diffPath}`,
    );
  }
}

/**
 * 記録の版から今の版へ、証跡を持ち越せるかを evidence-carry.mjs の judgeCarry で判定する。
 * @param {StageState} s
 * @param {string} recordedCommit
 * @param {string} wantedCommit
 */
function carryFrom(s, recordedCommit, wantedCommit) {
  return judgeCarry({
    recordedCommit,
    wantedCommit,
    renderInputs: s.replaceNew === null ? undefined : s.replaceNew.render_inputs,
    repo: s.ctx.newRepo ?? null,
    evidenceCarryPath: join(s.stageDir, EVIDENCE_CARRY_FILE),
    featureSlug: basename(s.ctx.slugDir),
    featureMetadata: s.ctx.featureMetadata,
    replaceRoot: s.ctx.replaceRoot ?? join(s.ctx.root, ".replace"),
  });
}

/**
 * 両成果物の new.commit を突き合わせる。
 * @param {StageState} s
 * @returns {{ judgedWanted: string | null, versionDelegatedToIteration: boolean }}
 */
function judgeStageCommits(s) {
  const replaceCommit = s.replaceNew === null ? undefined : s.replaceNew.commit;
  const diffCommit = s.diffNew === null ? undefined : s.diffNew.commit;
  // judgedWanted: 食い違いの判定で既に judgeCarry に掛けた「今の版」。--carry-to が同じ版なら二重に判定しない。
  // versionDelegatedToIteration: commit が `none` センチネルで、版の対応が反復回数だけに委ねられたか。
  // 委ねた先も読めないときに、合格として扱わないための材料（反復回数の判定で使う）。
  if (!nonEmptyString(replaceCommit) || !nonEmptyString(diffCommit)) {
    s.notes.push(
      "new.commit を片側が持たないため新側の版の対応を判定しない（旧成果物）: 記録があれば次の実行から判定する",
    );
    return { judgedWanted: null, versionDelegatedToIteration: false };
  }
  const wanted = String(replaceCommit).trim();
  const recordedCommit = String(diffCommit).trim();
  // **反復回数へ委ねるのは、両側とも `${NO_COMMIT}` のときだけである**。片側だけが `none` なら、
  // 記録した SHA と現在の `none`（またはその逆）は同じ版を指さない。反復回数が
  // たまたま一致しただけで合格として扱うと、git 管理の有無が変わった新側で古い成果物が通る
  // （component-comparison-check.mjs と同じ規則。原本は references/coverage.md）。
  if (wanted === NO_COMMIT && recordedCommit === NO_COMMIT) {
    s.notes.push(
      `new.commit が ${NO_COMMIT}（新側リポジトリのコミットを持たない）ため版の対応は反復回数だけで判定する: ${s.diffPath}`,
    );
    return { judgedWanted: null, versionDelegatedToIteration: true };
  }
  if (wanted === recordedCommit) return { judgedWanted: null, versionDelegatedToIteration: false };
  // SHA の不一致を即失効にせず、ページの描画入力の差分で持ち越せるかを見る。
  // 判定の原本は evidence-carry.mjs。component-comparison-check.mjs も同じ関数で判定する。
  const carry = carryFrom(s, recordedCommit, wanted);
  if (carry.ok) {
    s.notes.push(...carry.notes.map((note) => `${note}: ${s.diffPath}`));
  } else {
    s.findings.push(
      `diff-metadata.json が今の新側の版に対応していない（new.commit ${recordedCommit} ≠ replace-metadata.json の ${wanted}）: ${s.diffPath}`,
    );
    s.findings.push(...carry.findings.map((f) => `証跡を持ち越せない: ${f}`));
    s.notes.push(...carry.notes);
  }
  return { judgedWanted: wanted, versionDelegatedToIteration: false };
}

/**
 * --carry-to: 記録の版から検証先の版への持ち越しを、replace-metadata.json の new.commit に依らず判定する。
 * @param {StageState} s
 * @param {string | null} judgedWanted
 */
function judgeCarryTo(s, judgedWanted) {
  const { carryTo, diffPath } = s;
  if (carryTo !== null && carryTo !== judgedWanted) {
    const diffCommit = s.diffNew === null ? undefined : s.diffNew.commit;
    const recorded = nonEmptyString(diffCommit) ? String(diffCommit).trim() : null;
    if (recorded === null || recorded === NO_COMMIT) {
      s.findings.push(
        `--carry-to ${carryTo} への持ち越しを判定できない（diff-metadata.json の new.commit が ${recorded ?? "無い"}。記録の版が SHA でないと描画入力の差分を取れない）: ${diffPath}`,
      );
      return;
    }
    const carry = carryFrom(s, recorded, carryTo);
    if (carry.ok) {
      s.notes.push(...carry.notes.map((note) => `--carry-to ${carryTo}: ${note}: ${diffPath}`));
    } else {
      s.findings.push(
        `diff-metadata.json の証跡を --carry-to の版へ持ち越せない（new.commit ${recorded} → ${carryTo}）: ${diffPath}`,
      );
      s.findings.push(...carry.findings.map((f) => `証跡を持ち越せない: ${f}`));
      s.notes.push(...carry.notes);
    }
  }
}

/**
 * diff-metadata.json の iteration を replace-metadata.json の loop.iterations と突き合わせる。
 * @param {StageState} s
 * @param {boolean} versionDelegatedToIteration
 */
function judgeStageIteration(s, versionDelegatedToIteration) {
  const loop = isPlainObject(s.replaceMeta.loop) ? s.replaceMeta.loop : null;
  const iterations = toIterationCount(loop === null ? undefined : loop.iterations);
  const recordedIteration = toIterationCount(s.diffMeta.iteration);
  if (iterations !== null && recordedIteration !== null) {
    if (recordedIteration !== iterations) {
      s.findings.push(
        `diff-metadata.json が前の反復のもの（iteration ${recordedIteration} ≠ replace-metadata.json の loop.iterations ${iterations}）: ${s.diffPath}`,
      );
    }
  } else if (versionDelegatedToIteration) {
    // **委譲した先が読めないことを合格として扱わない**。commit が `none` の枝は、版の対応を
    // 反復回数へ委ねている。その反復回数も読めないと、実装を変えても古い成果物が、
    // 版の検査を 1 つも受けずに通ってしまう（component-comparison-check.mjs の
    // comparison-implementation-unversionable と同じ扱いにする）。
    s.findings.push(
      `新側の版を対応づける指標が無い（new.commit が ${NO_COMMIT} なのに iteration: ${recordedIteration === null ? "読めない" : recordedIteration} / loop.iterations: ${iterations === null ? "読めない" : iterations}）: ${s.diffPath}`,
    );
  } else {
    s.notes.push(
      "iteration / loop.iterations を片側が持たないため反復の対応を判定しない（旧成果物）: 記録があれば次の実行から判定する",
    );
  }
}

/**
 * データセットの版で diff-metadata.json の鮮度を見る。converged が偽でも落とさない。
 * @param {StageState} s
 */
function judgeStageDataset(s) {
  if (datasetVersionExempted(s)) return;
  const versions = readDatasetVersions(s);
  if (versions === null) return;
  if (!judgeDatasetRange(s, versions)) return;
  // converged が偽でも落とさない。偽は「まだ直っていない」の記録であり、隠す相手ではない。
  s.notes.push(
    `工程の成果物を判定（converged: ${JSON.stringify(s.diffMeta.converged)} は判定に入れない）`,
  );
}

/**
 * dataset_version の免除を読む。正規の免除なら注記を足して true を返す。
 * @param {StageState} s
 * @returns {boolean}
 */
function datasetVersionExempted(s) {
  const { diffMeta, diffPath } = s;
  // 投入対象でない target（db を持たない／seedable の無い読み取り専用）は phase B との整合を免除できる。
  // 原本: parity-diff の references/preflight.md と assets/diff-metadata-template.json の dataset_version_exempt。
  // 免除は dataset_version: null と対で書かれるので、空の判定より先に見る（正規の記録を落とさない）。
  const exempt = diffMeta.dataset_version_exempt;
  if (exempt !== undefined && exempt !== null && typeof exempt !== "string") {
    throw new UsageError("diff-metadata.json の dataset_version_exempt が文字列でも null でもない");
  }
  if (!nonEmptyString(exempt)) return false;
  // 免除は「dataset_version: null ＋ 理由」という閉じた対（原本の定める形）。
  // 理由が残っているだけで版の検査を飛ばすと、投入対象の target に古い免除文字列が残ったまま
  // 鮮度の判定が丸ごと外れる。対になっていなければ免除ではなく記録の不整合として落とす。
  if (diffMeta.dataset_version !== null) {
    s.findings.push(
      `dataset_version_exempt があるのに dataset_version が null でない（免除は null と対の記録。現在 ${JSON.stringify(diffMeta.dataset_version)}）: ${diffPath}`,
    );
    return false;
  }
  s.notes.push(`dataset_version を免除して判定（理由: ${String(exempt).trim()}）: ${diffPath}`);
  s.notes.push(
    `工程の成果物を判定（converged: ${JSON.stringify(diffMeta.converged)} は判定に入れない）`,
  );
  return true;
}

/**
 * データセットの現在の版と、diff-metadata.json に記録した版を読む。読めなければ所見を足して null を返す。
 * @param {StageState} s
 * @returns {{ v: number, c: number, datasetMeta: Record<string, unknown>, datasetPath: string } | null}
 */
function readDatasetVersions(s) {
  const { diffMeta, diffPath } = s;
  const datasetPath = join(s.ctx.root, ".replace", "dataset", "metadata.json");
  if (!existsSync(datasetPath)) {
    s.findings.push(
      `データセットの版を読めないため鮮度を判定できない（判定不能を合格として扱わない）: ${datasetPath}`,
    );
    return null;
  }
  const datasetMeta = readJson(datasetPath, "dataset/metadata.json");
  if (!isPlainObject(datasetMeta))
    throw new UsageError("dataset/metadata.json がオブジェクトでない");
  const current = datasetMeta.version;
  const recorded = diffMeta.dataset_version;
  if (current === undefined || current === null || String(current).trim() === "") {
    s.findings.push(`データセットの version が空のため鮮度を判定できない: ${datasetPath}`);
    return null;
  }
  if (recorded === undefined || recorded === null || String(recorded).trim() === "") {
    s.findings.push(
      `diff-metadata.json の dataset_version が空で dataset_version_exempt も空（古いかどうかを判定できない）: ${diffPath}`,
    );
    return null;
  }
  const v = toInteger(recorded);
  const c = toInteger(current);
  if (v === null || c === null) {
    s.findings.push(
      `dataset_version が整数として読めない（記録 ${JSON.stringify(recorded)} / 現在 ${JSON.stringify(current)}）: ${diffPath}`,
    );
    return null;
  }
  return { v, c, datasetMeta, datasetPath };
}

/**
 * 記録した版 v と現在の版 c の区間を見る。判定を続けてよいなら true を返す。
 * @param {StageState} s
 * @param {{ v: number, c: number, datasetMeta: Record<string, unknown>, datasetPath: string }} versions
 * @returns {boolean}
 */
function judgeDatasetRange(s, { v, c, datasetMeta, datasetPath }) {
  // 数値が古いだけでは陳腐化にしない。原本は golden-dataset の references/versioning.md である。
  // 記録済み V・現在 C として 1 <= V <= C を確かめ、V < change.version <= C の affects が
  // slug の実効参照テーブルと交差するときだけ陳腐化する。実効参照テーブルは .replace/features.md から導く。
  // 導出規則の原本は golden-dataset 側にあるため、ここで 2 つ目の実装を作らない。
  // ここで落とすのは、交差を見るまでもなく陳腐化が確定する形（版が読めない・区間に * がある・履歴が不正）だけである。
  if (v < 1 || v > c) {
    s.findings.push(
      `dataset_version の範囲が不正（記録 ${v} / 現在 ${c}。1 <= 記録 <= 現在 を満たさない）: ${s.diffPath}`,
    );
    return false;
  }
  if (v === c) return true;
  const affects = affectsBetween(datasetMeta.changes, v, c);
  if (affects === null) {
    s.findings.push(
      `dataset の changes 履歴が不正（欠番・重複・affects が配列でない）ため影響なしとして扱わない（記録 ${v} / 現在 ${c}）: ${datasetPath}`,
    );
  } else if (affects.includes("*")) {
    s.findings.push(
      `記録後の変更が全機能に影響する（changes[].affects に * がある。記録 ${v} / 現在 ${c}）: ${s.diffPath}`,
    );
  } else {
    s.notes.push(
      `dataset_version は記録 ${v} / 現在 ${c}。区間の affects（${affects.join(", ") || "なし"}）と slug の実効参照テーブルの交差判定は golden-dataset の references/versioning.md で定義するため、ここでは数えない`,
    );
  }
  return true;
}

/**
 * metadata.json のパスからリポジトリルートを導く（.replace の親）。
 * @param {string} metadataPath
 * @returns {string | null}
 */
export function deriveRoot(metadataPath) {
  const parts = resolve(metadataPath).split(sep);
  const i = parts.lastIndexOf(".replace");
  if (i <= 0) return null;
  return parts.slice(0, i).join(sep) || sep;
}

/**
 * @param {string[]} argv
 * @returns {{ metadata: string, root: string | null, target: string | null, stage: string, newRepo: string | null, replaceRoot: string | null, carryTo: string | null, fingerprint: boolean }}
 */
export function parseArgs(argv) {
  const { opts, fingerprint } = readArgv(argv);
  if (!nonEmptyString(opts.metadata)) throw new UsageError("--metadata は必須");
  const stage = opts.stage ?? "diff";
  if (!STAGES.includes(stage)) {
    throw new UsageError(`--stage は ${STAGES.join(" | ")} のいずれか（渡された値: ${stage}）`);
  }
  if (opts["carry-to"] !== undefined) validateCarryTo(opts);
  return {
    metadata: opts.metadata,
    root: opts.root ?? null,
    target: opts.target ?? null,
    stage,
    newRepo: opts["new-repo"] !== undefined ? resolve(opts["new-repo"]) : null,
    replaceRoot: opts["replace-root"] !== undefined ? resolve(opts["replace-root"]) : null,
    carryTo: opts["carry-to"] !== undefined ? opts["carry-to"].trim() : null,
    fingerprint,
  };
}

/** 値を 1 つ取る引数。 */
const VALUE_FLAGS = new Set([
  "--metadata",
  "--root",
  "--target",
  "--stage",
  "--new-repo",
  "--replace-root",
  "--carry-to",
]);

/**
 * argv を読み、値を取る引数（先頭の -- を外した名前 → 値）と --fingerprint の有無を返す。
 * @param {string[]} argv
 * @returns {{ opts: Record<string, string>, fingerprint: boolean }}
 */
function readArgv(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  let fingerprint = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fingerprint") {
      fingerprint = true;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} に値が無い`);
      opts[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new UsageError(
      `使い方: artifact-health-check.mjs --metadata <path> [--root <dir>] [--target <name>] [--stage diff|suite] [--new-repo <path>] [--replace-root <dir>] [--carry-to <SHA>] [--fingerprint]（不明な引数: ${arg}）`,
    );
  }
  return { opts, fingerprint };
}

/**
 * --carry-to は持ち越しを判定させる指定なので、判定に要る入力が欠けたまま受け付けない
 * （警告なしに判定を飛ばすと、持ち越しを確かめないまま通る）。
 * @param {Record<string, string>} opts
 */
function validateCarryTo(opts) {
  if (!nonEmptyString(opts["carry-to"])) throw new UsageError("--carry-to が空");
  if (!nonEmptyString(opts.target)) {
    throw new UsageError(
      "--carry-to には --target が要る（持ち越しは工程の成果物について判定する）",
    );
  }
  if (!nonEmptyString(opts["new-repo"])) {
    throw new UsageError(
      "--carry-to には --new-repo が要る（描画入力の差分を新側リポジトリで取る）",
    );
  }
}

/**
 * 反復実行の記録に書く指紋を出す（--fingerprint）。検査はしない。
 * spec_fingerprints は分類表と current_excluded を反映した全スペックの指紋である。runs[] には、その回に回したスペックの分だけを書く。
 * @param {Record<string, unknown>} metadata
 * @param {string} root
 * @returns {Record<string, unknown>}
 */
export function fingerprintReport(metadata, root) {
  const suite = isPlainObject(metadata.suite) ? metadata.suite : {};
  const record = isPlainObject(suite.repeat_run) ? suite.repeat_run : {};
  const whole = suiteFingerprint(suite, root);
  /** @type {string[]} */
  let declared = [];
  /** @type {string[]} */
  let sharedDeclared = [];
  /** @type {string[]} */
  let excluded = [];
  if (record.specs !== undefined && record.specs !== null) {
    const c = readSpecClassification(record, root, suite.specs);
    declared = [...c.declared.keys()];
    sharedDeclared = [...c.sharedDeclared];
    excluded = c.excluded;
  }
  const perSpec = specFingerprints(suite, root, { declared, sharedDeclared, excluded });
  const missing = [...new Set([...whole.missing, ...perSpec.missing])];
  if (whole.fingerprint === null || perSpec.shared === null) {
    throw new UsageError(
      `スイートの指紋を計算できない: ${missing.length > 0 ? missing.join(" / ") : "suite.specs / locator_map / interactions がどれも宣言されていない"}`,
    );
  }
  return {
    tool: "artifact-health-check",
    version: VERSION,
    suite_fingerprint: whole.fingerprint,
    shared_fingerprint: perSpec.shared,
    spec_fingerprints: perSpec.specs,
  };
}

/**
 * @param {string[]} argv
 * @param {{ log: (line: string) => void }} io
 * @returns {number} 終了コード
 */
export function run(argv, io) {
  const args = parseArgs(argv);
  const { metadataPath, metadata, root } = loadMetadata(args);
  const slugDir = resolve(metadataPath, "..");

  if (args.fingerprint) {
    io.log(JSON.stringify(fingerprintReport(metadata, root), null, 2));
    return 0;
  }

  const { findings, notes } = collectSections({ metadata, root, slugDir, args });
  for (const note of notes) io.log(`note: ${note}`);
  for (const finding of findings) io.log(`warn: ${finding}`);
  if (findings.length > 0) {
    io.log(
      `error: 採取物・工程の健全性に ${findings.length} 件の未検証／不整合が残る — 収束させず直す`,
    );
    return 1;
  }
  io.log(`ok: 採取物・工程の健全性は条件を満たす（artifact-health-check ${VERSION}）`);
  return 0;
}

/**
 * metadata.json を読み、リポジトリルートを決める。
 * @param {{ metadata: string, root: string | null }} args
 * @returns {{ metadataPath: string, metadata: Record<string, unknown>, root: string }}
 */
function loadMetadata(args) {
  const metadataPath = resolve(args.metadata);
  if (!existsSync(metadataPath)) throw new UsageError(`metadata.json が無い: ${metadataPath}`);
  const metadata = readJson(metadataPath, "metadata.json");
  if (!isPlainObject(metadata)) throw new UsageError("metadata.json がオブジェクトでない");

  const root = args.root !== null ? resolve(args.root) : deriveRoot(metadataPath);
  if (root === null) {
    throw new UsageError(
      `metadata.json のパスから .replace を見つけられないため --root を渡す: ${metadataPath}`,
    );
  }
  return { metadataPath, metadata, root };
}

/**
 * 採取物・反復実行・未測定・工程の各節を判定し、所見と注記を節の順に集める。
 * @param {{ metadata: Record<string, unknown>, root: string, slugDir: string, args: ReturnType<typeof parseArgs> }} a
 * @returns {{ findings: string[], notes: string[] }}
 */
function collectSections({ metadata, root, slugDir, args }) {
  const sections = [
    checkArtifacts(metadata, { root }),
    checkRepeatRun(metadata, {
      artifactHealthPresent: "artifact_health" in metadata,
      root,
    }),
    checkUnmeasured(metadata, { stage: args.stage }),
  ];
  if (args.target !== null) {
    if (!nonEmptyString(args.target)) throw new UsageError("--target が空");
    sections.push(
      checkStage({
        root,
        slugDir,
        target: args.target.trim(),
        newRepo: args.newRepo,
        replaceRoot: args.replaceRoot,
        featureMetadata: metadata,
        carryTo: args.carryTo,
      }),
    );
  }
  const findings = sections.flatMap((section) => section.findings);
  const notes = sections.flatMap((section) => section.notes);
  if (args.target === null) notes.push("--target が無いため工程の節を判定しない");
  return { findings, notes };
}

/** 使い方（stderr に出す。CLI として起動されたかの判定が誤ったときに、何もせずに終わったことを検出できるようにする）。 */
const usage = [
  "usage: artifact-health-check.mjs --metadata <path> [--root <dir>] [--target <name>] [--stage diff|suite] [--new-repo <path>] [--replace-root <dir>] [--carry-to <SHA>] [--fingerprint]",
  "  --metadata  .replace/parity/<slug>/metadata.json のパス（必須）",
  "  --root      リポジトリルート（省略時は metadata のパスの .replace の親から導く）",
  "  --target    新側 target 名。渡したときだけ工程の成果物（diff-metadata.json）の在否と鮮度を判定する",
  "  --stage     呼び出し元の工程。diff（デフォルト・収束判定。未測定の blocking で落とす） | suite（完了判定。blocking は落とさない）",
  "  --new-repo  新側リポジトリの最上位。new.commit が食い違うとき、new.render_inputs の差分で証跡を持ち越せるかを判定する（無ければ持ち越さない）",
  "  --carry-to  検証先の新側の版（部品改修の一括再検証では変更宣言の commits.after）。diff-metadata.json の new.commit からこの版への持ち越しを、replace-metadata.json の new.commit が同じでも必ず判定する（--target と --new-repo が要る）",
  "  --fingerprint  検査せず、反復実行の記録に書く指紋（suite_fingerprint / shared_fingerprint / spec_fingerprints）を JSON で出す",
  "  --replace-root  .replace ディレクトリ（省略時は <root>/.replace）。変更宣言・部品 metadata・evidence-carry.json の相対パスはその親から解決する",
  "exit: 0 = 条件を満たす（判定しない節を含む） / 1 = 未検証・不整合が残る / 2 = 使い方の誤り・型の誤り",
].join("\n");

/**
 * 出力先は差し込める（テストが子プロセスを起動せずに終了コード・stdout・stderr を受け取るため）。
 * @param {string[]} argv
 * @param {{ out: (s: string) => void, err: (s: string) => void }} [io]
 * @returns {number} 終了コード
 */
export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  try {
    return run(argv, { log: (line) => io.out(`${line}\n`) });
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`error: ${e.message}\n${usage}\n`);
      return 2;
    }
    throw e;
  }
}

if (isCliEntry(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
