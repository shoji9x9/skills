// ブランチを記録するかの判定（record-decision.mjs）のテスト（Issue #880）。
//
// 判定は、コミットの前の確認・status・別の作業ツリーの行を外す判定が共有する。
// そのため、判定の順と結果をここで固定する。
//
// 入力の軸:
//   ブランチの判断   record・decline・無い・読めない。
//   defaultDecision  record・decline・無い・読めない（ブランチの判断が無いときだけ読む）。
//   人の設定         ある・無い・読めない（ブランチの判断が decline のときは読まない）。

import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopResult } from "../../../skills/agent-usage/scripts/lib/gate.mjs";
import {
  decidesToRecord,
  recordDecision,
} from "../../../skills/agent-usage/scripts/lib/record-decision.mjs";

type Value<T> = T | "throw" | "unread";

/** 読み取りの偽物。"throw" は読めない、"unread" は読まれたらテストを失敗にする。 */
function reader<T>(value: Value<T>): () => T {
  return () => {
    if (value === "throw") throw new Error("読めない");
    if (value === "unread") throw new Error("読まれないはずの値を読んだ");
    return value;
  };
}

const SOURCE = "/repo/.config/skills/shoji9x9/agent-usage.jsonc";

test.each<{
  label: string;
  branch: Value<"record" | "decline" | null>;
  fallback: Value<{ decision: "record" | "decline"; source: string } | null>;
  person: Value<boolean>;
  expected: Record<string, unknown>;
  records: boolean;
}>([
  {
    label: "ブランチの判断が record で人の設定がある",
    branch: "record",
    fallback: "unread",
    person: true,
    expected: { kind: "decided", decision: "record", source: null },
    records: true,
  },
  {
    label: "ブランチの判断が decline なら、人の設定を読まない",
    branch: "decline",
    fallback: "unread",
    person: "unread",
    expected: { kind: "decided", decision: "decline", source: null },
    records: false,
  },
  {
    label: "ブランチの判断が record でも人の設定が無ければ止める",
    branch: "record",
    fallback: "unread",
    person: false,
    expected: { kind: "no-person", decision: "record", source: null },
    records: false,
  },
  {
    label: "ブランチの判断が record で人の設定を読めない",
    branch: "record",
    fallback: "unread",
    person: "throw",
    expected: { kind: "unreadable", stage: "config", branch: "record" },
    records: false,
  },
  {
    label: "判断の記録を読めない",
    branch: "throw",
    fallback: "unread",
    person: "unread",
    expected: { kind: "unreadable", stage: "decisions" },
    records: false,
  },
  {
    label: "判断が無く defaultDecision も無い",
    branch: null,
    fallback: null,
    person: "unread",
    expected: { kind: "undecided" },
    records: false,
  },
  {
    label: "判断が無く defaultDecision を読めない",
    branch: null,
    fallback: "throw",
    person: "unread",
    expected: { kind: "unreadable", stage: "config", branch: null },
    records: false,
  },
  {
    label: "判断が無く defaultDecision が record で人の設定がある",
    branch: null,
    fallback: { decision: "record", source: SOURCE },
    person: true,
    expected: { kind: "decided", decision: "record", source: SOURCE },
    records: true,
  },
  {
    label: "判断が無く defaultDecision が decline でも、人の設定が無ければ止める",
    branch: null,
    fallback: { decision: "decline", source: SOURCE },
    person: false,
    expected: { kind: "no-person", decision: "decline", source: SOURCE },
    records: false,
  },
  {
    label: "判断が無く defaultDecision が decline で人の設定がある",
    branch: null,
    fallback: { decision: "decline", source: SOURCE },
    person: true,
    expected: { kind: "decided", decision: "decline", source: SOURCE },
    records: false,
  },
  {
    label: "判断が無く defaultDecision はあるが、人の設定を読めない",
    branch: null,
    fallback: { decision: "record", source: SOURCE },
    person: "throw",
    expected: { kind: "unreadable", stage: "config", branch: null },
    records: false,
  },
])("$label", ({ branch, fallback, person, expected, records }) => {
  const r = recordDecision({
    branch: reader(branch),
    fallback: reader(fallback),
    person: reader(person),
  });
  expect(r).toMatchObject(expected);
  if (r.kind === "unreadable") expect(String(r.error)).toContain("読めない");
  expect(decidesToRecord(r)).toBe(records);
});

describe("判断が無いときにコミットを止める案内（gate.mjs の stopResult）", () => {
  // 案内の文は人の設定があるかで変わるので、止める前に人の設定を読む。
  // CLI の流れでは、その前の段（defaultDecision の読み取り）が同じファイルを読んで設定のエラーを返す。
  // 案内の段で初めて読めなくなる形（読み取りの間にファイルが変わったなど）は CLI では作れないので、ここで直接確かめる
  const context = { fallbackCwd: "/", now: 0, script: "/s/agent-usage.mjs", agent: "claude-code" };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function userLayerWith(body: string | null): void {
    const root = mkdtempSync(join(tmpdir(), "agent-usage-stop-"));
    const dir = join(root, "skills", "shoji9x9");
    mkdirSync(dir, { recursive: true });
    if (body !== null) writeFileSync(join(dir, "agent-usage.jsonc"), body);
    vi.stubEnv("XDG_CONFIG_HOME", root);
    // テストの実行の環境が人ごとの層を読まない設定にしていても、ここでは読ませる
    vi.stubEnv("SHOJI9X9_SKILLS_IGNORE_USER_CONFIG", undefined);
  }

  test("人の設定を読めなければ、例外で止まらずに設定のエラーとして返す", () => {
    userLayerWith("{ not json");
    const r = stopResult({ kind: "undecided" }, context);
    expect(r.exit).toBe(2);
    expect(r.message).toMatch(/^agent-usage: 設定を読めない: .*JSONC として読めない/);
    expect(r.message).toMatch(/decline を実行してからコミット/);
  });

  test("人の設定が無ければ、記録するかを尋ねる案内に setup の案内を足す", () => {
    userLayerWith(null);
    const r = stopResult({ kind: "undecided" }, context);
    expect(r.exit).toBe(2);
    expect(r.message).toMatch(/まだ決まっていません/);
    expect(r.message).toMatch(/setup --person-id <その ID>/);
  });

  test("人の設定があれば、setup の案内を足さない", () => {
    userLayerWith('{ "personId": "p-0123abcd", "timeZone": "UTC" }');
    const r = stopResult({ kind: "undecided" }, context);
    expect(r.exit).toBe(2);
    expect(r.message).toMatch(/まだ決まっていません/);
    expect(r.message).not.toMatch(/setup --person-id/);
  });
});
