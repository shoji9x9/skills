// issue-start の受け入れ条件の突き合わせ表の検査（acceptance-check.mjs）の回帰テスト（Issue #464）。
//
// テスト・スイートの緑は成果物の形の検査で、Issue にだけ書かれた条件はどの工程にも数えられないまま完了になる。
// 表が Issue と 1 対 1 に対応し、各行に根拠があるまで完了にしない。
//
// 陽性コントロール（Issue と対応し根拠の揃った表が exit 0）を置く——これが無いと「常に落とす」実装と区別できない。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "vitest";
import {
  main,
  checklistItems,
  fingerprintOf,
  RESULT_MARKER,
} from "../skills/issue-start/scripts/acceptance-check.mjs";
import { makeTempDir } from "./lib/test-tmpdir.js";

const HEAD = "a".repeat(40);

const BODY = [
  "## 受け入れ条件",
  "",
  "- [ ] 検索条件を URL で持つ",
  "- [x] 準備の失敗時にログを書く",
  "",
  "書き込み系ボタンの E2E を置くこと。",
  "",
  "```md",
  "- [ ] フェンスの中は数えない",
  "```",
].join("\n");

/**
 * Issue の JSON（gh issue view --json number,url,title,body,comments の形）。
 * @param {{ body?: string, comments?: string[] }} [override]
 */
function issue(override = {}) {
  return {
    number: 464,
    url: "https://github.com/o/r/issues/464",
    body: override.body ?? BODY,
    comments: (override.comments ?? ["検査の対象を広げる"]).map((body) => ({ body })),
  };
}

/**
 * 条件を全部満たした表。差し替えたい行だけ渡す。
 * @param {{ items?: unknown[], issueData?: ReturnType<typeof issue>, commit?: string }} [override]
 */
function table(override = {}) {
  const data = override.issueData ?? issue();
  return {
    issue: { url: data.url, number: data.number },
    source_fingerprint: fingerprintOf(
      data.body,
      data.comments.map((c) => c.body),
    ),
    commit: override.commit ?? HEAD,
    items: override.items ?? [
      {
        criterion: "検索条件を URL で持つ",
        source: "checklist",
        status: "met",
        strength: "measured",
        evidence: [{ kind: "command", command: "pnpm test url", result: "exit 0" }],
      },
      {
        criterion: "準備の失敗時にログを書く",
        source: "checklist",
        status: "met",
        strength: "read",
        evidence: [{ kind: "file", ref: "src/app.js:2" }],
      },
      {
        criterion: "書き込み系ボタンの E2E",
        source: "body",
        quote: "書き込み系ボタンの E2E を置くこと。",
        status: "waived",
        approval: { by: "owner", at: "2026-09-24T10:00:00Z", ref: "pd-2" },
      },
      {
        criterion: "検査の対象を広げる",
        source: "comment",
        quote: "検査の対象を広げる",
        status: "deferred",
        approval: { by: "owner", at: "2026-09-24T10:00:00Z", ref: "pd-3" },
        tracked_in: "#500",
      },
    ],
  };
}

/**
 * 作業ディレクトリに Issue・表・根拠のファイルを置いて CLI を呼ぶ。
 * @param {{ issueData?: unknown, tableData?: unknown, extra?: string[], decisions?: unknown }} [input]
 */
