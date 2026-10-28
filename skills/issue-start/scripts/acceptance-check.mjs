// Issue の受け入れ条件を 1 項目ずつ根拠と突き合わせた表（受け入れ条件の突き合わせ表）をチェックする（原本）。
// 原本はこのスキルの側にあり、スキルのディレクトリから直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新を反映するため）。
//
// 何のためか: テスト・リント・スイートの緑は、どれも成果物の形のチェックである。Issue にだけ書かれた条件
// （「状態を URL で持つ」「失敗時にログを書く」など）は、どの工程でも数えられないまま完了になる。
// 長い作業では、着手時に読んだ受け入れ条件を、完了の前に読み直すきっかけも無い。そこで Issue の条件を列挙した表を書かせる。
// 表が Issue と対応していること（チェックリストの項目と行が 1 対 1・引用が本文にある）と、
// 各行に根拠があることを、ここで機械的に確かめる。表の形式の原本は assets/acceptance-template.json である。
//
// 何をしないか: gh を呼ばない（Issue は `gh issue view --json number,url,title,body,comments` の出力と、
// GraphQL の `issue { body bodyHTML }` の出力をファイルで受け取る）。
// Markdown を自前で解釈しない: チェックリストの項目は GitHub が描画した HTML（bodyHTML）のチェックボックスから取る。
// 本文の Markdown から数えると、コードフェンス・HTML コメント・インラインコードの中の `- [ ]` の扱いを
// 文法の形ごとに書き足し続けることになる（レビューで 3 巡、同じクラスの取りこぼしが出た）。
// 根拠のコマンドを再実行しない（結果の記録があるかを見る）。条件が満たされたかの判断そのものは人とエージェントの仕事。
//
// 終了コード: 0 ＝ 全行が met / waived / deferred / later で表が Issue と対応している、1 ＝ 未充足・不整合が残る、
// 2 ＝ 使い方の誤り・型崩れ（JSON でない・別の Issue の表）。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON と、根拠として挙げられたファイルの行数だけ。
// TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { isCliEntry } from "./lib/cli.mjs";
import { makeIo, parseFlagArgs } from "./lib/flag-args.mjs";
import { isArray } from "./lib/is-array.mjs";

/**
 * ツールのバージョン（原本）。判定の規則や出力の形を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/**
 * 行の状態の語彙（原本）。met / waived / deferred / later だけが完了の側である。
 * later は同じ流れの後工程が満たす条件（例: parity-replace の完了時点での parity-diff の収束）で、Issue は閉じない。
 */
export const STATUSES = /** @type {const} */ ([
  "met",
  "unmet",
  "pending-decision",
  "waived",
  "deferred",
  "later",
]);

/** 行の状態。STATUSES から導く（型と値を二重に持たない）。 @typedef {(typeof STATUSES)[number]} Status */

/**
 * @param {string} value
 * @returns {value is Status}
 */
const isStatus = (value) => STATUSES.some((s) => s === value);

/**
 * 行の出所の語彙。checklist は本文のチェックリストの項目そのもの、title / body / comment は散文からの引用。
 * title は本文が空でタイトルだけが条件を述べる Issue のため（無いと行を 1 件も作れず、永久に通れない）。
 */
export const SOURCES = ["checklist", "title", "body", "comment"];

/** 根拠の強さ。measured（実測）はコマンドの結果、read（読解）はファイル:行。 */
export const STRENGTHS = ["measured", "read"];

/**
 * 突き合わせ表の結果を Issue へ投稿したコメントに付ける目印。指紋の計算から外す
 * （外さないと、結果を投稿しただけで表が古くなる）。
 */
export const RESULT_MARKER = "<!-- issue-start:acceptance -->";

