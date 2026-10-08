// run-on-sources.js（CI の Shell lint・JSON lint の対象選び）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸                 | 値                                                                         |
// | ------------------ | -------------------------------------------------------------------------- |
// | ファイルの場所     | 実体 / rule / private skill / スキルのコピー / .claude/ / node_modules/     |
// | git の状態         | 追跡 / 未追跡（ignore されない）/ ignore される / 追跡したまま作業ツリーで削除 |
// | ファイルの種類     | 通常のファイル / シンボリックリンク                                          |
// | 拡張子             | 一致 / 不一致 / 複数指定                                                    |
// | 引数               | 正しい / --ext が無い / コマンドが無い                                       |
// | 対象の件数・結果   | 0 件 / 1 件以上でコマンドが成功 / 失敗 / 起動できない                         |
import { expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listSources, main } from "./run-on-sources.js";
import { makeTempDir } from "../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/gates/run-on-sources.js");

function makeRepo(files) {
  const root = makeTempDir("run-on-sources-");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const git = (root, ...args) => execFileSync("git", args, { cwd: root });

test("実体（rule・private skill を含む）だけを選び、コピー・リンク・node_modules・ignore・削除済み・シンボリックリンク・拡張子違いは選ばない", () => {
  const root = makeRepo({
    "a.sh": "",
    "skills/pub/s.sh": "",
    ".agents/skills/pub/s.sh": "",
    ".agents/skills/priv/p.sh": "",
    ".agents/rules/r.sh": "",
    ".claude/skills/c.sh": "",
    ".claude/hooks/h.sh": "",
    "node_modules/m.sh": "",
    "gen/g.sh": "",
    ".gitignore": "gen/\n",
    "gone.sh": "",
    "x.json": "",
  });
  symlinkSync(join(root, "a.sh"), join(root, "link.sh"));
  git(root, "add", "-A");
  rmSync(join(root, "gone.sh"));
  writeFileSync(join(root, "untracked.sh"), "");
  expect(listSources(root, ["sh"])).toEqual([
    ".agents/rules/r.sh",
    ".agents/skills/priv/p.sh",
    ".claude/hooks/h.sh",
    "a.sh",
    "skills/pub/s.sh",
    "untracked.sh",
  ]);
  expect(listSources(root, ["sh", "json"])).toContain("x.json");
});

test("対象をコマンドの引数に渡し、コマンドの終了コードを返す", () => {
  const root = makeRepo({ "a.sh": "" });
  expect(main(["--ext", "sh", "--", "true"], root)).toBe(0);
  expect(main(["--ext", "sh", "--", "false"], root)).toBe(1);
});

test("対象が 0 件・引数の誤り・コマンドを起動できないときは exit 2", () => {
  const root = makeRepo({ "a.sh": "" });
  expect(main(["--ext", "json", "--", "true"], root)).toBe(2);
  expect(main(["--", "true"], root)).toBe(2);
  expect(main(["--ext", "sh"], root)).toBe(2);
  expect(main(["--ext", "sh", "--", "no-such-command-xyz"], root)).toBe(2);
});

test("陽性（CLI）: 子プロセスとして起動しても、private skill のファイルをコマンドに渡す", () => {
  const root = makeRepo({ ".agents/skills/priv/p.sh": "" });
  const r = spawnSync(process.execPath, [script, "--ext", "sh", "--", "echo"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toBe(".agents/skills/priv/p.sh");
});
