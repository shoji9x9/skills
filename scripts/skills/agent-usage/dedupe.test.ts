// セッションをまたいだ重複の除去（dedupe.mjs）と、キャッシュに置いた要約の読み込み（collect.mjs の summaryFromCache）。
//
// 入力の軸（dedupeSessions）:
//   重複           無い／2 つのセッションにある／agent が違う同じ key（重複ではない）。
//   残す側の決め方 最初の時刻が早い／同じなら最後の時刻が早い／claims に記録済み（後のセッションを指す・今は無いセッションを指す）。
//   外す側の事象   外した応答の最後の時刻まで（以前）と、その後。
//
// 入力の軸（summaryFromCache）: 正しい要約・無限大を null にした要約・トークン数が数でない・配列でない欄。

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { summaryFromCache } from "../../../skills/agent-usage/scripts/lib/collect.mjs";
import { dedupeSessions, loadClaims } from "../../../skills/agent-usage/scripts/lib/dedupe.mjs";
import { zeroTokens } from "../../../skills/agent-usage/scripts/lib/pricing.mjs";
import { emptySummary } from "../../../skills/agent-usage/scripts/lib/sources/session.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

type Summary = ReturnType<typeof emptySummary>;

const msg = (key: string, ts: number) => ({ key, ts, model: "m", tokens: zeroTokens() });

function session(
  id: string,
  parts: Partial<Summary>,
  agent: "claude-code" | "codex" = "claude-code",
) {
  const s = { ...emptySummary(agent, id), ...parts };
  const all = [...s.messages.map((m) => m.ts), ...s.prompts];
  s.firstTs = Math.min(...all);
  s.lastTs = Math.max(...all);
  return s;
}

describe("dedupeSessions", () => {
  test("重複が無ければ、要約も claims も変えない", () => {
    const a = session("a", { messages: [msg("m1", 10)], prompts: [5] });
    const b = session("b", { messages: [msg("m2", 20)], prompts: [15] });
    const claims = new Map<string, string>();
    const r = dedupeSessions([a, b], claims);
    expect(r.summaries).toEqual([a, b]);
    expect(r.dropped).toBe(0);
    expect(claims.size).toBe(0);
  });

  test("コピーした側から、重複した応答と、その時刻までの指示・完了・待ちを外し、claims に記録する", () => {
    const a = session("a", {
      messages: [msg("m1", 10), msg("m2", 20)],
      prompts: [5],
      turnEnds: [21],
    });
    const b = session("b", {
      messages: [msg("m1", 10), msg("m2", 20), msg("m3", 40)],
      prompts: [5, 30],
      turnEnds: [21, 41],
      humanWaits: [{ start: 12, end: 14, reason: "permission" }],
    });
    b.firstTs = 6; // コピーした側は、最初の時刻が後
    const claims = new Map<string, string>();
    const r = dedupeSessions([a, b], claims);
    expect(r.dropped).toBe(2);
    expect(r.summaries[0]).toBe(a);
    const nb = r.summaries[1];
    expect(nb.messages.map((m) => m.key)).toEqual(["m3"]);
    expect(nb.prompts).toEqual([30]);
    expect(nb.turnEnds).toEqual([41]);
    expect(nb.humanWaits).toEqual([]);
    expect(Object.fromEntries(claims)).toEqual({ "claude-code:m1": "a", "claude-code:m2": "a" });
  });

  test("最初の時刻が同じなら、最後の時刻が早いセッション（引き継いだ元）に数える", () => {
    const a = session("z-origin", { messages: [msg("m1", 10)], prompts: [5] });
    const b = session("a-copy", { messages: [msg("m1", 10), msg("m2", 50)], prompts: [5] });
    const r = dedupeSessions([b, a], new Map());
    expect(r.summaries[0].messages.map((m) => m.key)).toEqual(["m2"]);
    expect(r.summaries[1].messages.map((m) => m.key)).toEqual(["m1"]);
  });

  test("claims に記録した決定に従い、記録した側のログが無ければどちらにも数えない", () => {
    const a = session("a", { messages: [msg("m1", 10)], prompts: [5] });
    const b = session("b", { messages: [msg("m1", 10), msg("m2", 30)], prompts: [5] });
    const toB = dedupeSessions([a, b], new Map([["claude-code:m1", "b"]]));
    expect(toB.summaries[0].messages).toEqual([]);
    expect(toB.summaries[1].messages.map((m) => m.key)).toEqual(["m1", "m2"]);
    // 元のセッション a のログが消えた後も、コピーした b では数え直さない
    const gone = dedupeSessions([b], new Map([["claude-code:m1", "a"]]));
    expect(gone.summaries[0].messages.map((m) => m.key)).toEqual(["m2"]);
    expect(gone.dropped).toBe(1);
  });

  test("agent が違えば、同じ key でも重複として扱わない", () => {
    const a = session("a", { messages: [msg("m1", 10)] });
    const b = session("b", { messages: [msg("m1", 10)] }, "codex");
    const r = dedupeSessions([a, b], new Map());
    expect(r.dropped).toBe(0);
  });
});

describe("loadClaims", () => {
  test("セッションが文字列でない記録はエラーにする", () => {
    const dir = makeTempDir("agent-usage-claims-");
    const path = join(dir, "claims.json");
    writeFileSync(path, JSON.stringify({ "claude-code:m1": 1 }));
    expect(() => loadClaims(path)).toThrow(/claude-code:m1/);
    writeFileSync(path, JSON.stringify({ "claude-code:m1": "a" }));
    expect(loadClaims(path).get("claude-code:m1")).toBe("a");
  });
});

describe("summaryFromCache", () => {
  const base = () =>
    session("s", { messages: [msg("m1", 10)], prompts: [5], branches: [{ ts: 5, branch: "x" }] });

  test("JSON を通した要約を元に戻す（無限大は null になるので戻す）", () => {
    const s = base();
    expect(summaryFromCache(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const empty = emptySummary("codex", "e");
    expect(summaryFromCache(JSON.parse(JSON.stringify(empty)))).toEqual(empty);
  });

  test("トークン数が数でない・配列の欄が配列でない要約は読まない", () => {
    const badTokens = structuredClone(base());
    const tokens: Record<string, unknown> = badTokens.messages[0].tokens;
    tokens.output = "1";
    expect(summaryFromCache(badTokens)).toBeNull();
    const badList: Record<string, unknown> = structuredClone(base());
    badList.turnEnds = {};
    expect(summaryFromCache(badList)).toBeNull();
  });
});
