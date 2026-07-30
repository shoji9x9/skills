# Skill Benchmark: parity-diff

**Model**: claude-opus-5
**Date**: 2026-07-30T06:39:12Z
**Evals**: 1, 5, 7, 8, 12, 13 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 11% ± 18% | +0.89 |
| Time | 107.8s ± 92.9s | 65.7s ± 19.1s | +42.1s |
| Tokens | 175458 ± 86521 | 110057 ± 76039 | +65400 |

`with_skill` の平均には eval 1（control。`without_skill` を取っていない）が入るため、time / tokens の対比は 5 ペア（5・7・8・12・13）で読む。pass rate は全 `with_skill` が 1.0 なので影響しない。

## 対象と結果（Issue #160 parity 系レジストリの書き手分離・原因グルーピング・根拠パス）

| eval | 主題 | with_skill | without_skill |
|---|---|---|---|
| 5 | フォント差の切り分けと、版差・ヒンティング差を**要対応**として扱う（assertion 1 本追加） | 5/5 | 2/5 |
| 7 | 画素経路のみの差はインスタンス例外へ・原因は `cause` 参照・**適用主体は本スキル**（assertion 1 本追加・プロンプト改訂） | 6/6 | 1/6 |
| 8 | 承認前は「許容」と書かず `pending` へも退避しない（更新） | 5/5 | 0/5 |
| 12 | 設定側の旧キー `component_diff_exceptions` で停止し移行先と畳み込みを示す（新規・fixture） | 6/6 | 0/6 |
| 13 | 承認済み例外の根拠の宛先は `gaps.md` ではない・インスタンス件数を畳まない（新規） | 5/5 | 0/5 |
| 1 | 前提無しでの停止パス（**control**。pass rate には含むが `without_skill` は未取得） | 4/4 | — |

- eval 7 / 8 は既存 eval の更新。7 は置き場所が slug 成果物へ移ったこと ＋ `component_diff_exception_causes` への 1 回定義と `cause` 参照 ＋ 画素例外の適用主体を、
  8 は承認前の書き込み禁止先に新ファイルを加えたうえで `intentional_diffs.pending` への退避も禁止であることを検査する
- **eval 1 は control**。SKILL.md に禁止事項 4 本・成果物 2 行を追加したため停止パスが希釈されていないかを見た。
  `preflight.md`「確認するキー」6 行をフルパスで再現し、追加した禁止事項（`property: pixel` の例外・承認前分類・観測条件）は前提未達の段階では適用対象外として混入しなかった。
  `project-tree.txt` は `.` と `./.claude` のみ・`project-files/` 空・`project-files-skipped.txt` 0 行で、捏造なしを実測で裏取り
- ベースラインの中核提案は契約と逆向きだった:
  eval 7 は「『系統的な原因なので 1 回宣言して全インスタンスで吸収』という判断の形自体は正しい」と述べ（契約では画素経路に照合キーが無い）、
  eval 8 は「`intentional_diffs.pending` に入れる案は、そちらが正解です」と明示的に肯定、
  eval 12 は旧キーを有効な設定として扱い「diff を回せばこの 3 件は既知例外として除外される」と述べ、
  eval 13 は宛先を架空の `docs/investigations/` に発明したうえで 7 件を「削除するか 1 行だけ残す」（件数を畳む）、
  eval 5 は 1px 未満のラスタ差を「許容閾値としてテストに明記」と勧めた（版・ヒンティングの分類自体が無い）

## fixture が答えを漏らしていた件（eval 12 は run-2 を採用）

`legacy-exceptions-key` の初版は、旧キーの直前の YAML コメントに**移行先パスと「同一原因の `reason` が複製されている」という診断**を書いていた。
`without_skill` run-1 はそのコメントを読んで移行先を正答しており、assertion 3・4 の弁別が消えていた（「fixture が答えを持っていると Delta がゼロになる」型の穴）。

