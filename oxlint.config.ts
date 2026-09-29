import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc"],
  categories: {
    correctness: "error",
  },
  ignorePatterns: [".agents/**", ".claude/**"],
  rules: {},
  env: {
    builtin: true,
  },
});
