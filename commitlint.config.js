import { types } from "./commit-types.js";

// 許可するコミット種別は commit-types.js を単一の真実とする（二重定義を避ける）。
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", types],
    // subject の先頭大文字（固有名詞: GitHub / JSON 等）や日本語 subject を許可する。
    "subject-case": [0],
  },
};
