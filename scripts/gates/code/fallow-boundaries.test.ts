// 参照の向き（`.config/fallow/base.jsonc` の boundaries）の回帰テスト。
//
// 参照の向きは、oxlint の JS プラグインの規則から fallow の boundaries に移した。規則の実装はツールにあるので、
// このテストは設定（ゾーンと許可する向き）を確かめる。生成した実物の `.fallowrc.json` を一時ディレクトリに置き、
// 実物の fallow（`fallow architecture`）を当てる。ゾーンのパターンや許可する向きを変えて規則が緩むと、ここで失敗する。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                                         |
// | -------------- | ------------------------------------------------------------------------------------------ |
// | 参照する側     | scripts/lib / scripts/<分類> / 配布スキル                                                   |
// | 参照される側   | 同じゾーン / scripts/lib / 別の scripts/<分類> / 配布スキル / 別の配布スキル / 自分の雛形 / 別のスキルの雛形 |
// | 参照の書き方   | import / export from / import() / import type                                              |
import { spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { write } from "../../lib/testing/repo-file.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** fallow の boundaries の違反を「参照する側 -> 参照される側」の一覧で返す。 */
function violations(files: Record<string, string>): string[] {
  const root = makeTempDir("fallow-boundaries-");
  copyFileSync(join(ROOT, ".fallowrc.json"), join(root, ".fallowrc.json"));
  write(root, "package.json", JSON.stringify({ name: "fixture", type: "module" }));
  for (const [p, t] of Object.entries(files)) write(root, p, t);
  const res = spawnSync(
    "pnpm",
    ["exec", "fallow", "architecture", "--root", root, "--quiet", "--format", "compact"],
    { cwd: ROOT, encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
  );
  if (res.error) throw res.error;
  // 違反があれば 1、無ければ 0。それ以外は判定できないので、0 件として扱わない。
  expect([0, 1], res.stderr).toContain(res.status);
  return res.stdout
    .split("\n")
    .filter((l) => l.startsWith("boundary-violation:"))
    .map((l) => l.split(":")[3] ?? "")
    .sort();
}

test("scripts/lib は scripts/ の他の分類を参照しない。配布スキルと雛形は参照してよい", () => {
  expect(
    violations({
      "scripts/lib/a.ts": [
        'import { g } from "../gates/g.ts";',
        'import { s } from "../../skills/x/scripts/s.mjs";',
        'import { t } from "../../skills/x/assets/t.mjs";',
        'import { b } from "./b.ts";',
        "export const a = g + s + t + b;",
        "",
      ].join("\n"),
      "scripts/lib/b.ts": "export const b = 1;\n",
      "scripts/gates/g.ts": "export const g = 1;\n",
      "skills/x/scripts/s.mjs": "export const s = 1;\n",
      "skills/x/assets/t.mjs": "export const t = 1;\n",
    }),
  ).toEqual(["scripts/lib/a.ts -> scripts/gates/g.ts (lib -> scripts/gates)"]);
});

test("scripts/<分類> は別の分類を、どの書き方でも参照しない。scripts/lib と配布スキルは参照してよい", () => {
  expect(
    violations({
      "scripts/gates/g.ts": [
        'import { e1 } from "../eval/e1.ts";',
        'export { e2 } from "../eval/e2.ts";',
        'const e3 = await import("../eval/e3.ts");',
        'import type { E4 } from "../eval/e4.ts";',
        'import { l } from "../lib/l.ts";',
        'import { s } from "../../skills/x/scripts/s.mjs";',
        'import { h } from "./h.ts";',
        "export const g: E4 = e1 + e3.e3 + l + s + h;",
        "",
      ].join("\n"),
      "scripts/gates/h.ts": "export const h = 1;\n",
      "scripts/eval/e1.ts": "export const e1 = 1;\n",
      "scripts/eval/e2.ts": "export const e2 = 1;\n",
      "scripts/eval/e3.ts": "export const e3 = 1;\n",
      "scripts/eval/e4.ts": "export type E4 = number;\n",
      "scripts/lib/l.ts": "export const l = 1;\n",
      "skills/x/scripts/s.mjs": "export const s = 1;\n",
    }),
  ).toEqual(
    ["e1", "e2", "e3", "e4"].map(
      (e) => `scripts/gates/g.ts -> scripts/eval/${e}.ts (scripts/gates -> scripts/eval)`,
    ),
  );
});

test("配布スキルは自分のディレクトリの外（別の配布スキル・その雛形・scripts/）を参照しない。自分の雛形は参照してよい", () => {
  expect(
    violations({
      "skills/x/scripts/a.mjs": [
        'import { b } from "../../y/scripts/b.mjs";',
        'import { yt } from "../../y/assets/yt.mjs";',
        'import { l } from "../../../scripts/lib/l.ts";',
        'import { h } from "./lib/h.mjs";',
        'import { t } from "../assets/t.mjs";',
        "export const a = b + yt + l + h + t;",
        "",
      ].join("\n"),
      "skills/x/scripts/lib/h.mjs": "export const h = 1;\n",
      "skills/x/assets/t.mjs": "export const t = 1;\n",
      "skills/y/scripts/b.mjs": "export const b = 1;\n",
      "skills/y/assets/yt.mjs": "export const yt = 1;\n",
      "scripts/lib/l.ts": "export const l = 1;\n",
    }),
  ).toEqual([
    "skills/x/scripts/a.mjs -> scripts/lib/l.ts (skills/x -> lib)",
    "skills/x/scripts/a.mjs -> skills/y/assets/yt.mjs (skills/x -> skills/y)",
    "skills/x/scripts/a.mjs -> skills/y/scripts/b.mjs (skills/x -> skills/y)",
  ]);
});
