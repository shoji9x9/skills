// check-doc-refs.test.ts のヘルパー（階層の原本と設定を持つ一時リポジトリを作り、見つけた違反を文字列にする）。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_PATH, checkDocRefs } from "./check-doc-refs.ts";
import { PENDING_PATH } from "../../lib/doc-scan.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { write } from "./repo-file-helpers.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const script = join(repoRoot, "scripts/gates/docs/check-doc-refs.ts");

const TIERS = readFileSync(join(repoRoot, "scripts/gates/docs/doc-tiers.json"), "utf8");
export const CONFIG = {
  repo: "o/r",
  generated: [
    { ref: "gaps.md", skills: ["s"], template: "skills/s/assets/gaps-template.md" },
    { ref: "other.md", skills: ["t"], template: "skills/s/assets/gaps-template.md" },
  ],
};

/** 階層の原本・設定・参照先を持つ一時リポジトリ。 */
export function makeRepo(
  files: Record<string, string> = {},
  { config = CONFIG, pending }: { config?: object; pending?: object } = {},
) {
  const root = makeTempDir("doc-refs-");
  const all = {
    "scripts/gates/docs/doc-tiers.json": TIERS,
    [CONFIG_PATH]: JSON.stringify(config),
    "AGENTS.md": "# Agents\n",
    "docs/guide.md":
      "# ガイド\n\n## 手順（補足）\n\n## 7. 定期実行\n\n- **規則は「要素」に付ける。** 本文\n\n| 列 | 値 |\n| --- | --- |\n| データ不足 | x |\n",
    "skills/s/SKILL.md": "# S\n",
    "skills/s/references/ref.md": "# Ref\n\n## 参照の節\n",
    "skills/s/assets/gaps-template.md": "# Gaps\n\n## 特性化できなかった箇所\n",
    ...files,
  };
  for (const [p, t] of Object.entries(all)) write(root, p, t);
  if (pending) write(root, PENDING_PATH, JSON.stringify(pending));
  const r = spawnSync("git", ["init", "-q"], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: root,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return root;
}

/** 見つけた違反（ファイル・行番号・規則・文字列）。 */
export const found = (root: string) =>
  checkDocRefs(root).found.map((v) => `${v.file}:${v.line} ${v.rule} ${v.text}`);
