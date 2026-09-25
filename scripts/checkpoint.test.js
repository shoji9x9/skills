// parity-suite の区切りの記録・照合（checkpoint.mjs）の回帰テスト（Issue #468）。
//
// 新しい文脈から再開してよいかを成果物の側で決める道具なので、壊れ方は「区切りの後に動いた成果物を
// 動いていないと答える」と「順序を飛ばした区切りを記録できる」の 2 つ。
// 追加・削除・変更のそれぞれで verify が落ちること、区切りの後に正規に変わるもの（pending-decisions.json・
// noise-pass2/・new/）では落ちないことを両側で固定する。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/parity-suite/scripts/checkpoint.mjs");
const SLUG = ".replace/parity/share";
const SUITE = "e2e/parity/share";

/** 手順 5 まで済んだプロジェクトを作る。 */
function project() {
  const dir = mkdtempSync(join(tmpdir(), "checkpoint-"));
  mkdirSync(join(dir, SLUG), { recursive: true });
  mkdirSync(join(dir, SUITE), { recursive: true });
  writeFileSync(join(dir, SLUG, "reactions.json"), "{}\n");
  writeFileSync(join(dir, SUITE, "share.spec.ts"), "// spec\n");
  return dir;
}

/**
 * @param {string} dir
 * @param {string[]} args
 */
function cli(dir, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const record = (dir, at, extra = []) => cli(dir, ["record", "--dir", SLUG, "--at", at, ...extra]);
const verify = (dir, at) => cli(dir, ["verify", "--dir", SLUG, "--at", at]);

/** 手順 6 の成果物（採取の記録）を書いてから captured を記録する。 */
const capture = (dir) => {
  writeFileSync(join(dir, SLUG, "metadata.json"), '{"noise_baseline":{}}\n');
  return record(dir, "captured");
};

test("陽性コントロール: 記録した直後の verify は通り、次の手順を返す", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  const r = verify(dir, "authored");
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, next_step: 6, files: 2 });
});

test.each([
  [
    "slug のディレクトリに追加",
    (d) => writeFileSync(join(d, SLUG, "component-coverage.json"), "{}"),
    "added",
  ],
  ["スイートに追加", (d) => writeFileSync(join(d, SUITE, "extra.spec.ts"), ""), "added"],
  ["削除", (d) => rmSync(join(d, SLUG, "reactions.json")), "removed"],
  ["変更", (d) => writeFileSync(join(d, SUITE, "share.spec.ts"), "// edited\n"), "changed"],
  // 記録した根ごと消えたら使い方の誤り（exit 2）ではなく、その下のファイルの削除として数える
  ["--include の根ごと削除", (d) => rmSync(join(d, SUITE), { recursive: true }), "removed"],
])("記録の後に成果物が動いたら verify は exit 1: %s", (_name, mutate, field) => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  mutate(dir);
  const r = verify(dir, "authored");
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)[field]).toHaveLength(1);
});

test.each([
  ["pending-decisions.json", (d) => writeFileSync(join(d, SLUG, "pending-decisions.json"), "{}")],
  [
    "noise-pass2/",
    (d) => {
      mkdirSync(join(d, SLUG, "noise-pass2"));
      writeFileSync(join(d, SLUG, "noise-pass2", "a.png"), "x");
    },
  ],
  [
    "new/",
    (d) => {
      mkdirSync(join(d, SLUG, "new", "t"), { recursive: true });
      writeFileSync(join(d, SLUG, "new", "t", "x.json"), "{}");
    },
  ],
])("区切りの後に正規に変わるもの（%s）では verify は落ちない", (_name, mutate) => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  mutate(dir);
  expect(verify(dir, "authored").status).toBe(0);
});

test("外すのは slug のディレクトリ直下の名前だけ（スイートの中の new/ は指紋に入る）", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  mkdirSync(join(dir, SUITE, "new"));
  writeFileSync(join(dir, SUITE, "new", "x.spec.ts"), "");
  expect(verify(dir, "authored").status).toBe(1);
});

test("verify は最後に記録した区切りとしか一致しない", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  expect(capture(dir).status).toBe(0);
  const r = verify(dir, "authored");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("最後に記録した区切りは captured");
  expect(verify(dir, "captured").status).toBe(0);
});

test("後の区切りは前の区切りの --include を引き継ぐ（スイートを書き換えた再開を見逃さない）", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  const rec = capture(dir);
  expect(JSON.parse(rec.stdout).roots).toEqual([SLUG, SUITE]);
  writeFileSync(join(dir, SUITE, "share.spec.ts"), "// edited\n");
  expect(verify(dir, "captured").status).toBe(1);
});

