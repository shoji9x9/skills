// このリポジトリはエージェントスキル（SKILL.md・evals・スクリプト・ドキュメント）を管理する。
// 使うコミット種別の唯一の定義。commitlint（type-enum）と semantic-release（releaseRules）が
// 共有し、二重定義を避ける。実際に使う種別だけを列挙する（build / perf / style / revert は使わない）。
//
//   feat     新しいスキルや機能の追加
//   fix      スキル・スクリプト・設定の不具合修正
//   docs     SKILL.md / AGENTS.md / README などのドキュメント
//   refactor 挙動を変えないスキル指示・スクリプトの整理
//   test     evals・ベンチマーク（tests/, evals.json）の追加・更新
//   ci       GitHub Actions などワークフローの変更
//   chore    依存更新・lint/フック設定・.gitignore・kaizen 記録などの保守
export const types = ["feat", "fix", "docs", "refactor", "test", "ci", "chore"];

// skills/** の変更がどの種別でも publish されるよう、各種別に最低リリースを割り当てる。
// feat は minor、それ以外は patch。破壊的変更（`!` / BREAKING CHANGE）は major。
// 破壊的変更を最優先で判定するため breaking ルールを先頭に置く（type ルールに先にマッチして
// minor/patch へ落ちるのを防ぐ）。`!` 記法の検出には release.config.js 側で
// preset: "conventionalcommits" の指定が必要（angular 既定では `!` を検出しない）。
export const releaseRules = [
  { breaking: true, release: "major" },
  ...types.map((type) => ({
    type,
    release: type === "feat" ? "minor" : "patch",
  })),
];
