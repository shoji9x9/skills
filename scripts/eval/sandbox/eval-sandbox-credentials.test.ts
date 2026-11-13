// eval-sandbox.sh が、ホームの認証情報を run から隠すことのテスト（Issue #1008）。
//
// bwrap のスタブで、bwrap に渡す引数と --verify の stage 5 の判定を確かめる（CI でも実行する）。
// 本物の bwrap で目印が読めるかを確かめるテストは eval-sandbox-credentials-bwrap.test.ts にある。
// 分けるのは、ミューテーションテストの結果を、bwrap が在って動く環境かどうかで変えないためである。
//
// | 軸                         | 値                                                              |
// | -------------------------- | --------------------------------------------------------------- |
// | 許可リストの場所           | ホストに在る / 無い                                             |
// | 許可リストの外             | 名前を挙げた認証情報（box・gh・ssh・aws・keyring） / 名前を挙げていない場所 / 何も無い |
// | 許可リストの祖先           | 祖先の中の許可リストの外（.config/box）/ 許可リストそのもの（.config/mise） |
// | runtime dir                | 中身が在る（少ない・SIGPIPE が起きる量）/ 空 / 実在しない（/run/user/<uid> の扱いは eval-sandbox.test.ts） |
// | エージェントのソケットの変数 | 外す / 外さない（スタブで --unsetenv を反映しない）            |
// | CLI の実体                 | $HOME の外 / $HOME の下で許可リストの中 / $HOME の下で許可リストの外 |
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { allowedFiles, credentialFiles, sandbox } from "./eval-sandbox-helpers.ts";

/** bwrap の引数から、指定したフラグの n 個目の値を集める。 */
function flagValues(args: string[], flag: string, offset = 1) {
  return args.flatMap((arg, i) => (arg === flag ? [args[i + offset]] : []));
}

describe("bwrap に渡す引数", () => {
  test("$HOME は空の tmpfs にし、許可リストのうちホストに在るものだけを読み取り専用で戻す", () => {
    const { result, bwrapArgs, home } = sandbox(["--version"], {
      homeFiles: { ...credentialFiles, ...allowedFiles },
    });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    expect(flagValues(bwrapArgs, "--tmpfs")).toContain(home);
    const roBindTargets = flagValues(bwrapArgs, "--ro-bind", 2);
    expect(roBindTargets).not.toContain(home);
    for (const allowed of [".config/mise", ".gitconfig", ".local/share/mise"]) {
      expect(roBindTargets).toContain(join(home, allowed));
    }
    // ホストに無い許可リストの場所は bind しない。
    expect(roBindTargets).not.toContain(join(home, ".local/share/claude"));
    for (const credential of [".config/box", ".config/gh", ".ssh", ".aws", ".unlisted-tool"]) {
      expect(bwrapArgs.some((arg) => arg.startsWith(join(home, credential)))).toBe(false);
    }
  });

  test("$HOME の tmpfs は $HOME の下のどのマウントより先に置き、--remount-ro は最後に置く", () => {
    const { result, bwrapArgs, home } = sandbox(["--version"], { homeFiles: allowedFiles });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    const homeTmpfs = bwrapArgs.findIndex(
      (arg, i) => arg === "--tmpfs" && bwrapArgs[i + 1] === home,
    );
    expect(homeTmpfs).toBeGreaterThanOrEqual(0);
    const remount = bwrapArgs.indexOf("--remount-ro");
    expect(bwrapArgs[remount + 1]).toBe(home);
    const underHome = bwrapArgs.flatMap((arg, i) => (arg.startsWith(`${home}/`) ? [i] : []));
    expect(underHome.length).toBeGreaterThan(0);
    for (const index of underHome) {
      expect(index).toBeGreaterThan(homeTmpfs);
      expect(index).toBeLessThan(remount);
    }
  });

  test.each([
    ["中身が在る", ["bus", "keyring"], true],
    ["空", [], true],
    ["実在しない", undefined, false],
  ])(
    "runtime dir が%sなら、在るときだけ tmpfs で隠し、ソケットの変数は常に外す",
    (_label, entries, hidden) => {
      const { result, bwrapArgs, runtimeDir } = sandbox(["--version"], { runtimeEntries: entries });
      expect(result.status, result.stderr).toBe(0);
      if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
      expect(flagValues(bwrapArgs, "--tmpfs").includes(runtimeDir)).toBe(hidden);
      expect(flagValues(bwrapArgs, "--unsetenv")).toEqual([
        "DBUS_SESSION_BUS_ADDRESS",
        "SSH_AUTH_SOCK",
        "GPG_AGENT_INFO",
      ]);
    },
  );
});

