// テキスト拡張子への制御バイト混入検査の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸           | 値                                                             |
// | ------------ | -------------------------------------------------------------- |
// | バイト       | NUL / その他の C0 (0x01, 0x1b) / DEL (0x7f) / 許可 (TAB LF CR)  |
// | 内容         | ASCII / 多バイト UTF-8（日本語）                                 |
// | 位置         | 先頭行 / 2 行目以降（行・列の計算を分ける）                      |
// | 対象拡張子   | テキスト（.md .js …） / 非テキスト（.png .bin）                 |
// | 引数         | 明示（ステージ差分） / 無し（追跡ファイル全体）                  |
// | 対象件数     | 0 件 / 1 件 / 複数件                                            |
//
// 陽性コントロールは合成 fixture だけでなく**実データ**でも取る——このリポジトリで実際に
// NUL が混入していた kaizen ノートの修正前の版（NUL を戻したもの）を入力にする。
// 陰性コントロールは実リポジトリ全体（修正後は 0 件）。
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkFiles,
  findControlBytes,
  isTextPath,
  trackedTextFiles,
} from "./check-control-chars.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-control-chars.js");
const NUL = String.fromCharCode(0);

test("許可バイト（TAB / LF / CR）と通常の本文は違反 0 件", () => {
  const buf = Buffer.from("a\tb\r\nマルチバイトの本文\n", "utf8");
  expect(findControlBytes(buf)).toEqual([]);
});

test("NUL を検出し、行・列を 1 始まりで報告する", () => {
  const buf = Buffer.from(`1 行目\n2 行目${NUL}の後ろ\n`, "utf8");
  const hits = findControlBytes(buf);
  expect(hits).toHaveLength(1);
  expect(hits[0].byte).toBe(0);
  expect(hits[0].line).toBe(2);
  // 列はバイト単位（多バイト文字を含む行でも位置が一意に決まる）。
  expect(hits[0].col).toBe(Buffer.from("2 行目", "utf8").length + 1);
});

test("NUL 以外の C0 と DEL も落とす（0x01 / 0x1b / 0x7f）", () => {
  for (const byte of [0x01, 0x1b, 0x7f]) {
    const hits = findControlBytes(Buffer.from([0x61, byte, 0x62]));
    expect(hits.map((h) => h.byte)).toEqual([byte]);
  }
});

test("複数件・先頭行も位置を取り違えない", () => {
  const buf = Buffer.from([0x00, 0x61, 0x0a, 0x62, 0x00]);
  expect(findControlBytes(buf)).toEqual([
    { line: 1, col: 1, byte: 0 },
    { line: 2, col: 2, byte: 0 },
  ]);
});

test("対象拡張子の判定: テキストだけを拾う", () => {
  expect(isTextPath("a/b.md")).toBe(true);
  expect(isTextPath("a/b.mjs")).toBe(true);
  expect(isTextPath("a/b.yaml")).toBe(true);
  expect(isTextPath("a/b.png")).toBe(false);
  expect(isTextPath("a/b.bin")).toBe(false);
  expect(isTextPath("a/README")).toBe(false);
});

test("陽性コントロール（実データ）: 混入していた版を入力にすると検出する", () => {
  // ノートは適用後に .kaizen/archive/ へ移るので、両方の置き場を見る。
  // 見つからないときは skip せず落とす（陽性コントロールが消えたまま緑になるのを防ぐ）。
  const NOTE = "2026-09-18-control-characters-rejected-in-tool-arguments.md";
  const notePath = [join(repoRoot, ".kaizen", NOTE), join(repoRoot, ".kaizen/archive", NOTE)].find(
    (p) => existsSync(p),
  );
  expect(notePath, `${NOTE} が .kaizen/ にも .kaizen/archive/ にも無い`).toBeDefined();
  const fixed = readFileSync(notePath, "utf8");
  // 修正で `U+0000` という表記へ置き換えた箇所を、混入していた当時の生バイトへ戻す。
  expect(fixed).toContain("U+0000");
  const broken = Buffer.from(fixed.replaceAll("U+0000", NUL), "utf8");
  const hits = findControlBytes(broken);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every((h) => h.byte === 0)).toBe(true);
});

test("陰性コントロール（実データ）: 実リポジトリの追跡テキストファイルは違反 0 件", () => {
  const files = trackedTextFiles(repoRoot);
  expect(files.length).toBeGreaterThan(100);
  expect(checkFiles(files, repoRoot)).toEqual([]);
});

test("読めないファイルはクラッシュさせず、走査できていないこととして報告する", () => {
  // git ls-files は index を読むので、作業ツリーから消えた追跡ファイルや壊れた symlink が
  // 入りうる。素の readFileSync だとスタックトレースごと検査が止まり、「走査できていない」が
  // 検査結果として残らない。
  const dir = mkdtempSync(join(tmpdir(), "control-chars-"));
  try {
    const violations = checkFiles(["missing.md"], dir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/missing\.md: 読めないため走査できていない/);
    // 陰性コントロール: 実在するファイルは通常どおり判定される（読めない扱いに倒れない）。
    writeFileSync(join(dir, "ok.md"), "本文\n");
    expect(checkFiles(["ok.md"], dir)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: 引数で渡したテキストファイルの違反を exit 1 で報告する", () => {
  const dir = mkdtempSync(join(tmpdir(), "control-chars-"));
  writeFileSync(join(dir, "bad.md"), `# 見出し\n本文${NUL}\n`);
  writeFileSync(join(dir, "good.md"), "# 見出し\n本文\n");
  const r = spawnSync(process.execPath, [script, "bad.md", "good.md"], {
    cwd: dir,
    encoding: "utf8",
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/bad\.md:2:\d+: 制御バイト NUL/);
  expect(r.stderr).not.toMatch(/good\.md/);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI: 非テキスト拡張子だけを渡したら成功に倒さず exit 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "control-chars-"));
  writeFileSync(join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  const r = spawnSync(process.execPath, [script, "image.png"], { cwd: dir, encoding: "utf8" });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/テキスト拡張子のファイルが無い/);
  rmSync(dir, { recursive: true, force: true });
});

test("CLI: 引数なしで実リポジトリを走査すると exit 0 と走査件数を出す", () => {
  const r = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/control-chars: OK（\d+ 件）/);
});
