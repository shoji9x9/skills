// 変えたスキルに判定に使うケース（split: judge）があるかを確かめるチェックのテスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸                 | 値                                                                                       |
// | ------------------ | ---------------------------------------------------------------------------------------- |
// | 変えたファイル     | SKILL.md / references / scripts / evals.json / fixture / skill-config / vendor / 全体のコピー / region のコピー / インストール済みのコピー / skills の直下 |
// | 件数               | 0 件 / 1 件 / 同じスキルの複数のファイル / 複数のスキル                                    |
// | evals.json         | judge あり / improve だけ / split なし / 無い / JSON でない / evals が配列でない           |
// | スキルのディレクトリ | ある / 消した                                                                           |
// | identical-copies   | 正しい / 読めない（形の検査は check-identical-copies.ts の parseGroups が持つ）          |
// | 引数               | ファイル / 無い / --changed-since <ref> / --changed-since=<ref> / ref が無い / ファイルと併用 / 差分を取れない |
import { rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { gitInit, REPO_ROOT, write } from "../../lib/testing/repo-file.ts";
import { main, skillsToCheck, splitViolation, wholeFileCopies } from "./check-eval-split.ts";
import { DECLARATION_PATH, parseGroups } from "./copies/check-identical-copies.ts";

const COPIES = {
  groups: [
    { files: ["skills/a/references/shared.md", "skills/b/references/shared.md"], reason: "r" },
    {
      files: ["skills/a/scripts/tool.mjs", "skills/b/assets/tool.template.mjs"],
      region: "helper",
      reason: "r",
    },
  ],
};

/** 使い捨てのリポジトリに、スキルと evals.json と identical-copies.json を置く。 */
function makeRoot(evalsBySkill: Record<string, unknown>, copies: unknown = COPIES) {
  const root = makeTempDir("eval-split-");
  // index から読む処理を通すので、git のリポジトリにする（何も stage しなければ作業ツリーから読む）。
  gitInit(root);
  const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
  for (const [name, evals] of Object.entries(evalsBySkill)) {
    write(root, `skills/${name}/SKILL.md`, "# s\n");
    if (evals !== undefined) write(root, `evals/${name}/evals.json`, text(evals));
  }
  write(root, DECLARATION_PATH, text(copies));
  return root;
}

const withJudge = { skill_name: "a", evals: [{ id: 1 }, { id: 2, split: "judge" }] };
const improveOnly = { skill_name: "a", evals: [{ id: 1, split: "improve" }, { id: 2 }] };

describe("変えたファイルから、確かめるスキルを挙げる", () => {
  const copies = wholeFileCopies(parseGroups(COPIES));

  test.each([
    ["SKILL.md", "skills/a/SKILL.md", ["a"]],
    ["references", "skills/a/references/x.md", ["a"]],
    ["scripts", "skills/a/scripts/x-check.mjs", ["a"]],
    ["evals.json", "evals/a/evals.json", ["a"]],
    ["region を持つ組のファイル（組の外の部分も持つ）", "skills/a/scripts/tool.mjs", ["a"]],
    ["fixture", "evals/a/fixtures/f/x.md", []],
    ["同梱した設定の読み取り", "skills/a/scripts/skill-config/skill-config.mjs", []],
    ["外部のコード", "skills/a/scripts/vendor/lib.mjs", []],
    ["ファイル全体の共通のコピー", "skills/a/references/shared.md", []],
    ["インストール済みのコピー", ".agents/skills/a/SKILL.md", []],
    ["skills の直下のファイル", "skills/README.md", []],
  ])("%s", (_label, path, expected) => {
    expect(skillsToCheck([path], copies)).toEqual(expected);
  });

  test("同じスキルの複数のファイルは 1 件にまとめ、複数のスキルは名前の順に並べる", () => {
    expect(
      skillsToCheck(["skills/b/SKILL.md", "evals/a/evals.json", "skills/a/SKILL.md"], copies),
    ).toEqual(["a", "b"]);
  });

  test("0 件の変更は 0 件", () => {
    expect(skillsToCheck([], copies)).toEqual([]);
  });

  test("ファイル全体の組だけを共通のコピーとして集める", () => {
    expect([...copies]).toEqual(["skills/a/references/shared.md", "skills/b/references/shared.md"]);
  });
});

describe("evals.json に判定に使うケースがあるか", () => {
  test("judge が 1 件あれば通す", () => {
    expect(splitViolation(makeRoot({ a: withJudge }), "a")).toBeUndefined();
  });

  test.each([
    ["improve だけ", improveOnly],
    ["split を書いていない", { skill_name: "a", evals: [{ id: 1 }] }],
    ["eval が 0 件", { skill_name: "a", evals: [] }],
  ])("%s なら落とし、選び方の節を案内する", (_label, evals) => {
    const v = splitViolation(makeRoot({ a: evals }), "a");
    expect(v).toContain('evals/a/evals.json に判定に使うケース（"split": "judge"）が無い');
    expect(v).toContain("改善に使うケースと判定に使うケース");
  });

  test.each([
    ["evals.json が無い", undefined, "読めないので"],
    ["JSON でない", "{", "読めないので"],
    ["evals が配列でない", { skill_name: "a", evals: {} }, "evals が配列でない"],
  ])(
    "%s なら、judge が無いとは判定せず例外にし、CLI は exit 2 にする",
    (_label, evals, message) => {
      const root = makeRoot({ a: evals });
      expect(() => splitViolation(root, "a")).toThrow(message);
      expect(main(["skills/a/SKILL.md"], root)).toBe(2);
    },
  );

  test("pre-commit では、stage した evals.json で判定する（stage していない judge では通さない）", () => {
    const root = makeRoot({ a: improveOnly });
    const git = (...args: string[]) =>
      expect(spawnSync("git", args, { cwd: root, timeout: CHILD_TIMEOUT_MS }).status).toBe(0);
    git("add", "evals/a/evals.json");
    write(root, "evals/a/evals.json", JSON.stringify(withJudge));
    expect(main(["skills/a/SKILL.md"], root)).toBe(1);
    git("add", "evals/a/evals.json");
    expect(main(["skills/a/SKILL.md"], root)).toBe(0);
  });

  test("スキルを消した変更は通す", () => {
    const root = makeRoot({ a: improveOnly });
    rmSync(join(root, "skills", "a"), { recursive: true });
    expect(splitViolation(root, "a")).toBeUndefined();
  });
});

describe("CLI", () => {
  test("変えたスキルに judge があれば exit 0、無いスキルがあれば exit 1", () => {
    const root = makeRoot({ a: withJudge, b: improveOnly });
    expect(main(["skills/a/SKILL.md"], root)).toBe(0);
    expect(main(["skills/a/SKILL.md", "skills/b/SKILL.md"], root)).toBe(1);
  });

  test("変えていないスキルは、分けていなくても通す", () => {
    const root = makeRoot({ a: withJudge, b: improveOnly });
    expect(main(["skills/a/references/x.md", "docs/x.md"], root)).toBe(0);
  });

  test.each([
    ["引数が無い（全体の走査はしない）", []],
    ["--changed-since に ref が無い", ["--changed-since"]],
    ["--changed-since とファイルを併用する", ["--changed-since", "main", "skills/a/SKILL.md"]],
    ["差分を取れない", ["--changed-since=no-such-ref"]],
  ])("%s なら exit 2", (_label, argv) => {
    expect(main(argv, makeRoot({ a: withJudge }))).toBe(2);
  });

  test("identical-copies.json を読めなければ exit 2", () => {
    expect(main(["skills/a/SKILL.md"], makeRoot({ a: withJudge }, "{"))).toBe(2);
  });

  test("--changed-since は <ref>...HEAD で変えたファイルだけを見る", () => {
    const root = makeRoot({ a: improveOnly, b: improveOnly });
    const author = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid" };
    const env = {
      ...process.env,
      ...author,
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    };
    const git = (...args: string[]) => {
      const res = spawnSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env,
        timeout: CHILD_TIMEOUT_MS,
      });
      expect(res.status, res.stderr).toBe(0);
    };
    // makeRoot が git init 済みなので、ブランチの名前だけを決める。
    git("switch", "-qc", "main");
    git("add", ".");
    git("commit", "-qm", "base");
    git("switch", "-qc", "topic");
    write(root, "skills/a/SKILL.md", "# changed\n");
    git("commit", "-qam", "change a");
    // b は変えていないので見ない。a は judge が無いので落とす。
    expect(main(["--changed-since", "main"], root)).toBe(1);
    expect(main(["--changed-since=main"], root)).toBe(1);
    write(root, "evals/a/evals.json", JSON.stringify(withJudge));
    git("commit", "-qam", "split a");
    expect(main(["--changed-since=main"], root)).toBe(0);
  });

  test("実リポジトリ: 判定に使うケースを持つ writing-style を変えた変更は通る", () => {
    expect(main(["skills/writing-style/SKILL.md"], REPO_ROOT)).toBe(0);
  });
});
