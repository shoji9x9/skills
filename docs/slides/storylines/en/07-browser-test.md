# 7. browser-test

Message: Check the impact of a change in a real browser.

## Slides

1. The problem. Even when tests pass, regressions can remain in what the screen shows, the console, or API responses.
   When an agent operates the screen, it may perform operations that write data or incur charges.
   Sources: the opening of `skills/browser-test/SKILL.md` and "厳守の制約"
2. How to invoke. `browser-test --env <env> --scope <uncommitted|branch|custom>`. The first time, `browser-test setup` records the environments, how to start them, authentication and
   forbidden operations.
   Sources: `skills/browser-test/SKILL.md` "使い方"
3. Flow. Decide the environment and scope → check that the server is running → derive the affected pages from the change → check the display, console and API on each page → isolate issues
   using another environment → report.
   Sources: `skills/browser-test/SKILL.md` "フロー"
4. Safety rules. Each environment defines its forbidden operations (`forbidden_actions`), and an environment without them is treated as read-only. Operations with side effects need approval
   before they run.
   Sources: `skills/browser-test/SKILL.md` "厳守の制約" "インタラクションの区分"
5. Configuration. `environments` holds the name, URL, how to start, whether authentication is needed, and the forbidden operations for each environment.
   Sources: `skills/browser-test/references/project-config.md`, `skills/browser-test/config-schemas/browser-test.schema.json`
6. Where people decide. Logging in, starting the server, approving operations with side effects, and performing forbidden operations on the agent's behalf.
   Sources: steps 1 and 2 of `skills/browser-test/SKILL.md` "フロー" and "厳守の制約"
7. Outputs. A table of check aspect × page × result, the isolation result for each issue, and the list of operations the user was asked to perform.
   Sources: step 6 of `skills/browser-test/SKILL.md` "フロー"
8. Related skills. issue-batch calls it for changes that affect the UI (Chapter 4). replace-strategy follows these practices when operating the current app (Chapter 6).
   Sources: `skills/issue-batch/SKILL.md` "前提", `skills/replace-strategy/SKILL.md` "前提"