test("前の区切りに戻って記録し直すと、後の区切りの記録は消える", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  expect(capture(dir).status).toBe(0);
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  const rec = JSON.parse(readFileSync(join(dir, SLUG, "checkpoints.json"), "utf8"));
  expect(rec.checkpoints.map((c) => c.at)).toEqual(["authored"]);
});

test("前の区切りが無ければ record は exit 2（順序を飛ばさない）", () => {
  const dir = project();
  const r = record(dir, "captured");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("前の区切り authored が記録されていない");
});

test("gated は strength.md が無ければ記録しない", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  expect(capture(dir).status).toBe(0);
  const r = record(dir, "gated");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("strength.md");
  writeFileSync(join(dir, SLUG, "strength.md"), "# 強度\n");
  expect(record(dir, "gated").status).toBe(0);
  expect(JSON.parse(verify(dir, "gated").stdout).next_step).toBe(8);
});

test.each([
  [
    "authored に --include が無い",
    ["record", "--dir", SLUG, "--at", "authored"],
    "--include でスイート",
  ],
  [
    "--include が存在しない",
    ["record", "--dir", SLUG, "--at", "authored", "--include", "nope"],
    "存在しない",
  ],
  [
    "--include が --dir の中",
    ["record", "--dir", SLUG, "--at", "authored", "--include", `${SLUG}/reactions.json`],
    "--dir の中",
  ],
  [
    "--include が --dir そのもの",
    ["record", "--dir", SLUG, "--at", "authored", "--include", SLUG],
    "--dir の中",
  ],
  ["語彙外の区切り", ["record", "--dir", SLUG, "--at", "done", "--include", SUITE], "語彙"],
  ["--dir が無い", ["record", "--at", "authored"], "--dir と --at"],
  [
    "--dir が存在しない",
    ["record", "--dir", "nope", "--at", "authored", "--include", SUITE],
    "ディレクトリでない",
  ],
  [
    "verify に --include",
    ["verify", "--dir", SLUG, "--at", "authored", "--include", SUITE],
    "--include は渡さない",
  ],
  ["サブコマンドが無い", [], "サブコマンド"],
  [
    "--dir の重複",
    ["record", "--dir", SLUG, "--dir", SLUG, "--at", "authored", "--include", SUITE],
    "--dir が重複",
  ],
  ["--at の重複", ["verify", "--dir", SLUG, "--at", "authored", "--at", "captured"], "--at が重複"],
  ["不明な引数", ["record", "--dir", SLUG, "--at", "authored", "--bogus", "x"], "不明な引数"],
])("使い方の誤りは exit 2: %s", (_name, args, needle) => {
  const dir = project();
  const r = cli(dir, args);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain(needle);
});

test("記録が 1 つも無ければ verify は exit 1", () => {
  const dir = project();
  const r = verify(dir, "authored");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("1 つも記録されていない");
});

test("別の cwd から verify すると指紋の対象が見つからず落ちる（合格に倒さない）", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  const r = spawnSync(
    process.execPath,
    [script, "verify", "--dir", join(dir, SLUG), "--at", "authored"],
    {
      cwd: join(dir, "e2e"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  expect(r.status).not.toBe(0);
});

/**
 * record が作った記録を読み、手で直したような形へ書き換える。
 * @param {string} dir
 * @param {(rec: { checkpoints: Record<string, any>[] }) => void} mutate
 */
function editRecord(dir, mutate) {
  const path = join(dir, SLUG, "checkpoints.json");
  const rec = JSON.parse(readFileSync(path, "utf8"));
  mutate(rec);
  writeFileSync(path, JSON.stringify(rec));
}

/** authored → captured → gated まで記録したプロジェクト。 */
function gatedProject() {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  expect(capture(dir).status).toBe(0);
  writeFileSync(join(dir, SLUG, "strength.md"), "# 強度\n");
  writeFileSync(join(dir, SLUG, "gaps.md"), "# 未検証\n");
  expect(record(dir, "gated").status).toBe(0);
  return dir;
}

test("陽性コントロール: record が作った 3 区切りの記録はそのまま verify を通る", () => {
  expect(verify(gatedProject(), "gated").status).toBe(0);
});

test.each([
  ["追加", (d) => writeFileSync(join(d, SLUG, "dimension-samples.json"), "{}")],
  ["変更", (d) => writeFileSync(join(d, SLUG, "reactions.json"), '{"a":1}')],
  [
    "削除と追加",
    (d) => {
      rmSync(join(d, SLUG, "reactions.json"));
      writeFileSync(join(d, SLUG, "metadata.json"), "{}");
    },
  ],
])("前の区切りから成果物が足された・書き換えられたなら record は通る: %s", (_name, mutate) => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  mutate(dir);
  expect(record(dir, "captured").status).toBe(0);
});

test("前の区切りから成果物が 1 つも変わっていなければ record は exit 2（手順を飛ばした区切りを作らない。Codex レビュー）", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  const r = record(dir, "captured");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("前の区切り authored から成果物が 1 つも変わっていない");
  expect(verify(dir, "authored").status).toBe(0);
});

