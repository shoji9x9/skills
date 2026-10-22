# 2. multiagent-setup

伝えること: スキル群の基になる考え（単一のエージェントに依存しない）と、その構成の作り方。

人が判断する点の節は置かない。このスキルで人が判断するのは、依頼から対象を決められないときに尋ねられることだけで、流れの中で説明すれば足りる。

## スライド

1. 困りごと。エージェントごとに、指示とスキルの置き場所が違う（`.claude/`・`.github/`・`.codex/`）。同じ内容を複製すると、片方だけが古くなる。
   根拠: `skills/multiagent-setup/SKILL.md`「基本原則」、`skills/multiagent-setup/references/docs.md`「基本方針」
2. 呼び出し方。「プロジェクトを初期化して」「ルールを追加して」のように頼む。対象ごとに作るものを表で示す。
   ドキュメントでは、`AGENTS.md` を決まった構成で書き、どれにするかの判断の基準と応答の方針の節を足す。`CLAUDE.md` と `.github/copilot-instructions.md` には差分だけを書く。
   全体は、プロジェクトの初期化で、ほかの 4 つの対象をまとめて作る。
   根拠: `skills/multiagent-setup/SKILL.md` の `argument-hint` と「Step 1: コンポーネントの特定」、
   `skills/multiagent-setup/references/docs.md`「AGENTS.md の推奨構成」「既存の基底ドキュメントへの選択基準の追記」「CLAUDE.md / `.github/copilot-instructions.md` の方針」
3. 構成の要点（図）。実体は `.agents/` に 1 つだけ置き、`.claude/skills/`・`.claude/rules/`・`.github/instructions/` からはシンボリックリンクで参照する。
   `AGENTS.md` を基にし、`CLAUDE.md` と `.github/copilot-instructions.md` には差分だけを書く。
   Hook は、各エージェントの設定ファイルから `.agents/hooks/scripts/` の共通のスクリプトを呼ぶ。
   根拠: `skills/multiagent-setup/references/skills.md`・`skills/multiagent-setup/references/rules.md`「ディレクトリ構造」、
   `skills/multiagent-setup/references/docs.md`「ファイル別役割」、`skills/multiagent-setup/references/hooks.md`
4. 流れ。操作の対象を決める（依頼の文から推測し、決められなければ利用者に尋ねる）→ 対象のエージェントを確かめる（今ある設定のディレクトリを見て、依頼に無ければ尋ねる）→ 対象ごとの手順で作る → 後処理（スキルを作ったら skill-creator での検証を提案する）。
   根拠: `skills/multiagent-setup/SKILL.md`「フロー」
5. どれにするかの判断。手順はスキル、特定のファイルを触るときの規約はルール、決まったイベントで自動で実行する処理は Hook、それ以外はドキュメントにする。
   根拠: `skills/multiagent-setup/references/component-selection.md`「最初の振り分け」
6. 成果物。`AGENTS.md` と、`.agents/` の実体と、各エージェント用のリンク。
   根拠: `skills/multiagent-setup/references/skills.md`「ディレクトリ構造」
7. つながるスキル。kaizen が学びを反映するときに、このスキルの判断の基準を使う（第 4 章）。書いた文書は writing-style で読み直す（第 3 章）。
   根拠: `skills/kaizen/references/apply.md`、`skills/multiagent-setup/SKILL.md`「Step 3: コンポーネントの実行」
