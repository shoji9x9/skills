// box のトークンを取得するスクリプト（box-token.sh・box-oauth-init.sh）のテスト。
//
// curl は PATH の前に置いた偽物に差し替え、Box の API には接続しない。偽物は受け取った引数と、
// カレントディレクトリにある秘密のファイル（secret・refresh・code）の中身を記録し、決めた応答を返す。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                 |
// | -------------- | ------------------------------------------------------------------ |
// | トークンの出所 | BOX_ACCESS_TOKEN / 環境変数の refresh token / ファイル / どれも無い |
// | 必須の環境変数 | そろう / BOX_CLIENT_ID が無い / BOX_CLIENT_SECRET が無い            |
// | 保存先の書き方 | 指定なし / 絶対パス / 相対パス / 先頭が ~/                          |
// | HOME           | 絶対パス / 無い / 空 / 相対パス                                     |
// | 保存先に書けるか | 書ける / ディレクトリを作れない / ディレクトリに書けない / ファイルに書けない / ディレクトリに書けないがファイルに書ける |
// | 保存先の種類   | ファイル / 無い / ディレクトリ / 行き先の無いシンボリックリンク（行き先のディレクトリが在る・無い） / 循環するシンボリックリンク |
// | OS の登録      | ある / 無い（id -un が失敗する）                                    |
// | API の応答     | 成功（新しい refresh token あり・なし） / invalid_client / その他の error / token が無い |
// | TMPDIR         | 通常 / `=` を含む                                                   |
// | 認可コード     | stdin で渡す / 空 / 引数で渡す                                      |
//
// HOME が無いか空のときは、OS に登録されたホーム（テストを実行する人の本物のホーム）を使う。
// そこにある本物の refresh token を読み書きしないよう、refresh token は環境変数で渡し、mkdir を
// 引数を記録して失敗する偽物に差し替える。スクリプトは API を呼ぶ前に保存先のディレクトリを作るので、
// 偽物の mkdir が失敗すると、保存してある refresh token を読む前と API を呼ぶ前に止まる。
// 置き場所は mkdir の引数で確かめる。
// 止まることは、本物のホームで実行する前に、一時ディレクトリの HOME で毎回確かめる。置き場所に目印の値を置き、
// mkdir が呼ばれること、curl が呼ばれないこと、目印の値が出力に出ないこと、目印の値が書き換わらないことを見る。
// スクリプトが mkdir を呼ばない形や、止まる前にファイルを読んで API を呼ぶ形に変わったら、
// 本物のホームで実行せずにテストが失敗する。
// 本物のホームで実行した結果は真偽だけで比べ、curl と mkdir の記録や出力を assertion のメッセージに含めない。
// 本物のファイルの有無と中身は、実行の前後でハッシュを比べて確かめる。中身そのものは表示しない。
// OS にユーザーの登録が無い状態は、id -un を失敗する偽物に差し替えて作る。このとき bash の ~ は本物のホームを返すので、
// 本物のホームで実行するテストと同じく、偽物の mkdir と目印の値で、止まることを先に確かめる。
import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageEnv } from "../../lib/testing/coverage-env.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TOKEN_SCRIPT = join(repoRoot, "skills/box/scripts/box-token.sh");
const INIT_SCRIPT = join(repoRoot, "skills/box/scripts/box-oauth-init.sh");

