# Brief: translate slide decks from Japanese to English

Repository root (a git worktree; work only inside it):
/home/shoji9x9/projects/skills/.claude/worktrees/feature+664-skill-overview-slides

Source decks: `docs/slides/decks/ja/<name>/` — each has `deck.json` and `slides/<id>.html`.
Write the English decks to `docs/slides/decks/en/<name>/` with the same file names and slide ids.

These slides explain the repository shoji9x9/skills (agent skills for Claude Code, Codex and GitHub Copilot) to engineers who want to install and use the skills.
The Japanese decks are reviewed and final. The English version is a faithful translation: same number of slides, same order, same layout.

## What to change and what to keep

- Each slide file is exactly one `<section id="...">` with inline styles. Keep every tag, attribute, style, id, SVG and image `src` byte-for-byte. Change only human-readable text: element
  text, `alt` and `aria-label`.
- There are no speaker notes (`<aside>`). Do not add any.
- `deck.json`: translate `title` and every `sections.*.description`. Keep every other key and value unchanged (`v`, `createdOnFiles`, `lists`, `cover`, `order`, `faces`, `designSystems`).
  Keep the 2-space JSON formatting.
- Keep as-is: skill names (`issue-start`, `parity-diff`, ...), commands and flags, file paths, config keys, product names (GitHub, Dependabot, Playwright, Box, AWS, CDK, Terraform, textlint,
  gitleaks, pinact ...), numbers, and the commit hash.
- Japanese quotes like 「画面で確認して」 are example user requests to an agent: translate them as English requests in double quotes ("Check it in the browser").
- HTML entities stay escaped (`&lt;slug&gt;`). `&lt;環境名&gt;` placeholders become English (`&lt;env&gt;`, `&lt;IaC path&gt;`).

## Length

Boxes and table columns were sized for Japanese, and English is usually longer. Text only wraps at spaces, so long words can overflow narrow boxes.
Prefer short, plain phrasing. If an English line would clearly be much longer than the Japanese (more than about 1.5×), shorten the wording rather than changing styles. Never change font
sizes or widths.

## Style

- Plain, concise technical English. Sentence case for headings. Present tense, active voice, name who acts ("The agent records ...", "You approve ...").
- No em dashes, no "not X but Y" drama, no marketing words (powerful, seamless, robust, effortless).
- Bullet items and card text: short sentences or fragments, consistent within a slide.

## Glossary (use these exact terms)

| Japanese | English |
| --- | --- |
| 第 N 章 | Chapter N |
| 困りごと | The problem |
| 呼び出し方 | How to invoke |
| 流れ | Flow |
| 設定 | Configuration |
| 人が判断する点 | Where people decide |
| 成果物 | Outputs |
| つながるスキル | Related skills |
| 考え方 | Approach |
| 注意 | Notes |
| できること | What it can do |
| 仕組み | How it works |
| スキル群の構成 | How the skills fit together |
| 全体に関わる | Applies to everything |
| 単独で使う | Used on their own |
| リポジトリの概要 | Repository overview |
| Issue から merge まで | From issue to merge |
| 依存の更新と脆弱性 | Dependency updates and vulnerabilities |
| 仕様を変えないリプレイス | Replacement without changing behavior |
| リポジトリの工夫 | Repository practices |
| 現行（アプリ）／新側 | current app / new app |
| 論理名 | logical name |
| 合否の基準 | pass/fail criteria |
| 差分 | difference(s) |
| 決定論的な | deterministic |
| 確率的な挙動 | probabilistic behavior |
| 学び | learnings |
| 起票する | file an issue |
| 承認 | approval / approve |
| 利用者 | the user |
| 本体 / テスト / fixture | Source / Tests / Fixtures |
| 規模 | Size |
| 構成図 | architecture diagram |
| 副作用を伴う操作 | operations with side effects |
| 禁止する操作 | forbidden operations |
| 読み直す | reread |
| 文章の規約 | writing rules |
| 受け入れ条件 | acceptance criteria |
| 必須チェック | required checks |
| worktree で隔離する | isolate in a worktree |

## Your scope

Translate only the decks named in your task. Do not publish anything, do not run git commit, do not edit files outside `docs/slides/decks/en/<your decks>/`.

When done, check that every file under your `en/<name>/slides/` has the same file names as `ja/<name>/slides/`, and that `deck.json` parses as JSON.

Report back briefly: the decks done, and a list of slides where you had to shorten wording to fit (slide id + what you shortened). Do not paste the translations.
