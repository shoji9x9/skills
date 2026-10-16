// Stop の Hook が止めた印の回帰テスト。
//
// | 軸             | 値                                                                   |
// | -------------- | -------------------------------------------------------------------- |
// | session_id     | 使える形 / パスの区切りを含む / 文字列でない                           |
// | 続けさせた後か | stop_hook_active が true / false                                     |
// | 印の名前の実体 | 無い / ファイル / リンク先の無いシンボリックリンク / 消せないディレクトリ |
//
// 印を見る側（alreadyBlocked）と書く側（recordBlocked）の両方を、同じ状態の表で確かめる。
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { alreadyBlocked, blockedMarker, recordBlocked } from "./stop-marker.ts";
import { makeTempDir } from "../lib/testing/test-tmpdir.ts";

const HOOK = "test-hook";
let dir = "";
let errors: string[] = [];
beforeEach(() => {
  dir = makeTempDir("stop-marker-");
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.join(" "));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function marker(): string {
  const m = blockedMarker(HOOK, "s", dir);
  if (!m) throw new Error("印のパスを作れない");
  return m;
}

test.each([
  ["パスの区切りを含む", "../x"],
  ["文字列でない", 1],
  ["空文字", ""],
])("session_id が%sなら、印のパスを作らない", (_name, sessionId) => {
  expect(blockedMarker(HOOK, sessionId, dir)).toBeNull();
});

test("印のパスは Hook の名前と session_id で決まる", () => {
  expect(marker()).toBe(join(dir, "test-hook-s.blocked"));
});

test("新しい一続き（stop_hook_active が false）では、前の印を消して確かめさせる", () => {
  writeFileSync(marker(), "");
  expect(alreadyBlocked(HOOK, { session_id: "s", stop_hook_active: false }, dir)).toBe(false);
  expect(existsSync(marker())).toBe(false);
});

test("前の印を消せなくても、例外にせずに確かめさせる", () => {
  mkdirSync(marker());
  expect(alreadyBlocked(HOOK, { session_id: "s", stop_hook_active: false }, dir)).toBe(false);
  expect(errors.join("\n")).toContain("前の印を消せない");
});

test("続けさせた後で印が無ければ、確かめさせる", () => {
  expect(alreadyBlocked(HOOK, { session_id: "s", stop_hook_active: true }, dir)).toBe(false);
});

test("続けさせた後で印が在れば、通す", () => {
  writeFileSync(marker(), "");
  expect(alreadyBlocked(HOOK, { session_id: "s", stop_hook_active: true }, dir)).toBe(true);
});

test("続けさせた後で印の名前にリンク先の無いシンボリックリンクが在れば、印が在るとみなして通す", () => {
  symlinkSync(join(dir, "missing"), marker());
  expect(alreadyBlocked(HOOK, { session_id: "s", stop_hook_active: true }, dir)).toBe(true);
});

test("続けさせた後で session_id が使えない形なら、印を置けないので通す", () => {
  expect(alreadyBlocked(HOOK, { session_id: "../x", stop_hook_active: true }, dir)).toBe(true);
});

test("止めたら印を残す", () => {
  recordBlocked(HOOK, { session_id: "s" }, dir);
  expect(existsSync(marker())).toBe(true);
  expect(errors).toEqual([]);
});

test("印の名前にシンボリックリンクが先に在れば、リンク先を書かずに、残せないことを示す", () => {
  const target = join(dir, "target");
  symlinkSync(target, marker());
  recordBlocked(HOOK, { session_id: "s" }, dir);
  expect(existsSync(target)).toBe(false);
  expect(errors.join("\n")).toContain("止めた印を残せない");
});
