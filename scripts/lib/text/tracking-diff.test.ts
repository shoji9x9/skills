// tracking-diff.ts（追跡 Issue の前回との差分）のテスト。点検ごとの使い方は、各点検のテストで確かめる。
//
// | 軸 | 値 |
// | --- | --- |
// | 目印の名前 | 正しい / 記号を含む / 空 |
// | 目印 | 無い / 読める / JSON でない / 配列でない / 形の違う識別子 / 重複 / 行の途中にある |
// | 差分 | 新規 / 継続 / 解消 / 前回なし |
// | 引数 | 正しい / --previous つき / 足りない / 未知 / 同じオプションが 2 回 / 値が無い / 空 / 位置引数 |
import { describe, expect, test } from "vitest";
import {
  diffKeys,
  formatDiffComment,
  markerLine,
  parseTrackingCli,
  readKeys,
  trackingKeys,
} from "./tracking-diff.ts";

const FORM = /^k \S+$/u;

describe("目印", () => {
  test("書いた目印を読む", () => {
    const body = `本文\n\n${markerLine("weekly-check", ["k a", "k b"])}\n`;
    expect(readKeys(body, "weekly-check", FORM)).toEqual(["k a", "k b"]);
  });

  test("目印が無ければ空、別の名前の目印は読まない", () => {
    expect(readKeys("本文\n", "weekly-check", FORM)).toEqual([]);
    expect(readKeys(`${markerLine("other", ["k a"])}\n`, "weekly-check", FORM)).toEqual([]);
  });

  test("行の途中にある目印は読まない", () => {
    expect(readKeys(`x ${markerLine("weekly-check", ["k a"])}\n`, "weekly-check", FORM)).toEqual(
      [],
    );
  });

  test.each([
    ["JSON でない", "[", "JSON"],
    ["配列でない", "{}", "配列でない"],
    ["形の違う識別子", '["x"]', "識別子の形でない"],
    ["文字列でない識別子", "[1]", "識別子の形でない"],
    ["重複", '["k a","k a"]', "重複"],
  ])("%s ときは、直し方を添えて例外にする", (_name, json, message) => {
    const body = `<!-- weekly-check:keys ${json} -->\n`;
    expect(() => readKeys(body, "weekly-check", FORM)).toThrow(message);
    expect(() => readKeys(body, "weekly-check", FORM)).toThrow(
      "`<!-- weekly-check:keys` で始まる行を消すと、すべて新規として読み直す",
    );
  });

  test.each([
    ["記号を含む", "a.b"],
    ["空", ""],
    ["大文字で始まる", "Weekly"],
  ])("名前が %s ときは例外にする", (_name, name) => {
    expect(() => markerLine(name, [])).toThrow("目印の名前の形でない");
    expect(() => readKeys("", name, FORM)).toThrow("目印の名前の形でない");
  });
});

describe("差分", () => {
  test("新規・継続・解消に分ける", () => {
    expect(diffKeys(["k a", "k b"], ["k b", "k c"])).toEqual({
      added: ["k a"],
      kept: ["k b"],
      resolved: ["k c"],
    });
  });

  test("コメントに件数と、新規・解消の識別子を書く", () => {
    const comment = formatDiffComment("候補", 2, diffKeys(["k a", "k b"], ["k b", "k c"]));
    expect(comment).toBe(
      "候補: 2 件（新規 1 件・継続 1 件・前回から解消 1 件）\n\n新規: k a\n\n解消: k c\n",
    );
  });

  test("差分が無ければ件数だけ", () => {
    expect(formatDiffComment("候補", 0, diffKeys([], []))).toBe(
      "候補: 0 件（新規 0 件・継続 0 件・前回から解消 0 件）\n",
    );
  });
});

test("点検ごとの目印・形・識別子の作り方で、書いて読み直す", () => {
  const tracking = trackingKeys({
    marker: "weekly-check",
    keyForm: FORM,
    keyOf: (n: number) => `k ${n}`,
  });
  const body = `${tracking.markerLine([1, 2])}\n`;
  expect(tracking.previousKeys(body)).toEqual(["k 1", "k 2"]);
  expect(tracking.diff([2, 3], ["k 1", "k 2"])).toEqual({
    added: ["k 3"],
    kept: ["k 2"],
    resolved: ["k 1"],
  });
});

describe("引数", () => {
  test("本文・コメント・前回の本文のパスを読む", () => {
    expect(parseTrackingCli(["--out", "a", "--comment-out", "b"])).toEqual({
      out: "a",
      commentOut: "b",
      previous: undefined,
    });
    expect(parseTrackingCli(["--out", "a", "--comment-out", "b", "--previous", "c"])).toEqual({
      out: "a",
      commentOut: "b",
      previous: "c",
    });
  });

  test.each([
    { name: "引数なし", args: [] },
    { name: "--comment-out が無い", args: ["--out", "a"] },
    { name: "値が無い", args: ["--out", "a", "--comment-out"] },
    { name: "未知のオプション", args: ["--out", "a", "--comment-out", "b", "--x", "c"] },
    { name: "同じオプションが 2 回", args: ["--out", "a", "--out", "b", "--comment-out", "c"] },
    { name: "位置引数", args: ["--out", "a", "--comment-out", "b", "c"] },
    { name: "--out が空白だけ", args: ["--out", " ", "--comment-out", "b"] },
    { name: "--previous が空", args: ["--out", "a", "--comment-out", "b", "--previous", ""] },
  ])("$name は null", ({ args }) => {
    expect(parseTrackingCli(args)).toBeNull();
  });
});
