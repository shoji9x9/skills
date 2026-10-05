// YAML の構文検査（lint-yaml.js）の回帰テスト（Issue #507）。
//
// 「該当が無い」を合格の根拠にする検査なので、壊れた YAML を置いて落ちる陽性コントロールと、
// 除外（起点直下の .agents / .claude / node_modules・gitignore）の内と外に同じ壊れた YAML を置いて
// 弁別できることを固定する。対象 0 件・git が使えない起点は成功に倒さない。

import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./lint-yaml.js";
import { makeTempDir } from "../lib/test-tmpdir.js";

const script = join(dirname(fileURLToPath(import.meta.url)), "lint-yaml.js");

const VALID = "name: ok\nlist:\n  - a\n  - b\n";
const MULTI_DOC = "a: 1\n---\nb: 2\n";
const BROKEN = "a: [1,\n";

/** 一時ディレクトリに git リポジトリを作り、files（相対パス → 内容）を置く。tracked に入れるものは add する。 */
function repo(files, { track = true, gitignore = null } = {}) {
  const dir = makeTempDir("lint-yaml-");
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q");
  if (gitignore !== null) writeFileSync(join(dir, ".gitignore"), gitignore);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  if (track) git("add", "-A");
  return dir;
}

function run(argv) {
  let stdout = "";
  let stderr = "";
  const status = main(argv, { out: (s) => (stdout += s), err: (s) => (stderr += s) });
  return { status, stdout, stderr };
}

test("陽性コントロール: 読める YAML（複数文書・.yaml・JSON の中身を含む）だけなら exit 0 で件数を出す", () => {
  const dir = repo({
    "a.yml": VALID,
    "nested/b.yaml": MULTI_DOC,
    "c.yml": '{"json": true}\n',
    "not-yaml.txt": BROKEN,
  });
  const r = run(["--root", dir]);
  expect(r.stderr).toBe("");
  expect(r.stdout).toContain("lint-yaml: 3 件を検査した");
  expect(r.status).toBe(0);
});

test("壊れた YAML を 1 件置くと exit 1 でそのファイルを名指しする", () => {
  const dir = repo({ "a.yml": VALID, "sub/broken.yml": BROKEN });
  const r = run(["--root", dir]);
  expect(r.stderr).toContain("sub/broken.yml: unexpected end of the stream");
  expect(r.stderr).toContain("2 件中 1 件を YAML として読めない");
  expect(r.status).toBe(1);
});

test("未追跡でも ignore されていない YAML は検査する（add 前の新規ファイルを見落とさない）", () => {
  const dir = repo({ "a.yml": VALID, "new.yml": BROKEN }, { track: false });
  const r = run(["--root", dir]);
  expect(r.stderr).toContain("new.yml:");
  expect(r.status).toBe(1);
});

test.each([[".agents/skills/x/a.yml"], [".claude/skills/y.yml"], ["node_modules/pkg/z.yml"]])(
  "起点直下の除外（%s）の中の壊れた YAML は見ないが、外に同じものがあれば落とす",
  (excluded) => {
    // `.agents/skills/x/` は `skills/x/` があるのでコピーとして除く。
    const inside = repo({ "a.yml": VALID, "skills/x/SKILL.md": "", [excluded]: BROKEN });
    const r = run(["--root", inside]);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("1 件を検査した");
    expect(r.status).toBe(0);

    // 同じ名前を起点直下でない階層に置くと除外しない（刈るのは起点直下だけ）
    const outside = repo({ "a.yml": VALID, [`deep/${excluded}`]: BROKEN });
    const o = run(["--root", outside]);
    expect(o.stderr).toContain(`deep/${excluded}:`);
    expect(o.status).toBe(1);
  },
);

test("rule と private skill（skills/ に同名の無い .agents/skills/<name>/）の実体は検査する", () => {
  const dir = repo({
    "a.yml": VALID,
    ".agents/rules/r.yml": BROKEN,
    ".agents/skills/priv/p.yml": BROKEN,
  });
  const r = run(["--root", dir]);
  expect(r.stderr).toContain(".agents/rules/r.yml:");
  expect(r.stderr).toContain(".agents/skills/priv/p.yml:");
  expect(r.status).toBe(1);
});

test("gitignore された壊れた YAML は見ない（手元の eval 出力で CI と食い違わない）", () => {
  const dir = repo(
    { "a.yml": VALID, "tests/x/iteration-1/eval-1/out.yml": BROKEN },
    { track: false, gitignore: "tests/*/iteration-*/eval-*/\n" },
  );
  const r = run(["--root", dir]);
  expect(r.stderr).toBe("");
  expect(r.stdout).toContain("1 件を検査した");
  expect(r.status).toBe(0);
});

test("作業ツリーで消した（未ステージの削除）追跡ファイルは読まない（ENOENT で赤くしない）", () => {
  const dir = repo({ "a.yml": VALID, "b.yml": VALID });
  rmSync(join(dir, "b.yml"));
  const r = run(["--root", dir]);
  expect(r.stderr).toBe("");
  expect(r.stdout).toContain("1 件を検査した");
  expect(r.status).toBe(0);
});

test("対象の YAML が 0 件なら exit 1（空振りを成功に倒さない）", () => {
  const dir = repo({ "readme.txt": "x\n" });
  const r = run(["--root", dir]);
  expect(r.stderr).toContain("対象の YAML が 0 件");
  expect(r.status).toBe(1);
});

test("起点が git リポジトリでなければ exit 2（列挙の失敗を 0 件に倒さない）", () => {
  const dir = makeTempDir("lint-yaml-nogit-");
  writeFileSync(join(dir, "a.yml"), BROKEN);
  const r = run(["--root", dir]);
  expect(r.stderr).toContain("YAML を列挙できない");
  expect(r.status).toBe(2);
});

test("ファイルを指定したらそれだけを検査する（lefthook 用）", () => {
  const dir = repo({ "a.yml": VALID, "broken.yml": BROKEN });
  const ok = run(["--root", dir, join(dir, "a.yml")]);
  expect(ok.stdout).toContain("1 件を検査した（指定したファイル）");
  expect(ok.status).toBe(0);
  const ng = run(["--root", dir, join(dir, "broken.yml")]);
  expect(ng.stderr).toContain("broken.yml:");
  expect(ng.status).toBe(1);
});

test("指定したファイルが無ければ exit 1", () => {
  const dir = repo({ "a.yml": VALID });
  const r = run([join(dir, "missing.yml")]);
  expect(r.stderr).toContain("ENOENT");
  expect(r.status).toBe(1);
});

test.each([[["--bogus"]], [["--root"]]])("使い方の誤り %j は exit 2", (argv) => {
  const r = run(argv);
  expect(r.stderr).toMatch(/^usage: node scripts\/gates\/lint-yaml\.js/m);
  expect(r.status).toBe(2);
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、壊れた YAML は exit 1、読めれば exit 0", () => {
  const dir = repo({ "a.yml": VALID, "broken.yml": BROKEN });
  const ng = spawnSync(process.execPath, [script, "--root", dir], { encoding: "utf8" });
  expect(ng.stderr).toContain("broken.yml:");
  expect(ng.status).toBe(1);
  const ok = spawnSync(process.execPath, [script, join(dir, "a.yml")], { encoding: "utf8" });
  expect(ok.stdout).toContain("1 件を検査した");
  expect(ok.status).toBe(0);
});
