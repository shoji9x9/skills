# git-worktree iteration-1

レートリミット回避のため、8 eval のうち **3 件を 1 run ずつ**（isolation / carry-in / cleanup の各 reference から 1 件）実行した。
全 run が `scripts/eval-sandbox.sh` で隔離され、ベースラインはいずれも `verdict: clean`。

## 結果

| eval | 検査対象 | with_skill | without_skill | Delta |
| --- | --- | --- | --- | --- |
| 1 | セッション移動・`-b` での branch 作成・リポジトリ外配置 | 3/3 | 1/3 | **+0.667** |
| 4 | 共有ツリーへのリンクは読み取り専用ではない | 4/4 | 2/4 | **+0.5** |
| 6 | 後片付けの規律（glob 不使用・clean 確認・順序） | 3/4 | 1/4 | **+0.5** |

pass_rate 平均: with_skill 0.917 / without_skill 0.361。

## eval 1 の改訂（測定中に実施）

旧定義では with 3/3・without 3/3 で**弁別しなかった**。原因は assertion ではなく **prompt** にあった。
スキルが出した弁別的な指摘（`-b` で branch を作らせている・`/tmp/wt` がリポジトリ外）は、
prompt が問うていない**自発的言及**だった。`.agents/rules/eval-assertion-discrimination.md` の
「assertion を弱めるのではなく問う形にする」に従い、prompt に問いを足して assertion を差し替えた。

- 追加した問い: 「このコマンド自体と `/tmp/wt` という置き場所にも問題があれば併せて指摘して」
- 結果: ベースラインが **3/3 → 1/3** に落ち、Delta 0 → **+0.667**
- assertion 1（セッションを移す必要がある）はベースラインも満たすため**後退検知が目的**である旨を assertion 本文に明記した。
  実効 Delta は残り 2 本分（with 1.0 対 without 0.0）

## 読み取り

- **ベースラインの誤りは 3 件とも「安全側または通例側への誤結論」だった。**
  - eval 1: コマンドを分析したうえで「引数の順序はバグではありません」と結論し、`feature/x` が既存なら **`-B`**（強制再作成）、
    さらに **`EnterWorktree(name:)`** を推奨した。どちらもスキルが Issue 紐付けの喪失として禁じている形。
    リポジトリ外配置についても tmpfs の揮発性・stale エントリは述べたが、**毎回のユーザー承認**には触れなかった。
  - eval 4: `rm -rf <名前>` と `rm -rf <名前>/` を区別せずスラッシュ無しだけを測り、
    「`rm -rf <worktree>` でうっかり 20GB を消す事故は防げます」と結論した。
  - eval 6: 未 push の確認を `git branch --no-merged`（未マージ判定）で代替した。squash merge 後はこれが効かない。
- 3 件とも**実測でしか分からない挙動**で、assertion に置くと弁別する。
- **eval 6 のベースラインは `-D` を無条件に禁じた。** squash merge されたリポジトリでは `git branch -d` が
  `not fully merged` で必ず拒否するため、この方針は必ずデッドロックする。
  スキル側は `gh pr view` の `state: MERGED` ＋ `headRefName` 完全一致を条件に `-D` を許す。
  **この差は現行の assertion では測っていない。**
- **eval 6 の with_skill が落とした 1 点**は「解除後に `git worktree list` を取り直して再確認する」段
  （`cleanup.md` 手順 4）への未言及。

## 未実施

- eval 2 / 3 / 5 / 7 / 8、および複数 run による分散測定
- code-review で挙動が変わった 3 点（メインチェックアウトの再利用禁止・squash merge 後の branch 削除・
  リポジトリ外 worktree の再入場制限）の assertion 追加
