// aws-architecture-diagram の render-diagram.mjs の、環境の選び方と spec の解決のテスト。
//
// 確かめる状態は次のとおりである。
//   - --env: 無い（全環境）/ `--env a` / `--env=a,b` / 値が無い / 次が別のフラグ / 区切りだけで名前が 0 件 / 未知の名前
//   - 環境の spec: transform が無い（base に環境の title）/ transform が title を付ける / 付け忘れる（環境の title、
//     それも無ければ base の title）/ transform が base を書き換える（他の環境に影響しない）
//   - 書き出し: 後の環境が規約違反で止まったら、先の環境の SVG も書き出さない
//   - 同梱の見本（samples/the-simple-webservice）: spec から生成した図が、commit してある SVG と一致する
// レジストリの探し方（.mjs と .js）は render-diagram-registry.test.ts が確かめる。

import { expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const skillDir = join(repoRoot, "skills/aws-architecture-diagram");
const renderScript = join(skillDir, "scripts/render-diagram.mjs");
const starterIcons = join(skillDir, "assets/starter/icons");
const sampleDir = join(skillDir, "assets/samples/the-simple-webservice");

/** 2 ノードを水平につなぐ base。environments の本体は envs に書く（JavaScript の式）。 */
const registry = (envs: string) => `
export const baseSpec = {
  W: 400,
  H: 200,
  title: "BASE",
  nodes: [
    { id: "a", icon: null, label: ["A"], x: 100, y: 100 },
    { id: "b", icon: null, label: ["B"], x: 300, y: 100 },
  ],
  edges: [{ from: "a", to: "b" }],
  groups: [],
};
export const environments = ${envs};
`;

function diagramDir(envs: string): string {
  const dir = makeTempDir("diagram-cli-");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(dir, "environments.mjs"), registry(envs));
  return dir;
}

/** 場所は CLI のオプションで渡す。extra は後ろに付けるので、同じオプションを上書きする。 */
function render(dir: string, args: string[], extra: string[] = []) {
  const cwd = makeTempDir("diagram-cli-cwd-");
  const result = spawnSync(
    process.execPath,
    [
      renderScript,
      ...args,
      "--dir",
      dir,
      "--icon-dir",
      starterIcons,
      "--out-dir",
      join(dir, "out"),
      ...extra,
    ],
    {
      // 手元の設定ファイルを読まないよう、git の外の一時ディレクトリで実行し、人ごとの設定の置き場所も一時ディレクトリにする
      cwd,
      env: { ...process.env, XDG_CONFIG_HOME: join(cwd, "xdg") },
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    },
  );
  if (result.error) throw result.error;
  return result;
}

const outFiles = (dir: string) =>
  existsSync(join(dir, "out")) ? readdirSync(join(dir, "out")).sort() : [];
const titleOf = (dir: string, env: string) =>
  readFileSync(join(dir, "out", `architecture-${env}.svg`), "utf8").match(
    /font-weight="700" fill="#16191F">([^<]*)</,
  )?.[1];

const threeEnvs = `{ prod: { title: "P" }, stg: { title: "S" }, local: { title: "L" } }`;

test("--env を省くと全環境を書き出し、書いたファイルを表示する", () => {
  const dir = diagramDir(threeEnvs);
  const { status, stdout } = render(dir, []);
  expect(status).toBe(0);
  expect(outFiles(dir)).toEqual([
    "architecture-local.svg",
    "architecture-prod.svg",
    "architecture-stg.svg",
  ]);
  expect(stdout).toContain(`wrote ${join(dir, "out", "architecture-prod.svg")}`);
});

test.each([
  ["--env stg", ["--env", "stg"], ["architecture-stg.svg"]],
  ["--env=prod,local", ["--env=prod,local"], ["architecture-local.svg", "architecture-prod.svg"]],
  [
    "--env ' prod , ,stg '（空白と空の要素は捨てる）",
    ["--env", " prod , ,stg "],
    ["architecture-prod.svg", "architecture-stg.svg"],
  ],
])("%s は指定した環境だけを書き出す", (_label, args, expected) => {
  const dir = diagramDir(threeEnvs);
  expect(render(dir, args).status).toBe(0);
  expect(outFiles(dir)).toEqual(expected);
});

test.each([
  ["値が無い", ["--env"]],
  ["次が別のフラグ", ["--env", "--verbose"]],
  ["区切りだけで名前が 0 件", ["--env", ", ,"]],
  ["= の後が空", ["--env="]],
])("--env の%sときは、全環境として扱わずエラーにする", (_label, args) => {
  const dir = diagramDir(threeEnvs);
  const { status, stderr } = render(dir, args);
  expect(status).not.toBe(0);
  expect(stderr).toContain("--env には環境名を指定してください");
  expect(outFiles(dir)).toEqual([]);
});

test("未知の環境名は、定義済みの環境を示すエラーにする", () => {
  const dir = diagramDir(threeEnvs);
  const { status, stderr } = render(dir, ["--env", "dev"]);
  expect(status).not.toBe(0);
  expect(stderr).toContain("未知の環境: dev（定義済み: prod, stg, local）");
  expect(outFiles(dir)).toEqual([]);
});

