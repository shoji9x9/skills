// replace-strategy の保留の状態の検査（pending-decisions-check.mjs）の回帰テスト（Issue #462）。
//
// 保留は「決まった（resolution あり）」と「済んだ（blocks の工程まで実施した）」が別の状態なのに、
// resolution の有無だけで数えると、「方針は A。実施は後で」の回答で blocks の工程が行われないまま完了になる。
//
// 陽性コントロール（実施の記録・置き場・blocks 空の保留が exit 0）を置く——これが無いと「常に落とす」実装と区別できない。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "vitest";
import {
  main,
  classifyDecision,
  checkPendingDecisions,
} from "../skills/replace-strategy/scripts/pending-decisions-check.mjs";
import { makeTempDir } from "./lib/test-tmpdir.js";

const ANSWERED = { answer: "案 A", answered_at: "2026-09-24T10:00:00Z" };

/**
 * 保留 1 件を組み立てる。差し替えたいキーだけ渡す。
 * @param {Record<string, unknown>} [override]
 */
function decision(override = {}) {
  return {
    id: "pd-1",
    question: "q",
    cause: "c",
    options: ["A", "B"],
    recommendation: null,
    evidence: [],
    blocks: ["受け入れ条件 X の test target 分"],
    raised_at: "2026-09-24T09:00:00Z",
    resolution: null,
    ...override,
  };
}

/**
 * CLI を直接呼ぶ。
 * @param {string[]} argv
 * @param {string} cwd
 */
