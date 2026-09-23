// Bash 呼び出しの PreToolUse ゲートの回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸           | 値                                                                                  |
// | ------------ | ------------------------------------------------------------------------------------ |
// | 入力         | 正常な Hook JSON / command フィールド欠落 / 壊れた JSON / 空 stdin                     |
// | gh の口      | gh api（--body-file は無い） / gh pr create / gh issue create（--body-file は正当）     |
// | プロセス終了 | pkill -f（素） / pkill -f '[d]...'（自分に一致しない） / pkill（-f 無し） / killall -f / kill PID / pgrep -af |
// | 区切り       | && / \|\| / ; / \| / 改行（セグメントごとに判定する）                                  |
// | 危険語なし   | 通常のコマンド（hot path で即 exit 0）                                                 |
//
// 陰性コントロール（通さねばならない入力）がゲートと同数以上あることが要点——
// 陽性だけのゲートは「全部落とす実装」と区別が付かない。
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/bash-command-guard.sh");

const run = (payload) =>
  spawnSync("bash", [script], { input: payload, encoding: "utf8", cwd: repoRoot });

const hook = (command) => JSON.stringify({ tool_name: "Bash", tool_input: { command } });

const guard = (command) => run(hook(command));

// --- 陰性コントロール（通す） ---

const PASSING = [
  ["gh pr の --body-file は正当", "gh pr create --body-file /tmp/body.md"],
  ["gh issue の --body-file は正当", "gh issue create --title t --body-file /tmp/body.md"],
  [
    "gh api でも --body-file を使っていなければ通す",
    "gh api repos/o/r/pulls/1/comments -F body=@/tmp/b.md",
  ],
  ["PID 指定の kill は通す", 'kill "$PID"'],
  ["pgrep での確認は通す", "pgrep -af dump-dom"],
  ["文字クラスで自分を避けた pkill は通す", "pkill -f '[d]ump-dom'"],
  ["-f を使わない pkill は通す", "pkill chrome"],
  [
    "危険語を含まない通常のコマンドは通す",
    "git status --short && node scripts/check-rule-symlinks.js",
  ],
  // 文字クラスによる回避は語頭とは限らない。位置で免除を決めると、ブロック時の指示に
  // 従った形（`[d]ump-dom` を含むパターン）が落ちる。
  // 引用された代入値は「文章」であってコマンド位置ではない。閉じ引用符まで飛ばさずに
  // 「次の空白まで」で切ると、値の途中の語がコマンド位置へ繰り上がって誤検知になる。
  ["二重引用符の代入値に現れる gh api は通す", 'note="see gh api --body-file note"'],
  // 単引用符の中は展開されない＝データ。コマンド置換の形をしていても実行されない。
  ["単引用符のコマンド置換はデータなので通す", "TPL='$(gh api x --body-file b)'"],
  ["echo の引数に書いた注意書きは通す", 'echo "gh api --body-file は無い"'],
  // ルール 2 も同じ扱いにする——「話題にしているだけ」の呼び出しを止めない。
  ["コミットメッセージで pkill に言及するだけなら通す", 'git commit -m "docs: never use pkill -f"'],
  ["echo で pkill に言及するだけなら通す", "echo 'avoid pkill -f patterns'"],
  ["grep のパターンに pkill と書くだけなら通す", "cat AGENTS.md | grep -- 'pkill -f'"],
  // 引用符の中の ; はセグメント境界にしない（切ると後半だけが実行文に見える）。
  ["引用符の中の ; で切らない", 'git commit -m "fix; pkill -f x"'],
  // 行コメントはデータ。コード側に入れると注意書きの文章で発動する。
  ["行コメントの注意書きでは発動しない", "gh pr create --body-file b  # gh api では使えない"],
  // コマンド置換の中の ; は本物の区切り。潰して 1 セグメントにすると別コマンドの引数が混ざる。
  ["コマンド置換の中は区切りで分ける", 'out="$(gh api x > f; gh pr create --body-file b)"'],
  ["バッククォートの中も区切りで分ける", "out=`gh api x > f; gh pr create --body-file b`"],
  // 引用符の**外**の $( ) を閉じた後は引用符の外に戻る。常に二重引用符へ戻すと、
  // 以降が引用内扱い→未閉じ扱いになり、fail-safe 経由でコメントの文章まで検査対象になる。
  [
    "コマンド置換を閉じた後はコード文脈へ戻る",
    "out=$(date); gh pr create --body-file b  # gh api では使えない",
  ],
  // 文脈はスタックで持つ。単一変数で戻り先を覚えると、入れ子で内側が外側を壊し、
  // 閉じたのに未閉じ扱い→fail-safe で正当な呼び出しが落ちる。
  [
    "入れ子のコマンド置換と引用を正しく閉じる",
    `gh pr create --body-file "$(dirname "$0")/b.md" --title 'gh api の話'`,
  ],
  // 委譲セグメントでもコメントはデータのまま（全文へ戻すとコメントが検査対象に復活する）。
  [
    "委譲コマンドの行コメントでは発動しない",
    "ssh host uptime  # gh api では --body-file は使えない",
  ],
  ["eval の行コメントでも発動しない", "eval $CMD  # pkill -f chrome は避ける"],
  ["単引用符の代入値に現れる gh api は通す", "note='see gh api --body-file note'"],
  ["正規表現の途中に置いた文字クラスは通す", "pkill -f 'node .*[d]ump-dom'"],
  ["語中に置いた文字クラスは通す", "pkill -f 'my-[s]erver'"],
  ["行頭アンカーの後の文字クラスは通す", "pkill -f '^[c]hrome'"],
  ["任意文字の後の文字クラスは通す", "pkill -f 'chrome.[d]ump'"],
  // `gh api` を部分一致で拾うと、引数の中にこのゲート自身の話題が入っただけで
  // 正当な呼び出しが止まる（このゲートを説明する Issue / PR を書く作業で必ず踏む）。
  [
    "引数の文章に gh api が現れる gh issue create は通す",
    "gh issue create --title 'gh api の --body-file について' --body-file /tmp/b.md",
  ],
  [
    "gh pr create も同じく引数の文章では止めない",
    "gh pr create --title 'gh api メモ' --body-file /tmp/b.md",
  ],
];