test("図の title は、transform の title・環境の title・base の title の順に決まる", () => {
  const dir = diagramDir(`{
    own: { title: "ENV", transform: (s) => ({ ...s, title: "FROM-TRANSFORM" }) },
    forgot: { title: "ENV-FORGOT", transform: (s) => ({ ...s, title: undefined }) },
    bare: { transform: (s) => ({ ...s, title: undefined }) },
    plain: { title: "PLAIN" },
    none: {},
  }`);
  expect(render(dir, []).status).toBe(0);
  expect(titleOf(dir, "own")).toBe("FROM-TRANSFORM");
  expect(titleOf(dir, "forgot")).toBe("ENV-FORGOT");
  expect(titleOf(dir, "bare")).toBe("BASE");
  expect(titleOf(dir, "plain")).toBe("PLAIN");
  expect(titleOf(dir, "none")).toBe("BASE");
});

test("transform が base を書き換えても、他の環境の図は変わらない", () => {
  // first が受け取った spec のノード a のラベルを書き換える。base を共有していれば second にも出る。
  const dir = diagramDir(`{
    first: { transform: (s) => { s.nodes[0].label = ["MUTATED"]; return s; } },
    second: { transform: (s) => s },
  }`);
  expect(render(dir, []).status).toBe(0);
  const first = readFileSync(join(dir, "out", "architecture-first.svg"), "utf8");
  const second = readFileSync(join(dir, "out", "architecture-second.svg"), "utf8");
  expect(first).toContain("MUTATED");
  expect(second).not.toContain("MUTATED");
  expect(second).toContain(">A<");
});

test("後の環境が規約違反で止まったら、先の環境の SVG も書き出さない", () => {
  // bad は a->b のエッジを重複させる（エンジンが「重複エッジ」で止める）。
  const dir = diagramDir(`{
    good: {},
    bad: { transform: (s) => ({ ...s, edges: [...s.edges, { from: "a", to: "b" }] }) },
  }`);
  const { status, stderr } = render(dir, []);
  expect(status).not.toBe(0);
  expect(stderr).toContain("重複エッジ: a->b");
  expect(outFiles(dir)).toEqual([]);
});

test("同梱の見本は、spec から生成した図が commit してある SVG と一致する（アイコンの中身を除く）", () => {
  // AWS のアイコンは commit していない（README）。同じ名前の仮のアイコンを置いて生成し、
  // 埋め込んだアイコンの中身と viewBox だけを比べる対象から外す。配置・線・ラベルは spec で決まる。
  const work = makeTempDir("diagram-sample-");
  const icons = join(work, "icons");
  mkdirSync(join(icons, "aws-icons"), { recursive: true });
  for (const name of readdirSync(join(sampleDir, "icons")).filter((f) => f.endsWith(".svg"))) {
    copyFileSync(join(sampleDir, "icons", name), join(icons, name));
  }
  for (const id of ["api-gateway", "lambda", "dynamodb"]) {
    writeFileSync(join(icons, "aws-icons", `${id}.svg`), '<svg viewBox="0 0 64 64"><rect/></svg>');
  }
  const { status, stderr } = render(
    sampleDir,
    [],
    ["--icon-dir", icons, "--out-dir", join(work, "out")],
  );
  expect(stderr).toBe("");
  expect(status).toBe(0);
  expect(readdirSync(join(work, "out"))).toEqual(["architecture-prod.svg"]);
  const withoutIcons = (svg: string) =>
    svg.replace(
      /<svg x="([^"]+)" y="([^"]+)" [^>]*overflow="visible">[\s\S]*?<\/svg>/g,
      "<icon $1 $2>",
    );
  const committed = withoutIcons(readFileSync(join(sampleDir, "architecture-prod.svg"), "utf8"));
  const generated = withoutIcons(readFileSync(join(work, "out", "architecture-prod.svg"), "utf8"));
  // アイコンが 4 つ（browser と AWS の 3 つ）埋め込まれていることを先に確かめ、置き換えが当たっていることを示す。
  expect(committed.match(/<icon /g)).toHaveLength(4);
  expect(generated).toBe(committed);
});

test("リポジトリの設定の diagram_dir・icon_dir・out_dir を、リポジトリのルートからの相対パスとして読む", () => {
  const repo = makeTempDir("diagram-config-");
  execFileSync("git", ["init", "-q"], { cwd: repo, timeout: CHILD_TIMEOUT_MS });
  const dir = join(repo, "docs", "diagrams");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(dir, "environments.mjs"), registry(`{ prod: { title: "P" } }`));
  mkdirSync(join(repo, ".config", "skills", "shoji9x9"), { recursive: true });
  writeFileSync(
    join(repo, ".config", "skills", "shoji9x9", "aws-architecture-diagram.jsonc"),
    JSON.stringify({
      diagram_dir: "docs/diagrams",
      icon_dir: starterIcons,
      out_dir: "build/diagrams",
    }),
  );
  // サブディレクトリから実行しても、リポジトリのルートを基準に読む
  const sub = join(repo, "src");
  mkdirSync(sub);
  const r = spawnSync(process.execPath, [renderScript], {
    cwd: sub,
    env: { ...process.env, XDG_CONFIG_HOME: join(repo, "xdg") },
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(readdirSync(join(repo, "build", "diagrams"))).toEqual(["architecture-prod.svg"]);
});

test("使わなくなった環境変数 DIAGRAM_DIR が残っていれば、移行の手順を示して 1 で止める", () => {
  const dir = diagramDir(threeEnvs);
  const { status, stderr } = render(dir, [], []);
  expect(status).toBe(0);
  const cwd = makeTempDir("diagram-cli-cwd-");
  const r = spawnSync(process.execPath, [renderScript, "--dir", dir], {
    cwd,
    env: { ...process.env, XDG_CONFIG_HOME: join(cwd, "xdg"), DIAGRAM_DIR: dir },
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(stderr).toBe("");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("環境変数 DIAGRAM_DIR は使わなくなった。");
});
