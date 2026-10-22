import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { formatError as formatReuseError } from "./reuse-skill-eval-baseline.ts";
import {
  assertionsForEval,
  createFingerprint,
  formatError as formatFingerprintError,
  hashFixture,
  hashInstalledSkill,
  INSTALLED_SKILL_PARTS,
  requiredSkillsForEval,
} from "./skill-eval-fingerprint.ts";
import { parseJsonAs } from "../lib/parse-as.ts";
import { isRecord } from "../lib/guards.ts";
import { isArray } from "../lib/is-array.ts";
import {
  FINGERPRINT_CLI,
  type FingerprintOutput,
  here,
  REUSE_CLI,
  runCli,
  temporaryDirectories,
  temporaryDirectory,
  writeSkill,
} from "./skill-eval-fingerprint-helpers.ts";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

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

test("missing eval assertions are treated as a failure", () => {
  const directory = temporaryDirectory();
  const evals = join(directory, "evals.json");
  writeFileSync(evals, JSON.stringify({ evals: [{ id: 1 }] }), "utf8");
  expect(() => assertionsForEval(evals, "1")).toThrow(/no assertions array/u);
  expect(() => assertionsForEval(evals, "2")).toThrow(/not found/u);
});

// formatError の戻り値は、CLI が stderr に出す「<CLI 名>: <理由>」の理由の部分になる。
test.each([formatFingerprintError, formatReuseError])(
  "CLI error formatting preserves Error and non-Error diagnostics",
  (formatError) => {
    expect(formatError(new Error("failure"))).toBe("failure");
    expect(formatError("plain failure")).toBe("plain failure");
  },
);

const BASE_ARGS = [
  "--prompt",
  "p",
  "--executor",
  "codex",
  "--model",
  "m",
  "--reasoning-effort",
  "low",
  "--cli-version",
  "1",
  "--harness-version",
  "2",
];

