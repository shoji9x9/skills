// スキルの実体と AGENTS.md・README.md のスキル一覧の対応検査の回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                   | 値                                                                          |
// | -------------------- | --------------------------------------------------------------------------- |
// | 実体                 | 配布（SKILL.md あり）/ SKILL.md の無いディレクトリ / private（.private-skill）/ 印の無い .agents/skills |
// | private の SKILL.md  | あり / 印だけで無い（AGENTS.md に掲載 / 未掲載）/ 印も SKILL.md も無い            |
// | AGENTS.md の掲載     | 一致 / 未掲載 / 実在しない名前 / 重複 / 形の崩れた箇条 / 節が無い            |
// | README.md の掲載     | 一致 / 未掲載 / 実在しない名前 / private を掲載 / 重複 / 表示名とリンクの不一致 / 形の崩れた行 / 節が無い |
// | 節の範囲             | 節の前後の別節にある同じ形の箇条・表 / 節内の導入文・継続行・見出し行・区切り行 |
// | 件数                 | 配布 0 件 / 1 件以上                                                         |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSkillIndex, main } from "./check-skill-index.js";
import { makeTempDir } from "./lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-skill-index.js");

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const agentsDoc = (names, extra = []) =>
  [
    "# Skills",
    "",
    "## 参照ルールガイド",
    "",
    "- `.agents/rules/x.md`: 節の外の箇条（数えない）",
    "",
    "## 参照スキルガイド",
    "",
    "各スキルの用途だけを置く。",
    "",
    ...names.map((n) => `- \`${n}\`: ${n} の説明\n  継続行（字下げ）`),
    ...extra,
    "",
    "## 後ろの節",
    "",
    "- `ghost-after`: 節の外の箇条（数えない）",
    "",
  ].join("\n");

const readmeDoc = (names, extra = []) =>
  [
    "# Skills",
    "",
    "## 利用可能なスキル",
    "",
    "| スキル | 説明 |",
    "|-------|------|",
    ...names.map((n) => `| [${n}](./skills/${n}/) | ${n} の説明 |`),
    ...extra,
    "",
    "## スキルの設定",
    "",
    "| キー | 値 |",
    "|---|---|",
    "| [ghost-after](./skills/ghost-after/) | 節の外の表（数えない） |",
    "",
  ].join("\n");

/** 配布 `skills`・private `priv` を実体として置き、`agents` / `readme` を掲載した一時リポジトリ。 */
function makeRepo({
  skills = ["alpha", "beta"],
  priv = ["secret"],
  agents = [...skills, ...priv],
  readme = skills,
} = {}) {
  const root = makeTempDir("skill-index-");
  for (const n of skills) {
    write(root, `skills/${n}/SKILL.md`, `---\nname: ${n}\n---\n`);
    write(root, `.agents/skills/${n}/SKILL.md`, `---\nname: ${n}\n---\n`);
  }
  for (const n of priv) {
    write(root, `.agents/skills/${n}/SKILL.md`, `---\nname: ${n}\n---\n`);
    write(root, `.agents/skills/${n}/.private-skill`, "");
  }
  write(root, "AGENTS.md", agentsDoc(agents));
  write(root, "README.md", readmeDoc(readme));
  return root;
}

// ---- 陰性コントロール（通さねばならない入力）----

test("陰性: 配布は両方に、private は AGENTS.md にだけ載っていれば違反 0 件で件数を数える", () => {
  expect(checkSkillIndex(makeRepo())).toEqual({
    distributed: ["alpha", "beta"],
    private: ["secret"],
    violations: [],
  });
});

test("陰性: 節の前後にある同じ形の箇条・表は数えない（節の外の ghost-after を実在しないと言わない）", () => {
  expect(checkSkillIndex(makeRepo()).violations).toEqual([]);
});

test("陰性: 節内の導入文・字下げの継続行・表の見出し行と区切り行は飛ばす", () => {
  const root = makeRepo();
  write(
    root,
    "README.md",
    readmeDoc(["alpha", "beta"]).replace("|-------|------|", "| :--- | ---: |"),
  );
  expect(checkSkillIndex(root).violations).toEqual([]);
});

test("陰性: private skill が 0 件でも、配布スキルだけで一致すれば通す", () => {
  expect(checkSkillIndex(makeRepo({ priv: [] })).violations).toEqual([]);
});

test("陰性: 実体と同名で skills/ にもある .private-skill は配布として扱う（README に載せてよい）", () => {
  const root = makeRepo();
  write(root, ".agents/skills/alpha/.private-skill", "");
  const r = checkSkillIndex(root);
  expect(r.violations).toEqual([]);
  // 報告する private の件数にも数えない（配布スキルを二重に数えない）。
  expect(r.private).toEqual(["secret"]);
});

/** fixture の AGENTS.md / README.md を書き換える。 */
function edit(root, file, fn) {
  writeFileSync(join(root, file), fn(readFileSync(join(root, file), "utf8")));
}