test("前の区切りから削除しかしていなければ record は exit 2（削除を進んだ証拠にしない。Codex レビュー）", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  rmSync(join(dir, SLUG, "reactions.json"));
  const r = record(dir, "captured");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("成果物が 1 つも変わっていない");
});

test("--include の根が空なら record は exit 2（スイートが消えたまま区切りを進めない。Codex レビュー）", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  rmSync(join(dir, SUITE, "share.spec.ts"));
  writeFileSync(join(dir, SLUG, "metadata.json"), "{}");
  const r = record(dir, "captured");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--include の根にファイルが無い");
});

const H = "0".repeat(64);
const each = (fn) => (rec) => rec.checkpoints.forEach(fn);

// 書き手（record）の不変条件 W1〜W9 ごとに、record が作った記録を 1 か所だけ崩して verify が exit 2 になることを確かめる。
// 番号と条件の正本は checkpoint.mjs の recordProblem の表（手で直した・壊れた記録で --from が前段を確かめずに再開しない）
test.each([
  ["W1 tool が無い", (rec) => delete rec.tool, "最上位が"],
  ["W1 version が違う", (rec) => (rec.version = "0"), "version（0）"],
  [
    "W2 区切りが定義の数を超える",
    (rec) => rec.checkpoints.push({ ...rec.checkpoints[2] }),
    "個を超える",
  ],
  [
    "W2 前段を欠いて gated だけが並ぶ",
    (rec) => (rec.checkpoints = rec.checkpoints.slice(2)),
    "順の先頭から並んでいない",
  ],
  [
    "W2 区切りの名前が入れ替わっている（next_step は位置どおり）",
    (rec) => {
      [rec.checkpoints[0].at, rec.checkpoints[1].at] = [
        rec.checkpoints[1].at,
        rec.checkpoints[0].at,
      ];
    },
    "順の先頭から並んでいない",
  ],
  [
    "W2 next_step が定義と違う",
    (rec) => (rec.checkpoints[2].next_step = 999),
    "next_step が定義と違う",
  ],
  ["W3 区切りがオブジェクトでない", (rec) => (rec.checkpoints[0] = []), "オブジェクトでない"],
  ["W3 区切りに余分なキーがある", (rec) => (rec.checkpoints[0].extra = 1), "のキーが"],
  ["W4 roots が配列でない", (rec) => (rec.checkpoints[0].roots = SLUG), "文字列の配列でない"],
  ["W4 roots に重複（[slug, slug]）", each((c) => (c.roots = [SLUG, SLUG])), "重複"],
  ["W4 roots の先頭が --dir でない", each((c) => (c.roots = [SUITE, SLUG])), "が --dir（"],
  ["W4 スイートの根が無い", each((c) => (c.roots = [SLUG])), "スイートの根が無い"],
  ["W4 スイートの根が --dir の中", each((c) => (c.roots = [SLUG, `${SLUG}/sub`])), "--dir の中"],
  [
    "W4 スイートの根が正規化されていない",
    each((c) => (c.roots = [SLUG, "e2e/./parity/share"])),
    "正規化",
  ],
  [
    "W5 後の区切りが前の根を引き継いでいない",
    (rec) => (rec.checkpoints[2].roots = [SLUG, "e2e/other"]),
    "引き継いでいない",
  ],
  ["W6 files が空", (rec) => (rec.checkpoints[0].files = {}), "files が空"],
  [
    "W6 指紋が sha256 でない",
    (rec) => (rec.checkpoints[0].files[`${SUITE}/share.spec.ts`] = "x"),
    "sha256 でない",
  ],
  [
    "W6 どの根の下にも無いファイル",
    (rec) => (rec.checkpoints[0].files["other/x.ts"] = H),
    "どの根の下にも無い",
  ],
  [
    "W6 除外名の下のファイル",
    (rec) => (rec.checkpoints[0].files[`${SLUG}/new/t/x.json`] = H),
    "指紋から外す名前",
  ],
  [
    "W7 スイートの根がファイルを持たない",
    each((c) => c.roots.push("e2e/other")),
    "ファイルを 1 つも持たない",
  ],
  [
    "W8 前の区切りから追加・書き換えが無い",
    (rec) => (rec.checkpoints[2].files = { ...rec.checkpoints[1].files }),
    "追加・書き換えを 1 つも持たない",
  ],
  [
    "W9 gated の指紋に strength.md が無い",
    (rec) => {
      delete rec.checkpoints[2].files[`${SLUG}/strength.md`];
      rec.checkpoints[2].files[`${SLUG}/extra.md`] = H;
    },
    "strength.md が無い",
  ],
])("record が書かない形の記録は verify で exit 2: %s", (_name, mutate, needle) => {
  const dir = gatedProject();
  editRecord(dir, mutate);
  const r = verify(dir, "gated");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain(needle);
});

