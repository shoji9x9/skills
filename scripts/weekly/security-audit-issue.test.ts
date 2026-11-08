// security-audit-issue.ts（週次のセキュリティ監査の記録から追跡 Issue を作る）のテスト。
//
// | 軸 | 値 |
// | --- | --- |
// | run-metadata.json | complete / incomplete（理由が語・文・無い）/ in_progress / run_status が無い / profile が知らない値 / オブジェクトでない / 無い / JSON でない |
// | findings.json | 3 種の判定 / 配列でない / 判定が知らない値 / fingerprint が空・無い・重複 / confirmed の重大度が無い・知らない値 / 0 件 |
// | 鍵 | 空 / 同じ鍵と fingerprint（同じ識別子）/ 鍵が違う（違う識別子） |
// | 公開する要約 | 題名・説明・場所・fingerprint を含まない |
// | 要約（別のジョブで読む） | 正しい / 識別子の形が違う / 重大度が判定と合わない / 理由が形と合わない / items が配列でない |
// | 本文とコメント | 新規と継続 / 解消 / rejected は載せない / 未完了 / 0 件 |
// | CLI | summarize と issue の正しい引数 / 未知のサブコマンド / 足りない・未知の引数 / 読めない入力（1） |
import { describe, expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Summary,
  formatBody,
  formatComment,
  itemId,
  main,
  parseFindings,
  parseMetadata,
  parseSummary,
  previousKeys,
  summarize,
} from "./security-audit-issue.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";

const KEY = "test-key";
const metadata = (over: Record<string, unknown> = {}) => ({
  run_id: "run-1",
  run_status: "complete",
  profile: "quick",
  ...over,
});
const severity = (overall: string) => ({
  likelihood: { score: overall, reason: "r" },
  impact: { score: overall, reason: "r" },
  overall_severity: overall,
});
const record = (fingerprint: string, verdict: string, over: Record<string, unknown> = {}) => ({
  verdict,
  fingerprint,
  title: `題名 ${fingerprint}`,
  description: "src/secret-path.ts の説明",
  trace: [{ kind: "sink", file: "src/secret-path.ts", line: 3, scope: "f", description: "d" }],
  ...(verdict === "confirmed" ? { severity: severity("high") } : {}),
  ...over,
});

describe("run-metadata.json", () => {
  test("complete は理由を持たない", () => {
    expect(parseMetadata(metadata({ incomplete_reason: "x" }))).toEqual({
      run_status: "complete",
      incomplete_reason: null,
      profile: "quick",
    });
  });

  test.each([
    ["語の理由", "validation_budget_exhausted", "validation_budget_exhausted"],
    ["文の理由", "unrecognized", "Ran out of budget at src/x.ts"],
    ["理由が無い", "unrecognized", undefined],
  ])("incomplete で%s なら %s にする", (_name, expected, reason) => {
    const read = parseMetadata(metadata({ run_status: "incomplete", incomplete_reason: reason }));
    expect(read.incomplete_reason).toBe(expected);
  });

  test.each([
    ["in_progress", metadata({ run_status: "in_progress" }), "監査が終わっていない"],
    ["run_status が無い", metadata({ run_status: undefined }), "監査が終わっていない"],
    ["profile が知らない値", metadata({ profile: "huge" }), "profile"],
    ["オブジェクトでない", [], "オブジェクトでない"],
  ])("%s は例外にする", (_name, value, message) => {
    expect(() => parseMetadata(value)).toThrow(message);
  });
});

describe("findings.json", () => {
  test("3 種の判定を読み、confirmed だけに重大度を付け、識別子の順に並べる", () => {
    const items = parseFindings(
      [record("a", "confirmed"), record("b", "needs_validation"), record("c", "rejected")],
      KEY,
    );
    expect(items).toHaveLength(3);
    const ids = items.map((i) => i.id);
    expect(ids).toEqual([...ids].sort());
    const byVerdict = Object.fromEntries(items.map((i) => [i.verdict, i]));
    expect(byVerdict["confirmed"]?.severity).toBe("high");
    expect(byVerdict["needs_validation"]?.severity).toBeNull();
    expect(byVerdict["rejected"]?.severity).toBeNull();
  });

  test("0 件は空の一覧にする", () => {
    expect(parseFindings([], KEY)).toEqual([]);
  });

  test.each([
    ["配列でない", {}, "配列でない"],
    ["要素がオブジェクトでない", ["x"], "オブジェクトでない"],
    ["判定が知らない値", [record("a", "maybe")], "verdict"],
    ["fingerprint が空", [record(" ", "rejected")], "fingerprint が空"],
    [
      "fingerprint が無い",
      [record("a", "rejected", { fingerprint: undefined })],
      "fingerprint が空",
    ],
    ["fingerprint が重複", [record("a", "rejected"), record("a", "needs_validation")], "重複"],
    [
      "confirmed の重大度が無い",
      [record("a", "confirmed", { severity: undefined })],
      "overall_severity",
    ],
    [
      "confirmed の重大度が知らない値",
      [record("a", "confirmed", { severity: severity("huge") })],
      "overall_severity",
    ],
  ])("%s は例外にする", (_name, value, message) => {
    expect(() => parseFindings(value, KEY)).toThrow(message);
  });
});

