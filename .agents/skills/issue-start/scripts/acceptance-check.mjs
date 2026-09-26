// Issue の受け入れ条件を 1 項目ずつ根拠と突き合わせた表（受け入れ条件の突き合わせ表）を検査する（正本）。Issue #464。
// 正本はこのスキル側にあり、実行時はスキルディレクトリ内から直接実行する
// （プロジェクトへコピーしない。gh skill update の自動更新を効かせるため）。
//
// 何のためか: テスト・リント・スイートの緑はどれも成果物の形の検査で、Issue にだけ書かれた条件
// （「状態を URL で持つ」「失敗時にログを書く」等）はどの工程にも数えられないまま完了になる。
// 長い作業では着手時に読んだ受け入れ条件を完了の前に読み直す契機も無い。そこで Issue の条件を列挙した表を書かせ、
// 表が Issue と対応していること（チェックリストの項目と行が 1 対 1・引用が本文にある）と、
// 各行に根拠があることをここで機械的に確かめる。表の様式の正本は assets/acceptance-template.json。
//
// 何をしないか: gh を呼ばない（Issue は `gh issue view --json number,url,body,comments` の出力をファイルで受け取る）。
// 根拠のコマンドを再実行しない（結果の記録があるかを見る）。条件が満たされたかの判断そのものは人とエージェントの仕事。
//
// 終了コード: 0 ＝ 全行が met / waived / deferred / later で表が Issue と対応している、1 ＝ 未充足・不整合が残る、
// 2 ＝ 使い方の誤り・型崩れ（JSON でない・別の Issue の表）。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは JSON と、根拠として挙げられたファイルの行数だけ。
// TypeScript 構文は使わない（型は JSDoc）。

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/**
 * 行の状態の語彙（正本）。met / waived / deferred / later だけが完了側。
 * later は同じ流れの後工程が満たす条件（例: parity-replace の完了時点での parity-diff の収束）で、Issue は閉じない。
 */
export const STATUSES = ["met", "unmet", "pending-decision", "waived", "deferred", "later"];

/** 行の出所の語彙。checklist は本文のチェックリストの項目そのもの、body / comment は散文からの引用。 */
export const SOURCES = ["checklist", "body", "comment"];

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
 * @returns {value is string}
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 比較用に空白を畳む（改行・連続空白・前後の空白の違いで一致を落とさない）。
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

const CHECKBOX = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s+)(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * 本文のチェックリストの項目を列挙する（コードフェンスの中は数えない）。
 * @param {string} body
 * @returns {string[]} 空白を畳んだ項目の文言（本文の順）
 */
export function checklistItems(body) {
  /** @type {string[]} */
  const items = [];
  /** @type {string | null} */
  let fence = null;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const f = line.match(FENCE);
    if (fence !== null) {
      // 閉じは同じ文字で同じ長さ以上、かつ後ろが空白だけ（CommonMark）。言語名付きの行は中身として扱う。
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && f[2].trim() === "") {
        fence = null;
      }
      continue;
    }
    // バッククォートの開きは、後ろ（情報文字列）にバッククォートを含むとフェンスにならない（CommonMark）。
    // 行頭のインラインコード（```npm test``` を通す）を開きと読むと、以降の項目が 1 件も数えられない。
    if (f && !(f[1][0] === "`" && f[2].includes("`"))) {
      fence = f[1];
      continue;
    }
    const m = line.match(CHECKBOX);
    if (m && nonEmptyString(m[4])) items.push(normalizeText(m[4]));
  }
  return items;
}

/**
 * 指紋の材料にする本文。チェックの有無は畳む——完了の報告で項目にチェックを付けると本文が変わるが、
 * 条件そのものは変わっていないので表を古くしない。
 * @param {string} body
 * @returns {string}
 */
function bodyForFingerprint(body) {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line.replace(CHECKBOX, (_all, head, _mark, gap, rest) => `${head}[ ]${gap}${rest}`),
    )
    .join("\n");
}

/**
 * Issue のコメントの本文を列挙する（結果を投稿したコメントは除く）。
 * @param {unknown} comments
 * @returns {string[] | null} 型が崩れていれば null
 */