test("壊れた JSON の記録は verify で exit 2、authored はそれを読まずに記録し直せる", () => {
  const dir = gatedProject();
  writeFileSync(join(dir, SLUG, "checkpoints.json"), "{");
  expect(verify(dir, "gated").status).toBe(2);
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  expect(verify(dir, "authored").status).toBe(0);
});

// Issue #474: --include の包含と重複を字面だけで判定すると、slug のディレクトリの中を指すシンボリックリンクが
// スイートの根として通り、スイートを 1 つも照合しないまま record と verify が通る。

test("#474 再現: slug のディレクトリの中のファイルを指すリンクを --include にすると record は exit 2", () => {
  const dir = project();
  rmSync(join(dir, SUITE), { recursive: true });
  mkdirSync(join(dir, "e2e/parity"), { recursive: true });
  symlinkSync(join(dir, SLUG, "reactions.json"), join(dir, "e2e/parity/share.spec.ts"));
  const r = record(dir, "authored", ["--include", "e2e/parity/share.spec.ts"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--dir の中を指す");
  // 記録が作られていないので、続く verify も通らない
  expect(verify(dir, "authored").status).toBe(1);
});

test("#474: slug のディレクトリそのものを指すリンクを --include にすると record は exit 2", () => {
  const dir = project();
  symlinkSync(join(dir, SLUG), join(dir, "e2e/parity/alias"));
  const r = record(dir, "authored", ["--include", "e2e/parity/alias"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--dir の中を指す");
});

test("#474: 字面の違う 2 つの --include が同じ実体を指すと record は exit 2", () => {
  const dir = project();
  symlinkSync(join(dir, SUITE), join(dir, "e2e/alias"));
  const r = record(dir, "authored", ["--include", SUITE, "--include", "e2e/alias"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("同じ実体");
});

test("#474 陽性コントロール: slug のディレクトリの外を指すリンクは --include として通る", () => {
  const dir = project();
  symlinkSync(join(dir, SUITE), join(dir, "e2e/alias"));
  expect(record(dir, "authored", ["--include", "e2e/alias"]).status).toBe(0);
  const r = verify(dir, "authored");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, files: 2 });
});

test("#474: 記録した後にスイートの根を slug のディレクトリの中を指すリンクへ差し替えると verify は exit 2（W4 を実パスで）", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  rmSync(join(dir, SUITE), { recursive: true });
  symlinkSync(join(dir, SLUG), join(dir, SUITE));
  const r = verify(dir, "authored");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--dir の中を指す");
});

test("#474: 記録の 2 つのスイートの根が同じ実体を指すと verify は exit 2（W4 を実パスで）", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  symlinkSync(join(dir, SUITE), join(dir, "e2e/alias"));
  editRecord(dir, (rec) => {
    rec.checkpoints[0].roots.push("e2e/alias");
    rec.checkpoints[0].files["e2e/alias/share.spec.ts"] =
      rec.checkpoints[0].files[`${SUITE}/share.spec.ts`];
  });
  const r = verify(dir, "authored");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("同じ実体");
});

test("#474: slug のディレクトリを含む祖先を --include にすると record は exit 2（別機能の成果物を指紋に混ぜない）", () => {
  const dir = project();
  const r = record(dir, "authored", ["--include", ".replace/parity"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--dir を含む");
});

test("#474: 記録のスイートの根が slug のディレクトリの祖先なら verify は exit 2（W4 を実パスで）", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  editRecord(dir, (rec) => rec.checkpoints[0].roots.push(".replace/parity"));
  const r = verify(dir, "authored");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--dir を含む");
});