test.each([
  ["スキルを 1 件足して両方に載せた", () => makeRepo({ skills: ["alpha", "beta", "gamma"] })],
  [
    "掲載順が実体の並びと違う",
    () => makeRepo({ agents: ["secret", "beta", "alpha"], readme: ["beta", "alpha"] }),
  ],
  [
    "説明文にバッククォートやコロンを含む",
    () => {
      const root = makeRepo();
      edit(root, "AGENTS.md", (t) =>
        t.replace("- `alpha`: alpha の説明", "- `alpha`: `gh` で動く: 詳細は `references/x.md`"),
      );
      return root;
    },
  ],
  [
    "継続行が複数行で、字下げした入れ子の箇条を持つ",
    () => {
      const root = makeRepo();
      edit(root, "AGENTS.md", (t) =>
        t.replace("  継続行（字下げ）", "  継続 1\n  継続 2\n  - 入れ子の箇条: 数えない"),
      );
      return root;
    },
  ],
  [
    "節がファイルの末尾にある（後ろの見出しが無い）",
    () => {
      const root = makeRepo();
      edit(root, "AGENTS.md", (t) => t.split("## 後ろの節")[0]);
      return root;
    },
  ],
  [
    "節の中の ### 小見出しの下にも箇条を続ける",
    () => {
      const root = makeRepo();
      edit(root, "AGENTS.md", (t) => t.replace("- `beta`:", "### 補足\n\n- `beta`:"));
      return root;
    },
  ],
  [
    "CRLF 改行",
    () => {
      const root = makeRepo();
      for (const f of ["AGENTS.md", "README.md"]) edit(root, f, (t) => t.replace(/\n/g, "\r\n"));
      return root;
    },
  ],
  [
    "見出しの末尾に空白がある",
    () => {
      const root = makeRepo();
      edit(root, "AGENTS.md", (t) => t.replace("## 参照スキルガイド", "## 参照スキルガイド  "));
      return root;
    },
  ],
  ["private skill が複数", () => makeRepo({ priv: ["secret", "secret2"] })],
  [
    "skills/ 直下のディレクトリでないファイルは数えない",
    () => {
      const root = makeRepo();
      write(root, "skills/README.md", "# 配布スキル\n");
      return root;
    },
  ],
])("陰性: 正規の編集（%s）は違反 0 件", (_, build) => {
  expect(checkSkillIndex(build()).violations).toEqual([]);
});

test("陰性: 実リポジトリの一覧が実体と一致する", () => {
  const { distributed, violations } = checkSkillIndex(repoRoot);
  expect(violations).toEqual([]);
  expect(distributed.length).toBeGreaterThan(0);
});

// ---- 陽性コントロール（落とす入力）----

test("陽性: 配布スキルが AGENTS.md に未掲載なら落とす", () => {
  expect(checkSkillIndex(makeRepo({ agents: ["alpha", "secret"] })).violations).toEqual([
    "AGENTS.md「## 参照スキルガイド」: beta が未掲載",
  ]);
});

test("陽性: 配布スキルが README.md に未掲載なら落とす", () => {
  expect(checkSkillIndex(makeRepo({ readme: ["alpha"] })).violations).toEqual([
    "README.md「## 利用可能なスキル」: beta が未掲載",
  ]);
});

test("陽性: private skill が AGENTS.md に未掲載なら落とす", () => {
  expect(checkSkillIndex(makeRepo({ agents: ["alpha", "beta"] })).violations).toEqual([
    "AGENTS.md「## 参照スキルガイド」: secret が未掲載",
  ]);
});

test("陽性: AGENTS.md に実在しないスキル（改名前の名前）を載せたら落とす", () => {
  const r = checkSkillIndex(makeRepo({ agents: ["alpha", "beta", "secret", "old-name"] }));
  expect(r.violations).toEqual([
    "AGENTS.md「## 参照スキルガイド」: old-name は実在しないスキル（skills/ にも private skill にも無い）",
  ]);
});

test("陽性: .private-skill の印が無い .agents/skills だけのスキルは、AGENTS.md に載っていても実在扱いしない", () => {
  const root = makeRepo({ agents: ["alpha", "beta", "secret", "stale"] });
  write(root, ".agents/skills/stale/SKILL.md", "---\nname: stale\n---\n");
  expect(checkSkillIndex(root).violations).toEqual([
    "AGENTS.md「## 参照スキルガイド」: stale は実在しないスキル（skills/ にも private skill にも無い）",
  ]);
});

test("陽性: README.md に実在しないスキルを載せたら落とす", () => {
  expect(checkSkillIndex(makeRepo({ readme: ["alpha", "beta", "gone"] })).violations).toEqual([
    "README.md「## 利用可能なスキル」: gone は実在しないスキル（skills/ に無い）",
  ]);
});

