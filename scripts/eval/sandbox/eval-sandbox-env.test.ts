// eval-sandbox.sh が run に渡す環境変数と、$HOME の外の設定の場所の扱いのテスト（Issue #1011）。
//
// bwrap のスタブが、受け取った環境変数の名前（値は記録しない）と引数を記録する。
// 本物の bwrap で run から見えるかを確かめるテストは eval-sandbox-credentials-bwrap.test.ts にある。
// 環境変数の値は、テスト用の無害な文字列だけを使う。
//
// | 軸                         | 値                                                                  |
// | -------------------------- | ------------------------------------------------------------------- |
// | 許可リストの外の変数       | 認証情報（GH_TOKEN・AWS_*・BOX_*）/ 親のエージェントのトークンとソケット / 名前を挙げていない変数 / 名前が識別子でない変数・export した関数 |
// | 許可リストの中の変数       | 起動の基本（PATH・USER・LOGNAME・SHELL・PWD。HOME は run_bwrap が設定し直す）/ XDG の場所（4 つの XDG_*_HOME と XDG_RUNTIME_DIR）/ 出力とロケール（LANG・LANGUAGE・LC_ALL とロケールの分類 12 個を名前で）/ ファイルの置き場所（TZ・TMPDIR）/ プロキシ（大文字・小文字）と証明書 / ハーネス / ベンダーの API キー |
// | ベンダー                   | claude-code / codex（相手のベンダーのキーは渡さない）               |
// | EVAL_SANDBOX_ENV_ALLOW     | 無い / 変数名（空白・改行で区切る） / 変数名でない値 / glob の文字  |
// | 値の置き場所               | 環境だけ（bwrap の引数に載らない）                                  |
// | $HOME                      | 普通のパス / シンボリックリンク（解決したパスを渡す）               |
// | XDG_*_HOME                 | 無い / $HOME の外 / $HOME の中のデフォルトでない場所 / $HOME を含む / cwd を含む / 「/」（$HOME を含む） / 互いを含む（どちらの並びでも） / runtime dir を含む / runtime dir の下 / 絶対パスでない（XDG_RUNTIME_DIR を含む 5 つの変数のそれぞれ） / 空白を含み、後ろの部分が別の場所と同じ字面 / 変数とリンクが同じ場所 |
// | 許可リストの祖先           | 普通のディレクトリ / $HOME の外へのリンク / $HOME の中へのリンク / 先に見つけた場所の中へのリンク |
import { mkdirSync, renameSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import {
  allowedFiles,
  credentialFiles,
  flagValues,
  sandbox,
  writeHomeFiles,
} from "./eval-sandbox-helpers.ts";

const hiddenNames = {
  GH_TOKEN: "dummy-gh",
  AWS_ACCESS_KEY_ID: "dummy-aws",
  BOX_CLIENT_SECRET: "dummy-box",
  CLAUDE_CODE_MESSAGING_TOKEN: "dummy-session",
  CLAUDE_CODE_MESSAGING_SOCKET: "/nonexistent/sock",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/bus",
  SSH_AUTH_SOCK: "/nonexistent/agent",
  WSL_INTEROP: "/nonexistent/interop",
  UNLISTED_TOOL_SETTING: "dummy",
  // LC_ で始まるが、ロケールの分類ではない。
  LC_DEPLOY_TOKEN: "dummy-lc",
};
// ロケールの分類の変数（glibc の locale(7) が挙げる LC_ALL と 12 の分類）。許可リストはこの一覧を名前で並べる。
const localeNames = [
  "LC_ALL",
  "LC_CTYPE",
  "LC_COLLATE",
  "LC_MESSAGES",
  "LC_MONETARY",
  "LC_NUMERIC",
  "LC_TIME",
  "LC_ADDRESS",
  "LC_IDENTIFICATION",
  "LC_MEASUREMENT",
  "LC_NAME",
  "LC_PAPER",
  "LC_TELEPHONE",
];
// 許可リストの中の変数（ベンダーごとの API キーは別のテスト）。値はテスト用の無害な文字列である。
const shownNames = {
  LANG: "C.UTF-8",
  LANGUAGE: "en",
  ...Object.fromEntries(localeNames.map((name) => [name, "C.UTF-8"])),
  TERM: "dumb",
  COLORTERM: "truecolor",
  NO_COLOR: "1",
  TZ: "UTC",
  TMPDIR: tmpdir(),
  ...Object.fromEntries(
    ["http_proxy", "https_proxy", "no_proxy", "all_proxy"].flatMap((name) => [
      [name, "http://127.0.0.1:9"],
      [name.toUpperCase(), "http://127.0.0.1:9"],
    ]),
  ),
  NODE_EXTRA_CA_CERTS: "/nonexistent/ca.pem",
  SSL_CERT_FILE: "/nonexistent/cert.pem",
  SSL_CERT_DIR: "/nonexistent/certs",
  SHOJI9X9_SKILLS_IGNORE_USER_CONFIG: "1",
  USER: "eval-user",
  LOGNAME: "eval-user",
  SHELL: "/bin/bash",
  // 実在しない絶対パスにして、隠す場所としては扱われないようにする（扱いは「$HOME の外の設定の場所」のテスト）。
  XDG_CONFIG_HOME: "/nonexistent/xdg-config",
  XDG_DATA_HOME: "/nonexistent/xdg-data",
  XDG_STATE_HOME: "/nonexistent/xdg-state",
  XDG_CACHE_HOME: "/nonexistent/xdg-cache",
};
// テストの環境が必ず持つ、許可リストの中の変数（PATH・XDG_RUNTIME_DIR はヘルパーが入れ、PWD はシェルが入れる）。
// HOME は入れない。run_bwrap が解決したパスで設定し直すので、許可リストに無くても渡り、許可リストを確かめられない。
const alwaysShown = ["PATH", "XDG_RUNTIME_DIR", "PWD"];
const claudeKeys = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
];
// CODEX_HOME は、Codex の run では sandbox が自分で設定するので、ここでは Claude Code の run に渡らないことだけを確かめる。
const codexKeys = ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"];

