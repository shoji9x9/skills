# 学びの忘却・整理（アーカイブ・削除）ガイド

`.kaizen/` の学びが増え、SessionStart 注入や top-level の見通しを圧迫してきたときに使う。動作は 3 つあり、**対象の status が違う**。

| 動作 | 対象 | 何をするか | 駆動 |
|------|------|-----------|------|
| 忘却 | `status: pending` | frontmatter の `status` を `forgotten` にする。**ファイルは動かさない** | **既定で自動**（抽出完了時）。`kaizen forget` で明示実行も可 |
| アーカイブ | `applied` / `rejected` / `forgotten` | 対象ファイルを `.kaizen/archive/` へ**移動**する（`git mv`）。本文は消さない | ユーザーの明示指示のみ |
| 削除 | 同上 | 対象ファイルを**物理削除**する | ユーザーの明示指示のみ（破壊的） |

**忘却とアーカイブは別の軸**で、順に適用できる。忘却は「適用しないまま終わりにする」という status の決着で、アーカイブは「決着したノートを top-level から片付ける」という置き場の話。

## 原則

- **忘却は自動、アーカイブと削除は明示指示**。忘却は status を 1 行書き換えるだけの非破壊操作で、閾値（日数・優先度）で決まるため自動で回せる。アーカイブと削除はファイルを動かす／消すので、対象一覧を提示して承認を得る。
- **既定はアーカイブ（移動）**。削除ではなく `.kaizen/archive/` へ動かすため、改善の経緯（証跡）が残る。`apply.md`「`.kaizen/` の Git 管理」が述べる「履歴を残して経緯を追える」と整合する。
- **アーカイブしても学びは見つけられる（サマリーのみ照合）**: KEDB 照合（`extract.md`「KEDB 照合」）は、top-level（`.kaizen/*.md`）は本文を、アーカイブはサマリー索引 `.kaizen/archive/INDEX.md`（1 ファイル 1 行）だけを照合する。
  **archive の本文は走査しない**のでコンテキストを圧迫せず、サマリーがヒットしたときだけその 1 ファイルを開く（drill-in）。このため整理時は INDEX.md を最新に保つ（下記手順）。
- **アーカイブは SessionStart 注入に影響しない**: 参照注入フック（`kaizen-context-inject.sh`）は `.kaizen/*.md`（非再帰）の `status: pending` だけを供給する。
  アーカイブ対象は applied / rejected / forgotten なので注入には元から含まれない。**注入を軽くするのは忘却の役目**（pending を対象にする唯一の動作）。
- **pending は既定の対象にしない**: `status: pending` はまだ適用待ちの学び。アーカイブすると注入から外れ、削除すると失われる。`all` を選んだときだけ含め、その場合は特に強く確認する。

## 忘却（自動が既定）

**適用されないまま古くなり、再発もしていない pending を `status: forgotten` にする。** 狙いは SessionStart 注入（`kaizen-context-inject.sh` は `status: pending` だけを供給する）を軽く保つこと。

**ファイルは動かさない。** 自動で走る経路なので `git mv` を含めると、セッション開始のたびに勝手にステージされた差分が生まれる。本文は top-level に残るため KEDB 照合（`references/extract.md`）は従来どおり全文を照合し、**同じ事象が再発すればヒットする**。そこで `status: pending` へ戻せる（「忘れた学びを呼び戻す」参照）。

### 候補の条件

3 つすべてを満たす pending が候補。**どれか 1 つでも読めないノートは候補にしない**（忘れない側へ倒す）。

| 条件 | 既定 | 根拠 |
|------|------|------|
| `status: pending` | — | applied / rejected は決着済み、forgotten は忘却済み |
| `priority` が閾値以下 | `medium` 以下（low / medium） | KEDB 照合で再発が見つかった pending は `references/extract.md` の契約により**優先度を上げて追記**される。high へ上がっていないことが「繰り返し起きてはいない」証跡になる |
| `date` からの経過日数が閾値以上 | 30 日 | 適用する機会が十分あったと見なす期間 |

### 設定（`.kaizen/config`）

`KEY=VALUE` の 1 行 1 設定（コミット前ゲートの `foreign_sentinel_retention_days` と同じファイル）。YAML にしないのは、読み手が bash のフック・スクリプトで `yq` に依存させられないため。

