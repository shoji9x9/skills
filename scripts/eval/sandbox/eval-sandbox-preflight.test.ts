// eval-sandbox.sh が bwrap を起動する前に止める構成のテスト（Issue #1015）。
//
// runtime dir の tmpfs は、ほかのマウントより後に置く。そのため、runtime dir が先に置いたマウントの宛先か
// cwd と同じか、それを含むと、tmpfs がそれを覆い、run が起動しないか CLI の認証が失敗する。
// スクリプトは、覆われる場所を挙げずに、bwrap に渡した宛先（--bind・--ro-bind・--dev-bind）と cwd を集めて比べる。
// git worktree list が失敗すると、ほかの work tree の親を隠せず、without_skill の run がメインの
// チェックアウトを読める。どちらも、bwrap を起動する前に理由を出して exit 3 で止める。
// bwrap と git はスタブにする（eval-sandbox-helpers.ts）。
//
// | 軸                          | 値                                                                                   |
// | --------------------------- | ------------------------------------------------------------------------------------ |
// | 宛先                        | $HOME の下の bind / cwd（/tmp の下で bind する・/tmp の外で bind しない） / /tmp の下の /etc のミラー / CODEX_HOME の auth.json / 許可リストの bind |
// | runtime dir と宛先の関係    | 同じ / 含む / 「/」 / 宛先の中（通す） / 名前が前方だけ一致（通す） / 隣（通す） / 宛先の無い /tmp（CLI の起動は通す。--verify は stage 5 の一覧が宛先になるので止める） |
// | リンク                      | cwd がリンクで runtime dir の中を指す / cwd のリンクが runtime dir の中にある / runtime dir がリンク / cwd が /tmp のリンクで $HOME の下を指す（通す。cwd はリンクのままのパスで bind する） |
// | git worktree list           | 成功する（通す） / 0 以外で終わる                                                    |
// | モード                      | CLI の起動 / --verify                                                                |
//
// sandbox() は XDG_RUNTIME_DIR をテストの下に設定し直すので、ホストの値は結果に関係しない。
// sandbox() の一時ディレクトリが /run/user/<uid> の下にある環境では、スクリプトは使い捨ての $HOME を含む
// runtime dir として止まる。テストは、os.tmpdir() を /run/user/<uid> の外に置いて実行する。
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { flagValues, sandbox, type SandboxOptions } from "./eval-sandbox-helpers.ts";

const modes: { mode: string; args: string[] }[] = [
  { mode: "CLI の起動", args: ["--version"] },
  { mode: "--verify", args: ["--verify", "MARKER"] },
];

/** runtime dir と cwd と、足す環境変数を決める。PWD はリンクのまま渡すために cwd と同じ値を入れる。 */
type Place = (paths: { root: string; home: string }) => {
  run: string;
  cwd: string;
  env?: Record<string, string>;
};

/** 構成を作ってスクリプトを起動し、runtime dir の実際のパスと結果を返す。 */
function runPlace(args: string[], place: Place, options: SandboxOptions = {}) {
  let run = "";
  const result = sandbox(args, {
    ...options,
    setup: (paths) => {
      const placed = place(paths);
      run = placed.run;
      return { env: { XDG_RUNTIME_DIR: run, PWD: placed.cwd, ...placed.env }, cwd: placed.cwd };
    },
  });
  return { ...result, run };
}

/** /tmp の外の実在しないパス。$HOME をここに置くと、$HOME の下の宛先が /tmp の下に入らない。 */
const homeOutsideTmp = "/nonexistent-eval-sandbox-home";

