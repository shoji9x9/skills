import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // テストはスクリプトのユニットテストのみ（node_modules は既定で除外）。
    include: ["scripts/**/*.test.js"],
    environment: "node",
    // 収集より前に、異常終了で残った使い捨て fixture を掃く（理由はスクリプト内のコメント）。
    globalSetup: ["scripts/vitest-global-setup.js"],
  },
});
