// kaizen の共通ライブラリ（kaizen-hook-common.sh）の設定の読み取りのテスト。
//
// 設定ファイルが 1 つも無いとき、bash のスクリプトは node を起動せずに kaizen_config_defaults の値を使う。
// この値がスキーマ（config-schemas/kaizen.schema.json）の default とずれると、設定ファイルの有無だけで動きが変わる
// （例: 設定ファイルを置いた途端に定期実行が始まる）。そこで両者が一致することを確かめる。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { kaizenEnv, writeKaizenConfig } from "./kaizen-config-env.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const lib = join(repoRoot, "skills/kaizen/scripts/kaizen-hook-common.sh");
const schemaPath = join(repoRoot, "skills/kaizen/config-schemas/kaizen.schema.json");

/** 共通ライブラリを読み込んで、kaizen_config_load の後の全キーの値と出所を返す。 */
function loaded(dir: string) {
  const res = spawnSync(
    "bash",
    [
      "-c",
      [
        '. "$1"',
        "kaizen_config_load || { printf 'ERR=%s\\n' \"$kaizen_config_error\"; exit 1; }",
        'for k in $(kaizen_config_defaults | sed "s/=.*//") schedule_model schedule_effort; do',
        '  v=$(kaizen_config_value "$k") && printf "%s=%s@%s\\n" "$k" "$v" "$(kaizen_config_source "$k")"',
        "done",
        "true",
      ].join("\n"),
      "_",
      lib,
    ],
    { cwd: dir, env: kaizenEnv(dir), encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function schemaDefaults(): Record<string, string> {
  const schema: unknown = JSON.parse(readFileSync(schemaPath, "utf8"));
  const props =
    typeof schema === "object" && schema !== null && "properties" in schema
      ? schema.properties
      : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(typeof props === "object" && props !== null ? props : {})) {
    if (typeof v === "object" && v !== null && "default" in v) out[k] = String(v.default);
  }
  return out;
}

test("設定ファイルが無いときに bash が使う値は、スキーマの default と一致する", () => {
  const dir = makeTempDir("kaizen-config-");
  const { status, stdout } = loaded(dir);
  expect(status).toBe(0);
  const got: Record<string, string> = {};
  for (const line of stdout.trim().split("\n")) {
    const m = /^([a-z_]+)=(.*)@(.*)$/.exec(line);
    expect(m, line).not.toBeNull();
    if (m === null) continue;
    expect(m[3]).toBe("default");
    got[m[1]] = m[2];
  }
  const want = schemaDefaults();
  expect(Object.keys(want).length).toBeGreaterThan(0);
  expect(got).toEqual(want);
});

test("設定ファイルがあれば node で読み、同じキーのデフォルトはスキーマから取る", () => {
  const dir = makeTempDir("kaizen-config-");
  writeKaizenConfig(dir, '{\n  // c\n  "forget_after_days": 9,\n  "schedule_model": "m-1",\n}\n');
  const { status, stdout } = loaded(dir);
  expect(status).toBe(0);
  expect(stdout).toContain("forget_after_days=9@repo\n");
  expect(stdout).toContain("schedule_model=m-1@repo\n");
  expect(stdout).toContain("forget_auto=true@default\n");
  // default の無いキーは、値が無い（kaizen_config_value が 1 を返す）
  expect(stdout).not.toContain("schedule_effort=");
});

test("人ごとの層を読まない（SHOJI9X9_SKILLS_IGNORE_USER_CONFIG=1）ときの注意は、値として読まない", () => {
  const dir = makeTempDir("kaizen-config-");
  writeKaizenConfig(dir, '{ "forget_after_days": 9 }\n');
  const res = spawnSync(
    "bash",
    [
      "-c",
      '. "$1"; kaizen_config_load; echo "rc=$?"; kaizen_config_value forget_after_days',
      "_",
      lib,
    ],
    {
      cwd: dir,
      env: { ...kaizenEnv(dir), SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: "1" },
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    },
  );
  expect(res.stdout).toBe("rc=0\n9");
  expect(res.stderr).toContain("SHOJI9X9_SKILLS_IGNORE_USER_CONFIG=1");
});

test("2 回目の kaizen_config_load は node を起動せず、前の結果を返す", () => {
  const dir = makeTempDir("kaizen-config-");
  writeKaizenConfig(dir, '{ "forget_after_days": 9 }\n');
  const res = spawnSync(
    "bash",
    [
      "-c",
      '. "$1"; kaizen_config_load; PATH=/nonexistent; kaizen_config_load; echo "rc=$?"; kaizen_config_value forget_after_days',
      "_",
      lib,
    ],
    { cwd: dir, env: kaizenEnv(dir), encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
  );
  expect(res.stdout).toBe("rc=0\n9");
});

test("誤りの結果も 2 回目に同じ理由で返す", () => {
  const dir = makeTempDir("kaizen-config-");
  writeKaizenConfig(dir, '{ "x": 1 }\n');
  const res = spawnSync(
    "bash",
    [
      "-c",
      '. "$1"; kaizen_config_load; a=$?; kaizen_config_load; b=$?; kaizen_config_value x; c=$?; echo "$a $b $c"',
      "_",
      lib,
    ],
    { cwd: dir, env: kaizenEnv(dir), encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
  );
  expect(res.stdout).toBe("1 1 2\n");
});
