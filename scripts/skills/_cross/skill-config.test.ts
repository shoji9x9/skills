// 配布スキルが同梱する設定の読み取り（scripts/skill-config/skill-config.mjs）のテスト。
// 設定を読むスキルはすべて同じ内容のコピーを持つので、同じテストをすべてのコピーに当てる（どのコピーもカバレッジの対象になる）。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸 | 値 |
// | --- | --- |
// | 層 | CLI / 環境変数（x-env あり・なし・空）/ local / user / repo / default / どれにも無い |
// | 人ごとの層の場所 | XDG_CONFIG_HOME が絶対パス / 空 / 相対パス / 無い（HOME） |
// | ファイルの中身 | 正常 / コメントと末尾のカンマ / 構文の誤り / キーの重複 / 最上位が配列 / 空 / $schema |
// | キー | 定義あり / 知らない / 置けない層 / 型・enum・const・範囲・pattern・items・required・anyOf・oneOf の誤り |
// | 旧い場所 | skills.yml（任意の名前空間）/ x-legacy のファイル / x-legacy の環境変数（空の値を含む）|
// | 書き込み | 無いキー / 同じ値 / 違う値 / --replace / 配列が無い / 配列がある / --unique-by の一致・不一致 / 書いた後に検証で落ちる / ファイルが無い / gitignore されていない local |
// | CLI | サブコマンドごとの正常系 / 引数の数 / 知らないオプション・サブコマンド / 値の無いオプション / 不正な名前 / JSON でない値 |
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import type * as Reader from "../../../skills/kaizen/scripts/skill-config/skill-config.mjs";
import {
  COPIES,
  type Env,
  expectUserLayerIgnored,
  repoRoot,
  setup,
} from "./skill-config-helpers.ts";

