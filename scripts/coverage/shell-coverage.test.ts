// シェルのカバレッジ（bash-trace-env.sh と shell-coverage.ts）のテスト。
//
// 本物の bash と shfmt で実行し、期待値は bash の xtrace の仕様から決める。
// xtrace は、単純なコマンド・宣言・`[[ ]]`・`(( ))`・`case` を、文の開始行で記録する。
// `if`・`while`・`{ }`・`( )`・関数の定義・heredoc の本文は記録しない。
// `for` は反復が 1 回以上のときだけ記録するので、実行できる行に数えない（本体の文で数える）。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                          |
// | -------------- | --------------------------------------------------------------------------- |
// | 文の種類       | 上の記録する種類と記録しない種類のすべて / 複数行に分けた引数 / 同じ行の 2 文 |
// | 実行           | 実行した分岐 / 実行しなかった分岐                                           |
// | 起動のパス     | 絶対パス / 相対パス / 内容が同じコピー（消した後） / 書き換えたコピー        |
// | 記録の行       | 正しい形 / #CWD の前 / BASH_SOURCE が空（bash -c） / 改行で続いた本文        |
// | 計測の環境     | 書き込める / 書き込み先が無い（stderr を変えない）                         |
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";
import { executableLines, parseShell, parseTrace, shellCoverage } from "./shell-coverage.ts";

const TRACE_ENV = fileURLToPath(new URL("bash-trace-env.sh", import.meta.url));

// 行番号を期待値に使うので、行を足したり消したりしない。
const SAMPLE = `#!/usr/bin/env bash
set -euo pipefail
f() {
  local a=1
  echo "f $a" \\
    "cont"
}
if [ "\${1:-}" = x ]; then
  echo yes
elif [[ -n "\${2:-}" ]]; then
  echo two
else
  echo no
fi
for i in 1 2; do
  : "$i"
done
case "\${1:-}" in
  x) echo cx ;;
  *)
    echo other
    ;;
esac
while false; do echo never; done
x=$(echo sub)
cat <<HD >/dev/null
heredoc $x
line2
HD
f >/dev/null
(( n = 1 + 2 ))
[ "$n" -eq 3 ] && echo three || echo not
{ echo grp; }
( echo subshell )
echo a | tr a b
export E=1
declare -r R=2
`;

/** 見本の文の開始行。記録する種類の文だけで、関数の定義（3）・if・fi・for（15）・heredoc の本文（27・28）を含まない。 */
const SAMPLE_LINES = [
  2, 4, 5, 8, 9, 10, 11, 13, 16, 18, 19, 21, 24, 25, 26, 30, 31, 32, 33, 34, 35, 36, 37,
];

function writeSample(dir: string, name = "sample.sh", body = SAMPLE): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

/**
 * 計測を読み込ませた bash でスクリプトを実行する。`bashEnv` を渡すと、その計測のファイルを読ませる
 * （リポジトリの中に置いたコピーを読ませると、計測はそのリポジトリの scripts/・skills/ の下を原本とみなす）。
 */
function runTraced(args: string[], opts: { cwd: string; traceDir: string; bashEnv?: string }) {
  return spawnSync("bash", args, {
    cwd: opts.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      BASH_ENV: opts.bashEnv ?? TRACE_ENV,
      SHELL_COVERAGE_DIR: opts.traceDir,
    },
    timeout: 30_000,
  });
}

/** `root` を直下とするリポジトリの scripts/coverage/ に計測のファイルを置き、そのパスを返す。 */
function placeTraceEnv(root: string): string {
  mkdirSync(join(root, "scripts", "coverage"), { recursive: true });
  const path = join(root, "scripts", "coverage", "bash-trace-env.sh");
  copyFileSync(TRACE_ENV, path);
  return path;
}

test("executableLines: xtrace が記録する種類の文の開始行だけを、昇順で返す", () => {
  const dir = makeTempDir("shell-coverage-lines-");
  expect(executableLines(parseShell(writeSample(dir)))).toEqual(SAMPLE_LINES);
});

test("parseShell: shfmt で解析できないファイルは、判定できないとして例外にする", () => {
  const dir = makeTempDir("shell-coverage-parse-");
  expect(() => parseShell(writeSample(dir, "bad.sh", "if then fi (\n"))).toThrow(
    /shfmt で .* を解析できない/,
  );
});

test("shellCoverage: 実行しなかった分岐の行だけを未実行として数える", () => {
  const dir = makeTempDir("shell-coverage-run-");
  const traceDir = join(dir, "trace");
  mkdirSync(traceDir);
  writeSample(dir);
  const res = runTraced([join(dir, "sample.sh")], { cwd: dir, traceDir });
  expect(res.status).toBe(0);
  const { files } = shellCoverage(dir, ["sample.sh"], traceDir);
  // 実行しないのは echo yes（9）・echo two（11）・echo cx（19）だけ。echo never は false と同じ 24 行目にある。
  expect(files["sample.sh"]).toEqual({
    total: SAMPLE_LINES.length,
    covered: SAMPLE_LINES.length - 3,
    pct: 86.96,
    uncovered: [9, 11, 19],
  });
});

