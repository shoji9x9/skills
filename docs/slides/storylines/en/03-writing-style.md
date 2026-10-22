# 3. writing-style

Message: Make text that people read consistent, so readers get the meaning without filling in gaps.

## Slides

1. The problem. Text written by AI repeatedly shows phrasing that reads like a literal translation from English, words Japanese engineers do not use, and heavy decoration.
   An issue title or the first line of a commit message may not make sense to someone who has not read the body.
   Sources: the opening of `skills/writing-style/references/rules.md` and "規則 10"
2. How to invoke. In most cases the user does not call it directly. Skills such as issue-create call it from a single line in their steps: "reread with writing-style".
   To ask for it yourself, say "Fix this title" or "Reread this text".
   Sources: `description` in `skills/writing-style/SKILL.md` and "他のスキルから使う"
3. Example rules. From the 10 rules, show bad and good examples for: make the actor the subject, do not chain nouns with "no", do not dramatize with negation and contrast, do not write about
   the current state.
   Sources: `skills/writing-style/references/rules.md` "規則"
4. Rereading sentences that are read as summaries. Reread titles and headings with three questions, from the position of someone who has not read the body.
   Sources: `skills/writing-style/references/rules.md` "要約として読まれる文の読み直し"
5. Extending it per project. Add rules through the configuration keys `style_docs` (the style document), `word_list` (the list of words not to use) and `lint_command` (the prose linter).
   Sources: `skills/writing-style/SKILL.md` "プロジェクトの規約で拡張する"
6. Flow. Read the rules → read the configuration → apply the rules → reread the summary sentences → run the linter → report the fixes.
   Sources: `skills/writing-style/SKILL.md` "手順"
7. Outputs. A list of the original sentence, the fixed sentence and the rule applied for each fix, shown with a rule 10 example.
   There is no "Where people decide" section. People decide only when the configuration is wrong and the skill stops, which is not worth a slide.
   Sources: step 6 of `skills/writing-style/SKILL.md` "手順"
8. Related skills. 14 distributed skills reread the text they write with this skill before it goes out. List the skills from Chapters 2, 4, 5 and 6, grouped by chapter.
   Sources: `description` in `skills/writing-style/SKILL.md`, and the `SKILL.md` and `references/` of each skill that refers to writing-style
