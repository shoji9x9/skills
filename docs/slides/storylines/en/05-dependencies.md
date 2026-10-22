# 5. Dependency updates and vulnerabilities

Message: Handle dependency updates and vulnerabilities.

Skills: dependabot-merge, dependabot-alert-issue

## Slides

1. The problem. Even when CI passes, a minor update of a 0.x package or a major update can contain breaking changes. Later, nobody can trace why the PR was merged.
   Filing one issue per vulnerability alert creates many issues, and the ones that cannot be fixed right away stay stuck.
   Sources: the opening of `skills/dependabot-merge/SKILL.md`, the opening of `skills/dependabot-alert-issue/SKILL.md`
2. dependabot-merge. Confirm the CI required checks passed → read the impact on the code that uses the package from the changelog and release notes → comment the decision and reasons on the
   PR → merge.
   `--all` processes every open Dependabot PR in order. Invoke it with `dependabot-merge <PR>` or `dependabot-merge --all`.
   Sources: the opening of `skills/dependabot-merge/SKILL.md`, "使い方", "基本フロー（単一 PR）"
3. Deciding whether to merge. What to check and how to handle it differ for `>=1.0` minor and patch updates, 0.x, and major updates. If CI has not passed, none of them is merged.
   Sources: `skills/dependabot-merge/SKILL.md` "マージ可否の判断ガイド"
4. dependabot-alert-issue. Apply the configured `ignore` and `dismiss`, and skip alerts that already have an issue or PR → classify and group the rest by whether work can start right away →
   run the drafts and the dismiss candidates after approval.
   Besides Dependabot alerts, it also accepts external audit results as input. Invoke it with `dependabot-alert-issue`.
   Sources: the opening of `skills/dependabot-alert-issue/SKILL.md`, "使い方", "基本フロー", "外部 audit findings 入力"
5. Splitting by whether work can start right away. For alerts where work cannot start yet (no fixed version, too few days since release, a parent dependency pins the version), the issue
   states the condition under which work can start.
   Alerts where work can start are grouped by severity, and the others by package and fixed version.
   Sources: `skills/dependabot-alert-issue/SKILL.md` "着手可否の判定" "グルーピング"
6. Configuration. The configuration file holds the merge method (`merge_method`), the minimum number of days from release to starting work (`minimum_release_age_days`), and the conditions
   for ignore and dismiss.
   Sources: `skills/dependabot-merge/SKILL.md` "セットアップ（マージ方式の選択）", `skills/dependabot-alert-issue/SKILL.md` "セットアップ（特別処理・リリース年齢の設定）"
7. Where people decide. When the changelog does not show whether a change is breaking, when a change affects the code that uses the package and needs a code fix, when the impact is large or
   information is missing, and when approving issue drafts and dismissals.
   Sources: `skills/dependabot-merge/SKILL.md` "追加確認が必要な条件", steps 7 and 8 of `skills/dependabot-alert-issue/SKILL.md` "基本フロー"
8. Outputs. The decision record left on the PR, the merged PR, issues that resolve vulnerabilities, and dismissed alerts with their reasons.
   Sources: `skills/dependabot-merge/SKILL.md` "判断の記録（PR コメント）", step 9 of `skills/dependabot-alert-issue/SKILL.md` "基本フロー"
9. Related skills. Work on filed issues starts with issue-start (Chapter 4). Issue titles and bodies, and the decision record on the PR, are reread with writing-style (Chapter 3).
   Sources: the opening of `skills/dependabot-alert-issue/SKILL.md`, the steps in `skills/dependabot-merge` and `skills/dependabot-alert-issue` that refer to writing-style
