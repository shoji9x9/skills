import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { assertionsForEval, createFingerprint, hashFixture } from "./skill-eval-fingerprint.js";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "skill-eval-fingerprint-"));
  temporaryDirectories.push(directory);
  return directory;
}

test("fingerprint is insensitive to object key order but changes for input mutations", () => {
  const left = createFingerprint({ prompt: "same", nested: { model: "m", executor: "codex" } });
  const reordered = createFingerprint({
    nested: { executor: "codex", model: "m" },
    prompt: "same",
  });
  const mutated = createFingerprint({
    nested: { executor: "codex", model: "other" },
    prompt: "same",
  });
  expect(left.fingerprint).toBe(reordered.fingerprint);
  expect(left.fingerprint).not.toBe(mutated.fingerprint);
});

test("canonical object keys use locale-independent codepoint order", () => {
  const fingerprint = createFingerprint({ nested: { あ: 4, z: 2, ä: 3, A: 1 } });
  expect(Object.keys(fingerprint.inputs.nested)).toEqual(["A", "z", "ä", "あ"]);
});

test("fixture hash covers relative paths, bytes, and executable mode", () => {
  const fixture = temporaryDirectory();
  mkdirSync(join(fixture, "nested"));
  const script = join(fixture, "nested", "setup.sh");
  writeFileSync(script, "exit 0\n", "utf8");
  const initial = hashFixture(fixture);
  chmodSync(script, 0o755);
  expect(hashFixture(fixture)).not.toBe(initial);
  const executable = hashFixture(fixture);
  writeFileSync(script, "exit 1\n", "utf8");
  expect(hashFixture(fixture)).not.toBe(executable);
});

test("assertions are selected by eval id and their mutation changes the fingerprint", () => {
  const directory = temporaryDirectory();
  const evals = join(directory, "evals.json");
  writeFileSync(evals, JSON.stringify({ evals: [{ id: 7, assertions: ["first"] }] }), "utf8");
  const before = createFingerprint({ assertions: assertionsForEval(evals, "7") });
  writeFileSync(evals, JSON.stringify({ evals: [{ id: 7, assertions: ["changed"] }] }), "utf8");
  expect(createFingerprint({ assertions: assertionsForEval(evals, "7") }).fingerprint).not.toBe(
    before.fingerprint,
  );
});

test("missing eval assertions fail closed", () => {
  const directory = temporaryDirectory();
  const evals = join(directory, "evals.json");
  writeFileSync(evals, JSON.stringify({ evals: [{ id: 1 }] }), "utf8");
  expect(() => assertionsForEval(evals, "1")).toThrow(/no assertions array/u);
  expect(() => assertionsForEval(evals, "2")).toThrow(/not found/u);
});
