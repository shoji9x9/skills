# 学びの忘却・整理（アーカイブ・削除）ガイド

`.kaizen/` の学びが増え、SessionStart の注入が重くなったり、top-level が見通しにくくなったりしたときに使う。動作は 3 つあり、それぞれ対象にする status が違う。

| 動作 | 対象 | 何をするか | 起動 |
|------|------|-----------|------|
| 忘却 | `status: pending` | frontmatter の `status` を `forgotten` にする。ファイルは動かさない | デフォルトで自動（抽出の完了時）。`kaizen forget` で明示的にも実行できる |
| アーカイブ | `applied` / `rejected` / `forgotten` | 対象のファイルを `.kaizen/archive/` へ移す（`git mv`）。本文は消さない | ユーザーが明示したときだけ |
| 削除 | 同上 | 対象のファイルを物理削除する | ユーザーが明示したときだけ（破壊的） |

忘却とアーカイブは別の軸で、順に適用できる。忘却は「適用しないまま終わりにする」という status の決着で、アーカイブは「決着したノートを top-level から片付ける」という置き場所の話である。

## 原則

- 忘却は自動で行い、アーカイブと削除はユーザーが明示したときだけ行う。忘却は status を 1 行書き換えるだけでファイルを消さず、閾値（日数・優先度）で決まるので、自動で実行できる。
  アーカイブと削除はファイルを動かしたり消したりするので、対象の一覧を示して承認を得る。
- デフォルトはアーカイブ（移動）にする。削除せず `.kaizen/archive/` へ移すので、改善の経緯（証跡）が残る。`apply.md`「`.kaizen/` の Git 管理」が述べる「履歴を残して経緯を追える」と合う。
- アーカイブしても学びは見つけられる。KEDB 照合（`extract.md`「KEDB 照合」）は、top-level（`.kaizen/*.md`）では本文を、アーカイブではサマリーの索引 `.kaizen/archive/INDEX.md`（1 ファイル 1 行）だけを照合する。
  archive の本文は読まないのでコンテキストを圧迫せず、サマリーが一致したときだけその 1 ファイルを開く。そのため、整理するときは INDEX.md を最新に保つ（下の手順）。
- アーカイブは SessionStart の注入に影響しない。参照を注入するフック（`kaizen-context-inject.sh`）は、`.kaizen/*.md`（サブディレクトリは見ない）の `status: pending` だけを渡す。
  アーカイブの対象は applied / rejected / forgotten なので、もともと注入に含まれない。注入を軽くするのは忘却の役目である（pending を対象にする動作は忘却だけ）。
- pending はデフォルトの対象にしない。`status: pending` はまだ適用を待っている学びで、アーカイブすると注入から外れ、削除すると失われる。`all` を選んだときだけ含め、その場合は特に強く確認する。

## 忘却

適用されないまま古くなり、再発もしていない pending を `status: forgotten` にする。SessionStart の注入（`kaizen-context-inject.sh` は `status: pending` だけを渡す）を軽く保つのが目的である。

ファイルは動かさない。自動で実行する処理なので、`git mv` を含めると、セッションを始めるたびに勝手にステージされた差分ができる。
本文は top-level に残るので、KEDB 照合（`references/extract.md`）は全文を照合し、同じ事象が再発すれば見つかる。見つかったら `status: pending` に戻せる（「忘れた学びを呼び戻す」参照）。

### 候補の条件

3 つの条件をすべて満たす pending が候補になる。どれか 1 つでも読めないノートは、候補にしない（忘れない側として扱う）。

| 条件 | デフォルト | 根拠 |
|------|------|------|
| `status: pending` | — | applied / rejected は決着済み、forgotten は忘却済み |
| `priority` が閾値以下 | `medium` 以下（low / medium） | KEDB 照合で再発が見つかった pending は、`references/extract.md` の取り決めで優先度を上げて追記される。high に上がっていないことが、くり返し起きていない証跡になる |
| `date` からの経過日数が閾値以上 | 30 日 | 適用する機会が十分にあったとみなす期間 |

### 設定（`.kaizen/config`）

1 行に 1 つ `KEY=VALUE` で書く（コミット前のチェックの `foreign_sentinel_retention_days` と同じファイル）。YAML にしないのは、読み手が bash のフックやスクリプトで、`yq` に依存させられないからである。

