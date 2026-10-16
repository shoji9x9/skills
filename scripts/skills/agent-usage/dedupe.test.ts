// セッションをまたいだ重複の除去（dedupe.mjs）と、collect のキャッシュ（collect.mjs の collectLocal）。
//
// 入力の軸（dedupeSessions）:
//   重複           無い／2 つのセッションにある／agent が違う同じ key（重複ではない）。
//   残す側の決め方 最初の時刻が早い／同じなら最後の時刻が早い／claims に記録済み（後のセッションを指す・今は無いセッションを指す）。
//   外す側の事象   外した応答の最後の時刻まで（以前）と、その後。
//
// 入力の軸（collectLocal のキャッシュ）: 正しい要約・無限大を null にした要約・トークン数が数でない・配列でない欄・
//   読めないファイル・版の違い・このリポジトリでないセッションの判定の材料（読める・読めない・ルートが変わる）。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cachePath, collectLocal } from "../../../skills/agent-usage/scripts/lib/collect.mjs";
import { dedupeSessions, loadClaims } from "../../../skills/agent-usage/scripts/lib/dedupe.mjs";
import { zeroTokens } from "../../../skills/agent-usage/scripts/lib/pricing.mjs";
import { encodeProjectPath } from "../../../skills/agent-usage/scripts/lib/sources/discover.mjs";
import { emptySummary } from "../../../skills/agent-usage/scripts/lib/sources/session.mjs";
import { parseJsonAs } from "../../lib/parse-as.ts";
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

// キャッシュは collectLocal（run-collect.mjs が呼ぶ関数）を通して確かめる。キャッシュの形は内部の最適化で、
// 取り決めは「消しても結果は変わらない」ことと、指紋が同じセッションは解析し直さないこと（collect.mjs の冒頭）だけである。
// 解析し直した数（parsed）は collect の出力の「解析し直し N」に出る。
// テストが書き換える欄だけを型にする（キャッシュの形は collect.mjs の CacheEntry）。
type CachedSummary = Record<string, unknown> & {
  messages: (Record<string, unknown> & { tokens: Record<string, unknown> })[];
  turnEnds: unknown;
};
type CacheFile = {
  version: string;
  entries: Record<
    string,
    { fingerprint: unknown; summary: CachedSummary; probe: Record<string, unknown> | null }
  >;
};

