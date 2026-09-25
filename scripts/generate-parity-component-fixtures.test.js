// fixture 生成スクリプトの Chrome の片付けの回帰テスト（Issue #357）。
//
// 本物の Chrome は CI に無いので、CHROME に偽の Chrome を渡す。偽物は DevTools の URL を出したうえで
// ハンドシェイクを失敗させ（接続を拒否するポート）、片付けの経路へ入らせる。
// SIGTERM を無視する偽物では、上限なしに終了を待つ実装は終わらない（修正前の実装で再現する）。

import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { makeTempDir } from "./lib/test-tmpdir.js";

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "generate-parity-component-fixtures.js",
);
const directories = [];
const pidFiles = [];

afterEach(() => {
  // 失敗したテスト（修正前の実装を当てた陽性コントロール等）が偽の Chrome を残しても次へ持ち越さない。
  for (const pidFile of pidFiles.splice(0)) {
    if (!existsSync(pidFile)) continue;
    try {
      process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
    } catch {
      // 既に終了している
    }
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function makeFakeChrome({ ignoreTerm }) {
  const directory = makeTempDir("fake-chrome-");
  directories.push(directory);
  const pidFile = join(directory, "pid");
  pidFiles.push(pidFile);
  const chrome = join(directory, "chrome");
  writeFileSync(
    chrome,
    `#!/usr/bin/env bash
${ignoreTerm ? "trap '' TERM" : ""}
echo $$ >${JSON.stringify(pidFile)}
# ポート 1 は接続を拒否するので、/json の取得で失敗して片付けへ入る
echo "DevTools listening on ws://127.0.0.1:1/devtools/browser/fake" >&2
while :; do sleep 0.05; done
`,
    "utf8",
  );
  chmodSync(chrome, 0o755);
  // 生成スクリプトはプロファイルを os.tmpdir() に作る。TMPDIR を専用にして残骸を数える。
  const profileRoot = makeTempDir("fake-chrome-tmp-");
  directories.push(profileRoot);
  return { chrome, pidFile, profileRoot };
}

function runGenerator({ chrome, profileRoot }, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        CHROME: chrome,
        TMPDIR: profileRoot,
        PARITY_FIXTURES_SHUTDOWN_TIMEOUT_MS: "500",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    // 待ちが終わらない実装を打ち切るための外側の上限。打ち切りは合格に倒さない（timedOut で落とす）。
    const guard = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("exit", (code, signal) => {
      clearTimeout(guard);
      resolve({
        code,
        signal,
        stderr,
        elapsed: Date.now() - started,
        timedOut: signal === "SIGKILL",
      });
    });
  });
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("SIGTERM を無視する Chrome でも上限内に終わり、元のエラーを出し、プロセスとプロファイルを残さない", async () => {
  const fake = makeFakeChrome({ ignoreTerm: true });
  const result = await runGenerator(fake, 15000);

  expect(result.timedOut, result.stderr).toBe(false);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toMatch(/SIGKILL する/u);
  expect(result.stderr).toMatch(/fetch failed/u);
  const pid = Number(readFileSync(fake.pidFile, "utf8"));
  expect(alive(pid)).toBe(false);
  expect(readdirSync(fake.profileRoot)).toEqual([]);
});

test("SIGTERM で終わる Chrome には SIGKILL を使わない", async () => {
  const fake = makeFakeChrome({ ignoreTerm: false });
  const result = await runGenerator(fake, 15000);

  expect(result.timedOut, result.stderr).toBe(false);
  expect(result.code).not.toBe(0);
  expect(result.stderr).not.toMatch(/SIGKILL/u);
  expect(result.stderr).toMatch(/fetch failed/u);
  expect(existsSync(fake.pidFile)).toBe(true);
  expect(alive(Number(readFileSync(fake.pidFile, "utf8")))).toBe(false);
  expect(readdirSync(fake.profileRoot)).toEqual([]);
});
