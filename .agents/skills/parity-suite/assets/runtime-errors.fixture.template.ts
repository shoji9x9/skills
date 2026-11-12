/**
 * 操作中のエラーを記録する fixture（雛形）— parity-suite
 *
 * このファイルは、プロジェクトへコピーして使う雛形である。コピー先は
 * `<parity_suite_dir>/parity/lib/runtime-errors.ts` にする（実際のパスは metadata.json の suite.runtime_errors に記録する）。
 * スイートのテストの基（`test`）を、この fixture で拡張する。
 *
 *   import { test as base } from "@playwright/test";
 *   import { runtimeErrorFixtures } from "./runtime-errors";
 *   export const test = base.extend(runtimeErrorFixtures);
 *
 * 既に `base.extend(...)` で作った基があれば、その基をさらに `.extend(runtimeErrorFixtures)` で拡張する。
 * fixture は自動で起動するので（auto）、テストの本体は変えない。
 *
 * 何を記録するか: テストのコンテキストで開いたすべてのページについて、次の 4 種類を、起きたときのページの URL と一緒に並べる。
 *   pageerror     … ページの中で捕まえていない例外（page の pageerror。本文は Error の message）。
 *   console-error … console の error（page の console のうち type() が "error" のもの。本文は text()）。
 *   requestfailed … 通信の失敗（page の requestfailed。本文は failure().errorText）。
 *   http-error    … 4xx と 5xx の応答（page の response のうち status() が 400 以上のもの）。
 * 出典: https://playwright.dev/docs/api/class-page#page-event-page-error ・ #page-event-console ・
 * #page-event-request-failed ・ #page-event-response（@playwright/test 1.64 で確かめた）。
 * 署名の正規化と、現側の基準との比較は、スキルの scripts/runtime-errors.mjs が決める（この fixture は並べるだけ）。
 * テストが `page.route` で応答を止めたり 500 を返したりした分も記録される。現側でも同じテストが同じ失敗を起こすので、基準に入る。
 *
 * 環境変数は次のとおりである。
 *   PARITY_RUNTIME_CAPTURE … "1" の実行でだけ記録する。それ以外の実行（green の確認・強度チェックなど）では何もしない。
 *   PARITY_RUNTIME_RUN     … 何回目の実行か（1 以上の整数。必須）。出力先の run-<回>/ を決める。
 *   PARITY_SLUG            … 対象機能の slug（必須）。
 *   PARITY_NEW_TARGET      … `new` で実行するとき必須。出力先 new/<target>/ を決める。
 *   PARITY_REPO_ROOT       … `.replace/` を持つリポジトリのルート（省略時は cwd）。
 *
 * 出力先は、現側が `.replace/parity/<slug>/runtime-errors/run-<回>/`、新側が
 * `.replace/parity/<slug>/new/<target>/runtime-errors/run-<回>/` である。
 * テストごとに 1 ファイルを書くので、並列の worker が同じファイルを書かない。
 * ファイル名は、Playwright のテストの id（testInfo.testId）から決める。テストの id は、project（同じ名前の project も別のもの）と
 * 繰り返しの回（`--repeat-each` の何回目か）ごとに違い、リトライの試行では同じである。
 * 出典: https://playwright.dev/docs/api/class-testinfo#test-info-test-id（@playwright/test 1.64 で確かめた）。
 * 記録を採る実行で `--repeat-each` や同じ名前の複数の project を使うと、同じテストの記録が 1 つの run-<回>/ に 2 つできる。
 * そのときは、スキルの scripts/runtime-errors.mjs が exit 2 で止める（ファイル名をテストの識別子だけで決めると、記録が上書きされ、最後の試行のエラーだけが残る）。
 * 記録を採る実行では使わず、回を重ねるときは PARITY_RUNTIME_RUN を変えて実行し直す。
 * 記録するのは project が `current` か `new` のときだけで、他の project（`new-capture` など）では何もしない。
 * 採り直すときは、前の run-<回>/ を消してから実行する（消したテストの記録が残ると、基準に無いテストとして比較が止まる）。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";

// scripts/runtime-errors.mjs の RECORD_VERSION と同じ値にする
const RUNTIME_ERRORS_VERSION = "1";

type RuntimeEvent = {
  kind: "pageerror" | "console-error" | "requestfailed" | "http-error";
  page: string;
  text: string;
  method?: string;
  url?: string;
  status?: number;
};

type Fixtures = { runtimeErrors: void };

export const runtimeErrorFixtures = {
  runtimeErrors: [
    async (
      { context }: { context: BrowserContext },
      use: (r: void) => Promise<void>,
      testInfo: TestInfo,
    ) => {
      const side = testInfo.project.name;
      if (process.env.PARITY_RUNTIME_CAPTURE !== "1" || (side !== "current" && side !== "new")) {
        await use();
        return;
      }
      const out = outputPath(side, testInfo);
      const events: RuntimeEvent[] = [];
      for (const page of context.pages()) listen(page, events);
      context.on("page", (page) => listen(page, events));
      await use();
      // リトライの試行は、同じ実行の前の試行の記録にイベントを足す（失敗した試行で出たエラーを残す）
      const earlier = earlierAttemptEvents(out, testInfo.retry);
      writeJsonAtomic(out, {
        version: RUNTIME_ERRORS_VERSION,
        side,
        slug: process.env.PARITY_SLUG,
        target: side === "new" ? process.env.PARITY_NEW_TARGET : null,
        run: Number(process.env.PARITY_RUNTIME_RUN),
        test: testId(testInfo),
        status: testInfo.status,
        retry: testInfo.retry,
        events: [...earlier, ...events],
      });
    },
    { auto: true },
  ],
} satisfies Record<keyof Fixtures, unknown>;

// 1 つのページの 4 種類のイベントを、起きた順に events へ足す
function listen(page: Page, events: RuntimeEvent[]): void {
  page.on("pageerror", (error) => {
    events.push({ kind: "pageerror", page: page.url(), text: error.message });
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      events.push({ kind: "console-error", page: page.url(), text: message.text() });
  });
  page.on("requestfailed", (request) => {
    events.push({
      kind: "requestfailed",
      page: page.url(),
      text: request.failure()?.errorText ?? "",
      method: request.method(),
      url: request.url(),
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    events.push({
      kind: "http-error",
      page: page.url(),
      text: response.statusText(),
      method: response.request().method(),
      url: response.url(),
      status: response.status(),
    });
  });
}

// テストの識別子。設定ファイルのディレクトリからのファイルのパスと、describe からテストまでの名前を連ねる。
// project 名と project の testDir は含めない（現側と新側の同じテストを同じ識別子にする）
function testId(testInfo: TestInfo): string {
  const file = relative(testInfo.config.rootDir, testInfo.file).split("\\").join("/");
  return [file, ...testInfo.titlePath.slice(1)].join(" › ");
}

// 前の試行が同じファイルに書いたイベント。最初の試行（retry 0）では読まない（前の実行の記録を混ぜない）
function earlierAttemptEvents(path: string, retry: number): unknown[] {
  if (retry === 0 || !existsSync(path)) return [];
  const doc: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isEarlierRecord(doc, retry)) return [];
  return doc.events;
}

// 前の試行の記録か（retry が今の試行より小さく、events が配列）。中身は集計の側が確かめる
function isEarlierRecord(doc: unknown, retry: number): doc is { retry: number; events: unknown[] } {
  if (typeof doc !== "object" || doc === null) return false;
  const r: unknown = Reflect.get(doc, "retry");
  return typeof r === "number" && r < retry && Array.isArray(Reflect.get(doc, "events"));
}

// 記録の出力先。テストの id のハッシュをファイル名にする（リトライの試行はテストの id が同じなので、同じファイルに書く）。
// 記録の test の欄の識別子（testId 関数）は project を含まないので、ファイル名には使わない
function outputPath(side: "current" | "new", testInfo: TestInfo): string {
  const slug = requireName("PARITY_SLUG");
  const run = Number(process.env.PARITY_RUNTIME_RUN);
  if (!Number.isInteger(run) || run < 1)
    throw new Error(`PARITY_RUNTIME_RUN は 1 以上の整数: ${process.env.PARITY_RUNTIME_RUN}`);
  const repoRoot = process.env.PARITY_REPO_ROOT ?? process.cwd();
  const root = join(repoRoot, ".replace", "parity", slug);
  const base =
    side === "current"
      ? join(root, "runtime-errors")
      : join(root, "new", requireName("PARITY_NEW_TARGET"), "runtime-errors");
  const name = createHash("sha256").update(testInfo.testId).digest("hex").slice(0, 16);
  const out = join(base, `run-${run}`, `${name}.json`);
  const rel = relative(root, out);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`出力先 ${out} が ${root} の外を指す`);
  return out;
}

// output-file:begin
function requireName(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} が未設定`);
  // 1 つのディレクトリ名に限る（`..`・区切り文字を通さない）
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) || v.includes("..")) {
    throw new Error(`${name} がディレクトリ名の形でない: ${v}`);
  }
  return v;
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}
// output-file:end