```ini
forget_auto=on              # 自動忘却の有効・無効（既定 on）
forget_after_days=30        # 記録からこの日数が過ぎたら候補（既定 30）
forget_max_priority=medium  # この優先度までを候補にする（low | medium | high。既定 medium）
```

不正値は既定へ倒し、倒したことを stderr に出す（設定したつもりの閾値で動いていると読めてしまうため）。

### 実行

```bash
# <スキル> はインストール先（~/.claude/skills/kaizen / .claude/skills/kaizen / .agents/skills/kaizen のいずれか）。
bash <スキル>/scripts/kaizen-forget.sh --list        # 候補を一覧する（変更しない）
bash <スキル>/scripts/kaizen-forget.sh --auto        # 候補を忘却する（kaizen-extract-done.sh が呼ぶ経路）
bash <スキル>/scripts/kaizen-forget.sh <対象ファイル...>  # 閾値に関わらず明示的に忘却する
```

- **自動忘却は `kaizen-extract-done.sh` が `--auto` で呼ぶ**——学びを 1 件記録し終えた直後、センチネルを解消した後。忘却したノートは stderr に一覧で出るので、忘れられたことに気づける。
- **この位置に置くのは、書き込む瞬間を「リポジトリを変更する意思が確定した時点」に揃えるため。**
  SessionStart に置くと、リポジトリを変更するつもりのない調査だけのセッションでも追跡ファイルが書き換わり、
  その差分は未ステージで残るので、clean 確認を持つ工程（`git-worktree` の後片付け、`issue-batch` の収束）がそこで止まる。
  抽出完了時なら、呼び出し側はこの後 `.kaizen/` を stage して commit を再実行するので、**忘却の差分も新しいノートと同じ commit に収まる**。
- 掃引はセンチネル解消の**後**に走り、失敗しても抽出完了の記録は残る（ここで止めると、抽出したのにゲートが解除されず commit できなくなる）。
- ユーザーが「忘れて」と指示した場合は、対象ファイルを引数に渡す。**明示指示でも対象は pending だけ**——applied / rejected を `forgotten` にすると `applied-to` と矛盾して `kaizen-status-check.sh` が exit 2 で落ちる。それらを片付けたいならアーカイブを使う。

### 忘れた学びを呼び戻す

KEDB 照合が `status=forgotten` のノートを返したら、**その事象は再発している**。忘却の前提（再発していない）が崩れたので pending へ戻す:

1. 該当ノートの frontmatter を `status: pending` に戻す
2. 新しい事象を「## 事象」へ追記し、`priority` を上げる（`references/extract.md`「KEDB 照合」の pending と同じ扱い）
3. 優先度が上がるので、同じ閾値では再び忘却されない

## アーカイブ・削除の呼び出し方（動詞 ＋ 対象フラグ）

**動詞**（`archive` / `delete`）で動作を、**対象フラグ**で対象を指定する。フラグでも自然文でも発動する（忘却の呼び出し方は上の「忘却」を参照）。

| 動作 | 呼び出し例 |
|------|-----------|
| アーカイブ（既定・非破壊） | `kaizen archive [対象フラグ]` / 「整理して」「アーカイブして」「クリーンアップして」「`.kaizen/` を片付けて」 |
| 削除（破壊的） | `kaizen delete [対象フラグ]` / 「削除して」「消して」 |

**対象フラグ**:

| フラグ | 対象 |
|--------|------|
| `--applied` | `status: applied` のみ |
| `--rejected` | `status: rejected` のみ |
| `--applied-and-rejected` | `status: applied` と `status: rejected` の両方 |
| `--forgotten` | `status: forgotten` のみ |
| `--all` | 全ファイル（`pending` を含む。強く確認する） |