- コメントを実際の下流に近い調査メモ（版・送り値は一致 / weight 600 の見出しでのみ再現 / 配信物を選べない）へ差し替え、**両 config を run-2 で取り直した**。run-1 は採点せず集計から除外している
- 修正後の `without_skill` run-2 は移行先パス・`causes`・`複製` をいずれも 0 回で、停止理由も別（スキル未インストール・成果物欠落・localhost 到達不可）になった
- **fixture のコメントは入力であって契約知識ではない。** 規約は `docs/skill-development.md`「回帰テストを実行する」の「fixture に『期待する答え』を書かない」に明文化した。
  同種の cue は `golden-dataset` / `parity-suite` の fixture にもあり、そちらも除去して当該 benchmark に注記した

## assertion の到達性を直した 2 件（eval 8 / 7）

初回取得で、プロンプトが問うていない話題の自発的言及を要求する assertion が見つかった（`.kaizen/2026-07-23-eval-assertion-discrimination.md` の「到達」に反する形。検査していたのは契約知識ではなく冗長さ）。

- **eval 8**: 「`pending` へ退避させるのも禁止」を要求していたがプロンプトが `pending` に触れていなかった。プロンプトに「承認が取れるまで `pending` に入れておくのはどう？」を追加し、assertion を 2 本に分離。`with_skill` は run-2 を採用（run-1 は旧プロンプト）
- **eval 7**: 追加した「画素例外の適用主体」を確実に問うため、プロンプトに「書いておけば次の実行から差分器が自動で吸収してくれるんだよね？」を追加。両 config を取り直した（`with_skill` は run-5、`without_skill` は run-2。run-1 の採点は旧 assertion のため削除）

## API 一時エラーで破棄した run

`with_skill` の 4 run が 529 Overloaded / 500 で `is_error: true`（応答 147〜158 文字）となり、`grading.json` を置かず集計から除外した。スキル挙動ではなくサーバ側の一時障害である。

| eval | 破棄した run | 状態 |
|---|---|---|
| 5 | with_skill run-1 | 529 |
| 7 | with_skill run-2 / run-3 / run-4 | 500 / 529 / 529 |

eval 7 は 4 回連続で失敗し、間隔を 240 秒空けた 5 回目（run-5）で取得できた。

## 採点者について（eval 5 / 7 のみ自己採点）

eval 1 / 8 / 12 / 13 は独立したグレーダー（サブエージェント）が採点した。**eval 5 / 7 はグレーダーが 3 回続けて 529 で落ちたため、メインセッションが採点した**——
assertion の作成者と採点者が同一なので甘さのリスクがあり、他 4 eval と同じ強度の証拠として扱わない。判定根拠は各 `grading.json` の `evidence` に応答からの引用で残してある。API が安定したら独立採点で取り直す価値がある。

## ベースラインの read 汚染について

遮断は既定運用の `scripts/eval-sandbox.sh`（4 群）を逐次で使用。今回 2 点を足した。

- **陽性コントロールを先に通した**（`.agents/rules` の「陰性結果を合格根拠にする検査は検出能力を実証してから使う」）。遮断対象**外**の `$HOME` 直下に既知トークンを置いて `--verify` が `FOUND (FAIL)` を返すことを確認し、削除してから本番検証を行った。
  過去 10 iteration は `--verify` の陰性結果だけを根拠にしていた
- **公開ネットワーク経路を塞いだ**。本 Issue の本文が公開されており `cause` グルーピング・`evidence` 分離・「宛先を `gaps.md` にしない」がそのまま書かれているため、`EVAL_SANDBOX_CLI` に `claude --disallowedTools WebFetch WebSearch` を挟むラッパーを与えた。
  全 run の `usage.server_tool_use` が `web_fetch=0` / `web_search=0` であることも実測。**`gh` + Bash 経路は塞げない**ため事後のマーカー grep（`shoji9x9` / `issues/160` を含む）で担保した