describe("--verify の stage 5（スタブでホストの上で実行する）", () => {
  test("許可リストの外が見え、戻した場所が読めず、runtime dir とソケットの変数が残っていれば、それぞれ失敗にする", () => {
    const { result, home, runtimeDir } = sandbox(["--verify", "MARKER"], {
      homeFiles: { ...credentialFiles, ...allowedFiles },
      runtimeEntries: ["bus"],
      env: {
        FAKE_BWRAP_MODE: "exec-credentials",
        FAKE_BWRAP_KEEP_ENV: "1",
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/bus",
      },
    });
    expect(result.status).toBe(1);
    // ~/.claude.json は bind する先で、ホストの使い捨ての $HOME には無いので読めない。
    expect(result.stdout).toContain("stage5 home allowlist positive control: NOT READABLE (FAIL)");
    expect(result.stdout).toContain(`    ${join(home, ".claude.json")}\n`);
    expect(result.stdout).toContain("stage5 home outside the allowlist: VISIBLE (FAIL)");
    // 祖先（.config・.local/share）の中は 1 段ずつ下りて挙げ、許可リストそのものは挙げない。
    for (const credential of [
      ".config/box",
      ".config/gh",
      ".ssh",
      ".aws",
      ".local/share/keyrings",
      ".unlisted-tool",
      ".config/git/credentials",
    ]) {
      expect(result.stdout).toContain(`    ${join(home, credential)}\n`);
    }
    for (const allowed of [
      ".config/mise",
      ".gitconfig",
      ".local/share/mise",
      ".config\n",
      ".local\n",
    ]) {
      expect(result.stdout).not.toContain(`    ${join(home, allowed)}`);
    }
    expect(result.stdout).toContain(`stage5 runtime dir ${runtimeDir}: VISIBLE (FAIL)`);
    expect(result.stdout).toContain(
      "stage5 agent socket variables: SET (FAIL): DBUS_SESSION_BUS_ADDRESS",
    );
  });

  test("戻した場所がすべて読め、--unsetenv が反映されていれば、その 2 つは ok にする", () => {
    const { result, runtimeDir } = sandbox(["--verify", "MARKER"], {
      homeFiles: { ".claude.json": "{}\n", ...allowedFiles },
      runtimeEntries: [],
      env: { FAKE_BWRAP_MODE: "exec-credentials", DBUS_SESSION_BUS_ADDRESS: "unix:path=/x" },
    });
    expect(result.stdout).toMatch(
      /^stage5 home allowlist positive control: \d+ bound paths readable \(ok\)$/mu,
    );
    expect(result.stdout).toContain("stage5 agent socket variables: unset (ok)");
    expect(result.stdout).toContain(
      `stage5 runtime dir ${runtimeDir}: no entries on the host (nothing to hide)`,
    );
  });

  test("許可リストの外にホストのパスが 1 つも無ければ、隠せたと示せないので失敗にする", () => {
    // ほかの判定を ok にして、終了コードの原因をこの判定だけにする。
    const { result } = sandbox(["--verify", "MARKER"], {
      homeFiles: { ".claude.json": "{}\n" },
      env: { FAKE_BWRAP_MODE: "exec-credentials" },
    });
    expect(result.stdout).toContain(
      "stage5 home allowlist positive control: 1 bound paths readable (ok)",
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("stage5 home outside the allowlist: NOTHING TO CHECK (FAIL: ");
  });
});

describe("runtime dir と CLI の場所", () => {
  test("runtime dir の中身が多くても（ls が SIGPIPE で止まる量）、見えていれば失敗にする", () => {
    const entries = Array.from({ length: 3000 }, (_, i) => `socket-with-a-long-name-${i}`);
    const { result, runtimeDir } = sandbox(["--verify", "MARKER"], {
      runtimeEntries: entries,
      env: { FAKE_BWRAP_MODE: "exec-credentials" },
    });
    expect(result.stdout).toContain(`stage5 runtime dir ${runtimeDir}: VISIBLE (FAIL)`);
  });

  test("XDG_RUNTIME_DIR が在れば、tmpfs で隠す", () => {
    const { result, bwrapArgs, runtimeDir } = sandbox(["--version"], { runtimeEntries: ["bus"] });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    expect(flagValues(bwrapArgs, "--tmpfs")).toContain(runtimeDir);
  });

  // 起動の前の確認。何が隠れるかは本物の bwrap のテストが測る。ここでは、確かめるパスと、
  // 隠れると答えられたときに止まるかを確かめる（スタブは FAKE_BWRAP_HIDDEN に挙げたパスを隠れると答える）。
  test("CLI が隠れると答えられたら、run を起動せずに止める", () => {
    const { result, bwrapArgs, bin } = sandbox(["--version"], { hiddenCli: true });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain(`the sandbox hides the CLI: ${join(bin, "claude")}.`);
    expect(bwrapArgs).toBeNull();
  });

  test("確かめるのは CLI だけで、PATH のディレクトリは確かめない", () => {
    const { result, bin, probeArgs } = sandbox(["--version"], {
      pathHomeDirs: [{ dir: "tool-dir", state: "tool" }],
    });
    expect(result.status, result.stderr).toBe(0);
    if (probeArgs === null) throw new Error("確認の呼び出しが無い");
    expect(probeArgs.slice(probeArgs.indexOf("_") + 1).filter(Boolean)).toEqual([
      join(bin, "claude"),
    ]);
  });

  test("$HOME の下のリポジトリを隠すマウントは、$HOME の tmpfs が覆うので、stage 5 はそのパスも確かめる", () => {
    const { result, home } = sandbox(["--verify", "MARKER"], {
      repoUnderHome: true,
      env: { FAKE_BWRAP_MODE: "exec-credentials" },
    });
    expect(result.stdout).toContain("stage5 home outside the allowlist: VISIBLE (FAIL)");
    expect(result.stdout).toContain(`    ${join(home, "projects")}\n`);
  });
});
