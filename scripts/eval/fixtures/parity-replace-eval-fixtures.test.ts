// parity-replace の eval 6・29 の fixture の setup.sh が作る初期状態を確かめる。
// 2 つの eval は、記録（.replace/）と新側（new-app）を同じ git のリポジトリに置き、記録の commit で HEAD が進んだ状態を前提にする。
// LLM の run より前に、作られる状態（作業ツリー・記録の値・commit の中身）を決定論的に確かめる。

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repository = resolve(import.meta.dirname, "..", "..", "..");
const fixturesRoot = join(repository, "evals", "parity-replace", "fixtures");
const sourceVersion = join(repository, "skills", "parity-replace", "scripts", "source-version.mjs");
const RECORD = ".replace/parity/order-list/new/local-dev/replace-metadata.json";

function run(cwd: string, file: string, ...args: string[]): string {
  return execFileSync(file, args, {
    cwd,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
    stdio: "pipe",
  });
}

test.each([
  ["lightweight-deploy-target", false],
  ["records-committed-same-repo", false],
  // eval 29 の setup.sh は、作業ディレクトリが既に git のリポジトリの最上位なら git init しない
  ["records-committed-same-repo", true],
] as const)(
  "%s の setup.sh は、記録の commit で HEAD が進み new.tree が同じ、clean な状態を作り、自身を消す（先に git init 済み: %s）",
  (name, preInit) => {
    const dir = makeTempDir(`parity-replace-${name}-`);
    cpSync(join(fixturesRoot, name), dir, { recursive: true });
    if (preInit) run(dir, "git", "init", "-q", "-b", "main");
    run(dir, "./setup.sh");
    // 被験体が手順を読めないよう、setup.sh は残らない
    expect(existsSync(join(dir, "setup.sh"))).toBe(false);
    expect(run(dir, "git", "status", "--porcelain", "--untracked-files=all")).toBe("");
    const record = parseJsonAs<{ new: { commit: string; tree: string } }>(
      readFileSync(join(dir, RECORD), "utf8"),
    );
    // 記録の new.commit は HEAD の 1 つ前で、HEAD との差分は記録のファイルだけである
    expect(record.new.commit).toBe(run(dir, "git", "rev-parse", "HEAD~1").trim());
    const changed = run(dir, "git", "diff", "--name-only", "HEAD~1", "HEAD").trim().split("\n");
    expect(changed).toContain(RECORD);
    expect(changed.every((f) => f.startsWith(".replace/"))).toBe(true);
    // 記録の new.tree は、source-version.mjs が今の新側から取る tree と同じである
    const now = parseJsonAs<{ tree: string; dirty: boolean }>(
      run(dir, process.execPath, sourceVersion, "--repo", "./new-app"),
    );
    expect(now).toMatchObject({ tree: record.new.tree, dirty: false });
  },
);