/**
 * 空でない文字列か。
 * @param {unknown} value
 * @returns {value is string & { readonly __nonEmptyString: true }}
 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * プレーンなオブジェクトか。
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !isArray(value);
}

/**
 * 比較用に空白を畳む（改行・連続空白・前後の空白の違いで一致を落とさない）。
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

// 指紋の材料でチェックの有無を畳むためだけに使う（項目の列挙には使わない。列挙は bodyHTML から取る）。
// 描画でチェックボックスになる項目は引用・リストの中にも入る（`> - [ ]` / `- > - [ ]`）ので、
// 行頭の引用とリストの記号の連なりを許す。許さないと、そこにチェックを付けただけで表が古くなる。
const CHECKBOX =
  /^((?:\s*(?:>|(?:[-*+]|\d+[.)])(?=\s)))*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s+)(.*)$/;

// 描画後の HTML の字句。属性値の中の `>` で切らないよう、引用符の中を 1 塊で読む。
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

// 項目の文言を打ち切るタグ。チェックボックスは li の先頭か、緩いリストでは li > p の先頭に置かれ、
// 文言はその後ろから、入れ子のリスト・次の段落・li の終わりまで（実測: GitHub の bodyHTML と POST /markdown の gfm）。
const ITEM_END = new Set([
  "ul",
  "ol",
  "li",
  "p",
  "div",
  "pre",
  "blockquote",
  "table",
  "details",
  "summary",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "dl",
  "dt",
  "dd",
]);

/** @type {Record<string, string>} */
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

/**
 * HTML の文字参照を戻す。
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (all, ref) => {
    if (ref[0] !== "#") return NAMED_ENTITIES[ref] ?? all;
    const cp =
      ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
  });
}

/**
 * タグの属性を 1 つ読む。
 * @param {string} attrs
 * @param {string} name
 * @returns {string | null}
 */
function attribute(attrs, name) {
  const m = attrs.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i"),
  );
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null;
}

/**
 * タグが、GitHub が描画したチェックリストのチェックボックス（task-list-item-checkbox の <input>）かを判定する。
 * @param {string} name - 小文字にしたタグ名
 * @param {boolean} opening - 開きタグか
 * @param {string} attrs
 * @returns {boolean}
 */
function isTaskCheckbox(name, opening, attrs) {
  return (
    opening &&
    name === "input" &&
    (attribute(attrs, "type") ?? "").toLowerCase() === "checkbox" &&
    (attribute(attrs, "class") ?? "").split(/\s+/).includes("task-list-item-checkbox")
  );
}

/**
 * 項目の中のタグが、項目の文言に足す文字列を返す。<br> は空白 1 つ、<img> は代替テキスト、他のタグは空文字。
 * @param {string} name - 小文字にしたタグ名
 * @param {boolean} opening - 開きタグか
 * @param {string} attrs
 * @returns {string}
 */
function inlineTagText(name, opening, attrs) {
  if (name === "br") return " ";
  // 画像だけの項目も文言を持つ（代替テキスト）。
  if (name === "img" && opening) return attribute(attrs, "alt") ?? "";
  return "";
}

/**
 * 本文のチェックリストの項目を、GitHub が描画した HTML のチェックボックスから列挙する。
 * 画面にチェックボックスとして出たものだけが項目になる。コードフェンス・HTML コメントの中の `- [ ]` は
 * 描画でチェックボックスにならず、引用・<details> の中はなる。利用者がタグで書いた <input> は描画で消される（実測）。
 * @param {string} html
 * @returns {string[]} 空白を畳んだ項目の文言（本文の順）。文言の無い項目は空文字
 */
export function checklistItems(html) {
  /** @type {string[]} */
  const items = [];
  /** @type {string | null} */
  let current = null;
  const finish = () => {
    if (current !== null) items.push(normalizeText(current));
    current = null;
  };
  let last = 0;
  for (const m of html.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    if (current !== null) current += decodeEntities(html.slice(last, index));
    last = index + m[0].length;
    if (m[2] === undefined) continue; // HTML コメント
    const name = m[2].toLowerCase();
    const opening = m[1] === "";
    if (isTaskCheckbox(name, opening, m[3])) {
      finish();
      current = "";
    } else if (current === null) {
      continue;
    } else if (ITEM_END.has(name)) {
      finish();
    } else {
      current += inlineTagText(name, opening, m[3]);
    }
  }
  if (current !== null) current += decodeEntities(html.slice(last));
  finish();
  return items;
}

