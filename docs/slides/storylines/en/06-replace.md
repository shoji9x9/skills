# 6. Replacement without changing behavior

Message: The flow that measures the current app, applies the same pass/fail criteria to the current app and the new app, and replaces it.

Skills: replace-strategy, current-environment-bootstrap, golden-dataset, parity-component, parity-suite, parity-replace, parity-diff, spec-parity

## Slides

1. The problem. In a replacement without changing behavior, it is tempting to judge whether the behavior is the same from guesses or design documents. Design documents do not always match
   how the current app behaves today.
   When you ask a model to find differences between the screens of the current app and the new app, it misses small differences such as spacing, color and font.
   Sources: `skills/replace-strategy/SKILL.md` "厳守の制約（禁止事項）", the opening of `skills/parity-diff/SKILL.md`
2. Approach. Capture the behavior of the current app as evidence (capture), reproduce it with a different implementation (reproduce), and confirm there are zero differences (confirm). Repeat
   this as a loop.
   Sources: the opening of `skills/replace-strategy/SKILL.md`
3. Style policy. The `style_policy` value in replace-strategy decides which skills check features with screens.
   `reproduce` (the default) also matches the appearance, and parity-suite and parity-diff compare the screens of both apps.
   `free` matches only UI behavior (actions, states, roles, text, API), and the appearance only needs to look right to people. spec-parity checks only the new app and does not compare screens.
   You choose the value when setup decides the strategy, and keep it once work on features starts.
   If you must change it, first decide for each started feature whether to rebuild its outputs. Cross-cutting APIs and batches use parity-suite and parity-diff with either value.
   Sources: `skills/replace-strategy/references/project-config.md` "スタイルの方針（`style_policy`）", `skills/replace-strategy/SKILL.md` "姉妹スキルと依存順"
4. Overall order (diagram). Once at the start: replace-strategy setup → current-environment-bootstrap only when needed → measurement, strategy and feature list → golden-dataset phase A.
   If you build components before screens under `reproduce`, run parity-component.
   Then, for each feature, repeat parity-suite → parity-replace → parity-diff under `reproduce`, or spec-parity suite → parity-replace → spec-parity verify under `free`.
   Cross-cutting APIs and batches follow the `reproduce` flow even under `free`. parity-replace calls golden-dataset phase B after the new app's schema is decided.
   Sources: `skills/replace-strategy/SKILL.md` "姉妹スキルと依存順"
5. replace-strategy. Measures the current app, decides the strategy, splits the work into features and hands them to the sibling skills. It does not implement anything itself. If it cannot
   measure, it stops.
   It checks the behavior from the cheapest method first: execution logs → source code → API → UI. It asks you whether to match the current appearance (`style_policy`) when deciding the strategy.
   It leaves filing issues to issue-create.
   Invoke it with `replace-strategy setup`, `issues` or `status`.
   Sources: the opening of `skills/replace-strategy/SKILL.md`, "使い方", "厳守の制約（禁止事項）", "setup モード"
6. current-environment-bootstrap. Rebuilds the current app's test environment, which serves as the baseline for comparison, from the received assets only.
   It does not guess and fix values from type or column names, and it turns missing information into a questionnaire for the people in charge of the current app and business experts.
   Sources: `description` in `skills/current-environment-bootstrap/SKILL.md`, the opening, "使い方"
7. golden-dataset. Builds an idempotent, deterministic loading tool that puts the same data into the current app and the new app. It does not refer to production and creates the data from scratch.
   Loading into the current app (phase A) and into the new app (phase B) are separate. The dataset version detects outdated baselines.
   Sources: `description` in `skills/golden-dataset/SKILL.md`, the opening, "使い方"
8. parity-component. When you build shared UI components before screens, it captures the visual baseline from the current app, implements the component and checks it in a component catalog.
   It captures the same component on each page and compares them. Appearance that differs by page (width, color and so on) becomes a component argument, and appearance that is the same on
   every page is fixed inside the component. It is not used when `style_policy` is `free`.
   Sources: `description` in `skills/parity-component/SKILL.md`, the opening, "使い方", "姉妹スキルとの連携"