function commentBodies(comments) {
  if (comments === undefined) return [];
  if (!Array.isArray(comments)) return null;
  /** @type {string[]} */
  const bodies = [];
  for (const c of comments) {
    if (!isObject(c) || typeof c.body !== "string") return null;
    // 目印は本文の先頭だけで見る——目印に言及しただけのコメント（議論・引用）まで外すと、
    // そこに書かれた条件の改訂が指紋にも引用の照合にも入らなくなる。
    if (c.body.trimStart().startsWith(RESULT_MARKER)) continue;
    bodies.push(c.body);
  }
  return bodies;
}

/**
 * 表を書いた時点の Issue（本文とコメント）の指紋。表の後で条件が書き換わったことを検出する。
 * @param {string} body
 * @param {string[]} comments
 * @returns {string}
 */
export function fingerprintOf(body, comments) {
  const payload = JSON.stringify({
    body: bodyForFingerprint(body),
    comments: comments.map((c) => c.replace(/\r\n?/g, "\n")),
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
    // 結果の記録が無いコマンドは「走らせるつもり」と区別できない。
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

/**
 * 突き合わせ表を検査する。
 * @param {{
 *   issue: unknown,
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
 *   counts: Record<string, number>,
 * }}
 */
export function checkAcceptance(input) {
  const {
    issue,
    table,
    head = null,
    decisionIds = null,
    allowLater = new Set(),
    checkFile,
  } = input;
  if (!isObject(issue) || typeof issue.body !== "string" || typeof issue.number !== "number") {
    return {
      structural: true,
      error: "Issue が `gh issue view --json number,url,body,comments` の形でない",
    };
  }
  const comments = commentBodies(issue.comments);
  if (comments === null) return { structural: true, error: "Issue の comments の型が崩れている" };
  if (!isObject(table)) return { structural: true, error: "表がオブジェクトでない" };
  if (!isObject(table.issue) || table.issue.number !== issue.number) {
    // 別の Issue の表を検査しても何も示さないので、未充足ではなく取り違えとして落とす。
    return {
      structural: true,
      error: `表の issue.number（${isObject(table.issue) ? String(table.issue.number) : "無し"}）が Issue #${issue.number} と一致しない`,
    };
  }
  if (!Array.isArray(table.items)) return { structural: true, error: "表の items が配列でない" };

  /** @type {Array<{ code: string, row: number | null, message: string }>} */
  const findings = [];
  const add = (
    /** @type {string} */ code,
    /** @type {number | null} */ row,
    /** @type {string} */ message,
  ) => findings.push({ code, row, message });

  const expected = fingerprintOf(issue.body, comments);
  if (table.source_fingerprint !== expected) {
    add(
      "stale-issue",
      null,
      `表を書いた後に Issue の本文かコメントが変わった（または指紋が未記録）。条件を読み直して表を直し、source_fingerprint に ${expected} を写す`,
    );
  }
  if (!nonEmptyString(table.commit)) {
    add("commit-missing", null, "表を確かめたコミット（commit）が無い");
  } else if (head !== null && table.commit !== head) {
    // 表の後に実装を変えても古い根拠が通らないようにする。
    add(
      "stale-commit",
      null,
      `表のコミット ${table.commit} が現在の HEAD ${head} と違う。根拠を取り直す`,
    );
  }

  const counts = {
    items: table.items.length,
    checklist: 0,
    met: 0,
    unmet: 0,
    "pending-decision": 0,
    waived: 0,
    deferred: 0,
    later: 0,
  };
  // 0 件を「条件が無い」に倒さない——表を書き忘れた状態と同じ出力になる。
  if (table.items.length === 0) add("no-items", null, "表に行が無い");

  const issueChecklist = checklistItems(issue.body);
  counts.checklist = issueChecklist.length;
  /** @type {Map<string, number>} */
  const remaining = new Map();
  for (const item of issueChecklist) remaining.set(item, (remaining.get(item) ?? 0) + 1);
  const normalizedBody = normalizeText(issue.body);
  const normalizedComments = comments.map(normalizeText);

  table.items.forEach((/** @type {unknown} */ raw, /** @type {number} */ index) => {
    const row = index + 1;
    if (!isObject(raw)) {
      add("row-malformed", row, "行がオブジェクトでない");
      return;
    }
    if (!nonEmptyString(raw.criterion)) add("criterion-missing", row, "criterion が空");
    // 出所: チェックリストの項目は本文の項目と 1 対 1、散文からの行は引用が本文・コメントにあること。
    if (raw.source === "checklist") {
      const key = nonEmptyString(raw.criterion) ? normalizeText(raw.criterion) : "";
      const left = remaining.get(key) ?? 0;
      if (left > 0) remaining.set(key, left - 1);
      else
        add(
          "checklist-row-not-in-issue",
          row,
          `本文のチェックリストに無い（または重複した）項目: ${key}`,
        );
    } else if (raw.source === "body" || raw.source === "comment") {
      if (!nonEmptyString(raw.quote)) {
        add(
          "quote-missing",
          row,
          `source: ${raw.source} の行に quote（本文・コメントからの引用）が無い`,
        );
      } else {
        const quote = normalizeText(raw.quote);
        const found =
          raw.source === "body"
            ? normalizedBody.includes(quote)
            : normalizedComments.some((c) => c.includes(quote));
        if (!found)
          add(
            "quote-not-found",
            row,
            `quote が Issue の ${raw.source === "body" ? "本文" : "コメント"}に無い: ${quote}`,
          );
      }
    } else {
      add("source-invalid", row, `source が語彙外: ${String(raw.source)}`);
    }

    const status = raw.status;
    if (typeof status !== "string" || !STATUSES.includes(status)) {
      add("status-invalid", row, `status が語彙外: ${String(status)}`);
      return;
    }
    counts[/** @type {keyof typeof counts} */ (status)] += 1;
    if (status === "met") {
      const evidence = Array.isArray(raw.evidence) ? raw.evidence : [];
      // 根拠の無い met は「満たしたつもり」と区別できない。
      if (evidence.length === 0) add("evidence-missing", row, "met なのに根拠（evidence）が無い");
      let hasCommand = false;
      for (const e of evidence) {
        const { kind, problem } = checkEvidence(e, checkFile);
        if (problem !== null) add("evidence-invalid", row, problem);
        else if (kind === "command") hasCommand = true;
      }
      if (typeof raw.strength !== "string" || !STRENGTHS.includes(raw.strength)) {
        add("strength-invalid", row, `strength が語彙外: ${String(raw.strength)}`);
      } else if (raw.strength === "measured" && !hasCommand) {
        // 実測と名乗るなら結果の記録があるコマンドを 1 件は要る（ファイルを読んだだけでは実測にならない）。
        add("strength-unsupported", row, "strength: measured なのにコマンドの根拠が無い");
      }
    } else if (status === "unmet") {
      add("unmet", row, `満たしていない: ${String(raw.criterion)}`);
    } else if (status === "pending-decision") {
      // 判断待ちは完了側に数えない。置き場（判断待ちの記録）を指していなければ、誰も判断しない。
      if (!nonEmptyString(raw.decision_ref)) {
        add(
          "decision-ref-missing",
          row,
          "pending-decision なのに decision_ref（判断待ちの記録）が無い",
        );
      } else if (decisionIds !== null && !decisionIds.has(raw.decision_ref)) {
        add(
          "decision-ref-not-found",
          row,
          `decision_ref ${raw.decision_ref} が判断待ちの記録に無い`,
        );
      }
      add("pending-decision", row, `判断待ち: ${String(raw.criterion)}`);
    } else if (status === "later") {
      // 後工程が満たす条件は、どの工程が満たすかを書かなければ誰も満たさない。
      if (!nonEmptyString(raw.owner))
        add("owner-missing", row, "later には満たす後工程（owner）が要る");
      // どの後工程へ回してよいかは呼び出し元が決める（--allow-later）。実装役が「後で」と書いて外せないようにする。
      else if (!allowLater.has(raw.owner))
        add(
          "owner-not-allowed",
          row,
          `later の owner が呼び出し元の許した後工程に無い: ${raw.owner}`,
        );
    } else {
      // waived（外す）と deferred（別の置き場へ回す）は、どちらも利用者の決定が要る。実装役が黙って決めない。
      const approval = raw.approval;
      if (
        !isObject(approval) ||
        !nonEmptyString(approval.by) ||
        !nonEmptyString(approval.at) ||
        !nonEmptyString(approval.ref)
      ) {
        add("approval-missing", row, `${status} には利用者の承認（approval.by / at / ref）が要る`);
      }
      if (status === "deferred" && !nonEmptyString(raw.tracked_in)) {
        add("tracked-in-missing", row, "deferred には残作業の置き場（tracked_in）が要る");
      }
    }
  });

  for (const [item, left] of remaining) {
    for (let i = 0; i < left; i += 1) {
      add("checklist-item-missing", null, `本文のチェックリストの項目に対応する行が無い: ${item}`);
    }
  }

  return {
    structural: false,
    findings,
    // deferred・later が残る Issue は、PR で閉じない（Closes を書かない）。
    closable: findings.length === 0 && counts.deferred === 0 && counts.later === 0,
    expected_fingerprint: expected,
    counts,
  };
}

const USAGE =
  "usage: node acceptance-check.mjs --issue <gh issue view --json number,url,body,comments の出力> " +
  "--table <突き合わせ表> [--head <現在の HEAD の完全 SHA>] [--root <ファイル:行 の起点>] " +
  "[--decisions <pending_decisions を持つ JSON>] [--allow-later <後工程名,...>]";

/**
 * CLI。
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void }} [deps]
 * @returns {number} 終了コード
 */
export function main(argv, deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const out = (/** @type {unknown} */ value) =>
    (deps.stdout ?? ((s) => process.stdout.write(s)))(`${JSON.stringify(value, null, 2)}\n`);
  const fail = (/** @type {string} */ message) => {
    (deps.stderr ?? ((s) => process.stderr.write(s)))(`${message}\n${USAGE}\n`);
    return 2;
  };
  const known = new Set(["--issue", "--table", "--head", "--root", "--decisions", "--allow-later"]);
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!known.has(key)) return fail(`未知の引数: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return fail(`${key} に値が無い`);
    if (Object.hasOwn(args, key)) return fail(`${key} が重複している`);
    args[key] = value;
    i += 1;
  }
  if (args["--issue"] === undefined || args["--table"] === undefined) {
    return fail("--issue と --table は必須");
  }
  // 短縮 SHA は別のコミットと一致しうるので受け付けない。
  if (args["--head"] !== undefined && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(args["--head"])) {
    return fail(`--head は完全 SHA: ${args["--head"]}`);
  }
  /** @type {Record<string, unknown>} */
  const parsed = {};
  for (const key of ["--issue", "--table", "--decisions"]) {
    if (args[key] === undefined) continue;
    const path = resolve(cwd, args[key]);
    try {
      parsed[key] = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      return fail(`${path} を読めない: ${error && /** @type {Error} */ (error).message}`);
    }
  }
  /** @type {Set<string> | null} */
  let decisionIds = null;
  if (parsed["--decisions"] !== undefined) {
    const doc = parsed["--decisions"];
    if (!isObject(doc) || !Array.isArray(doc.pending_decisions)) {
      return fail("--decisions に pending_decisions 配列が無い");
    }
    decisionIds = new Set(
      doc.pending_decisions
        .filter(isObject)
        .map((d) => d.id)
        .filter(nonEmptyString),
    );
  }
  const root = resolve(cwd, args["--root"] ?? ".");
  const readText = (/** @type {string} */ path) => {
    try {
      if (!existsSync(path) || !statSync(path).isFile()) return null;
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  };
  const result = checkAcceptance({
    issue: parsed["--issue"],
    table: parsed["--table"],
    head: args["--head"] ?? null,
    decisionIds,
    allowLater: new Set(
      (args["--allow-later"] ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v !== ""),
    ),
    checkFile: fileChecker(root, readText),
  });
  if (result.structural) {
    out({ ok: false, structural: true, error: result.error });
    return 2;
  }
  out({
    ok: result.findings.length === 0,
    closable: result.closable,
    findings: result.findings,
    expected_fingerprint: result.expected_fingerprint,
    counts: { ...result.counts, findings: result.findings.length },
  });
  return result.findings.length === 0 ? 0 : 1;
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
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
