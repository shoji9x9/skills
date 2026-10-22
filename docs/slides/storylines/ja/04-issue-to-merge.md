# 4. Issue から merge まで

伝えること: 起票から merge までをエージェントに任せる流れと、その流れの中で学びと利用実績を記録する仕組み。

含むスキル: issue-create・issue-start・git-worktree・kaizen・agent-usage・pr-review-handle・pr-finalize-loop・issue-batch

スキルは、流れの中で動く順に説明する。kaizen と agent-usage は commit の前に動くので、PR の後に動く pr-review-handle と pr-finalize-loop より先に置く。
issue-batch は、ほかのスキルをまとめて回すので最後に置く。

## スライド

1. 困りごと。人の承認がボトルネックになる。起票・着手・実装・レビュー対応・merge のたびに人が指示や承認をすると、エージェントはその間止まる。
   開発が速くなっても承認を待つ時間は減らず、全体の速さは承認の待ち時間で決まる。
   手順も抜けやすい（Issue とブランチの紐付けが無い、レビューに返信せずに解決する、など）。
   根拠: `skills/issue-start/SKILL.md` の基本フローの 7、`skills/pr-review-handle/SKILL.md` の冒頭、`skills/issue-batch/SKILL.md`「prepare」
2. 全体の流れ（図）。issue-create → issue-start（git-worktree で隔離）→ commit（kaizen と agent-usage が記録する）→ PR → pr-finalize-loop（レビューへの対応は pr-review-handle と同じ）→ merge。
   issue-batch は、複数の Issue についてこの流れを順に回す。
   根拠: `skills/issue-batch/SKILL.md`「前提」「run」、`skills/kaizen/SKILL.md`「使い方」、`skills/agent-usage/SKILL.md`「コミットの前の確認」
3. issue-create。重複を確かめ、テンプレートに沿って下書きを作り、承認を得てから起票する。
   根拠: `skills/issue-create/SKILL.md`「基本フロー」
4. issue-start。`gh issue develop` で Issue に紐付けたブランチを作る。
   Issue に書かれた影響範囲を今のコードで確かめ直し、push の前に受け入れ条件を 1 項目ずつ根拠と突き合わせる。
   モード（`--plan`・`--commit`・`--pr`・`--acceptance`）で、どこまで任せるかを選ぶ。
   根拠: `skills/issue-start/SKILL.md`「使い方」と基本フローの 7・8・10
5. git-worktree。worktree を作るだけでは隔離にならず、セッションを移したときに隔離が成り立つ。
   `.gitignore` の対象のファイルの運搬、チェックからの除外、clean を確かめてからの後片付けまでを受け持つ。
   根拠: `skills/git-worktree/SKILL.md` の冒頭と「破ってはいけない前提」
6. 記録する役 1: kaizen。commit の前のチェックが学びの候補を見つけると、commit を止めて抽出を促す。
   学びは `.kaizen/` に残り、`apply` でスキル・ルール・Hook・ドキュメントに反映する。適用されないまま古くなった学びは、自動で忘れる。
   根拠: `skills/kaizen/SKILL.md`「使い方」「基本原則」
7. 記録する役 2: agent-usage。commit の前の Hook が、ブランチごとに利用実績を記録するかを確かめる。
   費用と稼働状況（1 回の指示で動き続けた時間と、人の確認中・CI 待ち・レビュー待ち・未活用に分けた止まっていた時間）を記録し、HTML と CSV に集計する。
   根拠: `skills/agent-usage/SKILL.md` の冒頭と「コミットの前の確認」
8. pr-review-handle。レビューの指摘を、確認・判断・修正（必要なときだけ）・返信・解決の順で扱う。
   根拠: `skills/pr-review-handle/SKILL.md` の冒頭
9. pr-finalize-loop。CI の失敗の修正とレビューへの対応を、CI が成功して未解決の指摘が無くなるまでループで繰り返す。
   再レビューの依頼先（Copilot・Claude Code・Codex・手元・なし）を選べる。
   反復の上限（デフォルトは 5 回）で必ず止まる。手元の `/code-review` でレビューするときだけ、使い切った後に effort を下げて半分の回数を足す。
   根拠: `skills/pr-finalize-loop/SKILL.md` の冒頭・「レビューツールの選択」・「反復の段階と effort」・「停止条件」
10. issue-batch。`setup` で無人で実行する方針を決め、`prepare` で判断を先に決めて Issue に記録し、`run` で Issue ごとに worktree・ブランチ・PR を分けて merge まで進める。
    PR が merge され、Issue が閉じ、deployment が成功し、ブランチを片付けたことを確かめてから完了にする。
    ほかのスキルのスライドと同じく、呼び出し方を添える。
    根拠: `skills/issue-batch/SKILL.md`「使い方」「モード」「最終報告」
11. 人が判断する点。スキルごとに 1 行の表にする。
    issue-create は下書きの承認、issue-start は担当者の確認と受け入れ条件を外すときの承認、git-worktree は setup での置き場所と運ぶファイルの決定である。
    kaizen は記録する学びと反映する成果物の承認（削除も承認）、agent-usage は記録するかの判断である。
    pr-review-handle は直し方が分かれる指摘と再レビューの依頼、pr-finalize-loop は人の判断が要る指摘と、自分の PR でないときに続けるかの判断である。
    issue-batch の `run` は途中で確認しないので、判断が要るものは `setup` と `prepare` で先に決めるか、判断待ちとして残す。
    根拠: `skills/issue-create/SKILL.md`「ルール」、`skills/issue-start/SKILL.md`「追加確認が必要な条件」と基本フローの 10、
    `skills/git-worktree/SKILL.md`「setup」、`skills/kaizen/references/extract.md`・`references/apply.md`・`references/housekeeping.md`、
    `skills/agent-usage/SKILL.md`「コミットの前の確認」、`skills/pr-review-handle/SKILL.md`「妥当性の判断ガイド」「レビュー対応後の再レビュー依頼」、
    `skills/pr-finalize-loop/SKILL.md`「自律性ポリシー」、`skills/issue-batch/SKILL.md`「モード」「安全制約」
12. 成果物。Issue、紐付いたブランチ、受け入れ条件の突き合わせの表、`.kaizen/` の学び、`.agent-usage/` の記録と集計、PR。
    根拠: `skills/issue-start/SKILL.md`「commit / PR の扱い」、`skills/kaizen/SKILL.md`「基本原則」、`skills/agent-usage/SKILL.md`「使い方」
13. つながるスキル。画面に影響する変更では browser-test で確かめる（第 7 章）。タイトルと本文は writing-style で読み直す（第 3 章）。kaizen は multiagent-setup で学びを反映する（第 2 章）。
    根拠: `skills/issue-batch/SKILL.md`「前提」、`skills/kaizen/SKILL.md`「前提」