9. parity-suite. Builds pass/fail criteria with Playwright that apply to both the current app and the new app. It refers to elements by logical name, and records and replays API responses.
   It injects faults on purpose to confirm the criteria are strong enough to detect them, and hands the visual baselines and noise ranges to parity-diff.
   When `style_policy` is `free`, it handles only cross-cutting APIs and batches.
   Sources: `description` in `skills/parity-suite/SKILL.md`, the opening, "使い方", "姉妹スキルとの連携"
10. parity-replace. Implements the new app against the pass/fail suite (from parity-suite or spec-parity).
    It splits a feature into phases by page, and a reviewer role separate from the implementer reviews the diff.
    It leaves creating branches, commits and PRs to issue-start.
    For features with screens under `free`, the spec-parity suite checks the new app, and it goes back and forth with spec-parity verify.
    Sources: `description` in `skills/parity-replace/SKILL.md`, the opening, "使い方", `skills/parity-replace/references/style-free.md` "相手のスキルと判定の置き換え"
11. parity-diff. Deterministic tools detect differences, and the model only classifies them by asking "Does this difference matter?".
    Detection is split between pixel comparison, style comparison (computed styles, pseudo-elements and positions of elements with logical names) and structure comparison (aria snapshots).
    In the parity-diff skill's terms, style comparison is characteristic matching, and structure comparison is aria comparison.
    Differences that need action go back to parity-replace. When `style_policy` is `free`, it handles only cross-cutting APIs and batches.
    Sources: the opening of `skills/parity-diff/SKILL.md`, "使い方", "姉妹スキルとの連携", `skills/parity-diff/references/detect.md` "3 つの比較方法の分担"
12. spec-parity. Replaces parity-suite and parity-diff for features with screens when `style_policy` is `free`. It does not compare screens, or ask the model "Is this OK?" to decide pass/fail.
    `suite` builds an e2e suite (actions, states, assertions per role, API) against the current app, makes it pass, injects faults to check its strength, and records the baseline of runtime
    errors and the screen widths where the current app does not overflow.
    `verify` checks only the new app. Tools judge the suite, horizontal overflow and runtime errors, and approval records judge the design review and the human check.
    Must-fix items go back to parity-replace. Approvals are kept in append-only records, and it checks none shrank before calling it done.
    Sources: the opening of `skills/spec-parity/SKILL.md`, "使い方", "実行フロー"
13. Where people decide. Approving the strategy and whether to match the current appearance (`style_policy`),
    answers to the questionnaire from the people in charge of the current app and business experts, approving items not measured and writes that
    cannot be cleaned up, approving assets not matched against acceptance criteria, and approving differences classified as "acceptable".
    In spec-parity, approving which design findings to accept, which runtime errors to allow, and which widths to drop from the guaranteed range
    (widths where the current app also overflows), and confirming that the new app's screens look right.
    Also deciding whether to install e2e and web-design-guidelines, and whether agent steps may send page content to the model provider.
    The architecture of the new app (framework, structure and so on) is decided in advance, not by the skills. With `--autonomous`, items that need a decision are recorded as pending and
    asked together at the end.
    Sources: `skills/replace-strategy/SKILL.md` "前提" "自律実行（`--autonomous`）", the approval steps of each sibling skill
14. Outputs. The measurement report, strategy document and feature list in `.replace/`, an issue per feature, the data loading tool, the Playwright parity suite or the e2e suite, the new
    app's implementation and PRs, and the classification of differences or the new app check records.
    Sources: `skills/replace-strategy/SKILL.md` "成果物", the outputs section of each sibling skill's `SKILL.md`
15. Related skills. Filing goes to issue-create and the implementation flow to issue-start (Chapter 4). Operating the current app follows the practices of browser-test (Chapter 7). Output
    documents are reread with writing-style (Chapter 3).
    Sources: `skills/replace-strategy/SKILL.md` "前提", the opening of `skills/parity-replace/SKILL.md`
