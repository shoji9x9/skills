import { afterEach, assert, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import {
  archive,
  archiveIn,
  createRepo,
  withGlibcStyleLocales,
  withoutLocaleCommand,
  workdirs,
  writeNote,
} from "./kaizen-archive-helpers.ts";

afterEach(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("../ で始まる Markdown 相対リンクを移動先の階層に合わせる", () => {
  const dir = createRepo();
  const note = writeNote(dir, "2026-09-01-links.md", {
    summary: "relative links",
    body: "\n[x](../docs/x.md) and ![image](../../assets/x.png) and [web](https://example.com)\n",
  });
  spawnSync("git", ["add", ".kaizen"], { timeout: CHILD_TIMEOUT_MS, cwd: dir });

  const result = archive(dir, note);

  expect(result.status, result.stderr).toBe(0);
  const archived = readFileSync(join(dir, ".kaizen/archive/2026-09-01-links.md"), "utf8");
  expect(archived).toContain("[x](../../docs/x.md)");
  expect(archived).toContain("![image](../../../assets/x.png)");
  expect(archived).toContain("[web](https://example.com)");
  const staged = spawnSync("git", ["show", ":.kaizen/archive/2026-09-01-links.md"], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
  });
  expect(staged.status, staged.stderr).toBe(0);
  expect(staged.stdout).toContain("[x](../../docs/x.md)");
  expect(staged.stdout).toContain("![image](../../../assets/x.png)");
  const unstaged = spawnSync("git", ["diff", "--", ".kaizen/archive/2026-09-01-links.md"], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: dir,
    encoding: "utf8",
  });
  expect(unstaged.status, unstaged.stderr).toBe(0);
  expect(unstaged.stdout).toBe("");
});

test.each([
  { length: 79, ellipsis: false },
  { length: 80, ellipsis: false },
  { length: 81, ellipsis: true },
])("$length 文字のサマリーを境界どおり索引化する", ({ length, ellipsis }) => {
  const dir = createRepo();
  const summary = "あ".repeat(length);
  const note = writeNote(dir, `2026-09-01-summary-${length}.md`, { summary });

  const result = archive(dir, note);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  const lastSegment = index.split("— ").at(-1);
  assert.exists(lastSegment, "索引に要約が無い");
  const indexedSummary = lastSegment.trimEnd();
  expect(indexedSummary.endsWith("…")).toBe(ellipsis);
  expect([...indexedSummary]).toHaveLength(Math.min(length, 80));
});

// Issue #303: 先頭段落が折り返されたノートで、索引の要約が文の途中で切れていた。
// 連結してから 80 文字で切り詰めるため、境界（見出し・空行・箇条書きの兄弟項目）で
// 止まることと、止まらずに継ぐことの両方を区別する。
test("折り返した先頭段落を連結してから索引化する", () => {
  const dir = createRepo();
  const note = writeNote(dir, "2026-09-01-wrapped.md", {
    summary: "先頭段落が折り返されている",
    body: "ので続きも読む。\n",
  });

  const result = archive(dir, note);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(index).toContain("— 先頭段落が折り返されているので続きも読む。\n");
});

test("段落の境界（空行・後続見出し・箇条書き・水平線）を越えて連結しない", () => {
  const dir = createRepo();
  const blank = writeNote(dir, "2026-09-01-blank.md", {
    summary: "空行で閉じる段落。",
    body: "\n次の段落は含めない。\n",
  });
  // 見出しの前後に空行を挟むと空行側の境界だけで止まり、見出しの分岐に到達しない
  // （変異で実測）。見出しは先頭段落の直後に、次の本文は見出しの直後に置く。
  const heading = writeNote(dir, "2026-09-01-heading.md", {
    summary: "見出しで閉じる段落。",
    body: "## 根本原因\n別の節。\n",
  });
  const bullet = writeNote(dir, "2026-09-01-bullet.md", {
    summary: "- 先頭の項目",
    body: "- 兄弟の項目\n",
  });
  // 段落の直後に始まるリストも継続行ではない（繋ぐと「。- A の項目- B の項目」になる）。
  const paraList = writeNote(dir, "2026-09-01-para-list.md", {
    summary: "対象は次の 2 つ。",
    body: "- A の項目\n- B の項目\n",
  });
  const rule = writeNote(dir, "2026-09-01-rule.md", {
    summary: "水平線で閉じる段落。",
    body: "---\n\n別の節。\n",
  });

  const result = archive(dir, blank, heading, bullet, paraList, rule);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(index).toContain("— 空行で閉じる段落。\n");
  expect(index).toContain("— 見出しで閉じる段落。\n");
  expect(index).toContain("— - 先頭の項目\n");
  expect(index).toContain("— 対象は次の 2 つ。\n");
  expect(index).toContain("— 水平線で閉じる段落。\n");
});

