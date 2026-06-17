import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // テストはスクリプトのユニットテストのみ（node_modules は既定で除外）。
    include: ["scripts/**/*.test.js"],
    environment: "node",
  },
});