test("shellCoverage: 相対パスで起動したスクリプトも、起動したときの作業ディレクトリから解決して数える", () => {
  const dir = makeTempDir("shell-coverage-rel-");
  const traceDir = join(dir, "trace");
  mkdirSync(traceDir);
  mkdirSync(join(dir, "sub"));
  writeSample(join(dir, "sub"), "s.sh", "echo a\necho b\n");
  expect(runTraced(["sub/s.sh"], { cwd: dir, traceDir }).status).toBe(0);
  expect(shellCoverage(dir, ["sub/s.sh"], traceDir).files["sub/s.sh"]?.covered).toBe(2);
});

test("shellCoverage: 内容が原本と同じコピーの実行は、コピーを消した後も原本として数え、書き換えたコピーは数えない", () => {
  const root = makeTempDir("shell-coverage-copy-");
  const traceDir = join(root, "trace");
  mkdirSync(traceDir);
  writeSample(root, "orig.sh", "echo a\nif false; then\n  echo b\nfi\n");
  const same = makeTempDir("shell-coverage-copy-same-");
  copyFileSync(join(root, "orig.sh"), join(same, "orig.sh"));
  expect(runTraced([join(same, "orig.sh")], { cwd: same, traceDir }).status).toBe(0);
  rmSync(same, { recursive: true, force: true });

  const changed = makeTempDir("shell-coverage-copy-changed-");
  writeSample(changed, "orig.sh", "echo a\nif true; then\n  echo b\nfi\n");
  expect(runTraced([join(changed, "orig.sh")], { cwd: changed, traceDir }).status).toBe(0);

  const result = shellCoverage(root, ["orig.sh"], traceDir);
  // 書き換えたコピーは echo b（3）を実行するが、原本の記録にしない。
  expect(result.files["orig.sh"]?.uncovered).toEqual([3]);
  expect(result.unresolved).toBe(0);
});

test("shellCoverage: 対象の外のファイルの記録は数えず、消えたファイルの記録は unresolved に数える", () => {
  const root = makeTempDir("shell-coverage-other-");
  const traceDir = join(root, "trace");
  mkdirSync(traceDir);
  writeSample(root, "t.sh", "echo t\n");
  writeSample(root, "other.sh", "echo o\n");
  const gone = makeTempDir("shell-coverage-gone-");
  writeSample(gone, "g.sh", "echo g\n");
  expect(runTraced([join(root, "other.sh")], { cwd: root, traceDir }).status).toBe(0);
  // 隣の *.sh のハッシュが残らないよう、記録した後に書き換えてから消す。
  expect(runTraced([join(gone, "g.sh")], { cwd: gone, traceDir }).status).toBe(0);
  rmSync(gone, { recursive: true, force: true });
  const result = shellCoverage(root, ["t.sh"], traceDir);
  expect(result.files["t.sh"]?.covered).toBe(0);
  expect(result.unresolved).toBe(1);
});

test("bash-trace-env.sh: スクリプトの stdout・stderr・終了コードを変えない", () => {
  const dir = makeTempDir("shell-coverage-stderr-");
  const traceDir = join(dir, "trace");
  mkdirSync(traceDir);
  writeSample(dir, "e.sh", 'echo out\necho err >&2\nx=$(echo e2 >&2; echo v)\necho "$x"\nexit 3\n');
  const plain = spawnSync("bash", [join(dir, "e.sh")], { encoding: "utf8", timeout: 30_000 });
  const traced = runTraced([join(dir, "e.sh")], { cwd: dir, traceDir });
  const missing = runTraced([join(dir, "e.sh")], { cwd: dir, traceDir: join(dir, "no-such-dir") });
  for (const res of [traced, missing]) {
    expect({ status: res.status, stdout: res.stdout, stderr: res.stderr }).toEqual({
      status: 3,
      stdout: "out\nv\n",
      stderr: "err\ne2\n",
    });
  }
  expect(plain.stderr).toBe("err\ne2\n");
});

test("parseTrace: #CWD の前の記録・BASH_SOURCE が空の記録・改行で続いた本文を記録として読まない", () => {
  const text = [
    "+SHCOV\t/a.sh\t1\techo before-cwd",
    "#CWD\t/w",
    "#HASH\t/w/a.sh\t" + "0".repeat(64),
    "+SHCOV\t\t2\techo from-bash-c",
    "+SHCOV\ta.sh\t3\techo 'multi",
    "+SHCOV\tfake\t9\tline'",
    "++SHCOV\t/b.sh\t4\techo nested",
  ].join("\n");
  const trace = parseTrace(text);
  expect(trace.hits).toEqual([
    { source: "a.sh", cwd: "/w", line: 3 },
    { source: "fake", cwd: "/w", line: 9 },
    { source: "/b.sh", cwd: "/w", line: 4 },
  ]);
  expect(trace.hashes).toEqual(new Map([["/w/a.sh", "0".repeat(64)]]));
});

