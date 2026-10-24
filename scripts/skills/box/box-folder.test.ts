// box-folder.sh（操作の対象のフォルダの ID を設定から決める）のテスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸 | 値 |
// | --- | --- |
// | 旧い環境変数 BOX_ROOT_FOLDER_ID | 無い / 値あり / 空 |
// | 設定ファイル | どれも無い / リポジトリ / .local.jsonc（リポジトリより優先） / 人ごと（置けない層） / 旧い skills.yml |
// | Node.js | ある / 無い |
// | 値 | 数字の文字列 / 数字でない |
// | 起動する場所 | リポジトリの中 / git の外 |
// | HOME | 絶対パス / 相対パス / 空 |
// | OS の登録（HOME が空のとき） | ある / 無い（id -un が失敗） / 確かめられない（id が PATH に無い） |
//
// OS の登録が無いときに人ごとの層を読まないことは、box-folder.sh の外から観測できない（/.config や本物のホームに
// ファイルを置けない）。そのため、ホームを決める処理（lib/home.sh の box_resolve_home）を単体で確かめ、
// box-folder.sh がその処理を使うこと（id の偽物が呼ばれること）を別に確かめる。
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { BASH, resolveHome, SCRIPT, setup } from "./box-folder-helpers.ts";

describe("box-folder.sh", () => {
  test("設定ファイルが 1 つも無ければ、Node.js なしで 0 を出す", () => {
    const s = setup({ node: false });
    const r = s.run();
    expect({ status: r.status, stdout: r.stdout, stderr: r.stderr }).toEqual({
      status: 0,
      stdout: "0",
      stderr: "",
    });
  });

  test.each(["", "0", "true"])(
    "SHOJI9X9_SKILLS_IGNORE_USER_CONFIG が 1 以外（%j）なら、設定ファイルが無くても読み取りと同じく止める",
    (value) => {
      const s = setup({ node: false });
      const r = s.run({ SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: value });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("SHOJI9X9_SKILLS_IGNORE_USER_CONFIG は 1 だけを受け付ける");
    },
  );

  test("SHOJI9X9_SKILLS_IGNORE_USER_CONFIG=1 なら、人ごとの層の box.jsonc を数えず、Node.js なしで 0 を出す", () => {
    const s = setup({ node: false });
    s.write("xdg:skills/shoji9x9/box.jsonc", '{ "root_folder_id": "9" }\n');
    expect(s.run().status).toBe(1);
    const r = s.run({ SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: "1" });
    expect({ status: r.status, stdout: r.stdout }).toEqual({ status: 0, stdout: "0" });
  });

  test("HOME が相対パスなら、その下（cwd からの相対パス）の box.jsonc を人ごとの層として数えない", () => {
    const s = setup({ node: false });
    const p = join(s.repo, "rel", ".config", "skills", "shoji9x9", "box.jsonc");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, '{ "root_folder_id": "9" }\n');
    const r = s.run({ HOME: "rel", XDG_CONFIG_HOME: "" });
    expect({ status: r.status, stdout: r.stdout }).toEqual({ status: 0, stdout: "0" });
  });

  test("HOME が空でも相対パスでも、設定ファイルが無ければ Node.js なしで 0 を出す", () => {
    const s = setup({ node: false });
    for (const HOME of ["", "rel"]) {
      const r = s.run({ HOME, XDG_CONFIG_HOME: "" });
      expect({ status: r.status, stdout: r.stdout, stderr: r.stderr }).toEqual({
        status: 0,
        stdout: "0",
        stderr: "",
      });
    }
  });

  test("git の外でも、cwd の下に設定が無ければ 0 を出す", () => {
    const s = setup({ node: false });
    const outside = join(s.dir, "outside");
    mkdirSync(outside);
    expect(s.run({}, outside).stdout).toBe("0");
  });

  test("リポジトリの設定の root_folder_id を出し、.local.jsonc があればそちらを使う", () => {
    const s = setup({ node: true });
    s.write("box.jsonc", '{\n  // 共有フォルダ\n  "root_folder_id": "123",\n}\n');
    expect(s.run()).toMatchObject({ status: 0, stdout: "123" });
    s.write("box.local.jsonc", '{ "root_folder_id": "456" }');
    expect(s.run()).toMatchObject({ status: 0, stdout: "456" });
  });

  test("設定ファイルにキーが無ければ、デフォルトの 0 を出す", () => {
    const s = setup({ node: true });
    s.write("box.jsonc", "{}");
    expect(s.run()).toMatchObject({ status: 0, stdout: "0" });
  });

  test("他の配布元の skills.yml では止めず、Node.js なしでデフォルトの 0 を出す", () => {
    const s = setup({ node: false });
    s.write("../other/skills.yml", "skills: {}\n");
    expect(s.run()).toMatchObject({ status: 0, stdout: "0" });
  });

  test.each([
    ["リポジトリの設定", "box.jsonc"],
    ["旧い skills.yml", "skills.yml"],
    ["人ごとの層（置けない層）", "xdg:skills/shoji9x9/box.jsonc"],
  ])("%s があって Node.js が無ければ、0 で続けずに止める", (_name, rel) => {
    const s = setup({ node: false });
    s.write(rel, '{ "root_folder_id": "123" }');
    const r = s.run();
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/があるが、読むための Node\.js が無い/);
  });

  test.each([
    {
      name: "数字でない ID",
      rel: "box.jsonc",
      text: '{ "root_folder_id": "abc" }',
      message: /root_folder_id: "abc" が/,
    },
    {
      name: "数値で書いた ID",
      rel: "box.jsonc",
      text: '{ "root_folder_id": 123 }',
      message: /型が "string" でない/,
    },
    {
      name: "人ごとの層の ID",
      rel: "xdg:skills/shoji9x9/box.jsonc",
      text: '{ "root_folder_id": "123" }',
      message: /人ごと の層に置けない/,
    },
    {
      name: "旧い skills.yml",
      rel: "skills.yml",
      text: "skills: {}\n",
      message: /skills\.yml が残っている/,
    },
  ])("$name は、設定の誤りとして止める", ({ rel, text, message }) => {
    const s = setup({ node: true });
    s.write(rel, text);
    const r = s.run();
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(message);
  });

  test.each([["123"], [""]])(
    "環境変数 BOX_ROOT_FOLDER_ID（%j）が残っていれば、移行の手順を示して止める",
    (value) => {
      const s = setup({ node: false });
      const r = s.run({ BOX_ROOT_FOLDER_ID: value });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/BOX_ROOT_FOLDER_ID は使わなくなった。.*box\.jsonc.*root_folder_id/);
    },
  );

  // OS にユーザーの登録が無い状態は、id -un を失敗させる偽物で作る（box-token.test.ts と同じ）。
  // このとき bash の ~ は本物のホームを返すので、~ の展開だけで決めると、人ごとの層を本物のホームの下から読む。
  // /.config やテストの外のホームにファイルを置けないので、id が呼ばれて失敗したら人ごとの層を読まないことを、
  // id の偽物が呼ばれた記録と出力で確かめる（共通の lib/home.sh の判定は、下の box_resolve_home のテストで確かめる）。
  test("HOME が空で、OS に登録が無いなら、id で登録を確かめて 0 を出す", () => {
    const s = setup({ node: false });
    const log = join(s.dir, "id-called");
    const bin = join(s.dir, "bin");
    writeFileSync(join(bin, "id"), `#!${BASH}\necho called >>${JSON.stringify(log)}\nexit 1\n`);
    chmodSync(join(bin, "id"), 0o755);
    const r = s.run({ HOME: "", XDG_CONFIG_HOME: "" });
    expect({ status: r.status, stdout: r.stdout, stderr: r.stderr }).toEqual({
      status: 0,
      stdout: "0",
      stderr: "",
    });
    expect(existsSync(log)).toBe(true);
  });

  // id が PATH に無いと登録を確かめられないので、box-folder.sh は ~ の展開に戻し、人ごとの層を本物のホームの下に置く。
  // 本物のホームにファイルを置けないので、決めた置き場所（xdg）を bash -x の出力で確かめる（setup の PATH に id は無い）。
  // 親の環境の BASH_ENV と PS4 が bash -x の出力を変えないよう、環境は PATH・HOME・XDG_CONFIG_HOME だけで組み立てる。
  test("HOME が空で id が PATH に無ければ、~ の展開で決めたホームの下を人ごとの層にする", () => {
    const s = setup({ node: false });
    const r = spawnSync(BASH, ["-x", SCRIPT], {
      cwd: s.repo,
      env: { PATH: join(s.dir, "bin"), HOME: "", XDG_CONFIG_HOME: "" },
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("0");
    expect(r.stderr.split("\n")).toContain(`+ xdg=${userInfo().homedir}/.config`);
  });
});

describe("lib/home.sh の box_resolve_home", () => {
  test("HOME があれば、その値をホームにする", () => {
    expect(resolveHome({ HOME: "/h" }, null).home).toBe("/h");
  });

  test("HOME が空で OS に登録があれば、OS に登録されたホームにする", () => {
    const r = resolveHome({ HOME: "" }, `#!${BASH}\necho user\n`);
    expect(r.status).toBe(0);
    // bash が登録の無いときに返す / ではなく、OS に登録されたホームそのものになる
    expect(r.home).toBe(userInfo().homedir);
  });

  test("HOME が空で OS に登録が無ければ（id -un が失敗）、ホームを空にして理由を書く", () => {
    const r = resolveHome({ HOME: "" }, `#!${BASH}\nexit 1\n`);
    expect(r.home).toBe("");
    expect(r.reason).toBe("HOME が空である。OS にこのユーザーの登録が無く、ホームを決められない。");
  });

  test("HOME が空で id が PATH に無ければ、ホームを空にして確かめられないことを書く", () => {
    const r = resolveHome({ HOME: "" }, null);
    expect(r.home).toBe("");
    expect(r.reason).toBe(
      "HOME が空である。id コマンドが無く、OS に登録されたホームを確かめられない。",
    );
  });
});
