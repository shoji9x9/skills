#!/usr/bin/env node
// 変異実証（mutation proof）を再実行可能な形で検査する。
//
// 検査の強度を「変異を当てたら赤くなった」で示す実証は、テストファイル冒頭の散文コメントに
// 書くと腐る。当時の主張が残るだけで、テストを直した瞬間に検証されなくなる
// （実際に「行単位の検査で分岐に混ざった変異を見逃す」「変異が当たっておらず偽の生存を
// 実証と読みかける」「テスト書き換え後に取り直さず記録だけ残る」の 3 通りで踏んだ。Issue #420）。
//
// そこで変異を `<テスト名>.mutations.json` のデータとして持ち、このスクリプトが
// 各変異について次の**両方**を確かめる。
//
//   1. 置換が実際に当たったこと（対象ファイル内の出現数が宣言どおりで、内容が変わったこと）
//   2. 宣言した assertion（テスト名）が**それだけ**落ちたこと
//
// 当たらなかった変異は成功に倒さず FAIL にする（偽の生存を潰す）。合否は終了コードではなく
// 「対象テストが走り、狙ったテストが落ちたこと」で判定する
// （`.agents/rules/state-space-and-mutation-proof.md`）。
//
// 使い方:
//   node scripts/check-mutation-proof.js                    # scripts/*.mutations.json を全部
//   node scripts/check-mutation-proof.js <spec.json> ...     # 指定したものだけ
//   node scripts/check-mutation-proof.js --only A,B          # id で絞る（開発中の 1 本だけ回す）
//
// 終了コード: 0 = 全変異が実証できた / 1 = 実証できない変異がある / 2 = 使い方・宣言・前提の誤り
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_DIR = "scripts";
const SPEC_SUFFIX = ".mutations.json";

function die(message) {
  console.error(`mutation-proof: ${message}`);
  process.exit(2);
}

// **この検査は作業ツリーを書き換えて戻す。** 並行して走らせる（別の mutation-proof、
// 同時に走るテスト）と、相手が変異を当てている最中のファイルを読んで**無関係な赤**が出る
// （実測: 並行実行中に集計器のテストが 1 本落ちた）。単一実行をロックで担保する。
// キーは repoRoot **全体**のハッシュ。末尾だけを見ると、worktree を並べる運用で末尾が同じパス
// （`wt-issue-420-benchmark-scripts` / `wt-issue-421-benchmark-scripts`）が同じロックを取り合う。
const lockPath =
  process.env.MUTATION_PROOF_LOCK ??
  join(
    tmpdir(),
    `mutation-proof-${createHash("sha256").update(repoRoot).digest("hex").slice(0, 32)}.lock`,
  );
let lockHeld = false;

function takeLock() {
  // **pid を書き終えてから公開する。** `openSync(wx)` → `writeFileSync` の 2 段だと、
  // 作成直後の窓ではロックが**空**で、そこに入った 2 本目が「pid が読めない＝残骸」と判定して
  // 生きている持ち主のロックを奪える（`Number("")` は NaN ではなく 0 なので `pid > 0` が false）。
  // 一時ファイルへ pid を書いてから `linkSync` で公開すると、公開されたロックは常に pid を持つ。
  const staging = `${lockPath}.${process.pid}.staging`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(staging, `${process.pid}\n`);
      linkSync(staging, lockPath); // 既にあれば EEXIST（アトミック）
      unlinkSync(staging);
      lockHeld = true;
      return;
    } catch (err) {
      try {
        unlinkSync(staging);
      } catch {
        /* 作れていなければ消すものが無い */
      }
      if (err.code !== "EEXIST") die(`ロックを作れない（${lockPath}）: ${err.message}`);
      // **読み取りも失敗しうる。** EEXIST を受けてから持ち主が `releaseLock()` で unlink する窓に
      // 入ると ENOENT を投げ、`catch` の中なので誰も受けず未処理例外になる（終了コード 1 は
      // 「実証できない変異がある」の意味なので、一過性の競合が実証の失敗に化ける）。
      // 読めなかったロックは残骸として扱い、次の試行へ落とす。
      let pid = NaN;
      try {
        pid = Number(readFileSync(lockPath, "utf8").trim());
      } catch (readErr) {
        if (readErr.code !== "ENOENT") {
          die(`ロック（${lockPath}）を読めない: ${readErr.message}`);
        }
      }
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) {
        die(
          `別の実行（pid ${pid}）が作業ツリーへ変異を当てている最中。` +
            `終わるまで待つ（この検査は同時に走らせられない）。ロック: ${lockPath}`,
        );
      }
      // 生きていないプロセスのロックは残骸。奪って続ける（2 度目の EEXIST は競合なので落とす）。
      try {
        unlinkSync(lockPath);
      } catch {
        /* 別の実行が同時に奪った場合は次の試行で EEXIST になる */
      }
    }
  }
  die(`ロックの取得が競合した（${lockPath}）。時間を置いて再実行する`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function releaseLock() {
  if (!lockHeld) return;
  lockHeld = false;
  try {
    unlinkSync(lockPath);
  } catch {
    /* すでに消えていれば何もしない */
  }
}

// 実行中に作った一時ディレクトリ。`die()`（`process.exit`）は finally を飛ばすので、
// exit ハンドラからも片付ける。
const tempDirs = new Set();

// 変異を当てている最中のファイル。中断（Ctrl-C・SIGTERM）でも必ず戻す
// ——戻せないまま終わると、変異したワークフローやスクリプトが作業ツリーに残る。
let pending = null;

function cleanupTempDirs() {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 消せなければ諦める（一時ディレクトリなので害は蓄積だけ） */
    }
  }
  tempDirs.clear();
}

