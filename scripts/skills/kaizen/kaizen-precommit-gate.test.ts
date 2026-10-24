// kaizen のコミット前のチェック一式（スキャナ・checkpoint 記録・lifecycle 検査）の回帰テスト。
//
// このチェックは、判定できないときは失敗として扱うことが前提である。そのため、「検査していない範囲を処理済みにする」
// 「候補ゼロが常にブロックと判定される」「commit を取りこぼす」は、どれも警告なしに誤った結果になる。LLM eval では
// 実行環境（sed の方言・パーミッション・追記タイミング）を作れないため、ここで決定論的に押さえる。

import { assert, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { makeSharedTempDir } from "../../lib/testing/test-tmpdir.ts";
import { spawnAsync } from "../../lib/spawn-async.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { kaizenEnv, pathWithout, writeKaizenConfig } from "./kaizen-config-env.ts";
import {
  scriptsDir,
  fixturesDir,
  tempDir,
  makeProject,
  type RunOptions,
  runScript,
  runGate,
  cloneScripts,
  scannedPosition,
  FOREIGN_SCAN_OWN,
  FOREIGN_SCAN_FOREIGN,
  setupForeignScan,
} from "./kaizen-precommit-gate-helpers.ts";

describe.concurrent("他セッション分の走査結果の再利用", () => {
  const FOREIGN = FOREIGN_SCAN_FOREIGN;
  const setup = setupForeignScan;

  test.each([["候補あり", "exit 0"]])(
    "%s は入力が変わらなければ走査し直さない",
    async (_label, body) => {
      const { gate, scans, cache } = setup(body);
      const first = await gate();
      expect(first.status, first.stderr).toBe(1);
      expect(scans()).toBe(1);
      expect(existsSync(cache)).toBe(true);

      const second = await gate();
      expect(second.status, second.stderr).toBe(1);
      expect(scans()).toBe(1);
      expect(second.stderr).toMatch(/skipped re-scanning .*unchanged since the last scan/);
      // 省いても他セッションの警告は従来どおり出る。
      expect(second.stderr).toMatch(/他セッションの未抽出センチネルが残っています/);
    },
  );

  // スキャナは一時ファイルの作成・読み取りの失敗といった一過性の理由でも 2 を返す。残すと、持ち主が
  // 戻らないセンチネルを保持期間まで再試行しなくなる（PR #545 のレビュー指摘）。
  test("判定不能はキャッシュに残さず、毎回走査し直す", async () => {
    const { gate, scans, cache } = setup("exit 2");
    await gate();
    expect(existsSync(cache)).toBe(false);
    await gate();
    expect(scans()).toBe(2);
  });

  test("残っていた判定不能のキャッシュも使わない", async () => {
    const { gate, scans, cache } = setup("exit 0");
    await gate();
    const content = readFileSync(cache, "utf8");
    const inconclusive = content.replace(/\n0\n(\d+)\n$/, "\n2\n$1\n");
    expect(inconclusive).not.toBe(content);
    writeFileSync(cache, inconclusive);
    await gate();
    expect(scans()).toBe(2);
  });

  test("transcript が伸びたら走査し直す", async () => {
    const { gate, scans, transcript } = setup("exit 0");
    await gate();
    appendFileSync(transcript, "{}\n");
    await gate();
    expect(scans()).toBe(2);
  });

  test("checkpoint が変わったら走査し直す", async () => {
    const { gate, scans, cwd, transcript } = setup("exit 0");
    await gate();
    writeFileSync(
      join(cwd, ".kaizen", `.extract-checkpoint.${FOREIGN}`),
      `${transcript}\n3\nclaude-code\n1\n`,
    );
    await gate();
    expect(scans()).toBe(2);
  });

  test("スキャナが変わったら走査し直す", async () => {
    const { gate, scans, scripts } = setup("exit 0");
    await gate();
    appendFileSync(join(scripts, "kaizen-candidate-scan.sh"), "# updated\n");
    await gate();
    expect(scans()).toBe(2);
  });

  test.each([
    [
      "見出しが違う",
      (c: string) => c.replace("kaizen-foreign-scan-cache v1", "kaizen-foreign-scan-cache v0"),
    ],
    ["結論が未知の値", (c: string) => c.replace(/\n0\n(\d+)\n$/, "\n7\n$1\n")],
    ["秒数が欠けている", (c: string) => c.replace(/\n(\d+)\n$/, "\n")],
  ])("キャッシュの形が違えば（%s）走査し直す", async (_label, mutate) => {
    const { gate, scans, cache } = setup("exit 0");
    await gate();
    const mutated = mutate(readFileSync(cache, "utf8"));
    expect(mutated).not.toBe(readFileSync(cache, "utf8"));
    writeFileSync(cache, mutated);
    await gate();
    expect(scans()).toBe(2);
  });

  test("保持期間で回収したセンチネルのキャッシュも消す", async () => {
    const { cwd, cache, gate, transcript } = setup("exit 0");
    writeFileSync(
      join(cwd, ".kaizen", `.pending-extract.${FOREIGN}`),
      `2000-01-01T00:00:00Z\n${transcript}\nclaude-code\n${FOREIGN}\n`,
    );
    writeFileSync(cache, "kaizen-foreign-scan-cache v1\n");
    const result = await gate();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(cache)).toBe(false);
  });

  test("kaizen.jsonc の foreign_sentinel_retention_days が never なら、保持期間を過ぎても回収しない", async () => {
    const { cwd, gate, transcript } = setup("exit 0");
    const sentinel = join(cwd, ".kaizen", `.pending-extract.${FOREIGN}`);
    writeFileSync(sentinel, `2000-01-01T00:00:00Z\n${transcript}\nclaude-code\n${FOREIGN}\n`);
    writeKaizenConfig(cwd, '{ "foreign_sentinel_retention_days": "never" }\n');
    const result = await gate();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout + result.stderr).toContain("foreign_sentinel_retention_days が never");
    expect(existsSync(sentinel)).toBe(true);
  });

  // スキーマの上限は、日数を数として読むシェルの桁の上限（6 桁）と同じにする
  test.each([
    [999999, false],
    [1000000, true],
  ])(
    "kaizen.jsonc の foreign_sentinel_retention_days が %i なら、設定の誤りか（%s）",
    async (days, invalid) => {
      const { cwd, gate } = setup("exit 0");
      writeKaizenConfig(cwd, `{ "foreign_sentinel_retention_days": ${days} }\n`);
      const result = await gate();
      const output = result.stdout + result.stderr;
      expect(output).not.toContain("回収しません");
      if (invalid) expect(output).toMatch(/foreign_sentinel_retention_days[\s\S]*999999/);
      else expect(output).not.toMatch(/foreign_sentinel_retention_days[\s\S]*999999/);
    },
  );
});

describe.concurrent("Claude Code の atis-latch 補助レコード", () => {
  test.each([
    ["atis-latch だけなら候補ゼロ", "claude-atis-latch-no-candidate.jsonl", 1],
    ["atis-latch は候補を隠さない", "claude-atis-latch-candidate.jsonl", 0],
    ["type 欠落は判定不能", "unknown.jsonl", 2],
    ["未知の文字列 type は判定不能", "unknown-string-type.jsonl", 2],
    ["不正な JSON は判定不能", "malformed-json.jsonl", 2],
    ["event_msg の subtype 欠落は判定不能", "malformed-event-msg.jsonl", 2],
    ["response_item の未知 subtype は判定不能", "unknown-response-item-subtype.jsonl", 2],
  ])("%s", async (_label, fixture, expectedStatus) => {
    const cwd = makeProject();
    const transcript = join(fixturesDir, fixture);
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, join(cwd, "no-checkpoint")],
      {
        cwd,
      },
    );

    expect(scan.status).toBe(expectedStatus);
  });

  test("atis-latch だけでは commit をブロックしない", async () => {
    const cwd = makeProject();
    const transcript = join(fixturesDir, "claude-atis-latch-no-candidate.jsonl");
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");

    const gate = await runGate("git commit -m x", { cwd, transcriptPath: transcript });

    expect(gate.status).toBe(0);
  });

  test("checkpoint 後の差分が atis-latch だけでも検証済みゼロ", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    const checkpoint = join(cwd, ".kaizen", ".extract-checkpoint");
    const initial = readFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), "utf8");
    writeFileSync(transcript, initial);
    writeFileSync(
      checkpoint,
      `${transcript}\n${Buffer.byteLength(initial)}\nclaude-code\n${initial.split("\n").length - 1}\n`,
    );
    appendFileSync(transcript, '{"type":"atis-latch","atis":{},"sessionId":"test-session"}\n');

    const scan = await runScript("kaizen-candidate-scan.sh", [transcript, checkpoint], { cwd });

    expect(scan.status).toBe(1);
    expect(scan.stdout).toMatch(/^kaizen-candidate-scan: agent=claude-code$/m);
  });
});

// Claude Code の api-request-blob は、API に送ったメッセージのコピー（Issue #710）。
// コピーの中の修正語で候補を出さないことと、コピーがあっても本物の発話の候補は残ることを、対で確かめる。
// 知らない形（hash が無い・message がオブジェクトでない）は、これまでどおり判定できないとして扱う。
// transcript は eval の fixture（candidate-scan）に置かず、ここで組み立てる。eval 15 などは
// candidate-scan の JSONL をすべて入力にするので、ファイルを足すと eval の入力が変わる。
describe.concurrent("Claude Code の api-request-blob レコード", () => {
  const userTask = '{"type":"user","message":{"content":"ドキュメントの表を整えてください"}}';
  const assistantDone =
    '{"type":"assistant","message":{"content":[{"type":"text","text":"整えました"}]}}';
  const userCorrection = '{"type":"user","message":{"content":"違う、やり直してください"}}';
  const blob = (fields: string) =>
    `{"type":"api-request-blob",${fields},"sessionId":"test-session"}`;
  const blobWithCorrectionWord = blob(
    '"hash":"0f3c","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>違う形式の出力は使わず、やり直しの指示に従う</system-reminder>"}]}',
  );
  test.for<[string, string[], number, RegExp | null]>([
    [
      "コピーの中の修正語だけなら候補ゼロ",
      [
        userTask,
        blobWithCorrectionWord,
        '{"type":"api-request","id":"r1","params":{},"sessionId":"test-session"}',
        assistantDone,
      ],
      1,
      null,
    ],
    [
      "コピーは本物の発話の候補を隠さない",
      [
        assistantDone,
        blob(
          '"hash":"7a1e","message":{"role":"user","content":[{"type":"text","text":"違う、やり直してください"}]}',
        ),
        userCorrection,
      ],
      0,
      /^user correction: transcript line 3$/m,
    ],
    [
      // 作業中に送った発話は user レコードにならず、queued_command と blob にだけ残る。
      // blob を読み飛ばしても、queued_command の側で候補になることを確かめる。
      "コピーは作業中に送った発話の候補を隠さない",
      [
        assistantDone,
        blob(
          '"hash":"5c2d","message":{"role":"user","content":[{"type":"text","text":"<system-reminder>違う、やり直してください</system-reminder>"}]}',
        ),
        '{"type":"attachment","attachment":{"type":"queued_command","commandMode":"prompt","origin":{"kind":"human"},"prompt":"違う、やり直してください"}}',
        assistantDone,
      ],
      0,
      /^user correction: transcript line 3$/m,
    ],
    [
      "hash が無いコピーは判定不能",
      [
        userTask,
        blob('"message":{"role":"user","content":[{"type":"text","text":"hash の無いコピー"}]}'),
        assistantDone,
      ],
      2,
      null,
    ],
    [
      "hash が文字列でないコピーは判定不能",
      [
        userTask,
        blob(
          '"hash":0,"message":{"role":"user","content":[{"type":"text","text":"形の違うコピー"}]}',
        ),
        assistantDone,
      ],
      2,
      null,
    ],
    [
      "message が文字列のコピーは判定不能",
      [userTask, blob('"hash":"9b2d","message":"コピーの形が違う"'), assistantDone],
      2,
      null,
    ],
    [
      // hash と message の形が同じでも、型名が違えば読み飛ばさない（型名の条件を固定する）。
      "型名が違う未知のレコードは、hash と message の形が同じでも判定不能",
      [
        userTask,
        '{"type":"future-conversation-record","hash":"5c1d","message":{"role":"user","content":[{"type":"text","text":"未知のレコード"}]},"sessionId":"test-session"}',
        assistantDone,
      ],
      2,
      null,
    ],
  ])("%s", async ([, records, expectedStatus, evidence]) => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    writeFileSync(transcript, `${records.join("\n")}\n`);
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, join(cwd, "no-checkpoint")],
      {
        cwd,
      },
    );

    expect(scan.status).toBe(expectedStatus);
    if (evidence) expect(scan.stdout).toMatch(evidence);
    // コピーは 2 行目に置く。コピーの本文から候補を出していないことを、行番号で確かめる。
    expect(scan.stdout).not.toMatch(/transcript line 2$/m);
  });

  test("checkpoint 後の差分が api-request-blob だけでも検証済みゼロ", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    const checkpoint = join(cwd, ".kaizen", ".extract-checkpoint");
    const initial = readFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), "utf8");
    writeFileSync(transcript, initial);
    writeFileSync(
      checkpoint,
      `${transcript}\n${Buffer.byteLength(initial)}\nclaude-code\n${initial.split("\n").length - 1}\n`,
    );
    appendFileSync(transcript, `${blobWithCorrectionWord}\n`);

    const scan = await runScript("kaizen-candidate-scan.sh", [transcript, checkpoint], { cwd });

    expect(scan.status).toBe(1);
    expect(scan.stdout).toMatch(/^kaizen-candidate-scan: agent=claude-code$/m);
  });

  // api-request-blob を書くのは Claude Code だけなので、checkpoint がエージェントを持たなくても識別できる。
  test("checkpoint が無く差分が api-request-blob だけでも Claude Code と識別する", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    writeFileSync(transcript, `${blobWithCorrectionWord}\n`);

    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, join(cwd, "no-checkpoint")],
      { cwd },
    );

    expect(scan.status).toBe(1);
    expect(scan.stdout).toMatch(/^kaizen-candidate-scan: agent=claude-code$/m);
  });
});