test("bash-trace-env.sh: 記録は 1 プロセス 1 ファイルで、起動したときの作業ディレクトリと隣の *.sh のハッシュを先頭に書く", () => {
  const dir = makeTempDir("shell-coverage-header-");
  const traceDir = join(dir, "trace");
  mkdirSync(traceDir);
  writeSample(dir, "h.sh", "echo h\n");
  writeSample(dir, "lib.sh", "echo lib\n");
  expect(runTraced([join(dir, "h.sh")], { cwd: dir, traceDir }).status).toBe(0);
  const trace = parseTrace(
    readFileSync(
      join(
        traceDir,
        spawnSync("ls", [traceDir], { encoding: "utf8", timeout: 30_000 }).stdout.trim(),
      ),
      "utf8",
    ),
  );
  expect([...trace.hashes.keys()].map((p) => relative(dir, p)).sort()).toEqual(["h.sh", "lib.sh"]);
  expect(trace.hits.map((h) => h.line)).toEqual([1]);
});

test("shellCoverage: 反復が 0 回の for の本体だけが未実行になり、for の行そのものは数えない", () => {
  const dir = makeTempDir("shell-coverage-for-");
  const traceDir = join(dir, "trace");
  mkdirSync(traceDir);
  writeSample(dir, "f.sh", 'arr=()\nfor i in "${arr[@]}"; do\n  echo "$i"\ndone\n');
  expect(runTraced([join(dir, "f.sh")], { cwd: dir, traceDir }).status).toBe(0);
  expect(shellCoverage(dir, ["f.sh"], traceDir).files["f.sh"]).toEqual({
    total: 2,
    covered: 1,
    pct: 50,
    uncovered: [3],
  });
});

test("shellCoverage: 内容が同じ対象が 2 つあれば、コピーの実行はどちらにも数える", () => {
  const root = makeTempDir("shell-coverage-twins-");
  const traceDir = join(root, "trace");
  mkdirSync(traceDir);
  mkdirSync(join(root, "a"));
  mkdirSync(join(root, "b"));
  writeSample(join(root, "a"), "t.sh", "echo t\n");
  writeSample(join(root, "b"), "t.sh", "echo t\n");
  const copy = makeTempDir("shell-coverage-twins-copy-");
  copyFileSync(join(root, "a", "t.sh"), join(copy, "t.sh"));
  expect(runTraced([join(copy, "t.sh")], { cwd: copy, traceDir }).status).toBe(0);
  rmSync(copy, { recursive: true, force: true });
  const { files } = shellCoverage(root, ["a/t.sh", "b/t.sh"], traceDir);
  expect([files["a/t.sh"]?.covered, files["b/t.sh"]?.covered]).toEqual([1, 1]);
});

test("shellCoverage: 内容が同じ対象の片方を原本のパスで起動しても、両方に数える（起動の方法で結果を変えない）", () => {
  // 原本はリポジトリの scripts/ の下に置き、計測のファイルもそのリポジトリの中から読ませる。
  // そうすると隣の *.sh のハッシュが書かれないので、実体のパスから内容の組に結び付ける処理だけで数える。
  const root = makeTempDir("shell-coverage-twins-direct-");
  const traceDir = join(root, "trace");
  mkdirSync(traceDir);
  const bashEnv = placeTraceEnv(root);
  for (const dir of ["a", "b"]) {
    mkdirSync(join(root, "scripts", dir));
    writeSample(join(root, "scripts", dir), "t.sh", "echo t\n");
  }
  const res = runTraced([join(root, "scripts", "a", "t.sh")], { cwd: root, traceDir, bashEnv });
  expect(res.status).toBe(0);
  const { files } = shellCoverage(root, ["scripts/a/t.sh", "scripts/b/t.sh"], traceDir);
  expect([files["scripts/a/t.sh"]?.covered, files["scripts/b/t.sh"]?.covered]).toEqual([1, 1]);
});

test("bash-trace-env.sh: リポジトリの scripts/・skills/ の下の原本を起動したときは、隣の *.sh のハッシュを書かない", () => {
  const root = makeTempDir("shell-coverage-root-");
  const traceDir = join(root, "trace");
  mkdirSync(traceDir);
  const bashEnv = placeTraceEnv(root);
  writeSample(join(root, "scripts"), "s.sh", "echo s\n");
  const res = runTraced([join(root, "scripts", "s.sh")], { cwd: root, traceDir, bashEnv });
  expect(res.status).toBe(0);
  const trace = parseTrace(
    readFileSync(
      join(
        traceDir,
        spawnSync("ls", [traceDir], { encoding: "utf8", timeout: 30_000 }).stdout.trim(),
      ),
      "utf8",
    ),
  );
  expect(trace.hashes.size).toBe(0);
  expect(trace.hits.map((h) => h.line)).toEqual([1]);
});
