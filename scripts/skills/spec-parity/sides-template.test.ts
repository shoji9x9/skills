// 雛形 skills/spec-parity/assets/sides.template.ts の回帰テスト（Issue #565）。
//
// この雛形は e2e を import しないので、このリポジトリで読み込める。利用者のリポジトリでは tests/parity/sides.ts として、
// e2e の設定とテストの両方が読む。期待値は、雛形の冒頭のコメントと references/suite-authoring.md「side の対応表」の仕様から決める。
//   - 側は PARITY_<CURRENT|NEW>_UI_URL で決まる。渡していない側は対応表に入れない。API の URL を省くと UI と同じになる。
//   - 末尾の / の有無で別の URL にしない。
//   - 側が決まらないとき（どちらにも当たらない・両方に当たる）はテストを止める。取り違えた側の期待値で通さない。
// 対応表はモジュールの読み込み時に環境変数から作るので、ケースごとにモジュールを読み込み直す。
// このリポジトリのテストはモジュールを Node のまま読み込む（vitest.config.ts の viteModuleRunner: false）ので、vi.resetModules では読み直せない。
// 読み込み先に毎回違う query を付けて、別のモジュールとして読み込む。

import { afterEach, describe, expect, test, vi } from "vitest";

// 雛形は tsconfig.repo.json の対象の外にあるので、型は雛形の公開部分をここに書く（import の型にしない）。
type Urls = { app: string; api: string };
type Sides = {
  SIDES: Partial<Record<"current" | "new", Urls>>;
  sideOf: (baseUrl: string) => "current" | "new";
  apiOf: (baseUrl: string) => string;
};

const KEYS = [
  "PARITY_CURRENT_UI_URL",
  "PARITY_CURRENT_API_URL",
  "PARITY_NEW_UI_URL",
  "PARITY_NEW_API_URL",
] as const;

let loads = 0;

/** 環境変数を決めてから雛形を読み込む。渡していない変数は、実行しているシェルの値を引き継がず空にする。 */
async function load(env: Partial<Record<(typeof KEYS)[number], string>>): Promise<Sides> {
  for (const key of KEYS) vi.stubEnv(key, env[key] ?? "");
  loads += 1;
  const url = new URL("../../../skills/spec-parity/assets/sides.template.ts", import.meta.url);
  url.search = `?load=${loads}`;
  const loaded: Sides = await import(url.href);
  return loaded;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const CUR = "http://current.test:3000";
const NEW = "http://new.test:4000";
const BOTH = { PARITY_CURRENT_UI_URL: CUR, PARITY_NEW_UI_URL: NEW };

describe("対応表（SIDES）", () => {
  test("環境変数が無ければ、どちらの側も入らない", async () => {
    expect((await load({})).SIDES).toEqual({});
  });

  test("空文字の UI の URL は、渡していないものとして扱う", async () => {
    expect((await load({ PARITY_CURRENT_UI_URL: "", PARITY_NEW_UI_URL: NEW })).SIDES).toEqual({
      new: { app: NEW, api: NEW },
    });
  });

  test("current だけを渡すと、new は入らない", async () => {
    expect((await load({ PARITY_CURRENT_UI_URL: CUR })).SIDES).toEqual({
      current: { app: CUR, api: CUR },
    });
  });

  test("API の URL を省くと UI と同じになり、渡すとその値になる", async () => {
    const sides = (await load({ ...BOTH, PARITY_CURRENT_API_URL: "http://current.test:3001" }))
      .SIDES;
    expect(sides.current).toEqual({ app: CUR, api: "http://current.test:3001" });
    expect(sides.new).toEqual({ app: NEW, api: NEW });
  });

  test("空文字の API の URL は省いたものとして UI と同じになる", async () => {
    const sides = (await load({ ...BOTH, PARITY_NEW_API_URL: "" })).SIDES;
    expect(sides.new?.api).toBe(NEW);
  });

  test("API の URL だけを渡しても、UI の URL が無い側は入らない", async () => {
    expect((await load({ PARITY_NEW_API_URL: NEW })).SIDES).toEqual({});
  });
});

describe("sideOf: baseUrl から側を求める", () => {
  test.each([
    ["current の URL", CUR, "current"],
    ["new の URL", NEW, "new"],
    ["末尾に / がある current の URL", `${CUR}/`, "current"],
    ["末尾に / がある new の URL", `${NEW}/`, "new"],
  ])("%s は %s の側", async (_name, url, side) => {
    expect((await load(BOTH)).sideOf(url)).toBe(side);
  });

  test("パスを持つ URL は、末尾の / の有無と重ねた / を区別せず比べる", async () => {
    const m = await load({
      PARITY_CURRENT_UI_URL: "http://host.test/app/",
      PARITY_NEW_UI_URL: "http://host.test/app-next",
    });
    expect(m.sideOf("http://host.test/app")).toBe("current");
    expect(m.sideOf("http://host.test/app//")).toBe("current");
    expect(m.sideOf("http://host.test/app-next/")).toBe("new");
  });

  test.each([
    ["ホストが違う", "http://other.test:3000"],
    ["ポートが違う", "http://current.test:3001"],
    ["スキームが違う", "https://current.test:3000"],
    ["パスが対応表の URL の続き（前方一致）", `${CUR}/orders`],
  ])("%s URL は、どちらの側にも当たらず止まる", async (_name, url) => {
    const m = await load(BOTH);
    expect(() => m.sideOf(url)).toThrow(/側を決められない baseUrl.*当たった側: なし/);
  });

  test("パスが対応表の URL の手前までしか一致しない URL は止まる", async () => {
    const m = await load({ PARITY_CURRENT_UI_URL: "http://host.test/app/v1" });
    expect(() => m.sideOf("http://host.test/app")).toThrow(/側を決められない/);
  });

  test("渡していない側の URL は、その側として扱わず止まる", async () => {
    const m = await load({ PARITY_CURRENT_UI_URL: CUR });
    expect(() => m.sideOf(NEW)).toThrow(/当たった側: なし/);
  });

  test("環境変数が無ければ、どの URL でも止まる", async () => {
    await expect(load({}).then((m) => m.sideOf(CUR))).rejects.toThrow(/当たった側: なし/);
  });

  test("current と new が同じ URL なら、両方に当たるので止まる", async () => {
    const m = await load({ PARITY_CURRENT_UI_URL: CUR, PARITY_NEW_UI_URL: `${CUR}/` });
    expect(() => m.sideOf(CUR)).toThrow(/当たった側: current, new/);
  });

  test("baseUrl が URL として読めなければ、側を返さず例外にする", async () => {
    const m = await load(BOTH);
    expect(() => m.sideOf("not a url")).toThrow();
  });
});

describe("apiOf: 側の API の baseURL", () => {
  test("API の URL を渡した側は、その値を返す", async () => {
    const m = await load({ ...BOTH, PARITY_NEW_API_URL: "http://new.test:4001" });
    expect(m.apiOf(NEW)).toBe("http://new.test:4001");
  });

  test("API の URL を省いた側は、UI と同じ URL を返す", async () => {
    expect((await load(BOTH)).apiOf(`${CUR}/`)).toBe(CUR);
  });

  test("側を決められない baseUrl は止まる", async () => {
    const m = await load(BOTH);
    expect(() => m.apiOf("http://other.test")).toThrow(/側を決められない/);
  });
});