describe("run に渡す環境変数", () => {
  test("許可リストの外は渡さず、許可リストの中は渡す（起動の前の確認と run の両方で）", () => {
    const { result, envNames } = sandbox(["--version"], {
      env: { ...hiddenNames, ...shownNames, ANTHROPIC_API_KEY: "dummy-key" },
    });
    expect(result.status, result.stderr).toBe(0);
    // 起動の前の確認と run の 2 回。
    expect(envNames).toHaveLength(2);
    for (const names of envNames) {
      for (const name of Object.keys(hiddenNames)) expect(names).not.toContain(name);
      for (const name of [...Object.keys(shownNames), ...alwaysShown, "ANTHROPIC_API_KEY"]) {
        expect(names).toContain(name);
      }
    }
  });

  test.each([
    ["claude-code", "claude", [claudeKeys, [...codexKeys, "CODEX_HOME"]]],
    ["codex", "codex", [codexKeys, claudeKeys]],
  ] as const)("%s では、そのベンダーの API キーだけを渡す", (vendor, cli, [own, other]) => {
    const keys = (names: readonly string[], value: string) =>
      Object.fromEntries(names.map((name) => [name, value]));
    const { result, envNames } = sandbox(["--version"], {
      cli,
      vendor,
      homeFiles: { ".codex/auth.json": "{}\n" },
      env: { ...keys(own, "dummy-own"), ...keys(other, "dummy-other"), EVAL_SANDBOX_NET: "off" },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(envNames.length).toBeGreaterThan(0);
    for (const names of envNames) {
      for (const name of own) expect(names).toContain(name);
      for (const name of other) expect(names).not.toContain(name);
    }
  });

  test("値は bwrap の引数に載せない（run の中から /proc/<pid>/cmdline で読めるため）", () => {
    const { result, bwrapArgs } = sandbox(["--version"], {
      env: { ...shownNames, ANTHROPIC_API_KEY: "VALUE-MUST-NOT-BE-AN-ARGUMENT" },
    });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    expect(bwrapArgs.join("\n")).not.toContain("VALUE-MUST-NOT-BE-AN-ARGUMENT");
    expect(bwrapArgs.join("\n")).not.toContain("C.UTF-8");
  });

  test("EVAL_SANDBOX_ENV_ALLOW に挙げた名前は（改行の後の名前も）渡し、挙げていない名前は渡さない", () => {
    const { result, envNames } = sandbox(["--version"], {
      env: {
        EVAL_SANDBOX_ENV_ALLOW: "EXTRA_ONE  EXTRA_TWO\nEXTRA_FOUR",
        EXTRA_ONE: "1",
        EXTRA_TWO: "2",
        EXTRA_THREE: "3",
        EXTRA_FOUR: "4",
      },
    });
    expect(result.status, result.stderr).toBe(0);
    for (const names of envNames) {
      expect(names).toEqual(expect.arrayContaining(["EXTRA_ONE", "EXTRA_TWO", "EXTRA_FOUR"]));
      expect(names).not.toContain("EXTRA_THREE");
    }
  });

  test("EVAL_SANDBOX_ENV_ALLOW に変数名でない値があれば、bwrap を起動せずに止める", () => {
    const { result, envNames } = sandbox(["--version"], {
      env: { EVAL_SANDBOX_ENV_ALLOW: "OK_NAME BAD-NAME" },
    });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("not a variable name: BAD-NAME");
    expect(envNames).toEqual([]);
  });

  test("名前が識別子でない変数と、export した関数も渡さない（bash は子に渡すが compgen -e に出ない）", () => {
    const { result, envNames } = sandbox(["--version"], {
      env: { "GH.TOKEN": "dummy-dotted", "BASH_FUNC_probe%%": "() {  :\n}" },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(envNames).toHaveLength(2);
    for (const names of envNames) {
      expect(names).not.toContain("GH.TOKEN");
      expect(names).not.toContain("BASH_FUNC_probe%%");
    }
  });

  test("EVAL_SANDBOX_ENV_ALLOW の * は、cwd のファイル名に展開しない", () => {
    const { result, envNames } = sandbox(["--version"], {
      env: { EVAL_SANDBOX_ENV_ALLOW: "*", GLOB_NAMED: "1" },
      setup: (paths) => {
        writeHomeFiles(paths.root, { "glob-cwd/GLOB_NAMED": "" });
        return { cwd: join(paths.root, "glob-cwd") };
      },
    });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("not a variable name: *");
    expect(envNames).toEqual([]);
  });

  test("bash が unset できない変数（export した SHELLOPTS）も渡さない", () => {
    const { result, envNames } = sandbox(["--version"], { env: { SHELLOPTS: "braceexpand" } });
    expect(result.status, result.stderr).toBe(0);
    for (const names of envNames) expect(names).not.toContain("SHELLOPTS");
  });
});

describe("$HOME の外の設定の場所", () => {
  test("XDG_CONFIG_HOME が $HOME の外なら tmpfs で隠し、許可リストの場所だけを読み取り専用で戻す", () => {
    const { result, bwrapArgs, root } = sandbox(["--version"], {
      setup: (paths) => {
        const xdg = join(paths.root, "xdg-config");
        writeHomeFiles(xdg, { "gh/hosts.yml": "MARKER\n", "mise/config.toml": "MARKER\n" });
        return { env: { XDG_CONFIG_HOME: xdg } };
      },
    });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    const xdg = join(root, "xdg-config");
    expect(flagValues(bwrapArgs, "--tmpfs")).toContain(xdg);
    const roBindTargets = flagValues(bwrapArgs, "--ro-bind", 2);
    expect(roBindTargets).toContain(join(xdg, "mise"));
    expect(roBindTargets).not.toContain(join(xdg, "gh"));
    expect(flagValues(bwrapArgs, "--remount-ro")).toContain(xdg);
  });

  test("XDG_CONFIG_HOME が $HOME の中のデフォルトでない場所なら、tmpfs は置かずに許可リストの場所を戻す", () => {
    const { result, bwrapArgs, home } = sandbox(["--version"], {
      homeFiles: { "my-config/mise/config.toml": "MARKER\n", "my-config/gh/hosts.yml": "MARKER\n" },
      setup: (paths) => ({ env: { XDG_CONFIG_HOME: join(paths.home, "my-config") } }),
    });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    expect(flagValues(bwrapArgs, "--tmpfs")).not.toContain(join(home, "my-config"));
    expect(flagValues(bwrapArgs, "--ro-bind", 2)).toContain(join(home, "my-config/mise"));
    expect(flagValues(bwrapArgs, "--ro-bind", 2)).not.toContain(join(home, "my-config/gh"));
  });

  test.each([
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "XDG_RUNTIME_DIR",
  ])("%s が絶対パスでなければ、隠す場所として扱わず、run にも渡さない", (name) => {
    const { result, bwrapArgs, envNames } = sandbox(["--version"], {
      setup: (paths) => {
        const project = join(paths.root, "relative-project");
        writeHomeFiles(project, { "rel/mise/marker": "MARKER\n" });
        return { env: { [name]: "rel" }, cwd: project };
      },
    });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    expect(flagValues(bwrapArgs, "--tmpfs").filter((t) => t.endsWith("/rel"))).toEqual([]);
    // 相対パスのまま渡すと、git などが run の cwd を基準に読む。
    expect(envNames.length).toBeGreaterThan(0);
    for (const names of envNames) expect(names).not.toContain(name);
  });

  test("空白を含むパスの後ろの部分が別の場所と同じ字面でも、別の場所として両方を隠す", () => {
    const { result, bwrapArgs, root } = sandbox(["--version"], {
      homeFiles: { ...allowedFiles },
      setup: (paths) => {
        // 1 つ目の場所のパスは「<root>/d x 」の後ろに 2 つ目の場所のパスを続けたものにする。
        const linked = join(paths.root, "cfg");
        const spaced = join(paths.root, `d x ${linked}`);
        writeHomeFiles(spaced, { "mise/marker": "MARKER\n" });
        renameSync(join(paths.home, ".config"), linked);
        symlinkSync(linked, join(paths.home, ".config"));
        return { env: { XDG_CONFIG_HOME: spaced } };
      },
    });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    const linked = join(root, "cfg");
    expect(flagValues(bwrapArgs, "--tmpfs")).toEqual(
      expect.arrayContaining([linked, join(root, `d x ${linked}`)]),
    );
  });

  test("XDG_CONFIG_HOME と ~/.config のリンクが同じ場所を指しても、許可リストの場所は 1 回だけ戻す", () => {
    const { result, bwrapArgs, root } = sandbox(["--version"], {
      homeFiles: { ...allowedFiles },
      setup: (paths) => {
        const target = join(paths.root, "same-config");
        renameSync(join(paths.home, ".config"), target);
        symlinkSync(target, join(paths.home, ".config"));
        return { env: { XDG_CONFIG_HOME: target } };
      },
    });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    const target = join(root, "same-config");
    expect(
      flagValues(bwrapArgs, "--ro-bind", 2).filter((t) => t === join(target, "mise")),
    ).toHaveLength(1);
    // 2 つ目の tmpfs が先の bind を覆わないこと（under_root が止める）の回帰の確認。
    expect(flagValues(bwrapArgs, "--tmpfs").filter((t) => t === target)).toHaveLength(1);
  });

  test("~/.config が $HOME の外へのシンボリックリンクなら、リンク先を tmpfs で隠して許可リストの場所を戻す", () => {
    const { result, bwrapArgs, root } = sandbox(["--version"], {
      homeFiles: { ...credentialFiles, ...allowedFiles },
      setup: (paths) => {
        renameSync(join(paths.home, ".config"), join(paths.root, "dot-config"));
        symlinkSync(join(paths.root, "dot-config"), join(paths.home, ".config"));
        return {};
      },
    });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    const target = join(root, "dot-config");
    expect(flagValues(bwrapArgs, "--tmpfs")).toContain(target);
    const roBindTargets = flagValues(bwrapArgs, "--ro-bind", 2);
    expect(roBindTargets).toContain(join(target, "mise"));
    expect(roBindTargets).toContain(join(target, "git/ignore"));
    expect(roBindTargets).not.toContain(join(target, "box"));
  });

  test("先に見つけた場所の中にリンクした許可リストの祖先も、その中の許可リストの場所を戻す", () => {
    const { result, bwrapArgs, root } = sandbox(["--version"], {
      homeFiles: { ...allowedFiles },
      setup: (paths) => {
        const xdg = join(paths.root, "xdg-all");
        writeHomeFiles(xdg, { "mise/config.toml": "MARKER\n" });
        renameSync(join(paths.home, ".local"), join(xdg, "local"));
        symlinkSync(join(xdg, "local"), join(paths.home, ".local"));
        return { env: { XDG_CONFIG_HOME: xdg } };
      },
    });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    const xdg = join(root, "xdg-all");
    expect(flagValues(bwrapArgs, "--tmpfs").filter((t) => t.startsWith(xdg))).toEqual([xdg]);
    expect(flagValues(bwrapArgs, "--ro-bind", 2)).toContain(join(xdg, "local/share/mise"));
  });

  test.each([
    ["$HOME", (paths: { root: string; home: string }) => dirname(paths.home)],
    ["cwd", (paths: { root: string; home: string }) => join(paths.root, "cwd-parent")],
    ["/ として $HOME", () => "/"],
  ])("XDG_CONFIG_HOME が %s を含むなら、隠せないので bwrap を起動せずに止める", (label, dir) => {
    const { result, bwrapArgs } = sandbox(["--version"], {
      setup: (paths) => {
        const xdg = dir(paths);
        if (xdg !== "/") mkdirSync(join(xdg, "project"), { recursive: true });
        return {
          env: { XDG_CONFIG_HOME: xdg },
          cwd: label === "cwd" ? join(xdg, "project") : undefined,
        };
      },
    });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain(
      label === "cwd" ? "holds the disposable project" : "holds $HOME",
    );
    expect(bwrapArgs).toBeNull();
  });

  // 外側の場所も内側の場所も、自分の許可リストの mise を持つ。どちらの変数が外側でも同じに扱う。
  test.each([
    ["XDG_CONFIG_HOME が内側", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"],
    ["XDG_CACHE_HOME が内側", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"],
  ])(
    "XDG の場所が互いを含むとき（%s）、外側だけを tmpfs で隠し、両方の許可リストの場所を戻す",
    (_label, innerVar, outerVar) => {
      const { result, bwrapArgs, root } = sandbox(["--version"], {
        setup: (paths) => {
          const outer = join(paths.root, "xdg-outer");
          writeHomeFiles(outer, {
            "inner/mise/marker": "MARKER\n",
            "mise/marker": "MARKER\n",
            "gh/hosts.yml": "MARKER\n",
          });
          return { env: { [innerVar]: join(outer, "inner"), [outerVar]: outer } };
        },
      });
      expect(result.status, result.stderr).toBe(0);
      if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
      const outer = join(root, "xdg-outer");
      expect(flagValues(bwrapArgs, "--tmpfs").filter((t) => t.startsWith(outer))).toEqual([outer]);
      const roBindTargets = flagValues(bwrapArgs, "--ro-bind", 2);
      expect(roBindTargets).toContain(join(outer, "inner/mise"));
      expect(roBindTargets).toContain(join(outer, "mise"));
      expect(roBindTargets).not.toContain(join(outer, "gh"));
    },
  );

  test.each([
    ["の下にある", "lies inside the runtime dir", (run: string) => join(run, "cache")],
    ["を含む", "holds the runtime dir", (run: string) => dirname(run)],
  ])(
    "XDG の場所が runtime dir %sなら、どちらかの tmpfs が他方を覆うので bwrap を起動せずに止める",
    (_label, message, place) => {
      const { result, bwrapArgs } = sandbox(["--version"], {
        setup: (paths) => {
          const run = join(paths.root, "runtime-parent", "run");
          const cache = place(run);
          writeHomeFiles(run, { bus: "" });
          writeHomeFiles(cache, { "mise/marker": "MARKER\n" });
          return { env: { XDG_RUNTIME_DIR: run, XDG_CACHE_HOME: cache }, cwd: "/" };
        },
      });
      expect(result.status).toBe(3);
      expect(result.stderr).toContain(message);
      expect(bwrapArgs).toBeNull();
    },
  );

  test("runtime dir がシンボリックリンクでも、実際のパスで比べ、その中の XDG の場所を止める", () => {
    const { result, bwrapArgs } = sandbox(["--version"], {
      setup: (paths) => {
        const real = join(paths.root, "runtime-real");
        writeHomeFiles(real, { bus: "", "cache/mise/marker": "MARKER\n" });
        const link = join(paths.root, "runtime-link");
        symlinkSync(real, link);
        return { env: { XDG_RUNTIME_DIR: link, XDG_CACHE_HOME: join(real, "cache") }, cwd: "/" };
      },
    });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("lies inside the runtime dir");
    expect(bwrapArgs).toBeNull();
  });
});

describe("--verify の stage 5 と、$HOME の外の場所", () => {
  test("Codex の run で、ホストの CODEX_HOME は sandbox が設定し直すので、漏れた変数と数えない", () => {
    const { result } = sandbox(["--verify", "MARKER"], {
      cli: "codex",
      vendor: "codex",
      homeFiles: { ".claude.json": "{}\n", ".codex/auth.json": "{}\n" },
      env: { FAKE_BWRAP_MODE: "exec-credentials", EVAL_SANDBOX_NET: "off" },
      setup: (paths) => ({ env: { CODEX_HOME: join(paths.home, ".codex") } }),
    });
    expect(result.stdout, result.stderr).toMatch(
      /^stage5 environment outside the allowlist: \d+ host variables as expected \(ok\)$/mu,
    );
  });

  test("$HOME の外の XDG の場所も、戻していないパスを確かめる対象に入れる", () => {
    const { result, root } = sandbox(["--verify", "MARKER"], {
      homeFiles: { ".claude.json": "{}\n" },
      env: { FAKE_BWRAP_MODE: "exec-credentials" },
      setup: (paths) => {
        const xdg = join(paths.root, "xdg-config");
        writeHomeFiles(xdg, { "gh/hosts.yml": "MARKER\n", "mise/config.toml": "MARKER\n" });
        return { env: { XDG_CONFIG_HOME: xdg } };
      },
    });
    // スタブはホストの上で実行するので、隠したはずのパスが見え、FAIL に挙がる。
    expect(result.stdout).toContain("stage5 home outside the allowlist: VISIBLE (FAIL)");
    expect(result.stdout).toContain(`    ${join(root, "xdg-config/gh")}\n`);
    expect(result.stdout).not.toContain(`    ${join(root, "xdg-config/mise")}`);
  });

  test("許可リストの祖先がシンボリックリンクでも、その中に下りて確かめ、リンクそのものは挙げない", () => {
    const { result, home } = sandbox(["--verify", "MARKER"], {
      homeFiles: { ".claude.json": "{}\n", ...credentialFiles, ...allowedFiles },
      env: { FAKE_BWRAP_MODE: "exec-credentials" },
      setup: (paths) => {
        renameSync(join(paths.home, ".config"), join(paths.home, "dotfiles-config"));
        symlinkSync(join(paths.home, "dotfiles-config"), join(paths.home, ".config"));
        return {};
      },
    });
    // リンクの側（~/.config）と、リンク先の側（~/dotfiles-config）の両方に下りる。
    for (const dir of [".config", "dotfiles-config"]) {
      expect(result.stdout).toContain(`    ${join(home, dir, "box")}\n`);
      expect(result.stdout).not.toContain(`    ${join(home, dir)}\n`);
      expect(result.stdout).not.toContain(`    ${join(home, dir, "mise")}`);
    }
  });
});