/**
 * 指紋の材料にする本文。チェックの有無と、末尾の空白・改行はそろえる。完了の報告で項目にチェックを付けて
 * 本文を書き戻すと、チェックと（取得・書き戻しの方法によっては）末尾の改行が変わる。
 * しかし条件そのものは変わっていないので、表を古いものとして扱わない。
 * @param {string} body
 * @returns {string}
 */
function bodyForFingerprint(body) {
  return (
    body
      .replace(/\r\n?/g, "\n")
      .split("\n")
      // CHECKBOX のグループはどれも一致に必ず加わるので、置換を文字列の $n で書いても関数で書いたときと同じになる。
      // 2 番のグループがチェックの有無で、それだけを [ ] にそろえる。
      .map((line) => line.replace(CHECKBOX, "$1[ ]$3$4"))
      .join("\n")
      .trimEnd()
  );
}

/**
 * Issue のコメントの本文を列挙する（結果を投稿したコメントは除く）。
 * @param {unknown} comments
 * @returns {string[] | null} 型が崩れていれば null
 */
function commentBodies(comments) {
  if (comments === undefined) return [];
  if (!isArray(comments)) return null;
  /** @type {string[]} */
  const bodies = [];
  for (const c of comments) {
    if (!isObject(c) || typeof c.body !== "string") return null;
    // 目印は本文の先頭だけで見る。目印に言及しただけのコメント（議論・引用）まで外すと、
    // そこに書かれた条件の改訂が指紋にも引用の照合にも入らなくなる。
    if (c.body.trimStart().startsWith(RESULT_MARKER)) continue;
    bodies.push(c.body);
  }
  return bodies;
}

/**
 * 表を書いた時点の Issue（タイトル・本文・コメント）の指紋。表の後で条件が書き換わったことを検出する。
 * @param {string} body
 * @param {string[]} comments
 * @param {string} [title]
 * @returns {string}
 */
