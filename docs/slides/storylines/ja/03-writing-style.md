# 3. writing-style

伝えること: 人が読む文章を、読み手が補わずに意味を取れる書き方にそろえる。

## スライド

1. 困りごと。AI が書いた文章には、英語を直訳したような言い回し、日本のエンジニアが使わない語、装飾の多さが繰り返し現れる。
   Issue のタイトルや commit message の 1 行目は、本文を知らない人には意味が伝わらないことがある。
   根拠: `skills/writing-style/references/rules.md` の冒頭と「規則 10」
2. 呼び出し方。多くの場合、利用者は直接呼ばない。issue-create などのスキルが、手順に置いた「writing-style で読み直す」の 1 行から呼ぶ。
   自分で頼むときは、「このタイトルを直して」「文章を読み直して」のように頼む。
   根拠: `skills/writing-style/SKILL.md` の `description` と「他のスキルから使う」
3. 規則の例。10 の規則から、行為者を主語にする・名詞を「の」で連ねない・否定と対比で演出しない・状態を書かない、を悪い例と良い例で示す。
   根拠: `skills/writing-style/references/rules.md`「規則」
4. 要約として読まれる文の読み直し。タイトルや見出しを、本文を知らない人の立場で 3 つの問いで読み直す。
   根拠: `skills/writing-style/references/rules.md`「要約として読まれる文の読み直し」
5. プロジェクトで拡張する。設定の `style_docs`（規約の文書）・`word_list`（使わない語の一覧）・`lint_command`（文章のリンター）で、規則を足す。
   根拠: `skills/writing-style/SKILL.md`「プロジェクトの規約で拡張する」
6. 流れ。規則を読む → 設定を読む → 規則を当てる → 要約の文を読み直す → リンターを実行する → 直した箇所を報告する。
   根拠: `skills/writing-style/SKILL.md`「手順」
7. 成果物。直した箇所ごとの元の文・直した文・当たった規則の一覧を、規則 10 の例で示す。
   人が判断する点の節は置かない。人が判断するのは、設定が誤っていて止まったときだけで、伝える価値が小さい。
   根拠: `skills/writing-style/SKILL.md`「手順」の 6
8. つながるスキル。14 の配布スキルが、書いた文を外に出す前にこのスキルで読み直す。第 2・4・5・6 章のスキルを、章ごとに並べる。
   根拠: `skills/writing-style/SKILL.md` の `description`、writing-style を参照する各スキルの `SKILL.md` と `references/`