test("連結の継ぎ目は両側が ASCII のときだけ空白を入れる", () => {
  const dir = createRepo();
  const ascii = writeNote(dir, "2026-09-01-ascii.md", {
    summary: "the lead paragraph is",
    body: "wrapped onto two lines.\n",
  });
  const cjk = writeNote(dir, "2026-09-01-cjk.md", {
    summary: "日本語の折り返しは",
    body: "空白を伴わない。\n",
  });
  const mixed = writeNote(dir, "2026-09-01-mixed.md", {
    summary: "対象は`gh api`の",
    body: "pagination である。\n",
  });

  const result = archive(dir, ascii, cjk, mixed);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(index).toContain("— the lead paragraph is wrapped onto two lines.\n");
  expect(index).toContain("— 日本語の折り返しは空白を伴わない。\n");
  expect(index).toContain("— 対象は`gh api`のpagination である。\n");
});

test("連結後に 80 文字を超えたら … を付けて切り詰める", () => {
  const dir = createRepo();
  const note = writeNote(dir, "2026-09-01-long.md", {
    summary: "あ".repeat(60),
    body: `${"い".repeat(60)}\n`,
  });

  const result = archive(dir, note);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  const lastSegment = index.split("— ").at(-1);
  assert.exists(lastSegment, "索引に要約が無い");
  const indexedSummary = lastSegment.trimEnd();
  expect(indexedSummary).toBe(`${"あ".repeat(60)}${"い".repeat(19)}…`);
});

test("行全体が 200 文字を超えないよう、接頭辞の長さを差し引いて切り詰める", () => {
  // INDEX.md はコミット対象の生成物なので、生成側が markdownlint の MD013（既定 200）を満たす。
  // 要約だけを 80 文字に切っても、ファイル名と meta が長いと行が 200 文字を超えて commit が落ちる
  // （実測: 176 件をアーカイブしたとき 25 行が 203〜213 文字になり pre-commit で止まった）。
  const dir = createRepo();
  // 実在するノート名の最長級（60 文字強）で、要約を切らないと 200 を超える組み合わせ。
  const longName = "2026-09-18-relaxation-by-delegation-needs-a-verified-delegate-long.md";
  const note = writeNote(dir, longName, { summary: "あ".repeat(80) });

  const result = archive(dir, note);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  const lines = index.split("\n").filter((l) => l.startsWith("- "));
  expect(lines).toHaveLength(1);
  // markdownlint は文字数で数えるので、JS の length（BMP では文字数と一致）で突き合わせる。
  expect(lines[0].length).toBeLessThanOrEqual(200);
  expect(lines[0]).toContain(longName);
  expect(lines[0]).toMatch(/…$/);
});

test("非 UTF-8 ロケールでも行長規約を満たす（切らずに要約を落とす）", () => {
  // 切り詰めを UTF-8 の分岐にだけ置くと、`LC_ALL=C` の環境（CI コンテナ・cron）でだけ
  // 200 文字超の INDEX.md が生成され、直後の commit が MD013 で落ちる。
  // 200 *文字*（MD013 の単位）を超える入力を与える。`${#}` のバイト長で判定していると
  // この行も落とせるが、下の「要約を残す」テストが同時に赤くなる。
  const dir = createRepo();
  const longName = "2026-09-18-relaxation-by-delegation-needs-a-verified-delegate-long.md";
  const note = writeNote(dir, longName, { summary: "あ".repeat(160) });

  const result = archiveIn(dir, { LANG: "C", LC_ALL: "C", ...withoutLocaleCommand(dir) }, note);

  expect(result.status, result.stderr).toBe(0);
  const line = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("- "));
  assert.exists(line, "索引に項目の行が無い");
  expect(line.length).toBeLessThanOrEqual(200);
  expect(line).toContain(longName);
  // 切ったのではなく省いたので、途中で切れた多バイト文字（U+FFFD）は現れない。
  expect(line).not.toContain("�");
  // 機能を減らして動く分岐に入った証拠。UTF-8 へ切り替えられていれば「切り詰めた要約＋…」になる。
  expect(line).not.toContain("あ");
  expect(line).not.toContain("…");
});