function restorePending() {
  if (!pending) return;
  const { path, content } = pending;
  pending = null;
  try {
    writeFileSync(path, content);
  } catch (err) {
    console.error(`mutation-proof: ${path} を復元できなかった（手で戻す）: ${err.message}`);
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    restorePending();
    cleanupTempDirs();
    releaseLock();
    console.error(`mutation-proof: ${signal} で中断した（変異は戻した）`);
    process.exit(130);
  });
}
process.on("exit", () => {
  restorePending();
  cleanupTempDirs();
  releaseLock();
});

/** `--only` を除いた位置引数と id フィルタを返す。 */
function parseArgs(argv) {
  const files = [];
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") {
      const value = argv[++i];
      if (!value) die("--only に値がない");
      only = new Set(value.split(",").filter(Boolean));
      if (only.size === 0) die("--only の値が空");
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/check-mutation-proof.js [<spec.json>...] [--only <id,...>]");
      process.exit(0);
    } else if (arg.startsWith("-")) {
      die(`不明な引数: ${arg}`);
    } else {
      files.push(arg);
    }
  }
  return { files, only };
}

/** 宣言ファイルの一覧。**0 件は成功に倒さない**（検査が空振りしただけの緑を根拠にしない）。 */
function specPaths(files) {
  const found = files.length
    ? files.map((f) => (isAbsolute(f) ? f : resolve(repoRoot, f)))
    : readdirSync(join(repoRoot, SPEC_DIR))
        .filter((name) => name.endsWith(SPEC_SUFFIX))
        .sort()
        .map((name) => join(repoRoot, SPEC_DIR, name));
  if (found.length === 0) die(`${SPEC_DIR}/*${SPEC_SUFFIX} が 1 件も無い`);
  for (const p of found) {
    if (!existsSync(p)) die(`宣言ファイルが無い: ${p}`);
  }
  return found;
}

function asString(value, label) {
  if (typeof value !== "string" || value.length === 0) die(`${label} が非空の文字列でない`);
  return value;
}

/** 宣言を読んで形を検証する（実行前に落とす。走らせてから気づくと部分適用が残る）。 */
function loadSpec(specPath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(specPath, "utf8"));
  } catch (err) {
    die(`${specPath} を読めない: ${err.message}`);
  }
  // 壊れた宣言は「実証できない変異がある」（exit 1）ではなく前提の誤り（exit 2）。
  // 素通りさせると後続の参照が TypeError になり、CI では本物の実証失敗と同じ赤に見える。
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    die(`${specPath} が JSON オブジェクトでない（${Array.isArray(raw) ? "配列" : String(raw)}）`);
  }
  const testFile = asString(raw.test_file, `${specPath}: test_file`);
  const testPath = resolve(repoRoot, testFile);
  if (!existsSync(testPath)) die(`${specPath}: test_file が実在しない: ${testPath}`);
  if (!Array.isArray(raw.mutations) || raw.mutations.length === 0) {
    die(`${specPath}: mutations が空`);
  }
  const ids = new Set();
  const mutations = raw.mutations.map((m, i) => {
    const at = `${specPath}: mutations[${i}]`;
    const id = asString(m.id, `${at}.id`);
    if (ids.has(id)) die(`${at}.id が重複: ${id}`);
    ids.add(id);
    asString(m.why, `${at}(${id}).why`);
    const file = asString(m.file, `${at}(${id}).file`);
    const target = resolve(repoRoot, file);
    if (!target.startsWith(repoRoot + "/")) die(`${at}(${id}).file がリポジトリ外: ${target}`);
    if (!existsSync(target)) die(`${at}(${id}).file が実在しない: ${target}`);
    const find = asString(m.find, `${at}(${id}).find`);
    // 変異は「変えた」ことが前提。同一文字列だと何も変わらないまま緑になる。
    if (typeof m.replace !== "string") die(`${at}(${id}).replace が文字列でない`);
    if (m.replace === find) die(`${at}(${id}) の find と replace が同じ`);
    const occurrences = m.occurrences ?? 1;
    if (!Number.isInteger(occurrences) || occurrences < 1) {
      die(`${at}(${id}).occurrences が 1 以上の整数でない`);
    }
    if (!Array.isArray(m.expect_failing) || m.expect_failing.length === 0) {
      die(`${at}(${id}).expect_failing が空`);
    }
    const expect = m.expect_failing.map((name, j) =>
      asString(name, `${at}(${id}).expect_failing[${j}]`),
    );
    if (new Set(expect).size !== expect.length) die(`${at}(${id}).expect_failing が重複`);
    return { id, why: m.why, file, target, find, replace: m.replace, occurrences, expect };
  });
  return { specPath, testFile, testPath, mutations };
}

