// box-token.test.ts のヘルパー。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { coverageEnv } from "../../lib/testing/coverage-env.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const TOKEN_SCRIPT = join(repoRoot, "skills/box/scripts/box-token.sh");
export const INIT_SCRIPT = join(repoRoot, "skills/box/scripts/box-oauth-init.sh");

// jq はユーザーのグローバル設定の mise から入ることがある。HOME を差し替えると mise の shim が
// 解決できないので、実体のパスを先に取得し、偽物と同じディレクトリにリンクを置く。
export const JQ = spawnSync("bash", ["-c", "mise which jq 2>/dev/null || command -v jq"], {
  cwd: repoRoot,
  encoding: "utf8",
  timeout: CHILD_TIMEOUT_MS,
}).stdout.trim();

const CURL_STUB = `#!/usr/bin/env bash
log="$STUB_LOG"
for a in "$@"; do printf 'arg:%s\\n' "$a" >>"$log"; done
for f in secret refresh code; do
  if [ -f "$f" ]; then printf 'file:%s=%s\\n' "$f" "$(cat "$f")" >>"$log"; fi
done
printf '%s' "$STUB_RESPONSE"
`;

export type Setup = { dir: string; bin: string; log: string; home: string };

export function setup(prefix: string): Setup {
  const dir = makeTempDir(prefix);
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(join(bin, "curl"), CURL_STUB);
  chmodSync(join(bin, "curl"), 0o755);
  if (JQ) symlinkSync(JQ, join(bin, "jq"));
  return { dir, bin, log: join(dir, "curl.log"), home };
}

// 引数を記録して失敗する mkdir。refresh token を保存する直前で止める
const MKDIR_STUB = `#!/usr/bin/env bash
for a in "$@"; do printf 'mkdir:%s\\n' "$a" >>"$STUB_LOG"; done
exit 1
`;

export function failMkdir(s: Setup) {
  writeFileSync(join(s.bin, "mkdir"), MKDIR_STUB);
  chmodSync(join(s.bin, "mkdir"), 0o755);
}

// 失敗する id。OS にユーザーの登録が無い状態を作る
export function failId(s: Setup) {
  writeFileSync(join(s.bin, "id"), "#!/usr/bin/env bash\nexit 1\n");
  chmodSync(join(s.bin, "id"), 0o755);
}

// HOME が無いか空のときにスクリプトが使う、OS に登録されたホーム。
// OS にユーザーの登録が無いと userInfo() は例外を投げるので、使うテストの中でだけ求める
export function databaseHome(): string {
  return userInfo().homedir;
}

// ファイルの有無と中身のハッシュ。本物の refresh token を比べるときに、中身を表示しないために使う
export function fingerprint(path: string): string | null {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}

export function run(
  script: string,
  s: Setup,
  {
    env = {},
    args = [],
    input = "",
  }: { env?: Record<string, string | undefined>; args?: string[]; input?: string } = {},
) {
  // 値が undefined の変数は、子プロセスに渡さない（HOME が無い状態を作る）
  const merged: Record<string, string | undefined> = {
    PATH: `${s.bin}:${process.env.PATH}`,
    HOME: s.home,
    TMPDIR: s.dir,
    STUB_LOG: s.log,
    ...coverageEnv(),
    ...env,
  };
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) childEnv[k] = v;
  // 相対パスの置き場所に書いても、リポジトリではなく一時ディレクトリの下に入るようにする
  const r = spawnSync("bash", [script, ...args], {
    cwd: s.dir,
    encoding: "utf8",
    input,
    env: childEnv,
    timeout: CHILD_TIMEOUT_MS,
  });
  const log = existsSync(s.log) ? readFileSync(s.log, "utf8") : "";
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, log };
}

// 本物のホームで実行する前に、同じ環境で HOME だけを一時ディレクトリに替えて実行し、
// 偽物の mkdir が、保存してある refresh token を読む前と API を呼ぶ前に止めることを確かめる。
// 置き場所に目印の値を置いておき、mkdir を呼ばない形や、ファイルを読んで API を呼ぶ形に変わったら、ここで失敗させる
const MARKER = "rt-marker-in-temp-home";
export function expectFakeMkdirStopsBeforeApi(
  script: string,
  {
    prefix,
    env,
    input,
    relPath,
  }: { prefix: string; env: Record<string, string | undefined>; input: string; relPath: string },
) {
  const g = setup(prefix);
  failMkdir(g);
  const target = join(g.home, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, MARKER);
  const r = run(script, g, { env: { ...env, HOME: g.home }, input });
  expect(r.status, "偽物の mkdir が失敗しても止まらない").toBe(1);
  expect(r.log, "偽物の mkdir が呼ばれない").toContain(`mkdir:${dirname(target)}\n`);
  expect(r.log, "API を呼ぶ前に止まらない").not.toMatch(/^arg:/m);
  expect(`${r.log}${r.stdout}${r.stderr}`, "置き場所のファイルの中身が出力に出た").not.toContain(
    MARKER,
  );
  expect(readFileSync(target, "utf8"), "置き場所のファイルを書き換えた").toBe(MARKER);
}

// 本物のホームで実行した結果を、記録や出力をメッセージに含めずに確かめる
export function expectStoppedAtRealHome(
  r: ReturnType<typeof run>,
  realDir: string,
  homeState: string,
) {
  expect(r.status === 1, "保存先を作れないのに exit 1 にならない").toBe(true);
  expect(r.stdout === "", "標準出力に何か出た").toBe(true);
  expect(/^arg:/m.test(r.log), "API を呼んだ").toBe(false);
  expect(r.log.includes(`mkdir:${realDir}\n`), "OS に登録されたホームの下に作ろうとしない").toBe(
    true,
  );
  expect(r.stderr.includes("に書き込めない"), "書き込めないことを示さない").toBe(true);
  expect(
    r.stderr.includes(`${homeState}保存先は、OS に登録されたホームから決めた。`),
    "HOME の状態と、保存先を決めた方法を示さない",
  ).toBe(true);
}

// 行き先の無いシンボリックリンクを、別のディレクトリへの相対パスで 2 段置き、たどった先のディレクトリは在る状態。
// 書くと行き先にファイルができるので、保存できる（main の振る舞いと同じ）。保存先と、書かれる行き先を返す。
// 相対パスをリンクの置き場所ではなく実行したディレクトリから読むと、行き先のディレクトリが見つからない
export function danglingLinkToExistingDir(s: Setup): { file: string; target: string } {
  for (const d of ["links", "mid", "store"]) mkdirSync(join(s.dir, d));
  const file = join(s.dir, "links", "rt");
  symlinkSync("../mid/rt-next", file);
  symlinkSync("../store/rt", join(s.dir, "mid", "rt-next"));
  return { file, target: join(s.dir, "store", "rt") };
}

// id が PATH に無い状態。bash だけを置いたディレクトリを作り、PATH をそこと偽物のディレクトリだけにする。
// HOME が無いと、スクリプトは OS の登録を確かめる前に止まるので、bash のほかのコマンドは要らない
export function pathWithoutId(s: Setup): string {
  const only = join(s.dir, "only-bash");
  mkdirSync(only);
  const bash = (process.env.PATH ?? "")
    .split(":")
    .map((d) => join(d, "bash"))
    .find((p) => existsSync(p));
  if (!bash) throw new Error("PATH に bash が無い");
  symlinkSync(bash, join(only, "bash"));
  return `${s.bin}:${only}`;
}