test("ロケールが違っても同じ索引を生成する", () => {
  // 切り詰めが UTF-8 分岐にしか無いと、同じ入力から切り詰めの有無が違う索引ができ、
  // C ロケールの環境で再生成するたびに commit 済みの INDEX.md が書き換わる。
  const summary = "あ".repeat(120);
  const name = "2026-09-01-locale-stable.md";

  const utf8Dir = createRepo();
  expect(
    archiveIn(
      utf8Dir,
      { LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
      writeNote(utf8Dir, name, { summary }),
    ).status,
  ).toBe(0);
  const cDir = createRepo();
  expect(
    archiveIn(cDir, { LANG: "C", LC_ALL: "C" }, writeNote(cDir, name, { summary })).status,
  ).toBe(0);

  const read = (dir: string) => readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(read(cDir)).toBe(read(utf8Dir));
  expect(read(cDir)).toContain("…");
});

test("非 UTF-8 ロケールでも 200 文字以内の要約は残す（バイト長で判定しない）", () => {
  // `${#}` は非 UTF-8 ロケールでバイト長になるため、日本語の要約はほぼ全行が 200 を超えて
  // 見える。それを根拠に落とすと、実測で 178 行中 174 行の要約が消えた（200 文字超は 0 行）。
  // INDEX.md の行全体は kaizen-kedb-match.sh の照合対象なので、要約の消失は
  // archive をファイル名でしか引けなくする。
  const dir = createRepo();
  const summary = "あ".repeat(60);
  const note = writeNote(dir, "2026-09-01-short-enough.md", { summary });

  const result = archiveIn(dir, { LANG: "C", LC_ALL: "C", ...withoutLocaleCommand(dir) }, note);

  expect(result.status, result.stderr).toBe(0);
  const line = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("- "));
  expect(line).toContain(summary);
  assert.exists(line, "索引に項目の行が無い");
  expect(line.length).toBeLessThanOrEqual(200);
});

test.each([
  ["C ロケール", { LANG: "C", LC_ALL: "C" }],
  ["UTF-8 ロケール", { LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }],
])("%s でも索引の行順を照合順に依存させない", (_name, localeEnv) => {
  // UTF-8 へ寄せるのに LC_ALL を使うと LC_COLLATE も変わり、行順を決める glob 順が
  // ロケール依存に戻る（en_US.UTF-8 はハイフン等を無視して照合する）。行順は内容の一部。
  const dir = createRepo();
  const names = ["a-b", "aB", "a_b", "ab"];
  const notes = names.map((n) => writeNote(dir, `2026-09-01-${n}.md`, { summary: `要約 ${n}` }));

  expect(archiveIn(dir, localeEnv, ...notes).status).toBe(0);

  const order = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => {
      const m = l.match(/2026-09-01-(.+)\.md/);
      assert.exists(m, `索引の行にノートの名前が無い: ${l}`);
      return m[1];
    });
  // バイト順（C）: '-'(0x2d) < 'B'(0x42) < '_'(0x5f) < 'b'(0x62)
  expect(order).toEqual(["a-b", "aB", "a_b", "ab"]);
});

// C.utf8 の照合はバイト順で C と同じなので、上の 2 つのロケールでは LC_COLLATE を固定しなくても通る。
// 固定しているかは、記号を無視して照合する UTF-8 ロケール（en_US.UTF-8 など）でだけ区別できる。
// そのロケールが入っていない環境では、このテストを飛ばす。
// locale の一覧を取れない（起動の失敗・時間切れ）ことは、ロケールが無いことと同じに扱わない。
// そのときはテストを飛ばさずに実行し、テストの中で失敗させる（ほかのテストの収集は止めない）。
const localeList = spawnSync("locale", ["-a"], { encoding: "utf8", timeout: CHILD_TIMEOUT_MS });
const localeListed = localeList.error === undefined && localeList.status === 0;
const collatingLocale = localeListed
  ? localeList.stdout.split("\n").find((l) => /utf-?8$/i.test(l) && !/^(c|posix)\./i.test(l))
  : undefined;

test.skipIf(localeListed && collatingLocale === undefined)(
  "記号を無視して照合するロケールでも、索引の行はバイト順に並べる",
  () => {
    expect(localeList.error, "locale -a を実行できない").toBeUndefined();
    expect(localeList.status, localeList.stderr).toBe(0);
    assert.exists(collatingLocale);
    const dir = createRepo();
    const names = ["a-b", "aB", "a_b", "ab"];
    const notes = names.map((n) => writeNote(dir, `2026-09-01-${n}.md`, { summary: `要約 ${n}` }));
    const localeEnv = {
      LANG: collatingLocale,
      LC_ALL: collatingLocale,
      LC_COLLATE: collatingLocale,
    };

    expect(archiveIn(dir, localeEnv, ...notes).status).toBe(0);

    const order = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.match(/2026-09-01-(.+)\.md/)?.[1]);
    expect(order).toEqual(["a-b", "aB", "a_b", "ab"]);
  },
);