describe("runtime dir が先に置いたマウントの宛先か cwd を覆う構成", () => {
  // 各行は、runtime dir と cwd を決め、止まるときの理由を返す。
  // message は、止めた理由の文字列か、宛先のパスのうちテストごとに変わる部分を含む正規表現。
  const covering: {
    label: string;
    place: Place;
    message: string | RegExp;
    options?: SandboxOptions;
  }[] = [
    {
      label: "$HOME と同じとき",
      place: ({ home }) => ({ run: home, cwd: "/" }),
      message: "(the runtime dir) holds the mount target",
    },
    {
      label: "$HOME を含むとき",
      place: ({ root }) => ({ run: root, cwd: "/" }),
      message: "(the runtime dir) holds the mount target",
    },
    // 「/」は、末尾の / を外して比べないと、どの場所も含まないと判定される。
    {
      label: "/ であるとき",
      place: () => ({ run: "/", cwd: "/" }),
      message: "(the runtime dir) holds the disposable project /",
    },
    {
      label: "/tmp の下で bind する cwd を含むとき",
      place: ({ root }) => {
        mkdirSync(join(root, "work", "project"), { recursive: true });
        return { run: join(root, "work"), cwd: join(root, "work", "project") };
      },
      message: "(the runtime dir) holds the disposable project",
    },
    {
      label: "/tmp の下で bind する cwd と同じとき",
      place: ({ root }) => {
        mkdirSync(join(root, "work"), { recursive: true });
        return { run: join(root, "work"), cwd: join(root, "work") };
      },
      message: "(the runtime dir) holds the disposable project",
    },
    {
      label: "/tmp の外で bind しない cwd と同じとき",
      place: () => ({ run: "/usr/share", cwd: "/usr/share" }),
      message: "(the runtime dir) holds the disposable project /usr/share",
    },
    {
      label: "/tmp であり、/tmp の下に /etc のミラーがあるとき",
      place: () => ({ run: "/tmp", cwd: "/", env: { HOME: homeOutsideTmp } }),
      message: "(the runtime dir) holds the mount target /tmp/eval-sandbox-host-etc-",
    },
    {
      label: "$HOME の外の CODEX_HOME を含むとき",
      place: ({ root }) => {
        const run = join(root, "run");
        mkdirSync(join(run, "codex"), { recursive: true });
        writeFileSync(join(run, "codex", "auth.json"), "{}\n");
        return { run, cwd: "/", env: { CODEX_HOME: join(run, "codex") } };
      },
      message: /\(the runtime dir\) holds the mount target \S+\/codex\/auth\.json \(/u,
      options: { cli: "codex" },
    },
    {
      label: "リンクを通した cwd の実体を含むとき",
      place: ({ root }) => {
        mkdirSync(join(root, "work", "project"), { recursive: true });
        symlinkSync(join(root, "work", "project"), join(root, "link"));
        return { run: join(root, "work"), cwd: join(root, "link") };
      },
      message: "(the runtime dir) holds the disposable project",
    },
    {
      label: "外を指す cwd のリンクを含むとき",
      place: ({ root, home }) => {
        mkdirSync(join(home, "proj"), { recursive: true });
        mkdirSync(join(root, "work"), { recursive: true });
        symlinkSync(join(home, "proj"), join(root, "work", "link"));
        return { run: join(root, "work"), cwd: join(root, "work", "link") };
      },
      message: "(the runtime dir) holds the disposable project",
    },
    {
      label: "リンクで、cwd を含むとき",
      place: ({ root }) => {
        mkdirSync(join(root, "work", "project"), { recursive: true });
        symlinkSync(join(root, "work"), join(root, "runlink"));
        return { run: join(root, "runlink"), cwd: join(root, "work", "project") };
      },
      message: "(the runtime dir) holds the disposable project",
    },
  ];

  test.each(modes.flatMap(({ mode, args }) => covering.map((row) => ({ mode, args, ...row }))))(
    "$mode: runtime dir が $label、bwrap を起動する前に理由を出して exit 3 で止める",
    ({ args, place, message, options }) => {
      const { result, bwrapArgs } = runPlace(args, place, options);
      expect(result.status, result.stderr).toBe(3);
      expect(result.stderr).toMatch(message);
      expect(bwrapArgs).toBeNull();
    },
  );

  // 止めずに起動する構成。runtime dir の判定に達して一覧に入れたことを、tmpfs で隠す引数で確かめる。
  const passing: { label: string; place: Place }[] = [
    {
      label: "$HOME の下にあるとき",
      place: ({ root, home }) => {
        mkdirSync(join(home, ".run"), { recursive: true });
        return { run: join(home, ".run"), cwd: root };
      },
    },
    {
      label: "名前が $HOME の前方だけ一致する場所にあるとき",
      place: ({ root }) => {
        mkdirSync(join(root, "hom"), { recursive: true });
        return { run: join(root, "hom"), cwd: root };
      },
    },
    {
      label: "$HOME の隣にあるとき",
      place: ({ root }) => {
        mkdirSync(join(root, "run"), { recursive: true });
        return { run: join(root, "run"), cwd: root };
      },
    },
    {
      label: "bind の宛先の中にあるとき",
      // ~/.local/bin は許可リストにあり、在れば読み取り専用で戻す。runtime dir はその中の 1 つのディレクトリだけを覆う。
      place: ({ root, home }) => {
        mkdirSync(join(home, ".local", "bin", "run"), { recursive: true });
        return { run: join(home, ".local", "bin", "run"), cwd: root };
      },
    },
  ];

  test.each(modes.flatMap(({ mode, args }) => passing.map((row) => ({ mode, args, ...row }))))(
    "$mode: runtime dir が $label、止めずに tmpfs で隠す",
    ({ args, place }) => {
      const { result, bwrapArgs, run } = runPlace(args, place);
      expect(result.status, result.stderr).toBe(0);
      if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
      const real = realpathSync(run);
      const tmpfs = flagValues(bwrapArgs, "--tmpfs").filter((target) => target === real);
      // スタブの bwrap は呼び出しごとに引数を追記する（--verify は 2 回呼ぶ）。呼び出しは --die-with-parent で数える。
      const calls = bwrapArgs.filter((arg) => arg === "--die-with-parent").length;
      expect(tmpfs).toHaveLength(calls);
    },
  );

  // ネットワークの許可リストを外すと /etc のミラーを作らず、cwd も /tmp の外なので、CLI の起動では
  // /tmp の下に宛先が無い。--verify は stage 5 の一覧を /tmp に作って bind するので、それが宛先になる。
  const tmpWithoutTargets: Place = () => ({
    run: "/tmp",
    cwd: "/",
    env: { HOME: homeOutsideTmp, EVAL_SANDBOX_NET: "off" },
  });

  test("CLI の起動: runtime dir が /tmp であり、/tmp の下に宛先が無いとき、止めずに tmpfs で隠す", () => {
    const { result, bwrapArgs } = runPlace(["--version"], tmpWithoutTargets);
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    // /tmp の tmpfs は、兄弟の run を隠すものと runtime dir のものの 2 つになる。
    expect(flagValues(bwrapArgs, "--tmpfs").filter((target) => target === "/tmp")).toHaveLength(2);
  });

  test("--verify: runtime dir が /tmp なら、stage 5 の一覧を /tmp に bind するので、bwrap を起動する前に止める", () => {
    const { result, bwrapArgs } = runPlace(["--verify", "MARKER"], tmpWithoutTargets);
    expect(result.status, result.stderr).toBe(3);
    expect(result.stderr).toContain(
      "(the runtime dir) holds the mount target /tmp/eval-sandbox-home-lists-",
    );
    expect(bwrapArgs).toBeNull();
  });

  test.each(modes)(
    "$mode: cwd が /tmp の下のリンクでホームディレクトリの下を指すときは、止めずに起動する",
    ({ mode, args }) => {
      let cwd = "";
      const { result, bwrapArgs, run } = runPlace(args, ({ root, home }) => {
        mkdirSync(join(home, "proj"), { recursive: true });
        mkdirSync(join(root, "run"), { recursive: true });
        cwd = join(root, "link");
        symlinkSync(join(home, "proj"), cwd);
        return { run: join(root, "run"), cwd };
      });
      expect(result.status, result.stderr).toBe(0);
      if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
      // runtime dir を作っておき、cwd と比べたうえで tmpfs で隠したことを確かめる。
      expect(flagValues(bwrapArgs, "--tmpfs")).toContain(realpathSync(run));
      // /tmp の下の cwd は、リンクのままのパスで /tmp の tmpfs の上に戻す。
      expect(flagValues(bwrapArgs, "--bind")).toContain(cwd);
      if (mode === "CLI の起動") {
        expect(bwrapArgs[bwrapArgs.lastIndexOf("--chdir") + 1]).toBe(cwd);
      }
    },
  );
});

describe("git worktree list の失敗", () => {
  test.each(modes)(
    "$mode: git worktree list が 0 以外で終わるなら、bwrap を起動する前に理由を出して exit 3 で止める",
    ({ args }) => {
      const { result, bwrapArgs } = sandbox(args, { gitFails: true });
      expect(result.status, result.stderr).toBe(3);
      expect(result.stderr).toMatch(/git worktree list failed in .* \(exit 128\)/u);
      // git が出した理由も stderr に残す。
      expect(result.stderr).toContain("detected dubious ownership");
      expect(bwrapArgs).toBeNull();
    },
  );

  test("git worktree list が成功すれば、止めずに起動する", () => {
    const { result, bwrapArgs } = sandbox(["--version"]);
    expect(result.status, result.stderr).toBe(0);
    expect(bwrapArgs).not.toBeNull();
  });
});