export function fingerprintOf(body, comments, title = "") {
  const payload = JSON.stringify({
    title,
    body: bodyForFingerprint(body),
    comments: comments.map((c) => c.replace(/\r\n?/g, "\n").trimEnd()),
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

/**
 * 根拠 1 件を検査する。
 * @param {unknown} evidence
 * @param {(ref: string) => string | null} checkFile ファイル:行 の実在を確かめ、問題があれば理由を返す
 * @returns {{ kind: "command" | "file" | null, problem: string | null }}
 */
function checkEvidence(evidence, checkFile) {
  if (!isObject(evidence)) return { kind: null, problem: "根拠がオブジェクトでない" };
  if (evidence.kind === "command") {
    // 結果の記録が無いコマンドは、「実行するつもり」と区別できない。
    if (!nonEmptyString(evidence.command)) return { kind: "command", problem: "command が空" };
    if (!nonEmptyString(evidence.result)) return { kind: "command", problem: "result が空" };
    return { kind: "command", problem: null };
  }
  if (evidence.kind === "file") {
    if (!nonEmptyString(evidence.ref)) return { kind: "file", problem: "ref が空" };
    return { kind: "file", problem: checkFile(evidence.ref) };
  }
  return { kind: null, problem: `kind が語彙外: ${String(evidence.kind)}` };
}

/**
 * ファイル:行 の参照を確かめる関数を作る。
 * @param {string} root 相対パスの起点
 * @param {(path: string) => string | null} readText 読めなければ null
 * @returns {(ref: string) => string | null}
 */
export function fileChecker(root, readText) {
  return (ref) => {
    const m = ref.match(/^(.+?):(\d+)(?:-(\d+))?$/);
    if (!m) return `ファイル:行 の形でない: ${ref}`;
    const start = Number(m[2]);
    const end = m[3] !== undefined ? Number(m[3]) : start;
    if (start < 1 || end < start) return `行の範囲が不正: ${ref}`;
    const path = isAbsolute(m[1]) ? m[1] : resolve(root, m[1]);
    const text = readText(path);
    if (text === null) return `ファイルを読めない: ${m[1]}`;
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").length;
    if (end > lines) return `行がファイルの外（${lines} 行）: ${ref}`;
    return null;
  };
}

/** @typedef {{ code: string, row: number | null, message: string }} Finding */

/** finding を 1 件足す関数。 @typedef {(code: string, row: number | null, message: string) => void} AddFinding */

/**
 * 検査に使う Issue の値（形を確かめた後のもの）。
 * @typedef {{
 *   number: number,
 *   body: string,
 *   bodyHTML: string,
 *   title: string,
 *   comments: string[],
 * }} IssueParts
 */

/**
 * 行の検査が共有する値。
 * @typedef {{
 *   add: AddFinding,
 *   remaining: Map<string, number>,
 *   title: string,
 *   normalizedBody: string,
 *   normalizedComments: string[],
 *   counts: Record<string, number>,
 *   checkFile: (ref: string) => string | null,
 *   decisionIds: Set<string> | null,
 *   allowLater: Set<string>,
 * }} RowContext
 */

/**
 * Issue と描画後の HTML の形を確かめ、検査に使う値を取り出す。
 * @param {unknown} issue
 * @param {unknown} issueHtml
 * @returns {{ error: string } | { error: null, issue: IssueParts }}
 */
function readIssue(issue, issueHtml) {
  if (!isObject(issue) || typeof issue.body !== "string" || typeof issue.number !== "number") {
    return { error: "Issue が `gh issue view --json number,url,title,body,comments` の形でない" };
  }
  if (
    !isObject(issueHtml) ||
    typeof issueHtml.body !== "string" ||
    typeof issueHtml.bodyHTML !== "string"
  ) {
    return { error: "Issue の HTML が GraphQL の `issue { body bodyHTML }` の形でない" };
  }
  if (issueHtml.body !== issue.body) {
    // 別の時点で取った本文と HTML を突き合わせると、項目の列挙が本文と食い違う。
    return { error: "Issue の本文と HTML を取った後に本文が変わった（両方を再取得する）" };
  }
  const comments = commentBodies(issue.comments);
  if (comments === null) return { error: "Issue の comments の型が正しくない" };
  return {
    error: null,
    issue: {
      number: issue.number,
      body: issue.body,
      bodyHTML: issueHtml.bodyHTML,
      title: typeof issue.title === "string" ? issue.title : "",
      comments,
    },
  };
}

/**
 * 表の形と、表が対象の Issue のものかを確かめる。
 * @param {unknown} table
 * @param {number} issueNumber
 * @returns {{ error: string } | { error: null, table: Record<string, unknown>, items: unknown[] }}
 */
function readTable(table, issueNumber) {
  if (!isObject(table)) return { error: "表がオブジェクトでない" };
  if (!isObject(table.issue) || table.issue.number !== issueNumber) {
    // 別の Issue の表を検査しても何も示さないので、未充足ではなく取り違えとして落とす。
    return {
      error: `表の issue.number（${isObject(table.issue) ? String(table.issue.number) : "無し"}）が Issue #${issueNumber} と一致しない`,
    };
  }
  if (!isArray(table.items)) return { error: "表の items が配列でない" };
  return { error: null, table, items: table.items };
}

/**
 * 表の指紋とコミットが、いまの Issue と HEAD に合うかを確かめる。
 * @param {{ table: Record<string, unknown>, expected: string, head: string | null }} input
 * @param {AddFinding} add
 */
function checkTableHeader({ table, expected, head }, add) {
  if (table.source_fingerprint !== expected) {
    add(
      "stale-issue",
      null,
      `表を書いた後に Issue の本文かコメントが変わった（または指紋が未記録）。条件を読み直して表を直し、source_fingerprint に ${expected} を転記する`,
    );
  }
  if (!nonEmptyString(table.commit)) {
    add("commit-missing", null, "表を確かめたコミット（commit）が無い");
  } else if (head !== null && table.commit !== head) {
    // 表の後に実装を変えても古い根拠が通らないようにする。
    add(
      "stale-commit",
      null,
      `表のコミット ${table.commit} が現在の HEAD ${head} と違う。根拠をもう一度確かめる`,
    );
  }
}

/**
 * 本文のチェックリストの項目を、行と対応づける前の残りの数として数える。
 * @param {string[]} issueChecklist
 * @param {AddFinding} add
 * @returns {Map<string, number>}
 */
function checklistRemaining(issueChecklist, add) {
  /** @type {Map<string, number>} */
  const remaining = new Map();
  for (const item of issueChecklist) {
    // 文言の無い項目は、行と対応づけられない。警告なしに捨てず、Issue の側を直す（か利用者に確かめる）よう出す。
    if (item === "")
      add("checklist-item-empty", null, "本文に文言の無いチェックリストの項目がある");
    else remaining.set(item, (remaining.get(item) ?? 0) + 1);
  }
  return remaining;
}

/**
 * 散文からの行の引用が、Issue のタイトル・本文・コメントにあるかを確かめる。
 * @param {{ quote: unknown, source: "title" | "body" | "comment", row: number }} input
 * @param {RowContext} ctx
 */
function checkQuote({ quote: rawQuote, source, row }, ctx) {
  if (!nonEmptyString(rawQuote)) {
    ctx.add(
      "quote-missing",
      row,
      `source: ${source} の行に quote（本文・コメントからの引用）が無い`,
    );
    return;
  }
  const quote = normalizeText(rawQuote);
  const found =
    source === "title"
      ? normalizeText(ctx.title).includes(quote)
      : source === "body"
        ? ctx.normalizedBody.includes(quote)
        : ctx.normalizedComments.some((c) => c.includes(quote));
  if (!found)
    ctx.add(
      "quote-not-found",
      row,
      `quote が Issue の ${{ title: "タイトル", body: "本文", comment: "コメント" }[source]}に無い: ${quote}`,
    );
}

/**
 * 行の出所を確かめる。チェックリストの項目は本文の項目と 1 対 1、散文からの行は引用が本文・コメントにあること。
 * @param {Record<string, unknown>} raw
 * @param {number} row
 * @param {RowContext} ctx
 */
function checkRowSource(raw, row, ctx) {
  const source = raw.source;
  if (source === "checklist") {
    const key = nonEmptyString(raw.criterion) ? normalizeText(raw.criterion) : "";
    const left = ctx.remaining.get(key) ?? 0;
    if (left > 0) ctx.remaining.set(key, left - 1);
    else
      ctx.add(
        "checklist-row-not-in-issue",
        row,
        `本文のチェックリストに無い（または重複した）項目: ${key}`,
      );
  } else if (source === "title" || source === "body" || source === "comment") {
    checkQuote({ quote: raw.quote, source, row }, ctx);
  } else {
    ctx.add("source-invalid", row, `source が語彙外: ${String(source)}`);
  }
}

/**
 * met の行の根拠と強さを確かめる。
 * @param {Record<string, unknown>} raw
 * @param {number} row
 * @param {RowContext} ctx
 */
function checkMet(raw, row, ctx) {
  const evidence = isArray(raw.evidence) ? raw.evidence : [];
  // 根拠の無い met は「満たしたつもり」と区別できない。
  if (evidence.length === 0) ctx.add("evidence-missing", row, "met なのに根拠（evidence）が無い");
  let hasCommand = false;
  for (const e of evidence) {
    const { kind, problem } = checkEvidence(e, ctx.checkFile);
    if (problem !== null) ctx.add("evidence-invalid", row, problem);
    else if (kind === "command") hasCommand = true;
  }
  if (typeof raw.strength !== "string" || !STRENGTHS.includes(raw.strength)) {
    ctx.add("strength-invalid", row, `strength が語彙外: ${String(raw.strength)}`);
  } else if (raw.strength === "measured" && !hasCommand) {
    // 実測と名乗るなら結果の記録があるコマンドを 1 件は要る（ファイルを読んだだけでは実測にならない）。
    ctx.add("strength-unsupported", row, "strength: measured なのにコマンドの根拠が無い");
  }
}

/**
 * pending-decision の行が判断待ちの記録を指すかを確かめる。
 * @param {Record<string, unknown>} raw
 * @param {number} row
 * @param {RowContext} ctx
 */
function checkPendingDecision(raw, row, ctx) {
  // 判断待ちは完了側に数えない。置き場（判断待ちの記録）を指していなければ、誰も判断しない。
  if (!nonEmptyString(raw.decision_ref)) {
    ctx.add(
      "decision-ref-missing",
      row,
      "pending-decision なのに decision_ref（判断待ちの記録）が無い",
    );
  } else if (ctx.decisionIds !== null && !ctx.decisionIds.has(raw.decision_ref)) {
    ctx.add(
      "decision-ref-not-found",
      row,
      `decision_ref ${raw.decision_ref} が判断待ちの記録に無い`,
    );
  }
  ctx.add("pending-decision", row, `判断待ち: ${String(raw.criterion)}`);
}

/**
 * later の行の後工程（owner）を確かめる。
 * @param {Record<string, unknown>} raw
 * @param {number} row
 * @param {RowContext} ctx
 */
function checkLater(raw, row, ctx) {
  // 後工程が満たす条件は、どの工程が満たすかを書かなければ誰も満たさない。
  if (!nonEmptyString(raw.owner))
    ctx.add("owner-missing", row, "later には満たす後工程（owner）が要る");
  // どの後工程へ回してよいかは呼び出し元が決める（--allow-later）。実装役が「後で」と書いて外せないようにする。
  else if (!ctx.allowLater.has(raw.owner))
    ctx.add(
      "owner-not-allowed",
      row,
      `later の owner が呼び出し元の許した後工程に無い: ${raw.owner}`,
    );
}

/**
 * waived と deferred の行の承認と、deferred の置き場を確かめる。
 * @param {Record<string, unknown>} raw
 * @param {number} row
 * @param {RowContext} ctx
 */
function checkApproval(raw, row, ctx) {
  // waived（外す）と deferred（別の置き場へ回す）は、どちらも利用者の決定が要る。実装役が独断で決めない。
  const approval = raw.approval;
  if (
    !isObject(approval) ||
    !nonEmptyString(approval.by) ||
    !nonEmptyString(approval.at) ||
    !nonEmptyString(approval.ref)
  ) {
    ctx.add(
      "approval-missing",
      row,
      `${String(raw.status)} には利用者の承認（approval.by / at / ref）が要る`,
    );
  }
  if (raw.status === "deferred" && !nonEmptyString(raw.tracked_in)) {
    ctx.add("tracked-in-missing", row, "deferred には残作業の置き場（tracked_in）が要る");
  }
}

/**
 * 行の状態を数え、状態ごとの条件を確かめる。
 * @param {Record<string, unknown>} raw
 * @param {number} row
 * @param {RowContext} ctx
 */
function checkRowStatus(raw, row, ctx) {
  const status = raw.status;
  if (typeof status !== "string" || !isStatus(status)) {
    ctx.add("status-invalid", row, `status が語彙外: ${String(status)}`);
    return;
  }
  ctx.counts[status] += 1;
  if (status === "met") checkMet(raw, row, ctx);
  else if (status === "unmet") ctx.add("unmet", row, `満たしていない: ${String(raw.criterion)}`);
  else if (status === "pending-decision") checkPendingDecision(raw, row, ctx);
  else if (status === "later") checkLater(raw, row, ctx);
  else checkApproval(raw, row, ctx);
}

/**
 * 表の行を 1 行ずつ確かめる。
 * @param {unknown[]} items
 * @param {RowContext} ctx
 */
function checkRows(items, ctx) {
  items.forEach((raw, index) => {
    const row = index + 1;
    if (!isObject(raw)) {
      ctx.add("row-malformed", row, "行がオブジェクトでない");
      return;
    }
    if (!nonEmptyString(raw.criterion)) ctx.add("criterion-missing", row, "criterion が空");
    checkRowSource(raw, row, ctx);
    checkRowStatus(raw, row, ctx);
  });
}

/**
 * 行の無い本文のチェックリストの項目を、残りの数だけ finding にする。
 * @param {Map<string, number>} remaining
 * @param {AddFinding} add
 */
function addMissingChecklistItems(remaining, add) {
  for (const [item, left] of remaining) {
    for (let i = 0; i < left; i += 1) {
      add("checklist-item-missing", null, `本文のチェックリストの項目に対応する行が無い: ${item}`);
    }
  }
}

/**
 * 件数の初期値。行の数と、本文の項目の数と、状態ごとの行の数を持つ（キーの順は出力の順）。
 * @param {number} itemCount
 * @returns {Record<string, number>}
 */
function emptyCounts(itemCount) {
  /** @type {Record<string, number>} */
  const counts = { items: itemCount, checklist: 0 };
  for (const status of STATUSES) counts[status] = 0;
  return counts;
}

/**
 * 突き合わせ表を検査する。
 * @param {{
 *   issue: unknown,
 *   issueHtml: unknown,
 *   table: unknown,
 *   head?: string | null,
 *   decisionIds?: Set<string> | null,
 *   allowLater?: Set<string>,
 *   checkFile: (ref: string) => string | null,
 * }} input
 * @returns {{ structural: true, error: string } | {
 *   structural: false,
 *   findings: Array<{ code: string, row: number | null, message: string }>,
 *   closable: boolean,
 *   expected_fingerprint: string,
 *   checklist_items: string[],
 *   counts: Record<string, number>,
 * }}
 */
export function checkAcceptance(input) {
  const { head = null, decisionIds = null, allowLater = new Set(), checkFile } = input;
  const readIssueResult = readIssue(input.issue, input.issueHtml);
  if (readIssueResult.error !== null) return { structural: true, error: readIssueResult.error };
  const issue = readIssueResult.issue;
  const readTableResult = readTable(input.table, issue.number);
  if (readTableResult.error !== null) return { structural: true, error: readTableResult.error };
  const { table, items } = readTableResult;

  /** @type {Finding[]} */
  const findings = [];
  /** @type {AddFinding} */
  const add = (code, row, message) => {
    findings.push({ code, row, message });
  };

  const expected = fingerprintOf(issue.body, issue.comments, issue.title);
  checkTableHeader({ table, expected, head }, add);

  const counts = emptyCounts(items.length);
  // 0 件を「条件が無い」として扱わない。表を書き忘れた状態と同じ出力になる。
  if (items.length === 0) add("no-items", null, "表に行が無い");

  const issueChecklist = checklistItems(issue.bodyHTML);
  counts.checklist = issueChecklist.length;
  const remaining = checklistRemaining(issueChecklist, add);
  checkRows(items, {
    add,
    remaining,
    title: issue.title,
    normalizedBody: normalizeText(issue.body),
    normalizedComments: issue.comments.map(normalizeText),
    counts,
    checkFile,
    decisionIds,
    allowLater,
  });
  addMissingChecklistItems(remaining, add);

  return {
    structural: false,
    findings,
    // deferred・later が残る Issue は、PR で閉じない（Closes を書かない）。
    closable: findings.length === 0 && counts.deferred === 0 && counts.later === 0,
    expected_fingerprint: expected,
    checklist_items: issueChecklist,
    counts,
  };
}

const USAGE =
  "usage: node acceptance-check.mjs --issue <gh issue view --json number,url,title,body,comments の出力> " +
  "--issue-html <GraphQL の issue { body bodyHTML } の出力> " +
  "--table <突き合わせ表> [--head <現在の HEAD の完全 SHA>] [--root <ファイル:行 の起点>] " +
  "[--decisions <pending_decisions を持つ JSON>] [--allow-later <後工程名,...>]";

const KNOWN_ARGS = new Set([
  "--issue",
  "--issue-html",
  "--table",
  "--head",
  "--root",
  "--decisions",
  "--allow-later",
]);

/**
 * 必須の引数と --head の形を確かめる。
 * @param {Record<string, string>} args
 * @returns {string | null} 誤りの文。無ければ null
 */
function argsError(args) {
  if (
    args["--issue"] === undefined ||
    args["--issue-html"] === undefined ||
    args["--table"] === undefined
  ) {
    return "--issue と --issue-html と --table は必須";
  }
  // 短縮 SHA は別のコミットと一致しうるので受け付けない。
  if (args["--head"] !== undefined && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(args["--head"])) {
    return `--head は完全 SHA: ${args["--head"]}`;
  }
  return null;
}

/**
 * JSON を受け取る引数のファイルを読む。
 * @param {Record<string, string>} args
 * @param {string} cwd
 * @returns {{ error: string } | { error: null, parsed: Record<string, unknown> }}
 */
function readJsonArgs(args, cwd) {
  /** @type {Record<string, unknown>} */
  const parsed = {};
  for (const key of ["--issue", "--issue-html", "--table", "--decisions"]) {
    if (args[key] === undefined) continue;
    const path = resolve(cwd, args[key]);
    try {
      parsed[key] = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      return {
        error: `${path} を読めない: ${String(error && (typeof error === "object" && "message" in error ? error.message : undefined))}`,
      };
    }
  }
  return { error: null, parsed };
}

/**
 * --decisions の JSON から判断待ちの記録の id を集める。
 * @param {unknown} doc 渡されていなければ undefined
 * @returns {{ error: string } | { error: null, ids: Set<string> | null }}
 */
function decisionIdsOf(doc) {
  if (doc === undefined) return { error: null, ids: null };
  if (!isObject(doc) || !isArray(doc.pending_decisions)) {
    return { error: "--decisions に pending_decisions 配列が無い" };
  }
  const ids = new Set(
    doc.pending_decisions
      .filter(isObject)
      .map((d) => d.id)
      .filter(nonEmptyString),
  );
  return { error: null, ids };
}

/**
 * ファイルを読む。通常のファイルでないか読めなければ null。
 * @param {string} path
 * @returns {string | null}
 */
function readText(path) {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * --allow-later の値を後工程名の集合にする。
 * @param {string | undefined} value
 * @returns {Set<string>}
 */
function allowLaterOf(value) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== ""),
  );
}

/**
 * 引数を読み、検査の入力を作る。
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {{ error: string } | { error: null, input: Parameters<typeof checkAcceptance>[0] }}
 */
function inputFromArgs(argv, cwd) {
  const parsedArgs = parseFlagArgs(argv, KNOWN_ARGS);
  if (parsedArgs.error !== undefined) return { error: parsedArgs.error };
  const { args } = parsedArgs;
  const error = argsError(args);
  if (error !== null) return { error };
  const json = readJsonArgs(args, cwd);
  if (json.error !== null) return json;
  const decisions = decisionIdsOf(json.parsed["--decisions"]);
  if (decisions.error !== null) return decisions;
  const root = resolve(cwd, args["--root"] ?? ".");
  return {
    error: null,
    input: {
      issue: json.parsed["--issue"],
      issueHtml: json.parsed["--issue-html"],
      table: json.parsed["--table"],
      head: args["--head"] ?? null,
      decisionIds: decisions.ids,
      allowLater: allowLaterOf(args["--allow-later"]),
      checkFile: fileChecker(root, readText),
    },
  };
}

/**
 * CLI。
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [deps]
 * @returns {number} 終了コード
 */
export function main(argv, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const { out, fail } = makeIo(deps, USAGE);
  const prepared = inputFromArgs(argv, cwd);
  if (prepared.error !== null) return fail(prepared.error);
  const result = checkAcceptance(prepared.input);
  if (result.structural) {
    out({ ok: false, structural: true, error: result.error });
    return 2;
  }
  out({
    ok: result.findings.length === 0,
    closable: result.closable,
    findings: result.findings,
    expected_fingerprint: result.expected_fingerprint,
    // source: checklist の行の criterion は、ここから転記する（描画した後の文言。Markdown の記号やタグは除かれている）。
    checklist_items: result.checklist_items,
    counts: { ...result.counts, findings: result.findings.length },
  });
  return result.findings.length === 0 ? 0 : 1;
}

if (isCliEntry(import.meta.url)) {
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