// エージェントの作業中に利用者が送った発話は、`user` レコードにならず `attachment` の `queued_command` に残る（Issue #710）。
// 読み飛ばすのは閉じた集合だけである。注入した本文の `isMeta`、`commandMode` の task-notification、
// `origin.kind` の peer・coordinator・task-notification がこれに当たる。
// 知らない `commandMode` と `origin.kind` は発話として読み、型が違う値は判定不能にすることを、同じ修正語で確かめる。
describe.concurrent("Claude Code の queued_command の attachment", () => {
  const assistantWorking =
    '{"type":"assistant","message":{"content":[{"type":"text","text":"作業しています"}]}}';
  const queued = (fields: string) =>
    `{"type":"attachment","attachment":{"type":"queued_command",${fields},"prompt":"違う、やり直してください"}}`;
  test.each([
    ["人の発話は候補にする", queued('"commandMode":"prompt","origin":{"kind":"human"}'), 0],
    ["origin が無い発話も候補にする", queued('"commandMode":"prompt"'), 0],
    [
      "サブエージェントの報告は候補にしない",
      queued('"commandMode":"prompt","origin":{"kind":"peer"}'),
      1,
    ],
    [
      "注入した本文は候補にしない",
      queued('"commandMode":"prompt","origin":{"kind":"human"},"isMeta":true'),
      1,
    ],
    [
      "レコードの最上位の isMeta も候補にしない",
      `{"type":"attachment","isMeta":true,"attachment":{"type":"queued_command","commandMode":"prompt","origin":{"kind":"human"},"prompt":"違う、やり直してください"}}`,
      1,
    ],
    ["commandMode が無い注入した本文は読み飛ばす", queued('"isMeta":true'), 1],
    ["task-notification は候補にしない", queued('"commandMode":"task-notification"'), 1],
    [
      "知らない commandMode の発話も候補にする",
      queued('"commandMode":"unknown-mode","origin":{"kind":"human"}'),
      0,
    ],
    ["commandMode が無い発話も候補にする", queued('"origin":{"kind":"human"}'), 0],
    [
      "知らない origin.kind の発話も候補にする",
      queued('"commandMode":"prompt","origin":{"kind":"remote"}'),
      0,
    ],
    ["coordinator の本文は候補にしない", queued('"origin":{"kind":"coordinator"}'), 1],
    [
      "origin.kind が task-notification の本文は候補にしない",
      queued('"origin":{"kind":"task-notification"}'),
      1,
    ],
    [
      "prompt が配列の発話も候補にする",
      '{"type":"attachment","attachment":{"type":"queued_command","commandMode":"prompt","origin":{"kind":"human"},"prompt":["違う、やり直してください"]}}',
      0,
    ],
    [
      "prompt が無いものは候補を出さない",
      '{"type":"attachment","attachment":{"type":"queued_command","commandMode":"image","origin":{"kind":"human"},"content":"違う、やり直してください"}}',
      1,
    ],
    [
      "commandMode が prompt でも prompt が無いものは候補を出さない",
      '{"type":"attachment","attachment":{"type":"queued_command","commandMode":"prompt","origin":{"kind":"human"},"content":"違う、やり直してください"}}',
      1,
    ],
    // 読み飛ばす集合に当たるレコードは本文を読まないので、他のフィールドの型が違っても判定不能にしない。
    [
      "task-notification は prompt の型が違っても読み飛ばす",
      '{"type":"attachment","attachment":{"type":"queued_command","commandMode":"task-notification","prompt":{"text":"違う、やり直してください"}}}',
      1,
    ],
    [
      "task-notification は origin がオブジェクトでなくても読み飛ばす",
      queued('"commandMode":"task-notification","origin":"x"'),
      1,
    ],
    [
      "サブエージェントの報告は prompt の型が違っても読み飛ばす",
      '{"type":"attachment","attachment":{"type":"queued_command","commandMode":"prompt","origin":{"kind":"peer"},"prompt":{"text":"違う、やり直してください"}}}',
      1,
    ],
    [
      "注入した本文は origin がオブジェクトでなくても読み飛ばす",
      queued('"commandMode":"prompt","origin":"x","isMeta":true'),
      1,
    ],
    [
      "commandMode が文字列でないものは判定不能",
      queued('"commandMode":1,"origin":{"kind":"human"}'),
      2,
    ],
    [
      "origin.kind が文字列でないものは判定不能",
      queued('"commandMode":"prompt","origin":{"kind":{"name":"peer"}}'),
      2,
    ],
    [
      "prompt が文字列でも配列でもないものは判定不能",
      '{"type":"attachment","attachment":{"type":"queued_command","commandMode":"prompt","origin":{"kind":"human"},"prompt":{"text":"違う、やり直してください"}}}',
      2,
    ],
    [
      // 配列の要素の text がオブジェクトだと、本文を連結するところで jq が実行時のエラーを出す。
      "prompt の要素の text が文字列でないものは判定不能",
      '{"type":"attachment","attachment":{"type":"queued_command","commandMode":"prompt","origin":{"kind":"human"},"prompt":[{"type":"text","text":{"value":"違う、やり直してください"}}]}}',
      2,
    ],
    [
      "isMeta が真偽値でないものは判定不能",
      queued('"commandMode":"prompt","origin":{"kind":"human"},"isMeta":"true"'),
      2,
    ],
    [
      "最上位の isMeta が真偽値でないものは判定不能",
      '{"type":"attachment","isMeta":"true","attachment":{"type":"queued_command","commandMode":"prompt","origin":{"kind":"human"},"prompt":"違う、やり直してください"}}',
      2,
    ],
    [
      "origin がオブジェクトでないものは判定不能",
      queued('"commandMode":"prompt","origin":"human"'),
      2,
    ],
  ])("%s", async (_label, record, expectedStatus) => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    writeFileSync(transcript, `${assistantWorking}\n${record}\n${assistantWorking}\n`);
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, join(cwd, "no-checkpoint")],
      {
        cwd,
      },
    );

    expect(scan.status).toBe(expectedStatus);
    if (expectedStatus === 0) expect(scan.stdout).toMatch(/^user correction: transcript line 2$/m);
  });

  // 型を確かめずに `.type` を参照すると、jq が実行時のエラーを出し、走査は判定不能（exit 2）になる。
  test("attachment がオブジェクトでないものは読み飛ばす（jq のエラーにしない）", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    writeFileSync(transcript, `${assistantWorking}\n{"type":"attachment","attachment":"x"}\n`);
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, join(cwd, "no-checkpoint")],
      {
        cwd,
      },
    );

    expect(scan.status).toBe(1);
  });
});

// jq は途中の行で出た実行時のエラーを終了コードに出さず、その行の残りの出力を捨てて次の行へ進む。
// 判定でエラーになったレコードを、本文を読まないまま検証済みゼロにしないことを、途中の行に置いて確かめる。
describe.concurrent("jq の実行時のエラー", () => {
  const assistantWorking =
    '{"type":"assistant","message":{"content":[{"type":"text","text":"作業しています"}]}}';
  test.each([
    ["オブジェクトでない JSON の行は判定不能", '"違う、やり直してください"'],
    [
      "user レコードの text が文字列でないものは判定不能",
      '{"type":"user","message":{"content":[{"type":"text","text":{"value":"違う、やり直してください"}}]}}',
    ],
  ])("%s", async (_label, record) => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    writeFileSync(transcript, `${assistantWorking}\n${record}\n${assistantWorking}\n`);
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, join(cwd, "no-checkpoint")],
      { cwd },
    );

    expect(scan.status).toBe(2);
    expect(scan.stderr).toMatch(/unsupported or malformed record \(first at transcript line 2\)$/m);
    // jq のエラーの本文はレコードの値を含むので、transcript の本文を 1 文字も出さない。
    expect(scan.stderr).not.toMatch(/違う/);
  });

  // 型の判定で判定不能にしたレコードも、jq のエラーと同じように最初の行の番号を出す。
  test("型の判定で判定不能にしたレコードも、最初の行の番号を出す", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    const record =
      '{"type":"attachment","attachment":{"type":"queued_command","commandMode":"prompt","isMeta":"true","prompt":"違う、やり直してください"}}';
    writeFileSync(transcript, `${assistantWorking}\n${record}\n${assistantWorking}\n`);
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, join(cwd, "no-checkpoint")],
      { cwd },
    );

    expect(scan.status).toBe(2);
    expect(scan.stderr).toMatch(/unsupported or malformed record \(first at transcript line 2\)$/m);
    expect(scan.stderr).not.toMatch(/違う/);
  });
});

// Claude Code はスキルの本文などを `type: "user"`・`isMeta: true` のレコードで注入する。
// 本文の修正語で実在しない user correction を出さないことと、`isMeta` が無い・false の
// 本物の発話は引き続き候補になることを、同じ修正語を持つ fixture の対で確かめる。
describe.concurrent("Claude Code の isMeta の user レコード", () => {
  test.for<[string, string, number, RegExp | null]>([
    ["isMeta の本文の修正語は候補にしない", "claude-meta-correction-word.jsonl", 1, null],
    [
      "isMeta: false の発話の修正語は候補にする",
      "claude-meta-and-user-correction.jsonl",
      0,
      /user correction: transcript line 4$/m,
    ],
  ])("%s", async ([, fixture, expectedStatus, evidence]) => {
    const cwd = makeProject();
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [join(fixturesDir, fixture), join(cwd, "no-checkpoint")],
      { cwd },
    );

    expect(scan.status).toBe(expectedStatus);
    if (evidence) expect(scan.stdout).toMatch(evidence);
    expect(scan.stdout).not.toMatch(/user correction: transcript line 2$/m);
  });
});

// Codex は AGENTS.md・スキルの本文などを `role: "user"` のメッセージで注入する（実際の transcript で 8 種類の形を確かめた）。
// 注入の修正語は候補にせず、注入でない発話は引き続き候補にすることを、同じ修正語を持つ fixture の対で確かめる。
describe.concurrent("Codex の注入された user メッセージ", () => {
  test.for<[string, string, number, RegExp | null]>([
    ["注入の本文の修正語は候補にしない", "codex-injected-correction-word.jsonl", 1, null],
    [
      "注入でない発話の修正語は候補にする",
      "codex-injected-and-user-correction.jsonl",
      0,
      /user correction: transcript line 4$/m,
    ],
  ])("%s", async ([, fixture, expectedStatus, evidence]) => {
    const cwd = makeProject();
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [join(fixturesDir, fixture), join(cwd, "no-checkpoint")],
      { cwd },
    );

    expect(scan.status).toBe(expectedStatus);
    expect(scan.stdout).toMatch(/^kaizen-candidate-scan: agent=codex$/m);
    if (evidence) expect(scan.stdout).toMatch(evidence);
    expect(scan.stdout).not.toMatch(/user correction: transcript line [23]$/m);
  });

  // 閉じた集合の形ごとに、注入として外されることを確かめる（1 つの形を集合から落とすと、その形の行だけが落ちる）。
  // 境界: 同じ語で始まっても注入の形でない発話は、引き続き候補にする。
  const codexTranscript = (cwd: string, text: string) => {
    const path = join(cwd, "codex.jsonl");
    const record = {
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    };
    writeFileSync(
      path,
      `${JSON.stringify({ type: "session_meta", payload: { id: "fixture" } })}\n${JSON.stringify(record)}\n`,
    );
    return path;
  };
  const CORRECTION = "違う場所で動くのではなく、入ることで成り立つ。";
  test.each([
    ["# AGENTS.md instructions for", `# AGENTS.md instructions for /tmp/repo\n${CORRECTION}`],
    ["<skill>", `<skill>\n${CORRECTION}\n</skill>`],
    ["<user_action>", `<user_action>\n${CORRECTION}\n</user_action>`],
    ["<recommended_plugins>", `<recommended_plugins>\n${CORRECTION}\n</recommended_plugins>`],
    ["<turn_aborted>", `<turn_aborted>\n${CORRECTION}\n</turn_aborted>`],
    ["<environment_context>", `<environment_context>\n${CORRECTION}\n</environment_context>`],
    [
      "<codex_internal_context>",
      `<codex_internal_context source="x">${CORRECTION}</codex_internal_context>`,
    ],
    ["<user_shell_command>", `<user_shell_command>\n${CORRECTION}\n</user_shell_command>`],
  ])("注入の形 %s は候補にしない", async (_label, text) => {
    const cwd = makeProject();
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [codexTranscript(cwd, text), join(cwd, "no-checkpoint")],
      { cwd },
    );

    expect(scan.status).toBe(1);
  });

  test.each([
    ["AGENTS.md の見出しで始まる発話", `# AGENTS.md の説明は${CORRECTION}`],
    ["タグ名で始まる語の発話", `<skills> の置き場所は${CORRECTION}`],
    ["行の途中にタグを含む発話", `そうではなく <skill> を${CORRECTION}`],
  ])("注入の形でない発話は候補にする: %s", async (_label, text) => {
    const cwd = makeProject();
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [codexTranscript(cwd, text), join(cwd, "no-checkpoint")],
      { cwd },
    );

    expect(scan.status).toBe(0);
    expect(scan.stdout).toMatch(/user correction: transcript line 2$/m);
  });
});

describe.concurrent("Codex の token usage / review mode 補助レコード", () => {
  test.each([
    ["補助レコードだけなら候補ゼロ", "codex-review-metadata-no-candidate.jsonl", 1],
    ["補助レコードはツール失敗候補を隠さない", "codex-review-metadata-candidate.jsonl", 0],
  ])("%s", async (_label, fixture, expectedStatus) => {
    const cwd = makeProject();
    const transcript = join(fixturesDir, fixture);
    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, join(cwd, "no-checkpoint")],
      {
        cwd,
      },
    );

    expect(scan.status).toBe(expectedStatus);
    expect(scan.stdout).toMatch(/^kaizen-candidate-scan: agent=codex$/m);
  });

  // 補助レコード（token_usage_record・EnteredReviewMode・ExitedReviewMode）を認識する分岐を除く。
  // そのときに上の「補助レコードだけなら候補ゼロ」が落ちることは、mutations.json の SCAN-CODEX-AUX-* が確かめる。
});