describe.each(COPIES)("%s", (copy) => {
  const load = async (): Promise<typeof Reader> => import(pathToFileURL(join(repoRoot, copy)).href);

  /** CLI の main をプロセスの中で呼ぶ。 */
  async function cli(argv: string[], env: Env, cwd: string) {
    const m = await load();
    let out = "";
    let err = "";
    const code = m.main(argv, { out: (s) => (out += s), err: (s) => (err += s), env, cwd });
    return { code, out, err };
  }

  test("コピーが 1 件以上ある（0 件なら describe.each が何も確かめない）", () => {
    expect(COPIES.length).toBeGreaterThan(0);
  });

  describe("置き場所", () => {
    test("XDG_CONFIG_HOME が絶対パスならその下、空か相対パスか無いなら HOME/.config の下に置く", async () => {
      const m = await load();
      expect(m.userConfigHome({ XDG_CONFIG_HOME: "/x", HOME: "/h" })).toBe("/x");
      expect(m.userConfigHome({ XDG_CONFIG_HOME: "", HOME: "/h" })).toBe("/h/.config");
      expect(m.userConfigHome({ XDG_CONFIG_HOME: "rel", HOME: "/h" })).toBe("/h/.config");
      expect(m.userConfigHome({ HOME: "/h" })).toBe("/h/.config");
      // HOME が無いか空なら、ユーザーのデータベースのホームを使う（同梱のシェルと同じ規則）
      // プロセスの HOME を別の値にして、os.homedir()（プロセスの HOME を読む）を使う実装と区別する
      const processHome = process.env.HOME;
      process.env.HOME = "/process-home";
      try {
        expect(m.userConfigHome({ HOME: "" })).toBe(join(userInfo().homedir, ".config"));
        expect(m.userConfigHome({})).toBe(join(userInfo().homedir, ".config"));
      } finally {
        if (processHome === undefined) delete process.env.HOME;
        else process.env.HOME = processHome;
      }
      // 絶対パスでない HOME でも止めない（人ごとの層を使わない呼び出しまで止めないため）。人ごとの層は読まない
      expect(m.ignoresUserLayer({ HOME: "rel" })).toBe(true);
      expect(m.ignoresUserLayer({ HOME: "rel", XDG_CONFIG_HOME: "/x" })).toBe(false);
      expect(m.ignoresUserLayer({ HOME: "/h" })).toBe(false);
      expect(m.userConfigHome({ HOME: "rel" })).toBe(join("rel", ".config"));
      expect(m.configPaths("/r", "t", { XDG_CONFIG_HOME: "/x" })).toEqual({
        local: "/r/.config/skills/shoji9x9/t.local.jsonc",
        user: "/x/skills/shoji9x9/t.jsonc",
        repo: "/r/.config/skills/shoji9x9/t.jsonc",
      });
    });

    test("リポジトリのルートは git の toplevel で、git の外なら cwd", async () => {
      const m = await load();
      const s = setup();
      const sub = join(s.root, "a/b");
      mkdirSync(sub, { recursive: true });
      expect(m.findRoot(sub)).toBe(
        execFileSync("git", ["rev-parse", "--show-toplevel"], {
          cwd: s.root,
          encoding: "utf8",
          timeout: CHILD_TIMEOUT_MS,
        }).trim(),
      );
      const outside = join(s.base, "outside");
      mkdirSync(outside);
      expect(m.findRoot(outside)).toBe(outside);
    });
  });

  describe("解決の順序", () => {
    test("local → user → repo → default の順に、キーごとに最初に見つかった値を使う", async () => {
      const m = await load();
      const s = setup();
      s.write("repo", '{ "tool": "b", "count": 3, "method": "m" }');
      s.write("user", '{ "tool": "a", "count": 5 }');
      s.write("local", '{ "tool": "b" }');
      const r = m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir });
      expect(r.tool).toEqual({ value: "b", source: "local", path: s.paths.local });
      expect(r.count).toEqual({ value: 5, source: "user", path: s.paths.user });
      expect(r.method).toEqual({ value: "m", source: "repo", path: s.paths.repo });
      expect("flag" in r).toBe(false);
    });

    test("どの層にも無ければスキーマのデフォルト、デフォルトも無ければ結果に含めない", async () => {
      const m = await load();
      const s = setup();
      const r = m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir });
      expect(r.tool).toEqual({ value: "a", source: "default", path: null });
      expect(r.method).toBeUndefined();
    });

    test("CLI は環境変数とファイルより優先し、環境変数は x-env を宣言したキーだけがファイルより優先する", async () => {
      const m = await load();
      const s = setup();
      s.write("local", '{ "tool": "a" }');
      s.write("repo", '{ "method": "file" }');
      const env = { ...s.env, T_TOOL: "b", T_COUNT: "7", T_FLAG: "off", method: "env" };
      const r = m.loadConfig({ name: "t", root: s.root, env, schemaDir: s.schemaDir });
      expect(r.tool).toMatchObject({ value: "b", source: "env" });
      expect(r.count).toMatchObject({ value: 7, source: "env" });
      expect(r.flag).toMatchObject({ value: false, source: "env" });
      expect(r.method).toMatchObject({ value: "file", source: "repo" });
      const c = m.loadConfig({
        name: "t",
        root: s.root,
        env,
        schemaDir: s.schemaDir,
        cli: { tool: "a" },
      });
      expect(c.tool).toEqual({ value: "a", source: "cli", path: null });
    });

    test("空の環境変数は無いものとして扱い、下の層へ進む", async () => {
      const m = await load();
      const s = setup();
      s.write("repo", '{ "tool": "b" }');
      const r = m.loadConfig({
        name: "t",
        root: s.root,
        env: { ...s.env, T_TOOL: "" },
        schemaDir: s.schemaDir,
      });
      expect(r.tool).toMatchObject({ value: "b", source: "repo" });
    });

    test("環境変数の真偽値は true/on/1 と false/off/0 を読み、それ以外と CLI の値は型の誤りにする", async () => {
      const m = await load();
      const s = setup();
      for (const [raw, want] of [
        ["true", true],
        ["on", true],
        ["1", true],
        ["false", false],
        ["0", false],
      ] as const) {
        const r = m.loadConfig({
          name: "t",
          root: s.root,
          env: { ...s.env, T_FLAG: raw },
          schemaDir: s.schemaDir,
        });
        expect(r.flag?.value).toBe(want);
      }
      expect(() =>
        m.loadConfig({
          name: "t",
          root: s.root,
          env: { ...s.env, T_FLAG: "yes" },
          schemaDir: s.schemaDir,
        }),
      ).toThrow(/環境変数 T_FLAG/);
      expect(() =>
        m.loadConfig({
          name: "t",
          root: s.root,
          env: { ...s.env, T_COUNT: "x" },
          schemaDir: s.schemaDir,
        }),
      ).toThrow(/環境変数 T_COUNT/);
      expect(() =>
        m.loadConfig({
          name: "t",
          root: s.root,
          env: s.env,
          schemaDir: s.schemaDir,
          cli: { tool: "z" },
        }),
      ).toThrow(/CLI の tool/);
    });

    test("値を使わなかった層のファイルも検証する", async () => {
      const m = await load();
      const s = setup();
      s.write("local", '{ "tool": "b" }');
      s.write("repo", '{ "tool": "a", "typo": 1 }');
      expect(() =>
        m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir }),
      ).toThrow(/知らないキー "typo"/);
    });
  });

  describe("人ごとの層を読まない（SHOJI9X9_SKILLS_IGNORE_USER_CONFIG）", () => {
    test("1 なら人ごとの層を読まず、人ごとの旧い置き場所も見ず、そのことを注意として出す", async () => {
      const m = await load();
      const s = setup();
      s.write("user", '{ "tool": "b", "typo": 1 }');
      mkdirSync(join(s.env.XDG_CONFIG_HOME ?? "", "old"), { recursive: true });
      writeFileSync(join(s.env.XDG_CONFIG_HOME ?? "", "old/config.json"), "{}");
      s.write("repo", '{ "count": 2 }');
      const notes: string[] = [];
      const r = m.loadConfig({
        name: "t",
        root: s.root,
        env: { ...s.env, SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: "1" },
        schemaDir: s.schemaDir,
        warn: (x) => notes.push(x),
      });
      expect(r.tool).toMatchObject({ value: "a", source: "default" });
      expect(r.count).toMatchObject({ value: 2, source: "repo" });
      expect(notes).toEqual([
        `note: 人ごとの層（${s.paths.user}）を読まない（SHOJI9X9_SKILLS_IGNORE_USER_CONFIG=1）\n`,
      ]);
    });

    test("リポジトリの旧い置き場所は、人ごとの層を読まないときも止める", async () => {
      const m = await load();
      const s = setup();
      mkdirSync(join(s.root, ".old"));
      writeFileSync(join(s.root, ".old/config"), "a=1\n");
      expect(() =>
        m.loadConfig({
          name: "t",
          root: s.root,
          env: { ...s.env, SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: "1" },
          schemaDir: s.schemaDir,
          warn: () => {},
        }),
      ).toThrow(/\.old\/config が残っている/);
    });

    test.each(["", "0", "true", "yes"])("1 以外の値 %j は止める", async (v) => {
      const m = await load();
      const s = setup();
      expect(() =>
        m.loadConfig({
          name: "t",
          root: s.root,
          env: { ...s.env, SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: v },
          schemaDir: s.schemaDir,
          warn: () => {},
        }),
      ).toThrow(/SHOJI9X9_SKILLS_IGNORE_USER_CONFIG は 1 だけを受け付ける/);
    });

    test("1 のときは人ごとの層に書かず、他の層には書く", async () => {
      const m = await load();
      const s = setup();
      const env = { ...s.env, SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: "1" };
      expect(() =>
        m.writeConfig({
          name: "t",
          root: s.root,
          env,
          schemaDir: s.schemaDir,
          layer: "user",
          keyPath: ["count"],
          value: 2,
          mode: "set",
        }),
      ).toThrow(/人ごとの層に書かない/);
      expect(existsSync(s.paths.user)).toBe(false);
      m.writeConfig({
        name: "t",
        root: s.root,
        env,
        schemaDir: s.schemaDir,
        layer: "repo",
        keyPath: ["count"],
        value: 2,
        mode: "set",
      });
      expect(JSON.parse(readFileSync(s.paths.repo, "utf8"))).toEqual({ count: 2 });
    });

    test("CLI は注意を stderr に出す", async () => {
      const s = setup();
      const r = await cli(
        ["get", "t", "tool", "--root", s.root, "--schema-dir", s.schemaDir],
        { ...s.env, SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: "1" },
        s.root,
      );
      expect(r).toMatchObject({ code: 0, out: 'value="a"\nsource=default\n' });
      expect(r.err).toMatch(/^note: 人ごとの層/);
    });
  });

  describe("検証", () => {
    const cases: [string, string, RegExp][] = [
      ["知らないキー", '{ "tool": "a", "toool": "b" }', /知らないキー "toool"/],
      ["継承した名前のキー", '{ "constructor": 1 }', /知らないキー "constructor"/],
      [
        "items の中の継承した名前",
        '{ "list": [{ "id": "a", "toString": 1 }] }',
        /list\[0\]: 知らないキー "toString"/,
      ],
      ["enum の外", '{ "tool": "c" }', /"c" は "a"・"b" のどれでもない/],
      ["型の誤り", '{ "count": "3" }', /count: 型が "integer" でない（string）/],
      ["整数でない数", '{ "count": 1.5 }', /型が "integer" でない（number）/],
      ["minimum", '{ "count": 0 }', /1 より小さい/],
      ["maximum", '{ "count": 10 }', /9 より大きい/],
      ["minLength", '{ "name": "a" }', /2 文字より短い/],
      ["pattern", '{ "name": "AB" }', /が \/\^\[a-z\]\+\$\/ に合わない/],
      ["const", '{ "mode": "y" }', /"x" でない/],
      ["minItems", '{ "list": [] }', /要素が 1 個より少ない/],
      ["items の required", '{ "list": [{ "v": 1 }] }', /list\[0\]: id が無い/],
      [
        "items の知らないキー",
        '{ "list": [{ "id": "a", "w": 1 }] }',
        /list\[0\]: 知らないキー "w"/,
      ],
      ["additionalProperties のスキーマ", '{ "map": { "k": "v" } }', /map\.k: 型が "integer"/],
      ["anyOf のどれにも合わない", '{ "either": "sometimes" }', /どの候補にも合わない/],
      ["oneOf に 2 つ合う", '{ "one": 3 }', /ちょうど 1 つの候補に合わない/],
      ["入れ子の型", '{ "nested": { "inner": { "x": "1" } } }', /nested\.inner\.x: 型が "integer"/],
      ["構文の誤り", '{ "tool": "a" "count": 1 }', /:1:15: JSONC として読めない/],
      ["キーの重複", '{\n  "tool": "a",\n  "tool": "b"\n}', /:3:3: キー "tool" が重複している/],
      ["入れ子のキーの重複", '{ "map": { "k": 1, "k": 2 } }', /キー "k" が重複している/],
      ["最上位が配列", "[]", /最上位がオブジェクトでない/],
      ["空のファイル", "", /空のファイル/],
    ];
    test.each(cases)("%s はエラーにする", async (_name, text, want) => {
      const m = await load();
      const s = setup();
      s.write("repo", text);
      expect(() =>
        m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir }),
      ).toThrow(want);
    });

    test("コメント・末尾のカンマ・$schema・合う値は通す", async () => {
      const m = await load();
      const s = setup();
      s.write(
        "repo",
        '{\n  "$schema": "x",\n  // c\n  /* d */ "list": [{ "id": "a", "v": 1.5 },],\n  "either": "never",\n  "one": 1.5,\n  "open": { "any": [1] },\n  "map": { "k": 1 },\n}\n',
      );
      const r = m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir });
      expect(r.list?.value).toEqual([{ id: "a", v: 1.5 }]);
      expect(r.either?.value).toBe("never");
      expect("$schema" in r).toBe(false);
    });

    test("置けない層に書いたキーはエラーにする（個人の設定がリポジトリの方針を上書きしない）", async () => {
      const m = await load();
      const s = setup();
      s.write("user", '{ "method": "x" }');
      expect(() =>
        m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir }),
      ).toThrow(/method は 人ごと の層に置けない（置ける層: リポジトリ）/);
      const t = setup();
      t.write("local", '{ "count": 2 }');
      expect(() =>
        m.loadConfig({ name: "t", root: t.root, env: t.env, schemaDir: t.schemaDir }),
      ).toThrow(/count は 人ごと・リポジトリ限定/);
    });
  });

  describe("スキーマ", () => {
    const bad: [string, unknown, RegExp][] = [
      ["properties が無い", { type: "object" }, /properties を持つオブジェクトでない/],
      [
        "プロパティがオブジェクトでない",
        { properties: { a: 1 } },
        /properties\.a がオブジェクトでない/,
      ],
      ["x-layers が無い", { properties: { a: {} } }, /x-layers/],
      ["x-layers が空", { properties: { a: { "x-layers": [] } } }, /x-layers/],
      ["x-layers に知らない層", { properties: { a: { "x-layers": ["team"] } } }, /x-layers/],
      [
        "x-env が文字列でない",
        { properties: { a: { "x-layers": ["repo"], "x-env": 1 } } },
        /x-env/,
      ],
      [
        "x-legacy.files の形",
        { properties: {}, "x-legacy": { files: [{ path: "a" }] } },
        /x-legacy\.files/,
      ],
      ["x-legacy.env の形", { properties: {}, "x-legacy": { env: ["A"] } }, /x-legacy\.env/],
      [
        "正規表現として読めない pattern",
        { properties: { a: { "x-layers": ["repo"], type: "string", pattern: "(" } } },
        /properties\.a\.pattern が正規表現として読めない/,
      ],
      [
        "入れ子の正規表現として読めない pattern",
        { properties: { a: { "x-layers": ["repo"], anyOf: [{ items: { pattern: "[" } }] } } },
        /properties\.a\.anyOf\[0\]\.items\.pattern が正規表現として読めない/,
      ],
    ];
    test.each(bad)("%s はスキーマの誤りにする", async (_name, schema, want) => {
      const m = await load();
      const s = setup(schema);
      expect(() => m.loadSchema(s.schemaDir, "t")).toThrow(want);
    });

    test("JSON として読めないスキーマは、SyntaxError ではなくスキーマの誤りにする", async () => {
      const m = await load();
      const s = setup();
      writeFileSync(join(s.schemaDir, "t.schema.json"), "{ properties");
      expect(() => m.loadSchema(s.schemaDir, "t")).toThrow(m.ConfigError);
      expect(() => m.loadSchema(s.schemaDir, "t")).toThrow(/t\.schema\.json: JSON として読めない/);
    });

    test("スキーマが無い名前はエラーにする", async () => {
      const m = await load();
      const s = setup();
      expect(() => m.loadSchema(s.schemaDir, "none")).toThrow(
        /none\.schema\.json: 設定 "none" のスキーマが無い/,
      );
    });

    test("同梱のスキーマはすべて読める", async () => {
      const m = await load();
      const dir = join(repoRoot, dirname(dirname(dirname(copy))), "config-schemas");
      const names = readdirSync(dir).map((f) => f.replace(/\.schema\.json$/, ""));
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(m.loadSchema(dir, name).name).toBe(name);
    });
  });

  describe("旧い場所", () => {
    test("この配布元の skills.yml は、移行の手順を示して止める", async () => {
      const m = await load();
      const s = setup();
      mkdirSync(join(s.root, ".config/skills/shoji9x9"), { recursive: true });
      writeFileSync(join(s.root, ".config/skills/shoji9x9/skills.yml"), "version: 1\n");
      expect(() =>
        m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir }),
      ).toThrow(
        /旧い場所の設定が残っているので止める[\s\S]*shoji9x9\/skills\.yml が残っている。skills\.<スキル名> の節を \.config\/skills\/shoji9x9\/<スキル名>\.jsonc/,
      );
    });

    test("他の配布元の skills.yml では止めない", async () => {
      const m = await load();
      const s = setup();
      mkdirSync(join(s.root, ".config/skills/other"), { recursive: true });
      writeFileSync(join(s.root, ".config/skills/other/skills.yml"), "version: 1\n");
      expect(() =>
        m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir }),
      ).not.toThrow();
    });

    test("x-legacy のファイル（リポジトリと人ごと）と環境変数は、それぞれの手順を示して止める", async () => {
      const m = await load();
      const s = setup();
      mkdirSync(join(s.root, ".old"));
      writeFileSync(join(s.root, ".old/config"), "a=1\n");
      mkdirSync(join(s.env.XDG_CONFIG_HOME ?? "", "old"), { recursive: true });
      writeFileSync(join(s.env.XDG_CONFIG_HOME ?? "", "old/config.json"), "{}");
      let message = "";
      try {
        m.loadConfig({
          name: "t",
          root: s.root,
          env: { ...s.env, T_OLD: "" },
          schemaDir: s.schemaDir,
        });
      } catch (e) {
        message = e instanceof Error ? e.message : "";
      }
      expect(message).toContain(".old/config が残っている。old を移す");
      expect(message).toContain("old/config.json が残っている。人の old を移す");
      expect(message).toContain("環境変数 T_OLD は使わなくなった。T_OLD を移す");
    });

    test("旧い場所が無ければ止めない", async () => {
      const m = await load();
      const s = setup();
      expect(() =>
        m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir }),
      ).not.toThrow();
    });

    test.each(["$&", "$'", "$`", "$$", "{user_config_home}"])(
      "ルートのパスが置換のパターン（%s）を含んでも、そのパスの旧いファイルを見つける",
      async (pattern) => {
        const m = await load();
        const s = setup();
        const root = join(s.base, `r${pattern}x`);
        mkdirSync(join(root, ".old"), { recursive: true });
        writeFileSync(join(root, ".old/config"), "a=1\n");
        expect(() => m.loadConfig({ name: "t", root, env: s.env, schemaDir: s.schemaDir })).toThrow(
          `${root}/.old/config が残っている`,
        );
      },
    );

    test("書き込みも旧い場所が残っていれば止める", async () => {
      const m = await load();
      const s = setup();
      expect(() =>
        m.writeConfig({
          name: "t",
          root: s.root,
          env: { ...s.env, T_OLD: "1" },
          schemaDir: s.schemaDir,
          layer: "repo",
          keyPath: ["method"],
          value: "m",
          mode: "set",
        }),
      ).toThrow(/T_OLD/);
    });
  });

  describe("書き込み", () => {
    const w = (s: ReturnType<typeof setup>, o: Partial<Parameters<typeof Reader.writeConfig>[0]>) =>
      load().then((m) =>
        m.writeConfig({
          name: "t",
          root: s.root,
          env: s.env,
          schemaDir: s.schemaDir,
          layer: "repo",
          keyPath: ["method"],
          value: "m",
          mode: "set",
          ...o,
        }),
      );

    test("先頭に BOM がある設定ファイルを読み、書くときも BOM を残す", async () => {
      const m = await load();
      const s = setup();
      s.write("repo", '\uFEFF{ "method": "m" }\n');
      expect(
        m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir }),
      ).toMatchObject({
        method: { value: "m", source: "repo" },
      });
      await w(s, { keyPath: ["flag"], value: true });
      const text = readFileSync(s.paths.repo, "utf8");
      expect(text.startsWith("\uFEFF{")).toBe(true);
      expect(text.indexOf("\uFEFF", 1)).toBe(-1);
      expect(JSON.parse(text.slice(1))).toEqual({ method: "m", flag: true });
    });

    test.each(["", "\n  \n", "\uFEFF"])(
      "既にあるファイルに中身が無ければ（%j）、ファイルが無いときと同じく {} から書く",
      async (before) => {
        const s = setup();
        s.write("repo", before);
        expect(await w(s, {})).toMatchObject({ changed: true });
        expect(JSON.parse(readFileSync(s.paths.repo, "utf8").replace(/^\uFEFF/, ""))).toEqual({
          method: "m",
        });
      },
    );

    test("コメントだけのファイルには、コメントを消さないように書かずに止める", async () => {
      const s = setup();
      s.write("repo", "// メモ\n");
      await expect(w(s, {})).rejects.toThrow(/空のファイル/);
      expect(readFileSync(s.paths.repo, "utf8")).toBe("// メモ\n");
    });

    test("ファイルとディレクトリが無ければ作り、キーを足す", async () => {
      const s = setup();
      const r = await w(s, {});
      expect(r).toEqual({ path: s.paths.repo, changed: true, reason: "書いた" });
      expect(JSON.parse(readFileSync(s.paths.repo, "utf8"))).toEqual({ method: "m" });
    });

    test("書いたキーの外に知らないキーや置けない層のキーがあれば、書かずに止める", async () => {
      const s = setup();
      s.write("repo", '{ "typo": 1 }\n');
      await expect(w(s, {})).rejects.toThrow(/知らないキー "typo"/);
      expect(readFileSync(s.paths.repo, "utf8")).toBe('{ "typo": 1 }\n');
      s.write("user", '{ "method": "m" }\n');
      await expect(
        w(s, { layer: "user", keyPath: ["count"], value: 2, mode: "set" }),
      ).rejects.toThrow(/method は 人ごと の層に置けない/);
      expect(readFileSync(s.paths.user, "utf8")).toBe('{ "method": "m" }\n');
      // 同じ値が既にあって書かずに返す場合も、ファイルの誤りで止める
      s.write("repo", '{ "method": "m", "typo": 1 }\n');
      await expect(w(s, {})).rejects.toThrow(/知らないキー "typo"/);
      // set で同じ値が既にあるときは、その値の誤りでも止める（書いたつもりで誤った設定を残さない）
      s.write("repo", '{ "count": "x" }\n');
      await expect(w(s, { keyPath: ["count"], value: "x" })).rejects.toThrow(/count/);
      s.write("repo", '{ "list": [{ "id": "a" }], "typo": 1 }\n');
      await expect(
        w(s, { keyPath: ["list"], value: { id: "a" }, mode: "append", uniqueBy: "id" }),
      ).rejects.toThrow(/知らないキー "typo"/);
    });

    test("書き込み先かその途中のディレクトリがリポジトリの外を指すシンボリックリンクなら、外を書かずに止める", async () => {
      const s = setup();
      const outside = join(s.base, "outside");
      mkdirSync(outside);
      writeFileSync(join(outside, "t.jsonc"), "{}\n");
      mkdirSync(join(s.root, ".config/skills/shoji9x9"), { recursive: true });
      symlinkSync(join(outside, "t.jsonc"), s.paths.repo);
      await expect(w(s, {})).rejects.toThrow(/シンボリックリンクには書かない/);
      expect(readFileSync(join(outside, "t.jsonc"), "utf8")).toBe("{}\n");
      const t = setup();
      mkdirSync(join(t.root, ".config/skills"), { recursive: true });
      symlinkSync(outside, join(t.root, ".config/skills/shoji9x9"));
      await expect(w(t, {})).rejects.toThrow(/リポジトリの外を指している/);
      expect(readFileSync(join(outside, "t.jsonc"), "utf8")).toBe("{}\n");
    });

    test("人ごとの層の置き場所が絶対パスに決まらなければ、人ごとの層を読まず、書かずに止める", async () => {
      const m = await load();
      const s = setup();
      const env = { HOME: "rel" };
      let note = "";
      expect(() =>
        m.loadConfig({
          name: "t",
          root: s.root,
          env,
          schemaDir: s.schemaDir,
          warn: (x) => (note += x),
        }),
      ).not.toThrow();
      expect(note).toContain("置き場所を絶対パスに決められない");
      await expect(
        w({ ...s, env }, { layer: "user", keyPath: ["count"], value: 2 }),
      ).rejects.toThrow(
        /人ごとの層に書かない（HOME と XDG_CONFIG_HOME から、置き場所を絶対パスに決められない）/,
      );
    });

    test("指す先がまだ無いシンボリックリンクにも、リンクをたどって書かない", async () => {
      const s = setup();
      const target = join(s.base, "outside-missing", "t.jsonc");
      mkdirSync(dirname(s.paths.repo), { recursive: true });
      symlinkSync(target, s.paths.repo);
      await expect(w(s, {})).rejects.toThrow(/シンボリックリンクには書かない/);
      expect(existsSync(target)).toBe(false);
    });

    test("途中のディレクトリが指す先の無いシンボリックリンクなら、その上のディレクトリで確かめずに止める", async () => {
      const s = setup();
      const target = join(s.base, "outside-missing-dir");
      mkdirSync(dirname(dirname(s.paths.repo)), { recursive: true });
      symlinkSync(target, dirname(s.paths.repo));
      await expect(w(s, {})).rejects.toThrow(
        /指す先の無いシンボリックリンクになっている。書かない/,
      );
      expect(existsSync(target)).toBe(false);
    });

    test("層のパスがディレクトリなら、スタックトレースで終わらずに読めないとして止める", async () => {
      const m = await load();
      const s = setup();
      mkdirSync(s.paths.repo, { recursive: true });
      expect(() =>
        m.loadConfig({ name: "t", root: s.root, env: s.env, schemaDir: s.schemaDir }),
      ).toThrow(m.ConfigError);
      await expect(w(s, {})).rejects.toThrow(/t\.jsonc: 読めない/);
    });

    test("コメントと末尾のカンマと既にあるキーを残したまま、無いキーを足す", async () => {
      const s = setup();
      s.write("repo", '{\n  // 方針\n  "tool": "a", // 行末\n}\n');
      await w(s, {});
      const text = readFileSync(s.paths.repo, "utf8");
      expect(text).toBe('{\n  // 方針\n  "tool": "a", // 行末\n  "method": "m",\n}\n');
    });

    // 足す位置と、行末のコメント・カンマ・字下げ・1 行の書き方の組み合わせ
    const placement: [string, string, (string | number)[], unknown, "set" | "append", string][] = [
      [
        "カンマの無い最後の要素の行末コメント",
        '{\n  "tool": "a" // 行末\n}\n',
        ["method"],
        "m",
        "set",
        '{\n  "tool": "a", // 行末\n  "method": "m"\n}\n',
      ],
      [
        "行末のブロックコメント",
        '{\n  "tool": "a" /* x */\n}\n',
        ["method"],
        "m",
        "set",
        '{\n  "tool": "a", /* x */\n  "method": "m"\n}\n',
      ],
      [
        "ブロックコメントの後の行コメント",
        '{\n  "tool": "a" /* x */ // y\n}\n',
        ["method"],
        "m",
        "set",
        '{\n  "tool": "a", /* x */ // y\n  "method": "m"\n}\n',
      ],
      [
        "次の行に続くブロックコメントは越えない",
        '{\n  "tool": "a" /* x\n  y */\n}\n',
        ["method"],
        "m",
        "set",
        '{\n  "tool": "a",\n  "method": "m" /* x\n  y */\n}\n',
      ],
      [
        "コメントの無い最後の要素",
        '{\n  "tool": "a"\n}\n',
        ["method"],
        "m",
        "set",
        '{\n  "tool": "a",\n  "method": "m"\n}\n',
      ],
      [
        "1 行のオブジェクト",
        '{ "tool": "a" }\n',
        ["method"],
        "m",
        "set",
        '{ "tool": "a", "method": "m" }\n',
      ],
      ["空のオブジェクト", "{}\n", ["method"], "m", "set", '{\n  "method": "m"\n}\n'],
      [
        "コメントだけのオブジェクト",
        "{\n  // まだ無い\n}\n",
        ["method"],
        "m",
        "set",
        '{\n  // まだ無い\n  "method": "m"\n}\n',
      ],
      [
        "入れ子を作り、複数行の値は字下げを合わせる",
        '{\n  "open": {\n    "a": 1 // c\n  }\n}\n',
        ["open", "b", "x"],
        1,
        "set",
        '{\n  "open": {\n    "a": 1, // c\n    "b": {\n      "x": 1\n    }\n  }\n}\n',
      ],
      [
        "配列の末尾に、行末コメントの後ろで足す",
        '{\n  "list": [\n    { "id": "a" }, // 最初\n  ]\n}\n',
        ["list"],
        { id: "b" },
        "append",
        '{\n  "list": [\n    { "id": "a" }, // 最初\n    {\n      "id": "b"\n    },\n  ]\n}\n',
      ],
      [
        "1 行の配列",
        '{ "list": [{ "id": "a" }] }\n',
        ["list"],
        { id: "b" },
        "append",
        '{ "list": [{ "id": "a" }, {"id":"b"}] }\n',
      ],
      [
        "1 行の空の配列は、その行の字下げを基に複数行にする",
        '{ "list": [] }\n',
        ["list"],
        { id: "b" },
        "append",
        '{ "list": [\n  {\n    "id": "b"\n  }\n] }\n',
      ],
    ];
    test.for(placement)("%s", async ([, before, keyPath, value, mode, after]) => {
      const s = setup();
      s.write("repo", before);
      await w(s, { keyPath, value, mode });
      expect(readFileSync(s.paths.repo, "utf8")).toBe(after);
    });

    test("--replace は値の範囲だけを置き換え、周りのコメントを残す", async () => {
      const s = setup();
      s.write("repo", '{\n  // 前\n  "nested": { "inner": {} }, // 後\n}\n');
      await w(s, { keyPath: ["nested"], value: { inner: { x: 2 } }, replace: true });
      expect(readFileSync(s.paths.repo, "utf8")).toBe(
        '{\n  // 前\n  "nested": {\n    "inner": {\n      "x": 2\n    }\n  }, // 後\n}\n',
      );
    });

    test("無い配列の要素と、オブジェクトでない値の中には書かない", async () => {
      const s = setup();
      s.write("repo", '{ "list": [{ "id": "a" }], "method": "m" }');
      await expect(w(s, { keyPath: ["list", 3, "id"], value: "x" })).rejects.toThrow(
        /配列の要素は append で足す/,
      );
      await expect(w(s, { keyPath: ["method", "x"], value: "x" })).rejects.toThrow(
        /足す先がオブジェクトでない/,
      );
      await expect(w(s, { keyPath: ["list", 0, "v"], value: 2 })).resolves.toMatchObject({
        changed: true,
      });
    });

    test("同じ値が既にあれば何もせず、違う値なら変えずに止める。--replace なら置き換える", async () => {
      const s = setup();
      s.write("repo", '{ "method": "m" }');
      expect(await w(s, {})).toMatchObject({ changed: false, reason: "同じ値が既にある" });
      await expect(w(s, { value: "n" })).rejects.toThrow(
        /既に "m" になっている。既にあるキーは変えない/,
      );
      expect(readFileSync(s.paths.repo, "utf8")).toBe('{ "method": "m" }');
      await w(s, { value: "n", replace: true });
      expect(JSON.parse(readFileSync(s.paths.repo, "utf8"))).toEqual({ method: "n" });
    });

    test("入れ子のパスに書く", async () => {
      const s = setup();
      s.write("repo", '{ "nested": { "inner": {} } }');
      await w(s, { keyPath: ["nested", "inner", "x"], value: 1 });
      expect(JSON.parse(readFileSync(s.paths.repo, "utf8"))).toEqual({
        nested: { inner: { x: 1 } },
      });
    });

    test("append は、配列が無ければ作り、あれば末尾に足す", async () => {
      const s = setup();
      await w(s, { keyPath: ["list"], value: { id: "a" }, mode: "append" });
      await w(s, { keyPath: ["list"], value: { id: "b" }, mode: "append" });
      expect(JSON.parse(readFileSync(s.paths.repo, "utf8"))).toEqual({
        list: [{ id: "a" }, { id: "b" }],
      });
    });

    test("append の --unique-by は、その欄が同じ要素があれば足さない。欄が無い要素はエラー", async () => {
      const s = setup();
      s.write("repo", '{ "list": [{ "id": "a" }] }');
      expect(
        await w(s, { keyPath: ["list"], value: { id: "a", v: 2 }, mode: "append", uniqueBy: "id" }),
      ).toMatchObject({ changed: false });
      expect(
        await w(s, { keyPath: ["list"], value: { id: "b" }, mode: "append", uniqueBy: "id" }),
      ).toMatchObject({ changed: true });
      await expect(
        w(s, { keyPath: ["list"], value: { v: 1 }, mode: "append", uniqueBy: "id" }),
      ).rejects.toThrow(/足す要素に id が無い/);
    });

    test("append の --unique-by は、文字列だけの要素を、その欄だけを書いた要素と同じに扱う", async () => {
      const s = setup();
      s.write("repo", '{ "list": ["a"] }');
      expect(
        await w(s, { keyPath: ["list"], value: { id: "a" }, mode: "append", uniqueBy: "id" }),
      ).toMatchObject({ changed: false });
    });

    test("append の --unique-by は、足す値が文字列でも、その欄だけを書いた要素と同じに扱う", async () => {
      const s = setup();
      s.write("repo", '{ "list": [{ "id": "a" }] }');
      expect(
        await w(s, { keyPath: ["list"], value: "a", mode: "append", uniqueBy: "id" }),
      ).toMatchObject({ changed: false, reason: "id が同じ要素が既にある" });
    });

    test("append の先が配列でなければエラー", async () => {
      const s = setup();
      s.write("repo", '{ "map": { "k": 1 } }');
      await expect(w(s, { keyPath: ["map"], value: 1, mode: "append" })).rejects.toThrow(
        /map が配列でない/,
      );
    });

    test("書いた後のファイルがスキーマに合わなければ書かない", async () => {
      const s = setup();
      s.write("repo", '{ "tool": "a" }');
      await expect(w(s, { keyPath: ["tool"], value: "c", replace: true })).rejects.toThrow(
        /書き込んだ後/,
      );
      await expect(w(s, { keyPath: ["list"], value: { v: 1 }, mode: "append" })).rejects.toThrow(
        /id が無い/,
      );
      expect(readFileSync(s.paths.repo, "utf8")).toBe('{ "tool": "a" }');
    });

    test("知らないキーと置けない層には書かない", async () => {
      const s = setup();
      await expect(w(s, { keyPath: ["typo"] })).rejects.toThrow(/t に "typo" というキーは無い/);
      await expect(w(s, { keyPath: [0, "a"] })).rejects.toThrow(
        /キーのパスの最初は最上位のキーの名前にする/,
      );
      await expect(w(s, { layer: "user" })).rejects.toThrow(/method は 人ごと の層に置けない/);
      expect(existsSync(s.paths.user)).toBe(false);
    });

    test("local の層は、gitignore されていなければ書かず、されていれば書く", async () => {
      const s = setup();
      await expect(w(s, { layer: "local", keyPath: ["tool"], value: "b" })).rejects.toThrow(
        /gitignore されていない。\.gitignore に \/\.config\/skills\/shoji9x9\/\*\.local\.jsonc を足して/,
      );
      expect(existsSync(s.paths.local)).toBe(false);
      s.ignoreLocal();
      await w(s, { layer: "local", keyPath: ["tool"], value: "b" });
      expect(JSON.parse(readFileSync(s.paths.local, "utf8"))).toEqual({ tool: "b" });
    });

    test("git のリポジトリの外では、local の層に書かず、.gitignore に足す案内もしない", async () => {
      const s = setup();
      rmSync(join(s.root, ".git"), { recursive: true, force: true });
      s.ignoreLocal();
      const e = await w(s, { layer: "local", keyPath: ["tool"], value: "b" }).catch(
        (x: unknown) => x,
      );
      expect(String(e)).toMatch(
        /gitignore されているかを確かめられない（git check-ignore の終了コード 128/,
      );
      expect(String(e)).not.toMatch(/を足してから書く/);
      expect(existsSync(s.paths.local)).toBe(false);
    });

    test("user の層には人ごとの置き場所に書く", async () => {
      const s = setup();
      await w(s, { layer: "user", keyPath: ["count"], value: 2 });
      expect(JSON.parse(readFileSync(s.paths.user, "utf8"))).toEqual({ count: 2 });
    });
  });

  describe("キーのパス", () => {
    test("a.b.0 と JSON の配列を読み、空の部分と形の誤りはエラーにする", async () => {
      const m = await load();
      expect(m.parseKeyPath("a.b.0.c")).toEqual(["a", "b", 0, "c"]);
      expect(m.parseKeyPath('["pricing","gpt-5.1"]')).toEqual(["pricing", "gpt-5.1"]);
      expect(() => m.parseKeyPath("a..b")).toThrow(/空の部分/);
      expect(() => m.parseKeyPath("[]")).toThrow(/空でない JSON の配列でない/);
      expect(() => m.parseKeyPath("[1.5]")).toThrow(/空でない JSON の配列でない/);
      expect(() => m.parseKeyPath("[")).toThrow(/空でない JSON の配列でない/);
    });
  });

  describe("CLI", () => {
    test("get は value・source・path を出力し、値が無ければ source=unset で exit 3", async () => {
      const s = setup();
      s.write("repo", '{ "method": "m" }');
      const args = ["--root", s.root, "--schema-dir", s.schemaDir];
      expect(await cli(["get", "t", "method", ...args], s.env, s.root)).toEqual({
        code: 0,
        out: `value="m"\nsource=repo\npath=${s.paths.repo}\n`,
        err: "",
      });
      expect(await cli(["get", "t", "tool", ...args], s.env, s.root)).toMatchObject({
        code: 0,
        out: 'value="a"\nsource=default\n',
      });
      expect(await cli(["get", "t", "flag", ...args], s.env, s.root)).toMatchObject({
        code: 3,
        out: "source=unset\n",
      });
    });

    test("get --raw は文字列をそのまま、それ以外を JSON で出力し、値が無ければ何も出さずに exit 3", async () => {
      const s = setup();
      s.write("repo", '{ "method": "m", "list": [{ "id": "a" }] }');
      const args = ["--root", s.root, "--schema-dir", s.schemaDir, "--raw"];
      expect(await cli(["get", "t", "method", ...args], s.env, s.root)).toMatchObject({
        code: 0,
        out: "m\n",
      });
      expect(await cli(["get", "t", "list", ...args], s.env, s.root)).toMatchObject({
        code: 0,
        out: '[{"id":"a"}]\n',
      });
      expect(await cli(["get", "t", "flag", ...args], s.env, s.root)).toMatchObject({
        code: 3,
        out: "",
      });
    });

    test("get のキーのパスは、最上位のキーの値の中をたどり、たどれなければ exit 3", async () => {
      const s = setup();
      s.write(
        "repo",
        '{ "nested": { "inner": { "x": 1 } }, "list": [{ "id": "a" }], "map": { "k.1": 3 } }',
      );
      const args = ["--root", s.root, "--schema-dir", s.schemaDir];
      expect(await cli(["get", "t", "nested.inner.x", ...args], s.env, s.root)).toEqual({
        code: 0,
        out: `value=1\nsource=repo\npath=${s.paths.repo}\n`,
        err: "",
      });
      expect(await cli(["get", "t", "list.0.id", ...args, "--raw"], s.env, s.root)).toMatchObject({
        code: 0,
        out: "a\n",
      });
      expect(await cli(["get", "t", '["map","k.1"]', ...args], s.env, s.root)).toMatchObject({
        code: 0,
        out: `value=3\nsource=repo\npath=${s.paths.repo}\n`,
      });
      for (const missing of ["nested.inner.y", "list.1", "list.id", "nested.0", "flag.a"])
        expect(await cli(["get", "t", missing, ...args], s.env, s.root)).toMatchObject({
          code: 3,
          out: "source=unset\n",
        });
      expect(await cli(["get", "t", "typo.a", ...args], s.env, s.root)).toMatchObject({ code: 1 });
      // Object の継承した名前は、スキーマのキーとして扱わない。
      for (const inherited of ["constructor", "__proto__", "toString.a"])
        expect(await cli(["get", "t", inherited, ...args], s.env, s.root)).toMatchObject({
          code: 1,
        });
      expect(await cli(["get", "t", "map.constructor", ...args], s.env, s.root)).toMatchObject({
        code: 3,
      });
      expect(await cli(["get", "t", "0.a", ...args], s.env, s.root)).toMatchObject({ code: 2 });
      expect(
        await cli(["get", "t", "nested.inner", "--cli-value", "{}", ...args], s.env, s.root),
      ).toMatchObject({ code: 2 });
    });

    test("get --cli-value は CLI の層として扱い、検証する", async () => {
      const s = setup();
      const args = ["--root", s.root, "--schema-dir", s.schemaDir];
      expect(
        await cli(["get", "t", "tool", "--cli-value", '"b"', ...args], s.env, s.root),
      ).toMatchObject({ code: 0, out: 'value="b"\nsource=cli\n' });
      expect(
        await cli(["get", "t", "tool", "--cli-value", '"z"', ...args], s.env, s.root),
      ).toMatchObject({ code: 1 });
      expect(
        await cli(["get", "t", "tool", "--cli-value", "b", ...args], s.env, s.root),
      ).toMatchObject({ code: 2 });
    });

    test("get の知らないキーと設定の誤りは exit 1", async () => {
      const s = setup();
      const args = ["--root", s.root, "--schema-dir", s.schemaDir];
      expect(await cli(["get", "t", "typo", ...args], s.env, s.root)).toMatchObject({
        code: 1,
        err: 'error: t に "typo" というキーは無い\n',
      });
      s.write("repo", '{ "x": 1 }');
      expect((await cli(["get", "t", "tool", ...args], s.env, s.root)).code).toBe(1);
    });

    test("dump・validate・paths", async () => {
      const s = setup();
      s.write("repo", '{ "method": "m" }');
      const args = ["--root", s.root, "--schema-dir", s.schemaDir];
      const d = await cli(["dump", "t", ...args], s.env, s.root);
      expect(d.code).toBe(0);
      expect(JSON.parse(d.out)).toMatchObject({
        method: { value: "m", source: "repo", path: s.paths.repo },
      });
      expect(await cli(["validate", "t", ...args], s.env, s.root)).toMatchObject({
        code: 0,
        out: `ok: t の設定はスキーマに合う（repo=${s.paths.repo}）\n`,
      });
      const empty = setup();
      expect(
        await cli(
          ["validate", "t", "--root", empty.root, "--schema-dir", empty.schemaDir],
          empty.env,
          empty.root,
        ),
      ).toMatchObject({
        code: 0,
        out: "ok: t の設定はスキーマに合う（設定ファイルは無い）\n",
      });
      await expectUserLayerIgnored(cli, s, args);
      expect(await cli(["paths", "t", ...args], s.env, s.root)).toMatchObject({
        code: 0,
        out: `local=${s.paths.local}\nuser=${s.paths.user}\nrepo=${s.paths.repo}\n`,
      });
    });

    test("set と append は結果を 1 行で出力する", async () => {
      const s = setup();
      const args = ["--root", s.root, "--schema-dir", s.schemaDir, "--layer", "repo"];
      expect(await cli(["set", "t", "method", '"m"', ...args], s.env, s.root)).toMatchObject({
        code: 0,
        out: `changed: ${s.paths.repo}（書いた）\n`,
      });
      expect(await cli(["set", "t", "method", '"m"', ...args], s.env, s.root)).toMatchObject({
        code: 0,
        out: `unchanged: ${s.paths.repo}（同じ値が既にある）\n`,
      });
      expect(await cli(["set", "t", "method", '"n"', ...args], s.env, s.root)).toMatchObject({
        code: 1,
      });
      expect(
        await cli(["set", "t", "method", '"n"', ...args, "--replace"], s.env, s.root),
      ).toMatchObject({ code: 0 });
      expect(
        await cli(
          ["append", "t", "list", '{"id":"a"}', ...args, "--unique-by", "id"],
          s.env,
          s.root,
        ),
      ).toMatchObject({ code: 0, out: `changed: ${s.paths.repo}（足した）\n` });
      expect(
        await cli(
          ["append", "t", "list", '{"id":"a"}', ...args, "--unique-by", "id"],
          s.env,
          s.root,
        ),
      ).toMatchObject({ code: 0, out: `unchanged: ${s.paths.repo}（id が同じ要素が既にある）\n` });
    });

    test("-- の後は位置引数として扱い、- で始まる値（負の数）を渡せる", async () => {
      const s = setup();
      const args = ["--root", s.root, "--schema-dir", s.schemaDir, "--layer", "repo"];
      expect(await cli(["set", "t", ...args, "--", "either", "-1"], s.env, s.root)).toMatchObject({
        code: 0,
        out: `changed: ${s.paths.repo}（書いた）\n`,
      });
      expect(JSON.parse(readFileSync(s.paths.repo, "utf8"))).toEqual({ either: -1 });
      const r = await cli(["set", "t", "either", "-1", ...args], s.env, s.root);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/^error: 不明な引数: -1\n/);
      expect(r.err).toMatch(/- で始まる値（負の数など）は、-- の後に置く/);
      // -- の後の --layer はオプションとして読まず、位置引数の 1 つとして数える
      const after = await cli(
        [
          "set",
          "t",
          "--root",
          s.root,
          "--schema-dir",
          s.schemaDir,
          "--",
          "either",
          "-1",
          "--layer",
          "repo",
        ],
        s.env,
        s.root,
      );
      expect(after.code).toBe(2);
      expect(after.err).toMatch(/^error: set の引数の数が違う\n/);
    });

    test("--root を省くと cwd のリポジトリのルートを使う", async () => {
      const s = setup();
      s.write("repo", '{ "method": "m" }');
      const sub = join(s.root, "sub");
      mkdirSync(sub);
      expect(
        (await cli(["get", "t", "method", "--schema-dir", s.schemaDir, "--raw"], s.env, sub)).out,
      ).toBe("m\n");
    });

    const usage: [string, string[]][] = [
      ["引数なし", []],
      ["名前が無い", ["get"]],
      ["不正な名前", ["get", "T_x", "k"]],
      ["知らないサブコマンド", ["remove", "t"]],
      ["知らないオプション", ["get", "t", "k", "--force"]],
      ["値の無いオプション", ["get", "t", "k", "--root"]],
      ["値が -- で始まるオプション", ["get", "t", "k", "--cli-value", "--raw"]],
      ["空の値のオプション", ["get", "t", "k", "--root", ""]],
      ["空白だけの値のオプション", ["get", "t", "k", "--root", "  "]],
      ["値が -h のオプション", ["get", "t", "k", "--root", "-h"]],
      ["get の引数の数", ["get", "t"]],
      ["dump の引数の数", ["dump", "t", "x"]],
      ["validate の引数の数", ["validate", "t", "x"]],
      ["paths の引数の数", ["paths", "t", "x"]],
      ["set の引数の数", ["set", "t", "k"]],
      ["set の層が無い", ["set", "t", "k", "1"]],
      ["set の層が不正", ["set", "t", "k", "1", "--layer", "team"]],
      ["set の値が JSON でない", ["set", "t", "k", "x", "--layer", "repo"]],
      ["値を持つオプションを 2 回", ["set", "t", "k", "1", "--layer", "local", "--layer", "repo"]],
      ["値を持たないオプションを 2 回", ["get", "t", "k", "--raw", "--raw"]],
      [
        "set に関係しないオプション",
        ["set", "t", "k", "1", "--layer", "repo", "--unique-by", "id"],
      ],
      ["append に関係しないオプション", ["append", "t", "k", "1", "--layer", "repo", "--replace"]],
      ["get に関係しないオプション", ["get", "t", "k", "--layer", "repo"]],
      ["dump に関係しないオプション", ["dump", "t", "--raw"]],
    ];
    test.each(usage)("%s は exit 2 で usage を出す", async (_name, argv) => {
      const s = setup();
      const r = await cli([...argv, "--schema-dir", s.schemaDir], s.env, s.root);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/^error: [\s\S]*usage:/);
      if (_name.endsWith("2 回")) expect(r.err).toMatch(/^error: --(layer|raw) が重複している\n/);
      if (_name.startsWith("知らないオプション"))
        expect(r.err).toMatch(/^error: 不明な引数: --force\n/);
      if (/^(値の無い|空の値|空白だけの値|値が -)/.test(_name))
        expect(r.err).toMatch(/^error: --(root|cli-value) に値が無い\n/);
      if (_name.endsWith("関係しないオプション")) expect(r.err).toMatch(/に --[a-z-]+ は渡せない/);
    });

    test("--help は usage を出して exit 0", async () => {
      const s = setup();
      expect(await cli(["--help"], s.env, s.root)).toMatchObject({
        code: 0,
        out: expect.stringContaining("usage:"),
      });
    });

    test("CLI として起動すると main の終了コードで終わる（シンボリックリンクから起動しても同じ）", () => {
      const s = setup();
      s.write("repo", '{ "method": "m" }');
      const run = (script: string) =>
        spawnSync(
          process.execPath,
          [script, "get", "t", "method", "--raw", "--schema-dir", s.schemaDir],
          {
            cwd: s.root,
            env: { PATH: process.env.PATH, ...s.env },
            encoding: "utf8",
            timeout: CHILD_TIMEOUT_MS,
          },
        );
      const direct = run(join(repoRoot, copy));
      expect({ status: direct.status, stdout: direct.stdout }).toEqual({
        status: 0,
        stdout: "m\n",
      });
      const unset = spawnSync(
        process.execPath,
        [join(repoRoot, copy), "get", "t", "flag", "--schema-dir", s.schemaDir],
        {
          cwd: s.root,
          env: { PATH: process.env.PATH, ...s.env },
          encoding: "utf8",
          timeout: CHILD_TIMEOUT_MS,
        },
      );
      expect(unset.status).toBe(3);
    });
  });
});
