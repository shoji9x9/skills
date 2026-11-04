import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  confirmSystemTimeZone,
  isUtcTimeZone,
} from "../../../skills/agent-usage/scripts/agent-usage.mjs";
import { setup, userConfigOf } from "./cli-helpers.ts";

// setup がタイムゾーンを決めるときの UTC の扱い（Issue #890）。
// 入力の軸:
//   値の出所       --time-zone／人の設定の値／マシンのタイムゾーン（このときだけ確かめる）。
//   マシンの値     UTC の名前（別名を含む）／UTC 以外。
//   対話           できる（1 行を読める）／できない（stdin か stdout が端末でない）。
//   入力           空（Enter）／正しい IANA の名前／IANA の名前でない。

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isUtcTimeZone", () => {
  test.each([
    "UTC",
    "Etc/UTC",
    "Etc/UCT",
    "Universal",
    "Etc/Zulu",
    "GMT",
    "Etc/GMT",
    "Etc/GMT+0",
    "Etc/GMT-0",
    "GMT0",
  ])("%s は UTC として扱う", (tz) => {
    expect(isUtcTimeZone(tz)).toBe(true);
  });

  // 冬に UTC と同じ時刻になる地域の名前や、UTC を前方に含むだけの名前は UTC として扱わない
  test.each(["Asia/Tokyo", "Europe/London", "Africa/Abidjan", "Etc/GMT+9", "UTC+9", "UTCX", ""])(
    "%s は UTC として扱わない",
    (tz) => {
      expect(isUtcTimeZone(tz)).toBe(false);
    },
  );
});

describe("confirmSystemTimeZone", () => {
  test("UTC 以外のマシンの値は、案内も確認もせずにそのまま使う", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const read = vi.fn(() => "Europe/Paris");
    expect(confirmSystemTimeZone("Asia/Tokyo", read)).toBe("Asia/Tokyo");
    expect(read).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  test("対話できない実行では、UTC を使うことと付け方を示し、UTC のまま使う", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(confirmSystemTimeZone("Etc/UTC", null)).toBe("Etc/UTC");
    expect(log.mock.calls.flat().join("\n")).toMatch(/--time-zone Asia\/Tokyo/);
  });

  test.each([
    ["空の入力（Enter）なら UTC のまま", "", "UTC"],
    ["前後の空白だけなら UTC のまま", "  ", "UTC"],
    ["IANA の名前を入れたらその値", " Asia/Tokyo ", "Asia/Tokyo"],
  ])("対話できる実行で、%s", (_name, answer, expected) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const read = vi.fn(() => answer);
    expect(confirmSystemTimeZone("UTC", read)).toBe(expected);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("対話できる実行で IANA の名前でない値を入れたら、設定を作らずに止める", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(() => confirmSystemTimeZone("UTC", () => "Not/AZone")).toThrow(/IANA/);
  });
});

describe("setup のタイムゾーンの決め方（CLI）", () => {
  test("マシンが UTC で --time-zone が無ければ、UTC を使うことと付け方を示し、UTC で設定を作る", async () => {
    const { tmp, cliWith } = await setup();
    const r = await cliWith({ TZ: "UTC" }, "setup", "--person-id", "p-0123abcd");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/--time-zone Asia\/Tokyo のように/);
    expect(r.stdout).toMatch(/タイムゾーン: UTC/);
    expect(readFileSync(userConfigOf(tmp), "utf8")).toMatch(/"timeZone": "UTC"/);
  });

  test("マシンが UTC 以外なら、案内を出さずにその値で設定を作る", async () => {
    const { tmp, cliWith } = await setup();
    const r = await cliWith({ TZ: "Asia/Tokyo" }, "setup", "--person-id", "p-0123abcd");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/--time-zone Asia\/Tokyo のように/);
    expect(readFileSync(userConfigOf(tmp), "utf8")).toMatch(/"timeZone": "Asia\/Tokyo"/);
  });

  test("--time-zone で UTC を渡したときと、人の設定に値があるときは、マシンが UTC でも案内を出さない", async () => {
    const { cliWith } = await setup();
    const given = await cliWith({ TZ: "UTC" }, "setup", "--time-zone", "UTC");
    expect(given.status, given.stderr).toBe(0);
    expect(given.stdout).not.toMatch(/--time-zone Asia\/Tokyo のように/);
    const again = await cliWith({ TZ: "UTC" }, "setup");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).not.toMatch(/--time-zone Asia\/Tokyo のように/);
  });
});