describe.concurrent("checkpoint はスキャナが検査した範囲までしか進めない", () => {
  test("走査後に追記されたレコードは処理済みにならず、次の走査で検出される", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");

    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, ".kaizen/.extract-checkpoint"],
      { cwd },
    );
    expect(scan.status).toBe(1); // 検証済みゼロ
    const { bytes, lines } = scannedPosition(scan.stdout);
    assert.exists(bytes, "走査が scanned-bytes を出していない");
    assert.exists(lines, "走査が scanned-lines を出していない");

    // 走査と checkpoint 記録の間に候補（user correction）が追記される。
    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl")));

    const done = await runScript(
      "kaizen-extract-done.sh",
      [
        "--checkpoint-only",
        "--sentinel-suffix",
        "",
        "--agent",
        "claude-code",
        "--scanned-bytes",
        bytes,
        "--scanned-lines",
        lines,
        transcript,
      ],
      { cwd },
    );
    expect(done.status).toBe(0);

    const rescan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, ".kaizen/.extract-checkpoint"],
      { cwd },
    );
    expect(rescan.status).toBe(0); // 追記分が候補として検出される
    // 根拠の行番号は追記後の絶対行（8 行 + 3 行目）を指す。
    expect(rescan.stdout).toMatch(/user correction: transcript line 11$/m);
  });

  // 走査時点で transcript が改行で終わっていない（レコードは書けたが改行が未着）ケース。
  // 走査済み行数を「改行の数」以外の定義で数えると、後から改行だけが届いたときにその行を
  // 二重に数え、以降の根拠行番号が恒久的にずれる。
  test("改行未着のレコードがあっても根拠の行番号がずれない", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    const noCandidate = readFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), "utf8");
    writeFileSync(transcript, noCandidate.replace(/\n$/, "")); // 末尾の改行がまだ届いていない

    const scan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, ".kaizen/.extract-checkpoint"],
      { cwd },
    );
    expect(scan.status).toBe(1);
    const { bytes, lines } = scannedPosition(scan.stdout);
    // 走査は exit 1 で位置を出す。
    assert.exists(bytes, "走査が scanned-bytes を出していない");
    assert.exists(lines, "走査が scanned-lines を出していない");

    const done = await runScript(
      "kaizen-extract-done.sh",
      [
        "--checkpoint-only",
        "--sentinel-suffix",
        "",
        "--agent",
        "claude-code",
        "--scanned-bytes",
        bytes,
        "--scanned-lines",
        lines,
        transcript,
      ],
      { cwd },
    );
    expect(done.status).toBe(0);

    // 遅れて届いた改行と、その後の候補レコード。
    appendFileSync(transcript, "\n");
    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl")));
    const total = readFileSync(transcript, "utf8").split("\n").filter(Boolean).length;
    expect(total).toBe(11);

    const rescan = await runScript(
      "kaizen-candidate-scan.sh",
      [transcript, ".kaizen/.extract-checkpoint"],
      { cwd },
    );
    expect(rescan.status).toBe(0);
    expect(rescan.stdout).toMatch(/user correction: transcript line 11$/m);
  });

  test("--checkpoint-only は走査済み位置なしでは checkpoint を進めない", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");

    const done = await runScript(
      "kaizen-extract-done.sh",
      ["--checkpoint-only", "--sentinel-suffix", "", "--agent", "claude-code", transcript],
      { cwd },
    );
    expect(done.status).toBe(2);
    expect(done.stderr).toMatch(/--scanned-bytes and --scanned-lines/);
    // センチネルを消してチェックを解除していないこと。
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(".pending-extract");
  });

  test.each([
    ["--scanned-bytes だけ", ["--scanned-bytes", "10"]],
    ["--scanned-lines だけ", ["--scanned-lines", "1"]],
  ])("走査済み位置は対で渡す: %s は拒否する", async (_label, partial) => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);

    // 片方だけ渡すと checkpoint の 2 行目と 4 行目が別地点を指す。警告なしに、機能を減らした wc での計数にしない。
    const done = await runScript("kaizen-extract-done.sh", [...partial, transcript], { cwd });
    expect(done.status).toBe(2);
    expect(done.stderr).toMatch(/must be given together/);
    expect(readdirSync(join(cwd, ".kaizen"))).not.toContain(".extract-checkpoint");
  });

  test("走査済み位置は --checkpoint-only 専用で、抽出完了モードでは受け付けない", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);

    // 抽出完了は transcript 全体を読んだ後の記録。ここで終端を受け付けると checkpoint を
    // 任意の位置へ進められ、未走査範囲を飛ばせてしまう（checkpoint はセッションをまたいで残る）。
    const done = await runScript(
      "kaizen-extract-done.sh",
      ["--sentinel-suffix", "", "--scanned-bytes", "999999", "--scanned-lines", "999", transcript],
      { cwd },
    );
    expect(done.status).toBe(2);
    expect(done.stderr).toMatch(/require --checkpoint-only/);
    expect(readdirSync(join(cwd, ".kaizen"))).not.toContain(".extract-checkpoint");
    expect(readdirSync(join(cwd, ".kaizen"))).not.toContain(".extract-done");
  });

  test("スキャナが走査済み位置を報告しないとき、チェックはブロックする", async () => {
    const scripts = cloneScripts();
    writeFileSync(
      join(scripts, "kaizen-candidate-scan.sh"),
      '#!/usr/bin/env bash\necho "kaizen-candidate-scan: agent=claude-code"\nexit 1\n',
    );
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");

    const gate = await runGate("git commit -m x", { cwd, transcriptPath: transcript, scripts });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/did not report its scanned position/);
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(".pending-extract");
  });
});

// 1 本の branch で複数 commit する運用では、最初の commit の後に積まれた活動も抽出対象でなければ
// ならない（Issue #244）。抽出完了マーカー `.extract-done.<key>` はセッション全体を抽出済みにする
// 印なので、checkpoint がある限りチェックに尊重させない。ここが緩むと 2 回目以降の commit が
// エラーにならずに素通りし、「チェックが動いている」ように見えたまま学びを取りこぼす。
describe.concurrent("同一セッションの後続 commit も未処理範囲を再走査する", () => {
  const SESSION = "sess-244";
  const sentinelName = `.pending-extract.${SESSION}`;

  /** Stop フックが毎ターン行うセンチネル再装填を模す。 */
  function armSentinel(cwd: string, transcript: string) {
    writeFileSync(
      join(cwd, ".kaizen", sentinelName),
      `2026-01-01T00:00:00Z\n${transcript}\nclaude-code\n${SESSION}\n`,
    );
  }

  async function completeExtraction(cwd: string, args: readonly string[]) {
    const done = await runScript(
      "kaizen-extract-done.sh",
      ["--sentinel-suffix", "", "--agent", "claude-code", "--session-id", SESSION, ...args],
      { cwd },
    );
    expect(done.status).toBe(0);
    return done;
  }

  test("checkpoint を記録できた抽出完了は .extract-done を書かない", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);

    await completeExtraction(cwd, [transcript]);

    const files = readdirSync(join(cwd, ".kaizen"));
    expect(files).toContain(`.extract-checkpoint.${SESSION}`);
    expect(files).not.toContain(`.extract-done.${SESSION}`);
    expect(files).not.toContain(sentinelName);
  });

  test("抽出後に積まれた候補は次の commit でブロックされる", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);
    await completeExtraction(cwd, [transcript]);

    // 1 回目の commit の後に積まれた活動（ユーザーの訂正を含む）。
    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl"), "utf8"));
    armSentinel(cwd, transcript);

    const gate = await runGate("git commit -m second", {
      cwd,
      transcriptPath: transcript,
      sessionId: SESSION,
    });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/candidate\(s\) found/);
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(sentinelName);
  });

  test("抽出後に新しい活動が無ければ次の commit は通る", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);
    await completeExtraction(cwd, [transcript]);
    armSentinel(cwd, transcript);

    const gate = await runGate("git commit -m second", {
      cwd,
      transcriptPath: transcript,
      sessionId: SESSION,
    });
    expect(gate.status).toBe(0);
    expect(readdirSync(join(cwd, ".kaizen"))).not.toContain(sentinelName);
  });

  test("修正前に書かれた .extract-done が残っていても再走査する", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);
    await completeExtraction(cwd, [transcript]);
    // 旧版が書いたマーカー（アップグレード直後にセッション内で残っている状態）。
    writeFileSync(join(cwd, ".kaizen", `.extract-done.${SESSION}`), "2026-01-01T00:00:00Z\n");

    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl"), "utf8"));
    armSentinel(cwd, transcript);

    const gate = await runGate("git commit -m second", {
      cwd,
      transcriptPath: transcript,
      sessionId: SESSION,
    });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/candidate\(s\) found/);
  });

  test("checkpoint を記録できない抽出完了は .extract-done でチェックを解除する", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);

    // transcript を渡さない呼び出しでは差分走査の起点が作れない。ここでマーカーまで
    // 書かないと、以降の commit が全走査で毎回ブロックされる恒久ブロッカーになる。
    await completeExtraction(cwd, []);
    const files = readdirSync(join(cwd, ".kaizen"));
    expect(files).toContain(`.extract-done.${SESSION}`);
    expect(files).not.toContain(`.extract-checkpoint.${SESSION}`);

    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl"), "utf8"));
    armSentinel(cwd, transcript);

    const gate = await runGate("git commit -m second", {
      cwd,
      transcriptPath: transcript,
      sessionId: SESSION,
    });
    expect(gate.status).toBe(0);
  });

  test("checkpoint を後から記録できたら、先に書かれた .extract-done を失効させる", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);
    await completeExtraction(cwd, []);
    armSentinel(cwd, transcript);
    await completeExtraction(cwd, [transcript]);

    const files = readdirSync(join(cwd, ".kaizen"));
    expect(files).toContain(`.extract-checkpoint.${SESSION}`);
    expect(files).not.toContain(`.extract-done.${SESSION}`);
  });

  test("古い .extract-done を削除できなくても checkpoint 後のセンチネル解除を続ける", async () => {
    const scripts = cloneScripts();
    const shimDir = tempDir("kaizen-rm-shim-");
    const realRm = (
      await spawnAsync("bash", ["-c", "command -v rm"], { timeout: CHILD_TIMEOUT_MS })
    ).stdout.trim();
    writeFileSync(
      join(shimDir, "rm"),
      `#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in *.extract-done*) exit 1 ;; esac
done
exec "${realRm}" "$@"
`,
      { mode: 0o755 },
    );

    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    armSentinel(cwd, transcript);
    writeFileSync(join(cwd, ".kaizen", `.extract-done.${SESSION}`), "old\n");

    const done = await runScript(
      "kaizen-extract-done.sh",
      ["--sentinel-suffix", "", "--agent", "claude-code", "--session-id", SESSION, transcript],
      { cwd, scripts, env: { PATH: `${shimDir}:${process.env.PATH}` } },
    );

    expect(done.status).toBe(0);
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(`.extract-checkpoint.${SESSION}`);
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(`.extract-done.${SESSION}`);
    expect(readdirSync(join(cwd, ".kaizen"))).not.toContain(sentinelName);
  });

  // チェックは候補ゼロの自動通過のたびに checkpoint を書く。その後の抽出で checkpoint を
  // 記録できなかった場合（transcript を渡し忘れた・読めない・書けない）、古い checkpoint を
  // 残したままマーカーだけ書くと、チェックはマーカーを尊重せず古い起点から再走査し、いま抽出
  // したばかりの候補で再びブロックする。抽出をやり直しても同じ状態に戻るため、安全側の扱いが
  // 機能せず commit が止まり続ける。
  test("先に checkpoint がある状態でも、.extract-done による通過は機能する", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);

    // 1 回目の commit: 候補ゼロでチェックが自動通過し、checkpoint が書かれる。
    armSentinel(cwd, transcript);
    expect(
      (
        await runGate("git commit -m first", {
          cwd,
          transcriptPath: transcript,
          sessionId: SESSION,
        })
      ).status,
    ).toBe(0);
    expect(readdirSync(join(cwd, ".kaizen"))).toContain(`.extract-checkpoint.${SESSION}`);

    // 候補が積まれ、抽出は済んだが transcript を渡せず checkpoint を記録できなかった。
    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl"), "utf8"));
    armSentinel(cwd, transcript);
    await completeExtraction(cwd, []);
    const files = readdirSync(join(cwd, ".kaizen"));
    expect(files).toContain(`.extract-done.${SESSION}`);
    // 起点を残すと、安全側の扱いがチェックに無視される。全走査として扱うため、起点を消す。
    expect(files).not.toContain(`.extract-checkpoint.${SESSION}`);

    armSentinel(cwd, transcript);
    const gate = await runGate("git commit -m second", {
      cwd,
      transcriptPath: transcript,
      sessionId: SESSION,
    });
    expect(gate.status).toBe(0);
  });

  test("key を持たない旧形式のセンチネルは従来どおりマーカーが覆う", async () => {
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
    // key 無しの checkpoint は単一ファイルで、このセンチネルの transcript を指しているとは
    // 限らない。「新しい活動がある」の根拠にできないので、マーカーの効力を保つ。
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    writeFileSync(join(cwd, ".kaizen", ".extract-done"), "2026-01-01T00:00:00Z\n");
    writeFileSync(
      join(cwd, ".kaizen", ".extract-checkpoint"),
      `${join(cwd, "other.jsonl")}\n999\nclaude-code\n99\n`,
    );
    appendFileSync(transcript, readFileSync(join(fixturesDir, "claude-candidate.jsonl"), "utf8"));

    const gate = await runGate("git commit -m x", { cwd, transcriptPath: transcript });
    expect(gate.status).toBe(0);
  });
});

describe.concurrent("スキャナの判定はチェックの外部コマンド方言に依存しない", () => {
  test("チェックは sed の GNU 拡張（BRE の \\|）で agent を取り出さない", () => {
    const gnuAlternation = /sed[^\n]*\\\|/;
    // 検出されることの確認: 修正前の書き方を検出できることを先に示す（「該当なし」を根拠にするため）。
    expect("scan_agent=$(sed -n 's/^x=\\(claude-code\\|codex\\)$/\\1/p' <<<\"$out\")").toMatch(
      gnuAlternation,
    );

    const code = readFileSync(join(scriptsDir, "kaizen-precommit-gate.sh"), "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/.test(line)) // 解説コメントは対象外（実行される sed だけを見る）
      .join("\n");
    expect(code).not.toMatch(gnuAlternation);
  });

  // GNU sed の --posix を BSD sed（POSIX BRE のみ）の代理にする。--posix を持たない sed の
  // 環境では代理を作れないので skip する（誤検出させない）。
  // 収集のときに 1 回だけ判定する（skipIf に渡すので同期で起動する）。
  const realSed = spawnSync("bash", ["-c", "command -v sed"], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  }).stdout.trim();
  const posixSedAvailable =
    realSed !== "" &&
    spawnSync("bash", ["-c", `"${realSed}" --posix -n p </dev/null`], { timeout: CHILD_TIMEOUT_MS })
      .status === 0;

  test.skipIf(!posixSedAvailable)(
    "POSIX BRE しか持たない sed でも候補ゼロは自動通過する",
    async () => {
      const shimDir = tempDir("kaizen-shim-");
      const callLog = join(shimDir, "calls.log");
      // 実体は絶対パスで呼ぶ（PATH 経由にすると自分自身を呼び戻して無限再帰する）。
      writeFileSync(
        join(shimDir, "sed"),
        `#!/usr/bin/env bash\necho called >>"${callLog}"\nexec "${realSed}" --posix "$@"\n`,
        { mode: 0o755 },
      );

      const cwd = makeProject();
      const transcript = join(cwd, "t.jsonl");
      copyFileSync(join(fixturesDir, "claude-no-candidate.jsonl"), transcript);
      writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");

      // 1 回目で checkpoint を作る（スキャナはここで初めて sed で checkpoint を読むようになる）。
      expect((await runGate("git commit -m x", { cwd, transcriptPath: transcript })).status).toBe(
        0,
      );
      writeFileSync(join(cwd, ".kaizen", ".pending-extract"), ""); // Stop フックによる再装填

      const gate = await runGate("git commit -m x", {
        cwd,
        transcriptPath: transcript,
        env: { PATH: `${shimDir}:${process.env.PATH}` },
      });
      // 代理 sed が実際に処理の流れの中で使われたこと（この確認が無いと「sed を一切呼ばなかった」でも通る）。
      expect(readFileSync(callLog, "utf8")).toMatch(/called/);
      expect(gate.stderr).not.toMatch(/did not identify its agent/);
      expect(gate.status).toBe(0);
    },
  );
});

