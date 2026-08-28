import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const repository = resolve(import.meta.dirname, "..");
const fixturesRoot = join(repository, "skills", "issue-start", "evals", "fixtures");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function prepareFixture(name) {
  const directory = mkdtempSync(join(tmpdir(), `issue-start-${name}-`));
  temporaryDirectories.push(directory);
  cpSync(join(fixturesRoot, name), directory, { recursive: true });
  execFileSync(join(directory, "setup.sh"), { cwd: directory, stdio: "pipe" });
  execFileSync(join(directory, "setup.sh"), { cwd: directory, stdio: "pipe" });
  return directory;
}

function git(directory, ...args) {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}

test("behind fixture separates default main from one-commit-ahead PR base develop", () => {
  const directory = prepareFixture("pr-base-behind");

  expect(git(directory, "branch", "--show-current")).toBe("feature/12-example");
  expect(git(directory, "rev-list", "--count", "HEAD..origin/develop")).toBe("1");
  expect(git(directory, "rev-list", "--count", "HEAD..origin/main")).toBe("0");
  expect(git(directory, "log", "-1", "--format=%s", "origin/develop")).toBe(
    "feat: advance integration branch",
  );
});

test("current fixture puts PR base develop fully behind feature HEAD", () => {
  const directory = prepareFixture("pr-base-current");

  expect(git(directory, "branch", "--show-current")).toBe("feature/12-example");
  expect(git(directory, "rev-list", "--count", "HEAD..origin/develop")).toBe("0");
});

test("fetch-failure fixture has no usable remote PR base and fetch fails", () => {
  const directory = prepareFixture("pr-base-fetch-failure");
  const fetchResult = spawnSync("git", ["fetch", "origin", "develop"], {
    cwd: directory,
    encoding: "utf8",
  });

  expect(fetchResult.status).not.toBe(0);
  expect(
    spawnSync("git", ["rev-parse", "--verify", "origin/develop"], { cwd: directory }).status,
  ).not.toBe(0);
});

test("all pre-push evals map to a fixture and do not state the expected outcome", () => {
  const evals = JSON.parse(
    readFileSync(join(repository, "skills", "issue-start", "evals", "evals.json"), "utf8"),
  ).evals.filter(({ id }) => [2, 9, 10, 11].includes(id));

  expect(evals).toHaveLength(4);
  expect(evals.map(({ fixture }) => fixture)).toEqual([
    "evals/fixtures/pr-base-behind",
    "evals/fixtures/pr-base-behind",
    "evals/fixtures/pr-base-current",
    "evals/fixtures/pr-base-fetch-failure",
  ]);
  for (const evaluation of evals) {
    expect(evaluation.prompt).not.toMatch(/未取り込み.*(?:0|1)\s*件/u);
    expect(evaluation.prompt).not.toMatch(/(?:main|develop).*比較対象/u);
  }
});