/**
 * テストファイルを 1 回走らせ、テスト名 → 状態のマップを返す。
 * **終了コードでは判定しない**——走らなかった（収集で落ちた）のか、狙ったテストが落ちたのかを
 * 区別できないため、JSON レポータの結果から名前で読む。
 */
function runTests(testFile) {
  // **`die()` は `process.exit` なので finally を飛ばす。** 変異の復元と同じく exit ハンドラで
  // 二重化して、起動失敗・重複検出で落ちたときに一時ディレクトリを残さない。
  const dir = mkdtempSync(join(tmpdir(), "mutation-proof-"));
  tempDirs.add(dir);
  const outFile = join(dir, "result.json");
  try {
    const res = spawnSync(
      "pnpm",
      ["exec", "vitest", "run", testFile, "--reporter=json", `--outputFile=${outFile}`],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // 子 vitest に、使用中の fixture を掃かせない（`scripts/vitest-global-setup.js`）。
        env: { ...process.env, MUTATION_PROOF_CHILD: "1" },
      },
    );
    // **起動できなかったのは「実証の失敗」ではない。** spawn 自体が失敗すると理由は
    // `res.error` にだけ入り stdout/stderr は null なので、そのままだと理由なしの FAIL
    // （exit 1 =「実証できない変異がある」）に化ける。前提の誤りとして exit 2 に倒す。
    if (res.error) {
      die(`vitest を起動できない: ${res.error.message}`);
    }
    if (!existsSync(outFile)) {
      return {
        ran: false,
        reason: `vitest が結果を出さなかった: ${tail(res.stderr || res.stdout)}`,
      };
    }
    let report;
    try {
      report = JSON.parse(readFileSync(outFile, "utf8"));
    } catch (err) {
      return { ran: false, reason: `vitest の結果を読めない: ${err.message}` };
    }
    const results = new Map();
    const duplicated = [];
    for (const file of report.testResults ?? []) {
      for (const a of file.assertionResults ?? []) {
        // **名前をキーにする設計なので、名前の一意性が前提。** 同名（`test.each` の展開が
        // 同じ文字列になる等）があると後の状態が前を上書きし、「1 件目だけ落ちた」変異が
        // 「落ちなかった」に化ける（逆向きなら効いていない assertion が PASS になる）。
        if (results.has(a.fullName)) duplicated.push(a.fullName);
        results.set(a.fullName, a.status);
      }
    }
    if (duplicated.length > 0) {
      die(
        `テスト名が重複している（名前で合否を判定できない）: ${[...new Set(duplicated)].join(" / ")}`,
      );
    }
    if (results.size === 0) {
      return {
        ran: false,
        reason: `テストが 1 件も走らなかった: ${tail(res.stderr || res.stdout)}`,
      };
    }
    const failed = new Set([...results].filter(([, s]) => s === "failed").map(([n]) => n));
    return { ran: true, results, failed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    tempDirs.delete(dir);
  }
}

function tail(text, lines = 8) {
  return (text ?? "").trimEnd().split("\n").slice(-lines).join("\n");
}

function sorted(values) {
  return [...values].sort();
}