describe.concurrent("チェックの commit 検出", () => {
  // 未抽出センチネルがある状態では、commit と判定されれば exit 2（ブロック）になる。
  // `{P}` は実行時にプロジェクトルートへ置換する。`-C` / `--git-dir` / `--work-tree` で
  // コミット先を指定する形は、**プロジェクト内**を指していないとチェックの対象外（exit 0）に
  // なるため（Issue #221）、正規表現の到達性を測るここのケースはコミット先をプロジェクト内に置く。
  // 外部宛てになる条件そのものは「コミット先のスコープ判定」で測る。
  const cases: [string, number][] = [
    ["git commit -m x", 2],
    ["git -C {P} commit -m x", 2],
    ["git --no-pager commit -m x", 2],
    ["git -c user.name=x -c user.email=y commit -m x", 2],
    ["git --no-pager -C {P} commit -m x", 2],
    ["cd /tmp && git -C {P} commit -m x", 2],
    // 引用符で囲まれた（空白を含む）オプション引数。
    ['git -C "{P}/a b" commit -m x', 2],
    ["git -C '{P}/a b' commit -m x", 2],
    ['git -c user.name="A B" commit -m x', 2],
    // ダブルクォート内のエスケープ。閉じ引用符を「次の "」とすると \" で早期に閉じ素通りする。
    ['git -c user.name="A \\"B\\"" commit -m x', 2],
    ['git -C "{P}/a \\"b\\"" commit -m x', 2],
    // backslash でエスケープされた空白。引用符だけを見ていると 1 引数として続かず素通りする。
    ["git -C {P}/tmp\\ a commit -m x", 2],
    ["git -c user.name=A\\ B commit -m x", 2],
    // 引用とエスケープの混在も 1 トークンとして続くこと。
    ['git -C {P}/"a b"/c\\ d commit -m x', 2],
    // 引数を取らないグローバルオプションの後ろのサブコマンドを「オプションの引数」として
    // 飲み込まないこと。飲み込むと次の語 `commit` にマッチし、読み取り専用コマンドを誤ブロックする。
    ["git --no-pager grep -n commit -- src/", 0],
    ["git --no-pager grep commit", 0],
    ["git --no-pager log commit", 0],
    ["git --no-pager show commit", 0],
    ["git --no-pager diff --stat commit", 0],
    ["git --paginate log commit", 0],
    // `--exec-path` は SYNOPSIS が `--exec-path[=<path>]` でも、値なし形は exec-path を出力して
    // 即 exit するだけで次の引数を消費しない（実測）。値を取るオプション扱いにすると `log` を
    // 飲んで次の `commit` にマッチし、同じ誤ブロックへ戻る。
    ["git --exec-path log commit", 0],
    // 値を別引数として取るオプションの引数は引き続き飲む（そこで止まると真陽性を落とす）。
    ["git --git-dir {P}/.git --work-tree {P} commit", 2],
    ["git --git-dir={P}/.git commit -m x", 2],
    // `=` 連結形の値も引用・エスケープで空白を含み得る。`-[^[:space:]]+` だけで拾うと引用の
    // 途中で切れ、続く語がオプションでないためオプション列が終わり `commit` へ到達しない
    // （素通り＝判定できないのに合格として扱う。修正前は実測で exit 0）。
    ['git --git-dir="{P}/a b/.git" commit -m x', 2],
    ["git --git-dir={P}/a\\ b/.git commit -m x", 2],
    ["git --git-dir='{P}/a b/.git' commit -m x", 2],
    ['git --work-tree="{P}/a b" commit -m x', 2],
    // `=` 連結形を 1 トークンとして飲んでも、非オプション語では止まる（過剰ブロックの回帰）。
    ['git --foo="a b" log commit', 0],
    ["git -c a=b -C {P} --no-pager commit -m x", 2],
    // エスケープを許しても非オプション語では止まる（過剰ブロックの回帰）。
    ["git log --grep commit", 0],
    ["echo git\\ commit", 0],
    ["git help commit", 0],
    ["man git commit", 0],
    ['echo "run git commit later"', 0],
    ["git log --oneline", 0],
    ['git stash push -m "commit wip"', 0],
    ["git config --get alias.commit", 0],
    // 区切り文字（`;` `&` `|` `(` ・改行）が**引用の内側**にある形。シェルはそこで
    // コマンドを区切らないので commit は実行されない。判定が引用状態を持たないと
    // リテラルの区切りを本物と読んで読み取り専用コマンドを誤ブロックする
    // （.kaizen/archive/2026-09-08-quoted-separator-must-not-trigger-command-gate.md）。
    //
    // どのケースも**引用を外せば BLOCK になる形**にしてある（区切りの直後が
    // マッチしうる `git` + サブコマンド）。引用対応を外すと下の 5 件が赤くなることを
    // 実測して、区別できることを確認した。対になる「引用の外の同じ区切り」を後ろに置き、
    // exit 0 が引用対応によるものか、検出の抜けかを切り分けられるようにする。
    ['echo "Bash(git commit *)"', 0],
    ["echo 'Bash(git commit *)'", 0],
    ['echo "x;git commit -m y"', 0],
    ["echo 'x && git commit -m y'", 0],
    ['echo "a|git commit -m y"', 0],
    // 引用の**外**の同じ区切りは従来どおり止める（引用対応のせいで合格として扱わない）。
    ["(git commit -m x)", 2],
    ["(cd {P} && git commit -m x)", 2],
    ['echo "quoted" ; git commit -m x', 2],
    ["echo 'quoted' && git commit -m x", 2],
    // シェルの引用規則が当たらない領域（コメント本文・heredoc 本文）。中の素の `'` を
    // 引用の開始として数えると、対を跨いだ範囲（本物の `git commit` を含む範囲）まで
    // マスクされて、チェックが素通りする。引用マスクからコメント／heredoc の扱いを外すと
    // 下の 2 件が exit 0 になることを実測して、区別できることを確認した。
    ["# don't\ngit commit -m x\n# won't", 2],
    ["cat <<EOF > f\ndon't\nEOF\ngit commit -m x\n# won't", 2],
    // コメントを潰しても、引用の内側の `#` と語中の `#` はコメントではない（過剰ブロックの回帰）。
    ['echo "Bash(git commit *) # matcher"', 0],
    ['echo "Bash(git commit *)" # matcher', 0],
    // コメント本文の中だけにある `git commit` は実行されない。
    ["# git commit -m x\ngit status", 0],
    // 二重引用符の**内側**でも、コマンド置換（`$( )` / `` ` ` ``）はシェルが展開する領域で、
    // 中身は実行されるコマンドである（Issue #345）。引用の内側を一律にリテラル扱いして潰すと
    // ここの `git commit` が検出から消え、**実際に実行されるコミットが素通りする**。
    // マスクからコマンド置換の扱いを外すと、下の 5 件が exit 0 になることを実測して、区別できることを確認した。
    ['echo "$(git commit -m x)"', 2],
    ['echo "`git commit -m x`"', 2],
    ['echo "$(echo "$(git commit -m x)")"', 2],
    ['echo "prefix $(cd {P} && git commit -m x) suffix"', 2],
    ["X=$(git commit -m x)", 2],
    // 引用の内側のコマンド置換をコピーしても、その中の**引用された**文字列は実行されない
    // （過剰ブロックの回帰。コピーした中身をそのまま区切り扱いしないこと）。
    [`echo "$(printf %s 'git commit')"`, 0],
    [`echo "$(echo ")" )"; echo ok`, 0],
    // 対応する `)` / `` ` `` を数え切れない形は heredoc と同じく判定不能なので、失敗として扱う。
    ['echo "$(git commit -m x"', 2],
    ['echo "`git commit -m x"', 2],
    // コマンド置換の中のコメントは行末まで。**コメント内の `)` は対応にならない**ので、
    // 素通りさせると早く閉じてしまい、その後ろに置かれた本物の `git commit` がマスク側で
    // 潰されて素通りする（合格として扱われる。cmdsub_span の `#` 分岐を外すと exit 0 になることを実測）。
    ['echo "$( # note )\ngit commit -m x\n)"', 2],
    // 対応する `)` がコメントに飲まれて行末が無い形は判定不能で、マスクせず元の文字列で判定する
    // （判定できないときは失敗として扱う）。元の文字列に見える `git commit` は従来どおり捕捉する。
    ['git commit -m "$( # note "', 2],
    // 語中の `#` はコメントではない（コメント扱いにして残りを飲むと逆に取りこぼす）。
    ["echo \"$(printf %s 'a#b')\"; git commit -m x", 2],
    // **コマンドの先頭は `;&|(` の直後だけではない。** `case` のパターンの `)` と複合コマンドの
    // `{` の直後もコマンド位置で、どれも実際にコミットを実行する（実測）。
    // `case` のパターンの `)` は対応する `(` を持たないので cmdsub_span の深さ計算では区別できず、
    // そこで閉じたと読むと、残りがマスクされて素通りする。mask_quoted 側では判定できないものとして扱い、
    // 区切りクラスにも `)` `{` を足す。**片側だけでは塞がらない**（判定できないときに使うのは
    // 元の文字列で、それを判定するのがこの正規表現のため）。
    ['echo "$(case x in x) git commit -m x;; esac)"', 2],
    ['echo "$(case x in a|b) echo hi;; *) git commit -m x;; esac)"', 2],
    ["case x in x) git commit -m x;; esac", 2],
    ['echo "$(f() { git commit -m x; }; f)"', 2],
    ["f() { git commit -m x; }; f", 2],
    ["{ git commit -m x; }", 2],
    // `)` が現れる他の文法は `(` と対になるので深さ計算で扱える（取りこぼしの回帰）。
    ['echo "$(( 1 + 2 ))"; git commit -m x', 2],
    ['echo "$( (git commit -m x) )"', 2],
    ["cat <(git commit -m x)", 2],
    // 過剰ブロックの回帰: `case` を含んでも commit が無ければ通る（判定できないときは元の文字列を
    // 使うだけで、区切りの直後に commit が無ければ一致しない）。
    ['echo "$(case x in x) echo hi;; esac)"', 0],
    // 語境界で見るので、`lowercase` / `testcase` は判定できないものとして扱わない。
    ['echo "$(echo lowercase)"', 0],
    ['echo "$(echo testcase)"', 0],
    ['echo "$(( 1 + 2 ))"', 0],
    ['echo "$(f() { echo hi; }; f)"', 0],
    // 置換の中身は「実行されるコマンド」だが、**その中の引用とコメントは実行されない**。
    // そのままコピーすると、リテラルに書かれた区切り文字を本物の区切りと読んで誤ブロックする
    // （実測: 下の 3 件はいずれも commit を実行しないのに exit 2 になっていた）。
    // 中身へ同じ規則を再帰で当て、実行される部分だけを残す。
    ["echo \"$(printf %s '; git commit -m x')\"", 0],
    ['echo "$(printf %s "; git commit -m x")"', 0],
    ['echo "$(echo hi # ; git commit -m x\n)"', 0],
    // 逆側の回帰: 再帰マスクで**実行される** commit を潰さない。
    ['echo "$(cd /tmp && git commit -m x)"', 2],
    // `echo "$(echo "$(git commit -m x)")"` は上の Issue #345 の組にある（同名のテストは名前で合否を判定できない）。
    // **行継続（`\` + 改行）はシェルが解析の前に取り除く。** 残したまま走査すると、トークンが
    // 継続で割れた形はどの正規表現にも当たらず素通りする（実測）。`git` / `commit` 自体が割れると
    // 生 JSON の prefilter（`*git*commit*`）でも外れるので、**prefilter と走査の両方**を
    // 直さないと塞がらない。
    ["ca\\\nse x in x) git commit -m x;; esac", 2],
    ['echo "$(ca\\\nse x in x) git commit -m x;; esac)"', 2],
    ["gi\\\nt commit -m x", 2],
    ["git com\\\nmit -m x", 2],
    ["gi\\\nt com\\\nmit -m x", 2],
    ["echo hi \\\n&& git commit -m x", 2],
    // `\\` + 改行は継続ではない（エスケープされた `\` の直後の改行）。消すと次のコマンドが
    // 前のコマンドと繋がって区切り判定から外れる（判定できないのに合格として扱われる）。
    ["echo a\\\\\ngit commit -m x", 2],
    // 過剰ブロックの回帰: 継続があっても commit が無ければ通る。
    ["echo a \\\n b", 0],
    ['echo "a\\\nb"', 0],
    ["ec\\\nho hello", 0],
    // **`case` は予約語として現れたときだけ区別できないものとして扱う。** 語として含むかどうかで判定すると、
    // 引数に書かれた `case` でも判定できないものとして扱われ、マスクを丸ごと捨ててしまう。
    // その結果、同じコマンド行の引用された `; git commit -m x` が実行されるものとして読まれ、誤ブロックになる（実測）。
    // `echo "$(printf %s case)" ...` は下の「`in` が続かない `case`」の組にある（同名のテストを作らない）。
    ['echo "$(printf %s \'case\')" "; git commit -m x"', 0],
    ['echo "$(printf %s lowercase)" "; git commit -m x"', 0],
    // 予約語が置ける位置（行頭・`;` `(` `{` ・改行の直後）は、いずれも判定できないものとして扱う。
    ['echo "$(echo hi; case x in x) git commit -m x;; esac)"', 2],
    ['echo "$( (case x in x) git commit -m x;; esac) )"', 2],
    ['echo "$({ case x in x) git commit -m x;; esac; })"', 2],
    ['echo "$(echo hi\ncase x in x) git commit -m x;; esac)"', 2],
    // **コマンド位置は記号の区切りだけではない。** 予約語（`then` / `else` / `elif` / `do` /
    // `while` / `until` / `!` …）の直後もコマンドの先頭で、いずれも実際に実行される（実測）。
    // 予約語は連なれるので、繰り返し可能な前置きとして扱う。
    ['echo "$(if true; then case x in x) git commit -m x;; esac; fi)"', 2],
    ['echo "$(if false; then :; else case x in x) git commit -m x;; esac; fi)"', 2],
    ['echo "$(if false; then :; elif true; then case x in x) git commit -m x;; esac; fi)"', 2],
    ['echo "$(for i in 1; do case x in x) git commit -m x;; esac; done)"', 2],
    ['echo "$(while case x in x) git commit -m x;; esac; do break; done)"', 2],
    ['echo "$(until case x in x) git commit -m x;; esac; do break; done)"', 2],
    ['echo "$(! case x in x) git commit -m x;; esac)"', 2],
    ['echo "$(true && while case x in x) git commit -m x;; esac; do break; done)"', 2],
    // 予約語も、引数として書かれたときは判定できないものとして扱わない（過剰ブロックの回帰）。
    ['echo "$(printf %s then)" "; git commit -m x"', 0],
    ['echo "$(printf %s then case)" "; git commit -m x"', 0],
    // **判定は `case` の「位置」ではなく「構文」で行う。** コマンド位置は記号の区切りにも
    // 予約語の直後にも**関数宣言子の直後**にも現れ、位置の列挙は 4 ラウンドで 10 形破られた。
    // 不均衡な `)` を持ち込むのは `case WORD in` という構文そのものなので、そちらを直接見る。
    ['echo "$(f() case x in x) git commit -m x;; esac; f)"', 2],
    ['echo "$(function f() case x in x) git commit -m x;; esac; f)"', 2],
    // `in` が続かない `case` は構文ではないので、判定できないものとして扱わない（過剰ブロックの回帰）。
    ['echo "$(printf %s case)" "; git commit -m x"', 0],
    ['echo "$(printf %s testcase)" "; git commit -m x"', 0],
    // 引用の内側は別の分岐が消費するのでこの検査に渡らない。
    ['echo "$(printf %s \'case x in\')" "; git commit -m x"', 0],
    // `for .. in` は `case` を持たないので当たらない。
    ['echo "$(for i in 1 2; do echo $i; done)"', 0],
    // Claude Code が `if` の照合の前に取り除くラッパー（timeout・time・nice・nohup・stdbuf・command・builtin）と
    // exec・パスを付けた git（Issue #678）。ラッパーの種類 × 値を取るオプションと引数 × 連なり × パス付きの git。
    ["timeout 60 git commit -m x", 2],
    ["timeout -s KILL 60 git commit -m x", 2],
    ["nice -n 5 git commit -m x", 2],
    ["stdbuf -oL git commit -m x", 2],
    ["stdbuf -o L git commit -m x", 2],
    ["builtin git commit -m x", 2],
    ["exec git commit -m x", 2],
    ["nohup nice -n 5 timeout 60 git commit -m x", 2],
    ["/usr/bin/git commit -m x", 2],
    ["timeout 60 /usr/bin/git commit -m x", 2],
    ["/usr/bin/git -C {P} commit -m x", 2],
    ["cd /tmp && stdbuf -oL git commit -m x", 2],
    ["sudo -u alice git commit -m x", 2],
    // 置換の始まり（`(`・バッククォート）は読み飛ばさないが、`{}` と置換の後ろの git は読む。
    ["xargs -I{} git commit -m {}", 2],
    ["timeout $(cat t) git commit -m x", 2],
    // 変数の展開（`$T`・`${T}`・`$1`）は、関数置換と違ってラッパーの引数として読み飛ばす。
    ["timeout $T git commit -m x", 2],
    ["timeout ${T} git commit -m x", 2],
    ["timeout $1 git commit -m x", 2],
    // ラッパーの引数そのものが置換の形（引用符で囲んだもの・関数置換）でも、後ろの git commit を読む。
    ['sudo -u "$(id -un)" git commit -m x', 2],
    ['sudo -u "`id -un`" git commit -m x', 2],
    ['env A="$(date)" git commit -m x', 2],
    ['env "A=$(date)" git commit -m x', 2],
    ['nice -n "$(echo 5)" git commit -m x', 2],
    ['timeout "$(cat t)" git commit -m x', 2],
    ["env ${ true; } git commit -m x", 2],
    // 同じラッパーとパスの形で、commit を実行しないもの（止めすぎの回帰）。
    ["timeout 60 git commit-tree abc", 0],
    ["timeout 60 git log --grep commit", 0],
    ["echo timeout git commit", 0],
    ["nice -n 5 git status", 0],
    ["stdbuf -oL git log commit", 0],
    ["builtin echo 'git commit'", 0],
    ["echo exec git commit", 0],
    ["exec git log commit", 0],
    ["/usr/bin/git log commit", 0],
    ["/usr/bin/gitk commit", 0],
    ["echo /usr/bin/git commit", 0],
    ["timeout 60 git commit-graph write", 0],
    ["stdbuf -oL echo 'git commit'", 0],
  ];

  test.each(cases)("%s => exit %i", async (command, expected) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    expect((await runGate(command.replaceAll("{P}", cwd), { cwd })).status).toBe(expected);
  });
});