test("陽性: README.md に private skill を載せたら落とす（配布しないのでインストールできない）", () => {
  expect(checkSkillIndex(makeRepo({ readme: ["alpha", "beta", "secret"] })).violations).toEqual([
    "README.md「## 利用可能なスキル」: secret は private skill（配布しないので載せない）",
  ]);
});

test("陽性: 同じスキルを重複して載せたら落とす", () => {
  const r = checkSkillIndex(
    makeRepo({ agents: ["alpha", "beta", "secret", "alpha"], readme: ["alpha", "beta", "beta"] }),
  );
  expect(r.violations).toEqual([
    "AGENTS.md:17: alpha が重複して掲載されている",
    "README.md:9: beta が重複して掲載されている",
  ]);
});

test("陽性: 節の中の形が崩れた箇条は判定不能として落とす（黙って飛ばさない）", () => {
  const root = makeRepo();
  write(
    root,
    "AGENTS.md",
    agentsDoc(["alpha", "beta", "secret"], ["- gamma: バッククォートが無い"]),
  );
  expect(checkSkillIndex(root).violations).toEqual([
    "AGENTS.md:17: 箇条が `- `<name>`:` の形で読めない",
  ]);
});

test("陽性: README の表の行が形で読めない・表示名とリンク先が違うなら落とす", () => {
  const root = makeRepo();
  write(
    root,
    "README.md",
    readmeDoc(
      ["alpha", "beta"],
      ["| gamma | リンクが無い |", "| [delta](./skills/beta/) | 食い違い |"],
    ),
  );
  expect(checkSkillIndex(root).violations).toEqual([
    "README.md:9: 表の行が `| [<name>](./skills/<name>/) |` の形で読めない",
    "README.md:10: 表示名 delta とリンク先 ./skills/beta/ が一致しない",
  ]);
});

test.each([
  ["AGENTS.md", "## 参照スキルガイド", "AGENTS.md: 「## 参照スキルガイド」節が無い"],
  ["README.md", "## 利用可能なスキル", "README.md: 「## 利用可能なスキル」節が無い"],
])("陽性: %s の節が無ければ落とす（見出しの改名で全件素通りしない）", (file, heading, msg) => {
  const root = makeRepo();
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(heading, "## 改名した見出し"));
  expect(checkSkillIndex(root).violations).toEqual([msg]);
});

test.each(["AGENTS.md", "README.md"])(
  "陽性: %s 自体が無ければ落とす（読めない一覧を一致扱いしない）",
  (file) => {
    const root = makeRepo();
    rmSync(join(root, file));
    expect(checkSkillIndex(root).violations).toEqual([`${file} が無い`]);
  },
);

test("陽性: SKILL.md の無い skills/ のディレクトリを落とす", () => {
  const root = makeRepo();
  rmSync(join(root, "skills/beta/SKILL.md"));
  expect(checkSkillIndex(root).violations).toEqual([
    "skills/beta/: SKILL.md が無い（スキルの実体として読めない）",
  ]);
});

test("陽性: .private-skill だけで SKILL.md の無い private skill は、AGENTS.md に載っていても数えず落とす", () => {
  const root = makeRepo();
  rmSync(join(root, ".agents/skills/secret/SKILL.md"));
  expect(checkSkillIndex(root)).toEqual({
    distributed: ["alpha", "beta"],
    private: [],
    violations: [
      ".agents/skills/secret/: .private-skill はあるが SKILL.md が無い（スキルの実体として読めない）",
      "AGENTS.md「## 参照スキルガイド」: secret は実在しないスキル（skills/ にも private skill にも無い）",
    ],
  });
});

test("陽性: .private-skill だけで SKILL.md の無い private skill は、AGENTS.md に未掲載でも落とす", () => {
  const root = makeRepo({ agents: ["alpha", "beta"] });
  rmSync(join(root, ".agents/skills/secret/SKILL.md"));
  expect(checkSkillIndex(root).violations).toEqual([
    ".agents/skills/secret/: .private-skill はあるが SKILL.md が無い（スキルの実体として読めない）",
  ]);
});

test("陰性: 印も SKILL.md も無い .agents/skills のディレクトリは private skill の候補にしない", () => {
  const root = makeRepo();
  write(root, ".agents/skills/leftover/notes.md", "# 残骸\n");
  expect(checkSkillIndex(root)).toEqual({
    distributed: ["alpha", "beta"],
    private: ["secret"],
    violations: [],
  });
});

// ---- 件数と CLI ----

test("配布スキル 0 件は成功に倒さず exit 1", () => {
  expect(main([makeRepo({ skills: [], priv: [] })])).toBe(1);
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、不一致は exit 1、一致なら exit 0", () => {
  const good = spawnSync(process.execPath, [script, makeRepo()], { encoding: "utf8" });
  expect(good.status, good.stderr).toBe(0);
  expect(good.stdout).toMatch(/skill-index: OK（配布 2 件・private 1 件）/);
  const bad = spawnSync(process.execPath, [script, makeRepo({ readme: ["alpha"] })], {
    encoding: "utf8",
  });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/1 件の不一致/);
});
