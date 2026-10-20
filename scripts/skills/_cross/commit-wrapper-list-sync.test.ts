import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// git commit の前に置かれるラッパー（timeout・sudo など）の一覧は、kaizen の kaizen-precommit-gate.sh と
// agent-usage の gate.mjs が別々に持つ（Issue #678）。配布スキルは単独で動くので共有できない。
// 片方だけに足すと、同じ commit を一方は止め、もう一方は記録しない。そこで、2 つの一覧が同じ集合であることを確かめる。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 抽出が空や途中で終わっていないことを確かめるための、両方に必ずあるラッパー。 */
const KNOWN = ["timeout", "sudo", "xargs", "exec"];

function kaizenWrappers(): string[] {
  const text = readFileSync(
    join(repoRoot, "skills/kaizen/scripts/kaizen-precommit-gate.sh"),
    "utf8",
  );
  const matches = [...text.matchAll(/^wrappers='\(([a-z|]+)\)'$/gm)];
  expect(matches, "kaizen の wrappers= の行").toHaveLength(1);
  return matches[0][1].split("|");
}

function agentUsageWrappers(): string[] {
  const text = readFileSync(join(repoRoot, "skills/agent-usage/scripts/lib/gate.mjs"), "utf8");
  const start = text.indexOf("const COMMAND_WRAPPERS = new Map([");
  expect(start, "gate.mjs の COMMAND_WRAPPERS").toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n]);", start);
  expect(end, "COMMAND_WRAPPERS の終わり").toBeGreaterThan(start);
  return [...text.slice(start, end).matchAll(/\[\s*"([a-z]+)",\s*\{/g)].map((m) => m[1]);
}

test("kaizen と agent-usage のラッパーの一覧が同じ集合である", () => {
  const kaizen = kaizenWrappers();
  const agentUsage = agentUsageWrappers();
  for (const name of KNOWN) {
    expect(kaizen, `kaizen に ${name}`).toContain(name);
    expect(agentUsage, `agent-usage に ${name}`).toContain(name);
  }
  expect(new Set(kaizen).size, "kaizen の重複").toBe(kaizen.length);
  expect(new Set(agentUsage).size, "agent-usage の重複").toBe(agentUsage.length);
  expect([...kaizen].sort()).toEqual([...agentUsage].sort());
});
