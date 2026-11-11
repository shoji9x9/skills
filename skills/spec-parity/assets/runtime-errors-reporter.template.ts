/**
 * 操作中のエラーの記録を書く e2e の reporter（雛形）— spec-parity
 *
 * このファイルは、プロジェクトへコピーして使う雛形である。コピー先は `tests/parity/runtime-errors-reporter.ts` にする。
 * e2e の設定の reporters に `runtimeErrorsReporter()` を足す（組み込みの 'list' などと並べてよい）。
 *
 * テストの基（tests/parity/test.ts）が標準出力に書いた MARK の行を、そのテストの結果と合わせて、
 * spec-parity に同梱した runtime-errors.mjs が読む形（テストごとに 1 ファイル）で書く。
 * runtime-errors.mjs は parity-suite のものと同じ中身なので、記録の形は Playwright の fixture の記録と同じにする。
 *   - test は「ファイルのパス › describe › テスト名」。e2e の結果の file と titlePath から作る（現行と新側で同じになる）
 *   - status は Playwright の語彙に読み替える（timed-out → timedOut、flaky → passed。flaky はリトライで通ったテスト）
 *   - リトライの試行で出た記録も、同じテストの記録に足す
 * 書き出すのは PARITY_RUNTIME_CAPTURE=1 の実行だけで、target が current か new のテストだけである。
 * 環境変数は次のとおりである。
 *   PARITY_RUNTIME_RUN … 何回目の実行か（1 以上の整数。必須）。出力先の run-<回>/ を決める。
 *   PARITY_SLUG        … 対象機能の slug（必須）。
 *   PARITY_NEW_TARGET  … new で実行するとき必須。replace-strategy の target の名前で、出力先 new/<target>/ を決める。
 *   PARITY_REPO_ROOT   … .replace/ を持つリポジトリのルート（省略時は cwd）。
 * 出力先は、現側が `.replace/parity/<slug>/runtime-errors/run-<回>/`、新側が `.replace/parity/<slug>/new/<target>/runtime-errors/run-<回>/` である。
 * 採り直すときは、前の run-<回>/ を消してから実行する。
 *
 * 記録を書かないテスト: MARK の行が 1 つも無く LOST の行があるテスト、どちらの行も無いテスト（後始末が動かなかった）。
 * スキップしたテストは、行が無くても空の記録を書く（runtime-errors.mjs はスキップしたテストのイベントを数えない）。
 * 書かなかったテストは stderr に 1 行ずつ出す。runtime-errors.mjs は、そのテストを記録が欠けたテストとして扱う。
 */
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { LOST, MARK } from "../parity/test.ts";

// runtime-errors.mjs の RECORD_VERSION と同じ値にする
const RUNTIME_ERRORS_VERSION = "1";

// e2e の結果の状態 → runtime-errors.mjs の語彙（Playwright の testInfo.status）
const STATUS: Record<string, string> = {
  passed: "passed",
  flaky: "passed",
  failed: "failed",
  "timed-out": "timedOut",
  skipped: "skipped",
  interrupted: "interrupted",
};

type Captured = { events: unknown[]; marked: boolean; lost: boolean };

// reporter が読む e2e のイベントの形（e2e の RunEvent のうち、使う 2 種類の使うフィールドだけ）。
// e2e の型を import せず、形を確かめてから読む（e2e が形を変えたら、読まずに記録の欠けとして比較で止まる）
type Pair = { testId: string; agent: string; repeat: number };
type OutputEvent = { type: "output"; target: string; pair?: Pair; text: string };
type FinishedResult = {
  selected: boolean;
  target: { name: string };
  test: { id: string; file: string; titlePath: string[] };
  agent: string;
  repeat: number;
  status: string;
  attempts?: unknown[];
};
type FinishedEvent = { type: "test-finished"; result: FinishedResult };

function isOutput(e: { type: string }): e is OutputEvent {
  return e.type === "output" && typeof Reflect.get(e, "text") === "string";
}

