// このリポジトリの oxlint の JS プラグイン（oxlint.config.ts の jsPlugins が読む）。
// 組み込みのルールで表せない規約だけを置く。ルールの名前は `skills-repo/<ルール>` で指す。
import { importDirection } from "./import-direction.ts";
import { maxLinesExceptDescribe } from "./max-lines-except-describe.ts";
import { maxLinesExceptPageEntry } from "./max-lines-except-page-entry.ts";

export default {
  meta: { name: "skills-repo" },
  rules: {
    "import-direction": importDirection,
    "max-lines-per-function-except-describe": maxLinesExceptDescribe,
    "max-lines-per-function-except-page-entry": maxLinesExceptPageEntry,
  },
};