// コミット先がプロジェクト外のリポジトリだとコマンド行から分かる呼び出しは、チェックの対象に
// しない（Issue #221）。テストのフィクスチャとして使い捨ての一時リポジトリへコミットする形まで
// 止めると、抽出を求めている「このプロジェクトの活動」と無関係な commit が実行できなくなる。
// ここが緩むとプロジェクト宛ての commit を素通しし（合格として扱い）、きつくなると元の不具合へ戻る。
// 外部宛てのケースはいずれも「プロジェクト内を指す同形のケース」を下の blocked 側に持つ。
// 同形の対（同じオプション・同じ引用形で、違うのはコミット先だけ）が両方あって初めて、
// exit 0 が「スコープ判定で外した」のか「commit として検出できていない」のかを区別できる。
describe.concurrent("コミット先のスコープ判定", () => {
  // プロジェクト（`makeProject()` の mkdtemp）の外側にある一意なパス。`/tmp` 直書きだと
  // 既存ディレクトリ・リポジトリと衝突してスコープ判定が変わり得る（`tmpdir()` は環境で異なる）。
  const FIXTURE = join(tmpdir(), `kaizen-gate-external-221-${process.pid}`);
  const SPACE_NAME = `kaizen gate external ${process.pid}`;
  const SPACE_FIXTURE = join(tmpdir(), SPACE_NAME);
  const ESCAPED_SPACE_FIXTURE = SPACE_FIXTURE.replaceAll(" ", "\\ ");
  const ESCAPED_SPACE_NAME = SPACE_NAME.replaceAll(" ", "\\ ");

  const external = [
    `git -C ${FIXTURE} commit -qm base`,
    `git --git-dir=${FIXTURE}/.git --work-tree=${FIXTURE} commit -qm base`,
    `git --git-dir ${FIXTURE}/.git commit -m x`,
    // `=` 連結形で引用・エスケープにより空白を含む値。
    `git --git-dir="${SPACE_FIXTURE}/.git" commit -m x`,
    `git --git-dir=${ESCAPED_SPACE_FIXTURE}/.git commit -m x`,
    `git --git-dir='${SPACE_FIXTURE}/.git' commit -m x`,
    // フィクスチャは 1 行で作られるので、フックが実行される時点では対象がまだ存在しない。
    `git init ${FIXTURE} && git -C ${FIXTURE} add a.txt && git -C ${FIXTURE} commit -m base`,
    // 引用・エスケープを含むコミット先も、外した結果が同じであること。
    `git -C "${SPACE_FIXTURE}" commit -m x`,
    `git -C ${ESCAPED_SPACE_FIXTURE} commit -m x`,
    // `--git-dir` と併記した `--work-tree` は、リポジトリが外部だと確定するので対象外。
    `git --git-dir=${FIXTURE}/.git --work-tree ${FIXTURE} commit -m x`,
    // `cd` があっても、絶対パス指定なら cwd に依存しないので判定できる。
    `cd ${tmpdir()} && git -C ${FIXTURE} commit -m x`,
    // 区切り直後に空白を入れない形。commit_re は捕捉するので、オプション列の解析も
    // 区切り文字から始まる部分文字列を受けられなければならない（さもないと判定不能＝ブロック）。
    `ls;git -C ${FIXTURE} commit -m x`,
    `ls&&git -C ${FIXTURE} commit -m x`,
    // glob メタ文字を含む引数があっても、外部宛ての判定自体は成立する（上の対）。
    `git -c user.name=A*B -C ${FIXTURE} commit -m a`,
    // `-C` の繰り返しは累積して相対解決される（/tmp + 相対 = プロジェクト外）。
    `git -C ${dirname(FIXTURE)} -C ${basename(FIXTURE)} commit -m x`,
    // **区切りの集合は commit_re と git_head_re で揃える。** commit_re 側だけ広げると、
    // 広げた区切りで一致した形をスコープ判定が解析できない。すると、外部宛ての免除が機能しないまま
    // 誤ブロックになる（実測）。`)` と `{` は直後に空白が入るので、従来の `[[:space:]]` で
    // 拾えていた。しかし `` ` `` は空白を挟まないので拾えなかった。
    `echo "\`git -C ${FIXTURE} commit -m x\`"`,
    `case x in x) git -C ${FIXTURE} commit -m x;; esac`,
    `{ git -C ${FIXTURE} commit -m x; }`,
  ];

  test.each(external)("外部宛て: %s => exit 0", async (command) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    expect((await runGate(command, { cwd })).status).toBe(0);
  });

  // パスを付けた git とラッパーの後ろでも、コミット先を読む（Issue #678。下の blocked に同形の対がある）。
  // テストの名前には、フィクスチャのパス（pid を含む）ではなく形の名前を入れる。
  // ミューテーションテストの定義が、名前でこのテストを指すためである。
  test.each([
    ["パスを付けた git", `/usr/bin/git -C ${FIXTURE} commit -m x`],
    ["timeout の後ろの git", `timeout 60 git -C ${FIXTURE} commit -m x`],
    // 作業ディレクトリを変えるラッパーでも、git -C が絶対パスなら基準に依存しない。
    ["env -C の後ろの絶対パスの git -C", `env -C ${tmpdir()} git -C ${FIXTURE} commit -m x`],
  ])("外部宛て（%s）=> exit 0", async (_name, command) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    expect((await runGate(command, { cwd })).status).toBe(0);
  });

  // ラッパーの後ろの語の読み飛ばしは、区切りとコマンド置換・プロセス置換の始まりを越えない。
  // 越えると 1 件目の外部宛てだけを読み、2 件目のプロジェクト宛ての commit を通す。
  test.each([
    ["timeout と &&", `timeout 60 git -C ${FIXTURE} commit -m a && git commit -m b`],
    ["nice と ;", `nice git -C ${FIXTURE} commit -m a; git commit -m b`],
    ["sudo -u と ||", `sudo -u x git -C ${FIXTURE} commit -m a || git commit -m b`],
    ["nice と改行", `nice git -C ${FIXTURE} commit -m a\ngit commit -m b`],
    ["timeout と引用符の中の $(", `timeout 60 git -C ${FIXTURE} commit -m "$( git commit -m b)"`],
    ["timeout と引用符の無い $(", `timeout 60 git -C ${FIXTURE} commit -m $( git commit -m b)`],
    // バッククォートの直後に空白が無い形（`` `git commit` ``）は、修正の前から別の一致で止まる。
    ["stdbuf とバッククォート", `stdbuf -oL git -C ${FIXTURE} commit -m a\` git commit -m b\``],
    ["timeout と <(", `timeout 60 git -C ${FIXTURE} commit -F <( git commit -m b)`],
    [
      "timeout と関数置換 ${ と空白",
      `timeout 60 git -C ${FIXTURE} commit -m \${ git commit -m b; }`,
    ],
    [
      "timeout と関数置換 ${ とタブ",
      `timeout 60 git -C ${FIXTURE} commit -m \${\tgit commit -m b; }`,
    ],
  ])(
    "ラッパーの後ろの外部宛ての後に続くプロジェクト宛て（%s）=> exit 2",
    async (_name, command) => {
      const cwd = makeProject();
      writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
      expect((await runGate(command, { cwd })).status).toBe(2);
    },
  );

  // ラッパーの引数の置換の中にあるプロジェクト宛ての commit は、外側の一致の中にある。
  // 一致を探し直す位置が外側の一致の終わりだと、外側の `-C <外部>` だけを読んで通す。
  test.each([
    ["timeout の引数の $( の中", `timeout "$( git commit -m b)" git -C ${FIXTURE} commit -m a`],
    ["env の引数の関数置換の中", `env \${ git commit -m b; } git -C ${FIXTURE} commit -m a`],
  ])("ラッパーの引数の置換の中のプロジェクト宛て（%s）=> exit 2", async (_name, command) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    expect((await runGate(command, { cwd })).status).toBe(2);
  });

  // 置換を引数に持つラッパーの後ろでも、外部宛てだけの commit は通す（止めすぎの回帰）。
  test.each([
    ["sudo -u と $(", `sudo -u "$(id -un)" git -C ${FIXTURE} commit -m x`],
    ["timeout と関数置換", `timeout \${ echo 5; } git -C ${FIXTURE} commit -m x`],
  ])("置換を引数に持つラッパーの後ろの外部宛て（%s）=> exit 0", async (_name, command) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    expect((await runGate(command, { cwd })).status).toBe(0);
  });

  const blocked = [
    // コミット先を指定しない＝コマンド行からは決まらない（従来どおりブロック）。
    "git commit -m x",
    `cd ${FIXTURE} && git commit -m x`,
    // プロジェクト内を指す形（上の外部宛てケースと同形の対）。
    "git -C . commit -m x",
    "git -C {P} commit -m x",
    "git -C {P}/sub commit -m x",
    "git --git-dir={P}/.git --work-tree={P} commit -qm base",
    "git --git-dir {P}/.git commit -m x",
    'git --git-dir="{P}/{SPACE}/.git" commit -m x',
    "git --git-dir={P}/{ESCAPED_SPACE}/.git commit -m x",
    "git --git-dir='{P}/{SPACE}/.git' commit -m x",
    // `--work-tree` 単独は外部パスでも判定不能（リポジトリは cwd から探索される）。
    `git --work-tree="${SPACE_FIXTURE}" commit -m x`,
    // コミット先 repo は外部でも、作業ツリーがプロジェクトならコミットされる内容はこの
    // プロジェクトの活動そのもの。意図的に安全側（ブロック）として扱う。
    `git --git-dir=${FIXTURE}/.git --work-tree={P} commit -m x`,
    `git -C ${FIXTURE} --work-tree={P} commit -m x`,
    `git init ${FIXTURE} && git -C ${FIXTURE} add a.txt && git commit -m base`,
    'git -C "{P}/{SPACE}" commit -m x',
    "git -C {P}/{ESCAPED_SPACE} commit -m x",
    "git -C {PARENT} -C {BASE} commit -m x",
    // 区切り直後に空白が無くてもプロジェクト宛ては見落とさない（上の対）。
    "ls;git -C {P} commit -m x",
    "ls&&git -C {P} commit -m x",
    // 展開しないと値が決まらないパスは判定不能（失敗として扱う）。外部宛てと同形だが通してはいけない。
    "git -C $FIXTURE commit -m x",
    'git -C "$(mktemp -d)" commit -m x',
    "git -C /tmp/kaizen-gate-*/fixture commit -m x",
    // `--work-tree` は作業ツリーだけを差し替え、リポジトリは cwd からの探索で決まる。
    // 外部を指していてもコミット先はプロジェクトのリポジトリなので通してはいけない。
    `git --work-tree=${FIXTURE} commit -m x`,
    `git --work-tree ${FIXTURE} commit -am x`,
    // `cd` があると git を実行する cwd が確定しないので、相対パス指定は判定不能。
    "cd /tmp && git -C fixture commit -m x",
    // 1 行に複数の commit。先頭が外部宛てでも、後続のプロジェクト宛てを見落とさない。
    `git -C ${FIXTURE} commit -m a && git commit -m b`,
    // 走査位置の算出はマッチ文字列を**リテラル**として扱う必要がある。パターン展開になると
    // パス以外の引数（`-c` の値など）の glob メタ文字がマッチ範囲を広げ、後続の commit を
    // 見落として素通りする（合格として扱われる）。
    `git -c user.name=A*B -C ${FIXTURE} commit -m a && git commit -m b`,
    `git -c user.name=A?B -C ${FIXTURE} commit -m a && git commit -m b`,
    `git -c user.name=A[b]B -C ${FIXTURE} commit -m a && git commit -m b`,
    // 上の external のパス付きの git・ラッパーの形と同形で、プロジェクトを指すもの。
    "/usr/bin/git -C {P} commit -m x",
    "timeout 60 git -C {P} commit -m x",
    // ラッパーが作業ディレクトリを変えると、git -C の相対パスの基準は Hook の cwd と一致しない（判定不能）。
    "env -C {P}/sub git -C .. commit -m x",
    "env --chdir={P}/sub git -C .. commit -m x",
  ];

  test.each(blocked)("プロジェクト宛て・判定不能: %s => exit 2", async (command) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    const resolved = command
      .replaceAll("{P}", cwd)
      .replaceAll("{PARENT}", dirname(cwd))
      .replaceAll("{BASE}", basename(cwd))
      .replaceAll("{ESCAPED_SPACE}", ESCAPED_SPACE_NAME)
      .replaceAll("{SPACE}", SPACE_NAME);
    expect((await runGate(resolved, { cwd })).status).toBe(2);
  });

  // 同じリポジトリの別 worktree はプロジェクトルートの外に置かれる。パスの包含だけで判定すると
  // 外部宛てに見えるが、コミット先はこのプロジェクトそのものなのでブロックしなければならない。
  test("同一リポジトリの別 worktree 宛ては外部扱いにしない", async () => {
    const root = tempDir("kaizen-wt-");
    const main = join(root, "main");
    const linked = join(root, "linked");
    mkdirSync(main);
    mkdirSync(join(main, ".kaizen"));
    writeFileSync(join(main, ".kaizen", ".pending-extract"), "");
    const git = async (args: readonly string[], cwd: string) =>
      await spawnAsync("git", args, {
        timeout: CHILD_TIMEOUT_MS,
        cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@e",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@e",
        },
      });
    expect((await git(["init", "-q", "."], main)).status).toBe(0);
    expect((await git(["commit", "-q", "--allow-empty", "-m", "init"], main)).status).toBe(0);
    expect((await git(["worktree", "add", "-q", linked, "-b", "wt"], main)).status).toBe(0);

    expect((await runGate(`git -C ${linked} commit -m x`, { cwd: main })).status).toBe(2);
    // linked worktree の `.git` は**ファイル**（`gitdir: <path>`）。`-d` 前提で共有 git ディレクトリを
    // 探すと解決できず、同一リポジトリ判定が抜けて外部宛て扱いで素通りする（合格として扱われる。実測）。
    expect(statSync(join(linked, ".git")).isFile()).toBe(true);
    expect((await runGate(`git --git-dir=${linked}/.git commit -m x`, { cwd: main })).status).toBe(
      2,
    );
    expect(
      (
        await runGate(`git --git-dir=${linked}/.git --work-tree=${linked} commit -m x`, {
          cwd: main,
        })
      ).status,
    ).toBe(2);
    // 別リポジトリなら同じ形でも素通りする（この対がないと「常にブロック」でも pass してしまう）。
    const other = join(root, "other");
    mkdirSync(other);
    expect((await git(["init", "-q", "."], other)).status).toBe(0);
    expect((await runGate(`git -C ${other} commit -m x`, { cwd: main })).status).toBe(0);
    expect((await runGate(`git --git-dir=${other}/.git commit -m x`, { cwd: main })).status).toBe(
      0,
    );
  });
});

