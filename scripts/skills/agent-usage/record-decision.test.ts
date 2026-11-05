// ブランチを記録するかの判定（record-decision.mjs）のテスト（Issue #880）。
//
// 判定は、コミットの前の確認・status・別の作業ツリーの行を外す判定が共有する。
// そのため、判定の順と結果をここで固定する。
//
// 入力の軸:
//   ブランチの判断   record・decline・無い・読めない。
//   defaultDecision  record・decline・無い・読めない（ブランチの判断が無いときだけ読む）。
//   人の設定         ある・無い・読めない（ブランチの判断が decline のときは読まない）。

import { expect, test } from "vitest";
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