describe("collectLocal のキャッシュ", () => {
  const T = (min: number) => `2026-10-01T00:${String(min).padStart(2, "0")}:00.000Z`;
  const ctx = {
    person: "p-00000001",
    tz: "UTC",
    repoPricing: {},
    bundledPricing: { "claude-opus-5-5": { input: 5, output: 25 } },
  };

  /** ルートと、そのルートで動いたセッションのログを 1 つ置く。 */
  function fixture(lines: object[], cwdOf: (root: string) => string = (root) => root) {
    const dir = makeTempDir("agent-usage-cache-");
    const root = join(dir, "repo");
    const projects = join(dir, "projects");
    const commonDir = join(dir, "git");
    mkdirSync(commonDir, { recursive: true });
    const cwd = cwdOf(root);
    const projectDir = join(projects, encodeProjectPath(cwd));
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "s1.jsonl"),
      lines.map((l) => JSON.stringify({ cwd, ...l })).join("\n"),
    );
    const collect = (roots = [root]) =>
      collectLocal({
        roots,
        remote: "",
        commonDir,
        env: { AGENT_USAGE_CLAUDE_PROJECTS: projects },
        ctx,
        useCache: true,
      });
    return { root, cwd, commonDir, projectDir, collect };
  }

  const session = [
    {
      type: "user",
      timestamp: T(1),
      gitBranch: "feature/5-x",
      origin: { kind: "human" },
      message: { role: "user", content: "やって" },
    },
    {
      type: "assistant",
      timestamp: T(2),
      gitBranch: "feature/5-x",
      message: {
        id: "m1",
        model: "claude-opus-5-5",
        usage: { input_tokens: 100, output_tokens: 20 },
        content: [],
      },
    },
    { type: "system", subtype: "turn_duration", timestamp: T(3) },
  ];

  test("2 回目はキャッシュを読んで解析し直さず、1 回目と同じ行を作る", () => {
    const f = fixture(session);
    const first = f.collect();
    expect(first.parsed).toBe(1);
    expect(first.sessions).toBe(1);
    expect(first.rows.length).toBeGreaterThan(0);
    const second = f.collect();
    expect(second.parsed).toBe(0);
    expect(second.rows).toEqual(first.rows);
    expect(second.prompts).toEqual(first.prompts);
  });

  test("時刻を持つ行が無いセッション（最初と最後の時刻が無限大）も、キャッシュから読み直せる", () => {
    // JSON にすると無限大は null になる。null を戻さないと、毎回解析し直す。
    // 時刻を持たない行だけのログは cwd も記録されないので、サブエージェントのファイルだけが残ったセッションにする
    // （ディレクトリ名が作業ツリーのパスと一致すれば対象になる。discover.mjs）。
    const f = fixture([]);
    const sub = join(f.projectDir, "s2", "subagents");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sub, "agent-a.jsonl"),
      JSON.stringify({ type: "user", message: { content: "x" } }),
    );
    expect(f.collect().sessions).toBe(1);
    const second = f.collect();
    expect(second.parsed).toBe(0);
    expect(second.sessions).toBe(1);
  });

  test.each([
    [
      "トークン数が数でない",
      (summary: CachedSummary) => {
        summary.messages[0].tokens.output = "1";
      },
    ],
    [
      "配列の欄が配列でない",
      (summary: CachedSummary) => {
        summary.turnEnds = {};
      },
    ],
    // 要約の各欄の「読めない」状態（知らない値・型の誤り・配列の要素の型の誤り）
    ["エージェントが知らない値", (summary: CachedSummary) => void (summary.agent = "other")],
    ["セッションの ID が文字列でない", (summary: CachedSummary) => void (summary.sessionId = 1)],
    [
      "サブエージェントの印が真偽値でない",
      (summary: CachedSummary) => void (summary.subagent = "no"),
    ],
    ["リモートが文字列でない", (summary: CachedSummary) => void (summary.repoUrl = null)],
    ["読めなかった行の数が数でない", (summary: CachedSummary) => void (summary.invalidLines = "0")],
    ["最初の時刻が数でも null でもない", (summary: CachedSummary) => void (summary.firstTs = "x")],
    [
      "ブランチの要素の時刻が数でない",
      (summary: CachedSummary) => void (summary.branches = [{ ts: "x", branch: "b" }]),
    ],
    [
      "応答の要素の model が文字列でない",
      (summary: CachedSummary) =>
        void (summary.messages = [{ key: "k", ts: 1, model: 1, tokens: {} }]),
    ],
    [
      "cost-state の要素の費用が数でない",
      (summary: CachedSummary) =>
        void (summary.costSnapshots = [{ ts: 1, models: { m: { costUSD: "x", tokens: {} } } }]),
    ],
    [
      "cost-state の要素の models が object でない",
      (summary: CachedSummary) => void (summary.costSnapshots = [{ ts: 1, models: null }]),
    ],
    [
      "人を待った区間の要素の理由が文字列でない",
      (summary: CachedSummary) => void (summary.humanWaits = [{ start: 1, end: 2, reason: 1 }]),
    ],
    [
      "コマンドの要素の本文が文字列でない",
      (summary: CachedSummary) => void (summary.commands = [{ ts: 1, text: null }]),
    ],
  ])("キャッシュの要約の%sなら、そのセッションをログから解析し直す", (_name, corrupt) => {
    const f = fixture(session);
    const first = f.collect();
    const path = cachePath(f.commonDir);
    const cache = parseJsonAs<CacheFile>(readFileSync(path, "utf8"));
    const entries = Object.values(cache.entries);
    expect(entries).toHaveLength(1);
    corrupt(entries[0].summary);
    writeFileSync(path, JSON.stringify(cache));
    const second = f.collect();
    expect(second.parsed).toBe(1);
    expect(second.rows).toEqual(first.rows);
  });

  test("読めないキャッシュのファイルと、版の違うキャッシュは使わずに解析し直す", () => {
    const f = fixture(session);
    const first = f.collect();
    const path = cachePath(f.commonDir);
    writeFileSync(path, "{ not json");
    expect(f.collect().parsed).toBe(1);
    const cache = parseJsonAs<CacheFile>(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...cache, version: "0" }));
    const third = f.collect();
    expect(third.parsed).toBe(1);
    expect(third.rows).toEqual(first.rows);
  });

  test("このリポジトリのセッションでなければ数えず、ルートが変わってこのリポジトリのものになったら解析し直す", () => {
    // ディレクトリ名がルートの名前で始まる別の作業ツリー（repo-other）のセッション
    const f = fixture(session, (root) => `${root}-other`);
    const outside = f.collect();
    expect(outside.sessions).toBe(0);
    expect(outside.parsed).toBe(1);
    // 判定の材料だけをキャッシュに置くので、同じルートなら解析し直さない
    const again = f.collect();
    expect(again.sessions).toBe(0);
    expect(again.parsed).toBe(0);
    // ルートにその作業ツリーを足すと、材料で判定し直して、解析し直す
    const widened = f.collect([f.root, f.cwd]);
    expect(widened.parsed).toBe(1);
    expect(widened.sessions).toBe(1);
  });

  test.each([
    ["cwd の一覧が配列でない", "cwds", "not a list"],
    ["エージェントが知らない値", "agent", "other"],
    ["セッションの ID が文字列でない", "sessionId", 1],
    ["サブエージェントの印が真偽値でない", "subagent", "no"],
    ["リモートが文字列でない", "repoUrl", null],
  ])("キャッシュの判定の材料の%sなら、解析し直す", (_name, field, value) => {
    const f = fixture(session, (root) => `${root}-other`);
    f.collect();
    const path = cachePath(f.commonDir);
    const cache = parseJsonAs<CacheFile>(readFileSync(path, "utf8"));
    const entries = Object.values(cache.entries);
    expect(entries).toHaveLength(1);
    const probe = entries[0].probe;
    expect(probe).not.toBeNull();
    if (probe) probe[field] = value;
    writeFileSync(path, JSON.stringify(cache));
    expect(f.collect().parsed).toBe(1);
  });

  test.each([
    [
      "要素が object でない",
      (cache: CacheFile, key: string) => void Reflect.set(cache.entries, key, 1),
    ],
    [
      "指紋が文字列でない",
      (cache: CacheFile, key: string) => void (cache.entries[key].fingerprint = 1),
    ],
  ])("キャッシュの要素の%sなら、そのセッションをログから解析し直す", (_name, corrupt) => {
    const f = fixture(session);
    const first = f.collect();
    const path = cachePath(f.commonDir);
    const cache = parseJsonAs<CacheFile>(readFileSync(path, "utf8"));
    const keys = Object.keys(cache.entries);
    expect(keys).toHaveLength(1);
    corrupt(cache, keys[0] ?? "");
    writeFileSync(path, JSON.stringify(cache));
    const second = f.collect();
    expect(second.parsed).toBe(1);
    expect(second.rows).toEqual(first.rows);
  });
});