// jq も python3 も無い環境では、チェックは Hook 入力を構造として読めない。そのため、生 JSON を直接照合する
// 機能を減らした処理で判定する。この処理は普段の開発機では絶対に通らないため、誤っていても気づけない。
// commit 判定は jq を使う処理と同じ結論でなければならない（ここが緩むと合格として扱われ、きつくなると誤ブロックになる）。
// ただしコミット先のスコープ判定（Issue #221）だけは**意図的に差がある**。この処理はコマンド行を
// 構造として取り出せていないため外部宛てを確定できず、`git -C <外部> commit` も従来どおりブロックする。
describe.concurrent("生 JSON だけで判定するときの commit 検出", () => {
  /** jq / python3 だけを解決できない PATH を作る（他のコマンドは実体へ通す）。 */
  function makeJqlessPathDir() {
    const dir = makeSharedTempDir("kaizen-nojq-");
    // チェック本体と kaizen-status-check.sh が使う外部コマンドは通す。ここが欠けると
    // 「機能を減らした処理で正しく判定した」ではなく「別の理由で失敗した」を測ってしまう。
    // `dirname` は両スクリプトが script_dir の解決に使う。外すと script_dir を解決できず、
    // commit 判定より手前の「bundled kaizen-status-check.sh is unavailable」で exit 2 になり、
    // 期待値 2 のケースが全部その理由で通ってしまう（lifecycle 検査以降を一切検証しない）。
    for (const tool of [
      "bash",
      "sed",
      "awk",
      "basename",
      "dirname",
      "tr",
      "cat",
      "timeout",
      "git",
    ]) {
      const path = spawnSync("bash", ["-c", `command -v ${tool}`], {
        timeout: CHILD_TIMEOUT_MS,
        encoding: "utf8",
      }).stdout.trim();
      if (path) symlinkSync(path, join(dir, tool));
    }
    return dir;
  }

  const jqlessPath = makeJqlessPathDir();

  // この処理を本当に通したことの確認。jq か python3 が解決できてしまうと、
  // チェックは構造化した入力を読む処理を通り、以下のケースは機能を減らした処理を一切検証しないまま全て pass する。
  test("PATH から jq / python3 が解決できないこと", async () => {
    for (const tool of ["jq", "python3", "python"]) {
      const probe = await spawnAsync("bash", ["-c", `command -v ${tool}`], {
        timeout: CHILD_TIMEOUT_MS,
        env: { ...process.env, PATH: jqlessPath },
      });
      expect(probe.status).not.toBe(0);
    }
  });

  const cases: [string, number][] = [
    // 区切りの後ろの commit。値の先頭だけに錨を打っていた頃は取りこぼしていた（合格として扱われた）。
    ["cd /tmp && git commit -m x", 2],
    ["make build; git commit -m x", 2],
    ["ls | xargs git commit", 2],
    ["(git commit -m x)", 2],
    ["git add -A && git -C /tmp commit -m x", 2],
    // 外部宛てのスコープ判定は、この処理では行わない（構造化した入力を読む処理なら 0 になる形も 2 のまま）。
    ["git -C /tmp/kaizen-gate-external-221 commit -qm base", 2],
    ["git --git-dir=/tmp/kaizen-gate-external-221/.git commit -m x", 2],
    ["cd /tmp; git --no-pager commit -m x", 2],
    // JSON では改行が `\n` の 2 文字として現れる。リテラルの区切りだけを見ていると取りこぼす。
    ["cd /tmp\ngit commit -m x", 2],
    // 行継続（`\` ＋ 改行）で割れたトークン（Issue #409）。シェルは継続を取り除いてから実行するのに、
    // 生 JSON には `git` も `commit` も揃って現れず、この処理だけ素通りしていた（実測）。
    ["gi\\\nt commit -m x", 2],
    ["git com\\\nmit -m x", 2],
    ["cd /tmp && gi\\\nt commit -m x", 2],
    // 継続でない `\\` ＋ 改行（エスケープされた `\` の直後の改行）。改行は本物の区切りなので、
    // 詰めたコピーだけを見ていると区切りが消えて素通りする。元の入力側で捕まえる。
    ["echo a\\\\\ngit commit -m x", 2],
    // 継続で `git` と繋がって別の語になる形は commit ではない（過剰ブロックにしない）。
    ["echo a\\\ngit log", 0],
    // 先頭の commit（従来から捕捉できていた形）。
    ["git commit -m x", 2],
    ["git -C /tmp commit -m x", 2],
    // 区切りを許しても、過剰ブロックにならないこと。
    ["echo hi; echo git commit", 0],
    ['echo "run git commit later"', 0],
    ["git log; git status", 0],
    ["grep -rn commit src/ | head", 0],
    ["cd /tmp && git --no-pager grep commit", 0],
    ["git --no-pager log commit", 0],
    ["git help commit", 0],
    // ラッパーとパス付きの git（Issue #678）。構造化した入力を読む処理と同じ結論になること。
    ["timeout 60 git commit -m x", 2],
    ["cd /tmp && stdbuf -oL git commit -m x", 2],
    ["exec git commit -m x", 2],
    ["/usr/bin/git commit -m x", 2],
    ["timeout 60 git log --grep commit", 0],
    ["echo exec git commit", 0],
    ["/usr/bin/gitk commit", 0],
    ["nice -n 5 git status; echo commit", 0],
  ];

  test.each(cases)("生 JSON: %s => exit %i", async (command, expected) => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    const result = await runGate(command, { cwd, env: { PATH: jqlessPath } });
    expect(result.status).toBe(expected);
    if (expected === 2) {
      // 機能を減らす PATH に必要なコマンドが欠けると、commit 判定より手前の環境エラーでも exit 2 に
      // なる。それでは「機能を減らした処理が commit を検出した」を測ったことにならないので、
      // ブロック理由が未抽出センチネル由来であることまで固定する。
      expect(result.stderr).not.toMatch(/unavailable|command not found/);
      expect(result.stderr).toContain("kaizen --current");
    }
  });
});

