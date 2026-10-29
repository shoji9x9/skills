// check-doc-refs.test.ts のヘルパー（階層の原本と設定を持つ一時リポジトリを作り、見つけた違反を文字列にする）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_PATH, checkDocRefs } from "./check-doc-refs.ts";
import { ALLOWED_PATH } from "../../lib/doc-scan.ts";
import { TIERS_PATH } from "./doc-tiers.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { gitInit, REPO_ROOT, write } from "../../lib/testing/repo-file.ts";

export const script = join(REPO_ROOT, "scripts/gates/docs/check-doc-refs.ts");

const TIERS = readFileSync(join(REPO_ROOT, TIERS_PATH), "utf8");
export const CONFIG = {
  repo: "o/r",
  generated: [
    { ref: "gaps.md", skills: ["s"], template: "skills/s/assets/gaps-template.md" },
    { ref: "other.md", skills: ["t"], template: "skills/s/assets/gaps-template.md" },
  ],
  repo_files: { sources: [".github/", "docs/"], allowed: [] },
};

/** 階層の原本・設定・参照先を持つ一時リポジトリ。 */
export function makeRepo(
  files: Record<string, string> = {},
  { config = CONFIG, allowed }: { config?: object; allowed?: object } = {},
) {
  const root = makeTempDir("doc-refs-");
  const all = {
    [TIERS_PATH]: TIERS,
    [CONFIG_PATH]: JSON.stringify(config),
    "AGENTS.md": "# Agents\n",
    "docs/guide.md":
      "# ガイド\n\n## 手順（補足）\n\n## 7. 定期実行\n\n- **規則は「要素」に付ける。** 本文\n\n| 列 | 値 |\n| --- | --- |\n| データ不足 | x |\n",
    "skills/s/SKILL.md": "# S\n",
    "skills/s/references/ref.md": "# Ref\n\n## 参照の節\n",
    "skills/s/assets/gaps-template.md": "# Gaps\n\n## 特性化できなかった箇所\n",
    ".github/workflows/outdated.yml": "name: outdated\n",
    ...files,
  };
  for (const [p, t] of Object.entries(all)) write(root, p, t);
  if (allowed) write(root, ALLOWED_PATH, JSON.stringify(allowed));
  gitInit(root);
  return root;
}

/** 見つけた違反（ファイル・行番号・規則・文字列）。 */
export const found = (root: string) =>
  checkDocRefs(root).found.map((v) => `${v.file}:${v.line} ${v.rule} ${v.text}`);
