// 配布スキルの原本（skills/<name>/）とインストール済みのコピー（.agents/skills/<name>/）の一致検査の回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                          | 値                                                                              |
// | --------------------------- | ------------------------------------------------------------------------------- |
// | インストール済みのコピー    | あり / 無い                                                                     |
// | Claude Code 用のリンク      | 正しい指し先 / 別の指し先 / リンクでない実体 / 無い / 調べられない（親がファイル） |
// | SKILL.md 以外のファイル     | 同じ / 中身が違う / コピーに無い / コピーにだけある                             |
// | SKILL.md                    | キーの順・local-path・閉じた後の空行だけが違う / 本文が違う / frontmatter が読めない |
// | .agents/skills だけにある名前 | 印あり（リンクも見る）/ 印なし                                                 |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-skills-sync.ts");

const SRC_SKILL = '---\nname: a\ndescription: "x"\n---\n\n# A\n\n本文\n';
// gh skill install が書き換えた形（キーの順・metadata.local-path・閉じた後の空行）。
const INSTALLED_SKILL =
  '---\ndescription: "x"\nname: a\nmetadata:\n  local-path: skills/a\n---\n# A\n\n本文\n';

function write(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function link(root: string, path: string, target: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  symlinkSync(target, join(root, path));
}

/** skills/a とそのコピー・リンクが一致した状態のリポジトリを作る。 */
function makeRepo() {
  const root = makeTempDir("skills-sync-");
  write(root, "skills/a/SKILL.md", SRC_SKILL);
  write(root, "skills/a/references/r.md", "r\n");
  write(root, "skills/README.md", "ディレクトリではないので見ない\n");
  write(root, ".agents/skills/a/SKILL.md", INSTALLED_SKILL);
  write(root, ".agents/skills/a/references/r.md", "r\n");
  link(root, ".claude/skills/a", "../../.agents/skills/a");
  return root;
}

const run = (cwd: string) =>
  spawnSync(process.execPath, [script], { cwd, encoding: "utf8", timeout: 30_000 });

test("陰性: インストールで書き換わる SKILL.md の frontmatter の違いだけなら OK で exit 0", () => {
  const r = run(makeRepo());
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("skills-sync: OK");
});

test("陰性: 印のある private skill は skills/ に無くても、リンクが正しければ OK", () => {
  const root = makeRepo();
  write(root, ".agents/skills/priv/.private-skill", "");
  write(root, ".agents/skills/priv/SKILL.md", SRC_SKILL);
  link(root, ".claude/skills/priv", "../../.agents/skills/priv");
  const r = run(root);
  expect(r.status).toBe(0);
});

test.each([
  [
    "インストール済みのコピーが無い",
    (root: string) => write(root, "skills/b/SKILL.md", SRC_SKILL),
    "b: missing installed copy under .agents/skills/",
  ],
  [
    "SKILL.md 以外のファイルの中身が違う",
    (root: string) => write(root, ".agents/skills/a/references/r.md", "changed\n"),
    "a: references/r.md differs",
  ],
  [
    "原本のファイルがコピーに無い",
    (root: string) => write(root, "skills/a/references/new.md", "n\n"),
    "a: references/new.md missing in installed copy",
  ],
  [
    "コピーにだけファイルがある",
    (root: string) => write(root, ".agents/skills/a/old.md", "o\n"),
    "a: old.md exists only in installed copy (stale)",
  ],
  [
    "SKILL.md の本文が違う",
    (root: string) => write(root, ".agents/skills/a/SKILL.md", INSTALLED_SKILL + "追記\n"),
    "a: SKILL.md content differs",
  ],
  [
    "SKILL.md の frontmatter の値が違う",
    (root: string) =>
      write(root, ".agents/skills/a/SKILL.md", INSTALLED_SKILL.replace('"x"', '"y"')),
    "a: SKILL.md content differs",
  ],
  [
    "印の無い名前が .agents/skills にだけある",
    (root: string) => write(root, ".agents/skills/gone/SKILL.md", SRC_SKILL),
    "gone: exists under .agents/skills/ but not skills/",
  ],
  [
    "Claude Code 用のリンクが無い",
    (root: string) => {
      write(root, "skills/b/SKILL.md", SRC_SKILL);
      write(root, ".agents/skills/b/SKILL.md", SRC_SKILL);
    },
    "b: missing Claude symlink under .claude/skills/",
  ],
  [
    "Claude Code 用のリンクが別の場所を指す",
    (root: string) => {
      write(root, "skills/b/SKILL.md", SRC_SKILL);
      write(root, ".agents/skills/b/SKILL.md", SRC_SKILL);
      link(root, ".claude/skills/b", "../../.agents/skills/a");
    },
    "b: .claude/skills/b points to ../../.agents/skills/a, expected ../../.agents/skills/b",
  ],
  [
    "Claude Code 用の場所にリンクではなく実体がある",
    (root: string) => {
      write(root, "skills/b/SKILL.md", SRC_SKILL);
      write(root, ".agents/skills/b/SKILL.md", SRC_SKILL);
      write(root, ".claude/skills/b/SKILL.md", SRC_SKILL);
    },
    "b: .claude/skills/b is not a symlink",
  ],
  [
    "印のある private skill の Claude Code 用のリンクが無い",
    (root: string) => {
      write(root, ".agents/skills/priv/.private-skill", "");
      write(root, ".agents/skills/priv/SKILL.md", SRC_SKILL);
    },
    "priv: missing Claude symlink under .claude/skills/",
  ],
])("陽性: %sなら drift として exit 1", (_label, mutate, expected) => {
  const root = makeRepo();
  mutate(root);
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("skills-sync: DRIFT");
  expect(r.stderr).toContain(expected);
});

test("陽性: リンクを調べられない（.claude/skills がファイル）なら、理由を付けて drift にする", () => {
  const root = makeTempDir("skills-sync-");
  write(root, "skills/a/SKILL.md", SRC_SKILL);
  write(root, ".agents/skills/a/SKILL.md", SRC_SKILL);
  write(root, ".claude/skills", "ディレクトリではない\n");
  const r = run(root);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("a: cannot inspect .claude/skills/a:");
});

test.each([
  ["原本", "skills/a/SKILL.md"],
  ["コピー", ".agents/skills/a/SKILL.md"],
])(
  "%sの SKILL.md の frontmatter が YAML として読めなければ、そのファイルを示して exit 2",
  (_label, path) => {
    const root = makeRepo();
    write(root, path, "---\nname: a\ndescription: A: B\n---\n\n# A\n\n本文\n");
    const r = run(root);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`skills-sync: invalid YAML frontmatter in ${path}:`);
  },
);
