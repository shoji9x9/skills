// aws-architecture-diagram の環境レジストリ解決の回帰テスト（Issue #198）。
//
// render-diagram.mjs はレジストリを environments.mjs 決め打ちで読んでいたため、
// `"type": "module"` のプロジェクトが規約通り .js で置くと ERR_MODULE_NOT_FOUND になり、
// 「レジストリの中身を間違えた」と誤診しやすかった。解決規則（.mjs 優先 → .js フォールバック →
// どちらも無ければ候補を示すエラー）を、図ディレクトリを実際に作って実測する。
// 解決はスクリプト冒頭の top-level await で走るため、import ではなく子プロセスで検証する。

import { test, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(repoRoot, "skills/aws-architecture-diagram");
const renderScript = join(skillDir, "assets/engine/render-diagram.mjs");
const iconDir = join(skillDir, "assets/starter/icons");

const createdDirs = [];
afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 環境名だけが違う最小のレジストリ（どちらの拡張子が読まれたかを出力ファイル名で弁別する）。 */
const registry = (envName) => `
export const baseSpec = {
  W: 400,
  H: 200,
  title: "t",
  nodes: [
    { id: "a", icon: null, label: ["A"], x: 100, y: 100 },
    { id: "b", icon: null, label: ["B"], x: 300, y: 100 },
  ],
  edges: [{ from: "a", to: "b" }],
  groups: [],
};
export const environments = { ${envName}: { title: "t" } };
`;

/**
 * files（ファイル名 → 内容）を置いた図ディレクトリを作る。
 *
 * `package.json` の `"type": "module"` を必ず置く。Issue #198 が対象にしているのは
 * まさにその設定を持つプロジェクトであり、fixture 側もその前提を明示しておく
 * （Node の module 構文検出に暗黙に頼ると、何を再現しているのかが読めなくなる）。
 */
function diagramDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "diagram-registry-"));
  createdDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

/** レンダリングを子プロセスで実行し、終了コードと stderr まで見えるようにする。 */
function render(dir) {
  const result = spawnSync(process.execPath, [renderScript], {
    env: {
      ...process.env,
      DIAGRAM_DIR: dir,
      DIAGRAM_ICON_DIR: iconDir,
      DIAGRAM_OUT_DIR: join(dir, "out"),
    },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return result;
}

test("環境レジストリが environments.js でも読める", () => {
  const dir = diagramDir({ "environments.js": registry("fromjs") });
  expect(render(dir).status).toBe(0);
  expect(readdirSync(join(dir, "out"))).toEqual(["architecture-fromjs.svg"]);
});

test("environments.mjs は environments.js より優先され、無視した方を警告する", () => {
  const dir = diagramDir({
    "environments.mjs": registry("frommjs"),
    "environments.js": registry("fromjs"),
  });
  const { status, stderr } = render(dir);
  // 既存プロジェクトの挙動を変えない（.mjs が勝つ）。
  expect(status).toBe(0);
  expect(readdirSync(join(dir, "out"))).toEqual(["architecture-frommjs.svg"]);
  // 黙って捨てると「編集したのに反映されない」に化けるため、捨てた方を必ず名指しする。
  expect(stderr).toContain("environments.js");
  expect(stderr).toContain("無視");
});

test("どちらも無いときは候補を示すエラーで止まる（ERR_MODULE_NOT_FOUND にしない）", () => {
  const { status, stderr } = render(diagramDir({}));
  expect(status).not.toBe(0);
  expect(stderr).toContain("環境レジストリが見つかりません");
  expect(stderr).toContain("environments.mjs");
  expect(stderr).toContain("environments.js");
  expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
});