test("glibc 流の名前（en_US.utf8）しか無い環境でも UTF-8 ロケールを見つける", () => {
  // 候補名を決め打ちで完全一致させると、glibc の `locale -a` は `en_US.utf8` と
  // ハイフン無し・小文字で出すため一度も一致せず、使える UTF-8 があるのに機能を減らして動く。
  const dir = createRepo();
  const note = writeNote(dir, "2026-09-01-glibc-names.md", { summary: "あ".repeat(60) });

  const result = archiveIn(dir, { LANG: "C", LC_ALL: "C", ...withGlibcStyleLocales(dir) }, note);

  expect(result.status).toBe(0);
  expect(result.stderr).not.toMatch(/UTF-8 ロケールが無いため/);
});

test("UTF-8 ロケールが無いときは機能を減らして動いた旨を stderr に残す", () => {
  // 機能を減らした run と本番構成の run を、出力で区別できるようにする（警告なしに要約を省かない）。
  const dir = createRepo();
  const note = writeNote(dir, "2026-09-01-degraded.md", { summary: "あ".repeat(60) });

  const result = archiveIn(dir, { LANG: "C", LC_ALL: "C", ...withoutLocaleCommand(dir) }, note);

  expect(result.status).toBe(0);
  expect(result.stderr).toMatch(/UTF-8 ロケールが無いため/);
});

test.for<[string, { LANG: string; LC_ALL: string }, string, string]>([
  [
    "非 UTF-8 で要約ごと落とした行",
    { LANG: "C", LC_ALL: "C" },
    "2026-09-18-relaxation-by-delegation-needs-a-verified-delegate-long.md",
    "あ".repeat(160),
  ],
  [
    "接頭辞だけで予算を使い切った行",
    { LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    `2026-09-01-${"y".repeat(180)}.md`,
    "あ".repeat(70),
  ],
])("%s に行末スペースを残さない（MD009）", ([, localeEnv, name, summary]) => {
  // 要約を落とすと接頭辞末尾の "— " がそのまま行末スペースになり、MD009 で
  // pre-commit が落ちる（行長だけを見るテストでは緑のまま通る）。
  const dir = createRepo();
  const note = writeNote(dir, name, { summary });
  // 非 UTF-8 側は UTF-8 ロケールへ切り替える手段を塞いで、要約を省く分岐へ入れる。
  const env = localeEnv.LC_ALL === "C" ? { ...localeEnv, ...withoutLocaleCommand(dir) } : localeEnv;

  const result = archiveIn(dir, env, note);

  expect(result.status, result.stderr).toBe(0);
  const line = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("- "));
  expect(line).not.toMatch(/\s$/);
});

test("接頭辞だけで予算を使い切る場合は要約を落とす（ファイル名は切らない）", () => {
  // ファイル名は KEDB 照合の鍵なので切り詰めない。要約を落としてもなお 200 を超える
  // 異常に長いノート名は、名前自体を短くするしかない（生成側では直せない）。
  const dir = createRepo();
  const note = writeNote(dir, `2026-09-01-${"y".repeat(180)}.md`, { summary: "あ".repeat(70) });

  const result = archive(dir, note);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  const line = index.split("\n").find((l) => l.startsWith("- "));
  expect(line).not.toContain("あ");
  expect(line).toContain("y".repeat(180));
});

test("見出しが無いノートのフォールバックでも先頭段落を連結する", () => {
  const dir = createRepo();
  const path = join(dir, ".kaizen", "2026-09-01-no-heading.md");
  writeFileSync(
    path,
    "---\ndate: 2026-09-01\ntype: doc\npriority: low\nstatus: pending\n---\n\n# タイトル\n\n見出しが無くても\n段落として読む。\n",
  );

  const result = archive(dir, path);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(index).toContain("— 見出しが無くても段落として読む。\n");
});

// frontmatter の後に区切り線を置くノートで、要約が `---` そのものにならないこと。
test("フォールバックは frontmatter 後の水平線を要約にしない", () => {
  const dir = createRepo();
  const path = join(dir, ".kaizen", "2026-09-01-rule-fallback.md");
  writeFileSync(
    path,
    "---\ndate: 2026-09-01\ntype: doc\npriority: low\nstatus: pending\n---\n\n---\n\n本文はここから\n始まる。\n",
  );

  const result = archive(dir, path);

  expect(result.status, result.stderr).toBe(0);
  const index = readFileSync(join(dir, ".kaizen/archive/INDEX.md"), "utf8");
  expect(index).toContain("— 本文はここから始まる。\n");
});
