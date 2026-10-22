# 6. Replacement without changing behavior

Message: The flow that measures the current app, applies the same pass/fail criteria to the current app and the new app, and replaces it.

Skills: replace-strategy, current-environment-bootstrap, golden-dataset, parity-component, parity-suite, parity-replace, parity-diff

## Slides

1. The problem. In a replacement without changing behavior, it is tempting to judge whether the behavior is the same from guesses or design documents. Design documents do not always match
   how the current app behaves today.
   When you ask a model to find differences between the screens of the current app and the new app, it misses small differences such as spacing, color and font.
   Sources: `skills/replace-strategy/SKILL.md` "厳守の制約（禁止事項）", the opening of `skills/parity-diff/SKILL.md`
2. Approach. Capture the behavior of the current app as evidence (capture), reproduce it with a different implementation (reproduce), and confirm there are zero differences (confirm). Repeat
   this as a loop.
   Sources: the opening of `skills/replace-strategy/SKILL.md`
3. Overall order (diagram). Once at the start: replace-strategy setup → current-environment-bootstrap only when needed → measurement, strategy and feature list → golden-dataset phase A.
   If you build components before screens, run parity-component. Then repeat parity-suite → parity-replace → parity-diff for each feature.
   parity-replace calls golden-dataset phase B after the new app's schema is decided.
   Sources: `skills/replace-strategy/SKILL.md` "姉妹スキルと依存順"
4. replace-strategy. Measures the current app, decides the strategy, splits the work into features and hands them to the sibling skills. It does not implement anything itself. If it cannot
   measure, it stops.
   It checks the behavior from the cheapest method first: execution logs → source code → API → UI. It leaves filing issues to issue-create.
   Invoke it with `replace-strategy setup`, `issues` or `status`.
   Sources: the opening of `skills/replace-strategy/SKILL.md`, "使い方", "厳守の制約（禁止事項）"
5. current-environment-bootstrap. Rebuilds the current app's test environment, which serves as the baseline for comparison, from the received assets only.
   It does not guess and fix values from type or column names, and it turns missing information into a questionnaire for the people in charge of the current app and business experts.
   Sources: `description` in `skills/current-environment-bootstrap/SKILL.md`, the opening, "使い方"
6. golden-dataset. Builds an idempotent, deterministic loading tool that puts the same data into the current app and the new app. It does not refer to production and creates the data from scratch.
   Loading into the current app (phase A) and into the new app (phase B) are separate. The dataset version detects outdated baselines.
   Sources: `description` in `skills/golden-dataset/SKILL.md`, the opening, "使い方"
7. parity-component. When you build shared UI components before screens, it captures the visual baseline from the current app, implements the component and checks it in a component catalog.
   It captures the same component on each page and compares them. Appearance that differs by page (width, color and so on) becomes a component argument, and appearance that is the same on
   every page is fixed inside the component.
   Sources: `description` in `skills/parity-component/SKILL.md`, the opening, "使い方"
8. parity-suite. Builds pass/fail criteria with Playwright that apply to both the current app and the new app. It refers to elements by logical name, and records and replays API responses.
   It injects faults on purpose to confirm the criteria are strong enough to detect them, and hands the visual baselines and noise ranges to parity-diff.
   Sources: `description` in `skills/parity-suite/SKILL.md`, the opening, "使い方"
9. parity-replace. Implements the new app against the logical names from parity-suite. It splits a feature into phases by page, and a reviewer role separate from the implementer reviews the diff.
   It leaves creating branches, commits and PRs to issue-start.
   Sources: `description` in `skills/parity-replace/SKILL.md`, the opening, "使い方"
10. parity-diff. Deterministic tools detect differences, and the model only classifies them by asking "Does this difference matter?".
    Detection is split between pixel comparison, style comparison (computed styles, pseudo-elements and positions of elements with logical names) and structure comparison (aria snapshots).
    In the parity-diff skill's terms, style comparison is characteristic matching, and structure comparison is aria comparison.
    Differences that need action go back to parity-replace.
    Sources: the opening of `skills/parity-diff/SKILL.md`, "使い方", `skills/parity-diff/references/detect.md` "3 つの比較方法の分担"
11. Where people decide. Approving the strategy, answers to the questionnaire from the people in charge of the current app and business experts, approving items not measured and writes that
    cannot be cleaned up, approving assets not matched against acceptance criteria, and approving differences classified as "acceptable".
    The architecture of the new app (framework, structure and so on) is decided in advance, not by the skills. With `--autonomous`, items that need a decision are recorded as pending and
    asked together at the end.
    Sources: `skills/replace-strategy/SKILL.md` "前提" "自律実行（`--autonomous`）", the approval steps of each sibling skill
12. Outputs. The measurement report, strategy document and feature list in `.replace/`, an issue per feature, the data loading tool, the parity suite, the new app's implementation and PRs,
    and the classification of differences.
    Sources: `skills/replace-strategy/SKILL.md` "成果物", the outputs section of each sibling skill's `SKILL.md`
13. Related skills. Filing goes to issue-create and the implementation flow to issue-start (Chapter 4). Operating the current app follows the practices of browser-test (Chapter 7). Output
    documents are reread with writing-style (Chapter 3).
    Sources: `skills/replace-strategy/SKILL.md` "前提", the opening of `skills/parity-replace/SKILL.md`
