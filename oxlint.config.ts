import { defineConfig } from "oxlint";
import { agentCopyGlobs } from "./scripts/lib/source-scope.js";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc"],
  categories: {
    correctness: "error",
  },
  // エージェント用のコピーとリンクだけを除く。.agents/ を丸ごと除くと rule と private skill の実体も外れる。
  ignorePatterns: agentCopyGlobs(import.meta.dirname),
  rules: {},
  env: {
    builtin: true,
  },
});