- 本番検証（5 マーカー: `component_diff_exception_causes` / `component-diff-exceptions` / `accepted_exceptions` / `キーの書き手とライフサイクル` / `legacy-exceptions-key`）は stage1（リポジトリ不可視）・stage2 ともクリーン。スキル変更は未コミットのためリモートには存在しない状態で計測した
- eval 7 のベースラインに現れた `shoji9x9` は、ベースライン自身が `grep -r /home/shoji9x9/` を実行し「ヒットはこの会話のログ自身のみ」と報告した文中のパスで、汚染ではなく遮断が効いていた証拠

## eval 設計への申し送り

- **eval 5 の assertion 4 は弁別しない**（決定論的な切り分け手順の要求）。ベースラインも `getComputedStyle` / `document.fonts.check` / CDP の `CSS.getPlatformFontsForNode` で満たした。
  版・ヒンティングの 2 軸に踏み込む assertion 2・3・5 が弁別を担っている
- **連言アサーションの分割**: eval 7 の assertion 2（パス ＋ 非 skills.yml ＋ `property: pixel` ＋ インスタンス単位）と eval 12 の assertion 2・6 は複数命題を 1 文に束ねている。
  特に eval 12 assertion 2 の「差分検出へ進まずに停止している」半分は、この fixture では旧キーを検出しなくても検出工程に到達できないため無情報
- **fixture の前提が metadata レベルのみ**: `legacy-exceptions-key` は `baseline/` や `trait-*.mjs` の実体・稼働 URL を持たないため、「旧キーだけが唯一のブロッカー」の切り分けは `with_skill` の自己申告（主因の順位付け）に依存している

## fixture の cue 除去について（2026-07-30 追記）

本 iteration までの測定に使った fixture の設定ファイルには、`targets` の `develop` エントリに
`# 配信型: db 無し・start 無し・commit_check 無し（意図的）` という注記があった。
これは欠落が「意図的」であることを明言しており、**否定形の assertion**（「〜が無いことを理由に停止していない」等）を
ベースラインが通しやすくなる cue だった（Issue #160 の eval 整備中に `parity-diff` の fixture で同型・より重度の漏れが見つかったのを機に、リポジトリ全体で棚卸しした）。

- **cue を実在しうる役割説明（`# PR マージ後に自動デプロイされる環境`）へ置き換えた。** YAML のキー・値は変えていないので設定の意味論は不変
- **再計測はしていない。** cue の除去はベースラインを弱くする方向にしか働かないため、ここに記録した Delta は**下限**として有効である
- 規約は `docs/skill-development.md`「回帰テストを実行する」の「fixture に『期待する答え』を書かない」に明文化した

## 測定後に入れた差分器の修正 1 件（再計測なし）

`/code-review` が `diff-normalize.mjs` の穴を検出した: **照合キー（`page` / `viewport`）を省いた 1 エントリが、別ページ・別状態の 2 件を警告なしで吸収できた**
（`element: "none"` が match-all として扱われていたのも同因）。契約が 4 箇所で禁じている「インスタンス件数を畳まない」をスキーマ側から破れる状態だった。

- 対応: 欠落した照合キーをワイルドカードではなく不一致として扱い（`state` だけはスキーマ既定値 `default` を補う）、`element: "none"` は「論理名が無い要素」に限定した。
  fail-closed の条件を 3 → 4 に増やし、`normalize.md` / `convergence.md` / `diff-template.md` / `diff-metadata-template.json` を揃えた
- 陽性コントロール（厳密な 1 エントリは今も吸収される）と陰性コントロール（畳み込みエントリは警告 ＋ 非吸収 / `state` 省略は既定で吸収）で実測した
- **再計測はしていない。** 追加したのは fail-closed の条件で、本 iteration の assertion が検査している記述（置き場所・`cause` 参照・件数を畳まない方針・適用主体）はいずれも変わっていないため