/** 変異を当てて走らせ、元に戻す。戻し漏れを残さないため復元まで必ず通る。 */
function proveMutation(mutation, testFile) {
  const original = readFileSync(mutation.target, "utf8");
  const hits = original.split(mutation.find).length - 1;
  if (hits !== mutation.occurrences) {
    // **当たらなかった変異を成功に倒さない。** 偽の生存（効いていない assertion を効いていると
    // 読む）は、この検査が防ごうとしている失敗そのもの。
    return {
      ok: false,
      reason: `置換が当たらない: ${mutation.file} 内の find の出現数が ${hits} 件（宣言は ${mutation.occurrences} 件）`,
    };
  }
  const mutated = original.split(mutation.find).join(mutation.replace);
  if (mutated === original) {
    return { ok: false, reason: `置換しても内容が変わらない: ${mutation.file}` };
  }
  let run;
  try {
    pending = { path: mutation.target, content: original };
    writeFileSync(mutation.target, mutated);
    run = runTests(testFile);
  } finally {
    writeFileSync(mutation.target, original);
    pending = null;
    // 復元を実測する（ここが崩れると、以降の変異も本来の版で測れていない）。
    const restored = readFileSync(mutation.target, "utf8");
    if (restored !== original) {
      console.error(`mutation-proof: ${mutation.target} を復元できなかった。手で戻す`);
      process.exit(2);
    }
  }
  if (!run.ran) return { ok: false, reason: run.reason };
  const expected = new Set(mutation.expect);
  const missing = sorted([...expected].filter((n) => !run.failed.has(n)));
  const extra = sorted([...run.failed].filter((n) => !expected.has(n)));
  if (missing.length || extra.length) {
    const parts = [];
    // 落ちなかった = その assertion はこの変異を検出できていない。
    if (missing.length) parts.push(`落ちなかった: ${missing.join(" / ")}`);
    // 余分に落ちた = 変異が想定より広い（または assertion の帰属が宣言とずれている）。
    if (extra.length) parts.push(`宣言外で落ちた: ${extra.join(" / ")}`);
    return { ok: false, reason: parts.join("、") };
  }
  return { ok: true, failed: sorted(run.failed) };
}

function main() {
  const { files, only } = parseArgs(process.argv.slice(2));
  // 宣言の検証より先にロックを取る（並行実行が互いのファイルを読むのを防ぐ）。
  takeLock();
  const specs = specPaths(files).map(loadSpec);
  let proven = 0;
  let failures = 0;

  // `--only` は**宣言をまたいで** id で絞る指定。選ばれなかった宣言は飛ばす
  // ——宣言ごとに「1 件も選ばれなかった」で落とすと、宣言が 2 件以上ある時点で
  // `--only <id>` が常に exit 2 になる（実測。宣言は今 3 件ある）。
  const plans = specs.map((spec) => ({
    spec,
    targeted: spec.mutations.filter((m) => !only || only.has(m.id)),
  }));
  const skipped = plans.reduce((n, p) => n + (p.spec.mutations.length - p.targeted.length), 0);
  if (only) {
    // **どの宣言にも無い id は走らせる前に落とす。** typo を黙って無視すると、
    // 実証していない変異を「実証済み」と読む（0 件を成功に倒さないのと同じ理由）。
    const selected = new Set(plans.flatMap((p) => p.targeted.map((m) => m.id)));
    const unmatched = sorted([...only].filter((id) => !selected.has(id)));
    if (unmatched.length) die(`--only で 1 件も選ばれなかった: ${unmatched.join(" / ")}`);
  }

  for (const { spec, targeted } of plans) {
    if (targeted.length === 0) continue;
    console.log(`\n=== ${relative(repoRoot, spec.specPath)} → ${spec.testFile}`);

    // **基準は先に測る。** 変異前が緑でなければ、落ちた原因を変異に帰属できない。
    const baseline = runTests(spec.testFile);
    if (!baseline.ran) die(`基準 run が走らなかった: ${baseline.reason}`);
    if (baseline.failed.size > 0) {
      die(`基準 run が緑でない（先に直す）: ${sorted(baseline.failed).join(" / ")}`);
    }
    console.log(`baseline: ${baseline.results.size} tests passed`);

    // 宣言したテスト名が実在すること。**名前が腐っていたら実証にならない**——テストを
    // リネームすると `expect_failing` は永遠に落ちない名前を指し、この検査が空振りする。
    for (const m of targeted) {
      const unknown = m.expect.filter((name) => !baseline.results.has(name));
      if (unknown.length) {
        die(`${m.id}: expect_failing に実在しないテスト名がある: ${unknown.join(" / ")}`);
      }
    }

    for (const m of targeted) {
      const res = proveMutation(m, spec.testFile);
      if (res.ok) {
        proven++;
        console.log(`PASS ${m.id}: ${m.why}`);
        console.log(`     → 落ちた: ${res.failed.join(" / ")}`);
      } else {
        failures++;
        console.log(`FAIL ${m.id}: ${m.why}`);
        console.log(`     → ${res.reason}`);
      }
    }
  }

  console.log(
    `\nmutation-proof: ${proven} proven / ${failures} failed` +
      (skipped ? ` / ${skipped} skipped（--only）` : ""),
  );
  if (failures > 0) process.exit(1);
  if (proven === 0) die("実証できた変異が 0 件（対象 0 件を成功に倒さない）");
}

main();