// 事前の絞り込みは、Hook の入力のうちツールの名前と入力（`tool_name`・`tool_input`・Copilot の `toolArgs`）だけを見る（Issue #678）。
// 入力の全体を見ると、パスに `git` と `commit` を含む worktree の中のセッションでは、`cwd`・`transcript_path` の語で
// すべての呼び出しが次の段（jq / python3 / git rev-parse）に進む。終了コードはどちらも 0 なので、
// jq・python3・git を、起動を記録してから実体を実行するスクリプトに差し替えて、起動したかで確かめる。
describe.concurrent("事前の絞り込みはツールの名前と入力だけを見る", () => {
  function makeTracingPath(trace: string) {
    const dir = tempDir("kaizen-trace-");
    for (const tool of ["jq", "python3", "git"]) {
      const real = spawnSync("bash", ["-c", `command -v ${tool}`], {
        timeout: CHILD_TIMEOUT_MS,
        encoding: "utf8",
      }).stdout.trim();
      assert(real !== "", `${tool} が PATH に無い`);
      writeFileSync(
        join(dir, tool),
        `#!/bin/sh\necho "${tool} $1" >>"${trace}"\nexec "${real}" "$@"\n`,
      );
      chmodSync(join(dir, tool), 0o755);
    }
    return dir;
  }

  async function runWithTrace(payload: string) {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
    const trace = join(cwd, "trace");
    const input = payload.replaceAll("{P}", cwd);
    const result = await spawnAsync("bash", [join(scriptsDir, "kaizen-precommit-gate.sh")], {
      timeout: CHILD_TIMEOUT_MS,
      cwd,
      input,
      env: kaizenEnv(cwd, {
        CLAUDE_PROJECT_DIR: cwd,
        PATH: `${makeTracingPath(trace)}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
      }),
    });
    const lines = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n") : [];
    return { status: result.status, stderr: result.stderr, lines };
  }

  const wordyCwd = JSON.stringify("/home/u/repo/.claude/worktrees/git-commit-fix");
  const wordyTranscript = JSON.stringify("/home/u/.claude/projects/git-commit/s.jsonl");

  // 次の段に進まないもの。語は cwd か transcript_path の値にだけある。
  const stopped: [string, string][] = [
    [
      "cwd だけに語がある",
      `{"session_id":"s","cwd":${wordyCwd},"tool_name":"Bash","tool_input":{"command":"ls -la"}}`,
    ],
    [
      "transcript_path だけに語がある",
      `{"session_id":"s","transcript_path":${wordyTranscript},"tool_name":"Bash","tool_input":{"command":"ls -la"}}`,
    ],
    [
      "cwd と transcript_path の両方に語がある",
      `{"session_id":"s","transcript_path":${wordyTranscript},"cwd":${wordyCwd},"tool_name":"Bash","tool_input":{"command":"git status","description":"commit の前に確かめる"}}`,
    ],
    [
      "Copilot の toolArgs（JSON の文字列）",
      `{"cwd":${wordyCwd},"toolName":"bash","toolArgs":${JSON.stringify(JSON.stringify({ command: "ls -la" }))}}`,
    ],
  ];

  test.each(stopped)("%s: jq・python3・git を起動せずに通す", async (_name, payload) => {
    const { status, lines } = await runWithTrace(payload);
    expect(status).toBe(0);
    expect(lines).toEqual([]);
  });

  // 次の段に進むもの（上と同じ cwd・transcript_path を持つ）。
  test("コマンドに語があれば次の段に進み、commit でなければ jq を 1 回だけ起動して通す", async () => {
    const { status, lines } = await runWithTrace(
      `{"session_id":"s","transcript_path":${wordyTranscript},"cwd":${wordyCwd},"tool_name":"Bash","tool_input":{"command":"git log --grep commit"}}`,
    );
    expect(status).toBe(0);
    // transcript_path・session_id・cwd の取り出しと git rev-parse は、commit と判定した後に行う。
    expect(lines).toEqual(["jq -r"]);
  });

  // 外部宛ての commit は、一致ごとにコミット先を判定する（commit_target_is_external）。一致を探し直す位置を
  // 1 文字ずつずらすと、代入やパスを前に付けた形が語の途中から何度も一致し、そのたびに判定する
  // （Issue #678 の PR #716 で 15〜33 回。実測）。呼んだ回数は `bash -x` のトレースで数える。
  test("代入やパスを前に付けた外部宛ての commit も、コミット先を 1 回だけ判定する", async () => {
    const ext = tempDir("kaizen-gate-ext-");
    spawnSync("git", ["init", "-q", ext], { timeout: CHILD_TIMEOUT_MS });
    const judgeCalls = async (command: string) => {
      const cwd = makeProject();
      writeFileSync(join(cwd, ".kaizen", ".pending-extract"), "");
      const result = await spawnAsync(
        "bash",
        ["-x", join(scriptsDir, "kaizen-precommit-gate.sh")],
        {
          timeout: CHILD_TIMEOUT_MS,
          cwd,
          input: JSON.stringify({ cwd, tool_name: "Bash", tool_input: { command } }),
          // 親の環境の BASH_ENV と PS4 が xtrace の出力先と形式を変えないよう、この子プロセスでは固定する
          env: kaizenEnv(cwd, { CLAUDE_PROJECT_DIR: cwd, BASH_ENV: undefined, PS4: "+ " }),
        },
      );
      expect(result.status, command).toBe(0);
      return result.stderr
        .split("\n")
        .filter((line) => /^\++ commit_target_is_external /.test(line)).length;
    };
    expect(await judgeCalls(`git -C ${ext} commit -m x`)).toBe(1);
    expect(
      await judgeCalls(`GIT_AUTHOR_NAME=a GIT_COMMITTER_NAME=b git -C ${ext} commit -m x`),
    ).toBe(1);
    expect(await judgeCalls(`/home/u/.local/share/bin/git -C ${ext} commit -m x`)).toBe(1);
  });

  test("Copilot の toolArgs の中の git commit は、cwd に語があっても止める", async () => {
    const { status, lines, stderr } = await runWithTrace(
      `{"cwd":"{P}","toolName":"bash","toolArgs":${JSON.stringify(JSON.stringify({ command: "git commit -m x" }))}}`,
    );
    expect(status).toBe(2);
    expect(stderr).toContain("kaizen --current");
    expect(lines).toContain("jq -r");
  });

  // JSON はキーも `\u` で書ける。絞り込みはそのキーを見つけられないが、jq はコマンドとして読む。
  test("\\u を含む入力は、入力の全体で判定する", async () => {
    const { status, lines } = await runWithTrace(
      `{"cwd":"{P}","tool_name":"Bash","tool_input":{"comm\\u0061nd":"git commit -m x"}}`,
    );
    expect(status).toBe(2);
    expect(lines).toContain("jq -r");
  });

  test("対象のキーが無い入力は、入力の全体で判定する", async () => {
    const { status, lines } = await runWithTrace(`{"cwd":${wordyCwd},"other":"x"}`);
    expect(status).toBe(0);
    expect(lines).toContain("jq -r");
  });
});

describe.concurrent("lifecycle 検査", () => {
  function writeNote(cwd: string, name: string, body: string) {
    writeFileSync(join(cwd, ".kaizen", name), body);
  }

  const note = (status: string, appliedTo: string) =>
    `---\ndate: 2026-08-10\ntype: rule\nstatus: ${status}\npriority: high\napplied-to:${appliedTo}\n---\n\n# note\n`;

  test.skipIf(process.getuid?.() === 0)(
    "読めないノートがあっても残りのノートを検査し、原因を名指しする",
    async () => {
      const cwd = makeProject();
      writeNote(cwd, "2026-08-10-a-unreadable.md", note("applied", ' ["AGENTS.md"]'));
      chmodSync(join(cwd, ".kaizen", "2026-08-10-a-unreadable.md"), 0o000);
      writeNote(cwd, "2026-08-10-b-broken.md", note("applied", " []"));

      const check = await runScript("kaizen-status-check.sh", [], { cwd });
      expect(check.status).toBe(2);
      expect(check.stderr).toMatch(/2026-08-10-a-unreadable\.md: could not read the frontmatter/);
      // 失敗理由は権限とは限らないので、awk の診断を捨てずに添える（原因の切り分けに要る）。
      expect(check.stderr).toMatch(/could not read the frontmatter: .*Permission denied/);
      expect(check.stderr).toMatch(
        /2026-08-10-b-broken\.md: status is applied but applied-to is empty/,
      );
      chmodSync(join(cwd, ".kaizen", "2026-08-10-a-unreadable.md"), 0o644);
    },
  );

  // applied-to の形（1 行・折り返し・ブロックシーケンス・空配列）と status の組み合わせは、
  // status-check/kaizen-status-check.test.ts の ACCEPTED と REJECTED が確かめる。ここでは、検査が
  // 不整合で exit 2 を返したときに、チェックがその理由を出して commit を止めることを確かめる。
  test("lifecycle 検査の不整合は、理由を出して commit を止める", async () => {
    const cwd = makeProject();
    writeNote(cwd, "2026-08-10-note.md", note("applied", " []"));

    const gate = await runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/2026-08-10-note\.md: status is applied but applied-to is empty/);
  });

  // 警告（rc 0）は、チェックの出力から外れやすい。チェックは検査の出力を変数へ取り込む。
  // さらに、**PreToolUse フックの stderr は非 0 で終えたときしか表示されない**。そのため、素通りの
  // exit 0 のまま stderr へ書いても誰にも届かない（`references/setup.md` に出典付きで
  // 書いてある仕様。他セッションの警告が warn_exit_code を使っているのと同じ理由）。
  // 状態空間は、検査の rc × 出力の有無 × チェックの出口である。
  //   - rc 2 × 出力あり            → 出す・exit 2（上の「不整合は、理由を出して commit を止める」）
  //   - rc 0 × 出力あり × 素通り   → 出す・exit 1（表示される非 0）  ← ここ
  //   - rc 0 × 出力なし × 素通り   → 何も足さない・exit 0            ← ここ
  //   - rc 0 × 出力あり × -copilot → 出す・exit 0（非 0 は誤って deny として扱われるため）← ここ
  test("lifecycle 検査の警告は commit を止めずに出る", async () => {
    const cwd = makeProject();
    // type は機構（hook）なのに applied-to がドキュメントだけ = Issue #341 の警告。
    writeNote(
      cwd,
      "2026-08-10-docs-only.md",
      '---\ndate: 2026-08-10\ntype: hook\nstatus: applied\npriority: high\napplied-to: ["AGENTS.md"]\n---\n\n# note\n',
    );

    const check = await runScript("kaizen-status-check.sh", [], { cwd });
    expect(check.status).toBe(0);
    expect(check.stderr).toMatch(/warning: type is hook/);

    // exit 1 = 「ブロックしない失敗」。これでフックランナーが stderr を表示する。
    // 0 のままだと、この assertion が見ている stderr は子プロセスから直接読めても
    // 利用者には届かない。
    const gate = await runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(1);
    expect(gate.stderr).toMatch(/warning: type is hook/);
  });

  test("検査と無関係な stderr は警告として扱わない", async () => {
    // status_output は 2>&1 なので子プロセスの無関係な stderr も入る。非空で判定すると
    // 警告 0 件でも非 0 になり、ロケールが不正な環境では毎コミットが恒久的に非 0 になる。
    const cwd = makeProject();
    writeNote(cwd, "2026-08-10-note.md", note("applied", ' ["AGENTS.md"]'));

    // 検出されることの確認: この環境変数で bash が実際に stderr へ警告を出すことを確かめる。
    // 出ていなければ、この後の exit 0 は「雑音を無視できた」の証拠にならない。
    const noise = await spawnAsync("bash", ["-c", "true"], {
      timeout: CHILD_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "xx_YY.UTF-8" },
    });
    expect(noise.stderr).toMatch(/setlocale/);

    const gate = await runGate("git commit -m x", { cwd, env: { LC_ALL: "xx_YY.UTF-8" } });
    expect(gate.status).toBe(0);
    expect(gate.stderr).not.toMatch(/kaizen-status-check:/);
  });

  test("雑音に紛れていても警告は拾う", async () => {
    // 上の裏返し。雑音を落とす実装が、警告まで落としていないことを確かめる。
    const cwd = makeProject();
    writeNote(
      cwd,
      "2026-08-10-docs-only.md",
      '---\ndate: 2026-08-10\ntype: hook\nstatus: applied\npriority: high\napplied-to: ["AGENTS.md"]\n---\n\n# note\n',
    );

    const gate = await runGate("git commit -m x", { cwd, env: { LC_ALL: "xx_YY.UTF-8" } });
    expect(gate.status).toBe(1);
    expect(gate.stderr).toMatch(/warning: type is hook/);
  });

  test("Copilot では警告でも exit 0 にする", async () => {
    // Copilot の preToolUse は exit 2 以外の非 0 をすべて deny にするため、警告の
    // 終了コードを 1 にすると commit そのものが拒否される（しかも理由が hook errored）。
    const cwd = makeProject();
    writeNote(
      cwd,
      "2026-08-10-docs-only.md",
      '---\ndate: 2026-08-10\ntype: hook\nstatus: applied\npriority: high\napplied-to: ["AGENTS.md"]\n---\n\n# note\n',
    );

    const input = JSON.stringify({ tool_input: { command: "git commit -m x" } });
    const gate = await spawnAsync(
      "bash",
      [join(scriptsDir, "kaizen-precommit-gate.sh"), "-copilot"],
      { timeout: CHILD_TIMEOUT_MS, cwd, input, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } },
    );
    expect(gate.status).toBe(0);
    expect(gate.stderr).toMatch(/warning: type is hook/);
  });

  test("警告が無ければチェックは検査の出力を足さない", async () => {
    const cwd = makeProject();
    writeNote(cwd, "2026-08-10-note.md", note("applied", ' ["AGENTS.md"]'));

    const check = await runScript("kaizen-status-check.sh", [], { cwd });
    expect(check.status).toBe(0);
    expect(check.stderr).toBe("");

    const gate = await runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(0);
    expect(gate.stderr).toBe("");
  });
});

// transcript を「一度も記録していない」センチネル（`/compact` 専用の隠しセッションのように
// transcript を一度も作らないまま Stop が実行された場合。Issue #240）は、案内どおりに探しても
// 見つからない。「記録はあるが今は読めない」（移動・削除済み）とは対処が違うので、案内が
// 両者を混同していないことを固定する。
describe.concurrent("未抽出センチネルの復旧案内は「記録なし」と「記録はあるが読めない」を区別する", () => {
  function writeSentinel(cwd: string, key: string, transcriptLine: string) {
    writeFileSync(
      join(cwd, ".kaizen", `.pending-extract.${key}`),
      `2026-08-27T21:54:39Z\n${transcriptLine}\nclaude-code\n${key}\n`,
    );
  }

  test("transcript の記録が無い場合は、transcript 無しで解消するコマンドも提示する", async () => {
    const cwd = makeProject();
    writeSentinel(cwd, "other-session-1", "");
    const gate = await runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/transcript の記録がありません/);
    expect(gate.stderr).not.toMatch(/センチネルが記録した transcript を読めません/);
    // 「見つからない場合」の解消コマンドは transcript 引数を伴わない。
    expect(gate.stderr).toMatch(
      /探しても見つからない場合は、transcript を指定せず次のコマンドで解消してください:\n\s*bash "[^"]+\/kaizen-extract-done\.sh" --sentinel-suffix "" --agent "claude-code" --session-id "other-session-1"\n/,
    );
    // 「記録なし」の場合はプレースホルダ無しのコマンドで解消が完結するため、"<transcript> を
    // 置き換えてください" という書き換え必須の注意書きは出ない（出ると、常に書き換えが要ると誤解される）。
    expect(gate.stderr).not.toMatch(/<transcript> だけを.*置き換えてください/);
  });

  test("transcript が実在するのに読めない場合は、探して抽出する案内だけを出す", async () => {
    const cwd = makeProject();
    const unreadable = join(cwd, "unreadable.jsonl");
    writeFileSync(unreadable, "{}\n");
    chmodSync(unreadable, 0o000);
    writeSentinel(cwd, "other-session-2", unreadable);
    try {
      const gate = await runGate("git commit -m x", { cwd });
      expect(gate.status).toBe(2);
      expect(gate.stderr).toMatch(/センチネルが記録した transcript を読めません/);
      expect(gate.stderr).not.toMatch(/transcript の記録がありません/);
      expect(gate.stderr).not.toMatch(/transcript を指定せず次のコマンドで解消してください/);
      // このケースは <transcript> の書き換えが必須の唯一の解消コマンドなので、注意書きが出る。
      expect(gate.stderr).toMatch(/<transcript> だけを.*置き換えてください/);
    } finally {
      chmodSync(unreadable, 0o644);
    }
  });

  // 記録された transcript が**実在しない**（剪定・削除・移動）ケース。探しても見つからないので、
  // 「実在するが読めない」と同じ案内として扱うと、解消手段が無い恒久的なブロッカーになる。
  // Issue #244 で抽出済みセッションのセンチネルもマーカーに覆われなくなったため、
  // transcript が剪定された旧セッションの残骸としてこの状態に到達しやすくなった。
  test("transcript の記録が実在しない場合は、transcript 無しで解消するコマンドも提示する", async () => {
    const cwd = makeProject();
    const pruned = join(cwd, "pruned.jsonl"); // 作らない
    writeSentinel(cwd, "other-session-3", pruned);
    const gate = await runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/センチネルが記録した transcript が実在しません/);
    expect(gate.stderr).not.toMatch(/センチネルが記録した transcript を読めません/);
    expect(gate.stderr).toMatch(
      /探しても見つからない場合は、transcript を指定せず次のコマンドで解消してください:\n\s*bash "[^"]+\/kaizen-extract-done\.sh" --sentinel-suffix "" --agent "claude-code" --session-id "other-session-3"\n/,
    );
    // 書き換え必須の注意書きは出ない（transcript 無しの解消コマンドで完結するため）。
    expect(gate.stderr).not.toMatch(/<transcript> だけを.*置き換えてください/);
  });

  test("unsafe な transcript 値と同名のパスが実在しても権限・FS 問題に誤分類しない", async () => {
    const cwd = makeProject();
    const unsafe = join(cwd, "unsafe$path.jsonl");
    writeFileSync(unsafe, "{}\n");
    writeSentinel(cwd, "other-session-4", unsafe);

    const gate = await runGate("git commit -m x", { cwd });
    expect(gate.status).toBe(2);
    expect(gate.stderr).toMatch(/値が不正/);
    expect(gate.stderr).not.toMatch(/センチネルが記録した transcript を読めません/);
    expect(gate.stderr).toMatch(/transcript を指定せず次のコマンドで解消してください/);
    expect(gate.stderr).not.toMatch(/<transcript> だけを.*置き換えてください/);
  });
});

