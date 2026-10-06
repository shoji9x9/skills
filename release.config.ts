import { releaseRules } from "./commit-types.ts";

// preset: "conventionalcommits" は、`!` 記法で破壊的変更を検出するのに必要（angular のデフォルトでは検出しない）。
// releaseRules は commit-types.ts から導出する（許可種別と publish 対象を一致させる）。
// commit-analyzer は --dry-run で次バージョンの算出にのみ使う（タグ／Release は gh skill publish が作る）。
export default {
  branches: ["main"],
  plugins: [["@semantic-release/commit-analyzer", { preset: "conventionalcommits", releaseRules }]],
};