describe("識別子", () => {
  test("同じ鍵と fingerprint なら同じ、鍵か fingerprint が違えば違う識別子になる", () => {
    expect(itemId(KEY, "a")).toBe(itemId(KEY, "a"));
    expect(itemId(KEY, "a")).not.toBe(itemId("other", "a"));
    expect(itemId(KEY, "a")).not.toBe(itemId(KEY, "b"));
    expect(itemId(KEY, "a")).toMatch(/^sa-[0-9a-f]{12}$/u);
  });
});

describe("summarize", () => {
  const runDir = (meta: unknown, findings: unknown): string => {
    const dir = makeTempDir("security-audit-issue-");
    if (meta !== undefined) writeFileSync(join(dir, "run-metadata.json"), JSON.stringify(meta));
    if (findings !== undefined) {
      const text = typeof findings === "string" ? findings : JSON.stringify(findings);
      writeFileSync(join(dir, "findings.json"), text);
    }
    return dir;
  };

  test("要約は題名・説明・場所・fingerprint を含まない", () => {
    const dir = runDir(metadata(), [record("path-traversal:src/secret-path.ts", "confirmed")]);
    const text = JSON.stringify(summarize(dir, KEY));
    for (const detail of ["題名", "説明", "secret-path", "path-traversal"]) {
      expect(text).not.toContain(detail);
    }
    expect(text).toContain(itemId(KEY, "path-traversal:src/secret-path.ts"));
  });

  test.each([
    { name: "鍵が空", meta: metadata(), findings: [], key: "", message: "鍵" },
    {
      name: "run-metadata.json が無い",
      meta: undefined,
      findings: [],
      key: KEY,
      message: "run-metadata.json を読めない",
    },
    {
      name: "findings.json が無い",
      meta: metadata(),
      findings: undefined,
      key: KEY,
      message: "findings.json を読めない",
    },
    {
      name: "findings.json が JSON でない",
      meta: metadata(),
      findings: "{x",
      key: KEY,
      message: "JSON として読めない",
    },
  ])("$name は例外にする", ({ meta, findings, key, message }) => {
    expect(() => summarize(runDir(meta, findings), key)).toThrow(message);
  });
});

const summary = (over: Partial<Summary> = {}): Summary => ({
  run_status: "complete",
  incomplete_reason: null,
  profile: "quick",
  items: [
    { id: "sa-000000000001", verdict: "confirmed", severity: "high" },
    { id: "sa-000000000002", verdict: "needs_validation", severity: null },
    { id: "sa-000000000003", verdict: "rejected", severity: null },
  ],
  ...over,
});

describe("要約を読む", () => {
  test("summarize が書く形を読む", () => {
    expect(parseSummary(JSON.parse(JSON.stringify(summary())))).toEqual(summary());
  });

  test.each([
    ["items が配列でない", { ...summary(), items: {} }, "要約の形"],
    [
      "識別子の形が違う",
      summary({ items: [{ id: "@team", verdict: "rejected", severity: null }] }),
      "id の形",
    ],
    [
      "confirmed に重大度が無い",
      summary({ items: [{ id: "sa-000000000001", verdict: "confirmed", severity: null }] }),
      "severity",
    ],
    [
      "rejected に重大度がある",
      summary({ items: [{ id: "sa-000000000001", verdict: "rejected", severity: "low" }] }),
      "severity",
    ],
    [
      "理由が形と合わない",
      summary({ run_status: "incomplete", incomplete_reason: "a sentence" }),
      "incomplete_reason",
    ],
  ])("%s は例外にする", (_name, value, message) => {
    expect(() => parseSummary(value)).toThrow(message);
  });
});

