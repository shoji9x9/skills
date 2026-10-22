// skill-config.test.ts のヘルパー。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const COPIES = readdirSync(join(repoRoot, "skills"))
  .sort()
  .map((name) => `skills/${name}/scripts/skill-config/skill-config.mjs`)
  .filter((p) => existsSync(join(repoRoot, p)));

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tool: {
      enum: ["a", "b"],
      default: "a",
      "x-layers": ["repo", "local", "user"],
      "x-env": "T_TOOL",
    },
    method: { type: "string", "x-layers": ["repo"] },
    count: {
      type: "integer",
      minimum: 1,
      maximum: 9,
      "x-layers": ["repo", "user"],
      "x-env": "T_COUNT",
    },
    flag: { type: "boolean", "x-layers": ["repo"], "x-env": "T_FLAG" },
    name: { type: "string", minLength: 2, pattern: "^[a-z]+$", "x-layers": ["repo"] },
    mode: { const: "x", "x-layers": ["repo"] },
    list: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id"],
        additionalProperties: false,
        properties: { id: { type: "string" }, v: { type: "number" } },
      },
      "x-layers": ["repo"],
    },
    map: { type: "object", additionalProperties: { type: "integer" }, "x-layers": ["repo"] },
    open: { type: "object", "x-layers": ["repo"] },
    either: { anyOf: [{ type: "integer" }, { const: "never" }], "x-layers": ["repo"] },
    one: { oneOf: [{ type: "number" }, { type: "integer" }], "x-layers": ["repo"] },
    nested: {
      type: "object",
      additionalProperties: false,
      properties: { inner: { type: "object", properties: { x: { type: "integer" } } } },
      "x-layers": ["repo"],
    },
  },
  "x-legacy": {
    files: [
      { path: "{root}/.old/config", steps: "old を移す" },
      { path: "{user_config_home}/old/config.json", steps: "人の old を移す" },
    ],
    env: [{ name: "T_OLD", steps: "T_OLD を移す" }],
  },
};

export type Env = Record<string, string | undefined>;

/** git のリポジトリと、スキーマのディレクトリと、人ごとの設定の置き場所を作る。 */
export function setup(schema: unknown = SCHEMA) {
  const base = makeTempDir("skill-config-");
  const root = join(base, "repo");
  mkdirSync(root);
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: CHILD_TIMEOUT_MS });
  const schemaDir = join(base, "schemas");
  mkdirSync(schemaDir);
  writeFileSync(join(schemaDir, "t.schema.json"), JSON.stringify(schema));
  const xdg = join(base, "xdg");
  const env: Env = { XDG_CONFIG_HOME: xdg, HOME: join(base, "home") };
  const repoDir = join(root, ".config/skills/shoji9x9");
  const paths = {
    repo: join(repoDir, "t.jsonc"),
    local: join(repoDir, "t.local.jsonc"),
    user: join(xdg, "skills/shoji9x9/t.jsonc"),
  };
  const write = (layer: keyof typeof paths, text: string) => {
    mkdirSync(dirname(paths[layer]), { recursive: true });
    writeFileSync(paths[layer], text);
  };
  const ignoreLocal = () =>
    writeFileSync(join(root, ".gitignore"), "/.config/skills/shoji9x9/*.local.jsonc\n");
  return { base, root, schemaDir, env, paths, write, ignoreLocal };
}

type Cli = (
  argv: string[],
  env: Env,
  cwd: string,
) => Promise<{ code: number; out: string; err: string }>;

/** 人ごとの層を読まないときの validate と paths の出力を確かめる。 */
export async function expectUserLayerIgnored(
  cli: Cli,
  s: ReturnType<typeof setup>,
  args: string[],
) {
  // 人ごとの層を読まないときは、読んでいない人ごとのファイルを検証したものとして並べない
  s.write("user", '{ "bogus": 1 }');
  const ignored = await cli(
    ["validate", "t", ...args],
    { ...s.env, SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: "1" },
    s.root,
  );
  expect(ignored).toMatchObject({
    code: 0,
    out: `ok: t の設定はスキーマに合う（repo=${s.paths.repo}）\n`,
  });
  expect(ignored.err).toMatch(/人ごとの層（.*）を読まない/);
  // 人ごとの層を読まないときは、paths も人ごとの層のパスを出さず、読まないことを stderr に出す
  const ignoredPaths = await cli(
    ["paths", "t", ...args],
    { ...s.env, SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: "1" },
    s.root,
  );
  expect(ignoredPaths).toMatchObject({
    code: 0,
    out: `local=${s.paths.local}\nrepo=${s.paths.repo}\n`,
  });
  expect(ignoredPaths.err).toMatch(/note: 人ごとの層（.*）を読まない/);
}
