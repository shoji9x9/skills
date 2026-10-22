# 10. Repository practices

Message: Autonomous development by agents, the mechanisms that keep quality, and security.

## Slides

1. Repository size. List the file and line counts for Source, Tests and Fixtures, and show that the line counts of Tests and Fixtures are close to Source.
   Add what is not counted (installed copies, records, generated files and configuration) and where the per-skill breakdown lives (`docs/slides/repo-size.md`).
   The counted commit is the same commit shown on the cover of Chapter 1.
   Sources: the output of `scripts/tools/repo-size.ts`
2. Autonomous development. This repository itself is developed with the skills from Chapter 4. File an issue (issue-create) → implement (issue-start, issue-batch) → converge
   (pr-finalize-loop) → merge after the required checks pass.
   Sources: `AGENTS.md` "ワークフロー" "ブランチ運用"
3. Do not rely on probabilistic behavior. Agent behavior is probabilistic, so what must be followed is not left to instructions alone and is moved as far as possible into deterministic tool behavior.
   For example, CI and pre-commit checks verify the conventions. textlint and a response hook detect words not to use. A pre-commit hook prompts extracting learnings.
   Deterministic tools detect differences between the current app and the new app, and an engine draws architecture diagrams.
   Sources: `skills/kaizen/SKILL.md` "基本原則", `AGENTS.md` "確かめ方", `docs/tooling.md` "文章のチェック", the opening of `skills/parity-diff/SKILL.md`, the opening of `skills/aws-architecture-diagram/SKILL.md`
4. Learning from failures. kaizen extracts learnings from failures and addresses the root cause. Following the approach in 3, it prefers deterministic checks (linters, hooks, scripts) as the
   place to apply them. Learnings live in `.kaizen/`, and every agent reads them.
   Sources: `skills/kaizen/SKILL.md` "基本原則", `.kaizen/`
5. Sharing across agents. Claude Code, Codex and GitHub Copilot read the same skills, rules and documentation (this repository uses the structure from Chapter 2 too).
   Sources: the opening of `AGENTS.md` and "ディレクトリ構造"
6. Quality: tests. Regression evals per skill, mutation testing, and per-file coverage thresholds confirm that the tests can detect errors in skills and scripts. Expected values come from
   the specification.
   Sources: `docs/skill-development.md` "回帰テストを実行する", `docs/testing.md` "期待値は仕様から決める" "カバレッジ" "ミューテーションテスト"
7. Quality: cross-cutting checks. pre-commit and CI check document tiers and references, statements that become wrong over time, consistency with installed copies, the skill index, and the
   directory structure.
   Sources: the `Lint` job in `.github/workflows/ci.yml`, `lefthook.yml`, `docs/tooling.md`
8. Quality: writing. textlint checks the writing rules in documents, and a Stop hook checks them in responses to people (this repository applies the rules from Chapter 3 too). Rules that
   depend on meaning are not linted, and people check them.
   Sources: `docs/tooling.md` "文章のチェック", `docs/writing-style.md`
9. Security. gitleaks scans for secrets, pinact pins GitHub Actions to SHAs, and ghalint and actionlint check the workflows.
   The lockfile and registry signatures are verified, and the skills from Chapter 5 file issues for dependency vulnerabilities. A ruleset protects `main`, and merge requires the required
   checks to pass.
   Sources: `.github/workflows/ci.yml`, `lefthook.yml`, `AGENTS.md` "ブランチ運用" "脆弱性対応"
10. Summary. Return to how the skills fit together from Chapter 1 and lay out the chapters. When published, each chapter's box links to that chapter's slides.