- **動作と対象は独立**。`--applied` は「対象が applied」を表すだけで、`archive` にも `delete` にも同じ意味で使える（以前の「`--applied` が削除を暗黙に含む」曖昧さはない）。
- **対象フラグを省略したとき**は、対象範囲（適用済みのみ / 却下済みのみ / 両方 / 忘却済みのみ / すべて）を AskUserQuestion で確認してから実行する。
- **削除は破壊的で取り消せない**ため、対象フラグを指定した場合でも対象一覧を提示し、承認を得てから実行する。アーカイブ（非破壊）はフラグ指定があればそのまま実行してよい。
- 承認を求める確認 UI 自体に判断材料（対象ファイル一覧）を同梱する。直前の通常テキストが確認ダイアログと同時に見えることを前提にしない（Claude Code の AskUserQuestion では選択肢の preview フィールドに入れる）。

## 手順

### アーカイブ（既定）

1. 動作がアーカイブであることを確認する（既定）。
2. 対象範囲を決める。対象フラグ（`--applied` 等）があればそれに従い、無ければ AskUserQuestion で確認する。
3. 対象ファイルの一覧をユーザーに提示する。

   ```bash
   # 例: applied なファイルを一覧する
   grep -l "^status: applied" .kaizen/*.md 2>/dev/null
   ```

4. 承認を得てから、バンドルされた `kaizen-archive.sh` で `.kaizen/archive/` へ移動する。**移動と索引 `INDEX.md` の再生成が 1 コマンドで行われる**ため、索引更新の取りこぼしが起きない（git 管理下なら履歴を残す `git mv`、管理外なら `mv` を自動で使い分ける）。
   ノート内の `](../` 形式の Markdown インラインリンクと画像リンクは、移動先から同じ対象を指すよう 1 階層分自動で補正される。

   ```bash
   # <スキル> はインストール先（~/.claude/skills/kaizen / .claude/skills/kaizen / .agents/skills/kaizen のいずれか）。
   # 直接実行ではなく bash で起動する（インストール済みコピーは実行ビットを持たないため）。
   bash <スキル>/scripts/kaizen-archive.sh <対象ファイル...>
   ```

5. コミットするかはユーザーの判断に委ねる（このスキルは勝手に commit しない）。
6. `bash <スキル>/scripts/kaizen-status-check.sh` を実行し、移動後のファイル集合と `INDEX.md` が一致することを確認する。

### 削除（明示指示時のみ）

1. ユーザーが削除を明示したことを確認する（`kaizen delete ...` または「削除して」「消して」）。
2. 対象範囲を決める。対象フラグ（`--applied` 等）があればそれに従い、無ければ AskUserQuestion で確認する。
3. 対象ファイルの一覧をユーザーに提示する。
4. フラグの有無にかかわらず、承認を得てから削除する。

   ```bash
   grep -l "^status: applied" .kaizen/*.md 2>/dev/null   # 一覧して確認
   rm <対象ファイル...>
   ```

5. アーカイブ済みファイル（`.kaizen/archive/` 配下）を削除した場合は、索引を再生成する: `bash <スキル>/scripts/kaizen-archive.sh --reindex`。

> 削除は破壊的で取り消せない。一覧提示と明示承認を必ず挟む。迷ったらアーカイブを勧める。

## アーカイブ索引（INDEX.md）

`.kaizen/archive/INDEX.md` は、アーカイブ済みノートを KEDB 照合で見つけるための**サマリー索引**（1 ファイル 1 行）。本文は載せないのでコンテキストを圧迫しない。

索引はバンドルスクリプト `scripts/kaizen-archive.sh` が維持する。`archive/*.md` の frontmatter から**毎回再生成する**（追記管理せず作り直す＝drift・二重管理なし）。
要約は「## 事象」直後の**先頭段落**を使い（折り返された段落は 1 行に連結する。空行・見出し・水平線・箇条書きの開始が段落の境界）、その形式が無いノートでは frontmatter 以降の最初の段落にフォールバックする。UTF-8 ロケールで 80 文字を超える要約は、切り詰めを示す `…` を末尾に付けて 80 文字に収める。非 UTF-8 ロケールでは文字のバイト境界を壊さないよう切り詰めない。

```bash
# インストール済みコピーは実行ビットを持たないため bash で起動する。
bash <スキル>/scripts/kaizen-archive.sh <対象ファイル...>   # 移動と索引再生成を同時に行う
bash <スキル>/scripts/kaizen-archive.sh --reindex          # 索引だけを作り直す（削除後の同期など）
bash <スキル>/scripts/kaizen-status-check.sh                # ファイル集合と索引の整合を検査する
```