// 制御ファイル（センチネル・checkpoint・抽出完了マーカー）の置き場は作業ディレクトリから決まる。
// セッションが共有ツリーで始まって git worktree で続くと、センチネルを立てたツリーと `git commit`
// を実行するツリーが分かれ、自分のツリーの `.kaizen/` しか見ない形では **worktree の commit が
// 素通りする**（Issue #344）。素通りは出力にも終了コードにも現れないので、決定論的に押さえる。
describe.concurrent("チェックはリポジトリの全作業ツリーの .kaizen/ を見る", () => {
  const SESSION = "00000000-1111-2222-3333-444444444444";

  /** 本体 ＋ worktree を 1 つ持つリポジトリを作る。*/
  async function makeRepoWithWorktree() {
    const root = tempDir("kaizen-wt-");
    const main = join(root, "main");
    mkdirSync(main);
    const git = async (args: readonly string[], cwd = main) => {
      const r = await spawnAsync("git", args, { timeout: CHILD_TIMEOUT_MS, cwd });
      expect(r.status, r.stderr).toBe(0);
      return r;
    };
    await git(["init", "-q", "."]);
    await git(["config", "user.email", "r@example.com"]);
    await git(["config", "user.name", "repro"]);
    writeFileSync(join(main, "seed"), "");
    await git(["add", "seed"]);
    await git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed"]);
    mkdirSync(join(main, ".kaizen"));
    const worktree = join(root, "wt");
    await git(["worktree", "add", "-q", "-b", "wtbranch", worktree]);
    return { main, worktree };
  }

  function writeSentinel(dir: string) {
    mkdirSync(join(dir, ".kaizen"), { recursive: true });
    writeFileSync(
      join(dir, ".kaizen", `.pending-extract.${SESSION}`),
      `2026-09-11T12:27:31Z\n\nclaude-code\n${SESSION}\n`,
    );
  }

  // CLAUDE_PROJECT_DIR は共有ツリーのまま（セッションの起点）にし、payload の cwd だけを
  // worktree にする＝Issue #344 が報告した実際の並びを作る。
  async function runGateAt(cwd: string, projectDir: string) {
    const input = JSON.stringify({
      session_id: SESSION,
      cwd,
      tool_input: { command: "git commit -m x" },
    });
    return await spawnAsync("bash", [join(scriptsDir, "kaizen-precommit-gate.sh")], {
      timeout: CHILD_TIMEOUT_MS,
      cwd,
      input,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });
  }

  test("共有ツリーに立ったセンチネルは worktree からの commit も止める", async () => {
    const { main, worktree } = await makeRepoWithWorktree();
    writeSentinel(main);
    expect((await runGateAt(main, main)).status).toBe(2);
    expect((await runGateAt(worktree, main)).status).toBe(2);
  });

  test("worktree に立ったセンチネルは共有ツリーからの commit も止める", async () => {
    const { main, worktree } = await makeRepoWithWorktree();
    writeSentinel(worktree);
    expect((await runGateAt(worktree, main)).status).toBe(2);
    expect((await runGateAt(main, main)).status).toBe(2);
  });

  test("センチネルがどのツリーにも無ければ従来どおり通す（全ツリー走査で常にブロックするようにならない）", async () => {
    const { main, worktree } = await makeRepoWithWorktree();
    expect((await runGateAt(worktree, main)).status).toBe(0);
    expect((await runGateAt(main, main)).status).toBe(0);
  });

  test("別ツリーの抽出完了マーカーはセンチネルを覆う（探索だけ広げてマーカーを取り残さない）", async () => {
    const { main, worktree } = await makeRepoWithWorktree();
    writeSentinel(main);
    mkdirSync(join(worktree, ".kaizen"), { recursive: true });
    writeFileSync(join(worktree, ".kaizen", `.extract-done.${SESSION}`), "2026-09-11T12:30:00Z\n");
    expect((await runGateAt(worktree, main)).status).toBe(0);
    expect((await runGateAt(main, main)).status).toBe(0);
  });

  // マーカーを全ツリーから探して覆わせる以上、**失効も全ツリーで**行わないと、別ツリーに
  // 残ったマーカーがセッション境界を越えて生き残り、このセッションの commit が素通りする。
  // 素通りは出力にも終了コードにも現れないので、SessionStart を挟んだ形で押さえる。
  test("SessionStart は別ツリーの抽出完了マーカーも失効させる", async () => {
    const { main, worktree } = await makeRepoWithWorktree();
    writeSentinel(worktree);
    mkdirSync(join(main, ".kaizen"), { recursive: true });
    const stale = join(main, ".kaizen", `.extract-done.${SESSION}`);
    writeFileSync(stale, "2026-09-11T12:30:00Z\n");
    // 覆っていることを先に確かめる（この後の 0 → 2 の変化が SessionStart によるものだと区別する）。
    expect((await runGateAt(worktree, main)).status).toBe(0);
    const inject = await spawnAsync("bash", [join(scriptsDir, "kaizen-context-inject.sh")], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: worktree,
      input: JSON.stringify({ session_id: SESSION, cwd: worktree, source: "resume" }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: main },
    });
    expect(inject.status, inject.stderr).toBe(0);
    expect(existsSync(stale)).toBe(false);
    expect((await runGateAt(worktree, main)).status).toBe(2);
  });

  // `git worktree list` は解決済み（物理）のパスを返す。base をシンボリックリンク越しに受け取ると
  // 文字列比較では一致せず、**同じ `.kaizen/` を 2 回**返す。同一のセンチネルが二重に数えられ、
  // 案内も他セッションの走査予算も二重に消費される。件数で押さえる。
  test("シンボリックリンク越しの project root でも .kaizen/ を重複して数えない", async () => {
    const { main } = await makeRepoWithWorktree();
    writeSentinel(main);
    const link = join(dirname(main), "link-main");
    symlinkSync(main, link);
    const gate = await runGateAt(link, link);
    expect(gate.status).toBe(2);
    const listed = gate.stderr.split("\n").filter((l) => l.includes(".pending-extract"));
    expect(listed).toHaveLength(1);
  });

  // `source: compact` は同一セッションの継続なので、そのときだけマーカーを残す（広げた範囲でも同じ）。
  test("source: compact では別ツリーのマーカーも残す", async () => {
    const { main, worktree } = await makeRepoWithWorktree();
    writeSentinel(worktree);
    mkdirSync(join(main, ".kaizen"), { recursive: true });
    const marker = join(main, ".kaizen", `.extract-done.${SESSION}`);
    writeFileSync(marker, "2026-09-11T12:30:00Z\n");
    const inject = await spawnAsync("bash", [join(scriptsDir, "kaizen-context-inject.sh")], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: worktree,
      input: JSON.stringify({ session_id: SESSION, cwd: worktree, source: "compact" }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: main },
    });
    expect(inject.status, inject.stderr).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });
});

// **経過時間や使える秒数で判定するテストは並べず、ファイルの最後に置く**（Issue #590）。
// 並べると他のテストの子で CPU が混み、親が子の終了に気づくのも遅れるので、チェックが正しくても上限を超える。
// 子の側で測ると、孫プロセスがパイプを開いたままにする回帰（エージェントが待たされる）を見逃す。
// 最初に実行すると、温まっていない状態で lifecycle 検査が遅れ、走査に回す秒数が残らずに別の理由で止まることがある
// （先頭に置いた版で、CI の基準 run が 1 回失敗した）。変更前と同じく、他のテストの後に実行する。
// 締め切りに当てる 2 本は、互いにだけ並べる（Issue #607）。どちらも子が sleep で待つだけなので CPU を取り合わず、
// 直列なら 2 本で 6 秒かかる待ち時間が 3 秒になる。このファイルはミューテーションテストで変異ごとに丸ごと実行される。
// エージェントは timeout に達したフックをブロックとして扱わない（Claude Code / Copilot とも、合格として扱う）。
// チェック全体の所要時間に上限が無いと、exit 2 で止めるはずの commit が遅いときほど素通りする（Issue #492）。
// チェックは 1 つの締め切りの内側で最後まで実行し、自セッション分までは締め切りに当たったら失敗として扱う。
describe("チェック全体の締め切り", () => {
  const OWN = "own-session-1";

  function stubScripts(files: Record<string, string>) {
    const scripts = cloneScripts();
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(scripts, name), `#!/usr/bin/env bash\n${body}\n`);
    }
    return scripts;
  }

  function writeSentinel(cwd: string, key: string, transcript: string) {
    writeFileSync(
      join(cwd, ".kaizen", `.pending-extract.${key}`),
      `2026-09-27T06:00:00Z\n${transcript}\nclaude-code\n${key}\n`,
    );
  }

  async function timedGate(options: RunOptions) {
    const started = Date.now();
    // テストの timeout（15 秒）より先に子プロセスを止め、どの子プロセスで止まったかを出力に残す。
    const gate = await runGate("git commit -m x", { timeout: 10_000, ...options });
    return { gate, elapsed: Date.now() - started };
  }

  test.concurrent("自セッション分の走査が締め切りに当たったら、締め切りの内側で exit 2 にする", async () => {
    const scripts = stubScripts({ "kaizen-candidate-scan.sh": "exec sleep 30" });
    const cwd = makeProject();
    const transcript = join(cwd, "t.jsonl");
    writeFileSync(transcript, "{}\n");
    writeSentinel(cwd, OWN, transcript);
    writeKaizenConfig(cwd, '{ "precommit_deadline_seconds": 3 }\n');

    const { gate, elapsed } = await timedGate({
      cwd,
      transcriptPath: transcript,
      sessionId: OWN,
      scripts,
    });
    expect(gate.status, gate.stderr).toBe(2);
    expect(gate.stderr).toMatch(/the transcript scan hit the gate deadline \(3s/);
    expect(elapsed).toBeLessThan(3000 + 1500);
    expect(existsSync(join(cwd, ".kaizen", `.pending-extract.${OWN}`))).toBe(true);
  }, 15000);

  // bash の SECONDS は秒の境界をまたぐと 1 ms でも 1 になる（実測）。締め切り 2 秒では残りが 0 秒になる回があり、
  // 検査を起動せずに同じメッセージで exit 2 になるので、timeout を外す変異（GATE-STATUS-UNBOUNDED）を
  // CI で検出できなかった。締め切りを 3 秒にし、検査が起動されたことも確かめる。
  test.concurrent("lifecycle 検査が締め切りに当たったら、締め切りの内側で exit 2 にする", async () => {
    const cwd = makeProject();
    const started = join(cwd, "status-check-started");
    const scripts = stubScripts({
      "kaizen-status-check.sh": `: > '${started}'\nexec sleep 30`,
    });
    writeKaizenConfig(cwd, '{ "precommit_deadline_seconds": 3 }\n');

    const { gate, elapsed } = await timedGate({
      cwd,
      sessionId: OWN,
      scripts,
    });
    expect(gate.status, gate.stderr).toBe(2);
    expect(gate.stderr).toMatch(
      /lifecycle 検査がチェックの締め切り（3 秒）までに終わりませんでした/,
    );
    expect(existsSync(started)).toBe(true);
    expect(elapsed).toBeLessThan(3000 + 1500);
  }, 15000);

  // bash は環境変数 SECONDS を起動時の初期値として引き継ぐ。フックの親環境に export されていると、
  // 経過時間が最初から大きくなり、毎回失敗として扱われる（PR #545 のレビュー指摘・実測）。
  test("環境変数 SECONDS を引き継いでも経過時間は 0 から数える", async () => {
    const cwd = makeProject();
    const gate = await runGate("git commit -m x", { cwd, sessionId: OWN, env: { SECONDS: "100" } });
    expect(gate.stderr).not.toMatch(/締め切り/);
    expect(gate.status, gate.stderr).toBe(0);
  });

  // 締め切りの値を読むだけのテストは、時間で判定しないので互いに並べる（締め切りに当てる 2 本とは並べない）。
  // 不正な値は、デフォルトの値で判定せずにコミットを止める（設定したつもりの締め切りで動いていると読めてしまう）。
  test.concurrent.each([['"abc"'], ["0"], ["1"], ["3601"], ["-5"], ["8.5"]])(
    "不正な締め切り %s はコミットを止めて知らせる",
    async (raw) => {
      const cwd = makeProject();
      writeKaizenConfig(cwd, `{ "precommit_deadline_seconds": ${raw} }\n`);
      const gate = await runGate("git commit -m x", { cwd, sessionId: OWN });
      expect(gate.status, gate.stderr).toBe(2);
      expect(gate.stderr).toContain("precommit_deadline_seconds");
      expect(gate.stderr).toContain("kaizen の設定を読めないので、コミットを止めます");
    },
  );

  test.concurrent.each([["2"], ["20"], ["3600"]])(
    "正しい締め切り %s は警告なしに受け付ける",
    async (raw) => {
      const cwd = makeProject();
      writeKaizenConfig(cwd, `{ "precommit_deadline_seconds": ${raw} }\n`);
      const gate = await runGate("git commit -m x", { cwd, sessionId: OWN });
      // 受け付けたかだけを見る。最小の 2 秒では lifecycle 検査の持ち時間が 1 秒しかなく、負荷の高い
      // 並列実行では、締め切りで失敗として扱われうる（それ自体は仕様どおり）。
      expect(gate.stderr).not.toMatch(/設定を読めない/);
      expect([0, 2]).toContain(gate.status);
    },
  );
});

describe.concurrent("kaizen の設定を読めないときはコミットを止める", () => {
  test("使わなくなった環境変数 KAIZEN_PRECOMMIT_DEADLINE_SECONDS は、移行の手順を示して止める", async () => {
    const cwd = makeProject();
    const gate = await runGate("git commit -m x", {
      cwd,
      sessionId: FOREIGN_SCAN_OWN,
      env: { KAIZEN_PRECOMMIT_DEADLINE_SECONDS: "20" },
    });
    expect(gate.status, gate.stderr).toBe(2);
    expect(gate.stderr).toContain("環境変数 KAIZEN_PRECOMMIT_DEADLINE_SECONDS は使わなくなった");
    expect(gate.stderr).toContain("precommit_deadline_seconds に移し");
  });

  test("旧い .kaizen/config は、node が無くても移行の手順を示して止める", async () => {
    const cwd = makeProject();
    writeFileSync(join(cwd, ".kaizen", "config"), "foreign_sentinel_retention_days=14\n");
    const env = { PATH: pathWithout(cwd, ["node"], kaizenEnv(cwd).PATH ?? "") };
    const gate = await runGate("git commit -m x", { cwd, sessionId: FOREIGN_SCAN_OWN, env });
    expect(gate.status, gate.stderr).toBe(2);
    expect(gate.stderr).toContain(".kaizen/config が残っている");
  });

  test("設定ファイルがあるのに node が無ければ止め、設定ファイルが無ければ node なしで通す", async () => {
    const cwd = makeProject();
    const env = { PATH: pathWithout(cwd, ["node"], kaizenEnv(cwd).PATH ?? "") };
    const none = await runGate("git commit -m x", { cwd, sessionId: FOREIGN_SCAN_OWN, env });
    expect(none.status, none.stderr).toBe(0);
    writeKaizenConfig(cwd, '{ "precommit_deadline_seconds": 20 }\n');
    const gate = await runGate("git commit -m x", { cwd, sessionId: FOREIGN_SCAN_OWN, env });
    expect(gate.status, gate.stderr).toBe(2);
    expect(gate.stderr).toContain("kaizen の設定を読むには node が要るが、見つからない");
  });

  test("人ごとの設定（XDG_CONFIG_HOME）の締め切りも読む", async () => {
    const cwd = makeProject();
    const user = join(cwd, ".test-xdg", "skills", "shoji9x9");
    mkdirSync(user, { recursive: true });
    writeFileSync(join(user, "kaizen.jsonc"), '{ "precommit_deadline_seconds": "x" }\n');
    const gate = await runGate("git commit -m x", { cwd, sessionId: FOREIGN_SCAN_OWN });
    expect(gate.status, gate.stderr).toBe(2);
    expect(gate.stderr).toContain(join(user, "kaizen.jsonc"));
  });
});

// 使える秒数を前回と比べるので、締め切りの describe と同じく並べずに、ファイルの最後で実行する。
// テストを並べない指定は自分の describe の中でしか直列にならず、隣の concurrent な suite のテストとは並んで始まる（vitest 4 で実測）。
describe("他セッション分の走査結果の再利用（使える秒数を比べる）", () => {
  test("打ち切りは、前回より長く使えるときだけ走査し直す", async () => {
    // 3 回目は、走査し直したか（スキャナが起動されたか）だけを数える。起動されたらすぐ終わらせ、締め切りまで待たない（Issue #607）。
    const { gate, scans } = setupForeignScan(
      'if [ -n "${SCAN_NO_WAIT:-}" ]; then exit 2; fi\nexec sleep 30',
    );
    // 使える秒数は SECONDS の境界で 1 秒揺れる。同じ締め切りの 2 回目は許容内（+1 秒）に、
    // 3 回目は確実に許容の外に収まる値を選ぶ。
    // gate を 3 回順に起動するので、子プロセスの timeout の合計（28 秒）をテストの timeout（30 秒）より短くする。
    // 締め切りに合わせて配り、どの回も締め切りより 5 秒の余裕を持たせる。
    await gate({}, 8_000, 3);
    expect(scans()).toBe(1);
    const same = await gate({}, 8_000, 3);
    expect(scans()).toBe(1);
    expect(same.stderr).toMatch(/skipped re-scanning .*\(exit 124 after up to [12]s\)/);
    await gate({ SCAN_NO_WAIT: "1" }, 12_000, 7);
    expect(scans()).toBe(2);
  }, 30000);
});