describe("本文とコメント", () => {
  test("件数を判定ごとに出し、rejected は識別子の表と目印に載せない", () => {
    const body = formatBody(summary());
    expect(body).toContain("| 確かめた脆弱性（confirmed） | 1 | high 1 |");
    expect(body).toContain("| 否定した候補（rejected） | 1 |  |");
    expect(body).toContain("| sa-000000000001 | confirmed | high | 新規 |");
    expect(body).not.toContain("| sa-000000000003 |");
    expect(previousKeys(body)).toEqual(["sa-000000000001", "sa-000000000002"]);
  });

  test("前回からの継続と解消を書く", () => {
    const previous = ["sa-000000000001", "sa-00000000000f"];
    const body = formatBody(summary(), previous);
    expect(body).toContain("| sa-000000000001 | confirmed | high | 継続 |");
    expect(body).toContain("前回から解消したもの: sa-00000000000f");
    const comment = formatComment(summary(), previous);
    expect(comment).toContain("対応が要る記録: 2 件（新規 1 件・継続 1 件・前回から解消 1 件）");
    expect(comment).toContain("解消: sa-00000000000f");
  });

  test("未完了なら理由を本文とコメントに書く", () => {
    const s = summary({ run_status: "incomplete", incomplete_reason: "critic_budget_exhausted" });
    expect(formatBody(s)).toContain("未完了（理由: critic_budget_exhausted）");
    expect(formatComment(s, [])).toContain("監査は未完了です（理由: critic_budget_exhausted）");
  });

  test("0 件なら識別子の表を出さない", () => {
    const body = formatBody(summary({ items: [] }));
    expect(body).not.toContain("| 識別子 |");
    expect(previousKeys(body)).toEqual([]);
  });
});

describe("CLI", () => {
  test("summarize で要約を書き、issue で本文とコメントを書いて due を出す", () => {
    const root = makeTempDir("security-audit-issue-");
    writeFileSync(join(root, "run-metadata.json"), JSON.stringify(metadata()));
    writeFileSync(
      join(root, "findings.json"),
      JSON.stringify([record("a", "confirmed"), record("b", "rejected")]),
    );
    const summaryPath = join(root, "summary.json");
    process.env["SECURITY_AUDIT_STATE_KEY"] = KEY;
    try {
      expect(main(["summarize", "--run-dir", root, "--out", summaryPath])).toBe(0);
    } finally {
      delete process.env["SECURITY_AUDIT_STATE_KEY"];
    }
    const previous = join(root, "previous.md");
    writeFileSync(previous, `<!-- security-audit:keys ["sa-00000000000f"] -->\n`);
    const args = ["--summary", summaryPath, "--out", join(root, "b.md")];
    const log: string[] = [];
    const original = console.log;
    console.log = (line: string) => log.push(line);
    try {
      expect(
        main(["issue", ...args, "--comment-out", join(root, "c.md"), "--previous", previous]),
      ).toBe(0);
    } finally {
      console.log = original;
    }
    expect(log.at(-1)).toBe("due=1");
    expect(readFileSync(join(root, "b.md"), "utf8")).toContain(itemId(KEY, "a"));
    expect(readFileSync(join(root, "c.md"), "utf8")).toContain("解消: sa-00000000000f");
  });

  test("鍵が無ければ summarize は 1", () => {
    const root = makeTempDir("security-audit-issue-");
    writeFileSync(join(root, "run-metadata.json"), JSON.stringify(metadata()));
    writeFileSync(join(root, "findings.json"), "[]");
    delete process.env["SECURITY_AUDIT_STATE_KEY"];
    expect(main(["summarize", "--run-dir", root, "--out", join(root, "s.json")])).toBe(1);
  });

  test("要約を読めなければ issue は 1", () => {
    const root = makeTempDir("security-audit-issue-");
    const args = ["--summary", join(root, "none.json"), "--out", join(root, "b.md")];
    expect(main(["issue", ...args, "--comment-out", join(root, "c.md")])).toBe(1);
  });

  test.each([
    ["サブコマンドが無い", []],
    ["未知のサブコマンド", ["publish", "--out", "a"]],
    ["summarize に --out が無い", ["summarize", "--run-dir", "d"]],
    ["summarize に未知の引数", ["summarize", "--run-dir", "d", "--out", "o", "--x", "y"]],
    ["summarize の値が無い", ["summarize", "--run-dir"]],
    ["issue に --summary が無い", ["issue", "--out", "a", "--comment-out", "b"]],
  ])("%s は 2", (_name, args) => {
    expect(main(args)).toBe(2);
  });
});
