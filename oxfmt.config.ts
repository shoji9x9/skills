import { defineConfig } from "oxfmt";
import { agentCopyGlobs } from "./scripts/lib/source-scope.js";

export default defineConfig({
  // エージェント用のコピーとリンクだけを除く。.agents/ を丸ごと除くと rule と private skill の実体も外れる。
  ignorePatterns: agentCopyGlobs(import.meta.dirname),
});