function run(input = {}) {
  const work = makeTempDir("acceptance-check-");
  mkdirSync(join(work, "src"));
  writeFileSync(join(work, "src/app.js"), "line1\nline2\nline3\n");
  writeFileSync(join(work, "issue.json"), JSON.stringify(input.issueData ?? issue()));
  writeFileSync(join(work, "table.json"), JSON.stringify(input.tableData ?? table()));
  const argv = ["--issue", "issue.json", "--table", "table.json", ...(input.extra ?? [])];
  if (input.decisions !== undefined) {
    writeFileSync(join(work, "decisions.json"), JSON.stringify(input.decisions));
    argv.push("--decisions", "decisions.json");
  }
  let stdout = "";
  let stderr = "";
  const code = main(argv, {
    cwd: work,
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  const json = stdout ? JSON.parse(stdout) : null;
  return { code, stderr, json, codes: json?.findings?.map((/** @type {any} */ f) => f.code) ?? [] };
}

test("陽性コントロール: Issue と対応し根拠の揃った表は exit 0（deferred があれば閉じない）", () => {
  const r = run({ extra: ["--head", HEAD] });
  expect(r.code).toBe(0);
  expect(r.json.ok).toBe(true);
  expect(r.json.closable).toBe(false);
  expect(r.json.counts.checklist).toBe(2);
});

test("deferred が無ければ閉じてよい", () => {
  const items = table().items.slice(0, 3);
  const r = run({ tableData: table({ items }) });
  expect(r.code).toBe(0);
  expect(r.json.closable).toBe(true);
});

test("本文のチェックリストの項目に行が無ければ落とす", () => {
  const items = table().items.filter((i) => i.criterion !== "検索条件を URL で持つ");
  const r = run({ tableData: table({ items }) });
  expect(r.code).toBe(1);
  expect(r.codes).toContain("checklist-item-missing");
});

test("本文に無いチェックリスト項目・重複した行は落とす", () => {
  const base = table().items;
  const r = run({ tableData: table({ items: [...base, { ...base[0] }] }) });
  expect(r.code).toBe(1);
  expect(r.codes).toContain("checklist-row-not-in-issue");
});

test("コードフェンスの中のチェックボックスは項目に数えない", () => {
  expect(checklistItems(BODY)).toEqual(["検索条件を URL で持つ", "準備の失敗時にログを書く"]);
});

test("行頭のインラインコードはフェンスの開きにしない（以降の項目を数える）", () => {
  expect(checklistItems("```npm test``` を通すこと\n- [ ] a\n- [ ] b")).toEqual(["a", "b"]);
});

test("言語名付きの行はフェンスを閉じない", () => {
  expect(checklistItems("```js\ncode\n```js\n- [ ] inside\n```\n- [ ] after")).toEqual(["after"]);
  // 後ろが空白だけの閉じは閉じとして扱う（陽性コントロール）。
  expect(checklistItems("~~~\n- [ ] inside\n~~~  \n- [ ] after")).toEqual(["after"]);
});

test("散文からの行は引用が本文・コメントに無ければ落とす", () => {
  const items = table().items.map((i) =>
    i.source === "body" ? { ...i, quote: "本文に無い条件" } : i,
  );
  const r = run({ tableData: table({ items }) });
  expect(r.code).toBe(1);
  expect(r.codes).toContain("quote-not-found");
});

test("根拠の無い met・実測を名乗るのにコマンドの無い met は落とす", () => {
  const items = table().items.map((i, n) =>
    n === 0 ? { ...i, evidence: [] } : n === 1 ? { ...i, strength: "measured" } : i,
  );
  const r = run({ tableData: table({ items }) });
  expect(r.code).toBe(1);
  expect(r.codes).toContain("evidence-missing");
  expect(r.codes).toContain("strength-unsupported");
});

test("ファイル:行 の根拠はファイルの実在と行の範囲を確かめる", () => {
  const items = table().items.map((i, n) =>
    n === 1
      ? {
          ...i,
          evidence: [
            { kind: "file", ref: "src/app.js:9" },
            { kind: "file", ref: "nope.js:1" },
          ],
        }
      : i,
  );
  const r = run({ tableData: table({ items }) });
  expect(r.code).toBe(1);
  expect(
    r.json.findings.filter((/** @type {any} */ f) => f.code === "evidence-invalid"),
  ).toHaveLength(2);
});

test("unmet・判断待ちは完了にせず、判断待ちは記録を指していなければ落とす", () => {
  const items = table().items.map((i, n) =>
    n === 0
      ? { ...i, status: "unmet" }
      : n === 1
        ? { ...i, status: "pending-decision", decision_ref: "pd-9" }
        : i,
  );
  const r = run({
    tableData: table({ items }),
    decisions: { pending_decisions: [{ id: "pd-1" }] },
  });
  expect(r.code).toBe(1);
  expect(r.codes).toEqual(
    expect.arrayContaining(["unmet", "pending-decision", "decision-ref-not-found"]),
  );
});

test("waived・deferred は利用者の承認が無ければ落とし、deferred は置き場も要る", () => {
  const items = table().items.map((i) =>
    i.status === "waived"
      ? { ...i, approval: undefined }
      : i.status === "deferred"
        ? { ...i, tracked_in: "" }
        : i,
  );
  const r = run({ tableData: table({ items }) });
  expect(r.code).toBe(1);
  expect(r.codes).toEqual(expect.arrayContaining(["approval-missing", "tracked-in-missing"]));
});

test("表の後で Issue の条件が変わったら古い表として落とす（チェックを付けただけでは古くしない）", () => {
  const checked = issue({ body: BODY.replace("- [ ] 検索条件", "- [x] 検索条件") });
  expect(run({ issueData: checked }).code).toBe(0);
  const revised = issue({ comments: ["検査の対象を広げる", "条件を足す: 失敗時は再試行する"] });
  const r = run({ issueData: revised });
  expect(r.code).toBe(1);
  expect(r.codes).toContain("stale-issue");
  // 結果を投稿したコメントは指紋に入れない（投稿しただけで表が古くならない）。
  const posted = issue({ comments: ["検査の対象を広げる", `${RESULT_MARKER}\n| 表 |`] });
  expect(run({ issueData: posted }).code).toBe(0);
  // 目印が先頭に無いコメント（目印に言及しただけの議論）は外さない。
  const mentioned = issue({
    comments: ["検査の対象を広げる", `条件を足す: 結果は ${RESULT_MARKER} を付けて投稿する`],
  });
  expect(run({ issueData: mentioned }).codes).toContain("stale-issue");
});

test("表のコミットが HEAD と違えば古い根拠として落とす", () => {
  const r = run({ extra: ["--head", "b".repeat(40)] });
  expect(r.code).toBe(1);
  expect(r.codes).toContain("stale-commit");
});

test("行が 0 件の表は合格にしない", () => {
  const r = run({ tableData: table({ items: [] }) });
  expect(r.code).toBe(1);
  expect(r.codes).toEqual(expect.arrayContaining(["no-items", "checklist-item-missing"]));
});

test("別の Issue の表・短縮 SHA・壊れた入力は exit 2", () => {
  const other = { ...table(), issue: { number: 465 } };
  expect(run({ tableData: other }).code).toBe(2);
  expect(run({ extra: ["--head", "abc1234"] }).code).toBe(2);
  expect(run({ issueData: { number: 464 } }).code).toBe(2);
});

test("チェックリストの無い Issue は散文からの行だけの表で通る（番号付き・CRLF の本文も読む）", () => {
  const prose = issue({ body: "## 受け入れ条件\r\n\r\n状態を URL で持つ。\r\n", comments: [] });
  const items = [
    {
      criterion: "状態を URL で持つ",
      source: "body",
      quote: "状態を URL で持つ。",
      status: "met",
      strength: "read",
      evidence: [{ kind: "file", ref: "src/app.js:1-3" }],
    },
  ];
  const r = run({ issueData: prose, tableData: table({ issueData: prose, items }) });
  expect(r.code).toBe(0);
  expect(r.json.counts.checklist).toBe(0);
  expect(checklistItems("1. [ ] 番号付き\r\n2) [x] 括弧")).toEqual(["番号付き", "括弧"]);
});

test("同梱テンプレートのプレースホルダのまま提出した表は通さない", () => {
  const template = JSON.parse(
    readFileSync(
      new URL("../skills/issue-start/assets/acceptance-template.json", import.meta.url),
      "utf8",
    ),
  );
  expect(run({ tableData: template }).code).toBe(2);
  const renumbered = { ...template, issue: { ...template.issue, number: 464 } };
  const r = run({ tableData: renumbered });
  expect(r.code).toBe(1);
  expect(r.codes).toEqual(expect.arrayContaining(["stale-issue", "pending-decision"]));
});

test("later は満たす後工程が無ければ落とし、あれば通すが Issue は閉じない", () => {
  const withLater = (/** @type {Record<string, unknown>} */ extra) =>
    table()
      .items.slice(0, 3)
      .map((i, n) => (n === 0 ? { ...i, status: "later", ...extra } : i));
  const missing = run({ tableData: table({ items: withLater({}) }) });
  expect(missing.code).toBe(1);
  expect(missing.codes).toContain("owner-missing");
  const owned = run({
    tableData: table({ items: withLater({ owner: "parity-diff" }) }),
    extra: ["--allow-later", "parity-diff"],
  });
  expect(owned.code).toBe(0);
  expect(owned.json.closable).toBe(false);
});

test("later は呼び出し元が --allow-later で許した後工程にだけ回せる", () => {
  const items = table()
    .items.slice(0, 3)
    .map((i, n) => (n === 0 ? { ...i, status: "later", owner: "後で" } : i));
  const notAllowed = run({ tableData: table({ items }), extra: ["--allow-later", "parity-diff"] });
  expect(notAllowed.code).toBe(1);
  expect(notAllowed.codes).toContain("owner-not-allowed");
  // 許可が無い呼び出し（issue-start --pr 等）では later を一切使えない。
  const none = run({
    tableData: table({
      items: items.map((i, n) => (n === 0 ? { ...i, owner: "parity-diff" } : i)),
    }),
  });
  expect(none.codes).toContain("owner-not-allowed");
});

test("本文が空でタイトルだけの Issue は、タイトルからの行で通る（タイトルの変更は古い表として落とす）", () => {
  const titled = {
    number: 464,
    url: "u",
    title: "fix: 保存に失敗したらログを書く",
    body: "",
    comments: [],
  };
  const fp = fingerprintOf("", [], titled.title);
  const items = [
    {
      criterion: "保存に失敗したらログを書く",
      source: "title",
      quote: "保存に失敗したらログを書く",
      status: "met",
      strength: "read",
      evidence: [{ kind: "file", ref: "src/app.js:1" }],
    },
  ];
  const tableData = { issue: { number: 464 }, source_fingerprint: fp, commit: HEAD, items };
  const ok = run({ issueData: titled, tableData });
  expect(ok.code).toBe(0);
  const retitled = run({ issueData: { ...titled, title: "fix: 別の条件" }, tableData });
  expect(retitled.code).toBe(1);
  expect(retitled.codes).toEqual(expect.arrayContaining(["stale-issue", "quote-not-found"]));
});

test("HTML コメントの中の例示チェックボックスは項目に数えない（閉じないコメントは末尾まで）", () => {
  expect(
    checklistItems("- [ ] real\n<!--\n- [ ] example item from template\n-->\n- [ ] after"),
  ).toEqual(["real", "after"]);
  expect(checklistItems("- [ ] real\n<!-- - [ ] inline -->\n<!--\n- [ ] unclosed")).toEqual([
    "real",
  ]);
});

test("チェックを付けて書き戻したときの末尾の改行では表を古くしない", () => {
  expect(fingerprintOf("- [ ] a", [])).toBe(fingerprintOf("- [x] a\n", []));
  expect(fingerprintOf("b", ["c"])).toBe(fingerprintOf("b", ["c\n"]));
  // 中身が変われば変わる（陽性コントロール）。
  expect(fingerprintOf("- [ ] a", [])).not.toBe(fingerprintOf("- [ ] b", []));
});

test("インラインコード・コードフェンスの中の <!-- はコメントにしない", () => {
  expect(checklistItems("- [ ] 出力に `<!-- -->` を含めない")).toEqual([
    "出力に `<!-- -->` を含めない",
  ]);
  expect(checklistItems("```html\n<!-- header\n```\n- [ ] a\n- [ ] b")).toEqual(["a", "b"]);
});
