// eval-sandbox.sh が bwrap を起動する前に止める構成のテスト（Issue #1015）。
//
// runtime dir の tmpfs は、$HOME の tmpfs と /etc の bind より後に置く。そのため、runtime dir が
// $HOME・使い捨てのプロジェクト・/tmp を含むと、tmpfs がその中の bind（認証情報・settings.json・
// /etc のミラー）を覆い、run が起動しないか CLI の認証が失敗する。
// git worktree list が失敗すると、ほかの work tree の親を隠せず、without_skill の run がメインの
// チェックアウトを読める。どちらも、bwrap を起動する前に理由を出して exit 3 で止める。
// bwrap と git はスタブにする（eval-sandbox-helpers.ts）。
//
// | 軸                       | 値                                                                     |
// | ------------------------ | ---------------------------------------------------------------------- |
// | runtime dir と $HOME     | 同じ / $HOME を含む / 「/」 / $HOME の下（通す） / 名前が $HOME の前方だけ一致（通す） / 隣（通す） |
// | runtime dir と cwd       | 使い捨てのプロジェクトを含む / 含まない（通す）                        |
// | runtime dir と /tmp      | /tmp そのもの / /tmp の下（通す。「$HOME の隣」の行が、os.tmpdir() が /tmp の環境でだけ確かめる） |
// | git worktree list        | 成功する（通す） / 0 以外で終わる                                      |
// | モード                   | CLI の起動 / --verify                                                  |
//
// sandbox() の一時ディレクトリが runtime dir（/run/user/<uid> か XDG_RUNTIME_DIR）の下にある環境では、
// スクリプトは使い捨ての $HOME を含む runtime dir として止まる。テストは、os.tmpdir() をその外に置いて実行する。
//
// cwd は、add_root と同じく ${PWD} のまま比べる。シンボリックリンクを通して runtime dir の中を指す cwd は
// 止まらない。この形の扱いは Issue #1015 に無いので決めておらず、下のテストは今の振る舞いを再現する。
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { flagValues, sandbox } from "./eval-sandbox-helpers.ts";

const modes: { mode: string; args: string[] }[] = [
  { mode: "CLI の起動", args: ["--version"] },
  { mode: "--verify", args: ["--verify", "MARKER"] },
];

/** runtime dir と、cwd と、必要なら $HOME を決める。 */
type Place = (root: string) => { run: string; cwd: string; home?: string };

describe("runtime dir が先に置いたマウント先を含む構成", () => {
  // 各行は、runtime dir と $HOME と cwd を決め、止まるときの理由を返す。
  // ほかの行の理由で止まらないよう、ほかの場所は runtime dir の外に置く。
  const holding: { label: string; place: Place; message: string }[] = [
    {
      label: "$HOME と同じとき",
      place: (root) => ({ run: join(root, "home"), cwd: "/" }),
      message: "(the runtime dir) holds $HOME",
    },
    {
      label: "$HOME を含むとき",
      place: (root) => ({ run: root, cwd: "/" }),
      message: "(the runtime dir) holds $HOME",
    },
    // 「/」は、末尾の / を外して比べないと、どの場所も含まないと判定される。
    {
      label: "/ であるとき",
      place: () => ({ run: "/", cwd: "/" }),
      message: "(the runtime dir) holds $HOME",
    },
    {
      label: "使い捨てのプロジェクトを含むとき",
      place: (root) => {
        const run = join(root, "work");
        mkdirSync(join(run, "project"), { recursive: true });
        return { run, cwd: join(run, "project") };
      },
      message: "(the runtime dir) holds the disposable project",
    },
    {
      label: "/tmp であるとき",
      // $HOME を /tmp の外の実在しないパスにして、$HOME を含むという理由で止まらないようにする。
      place: () => ({ run: "/tmp", cwd: "/", home: "/nonexistent-eval-sandbox-home" }),
      message: "(the runtime dir) holds the /etc mirror and the other mounts under /tmp",
    },
  ];

  test.each(modes.flatMap(({ mode, args }) => holding.map((row) => ({ mode, args, ...row }))))(
    "$mode: runtime dir が $label、bwrap を起動する前に理由を出して exit 3 で止める",
    ({ args, place, message }) => {
      const { result, bwrapArgs } = sandbox(args, {
        setup: ({ root }) => {
          const { run, cwd, home } = place(root);
          return {
            env: { XDG_RUNTIME_DIR: run, ...(home === undefined ? {} : { HOME: home }) },
            cwd,
          };
        },
      });
      expect(result.status, result.stderr).toBe(3);
      expect(result.stderr).toContain(message);
      expect(bwrapArgs).toBeNull();
    },
  );

  test.each([
    ["$HOME の下", (root: string) => join(root, "home", ".run")],
    ["名前が $HOME の前方だけ一致する場所", (root: string) => join(root, "hom")],
    ["$HOME の隣", (root: string) => join(root, "run")],
  ])("runtime dir が %sにあるなら、止めずに tmpfs で隠す", (_label, place) => {
    let run = "";
    const { result, bwrapArgs } = sandbox(["--version"], {
      setup: ({ root }) => {
        run = place(root);
        mkdirSync(run, { recursive: true });
        return { env: { XDG_RUNTIME_DIR: run }, cwd: root };
      },
    });
    expect(result.status, result.stderr).toBe(0);
    if (bwrapArgs === null) throw new Error("bwrap が呼ばれていない");
    expect(flagValues(bwrapArgs, "--tmpfs")).toContain(run);
  });
});

test("シンボリックリンクを通して runtime dir の中を指す cwd は、解決せずに比べるので止まらない", () => {
  let cwd = "";
  const { result } = sandbox(["--version"], {
    setup: ({ root }) => {
      const run = join(root, "work");
      mkdirSync(join(run, "project"), { recursive: true });
      cwd = join(root, "link");
      symlinkSync(join(run, "project"), cwd);
      // bash は、環境の PWD がその cwd を指せば、リンクのまま $PWD にする。
      return { env: { XDG_RUNTIME_DIR: run, PWD: cwd }, cwd };
    },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).not.toContain("(the runtime dir) holds");
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
