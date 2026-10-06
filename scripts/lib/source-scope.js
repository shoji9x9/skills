// lint と整形の対象から外す、エージェント用のコピーとリンクを決める。
//
// `.agents/` には、コピーと実体が一緒に置かれている。
// - コピー: インストール済みの配布スキル（`.agents/skills/<name>/`。`skills/<name>/` と同じ中身）
// - 実体: rule（`.agents/rules/`）と、配布しない private skill（`skills/` に無い `.agents/skills/<name>/`）
// `.agents/` を丸ごと除くと実体も lint されなくなる。除外は対象が見えなくなるだけで何も失敗しないので、
// 気づけない（実際に private skill のスクリプトが lint も整形もされていなかった）。
//
// コピーかどうかは `skills/<name>/` が在るかで決める。`.private-skill` の印では決めない。
// 印を付け忘れた private skill も、コピーと判定されずに lint の対象に残る（見落とす側と判定されてしまうことはない）。
//
// リンク（`.claude/rules/`・`.claude/skills/` と、rule へのリンクの `.github/instructions/`）は、リンク先の実体を
// lint するので除く。`.claude/` を丸ごと除かないのは、`.claude/settings.json` が実体だから。
// lefthook と markdownlint-cli2 は設定ファイルにパターンを書くので、ここで計算した集合と一致するかを
// `scripts/gates/lint-scope.test.js` が確かめる。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const LINK_DIRS = [".claude/rules", ".claude/skills", ".github/instructions"];

/** `.agents/skills/` の下のディレクトリ名のうち、`skills/` に同名の実体があるもの（コピー）。 */
export function copySkillNames(root) {
  const dir = join(root, ".agents/skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, "skills", e.name)))
    .map((e) => e.name)
    .sort();
}

/** `.agents/skills/` の下のディレクトリ名のうち、コピーでないもの（private skill の実体）。 */
export function sourceSkillNames(root) {
  const dir = join(root, ".agents/skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !existsSync(join(root, "skills", e.name)))
    .map((e) => e.name)
    .sort();
}

/** 除外するパターン（ディレクトリごとに `<dir>/**`）。oxlint・oxfmt の ignorePatterns に渡す。 */
export function agentCopyGlobs(root) {
  return [
    ...LINK_DIRS.map((d) => `${d}/**`),
    ...copySkillNames(root).map((n) => `.agents/skills/${n}/**`),
  ];
}

/** リポジトリ相対パス rel が、エージェント用のコピーかリンクの中にあるか。 */
export function isAgentCopy(root, rel) {
  if (LINK_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) return true;
  const m = /^\.agents\/skills\/([^/]+)\//.exec(rel);
  return m !== null && existsSync(join(root, "skills", m[1]));
}