```ini
forget_auto=on              # 自動忘却の有効・無効（既定 on）
forget_after_days=30        # 記録からこの日数が過ぎたら候補（既定 30）
forget_max_priority=medium  # この優先度までを候補にする（low | medium | high。既定 medium）
```

不正な値はデフォルトの値として扱い、そうしたことを stderr に出す。出さないと、設定したつもりの閾値で動いていると読めてしまう。

### 実行

```bash
# <スキル> はインストール先（~/.claude/skills/kaizen / .claude/skills/kaizen / .agents/skills/kaizen のいずれか）。
bash <スキル>/scripts/kaizen-forget.sh --list        # 候補を一覧する（変更しない）
bash <スキル>/scripts/kaizen-forget.sh --auto        # 候補を忘却する（kaizen-extract-done.sh が呼ぶ経路）
bash <スキル>/scripts/kaizen-forget.sh <対象ファイル...>  # 閾値に関わらず明示的に忘却する
```

- 自動の忘却は、`kaizen-extract-done.sh` が `--auto` で呼ぶ。学びを 1 件記録し終えた直後で、センチネルを解消した後である。忘却したノートは stderr に一覧で出るので、忘れられたことに気づける。
- この位置に置くのは、書き込むタイミングを「リポジトリを変える意思が確定した時点」にそろえるためである。
  SessionStart に置くと、リポジトリを変えるつもりのない調査だけのセッションでも、追跡しているファイルが書き換わる。
  その差分はステージされないまま残るので、clean を確かめる工程（`git-worktree` の後片付け、`issue-batch` の収束）がそこで止まる。
  抽出の完了時なら、呼び出し側はこの後に `.kaizen/` を stage して commit を実行し直すので、忘却の差分も新しいノートと同じ commit に入る。
- 忘却はセンチネルを解消した後に実行し、失敗しても抽出完了の記録は残る。ここで止めると、抽出したのにチェックが解除されず、commit できなくなる。
- ユーザーが「忘れて」と指示した場合は、対象のファイルを引数に渡す。明示の指示でも、対象は pending だけである。
  applied / rejected を `forgotten` にすると `applied-to` と矛盾し、`kaizen-status-check.sh` が exit 2 で失敗する。それらを片付けたいなら、アーカイブを使う。

### 忘れた学びを呼び戻す

KEDB 照合が `status=forgotten` のノートを返したら、その事象は再発している。忘却の前提（再発していない）が成り立たなくなったので、次の手順で pending に戻す。

1. そのノートの frontmatter を `status: pending` に戻す
2. 新しい事象を「## 事象」に追記し、`priority` を上げる（`references/extract.md`「KEDB 照合」の pending と同じ扱い）
3. 優先度が上がるので、同じ閾値では再び忘却されない

## アーカイブ・削除の呼び出し方（動詞 ＋ 対象フラグ）

動詞（`archive` / `delete`）で動作を、対象フラグで対象を指定する。フラグでも自然文でも起動する（忘却の呼び出し方は、上の「忘却」を参照）。

| 動作 | 呼び出し例 |
|------|-----------|
| アーカイブ（デフォルト。ファイルを消さない） | `kaizen archive [対象フラグ]` / 「整理して」「アーカイブして」「クリーンアップして」「`.kaizen/` を片付けて」 |
| 削除（破壊的） | `kaizen delete [対象フラグ]` / 「削除して」「消して」 |

対象フラグは次のとおりである。

| フラグ | 対象 |
|--------|------|
| `--applied` | `status: applied` のみ |
| `--rejected` | `status: rejected` のみ |
| `--applied-and-rejected` | `status: applied` と `status: rejected` の両方 |
| `--forgotten` | `status: forgotten` のみ |
| `--all` | 全ファイル（`pending` を含む。強く確認する） |