function run(argv, cwd) {
  let stdout = "";
  let stderr = "";
  const code = main(argv, {
    cwd,
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr, json: stdout ? JSON.parse(stdout) : null };
}

test("回答が付いただけで blocks の工程を実施していない保留は未解決として落とす", () => {
  expect(classifyDecision(decision({ resolution: ANSWERED })).state).toBe("decided");
  const work = makeTempDir("pending-decisions-");
  writeFileSync(
    join(work, "p.json"),
    JSON.stringify({ pending_decisions: [decision({ resolution: ANSWERED })] }),
  );
  const r = run(["--file", "p.json"], work);
  expect(r.code).toBe(1);
  expect(r.json.unsettled).toHaveLength(1);
  expect(r.json.unsettled[0].state).toBe("decided");
  expect(r.json.counts).toEqual({ total: 1, in_scope: 1, open: 0, decided: 1, settled: 0 });
});

test("resolution が null の保留は未解決として落とす", () => {
  expect(classifyDecision(decision()).state).toBe("open");
  const result = checkPendingDecisions({ pending_decisions: [decision()] });
  expect(result.structural).toBe(false);
  expect(result.unsettled.map((u) => u.state)).toEqual(["open"]);
});

test("陽性コントロール: 実施の記録・置き場・blocks 空の保留は済んだと数える", () => {
  const work = makeTempDir("pending-decisions-");
  writeFileSync(
    join(work, "p.json"),
    JSON.stringify({
      pending_decisions: [
        decision({
          id: "pd-1",
          resolution: {
            ...ANSWERED,
            resumed: { at: "2026-09-24T11:00:00Z", evidence: ["pnpm test → exit 0"] },
          },
        }),
        decision({
          id: "pd-2",
          resolution: { ...ANSWERED, follow_up: { what: "test target 分", tracked_in: "#500" } },
        }),
        decision({ id: "pd-3", blocks: [], resolution: ANSWERED }),
      ],
    }),
  );
  const r = run(["--file", "p.json"], work);
  expect(r.code).toBe(0);
  expect(r.json.counts.settled).toBe(3);
  // 置き場へ回した保留は見えるように残す（黙って済んだ側に消さない）。
  expect(r.json.tracked).toEqual([{ id: "pd-2", tracked_in: "#500" }]);
});

test("実施の記録に証拠が無い・置き場に残作業が無いものは済んだと数えない", () => {
  expect(
    classifyDecision(
      decision({
        resolution: { ...ANSWERED, resumed: { at: "2026-09-24T11:00:00Z", evidence: [] } },
      }),
    ).state,
  ).toBe("decided");
  expect(
    classifyDecision(decision({ resolution: { ...ANSWERED, resumed: { evidence: ["x"] } } })).state,
  ).toBe("decided");
  expect(
    classifyDecision(
      decision({ resolution: { ...ANSWERED, follow_up: { what: "", tracked_in: "#500" } } }),
    ).state,
  ).toBe("decided");
  expect(
    classifyDecision(
      decision({ resolution: { ...ANSWERED, follow_up: { what: "残作業", tracked_in: null } } }),
    ).state,
  ).toBe("decided");
});

test("blocks が欠落した保留は工程があるものとして扱う（空とみなさない）", () => {
  const { blocks: _omit, ...rest } = decision({ resolution: ANSWERED });
  expect(classifyDecision(rest).state).toBe("decided");
});

test("回答として読めない resolution は未解決に倒す", () => {
  expect(classifyDecision(decision({ resolution: true })).state).toBe("open");
  expect(classifyDecision(decision({ resolution: {} })).state).toBe("open");
  expect(classifyDecision(decision({ resolution: { answer: "A" } })).state).toBe("open");
});

test("フェーズ B は slug × target で絞り、slugs の無い要素は同じ target の全 slug を止める", () => {
  const doc = {
    pending_decisions: [
      decision({ id: "other-slug", phase: "b", slugs: ["x"], target: "dev" }),
      decision({ id: "other-target", phase: "b", slugs: ["plan"], target: "stg" }),
      decision({ id: "phase-a", phase: "a" }),
      decision({ id: "no-slugs", phase: "b", target: "dev" }),
      decision({ id: "hit", phase: "b", slugs: ["plan", "x"], target: "dev" }),
    ],
  };
  const result = checkPendingDecisions(doc, { phase: "b", slug: "plan", target: "dev" });
  expect(result.structural).toBe(false);
  expect(result.unsettled.map((u) => u.id)).toEqual(["no-slugs", "hit"]);
});

test("--mode setup は mode の欠落した要素を setup として止める", () => {
  const doc = {
    pending_decisions: [
      decision({ id: "issues", mode: "issues" }),
      decision({ id: "missing" }),
      decision({ id: "setup", mode: "setup" }),
    ],
  };
  const result = checkPendingDecisions(doc, { mode: "setup" });
  expect(result.structural).toBe(false);
  expect(result.unsettled.map((u) => u.id)).toEqual(["missing", "setup"]);
});

test("記録先のファイルが無いのは保留なしで、無かったことを出力に残す", () => {
  const work = makeTempDir("pending-decisions-");
  const r = run(["--file", "absent.json"], work);
  expect(r.code).toBe(0);
  expect(r.json.file_exists).toBe(false);
});

test("pending_decisions が配列でない・JSON でない入力は exit 2", () => {
  const work = makeTempDir("pending-decisions-");
  writeFileSync(join(work, "no-array.json"), JSON.stringify({ run: {} }));
  writeFileSync(join(work, "broken.json"), "{");
  expect(run(["--file", "no-array.json"], work).code).toBe(2);
  expect(run(["--file", "broken.json"], work).code).toBe(2);
  expect(run(["--file", "x.json", "--phase", "b"], work).code).toBe(2);
});

test.each([
  "replace-strategy/assets/strategy-pending-template.json",
  "golden-dataset/assets/pending-decisions-template.json",
  "parity-suite/assets/pending-decisions-template.json",
  "parity-replace/assets/pending-decisions-template.json",
])("同梱テンプレートのプレースホルダのまま提出した保留は未解決として落とす: %s", (path) => {
  const doc = JSON.parse(readFileSync(new URL(`../skills/${path}`, import.meta.url), "utf8"));
  const result = checkPendingDecisions(doc);
  expect(result.structural).toBe(false);
  expect(result.unsettled.length).toBeGreaterThan(0);
});
