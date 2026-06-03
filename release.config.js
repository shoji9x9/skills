import { releaseRules } from "./commit-types.js";

// preset: "conventionalcommits" は `!` 記法の破壊的変更検出に必要（angular 既定では未検出）。
// releaseRules は commit-types.js から導出する（許可種別と publish 対象を一致させる）。
// commit-analyzer は --dry-run で次バージョンの算出にのみ使う（タグ／Release は gh skill publish が作る）。
export default {
  branches: ["main"],
  plugins: [
    ["@semantic-release/commit-analyzer", { preset: "conventionalcommits", releaseRules }],
  ],
};
