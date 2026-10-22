# 4. From issue to merge

Message: The flow that lets agents handle everything from filing an issue to merge, and how that flow records learnings and usage.

Skills: issue-create, issue-start, git-worktree, kaizen, agent-usage, pr-review-handle, pr-finalize-loop, issue-batch

The slides explain the skills in the order they run in the flow. kaizen and agent-usage run before commit, so they come before pr-review-handle and pr-finalize-loop, which run after the PR.
issue-batch runs the other skills together, so it comes last.

## Slides

1. The problem. Human approval becomes the bottleneck. If a person gives instructions or approval at every step (filing, starting, implementing, handling reviews, merge), the agent stops in between.
   Faster development does not reduce the time spent waiting for approval, so that waiting time sets the overall speed.
   Steps also get skipped (no link between the issue and the branch, resolving review threads without replying, and so on).
   Sources: step 7 of the basic flow in `skills/issue-start/SKILL.md`, the opening of `skills/pr-review-handle/SKILL.md`, `skills/issue-batch/SKILL.md` "prepare"
2. Overall flow (diagram). issue-create → issue-start (isolate in a worktree with git-worktree) → commit (kaizen and agent-usage record) → PR → pr-finalize-loop (handles reviews the same way
   as pr-review-handle) → merge.
   issue-batch runs this flow for several issues in order.
   Sources: `skills/issue-batch/SKILL.md` "前提" "run", `skills/kaizen/SKILL.md` "使い方", `skills/agent-usage/SKILL.md` "コミットの前の確認"
3. issue-create. Checks for duplicates, drafts the issue from the template, and files the issue after you approve.
   Sources: `skills/issue-create/SKILL.md` "基本フロー"
4. issue-start. Creates a branch linked to the issue with `gh issue develop`.
   It rechecks the scope written in the issue against the current code, and before push it matches each acceptance criterion against evidence.
   Modes (`--plan`, `--commit`, `--pr`, `--acceptance`) choose how much you hand over.
   Sources: `skills/issue-start/SKILL.md` "使い方" and steps 7, 8 and 10 of the basic flow
5. git-worktree. Creating a worktree alone does not isolate the work. Isolation holds once the session moves into it.
   It handles carrying files covered by `.gitignore`, excluding the worktree from checks, and cleanup after confirming the worktree is clean.
   Sources: the opening of `skills/git-worktree/SKILL.md` and "破ってはいけない前提"
6. Recorder 1: kaizen. When the pre-commit check finds candidate learnings, it stops the commit and prompts extraction.
   Learnings stay in `.kaizen/`, and `apply` reflects them into skills, rules, hooks and documentation. Learnings that go stale without being applied are forgotten automatically.
   Sources: `skills/kaizen/SKILL.md` "使い方" "基本原則"
7. Recorder 2: agent-usage. A pre-commit hook checks, per branch, whether to record usage.
   It records cost and activity (how long the agent kept working on one instruction, and idle time split into human review, CI wait, review wait and unused) and summarizes them in HTML and CSV.
   Sources: the opening of `skills/agent-usage/SKILL.md` and "コミットの前の確認"
8. pr-review-handle. Handles review comments in order: check, judge, fix (only when needed), reply, resolve.
   Sources: the opening of `skills/pr-review-handle/SKILL.md`
9. pr-finalize-loop. Loops on fixing CI failures and handling reviews until CI passes and no unresolved comments remain.
   You can choose who gets the re-review request (Copilot, Claude Code, Codex, local, none).
   It always stops at the iteration limit (5 by default). Only when reviewing locally with `/code-review`, after the limit is used up, it lowers the effort and adds half as many iterations.
   Sources: the opening of `skills/pr-finalize-loop/SKILL.md`, "レビューツールの選択", "反復の段階と effort", "停止条件"
10. issue-batch. `setup` sets the policy for unattended runs, `prepare` makes decisions in advance and records them in the issues, and `run` takes each issue to merge with its own worktree,
    branch and PR.
    It marks the work done only after confirming that the PR is merged, the issue is closed, the deployment succeeded and the branch is cleaned up.
    Like the slides for the other skills, add how to invoke.
    Sources: `skills/issue-batch/SKILL.md` "使い方" "モード" "最終報告"
11. Where people decide. A table with one row per skill.
    issue-create: approve the draft. issue-start: confirm the assignee, and approve dropping an acceptance criterion. git-worktree: decide the location and the files to carry in setup.
    kaizen: approve the learnings to record and the outputs to change (deletions too). agent-usage: decide whether to record.
    pr-review-handle: comments with more than one way to fix, and the re-review request. pr-finalize-loop: comments that need human judgment, and whether to continue on a PR that is not yours.
    issue-batch `run` does not ask during the run, so decisions are made in advance in `setup` and `prepare`, or left as pending decisions.
    Sources: `skills/issue-create/SKILL.md` "ルール", `skills/issue-start/SKILL.md` "追加確認が必要な条件" and step 10 of the basic flow,
    `skills/git-worktree/SKILL.md` "setup", `skills/kaizen/references/extract.md`, `references/apply.md`, `references/housekeeping.md`,
    `skills/agent-usage/SKILL.md` "コミットの前の確認", `skills/pr-review-handle/SKILL.md` "妥当性の判断ガイド" "レビュー対応後の再レビュー依頼",
    `skills/pr-finalize-loop/SKILL.md` "自律性ポリシー", `skills/issue-batch/SKILL.md` "モード" "安全制約"
12. Outputs. The issue, the linked branch, the table matching acceptance criteria against evidence, learnings in `.kaizen/`, records and summaries in `.agent-usage/`, and the PR.
    Sources: `skills/issue-start/SKILL.md` "commit / PR の扱い", `skills/kaizen/SKILL.md` "基本原則", `skills/agent-usage/SKILL.md` "使い方"
13. Related skills. Changes that affect the UI are checked with browser-test (Chapter 7). Titles and bodies are reread with writing-style (Chapter 3). kaizen applies learnings with
    multiagent-setup (Chapter 2).
    Sources: `skills/issue-batch/SKILL.md` "前提", `skills/kaizen/SKILL.md` "前提"