for (const [name, command] of PASSING) {
  test(`陰性コントロール: ${name}`, () => {
    const r = guard(command);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/実行前に止めた/);
  });
}

// --- 陽性コントロール（止める） ---

test("gh api の --body-file を止める", () => {
  const r = guard("gh api repos/o/r/pulls/1/comments/2/replies --body-file /tmp/b.md");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/gh api に --body-file は無い/);
});

test("素のパターンで撃つ pkill -f を止める", () => {
  const r = guard("pkill -f dump-dom");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test("killall -f も同じ扱いで止める", () => {
  const r = guard("killall -f node");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test("同じ呼び出しの正当な --body-file は巻き込まず、gh api のセグメントだけを指摘する", () => {
  const r = guard("gh pr create --body-file a.md && gh api x --body-file b.md");
  expect(r.status).toBe(2);
  const lines = r.stderr.split("\n").filter((l) => l.trim().startsWith("-"));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("gh api x --body-file b.md");
  expect(lines[0]).not.toContain("gh pr create");
});

test.each([
  ["セミコロン", "echo start; gh api x --body-file b.md"],
  ["パイプ", "cat b.md | gh api x --body-file b.md"],
  ["OR", "false || gh api x --body-file b.md"],
  ["改行", "echo start\ngh api x --body-file b.md"],
])("区切り %s のセグメントでも判定する", (_name, command) => {
  expect(guard(command).status).toBe(2);
});

test("2 クラスが同時にあれば両方報告する", () => {
  const r = guard("gh api x --body-file b.md && pkill -f dump-dom");
  expect(r.status).toBe(2);
  const lines = r.stderr.split("\n").filter((l) => l.trim().startsWith("-"));
  expect(lines).toHaveLength(2);
});

// `gh api` は先頭に限らない。制御構文の後・env 代入の後・コマンド置換の中でも実行される。
// 「セグメントの先頭」に限定すると、これらが素通りする（実測した退行）。
test.each([
  ["do の後", "for r in 1 2; do gh api repos/o/r/pulls/1 --body-file /tmp/b.md; done"],
  ["then の後", "then gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  ["env 代入の後", "GH_TOKEN=x gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  ["コマンド置換の中", "out=$(gh api repos/o/r/pulls/1 --body-file /tmp/b.md)"],
  ["サブシェルの中", "( gh api repos/o/r/pulls/1 --body-file /tmp/b.md )"],
  ["time の後", "time gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  // 引用符付きのコマンド置換（推奨形）も中身が実行される。
  ["引用符付きコマンド置換の中", 'out="$(gh api repos/o/r/pulls/1 --body-file /tmp/b.md)"'],
  // 引用された代入値の**後ろ**は、飛ばし過ぎても足りなくてもコマンド位置を見失う。
  ["引用された代入値の後", 'FOO="a b" gh api repos/o/r/pulls/1 --body-file /tmp/b.md'],
  ["env の後", "env GH_TOKEN=x gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  ["timeout と数値引数の後", "timeout 30 gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  ["command の後", "command gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  ["xargs の後", "xargs gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  // 区切りが TAB でも剥ぐ（' ' 固定だと剥ぎ残す）。
  [
    "TAB 区切りの do の後",
    "for r in 1 2; do\tgh api repos/o/r/pulls/1 --body-file /tmp/b.md; done",
  ],
  // 二重引用符の中のコマンド置換は**値の先頭とは限らない**。
  ["引用値の途中のコマンド置換", 'out="prefix $(gh api repos/o/r/pulls/1 --body-file /tmp/b.md)"'],
  [
    "引用値に 2 つ目のコマンド置換",
    'out="$(date) $(gh api repos/o/r/pulls/1 --body-file /tmp/b.md)"',
  ],
  ["バッククォートのコマンド置換", "out=`gh api repos/o/r/pulls/1 --body-file /tmp/b.md`"],
  // ラッパーにフラグが付いても実行されるのは同じ。
  ["sudo のフラグ付き", "sudo -u me gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  ["env のフラグ付き", "env -i gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  ["timeout のフラグ付き", "timeout -k 5 30 gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
])("コマンド位置の gh api を %s でも止める", (_name, command) => {
  const r = guard(command);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/unknown flag/);
});

// 免除にできるのは **1 文字のクラス**だけ。範囲や複数文字は、括弧の中の文字が
// 自分のコマンドライン上にそのまま現れるので、パターンが自分自身に一致する
// （`chrome.*[0-9]+` は引数リテラルの `0` に、`[cC]hrome` は `Chrome` に一致する）。
test.each([
  ["範囲クラス", 'pkill -f "chrome.*[0-9]+"'],
  ["複数文字のクラス", "pkill -f '[cC]hrome'"],
])("自分自身に一致する %s は免除しない", (_name, command) => {
  const r = guard(command);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

// 引用文字列をそのままシェルへ渡すコマンドは、その引数がコードとして実行される。
// 引用の中を一律データにすると、ゲートが止めるために作られた形そのものが素通りする。
test.each([
  ["bash -c", 'bash -c "pkill -f chrome"'],
  ["ssh", "ssh host 'pkill -f node'"],
  ["sh -c（gh api 側）", 'sh -c "gh api x --body-file b"'],
])("シェルへ委譲した %s の中身も検査する", (_name, command) => {
  expect(guard(command).status).toBe(2);
});

// 二重引用符の中のバッククォートもコードとして実行される。
test.each([
  ["プロセス終了側", 'echo "`pkill -f chrome`"'],
  ["gh api 側", 'echo "`gh api x --body-file b`"'],
])("二重引用符の中のバッククォートを検査する（%s）", (_name, command) => {
  expect(guard(command).status).toBe(2);
});

// 委譲の検出はリテラル "sh -c" の部分一致では足りない（短オプションを束ねた形を取りこぼす）。
test.each([
  ["bash -lc", 'bash -lc "pkill -f chrome"'],
  ["sh -xc", 'sh -xc "pkill -f chrome"'],
])("オプションを束ねたシェル委譲（%s）も検査する", (_name, command) => {
  expect(guard(command).status).toBe(2);
});

test("区切り文字はどちらのセグメントにも混ぜない", () => {
  // 次セグメントの先頭へ混ぜると、打っていないコマンド（`| pkill ...`）を引用する。
  const r = guard("git status | pkill -f chrome");
  expect(r.status).toBe(2);
  expect(r.stderr).not.toMatch(/[|;&]\s*pkill/);
});

test("引用が閉じていない入力は解釈せず fail-safe に倒す", () => {
  // ヒアドキュメント本文のアポストロフィ 1 個で以降が全部データ扱いになり、
  // 黙って最強の免除になっていた（実測）。解釈できない入力は検査側へ倒す。
  const r = guard("echo it's ok; gh api repos/o/r/pulls/1 --body-file /tmp/b.md");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/unknown flag/);
});

test("fail-safe に倒したとき、同じ違反を重複して出さない", () => {
  // 通常セグメントと全文の両方を出すと、同一の違反が 2 行に増えて読み手を混乱させる。
  const r = guard("gh api x --body-file b; echo it's ok");
  expect(r.status).toBe(2);
  expect(r.stderr.split("\n").filter((l) => l.startsWith("  - "))).toHaveLength(1);
});

test("コマンド置換の中の引用された ) で早く閉じない", () => {
  const r = guard(`out="$(grep -c ')' f && gh api x --body-file b)"`);
  expect(r.status).toBe(2);
});

test.each([
  ["引用符の外のコマンド置換", "out=$(gh api x --body-file b)"],
  ["引用符の中のコマンド置換", 'out="$(gh api x --body-file b)"'],
])("ブロックメッセージは打っていないコマンドを引用しない（%s）", (_name, command) => {
  // $( の ( を落として full を組むと、存在しない `$gh api ... )` を引用して読み手を誤導する。
  // 経路は 2 つ（コード文脈と二重引用符の中）あるので、両方を固定する。
  const r = guard(command);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain(command);
});

test("行コメントの中の [] は文字クラスの免除に数えない", () => {
  const r = guard("pkill -f chrome # see [notes]");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

// 免除は「${...} 展開と行コメントを除いた部分に文字クラスがあるか」で決める。
// 取り除かずに見ると、配列添字を含むだけの素の -f 実行が素通りする（実測した偽陰性）。
test("配列添字の [] は文字クラスの免除に数えない", () => {
  const r = guard('pkill -f "${procs[0]}"');
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test("変数展開と併用した文字クラスは免除する", () => {
  const r = guard('pkill -f "$dir/[d]ump-dom"');
  expect(r.status).toBe(0);
  expect(r.stderr).not.toMatch(/実行前に止めた/);
});

// --- ヒアドキュメントの本文（Issue #423） ---
//
// 本文はコマンドの標準入力に渡るデータで、実行されない。本文をコードとして読むと、
// ゲートや注意書きを説明する文章を heredoc で書いただけで止まる（引用符の有無に依らず、本文の各行を
// コマンドとして切っていた）。ただし本文が実行される形は従来どおりコードとして読む。
//
// | 軸                 | データ（通す）                                     | コード（止める）                                   |
// |--------------------|----------------------------------------------------|----------------------------------------------------|
// | 区切り語           | 引用（'EOF' / "EOF" / \EOF）・非引用で置換なし     | 非引用で本文に $( ) / ` がある                     |
// | 本文を読むもの     | cat / tee / git commit -F - 等                     | 同じ行に sh / bash / ssh / eval / source / . がある |
// | 区切り語の行       | 一致（<<- はタブを剥いで一致）                     | 見つからない（本文をコードとして読む）             |
// | 本文の後           | —                                                  | 区切り語の行の次からは通常のコード                 |
// | マーカーのある行   | —                                                  | マーカーの後ろ（`&& ...`）は通常のコード           |
// | 数                 | 1 行に 2 つ（順に読み飛ばす）・$( ) の中           | —                                                  |
const HEREDOC_PASSING = [
  ["引用した区切り語の本文にアポストロフィ", "cat > f.md <<'EOF'\nDon't use pkill -f here\nEOF"],
  ["二重引用符の区切り語", 'cat > f.md <<"EOF"\nnever pkill -f\nEOF'],
  ["バックスラッシュの区切り語", "cat > f.md <<\\EOF\nnever pkill -f\nEOF"],
  ["非引用の区切り語で置換の無い本文", "cat > f.md <<EOF\nnever use pkill -f here\nEOF"],
  ["本文の gh api の文章", "cat > b.md <<'EOF'\ngh api x --body-file y は不可\nEOF"],
  ["<<- はタブを剥いだ区切り語で閉じる", "cat > f.md <<-'EOF'\n\tDon't pkill -f\n\tEOF"],
  ["1 行に 2 つのヒアドキュメント", "cat <<A <<'B'\nx pkill -f\nA\ny it's pkill -f\nB"],
  ["引用した区切り語の本文の $( ) は実行されない", "cat > f.sh <<'EOF'\nout=$(pkill -f x)\nEOF"],
  [
    "コマンド置換の中のヒアドキュメント",
    "msg=$(cat <<'EOF'\nDon't pkill -f\nEOF\n)\ngit commit -m \"$msg\"",
  ],
  ["マーカーの後ろに続くコマンドが正当", "cat <<'EOF' > f.md && echo ok\nDon't pkill -f\nEOF"],
  ["シェルスクリプトを書き出す（語の一部の sh）", "cat > x.sh <<'EOF'\npkill -f chrome\nEOF"],
  ["行継続の前の行がシェルでない", "cat \\\n  <<'EOF'\nDon't pkill -f\nEOF"],
];
test.each(HEREDOC_PASSING)("ヒアドキュメントの本文はデータとして通す: %s", (_name, command) => {
  const r = guard(command);
  expect(r.status).toBe(0);
  expect(r.stderr).not.toMatch(/実行前に止めた/);
});

// 読み手の許可リスト（PR #448 のレビュー後に、本文を実行するシェルの列挙から反転した）。
// 本文を読み飛ばすのは、`<<` の読み手とパイプの先がすべて許可リストのときだけ。
const HEREDOC_READER_PASSING = [
  ["tee", "tee f.md <<'EOF'\nDon't pkill -f\nEOF"],
  ["git commit -F -", "git commit -F - <<'EOF'\nfix: don't pkill -f\nEOF"],
  ["先頭の代入を読み飛ばす", "GIT_EDITOR=true git commit -F - <<'EOF'\nfix: don't pkill -f\nEOF"],
  ["許可リストの読み手へのパイプ", "cat <<'EOF' | gh pr create --body-file -\nDon't pkill -f\nEOF"],
  ["コマンド置換の中の git commit", "git commit -m \"$(cat <<'EOF'\nfix: don't pkill -f\nEOF\n)\""],
  ["代入が受け取るコマンド置換", "msg=$(cat <<'EOF'\nDon't pkill -f\nEOF\n)"],
  ["代入が受け取るバッククォート", "x=`cat <<'EOF'\nDon't pkill -f\nEOF\n`"],
  ["行継続を挟んだ読み手", "cat \\\n  <<'EOF'\nDon't pkill -f\nEOF"],
  ["node", "node - <<'EOF'\nconsole.log(\"don't pkill -f\")\nEOF"],
];
test.each(HEREDOC_READER_PASSING)(
  "許可リストの読み手の本文はデータとして通す: %s",
  (_name, command) => {
    const r = guard(command);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/実行前に止めた/);
  },
);

const HEREDOC_READER_BLOCKING = [
  ["引用したシェル名", "'bash' <<'EOF'\npkill -f chrome\nEOF"],
  ["パス付きのシェル", "/bin/sh <<'EOF'\npkill -f chrome\nEOF"],
  ["env 経由のシェル", "env bash <<'EOF'\npkill -f chrome\nEOF"],
  [
    "許可リストの読み手から許可リスト外へのパイプ",
    "cat <<'EOF' | tee f | bash\npkill -f chrome\nEOF",
  ],
  // 読み手がコマンド置換の中にあると、置換の結果を受け取る外側のコマンドも本文を実行しうる（PR #448 のレビュー。親版は止めていた）。
  ["eval が受け取るコマンド置換", "eval \"$(cat <<'EOF'\npkill -f chrome\nEOF\n)\""],
  ["bash -c が受け取るコマンド置換", "bash -c \"$(cat <<'EOF'\npkill -f chrome\nEOF\n)\""],
  ["eval が受け取るバッククォート", "eval `cat <<'EOF'\npkill -f chrome\nEOF\n`"],
  // 同じ呼び出しで読み手の名前が実体を表さなくなる形（PR #448 のレビュー。親版は止めていた）。
  ["関数として定義し直した読み手", "cat() { bash; }; cat <<'EOF'\npkill -f chrome\nEOF"],
  ["function で定義し直した読み手", "function cat { bash; }; cat <<'EOF'\npkill -f chrome\nEOF"],
  ["alias で差し替えた読み手", "alias cat=bash; cat <<'EOF'\npkill -f chrome\nEOF"],
  ["PATH を差し替えた読み手", "PATH=/tmp/evil cat <<'EOF'\npkill -f chrome\nEOF"],
  [
    "PATH を export した後の読み手",
    "export PATH=/tmp/evil:$PATH; cat <<'EOF'\npkill -f chrome\nEOF",
  ],
  ["hash で差し替えた読み手", "hash -p /tmp/evil cat; cat <<'EOF'\npkill -f chrome\nEOF"],
  // プロセス置換は読み手の出力を別のコマンドへ渡す（PR #448 のレビュー。親版は止めていた）。
  ["出力のプロセス置換", "cat <<'EOF' > >(bash)\npkill -f chrome\nEOF"],
  ["tee のプロセス置換", "tee >(sh) <<'EOF'\npkill -f chrome\nEOF"],
  ["リダイレクトの & を境界と読む（安全側）", "cat 2>&1 <<'EOF'\npkill -f chrome\nEOF"],
];
test.each(HEREDOC_READER_BLOCKING)(
  "許可リスト外の読み手の本文はコードとして読む: %s",
  (_name, command) => {
    expect(guard(command).status).toBe(2);
  },
);

const HEREDOC_BLOCKING = [
  ["区切り語の行の次のコマンド", "cat > f.md <<'EOF'\nDon't\nEOF\npkill -f chrome"],
  ["マーカーの後ろのコマンド", "cat <<'EOF' && pkill -f chrome\nbody\nEOF"],
  ["本文をシェルが読む", "bash <<'EOF'\npkill -f chrome\nEOF"],
  ["本文をパイプでシェルへ渡す", "cat <<'EOF' | sh\npkill -f chrome\nEOF"],
  ["本文を ssh が読む", "ssh host <<EOF\npkill -f node\nEOF"],
  ["本文を . が読む", ". /dev/stdin <<'EOF'\npkill -f chrome\nEOF"],
  // 行継続でシェルとマーカーが別の物理行に分かれても同じ論理行（PR #448 のレビュー。親版は止めていた）。
  ["行継続の前の行でシェルが読む", "bash \\\n <<'EOF'\npkill -f chrome\nEOF"],
  ["非引用の区切り語で本文に $( )", "cat > f.md <<EOF\nout=$(pkill -f x)\nEOF"],
  ["非引用の区切り語で本文にバッククォート", "cat > f.md <<EOF\nout=`pkill -f x`\nEOF"],
  ["区切り語の行が無い", "cat <<'EOF'\npkill -f chrome"],
  ["<< の区切り語はタブ付きでは閉じない", "cat <<'EOF'\nx\n\tEOF\npkill -f chrome"],
  ["ヒアストリングはヒアドキュメントではない", "cat <<< x\npkill -f chrome"],
  // `<<<` の 2 文字目からを `<<` と読むと、区切り語 EOF のヒアドキュメントとして次の行を飛ばす。
  ["ヒアストリングの語と同じ行が後にある", "cat <<< EOF\npkill -f chrome\nEOF"],
  ["gh api の本文の後の gh api", "cat > b.md <<'EOF'\nnote\nEOF\ngh api x --body-file b.md"],
];
test.each(HEREDOC_BLOCKING)("ヒアドキュメントでも実行される形は止める: %s", (_name, command) => {
  expect(guard(command).status).toBe(2);
});

// --- 意図的な穴と、構造を見ずに拾えている形（Issue #423） ---
//
// スクリプト冒頭の「意図的な穴」の各行を、現在の挙動として固定する。挙動を変えたらここと冒頭を一緒に直す。
test.each([
  ["xargs 経由", "echo chrome | xargs pkill -f"],
  ["find -exec 経由", "find . -exec pkill -f {} \\;"],
  ["case の本体", "case x in x) pkill -f chrome ;; esac"],
  ["関数の本体", "f() { pkill -f chrome; }; f"],
  ["プロセス置換", "cat <(pkill -f chrome)"],
  ["行継続で別の行に分かれた gh api と --body-file", "gh api x \\\n  --body-file b"],
])("構造を解析せずに拾えている形（%s）は止める", (_name, command) => {
  expect(guard(command).status).toBe(2);
});

test("意図的な穴（誤検知側）: シェル委譲のセグメントは位置引数の文字列もコードとして扱う", () => {
  expect(guard('bash -c \'echo "$1"\' _ "pkill -f x"').status).toBe(2);
});

test("意図的な穴（見逃し側）: 変数に入れたコマンド名は展開しない", () => {
  expect(guard("K=pkill; $K -f chrome").status).toBe(0);
});

test("意図的な穴（見逃し側）: インタプリタが読むヒアドキュメントの本文はデータとして通す", () => {
  // AGENTS.md は本文を quoted heredoc でインタプリタへ渡す形を推奨するので、読み手の許可リストに入れる。
  const command = "python3 - <<'EOF'\nimport os\npkill -f x\nEOF";
  expect(guard(command).status).toBe(0);
});

test("意図的な穴（見逃し側）: 許可リストの読み手でファイルへ書き出してから実行する形は見逃す", () => {
  // 書き出した内容の行方はゲートから追えない（Write ツールで書いてから実行するのと同じ）。
  expect(guard("cat > s.sh <<'EOF' && bash s.sh\npkill -f chrome\nEOF").status).toBe(0);
});

test("意図的な穴（誤検知側）: 引用していないリダイレクト先のファイル名もコードとして見る", () => {
  expect(guard("echo hi > pkill-f.log").status).toBe(2);
});

// 算術の中の `<<` は左シフト。ヒアドキュメントと読むと、後続の行が右辺と一致したときに
// 間のコマンドを本文として飛ばす（PR #448 のレビュー。親版は止めていた）。
test.each([
  ["$(( )) の後", "echo $(( 1 << 2 ))\npkill -f chrome\n2"],
  ["(( )) の後", "(( x = 1 << 2 ))\npkill -f chrome\n2"],
  ["二重引用符の中の $(( ))", 'echo "$(( 1 << 2 ))"\npkill -f chrome\n2'],
  ["括弧を含む算術", "echo $(( (1 << 2) + 1 ))\npkill -f chrome\n2"],
  ["右辺が変数", "echo $(( x << y ))\npkill -f chrome\ny"],
  // 内側の括弧を深さで数えないと、`((1 << 2))` の閉じを算術の閉じと読んで残りをコードに戻す。
  ["入れ子の括弧を含む算術", "echo $(( ((1 << 2)) + (3 << 4) ))\npkill -f chrome\n4"],
])("算術の << をヒアドキュメントと読まない（%s）", (_name, command) => {
  expect(guard(command).status).toBe(2);
});

// パラメータ展開の中の `<<` は置換文字列。ヒアドキュメントと読むと、区切り語と同じ行までを飛ばす
// （PR #448 のレビュー。親版は止めていた）。
test.each([
  ["置換文字列の <<", "cat ${x:-<<EOF;}\npkill -f chrome\nEOF"],
  ["入れ子のパラメータ展開", "cat ${x:-${y:-<<EOF;}}\npkill -f chrome\nEOF"],
])("パラメータ展開の << をヒアドキュメントと読まない（%s）", (_name, command) => {
  expect(guard(command).status).toBe(2);
});

// bash は `${…}` の中の素の `{` を数えず、最初の `}` で閉じる（実測: `${x:-{a}b}` は `{ab}`）。
// 深さで数えると、閉じた後の本物のヒアドキュメントをパラメータ展開の中と読み、本文をコードとして止める。
test("パラメータ展開は最初の } で閉じ、その後のヒアドキュメントは本文をデータとして通す", () => {
  const r = guard("cat ${x:-{a}b} - <<'EOF'\nDon't pkill -f\nEOF");
  expect(r.status).toBe(0);
});

test("パラメータ展開を閉じた後のヒアドキュメントは本文をデータとして通す", () => {
  const r = guard("echo ${#arr[@]}\ncat <<'EOF'\nDon't pkill -f\nEOF");
  expect(r.status).toBe(0);
});

test("算術を閉じた後のヒアドキュメントは本文をデータとして通す", () => {
  const r = guard("x=$(( 1 << 2 ))\ncat <<'EOF'\nDon't pkill -f\nEOF");
  expect(r.status).toBe(0);
});

// --- 入力の退化形 ---

test("command フィールドが無い Hook JSON は通す", () => {
  const r = run(JSON.stringify({ tool_name: "Bash", tool_input: {} }));
  expect(r.status).toBe(0);
});

test("空 stdin は通す", () => {
  const r = run("");
  expect(r.status).toBe(0);
});

test("壊れた JSON は通すが、検査していないことを stderr に残す（黙って合格にしない）", () => {
  const r = run('{ "tool_input": { "command": "pkill -f x" ');
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(/検査していない/);
});

// --- payload の形（エージェントごとに違う） ---
//
// このゲートは 3 エージェント（Claude Code / Codex / Copilot）へ配線してある。
// `.tool_input.command` だけを読むと残り 2 つでは command が空になり、JSON 自体は読めるので
// 警告も出ないまま全件素通りする（配線済みに見えて 1 つしか効かない）。
// 陽性コントロールは各形に同じ違反コマンドを載せて取る。
const OFFENDING = "pkill -f dump-dom";

test.each([
  ["Claude Code: tool_input.command", { tool_name: "Bash", tool_input: { command: OFFENDING } }],
  ["Codex: toolArgs.command", { tool_name: "Bash", toolArgs: { command: OFFENDING } }],
  [
    "Codex: toolArgs が JSON 文字列",
    { tool_name: "Bash", toolArgs: JSON.stringify({ command: OFFENDING }) },
  ],
  ["Copilot: input.command", { tool_name: "Bash", input: { command: OFFENDING } }],
  ["素の command", { tool_name: "Bash", command: OFFENDING }],
])("payload の形 %s でも判定する", (_name, payload) => {
  const r = run(JSON.stringify(payload));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test("危険語はあるが command を取り出せない payload は、検査していないことを stderr に残す", () => {
  // 未知の形（command がどのフィールドにも無い）。通すが、黙って合格にはしない。
  const r = run(JSON.stringify({ tool_name: "Bash", args: { script: OFFENDING } }));
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(/検査していない/);
});

// --- jq 単独経路（node が無い環境） ---
//
// 上の「payload の形」テストは node フォールバックが拾うため、jq の filter が落ちていても緑になる。
// 実際 `.toolArgs.command` は toolArgs が文字列のとき jq がエラー終了し（実測: jq 1.8.2 で rc=5）、
// node の無い環境では Codex の JSON 文字列形が検査されないまま通っていた。
// そこでスクリプトから filter を取り出し、jq に直接当てて経路ごとに検証する。
const guardSource = readFileSync(script, "utf8");
const jqFilter = guardSource.match(/jq -r '([\s\S]*?)'\s*2>\/dev\/null/)?.[1];

test("スクリプトから jq filter を取り出せる（取り出せなければ以降の検証は無意味）", () => {
  expect(jqFilter).toBeTruthy();
});

test.each([
  ["tool_input.command", { tool_name: "Bash", tool_input: { command: OFFENDING } }],
  ["toolArgs.command", { tool_name: "Bash", toolArgs: { command: OFFENDING } }],
  [
    "toolArgs が JSON 文字列",
    { tool_name: "Bash", toolArgs: JSON.stringify({ command: OFFENDING }) },
  ],
  ["input.command", { tool_name: "Bash", input: { command: OFFENDING } }],
  ["素の command", { tool_name: "Bash", command: OFFENDING }],
])("jq 単独でも %s から command を取り出す", (_name, payload) => {
  const r = spawnSync("jq", ["-r", jqFilter], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  // jq が無い環境ではこの検証は成立しない。黙って緑にせず落とす。
  expect(r.error, "jq が必要（この検証は jq 経路の回帰テスト）").toBeUndefined();
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toBe(OFFENDING);
});