// CLI の失敗は「<CLI 名>: <理由>」を stderr に出して exit 1 で終える（run-skill-eval.sh が読む）。
test.each([
  {
    label: "フラグの値が無い",
    script: FINGERPRINT_CLI,
    args: ["--prompt"],
    stderr: /^skill-eval-fingerprint: arguments must be --name value pairs$/mu,
  },
  {
    label: "必須の引数が無い",
    script: FINGERPRINT_CLI,
    args: ["--prompt", "p"],
    stderr: /^skill-eval-fingerprint: missing --executor$/mu,
  },
  {
    label: "引数が足りない",
    script: REUSE_CLI,
    args: ["only-source"],
    stderr: /^reuse-skill-eval-baseline: usage: reuse-skill-eval-baseline\.ts /mu,
  },
])(
  "CLI の失敗（$label）は、CLI 名と理由を stderr に出して exit 1 で終える",
  ({ script, args, stderr }) => {
    const result = runCli(script, args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(stderr);
  },
);

test("CLI は指紋の JSON を stdout に出し、入力に eval の assertion と fixture の hash を含める", () => {
  const directory = temporaryDirectory();
  const evals = join(directory, "evals.json");
  writeFileSync(evals, JSON.stringify({ evals: [{ id: 3, assertions: ["a"] }] }), "utf8");
  const fixture = join(directory, "fixture");
  mkdirSync(fixture);
  writeFileSync(join(fixture, "f.txt"), "x", "utf8");
  const result = runCli(FINGERPRINT_CLI, [
    ...BASE_ARGS,
    "--evals",
    evals,
    "--eval-id",
    "3",
    "--fixture",
    fixture,
  ]);
  expect(result.status).toBe(0);
  const output = parseJsonAs<FingerprintOutput>(result.stdout);
  expect(output.schema_version).toBe(1);
  expect(output.algorithm).toBe("sha256");
  expect(output.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  expect(output.inputs.assertions).toEqual(["a"]);
  expect(output.inputs.eval_id).toBe("3");
  expect(output.inputs.fixture_sha256).toBe(hashFixture(fixture));
  expect(output.inputs).not.toHaveProperty("required_skills");
});

test("requires_skills を宣言した eval は、兄弟のスキルの hash を指紋に入れ、--skills-root が無ければ失敗する", () => {
  const directory = temporaryDirectory();
  const evals = join(directory, "evals.json");
  writeFileSync(
    evals,
    JSON.stringify({ evals: [{ id: 1, assertions: ["a"], requires_skills: ["sib"] }] }),
    "utf8",
  );
  const skills = join(directory, "skills");
  writeSkill(skills, "sib", "v1\n");
  const args = [...BASE_ARGS, "--evals", evals, "--eval-id", "1", "--skill", "subject"];

  const missingRoot = runCli(FINGERPRINT_CLI, args);
  expect(missingRoot.status).toBe(1);
  expect(missingRoot.stderr).toMatch(/requires_skills needs --skills-root/u);

  const first = runCli(FINGERPRINT_CLI, [...args, "--skills-root", skills]);
  expect(first.status).toBe(0);
  const firstOutput = parseJsonAs<FingerprintOutput>(first.stdout);
  expect(firstOutput.inputs.required_skills).toEqual([
    { name: "sib", sha256: hashInstalledSkill(join(skills, "sib")) },
  ]);
  writeSkill(skills, "sib", "v2\n");
  const changed = parseJsonAs<FingerprintOutput>(
    runCli(FINGERPRINT_CLI, [...args, "--skills-root", skills]).stdout,
  );
  expect(changed.fingerprint).not.toBe(firstOutput.fingerprint);
});

test("--required-skills-of は、必要な兄弟のスキルを 1 行に 1 つ出す", () => {
  const directory = temporaryDirectory();
  const evals = join(directory, "evals.json");
  writeFileSync(
    evals,
    JSON.stringify({ evals: [{ id: 1, assertions: [], requires_skills: ["a-1", "b"] }] }),
    "utf8",
  );
  const result = runCli(FINGERPRINT_CLI, [
    "--required-skills-of",
    "subject",
    "--evals",
    evals,
    "--eval-id",
    "1",
  ]);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("a-1\nb\n");
});

test.each([
  ["空の配列", [], /must be a non-empty array/u],
  ["配列でない", "a", /must be a non-empty array/u],
  ["名前の形が不正", ["Bad_Name"], /invalid skill name: "Bad_Name"/u],
  ["名前が文字列でない", [1], /invalid skill name: 1/u],
  ["対象のスキル自身", ["subject"], /lists the subject skill itself: subject/u],
  ["重複", ["a", "a"], /lists a twice/u],
])("requires_skills が%sなら失敗する（名前を警告なしに捨てない）", (_label, names, error) => {
  const directory = temporaryDirectory();
  const evals = join(directory, "evals.json");
  writeFileSync(
    evals,
    JSON.stringify({ evals: [{ id: 1, assertions: [], requires_skills: names }] }),
    "utf8",
  );
  expect(() => requiredSkillsForEval(evals, "1", "subject")).toThrow(error);
});

test("requires_skills を持たない eval と eval id の無い実行は、兄弟のスキルを求めない", () => {
  const directory = temporaryDirectory();
  const evals = join(directory, "evals.json");
  writeFileSync(evals, JSON.stringify({ evals: [{ id: 1, assertions: [] }] }), "utf8");
  expect(requiredSkillsForEval(evals, "1", "subject")).toEqual([]);
  expect(requiredSkillsForEval(undefined, undefined, "subject")).toEqual([]);
  expect(assertionsForEval(undefined, undefined)).toEqual([]);
  expect(() => assertionsForEval(join(directory, "missing.json"), "1")).toThrow(
    /eval definition unavailable for eval 1/u,
  );
});

test("インストールするスキルの hash は、SKILL.md が無ければ失敗し、インストールする部分だけを見る", () => {
  const directory = temporaryDirectory();
  expect(() => hashInstalledSkill(join(directory, "none"))).toThrow(
    /required skill source not found/u,
  );
  writeSkill(directory, "s", "body\n");
  const initial = hashInstalledSkill(join(directory, "s"));
  mkdirSync(join(directory, "s", "evals"));
  writeFileSync(join(directory, "s", "evals", "evals.json"), "{}", "utf8");
  expect(hashInstalledSkill(join(directory, "s"))).toBe(initial);
  mkdirSync(join(directory, "s", "references"));
  writeFileSync(join(directory, "s", "references", "r.md"), "r", "utf8");
  expect(hashInstalledSkill(join(directory, "s"))).not.toBe(initial);
});

// gh skill install はスキルのディレクトリのすべてのファイルを配る。eval が一部しかコピーしないと、
// 配布先にはある同梱物（config-schemas/ など）が eval の中だけ欠け、スキルの手順が失敗する。
// git だけが読み、スキルの実行では読まないファイル。eval にコピーしなくても run は変わらない。
const NOT_READ_AT_RUN_TIME = new Set([".gitignore"]);
test("実リポジトリ: 配布スキルの直下の要素は、すべてインストールする部分に入っていて、ランナーも同じ部分をコピーする", () => {
  const skillsRoot = join(here, "..", "..", "skills");
  const names = readdirSync(skillsRoot);
  expect(names.length).toBeGreaterThan(0);
  const outside = names.flatMap((name) =>
    readdirSync(join(skillsRoot, name))
      .filter((entry) => !INSTALLED_SKILL_PARTS.includes(entry) && !NOT_READ_AT_RUN_TIME.has(entry))
      .map((entry) => `${name}/${entry}`),
  );
  expect(outside).toEqual([]);
  const runner = readFileSync(join(here, "run-skill-eval.sh"), "utf8");
  const loops = [...runner.matchAll(/for (?:subject_part|part) in ([^;]+); do/gu)].map((m) => m[1]);
  expect(loops).toHaveLength(2);
  for (const parts of loops) expect(parts.split(" ")).toEqual(INSTALLED_SKILL_PARTS);
});

// スキーマが挙げる環境変数（x-env と x-legacy.env）が開発者の環境にあると、eval の結果が起動した人で変わる。
test("実リポジトリ: ランナーが eval の前に消す環境変数は、スキルのスキーマの x-env と x-legacy.env の名前と一致する", () => {
  const skillsRoot = join(here, "..", "..", "skills");
  const schemaEnvNames = new Set<string>();
  for (const name of readdirSync(skillsRoot)) {
    const dir = join(skillsRoot, name, "config-schemas");
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const schema: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
      const env = isRecord(schema) && isRecord(schema["x-legacy"]) ? schema["x-legacy"].env : [];
      for (const e of isArray(env) ? env : [])
        if (isRecord(e) && typeof e.name === "string") schemaEnvNames.add(e.name);
      const props = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
      for (const prop of Object.values(props))
        if (isRecord(prop) && typeof prop["x-env"] === "string") schemaEnvNames.add(prop["x-env"]);
    }
  }
  expect(schemaEnvNames.size).toBeGreaterThan(0);
  const runner = readFileSync(join(here, "run-skill-eval.sh"), "utf8");
  const unsets = [...runner.matchAll(/^\s*unset ((?:[^\n]*\\\n)*[^\n]*)$/gmu)].map((m) =>
    m[1].replaceAll("\\\n", " ").trim().split(/\s+/u),
  );
  expect(unsets).toHaveLength(1);
  expect([...unsets[0]].sort()).toEqual([...schemaEnvNames].sort());
});

test("fixture の中のシンボリックリンクは、指紋にできないものとして失敗する", () => {
  const fixture = temporaryDirectory();
  writeFileSync(join(fixture, "target.txt"), "t", "utf8");
  symlinkSync("target.txt", join(fixture, "link"));
  expect(() => hashFixture(fixture)).toThrow(/fixture symlink is not fingerprintable: link/u);
});