function isFinished(e: { type: string }): e is FinishedEvent {
  const r: unknown = Reflect.get(e, "result");
  return (
    e.type === "test-finished" &&
    typeof r === "object" &&
    r !== null &&
    "test" in r &&
    "target" in r
  );
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

function outputDir(side: "current" | "new"): {
  dir: string;
  run: number;
  slug: string;
  target: string | null;
} {
  const run = Number(process.env.PARITY_RUNTIME_RUN);
  if (!Number.isInteger(run) || run < 1)
    throw new Error(`PARITY_RUNTIME_RUN は 1 以上の整数: ${process.env.PARITY_RUNTIME_RUN}`);
  const slug = requireName("PARITY_SLUG");
  const target = side === "new" ? requireName("PARITY_NEW_TARGET") : null;
  const root = join(process.env.PARITY_REPO_ROOT ?? process.cwd(), ".replace", "parity", slug);
  const base =
    target === null ? join(root, "runtime-errors") : join(root, "new", target, "runtime-errors");
  const dir = join(base, `run-${run}`);
  const rel = relative(root, dir);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`出力先 ${dir} が ${root} の外を指す`);
  return { dir, run, slug, target };
}

// テストを pair（target・テスト・agent・繰り返し）で区別する鍵
function keyOf(target: string, pair: Pair): string {
  return JSON.stringify([target, pair.testId, pair.agent, pair.repeat]);
}

// テストが標準出力に書いた MARK と LOST の行を、テストごとに集める
function collectOutput(byPair: Map<string, Captured>, event: OutputEvent): void {
  if (!event.pair) return;
  const key = keyOf(String(event.target), event.pair);
  const c = byPair.get(key) ?? { events: [], marked: false, lost: false };
  for (const line of event.text.split("\n")) {
    if (line.startsWith(MARK)) {
      const parsed: unknown = JSON.parse(line.slice(MARK.length));
      if (Array.isArray(parsed)) c.events.push(...parsed);
      c.marked = true;
    } else if (line.trim() === LOST) c.lost = true;
  }
  byPair.set(key, c);
}

// 終わったテストの記録を書く
function writeRecord(byPair: Map<string, Captured>, event: FinishedEvent): void {
  const r = event.result;
  if (!r.selected) return; // 選ばれなかったテストにも test-finished が来る
  const side = r.target.name; // イベントの result は target を { name, platform } で持つ
  if (side !== "current" && side !== "new") return;
  const test = [r.test.file, ...r.test.titlePath].join(" › ");
  const status = STATUS[r.status] ?? String(r.status);
  const c = byPair.get(keyOf(side, { testId: r.test.id, agent: r.agent, repeat: r.repeat }));
  // リトライのどれかの試行が LOST なら、MARK のある試行があっても書かない（LOST の試行のエラーが記録から消える）
  if (status !== "skipped" && (!c || !c.marked || c.lost)) {
    process.stderr.write(
      `runtime-errors: 記録を取り出せなかったので書かない: ${test}（${c?.lost ? "LOST" : "行が無い"}）\n`,
    );
    return;
  }
  const out = outputDir(side);
  const name = createHash("sha256").update(test).digest("hex").slice(0, 16);
  writeJsonAtomic(join(out.dir, `${name}.json`), {
    version: RUNTIME_ERRORS_VERSION,
    side,
    slug: out.slug,
    target: out.target,
    run: out.run,
    test,
    status,
    retry: Math.max(0, (r.attempts?.length ?? 1) - 1),
    events: c?.events ?? [],
  });
}

export function runtimeErrorsReporter(): { name: string; onEvent(event: { type: string }): void } {
  const byPair = new Map<string, Captured>();
  return {
    name: "parity-runtime-errors",
    onEvent(event: { type: string }) {
      if (process.env.PARITY_RUNTIME_CAPTURE !== "1") return;
      try {
        if (isOutput(event)) collectOutput(byPair, event);
        else if (isFinished(event)) writeRecord(byPair, event);
      } catch (e) {
        // onEvent は投げてはいけない（e2e の取り決め）。書けなかったテストは記録が欠けたテストとして比較で止まる
        process.stderr.write(`runtime-errors: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    },
  };
}