- 動作と対象は独立している。`--applied` は「対象が applied」を表すだけで、`archive` にも `delete` にも同じ意味で使える（削除を暗に含まない）。
- 対象フラグを省いたときは、対象の範囲（適用済みのみ / 却下済みのみ / 両方 / 忘却済みのみ / すべて）を AskUserQuestion で確認してから実行する。
- 削除は破壊的で取り消せないので、対象フラグを指定した場合でも対象の一覧を示し、承認を得てから実行する。アーカイブはファイルを消さないので、フラグの指定があればそのまま実行してよい。
- 承認を求める確認の UI そのものに、判断材料（対象のファイルの一覧）を入れる。直前の通常のテキストが、確認ダイアログと同時に見えることを前提にしない（Claude Code の AskUserQuestion では、選択肢の preview フィールドに入れる）。

## 手順

### アーカイブ（デフォルト）

1. 動作がアーカイブであることを確かめる（デフォルト）。
2. 対象の範囲を決める。対象フラグ（`--applied` 等）があればそれに従い、無ければ AskUserQuestion で確認する。
3. 対象のファイルの一覧をユーザーに示す。

   ```bash
   # 例: applied なファイルを一覧する
   grep -l "^status: applied" .kaizen/*.md 2>/dev/null
   ```

4. 承認を得てから、同梱の `kaizen-archive.sh` で `.kaizen/archive/` へ移す。移動と索引 `INDEX.md` の再生成を 1 つのコマンドで行うので、索引の更新を忘れない。
   git の管理下なら履歴を残す `git mv` を、管理外なら `mv` を自動で使い分ける。
   ノートの中の `](../` の形の Markdown のインラインリンクと画像リンクは、移動先から同じ対象を指すように、1 階層分を自動で直す。

   ```bash
   # <スキル> はインストール先（~/.claude/skills/kaizen / .claude/skills/kaizen / .agents/skills/kaizen のいずれか）。
   # 直接実行ではなく bash で起動する（インストール済みコピーは実行ビットを持たないため）。
   bash <スキル>/scripts/kaizen-archive.sh <対象ファイル...>
   ```

5. コミットするかは、ユーザーの判断に任せる（このスキルは勝手に commit しない）。
6. `bash <スキル>/scripts/kaizen-status-check.sh` を実行し、移動後のファイルの集合と `INDEX.md` が一致することを確かめる。

### 削除（明示の指示があるときだけ）

1. ユーザーが削除を明示したことを確かめる（`kaizen delete ...` または「削除して」「消して」）。
2. 対象の範囲を決める。対象フラグ（`--applied` 等）があればそれに従い、無ければ AskUserQuestion で確認する。
3. 対象のファイルの一覧をユーザーに示す。
4. フラグの有無に関わらず、承認を得てから削除する。

   ```bash
   grep -l "^status: applied" .kaizen/*.md 2>/dev/null   # 一覧して確認
   rm <対象ファイル...>
   ```

5. アーカイブ済みのファイル（`.kaizen/archive/` の下）を削除した場合は、`bash <スキル>/scripts/kaizen-archive.sh --reindex` で索引を作り直す。

> 削除は破壊的で取り消せない。一覧を示して、明示の承認を必ず得る。迷ったらアーカイブを勧める。

## アーカイブの索引（INDEX.md）

`.kaizen/archive/INDEX.md` は、アーカイブ済みのノートを KEDB 照合で見つけるためのサマリーの索引（1 ファイル 1 行）である。本文は載せないので、コンテキストを圧迫しない。

索引は同梱のスクリプト `scripts/kaizen-archive.sh` が保つ。`archive/*.md` の frontmatter から毎回作り直す（追記で管理しないので、食い違いや二重管理が起きない）。

要約には「## 事象」の直後の先頭の段落を使う。

- 折り返された段落は 1 行につなげる。空行・見出し・水平線・箇条書きの開始が、段落の区切りになる。
- その形が無いノートでは、frontmatter の後の最初の段落を使う。
- UTF-8 のロケールでは、80 文字を超える要約を、末尾に切り詰めを示す `…` を付けて 80 文字に収める。UTF-8 でないロケールでは、文字のバイトの区切りを壊さないように切り詰めない。

```bash
# インストール済みコピーは実行ビットを持たないため bash で起動する。
bash <スキル>/scripts/kaizen-archive.sh <対象ファイル...>   # 移動と索引再生成を同時に行う
bash <スキル>/scripts/kaizen-archive.sh --reindex          # 索引だけを作り直す（削除後の同期など）
bash <スキル>/scripts/kaizen-status-check.sh                # ファイル集合と索引の整合を検査する
```