// jq はユーザーのグローバル設定の mise から入ることがある。HOME を差し替えると mise の shim が
// 解決できないので、実体のパスを先に取得し、偽物と同じディレクトリにリンクを置く。
const JQ = spawnSync("bash", ["-c", "mise which jq 2>/dev/null || command -v jq"], {
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

type Setup = { dir: string; bin: string; log: string; home: string };

function setup(prefix: string): Setup {
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

function failMkdir(s: Setup) {
  writeFileSync(join(s.bin, "mkdir"), MKDIR_STUB);
  chmodSync(join(s.bin, "mkdir"), 0o755);
}

// 失敗する id。OS にユーザーの登録が無い状態を作る
function failId(s: Setup) {
  writeFileSync(join(s.bin, "id"), "#!/usr/bin/env bash\nexit 1\n");
  chmodSync(join(s.bin, "id"), 0o755);
}

// HOME が無いか空のときにスクリプトが使う、OS に登録されたホーム。
// OS にユーザーの登録が無いと userInfo() は例外を投げるので、使うテストの中でだけ求める
function databaseHome(): string {
  return userInfo().homedir;
}

// ファイルの有無と中身のハッシュ。本物の refresh token を比べるときに、中身を表示しないために使う
function fingerprint(path: string): string | null {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}

function run(
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

const CLIENT = { BOX_CLIENT_ID: "cid-1", BOX_CLIENT_SECRET: "sec-1" };

// root は権限に関わらず書き込めるので、書き込めない保存先を作れない
const IS_ROOT = process.getuid?.() === 0;

test("jq の実体を解決できる（解決できないと、以下のテストは応答を読めずに失敗する）", () => {
  expect(JQ).not.toBe("");
});

test("ユーザーのデータベースのホームが絶対パスに決まる（決まらないと、HOME が無いか空のテストが置き場所を確かめられない）", () => {
  expect(isAbsolute(databaseHome())).toBe(true);
});

// HOME が無いか空でも、OS に登録されたホームの下に置く状態。
// 4 番目の値はホームからの置き場所、5 番目の値はスクリプトが表示する HOME の状態
const DATABASE_HOME_CASES: [string, string | undefined, string | undefined, string, string][] = [
  [
    "HOME が無く、保存先の指定も無い",
    undefined,
    undefined,
    ".config/box/refresh_token",
    "HOME が無い。",
  ],
  [
    "HOME が空で、保存先の指定も無い",
    "",
    undefined,
    ".config/box/refresh_token",
    "HOME が空である。",
  ],
  ["HOME が空で、保存先が ~/ で始まる", "", "~/cfg/rt", "cfg/rt", "HOME が空である。"],
];

// 本物のホームで実行する前に、同じ環境で HOME だけを一時ディレクトリに替えて実行し、
// 偽物の mkdir が、保存してある refresh token を読む前と API を呼ぶ前に止めることを確かめる。
// 置き場所に目印の値を置いておき、mkdir を呼ばない形や、ファイルを読んで API を呼ぶ形に変わったら、ここで失敗させる
const MARKER = "rt-marker-in-temp-home";
function expectFakeMkdirStopsBeforeApi(
  script: string,
  prefix: string,
  env: Record<string, string | undefined>,
  input: string,
  relPath: string,
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
function expectStoppedAtRealHome(r: ReturnType<typeof run>, realDir: string, homeState: string) {
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

// 置き場所が絶対パスに決まらない状態
const UNDECIDED_CASES: [string, string | undefined][] = [
  ["保存先の指定が無い", undefined],
  ["保存先が ~/ で始まる", "~/cfg/rt"],
];

// 保存先に書き込めない状態。setup の後に、書き込めない保存先を作って、環境変数と保存先を返す。
// 最後の値は、保存先を決めた方法としてスクリプトが表示する文
type Unwritable = (s: Setup) => { env: Record<string, string>; file: string };
const UNWRITABLE_CASES: [string, Unwritable, string][] = [
  [
    "HOME のディレクトリに書き込めず、保存先のディレクトリを作れない",
    (s) => {
      const home = join(s.dir, "ro-home");
      mkdirSync(home);
      chmodSync(home, 0o555);
      return { env: { HOME: home }, file: join(home, ".config/box/refresh_token") };
    },
    "保存先は HOME から決めた。",
  ],
  [
    "BOX_REFRESH_TOKEN_FILE のディレクトリに書き込めない",
    (s) => {
      const dir = join(s.dir, "ro-dir");
      mkdirSync(dir);
      chmodSync(dir, 0o555);
      const file = join(dir, "rt");
      return { env: { BOX_REFRESH_TOKEN_FILE: file }, file };
    },
    "保存先は BOX_REFRESH_TOKEN_FILE で指定した。",
  ],
  [
    "BOX_REFRESH_TOKEN_FILE のファイルに書き込めない",
    (s) => {
      const file = join(s.dir, "rt-ro");
      writeFileSync(file, "rt-keep");
      chmodSync(file, 0o444);
      return { env: { BOX_REFRESH_TOKEN_FILE: file }, file };
    },
    "保存先は BOX_REFRESH_TOKEN_FILE で指定した。",
  ],
  [
    "BOX_REFRESH_TOKEN_FILE が既存のディレクトリ",
    (s) => {
      const file = join(s.dir, "rt-dir");
      mkdirSync(file);
      return { env: { BOX_REFRESH_TOKEN_FILE: file }, file };
    },
    "保存先は BOX_REFRESH_TOKEN_FILE で指定した。",
  ],
  [
    "保存先が ~/ だけで、ホームそのものを指す",
    (s) => ({ env: { BOX_REFRESH_TOKEN_FILE: "~/" }, file: `${s.home}/` }),
    "保存先は HOME から決めた。",
  ],
  [
    "BOX_REFRESH_TOKEN_FILE が、行き先のディレクトリが無いシンボリックリンク",
    (s) => {
      const file = join(s.dir, "rt-link");
      symlinkSync(join(s.dir, "missing-dir", "rt"), file);
      return { env: { BOX_REFRESH_TOKEN_FILE: file }, file };
    },
    "保存先は BOX_REFRESH_TOKEN_FILE で指定した。",
  ],
  [
    "BOX_REFRESH_TOKEN_FILE が、循環するシンボリックリンク",
    (s) => {
      const file = join(s.dir, "rt-loop-a");
      symlinkSync("rt-loop-b", file);
      symlinkSync("rt-loop-a", join(s.dir, "rt-loop-b"));
      return { env: { BOX_REFRESH_TOKEN_FILE: file }, file };
    },
    "保存先は BOX_REFRESH_TOKEN_FILE で指定した。",
  ],
];

// 行き先の無いシンボリックリンクを、別のディレクトリへの相対パスで 2 段置き、たどった先のディレクトリは在る状態。
// 書くと行き先にファイルができるので、保存できる（main の振る舞いと同じ）。保存先と、書かれる行き先を返す。
// 相対パスをリンクの置き場所ではなく実行したディレクトリから読むと、行き先のディレクトリが見つからない
function danglingLinkToExistingDir(s: Setup): { file: string; target: string } {
  for (const d of ["links", "mid", "store"]) mkdirSync(join(s.dir, d));
  const file = join(s.dir, "links", "rt");
  symlinkSync("../mid/rt-next", file);
  symlinkSync("../store/rt", join(s.dir, "mid", "rt-next"));
  return { file, target: join(s.dir, "store", "rt") };
}

// BOX_REFRESH_TOKEN_FILE に絶対パスを指定すれば、HOME を使わない状態
const EXPLICIT_FILE_CASES: [string, string | undefined][] = [
  ["HOME が無い場合", undefined],
  ["HOME が空の場合", ""],
  ["HOME が相対パスの場合", "rel"],
];

describe("box-token.sh", () => {
  test("BOX_ACCESS_TOKEN があれば、それを出して API を呼ばない", () => {
    const s = setup("box-token-");
    const r = run(TOKEN_SCRIPT, s, { env: { BOX_ACCESS_TOKEN: "dev-token" } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("dev-token");
    expect(r.log).toBe("");
    expect(existsSync(join(s.home, ".config")), "保存先のディレクトリを作った").toBe(false);
  });

  test.each([
    ["BOX_CLIENT_ID", { BOX_CLIENT_SECRET: "sec-1" }, /BOX_CLIENT_ID/],
    ["BOX_CLIENT_SECRET", { BOX_CLIENT_ID: "cid-1" }, /BOX_CLIENT_SECRET が未設定/],
  ])("%s が無ければ失敗し、API を呼ばない", (_name, env, message) => {
    const s = setup("box-token-");
    const r = run(TOKEN_SCRIPT, s, { env });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(message);
    expect(r.log).toBe("");
    expect(existsSync(join(s.home, ".config")), "保存先のディレクトリを作った").toBe(false);
  });

  test("refresh token がどこにも無ければ失敗し、参照したファイルを示す", () => {
    const s = setup("box-token-");
    const r = run(TOKEN_SCRIPT, s, { env: CLIENT });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refresh token が無い/);
    expect(r.stderr).toContain(join(s.home, ".config/box/refresh_token"));
    expect(r.log).toBe("");
    expect(existsSync(join(s.home, ".config")), "保存先のディレクトリを作った").toBe(false);
  });

  test("環境変数の refresh token の空白を除き、秘密の値を引数に載せずに送る。新しい refresh token を 0600 で保存する", () => {
    const s = setup("box-token-");
    const tokenFile = join(s.dir, "saved", "refresh_token");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN: " rt-old\r\n",
        BOX_REFRESH_TOKEN_FILE: tokenFile,
        STUB_RESPONSE: JSON.stringify({ access_token: "at-1", refresh_token: "rt-new" }),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("at-1");
    expect(r.log).toContain("arg:grant_type=refresh_token");
    expect(r.log).toContain("arg:client_id=cid-1");
    expect(r.log).toContain("arg:client_secret@secret");
    expect(r.log).toContain("arg:refresh_token@refresh");
    expect(r.log).toContain("file:refresh=rt-old");
    expect(r.log).toContain("file:secret=sec-1");
    expect(r.log).not.toMatch(/^arg:.*(sec-1|rt-old)/m);
    expect(readFileSync(tokenFile, "utf8")).toBe("rt-new");
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  });

  test("先頭が ~/ の保存先は HOME の下として読み書きする", () => {
    const s = setup("box-token-");
    const tokenFile = join(s.home, "box", "rt");
    mkdirSync(dirname(tokenFile));
    writeFileSync(tokenFile, "rt-file\n");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: "~/box/rt",
        STUB_RESPONSE: JSON.stringify({ access_token: "at-2", refresh_token: "rt-rotated" }),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("at-2");
    expect(r.log).toContain("file:refresh=rt-file");
    expect(readFileSync(tokenFile, "utf8")).toBe("rt-rotated");
  });

  test.each(DATABASE_HOME_CASES)(
    "%sなら、ユーザーのデータベースのホームの下に保存する",
    (_label, home, file, relPath, homeState) => {
      const env = {
        ...CLIENT,
        BOX_REFRESH_TOKEN: "rt-env",
        BOX_REFRESH_TOKEN_FILE: file,
        STUB_RESPONSE: JSON.stringify({ access_token: "at-5", refresh_token: "rt-new" }),
      };
      expectFakeMkdirStopsBeforeApi(TOKEN_SCRIPT, "box-token-", env, "", relPath);
      const real = join(databaseHome(), relPath);
      const before = fingerprint(real);
      const s = setup("box-token-");
      failMkdir(s);
      const r = run(TOKEN_SCRIPT, s, { env: { ...env, HOME: home } });
      // 偽物の mkdir が失敗するので、API を呼ぶ前に止まる
      expectStoppedAtRealHome(r, dirname(real), homeState);
      expect(fingerprint(real) === before, "本物の refresh token が変わった").toBe(true);
    },
  );

  test.each(DATABASE_HOME_CASES.slice(0, 2))(
    "%sとき、OS にユーザーの登録が無ければ、API を呼ばずに登録が無いことを示して止まる",
    (_label, home, file, relPath, homeState) => {
      const env = {
        ...CLIENT,
        BOX_REFRESH_TOKEN: "rt-env",
        BOX_REFRESH_TOKEN_FILE: file,
        STUB_RESPONSE: JSON.stringify({ access_token: "at-11", refresh_token: "rt-new" }),
      };
      expectFakeMkdirStopsBeforeApi(TOKEN_SCRIPT, "box-token-", env, "", relPath);
      const real = join(databaseHome(), relPath);
      const before = fingerprint(real);
      const s = setup("box-token-");
      failMkdir(s);
      failId(s);
      const r = run(TOKEN_SCRIPT, s, { env: { ...env, HOME: home } });
      expect(r.status === 1, "exit 1 にならない").toBe(true);
      expect(r.stdout === "", "標準出力に何か出た").toBe(true);
      expect(r.log === "", "保存先のディレクトリを作ろうとしたか、API を呼んだ").toBe(true);
      expect(
        r.stderr.includes(
          `refresh token の置き場所を絶対パスに決められない。${homeState}OS にこのユーザーの登録が無く、ホームを決められない。BOX_REFRESH_TOKEN_FILE に絶対パスを設定する`,
        ),
        "登録が無いことを示さない",
      ).toBe(true);
      expect(fingerprint(real) === before, "本物の refresh token が変わった").toBe(true);
    },
  );

  test("行き先の無いシンボリックリンクでも、たどった先のディレクトリに書ければ、行き先に保存する", () => {
    const s = setup("box-token-");
    const { file, target } = danglingLinkToExistingDir(s);
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN: "rt-env",
        BOX_REFRESH_TOKEN_FILE: file,
        STUB_RESPONSE: JSON.stringify({ access_token: "at-12", refresh_token: "rt-new" }),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("at-12");
    expect(readFileSync(target, "utf8")).toBe("rt-new");
  });

  test.each(UNDECIDED_CASES)(
    "HOME が相対パスで%sなら、API を呼ばずに BOX_REFRESH_TOKEN_FILE の設定を案内して止まる",
    (_label, file) => {
      const s = setup("box-token-");
      const r = run(TOKEN_SCRIPT, s, {
        env: {
          ...CLIENT,
          HOME: "rel",
          BOX_REFRESH_TOKEN: "rt-env",
          BOX_REFRESH_TOKEN_FILE: file,
          STUB_RESPONSE: JSON.stringify({ access_token: "at-6", refresh_token: "rt-new" }),
        },
      });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.log).toBe("");
      expect(r.stderr).toContain(
        "refresh token の置き場所を絶対パスに決められない。HOME=rel が絶対パスでない。BOX_REFRESH_TOKEN_FILE に絶対パスを設定する",
      );
      expect(r.stderr).not.toMatch(/OS に登録されたホーム/);
    },
  );

  test.each(EXPLICIT_FILE_CASES)(
    "%sも、BOX_REFRESH_TOKEN_FILE の絶対パスに保存する",
    (_label, home) => {
      const s = setup("box-token-");
      const tokenFile = join(s.dir, "saved", "rt");
      const r = run(TOKEN_SCRIPT, s, {
        env: {
          ...CLIENT,
          HOME: home,
          BOX_REFRESH_TOKEN: "rt-env",
          BOX_REFRESH_TOKEN_FILE: tokenFile,
          STUB_RESPONSE: JSON.stringify({ access_token: "at-7", refresh_token: "rt-new" }),
        },
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe("at-7");
      expect(readFileSync(tokenFile, "utf8")).toBe("rt-new");
    },
  );

  test.skipIf(IS_ROOT).each(UNWRITABLE_CASES)(
    "%sなら、API を呼ばずに理由と BOX_REFRESH_TOKEN_FILE の設定を案内して止まる",
    (_label, make, source) => {
      const s = setup("box-token-");
      const { env, file } = make(s);
      const r = run(TOKEN_SCRIPT, s, {
        env: {
          ...CLIENT,
          ...env,
          BOX_REFRESH_TOKEN: "rt-env",
          STUB_RESPONSE: JSON.stringify({ access_token: "at-9", refresh_token: "rt-new" }),
        },
      });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.log).not.toMatch(/^arg:/m);
      expect(r.stderr).toContain(`box-token: refresh token の保存先 ${file} に書き込めない`);
      expect(r.stderr).toContain(
        `${source}Box の API を呼ぶ前に止める。BOX_REFRESH_TOKEN_FILE に書き込める絶対パスを設定する`,
      );
    },
  );

  // 保存はファイルへ直接書くので、ファイルに書ければディレクトリに書けなくてもよい（main の振る舞いと同じ）
  test.skipIf(IS_ROOT)(
    "BOX_REFRESH_TOKEN_FILE のファイルに書ければ、ディレクトリに書けなくても読んで保存する",
    () => {
      const s = setup("box-token-");
      const dir = join(s.dir, "ro-dir");
      mkdirSync(dir);
      const tokenFile = join(dir, "rt");
      writeFileSync(tokenFile, "rt-file\n");
      chmodSync(dir, 0o555);
      const r = run(TOKEN_SCRIPT, s, {
        env: {
          ...CLIENT,
          BOX_REFRESH_TOKEN_FILE: tokenFile,
          STUB_RESPONSE: JSON.stringify({ access_token: "at-10", refresh_token: "rt-new" }),
        },
      });
      chmodSync(dir, 0o755);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe("at-10");
      expect(r.log).toContain("file:refresh=rt-file");
      expect(readFileSync(tokenFile, "utf8")).toBe("rt-new");
    },
  );

  test("BOX_REFRESH_TOKEN_FILE の相対パスは、実行したディレクトリからのパスとして保存する", () => {
    const s = setup("box-token-");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN: "rt-env",
        BOX_REFRESH_TOKEN_FILE: "saved/rt",
        STUB_RESPONSE: JSON.stringify({ access_token: "at-8", refresh_token: "rt-new" }),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("at-8");
    expect(readFileSync(join(s.dir, "saved", "rt"), "utf8")).toBe("rt-new");
    expect(existsSync(join(s.home, "saved", "rt"))).toBe(false);
  });

  test("応答に新しい refresh token が無ければ、保存してあるものを書き換えない", () => {
    const s = setup("box-token-");
    const tokenFile = join(s.dir, "rt");
    writeFileSync(tokenFile, "rt-keep");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: tokenFile,
        STUB_RESPONSE: JSON.stringify({ access_token: "at-3" }),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("at-3");
    expect(readFileSync(tokenFile, "utf8")).toBe("rt-keep");
  });

  test("TMPDIR が = を含んでも、秘密のファイルの中身を送る", () => {
    const s = setup("box-token-");
    const tmp = join(s.dir, "a=b");
    mkdirSync(tmp);
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        TMPDIR: tmp,
        BOX_REFRESH_TOKEN: "rt-eq",
        BOX_REFRESH_TOKEN_FILE: join(s.dir, "rt"),
        STUB_RESPONSE: JSON.stringify({ access_token: "at-4" }),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.log).toContain("file:refresh=rt-eq");
    expect(r.log).toContain("arg:refresh_token@refresh");
  });

  test.each([
    ["invalid_client", /client 認証に失敗しました/, /失効/],
    ["invalid_grant", /refresh token が失効している可能性があります/, /client 認証/],
  ])("API が %s を返したら失敗し、原因に合う案内を出す", (error, shown, notShown) => {
    const s = setup("box-token-");
    const tokenFile = join(s.dir, "rt");
    writeFileSync(tokenFile, "rt-keep");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: tokenFile,
        STUB_RESPONSE: JSON.stringify({ error, error_description: "desc-x" }),
      },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(`トークン更新失敗: ${error} - desc-x`);
    expect(r.stderr).toMatch(shown);
    expect(r.stderr).not.toMatch(notShown);
    expect(readFileSync(tokenFile, "utf8")).toBe("rt-keep");
  });

  test("応答に access_token が無ければ失敗する", () => {
    const s = setup("box-token-");
    const r = run(TOKEN_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN: "rt",
        BOX_REFRESH_TOKEN_FILE: join(s.dir, "rt"),
        STUB_RESPONSE: "{}",
      },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/access_token を取得できませんでした/);
  });
});

describe("box-oauth-init.sh", () => {
  test("引数で認可コードを渡すとエラーにし、API を呼ばない", () => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, { env: CLIENT, args: ["code-x"], input: "code-x\n" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/引数で渡しません/);
    expect(r.log).toBe("");
  });

  test("stdin の認可コードが空白だけなら失敗し、API を呼ばない", () => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, { env: CLIENT, input: " \r\n" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/認可コードが空です/);
    expect(r.log).toBe("");
  });

  test.each([
    ["BOX_CLIENT_ID", { BOX_CLIENT_SECRET: "sec-1" }],
    ["BOX_CLIENT_SECRET", { BOX_CLIENT_ID: "cid-1" }],
  ])("%s が無ければ失敗し、API を呼ばない", (name, env) => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, { env, input: "code-x\n" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`${name} が未設定`);
    expect(r.log).toBe("");
  });

  test.each([
    ["BOX_CLIENT_ID", { BOX_CLIENT_SECRET: "sec-1" }],
    ["BOX_CLIENT_SECRET", { BOX_CLIENT_ID: "cid-1" }],
  ])("%s が無ければ、保存先のディレクトリを作らずに止まる", (name, env) => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, { env, input: "code-x\n" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`${name} が未設定`);
    expect(existsSync(join(s.home, ".config")), "保存先のディレクトリを作った").toBe(false);
  });

  test("認可コードを引数に載せずに交換し、refresh token を ~/ の保存先へ 0600 で保存する", () => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: "~/cfg/rt",
        STUB_RESPONSE: JSON.stringify({ access_token: "abcde", refresh_token: "rt-init" }),
      },
      input: " code-x\r\n",
    });
    expect(r.status, r.stderr).toBe(0);
    const tokenFile = join(s.home, "cfg", "rt");
    expect(readFileSync(tokenFile, "utf8")).toBe("rt-init");
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(r.stdout).toContain(`refresh_token を ${tokenFile} に保存しました（access_token 長=5）`);
    expect(r.log).toContain("arg:grant_type=authorization_code");
    expect(r.log).toContain("arg:code@code");
    expect(r.log).toContain("arg:redirect_uri=https://app.box.com");
    expect(r.log).toContain("file:code=code-x");
    expect(r.log).toContain("file:secret=sec-1");
    expect(r.log).not.toMatch(/^arg:.*(sec-1|code-x)/m);
  });

  test.each(DATABASE_HOME_CASES)(
    "%sなら、ユーザーのデータベースのホームの下に保存する",
    (_label, home, file, relPath, homeState) => {
      const env = {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: file,
        STUB_RESPONSE: JSON.stringify({ access_token: "a", refresh_token: "rt-init" }),
      };
      expectFakeMkdirStopsBeforeApi(INIT_SCRIPT, "box-init-", env, "code-x\n", relPath);
      const real = join(databaseHome(), relPath);
      const before = fingerprint(real);
      const s = setup("box-init-");
      failMkdir(s);
      const r = run(INIT_SCRIPT, s, { env: { ...env, HOME: home }, input: "code-x\n" });
      // 偽物の mkdir が失敗するので、API を呼ぶ前に止まる
      expectStoppedAtRealHome(r, dirname(real), homeState);
      expect(fingerprint(real) === before, "本物の refresh token が変わった").toBe(true);
    },
  );

  test.each(DATABASE_HOME_CASES.slice(0, 2))(
    "%sとき、OS にユーザーの登録が無ければ、認可コードを読む前に登録が無いことを示して止まる",
    (_label, home, file, relPath, homeState) => {
      const env = {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: file,
        STUB_RESPONSE: JSON.stringify({ access_token: "a", refresh_token: "rt-init" }),
      };
      expectFakeMkdirStopsBeforeApi(INIT_SCRIPT, "box-init-", env, "code-x\n", relPath);
      const real = join(databaseHome(), relPath);
      const before = fingerprint(real);
      const s = setup("box-init-");
      failMkdir(s);
      failId(s);
      // 認可コードを空にする。先に認可コードを読む実装なら、認可コードが空だというエラーで止まる
      const r = run(INIT_SCRIPT, s, { env: { ...env, HOME: home }, input: "" });
      expect(r.status === 1, "exit 1 にならない").toBe(true);
      expect(r.log === "", "保存先のディレクトリを作ろうとしたか、API を呼んだ").toBe(true);
      expect(
        r.stderr.includes(
          `refresh token の置き場所を絶対パスに決められない。${homeState}OS にこのユーザーの登録が無く、ホームを決められない。BOX_REFRESH_TOKEN_FILE に絶対パスを設定する`,
        ),
        "登録が無いことを示さない",
      ).toBe(true);
      expect(r.stderr.includes("認可コードが空です"), "認可コードを先に読んだ").toBe(false);
      expect(fingerprint(real) === before, "本物の refresh token が変わった").toBe(true);
    },
  );

  test("行き先の無いシンボリックリンクでも、たどった先のディレクトリに書ければ、行き先に保存する", () => {
    const s = setup("box-init-");
    const { file, target } = danglingLinkToExistingDir(s);
    const r = run(INIT_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: file,
        STUB_RESPONSE: JSON.stringify({ access_token: "a", refresh_token: "rt-init" }),
      },
      input: "code-x\n",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(target, "utf8")).toBe("rt-init");
  });

  test.each(UNDECIDED_CASES)(
    "HOME が相対パスで%sなら、認可コードを読む前に BOX_REFRESH_TOKEN_FILE の設定を案内して止まる",
    (_label, file) => {
      const s = setup("box-init-");
      // 認可コードを空にする。先に認可コードを読む実装なら、認可コードが空だというエラーで止まる
      const r = run(INIT_SCRIPT, s, {
        env: {
          ...CLIENT,
          HOME: "rel",
          BOX_REFRESH_TOKEN_FILE: file,
          STUB_RESPONSE: JSON.stringify({ access_token: "a", refresh_token: "rt-init" }),
        },
        input: "",
      });
      expect(r.status).toBe(1);
      expect(r.log).toBe("");
      expect(r.stderr).toContain(
        "refresh token の置き場所を絶対パスに決められない。HOME=rel が絶対パスでない。BOX_REFRESH_TOKEN_FILE に絶対パスを設定する",
      );
      expect(r.stderr).not.toMatch(/OS に登録されたホーム/);
      expect(r.stderr).not.toMatch(/認可コードが空です/);
    },
  );

  test.each(EXPLICIT_FILE_CASES)(
    "%sも、BOX_REFRESH_TOKEN_FILE の絶対パスに保存する",
    (_label, home) => {
      const s = setup("box-init-");
      const tokenFile = join(s.dir, "saved", "rt");
      const r = run(INIT_SCRIPT, s, {
        env: {
          ...CLIENT,
          HOME: home,
          BOX_REFRESH_TOKEN_FILE: tokenFile,
          STUB_RESPONSE: JSON.stringify({ access_token: "a", refresh_token: "rt-init" }),
        },
        input: "code-x\n",
      });
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(tokenFile, "utf8")).toBe("rt-init");
      expect(r.stdout).toContain(`refresh_token を ${tokenFile} に保存しました`);
    },
  );

  test.skipIf(IS_ROOT).each(UNWRITABLE_CASES)(
    "%sなら、認可コードを読む前に理由と BOX_REFRESH_TOKEN_FILE の設定を案内して止まる",
    (_label, make, source) => {
      const s = setup("box-init-");
      const { env, file } = make(s);
      // 認可コードを空にする。先に認可コードを読む実装なら、認可コードが空だというエラーで止まる
      const r = run(INIT_SCRIPT, s, {
        env: {
          ...CLIENT,
          ...env,
          STUB_RESPONSE: JSON.stringify({ access_token: "a", refresh_token: "rt-init" }),
        },
        input: "",
      });
      expect(r.status).toBe(1);
      expect(r.log).not.toMatch(/^arg:/m);
      expect(r.stderr).toContain(`box-oauth-init: refresh token の保存先 ${file} に書き込めない`);
      expect(r.stderr).toContain(
        `${source}Box の API を呼ぶ前に止める。BOX_REFRESH_TOKEN_FILE に書き込める絶対パスを設定する`,
      );
      expect(r.stderr).not.toMatch(/認可コードが空です/);
    },
  );

  // 保存はファイルへ直接書くので、ファイルに書ければディレクトリに書けなくてもよい（main の振る舞いと同じ）
  test.skipIf(IS_ROOT)(
    "BOX_REFRESH_TOKEN_FILE のファイルに書ければ、ディレクトリに書けなくても保存する",
    () => {
      const s = setup("box-init-");
      const dir = join(s.dir, "ro-dir");
      mkdirSync(dir);
      const tokenFile = join(dir, "rt");
      writeFileSync(tokenFile, "rt-old");
      chmodSync(dir, 0o555);
      const r = run(INIT_SCRIPT, s, {
        env: {
          ...CLIENT,
          BOX_REFRESH_TOKEN_FILE: tokenFile,
          STUB_RESPONSE: JSON.stringify({ access_token: "a", refresh_token: "rt-init" }),
        },
        input: "code-x\n",
      });
      chmodSync(dir, 0o755);
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(tokenFile, "utf8")).toBe("rt-init");
      expect(r.stdout).toContain(`refresh_token を ${tokenFile} に保存しました`);
    },
  );

  test("BOX_REFRESH_TOKEN_FILE の相対パスは、実行したディレクトリからのパスとして保存する", () => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: "saved/rt",
        STUB_RESPONSE: JSON.stringify({ access_token: "a", refresh_token: "rt-init" }),
      },
      input: "code-x\n",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(s.dir, "saved", "rt"), "utf8")).toBe("rt-init");
    expect(existsSync(join(s.home, "saved", "rt"))).toBe(false);
  });

  test("BOX_REDIRECT_URI を指定すれば、その値を送る", () => {
    const s = setup("box-init-");
    const r = run(INIT_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REDIRECT_URI: "http://localhost:8080",
        BOX_REFRESH_TOKEN_FILE: join(s.dir, "rt"),
        STUB_RESPONSE: JSON.stringify({ access_token: "a", refresh_token: "r" }),
      },
      input: "code-x\n",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.log).toContain("arg:redirect_uri=http://localhost:8080");
  });

  test.each([
    ["invalid_client", /client 認証に失敗しました/, /約30秒で失効/],
    ["invalid_grant", /約30秒で失効/, /client 認証/],
  ])("API が %s を返したら失敗し、原因に合う案内を出す。保存はしない", (error, shown, notShown) => {
    const s = setup("box-init-");
    const tokenFile = join(s.dir, "rt");
    const r = run(INIT_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: tokenFile,
        STUB_RESPONSE: JSON.stringify({ error, error_description: "desc-y" }),
      },
      input: "code-x\n",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`トークン交換失敗: ${error} - desc-y`);
    expect(r.stderr).toMatch(shown);
    expect(r.stderr).not.toMatch(notShown);
    expect(existsSync(tokenFile)).toBe(false);
  });

  test("応答に refresh_token が無ければ失敗し、保存しない", () => {
    const s = setup("box-init-");
    const tokenFile = join(s.dir, "rt");
    const r = run(INIT_SCRIPT, s, {
      env: {
        ...CLIENT,
        BOX_REFRESH_TOKEN_FILE: tokenFile,
        STUB_RESPONSE: JSON.stringify({ access_token: "a" }),
      },
      input: "code-x\n",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refresh_token を取得できませんでした/);
    expect(existsSync(tokenFile)).toBe(false);
  });
});
