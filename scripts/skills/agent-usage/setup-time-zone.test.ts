import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { confirmSystemTimeZone } from "../../../skills/agent-usage/scripts/agent-usage.mjs";
import { isUtcTimeZone } from "../../../skills/agent-usage/scripts/lib/time.mjs";
import { setup, userConfigOf } from "./cli-helpers.ts";

// setup がタイムゾーンを決めるときの UTC の扱い（Issue #890）。
// 入力の軸:
//   値の出所       --time-zone／人の設定の値／マシンのタイムゾーン（このときだけ確かめる）。
//   マシンの値     UTC の名前（別名を含む）／UTC 以外。
//   対話           できる（1 行を読める）／できない（stdin か stdout が端末でない）。
//   入力           空（Enter）／正しい IANA の名前／IANA の名前でない（その後に正しい名前・空・読めない）／読めない（上限を過ぎた）。
//   設定を作る側   setup／collect（setup を通らずに人の設定を作る）。

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

  test("対話できる実行で、付け方の案内を先に出さずに尋ねる（UTC で集計すると言い切ってから別の値を尋ねない）", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(confirmSystemTimeZone("UTC", () => "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(log).not.toHaveBeenCalled();
    expect(write.mock.calls.flat().join("")).toMatch(/Enter、別の時間帯なら IANA の名前/);
  });

  test("対話できる実行で入力が読めなければ（上限を過ぎたなど）、付け方を示して UTC のまま使う", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(confirmSystemTimeZone("UTC", () => null)).toBe("UTC");
    expect(log.mock.calls.flat().join("\n")).toMatch(/--time-zone Asia\/Tokyo/);
  });

  test("対話できる実行で IANA の名前でない値を入れたら、止めずにもう一度尋ね、次の入力を使う", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const answers = ["Not/AZone", "Asia/Tokyo"];
    const read = vi.fn(() => answers.shift() ?? null);
    expect(confirmSystemTimeZone("UTC", read)).toBe("Asia/Tokyo");
    expect(read).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.flat().join("")).toMatch(
      /IANA のタイムゾーンの名前ではない: Not\/AZone/,
    );
  });

  test("打ち間違えた後に Enter なら、マシンの値を使う", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const answers = ["Not/AZone", ""];
    expect(confirmSystemTimeZone("UTC", () => answers.shift() ?? null)).toBe("UTC");
  });

  test("打ち間違えた後に入力が読めなければ（上限を過ぎたなど）、付け方を示して UTC のまま使う", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const answers = ["Not/AZone", "Also/Wrong"];
    expect(confirmSystemTimeZone("UTC", () => answers.shift() ?? null)).toBe("UTC");
    expect(log.mock.calls.flat().join("\n")).toMatch(/--time-zone Asia\/Tokyo/);
  });
});

describe("setup のタイムゾーンの決め方（CLI）", () => {
  test("setup を通らずに collect が人の設定を作るときも、マシンが UTC なら付け方を示す", async () => {
    const { tmp, cli, cliWith, git } = await setup();
    expect((await cli("setup", "--time-zone", "Asia/Tokyo")).status).toBe(0);
    await git("switch", "-q", "-c", "feature/5-x");
    // 別の人（人の設定が無い）が、.agent-usage/ のある clone で collect する
    const other = { TZ: "UTC", XDG_CONFIG_HOME: `${tmp}/xdg-other` };
    const r = await cliWith(other, "collect");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/--time-zone Asia\/Tokyo のように/);
    expect(readFileSync(`${tmp}/xdg-other/skills/shoji9x9/agent-usage.jsonc`, "utf8")).toMatch(
      /"timeZone": "UTC"/,
    );
  });

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
