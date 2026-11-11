// 破壊的変更を書いた commit message が、このリポジトリの commitlint の設定を通ることを確かめる。
// あわせて、semantic-release の commit-analyzer が major と判定することを、release.config.ts と同じ preset と releaseRules で確かめる。
// 書き方の定義は docs/skill-development.md「配布スキルの破壊的変更」にある。
//
// commit-analyzer と @commitlint/lint・@commitlint/load は devDependencies に直接は無く、
// semantic-release と @commitlint/cli の依存として入る。pnpm はそれらを最上位の node_modules に置かないので、
// 依存元のパッケージの位置から解決する。
import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isArray } from "../../lib/is-array.ts";
import releaseConfig from "../../../release.config.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

/** `owner` パッケージの依存として入った `dep` を import し、`name` の関数を返す。 */
async function dependencyFunction(
  owner: string,
  dep: string,
  name: string,
): Promise<(...args: unknown[]) => Promise<unknown>> {
  const ownerDir = realpathSync(join(repoRoot, "node_modules", owner));
  const resolved = createRequire(join(ownerDir, "package.json")).resolve(dep);
  const module: unknown = await import(pathToFileURL(resolved).href);
  const fn = field(module, name);
  if (typeof fn !== "function") throw new Error(`${dep} に関数 ${name} が無い`);
  return async (...args) => {
    const result: unknown = await Reflect.apply(fn, undefined, args);
    return result;
  };
}

function analyzerConfig(): unknown {
  const plugin = releaseConfig.plugins.find(
    (p) => isArray(p) && p[0] === "@semantic-release/commit-analyzer",
  );
  if (!plugin) throw new Error("release.config.ts に @semantic-release/commit-analyzer が無い");
  return plugin[1];
}

// 解決と設定の読み込みはケースごとに変わらないので、1 回だけ行う。
const analyzeCommitsPromise = dependencyFunction(
  "semantic-release",
  "@semantic-release/commit-analyzer",
  "analyzeCommits",
);
const commitlintPromise = (async () => {
  const load = await dependencyFunction("@commitlint/cli", "@commitlint/load", "default");
  const lint = await dependencyFunction("@commitlint/cli", "@commitlint/lint", "default");
  const config = await load({}, { cwd: repoRoot });
  return { lint, config };
})();

async function releaseTypeOf(message: string): Promise<unknown> {
  const analyzeCommits = await analyzeCommitsPromise;
  return analyzeCommits(analyzerConfig(), {
    commits: [{ message, hash: "0".repeat(40) }],
    logger: { log() {}, error() {} },
    cwd: repoRoot,
  });
}

async function commitlint(message: string): Promise<{ valid: unknown; errorNames: unknown[] }> {
  const { lint, config } = await commitlintPromise;
  const result = await lint(message, field(config, "rules"), {
    parserOpts: field(field(config, "parserPreset"), "parserOpts"),
  });
  const errors = field(result, "errors");
  if (!isArray(errors)) throw new Error("commitlint の結果に errors の配列が無い");
  return { valid: field(result, "valid"), errorNames: errors.map((e) => field(e, "name")) };
}

test.each([
  ["1 行目の種別の後の !", "feat!: スキルの古いモードを消す"],
  ["scope の後の !", "feat(issue-start)!: スキルの古いモードを消す"],
  [
    "フッターの BREAKING CHANGE:",
    "fix: 設定のキーを改名する\n\nBREAKING CHANGE: 古いキーを新しいキーに書き換える",
  ],
  [
    "フッターの BREAKING-CHANGE:",
    "fix: 設定のキーを改名する\n\nBREAKING-CHANGE: 古いキーを新しいキーに書き換える",
  ],
])("%s は commitlint を通り、major と判定される", async (_name, message) => {
  expect(await commitlint(message)).toEqual({ valid: true, errorNames: [] });
  expect(await releaseTypeOf(message)).toBe("major");
});

test.each([
  ["feat", "feat: モードを足す", "minor"],
  ["fix", "fix: 判定の誤りを直す", "patch"],
  [
    "本文の途中に BREAKING CHANGE: と書いた行",
    "fix: 判定の誤りを直す\n\nこの修正は BREAKING CHANGE: に当たらない",
    "patch",
  ],
])("%s は major と判定されない", async (_name, message, expected) => {
  expect(await commitlint(message)).toEqual({ valid: true, errorNames: [] });
  expect(await releaseTypeOf(message)).toBe(expected);
});

test.each([
  ["行の先頭", "BREAKING CHANGE には当たらない"],
  ["行の先頭の空白の後", "  BREAKING CHANGE には当たらない"],
  ["行の先頭の * の後", "* BREAKING CHANGE には当たらない"],
])(
  "本文の%sに BREAKING CHANGE を置くと、コロンが無くても major と判定される",
  async (_name, line) => {
    const message = `fix: 判定の誤りを直す\n\n1 行目の説明\n${line}`;
    expect(await releaseTypeOf(message)).toBe("major");
  },
);

test("許可していない種別に ! を付けると、commitlint が止める（設定を読めていることの確認）", async () => {
  const result = await commitlint("build!: 依存を上げる");
  expect(result.valid).toBe(false);
  expect(result.errorNames).toContain("type-enum");
});
