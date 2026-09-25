// parity-suite の区切りの記録・照合（checkpoint.mjs）の回帰テスト（Issue #468）。
//
// 新しい文脈から再開してよいかを成果物の側で決める道具なので、壊れ方は「区切りの後に動いた成果物を
// 動いていないと答える」と「順序を飛ばした区切りを記録できる」の 2 つ。
// 追加・削除・変更のそれぞれで verify が落ちること、区切りの後に正規に変わるもの（pending-decisions.json・
// noise-pass2/・new/）では落ちないことを両側で固定する。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  expect(record(dir, "captured").status).toBe(0);
  const r = verify(dir, "authored");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("最後に記録した区切りは captured");
  expect(verify(dir, "captured").status).toBe(0);
});

test("後の区切りは前の区切りの --include を引き継ぐ（スイートを書き換えた再開を見逃さない）", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  const rec = record(dir, "captured");
  expect(JSON.parse(rec.stdout).roots).toEqual([SLUG, SUITE]);
  writeFileSync(join(dir, SUITE, "share.spec.ts"), "// edited\n");
  expect(verify(dir, "captured").status).toBe(1);
});

test("前の区切りに戻って記録し直すと、後の区切りの記録は消える", () => {
  const dir = project();
  expect(record(dir, "authored", ["--include", SUITE]).status).toBe(0);
  expect(record(dir, "captured").status).toBe(0);
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
  expect(record(dir, "captured").status).toBe(0);
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

test.each([
  ["壊れた JSON", "{"],
  ["checkpoints が配列でない", JSON.stringify({ version: "1", checkpoints: {} })],
  ["版が違う", JSON.stringify({ version: "0", checkpoints: [] })],
  [
    "roots が空（指紋の根が無い記録）",
    JSON.stringify({
      version: "1",
      checkpoints: [{ at: "authored", roots: [], files: { "a.json": "0".repeat(64) } }],
    }),
  ],
  [
    "files が空",
    JSON.stringify({
      version: "1",
      checkpoints: [{ at: "authored", roots: [".replace/parity/share"], files: {} }],
    }),
  ],
  [
    "指紋が sha256 でない",
    JSON.stringify({
      version: "1",
      checkpoints: [{ at: "authored", roots: [".replace/parity/share"], files: { "a.json": "x" } }],
    }),
  ],
  [
    "roots の先頭が --dir でない",
    JSON.stringify({
      version: "1",
      checkpoints: [
        {
          at: "authored",
          roots: ["e2e/parity/share"],
          files: { "e2e/parity/share/share.spec.ts": "0".repeat(64) },
        },
      ],
    }),
  ],
  [
    "語彙外の区切りの記録",
    JSON.stringify({ version: "1", checkpoints: [{ at: "done", roots: [], files: {} }] }),
  ],
])("記録が崩れていれば verify は exit 2: %s", (_name, text) => {
  const dir = project();
  writeFileSync(join(dir, SLUG, "checkpoints.json"), text);
  expect(verify(dir, "authored").status).toBe(2);
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
