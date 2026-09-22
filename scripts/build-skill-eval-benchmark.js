#!/usr/bin/env node
// eval の採点結果を `benchmark.json` へ集計する。
//
// 集計を毎 iteration の書き捨てスクリプトで組み立てていたため、判定を位置（配列 index）で
// 対応づけて件数を誤った（`parity-diff` #27 の `without_skill` を 1/6 と 2/6 の両方で数えた。
// Issue #421 / `.kaizen/2026-09-17-eval-benchmark-assembled-ad-hoc.md`）。
// この集計は **assertion テキストをキーにした入力だけを受理する**。
//
//   - assertion テキストの正本は各 run の `eval_metadata.json`（run 時点の宣言）。
//     `evals.json` から採ると、後から assertion を変えたときに過去の記録のテキストがずれる。
//   - 判定（`grading.json`）はテキストをキーにして突き合わせる。**位置配列は受理しない。**
//   - キー集合の不一致・件数の不一致・採点内訳と summary の食い違いは exit 2。
//
// 使い方:
//   node scripts/build-skill-eval-benchmark.js <iteration-dir> \
//     --skill-name <name> --skill-path '<repo>/skills/<name>' \
//     --executor-model <id> --analyzer-model <id> \
//     [--notes-file <path>] [--timestamp <ISO8601>] [--out <path>] [--force] [--stdout] \
//     [--ungraded fail|skip]
//
// 終了コード: 0 = 生成した / 2 = 使い方・入力・整合性の誤り
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const CONFIGURATIONS = ["with_skill", "without_skill"];

function die(message) {
  console.error(`build-skill-eval-benchmark: ${message}`);
  process.exit(2);
}

function usage(message) {
  console.error(
    "usage: node scripts/build-skill-eval-benchmark.js <iteration-dir> --skill-name <name> " +
      "--skill-path <path> --executor-model <id> --analyzer-model <id> " +
      "[--notes-file <path>] [--timestamp <ISO8601>] [--out <path>] [--force] [--stdout] " +
      "[--ungraded fail|skip]",
  );
  die(message);
}

function parseArgs(argv) {
  const opts = { ungraded: "fail", force: false, stdout: false };
  const positional = [];
  const withValue = {
    "--skill-name": "skillName",
    "--skill-path": "skillPath",
    "--executor-model": "executorModel",
    "--analyzer-model": "analyzerModel",
    "--notes-file": "notesFile",
    "--timestamp": "timestamp",
    "--out": "out",
    "--ungraded": "ungraded",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") opts.force = true;
    else if (arg === "--stdout") opts.stdout = true;
    else if (arg in withValue) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) usage(`${arg} に値がない`);
      opts[withValue[arg]] = value;
    } else if (arg.startsWith("-")) usage(`不明な引数: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) usage("iteration ディレクトリを 1 つ指定する");
  for (const [flag, key] of Object.entries(withValue)) {
    if (["--notes-file", "--timestamp", "--out", "--ungraded"].includes(flag)) continue;
    if (!opts[key]) usage(`${flag} は必須`);
  }
  if (!["fail", "skip"].includes(opts.ungraded)) usage("--ungraded は fail | skip");
  opts.dir = resolve(positional[0]);
  if (!existsSync(opts.dir) || !statSync(opts.dir).isDirectory()) {
    die(`iteration ディレクトリが無い: ${opts.dir}`);
  }
  return opts;
}

/** `--notes-file` の JSON（文字列配列）を読む。成果物の JSON とは形が違うので別扱い。 */
function parseNotesJson(path, raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    die(`${path} を読めない: ${err.message}`);
  }
}

function readJson(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    die(`${path} を読めない: ${err.message}`);
  }
  // **形も宣言済みの出口へ寄せる。** run が途中で落ちた成果物は `null` やスカラーになりうる。
  // 素通りさせると後続のプロパティ参照が TypeError（exit 1）になり、このスクリプトが
  // 宣言していない出口で落ちる（0 = 生成した / 2 = 入力・整合性の誤り）。
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    die(`${path} が JSON オブジェクトでない（${Array.isArray(value) ? "配列" : String(value)}）`);
  }
  return value;
}

/** Python の `round(x, n)`（偶数丸め）に合わせる。既存の benchmark.json と数値を揃えるため。 */
function round(value, digits) {
  if (typeof value !== "number" || !Number.isFinite(value))
    die(`数値でない値を丸めようとした: ${value}`);
  if (Number.isInteger(value)) return value;
  // 二重丸めを避けるため、まず double の十進展開を十分な桁で採ってから桁を落とす。
  const exact = value.toFixed(20);
  const [intPart, fracPart] = exact.split(".");
  const keep = fracPart.slice(0, digits);
  const rest = fracPart.slice(digits);
  let result = Number(`${intPart}.${keep || "0"}`);
  const step = Number(`1e-${digits}`);
  const half = `5${"0".repeat(Math.max(0, rest.length - 1))}`;
  const sign = value < 0 ? -1 : 1;
  if (rest > half) result += sign * step;
  else if (rest === half) {
    // ちょうど半分は偶数側へ（Python の既定）。
    const last = Number(keep.slice(-1) || "0");
    if (last % 2 === 1) result += sign * step;
  }
  return Number(result.toFixed(digits));
}

/** 数値の小数桁数（保存された精度を知るため）。指数表記は桁を読めないので 4 桁として扱う。 */
function decimals(value) {
  const text = String(value);
  if (text.includes("e") || text.includes("E")) return 4;
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 標本標準偏差（n-1）。1 件のときは 0（母集団が 1 点なのでばらつきを語らない）。 */
function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function stats(values) {
  return {
    mean: round(mean(values), 4),
    stddev: round(stdev(values), 4),
    min: round(Math.min(...values), 4),
    max: round(Math.max(...values), 4),
  };
}

function signed(value, digits) {
  const fixed = Math.abs(value).toFixed(digits);
  return `${value < 0 ? "-" : "+"}${fixed}`;
}

/**
 * 判定を **assertion テキストをキーにしたマップ**で受け取る。
 * 位置配列（`[true, ...]` / `[[true, "..."], ...]`）と `text` を持たない要素は受理しない
 * ——位置で対応づけると、assertion の追加・削除・並べ替えで判定がずれる（Issue #421）。
 */
function verdictsFromGrading(grading, where) {
  const map = new Map();
  const add = (text, verdict, at) => {
    if (typeof text !== "string" || text.length === 0) {
      die(`${where}: ${at} の assertion テキストが非空の文字列でない（位置配列は受理しない）`);
    }
    if (map.has(text)) die(`${where}: assertion テキストが重複している: ${text}`);
    if (typeof verdict?.passed !== "boolean") die(`${where}: ${at} の passed が真偽値でない`);
    const evidence = verdict.evidence;
    if (typeof evidence !== "string" || evidence.length === 0) {
      die(`${where}: ${at} の evidence が非空の文字列でない`);
    }
    map.set(text, { passed: verdict.passed, evidence });
  };

  // **両方あるなら、どちらが正本か決められない。** `verdicts` を優先して `expectations` を
  // 黙って無視すると、viewer が読む `expectations` と benchmark の判定が食い違ったまま通る。
  if (grading.verdicts !== undefined && grading.expectations !== undefined) {
    die(`${where}: verdicts と expectations の両方がある（どちらが正本か決められない）`);
  }
  if (grading.verdicts !== undefined) {
    if (
      typeof grading.verdicts !== "object" ||
      grading.verdicts === null ||
      Array.isArray(grading.verdicts)
    ) {
      die(
        `${where}: verdicts は assertion テキストをキーにしたオブジェクトで渡す（配列は受理しない）`,
      );
    }
    for (const [text, verdict] of Object.entries(grading.verdicts)) {
      add(text, verdict, `verdicts[${JSON.stringify(text)}]`);
    }
    return map;
  }
  if (!Array.isArray(grading.expectations)) {
    die(`${where}: expectations（配列）か verdicts（テキストをキーにしたオブジェクト）が要る`);
  }
  grading.expectations.forEach((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      die(
        `${where}: expectations[${i}] が {text, passed, evidence} のオブジェクトでない（位置配列は受理しない）`,
      );
    }
    add(item.text, item, `expectations[${i}]`);
  });
  return map;
}

function listDirs(parent, prefix) {
  return readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
    .map((e) => e.name)
    .sort();
}

/** run 1 件を読み、集計に使う形へ正規化する。 */
function loadRun(runDir, configuration, evalDir) {
  const metaPath = join(runDir, "eval_metadata.json");
  const gradingPath = join(runDir, "grading.json");
  const timingPath = join(runDir, "timing.json");
  if (!existsSync(metaPath))
    die(`${runDir}: eval_metadata.json が無い（assertion テキストの正本）`);
  if (!existsSync(timingPath)) die(`${runDir}: timing.json が無い（時間・トークンの正本）`);
  const meta = readJson(metaPath);
  const grading = readJson(gradingPath);
  const timing = readJson(timingPath);

  const evalId = meta.eval_id;
  if (!Number.isInteger(evalId)) die(`${metaPath}: eval_id が整数でない`);
  // **ディレクトリ名と宣言を突き合わせる。** run 数の突き合わせはディレクトリ単位、集計の
  // キーは `eval_id` なので、食い違うと「eval-27 の run が 26 として数えられる」取り違えが
  // 黙って通る（位置で対応づけて件数を誤ったのと同じクラス。Issue #421）。
  // 形は `eval-<番号>` か `eval-<番号>-<注記>`（本リポの成果物に `eval-31-mutation-ownership` 等が
  // 4 件ある）。**形に合わない名前は突き合わせを飛ばさず落とす**——飛ばすと `eval-27b` や
  // `eval-1 copy` が eval として採り込まれ、eval_id の重複に気づけない。
  const named = /^eval-(\d+)(?:-[\w.-]+)?$/.exec(evalDir);
  if (!named) {
    die(
      `${evalDir}: eval ディレクトリ名が eval-<番号> または eval-<番号>-<注記> でない。` +
        "名前を揃えるか、iteration から外す",
    );
  }
  if (Number(named[1]) !== evalId) {
    die(`${metaPath}: eval_id=${evalId} がディレクトリ名（${evalDir}）と違う`);
  }
  if (!Array.isArray(meta.assertions) || meta.assertions.length === 0) {
    die(`${metaPath}: assertions が空`);
  }
  const assertions = meta.assertions.map((text, i) => {
    if (typeof text !== "string" || text.length === 0) {
      die(`${metaPath}: assertions[${i}] が非空の文字列でない`);
    }
    return text;
  });
  if (new Set(assertions).size !== assertions.length) {
    die(`${metaPath}: assertions のテキストが重複している（テキストでキーにできない）`);
  }

  const verdicts = verdictsFromGrading(grading, gradingPath);
  // **キー集合で突き合わせる。** 件数だけ見ると、1 件の取り違えが相殺で通る。
  const missing = assertions.filter((t) => !verdicts.has(t));
  const extra = [...verdicts.keys()].filter((t) => !assertions.includes(t));
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length)
      parts.push(`判定の無い assertion ${missing.length} 件: ${missing.join(" / ")}`);
    if (extra.length) parts.push(`宣言に無い判定 ${extra.length} 件: ${extra.join(" / ")}`);
    die(`${gradingPath}: ${metaPath} とキー集合が一致しない。${parts.join("、")}`);
  }
  if (verdicts.size !== assertions.length) {
    die(
      `${gradingPath}: 判定の件数（${verdicts.size}）が assertion の件数（${assertions.length}）と違う`,
    );
  }

  const expectations = assertions.map((text) => ({ text, ...verdicts.get(text) }));
  const passed = expectations.filter((e) => e.passed).length;
  const failed = expectations.length - passed;
  const summary = grading.summary;
  if (typeof summary !== "object" || summary === null) die(`${gradingPath}: summary が無い`);
  // 採点の内訳と summary の食い違いを落とす（どちらかが手で書き換えられている）。
  for (const [key, want] of [
    ["passed", passed],
    ["failed", failed],
    ["total", expectations.length],
  ]) {
    if (summary[key] !== want) {
      die(`${gradingPath}: summary.${key}=${summary[key]} が採点内訳（${want}）と違う`);
    }
  }
  const computedRate = round(passed / expectations.length, 4);
  if (typeof summary.pass_rate !== "number") {
    die(`${gradingPath}: summary.pass_rate が数値でない`);
  }
  // **保存値の桁に合わせて比べる。** `pass_rate` の小数桁は規約が定めていないので、採点者は
  // 0.56（= 5/9）のように 2〜3 桁で保存する（本リポの既存成果物に 10 件ある）。4 桁固定で
  // 比べると、内訳が正しい採点を「summary と食い違う」と誤報して落とす。
  // 桁は 1〜4 に収める——0 桁（整数で保存）をそのまま使うと 1 と 0.6667 が同じに丸まって弁別が消える。
  const storedDigits = decimals(summary.pass_rate);
  const digits = Math.min(Math.max(storedDigits, 1), 4);
  if (round(computedRate, digits) !== round(summary.pass_rate, digits)) {
    die(
      `${gradingPath}: summary.pass_rate=${summary.pass_rate} が採点内訳（${computedRate}）と違う`,
    );
  }

  const seconds = timing.total_duration_seconds;
  if (typeof seconds !== "number") die(`${timingPath}: total_duration_seconds が数値でない`);
  // **記録が無いトークンを 0 で埋めない。** 0 として mean / min / max / Delta に混ぜると、
  // 計測できていない run が「トークン 0」の観測として報告される（実測で `delta.tokens` が
  // 実在しない値になった）。時間と同じく型で落とす。
  const tokens = timing.total_tokens;
  if (typeof tokens !== "number") die(`${timingPath}: total_tokens が数値でない`);
  // `metrics.json` が無いのは成果物が切り詰められた形なので落とす（20 件の旧 run が該当）。
  // **キーが `null` なのは別の状態**——正規化器が「この executor では測れない」を明示した形
  // （`total_tool_calls` は 436 件中 235 件が null）。その場合だけ 0 として記録する。
  const metricsPath = join(runDir, "outputs", "metrics.json");
  if (!existsSync(metricsPath)) {
    die(`${runDir}: outputs/metrics.json が無い（tool_calls / errors の正本）`);
  }
  const metrics = readJson(metricsPath);
  // キー無し・`null` は「この executor では測れない」（実データでは `total_tool_calls` が
  // 145 件キー無し）。0 として記録する。**数値でも null でもない値だけ**を落とす。
  for (const key of ["total_tool_calls", "errors_encountered"]) {
    const value = metrics[key];
    if (value !== undefined && value !== null && typeof value !== "number") {
      die(`${metricsPath}: ${key} が数値でも null でもない`);
    }
  }

  return {
    runDir,
    assertions,
    executor: timing.executor ?? null,
    run: {
      eval_id: evalId,
      configuration,
      run_number: runNumber(runDir),
      result: {
        // **導出値を書く。** `pass_rate` は `passed / total` から一意に決まるので、採点者が
        // 丸めて保存した値を載せると benchmark が採点内訳と違う数字を報告する
        // （0.7 と保存された 2/3 が平均・Delta まで 0.7 として流れる。実測）。
        // 保存値は上の整合検査の入力に留める。既存記録（iteration-13 / 24）の再生成は
        // 保存値＝導出値なので一致したままであることを実測済み。
        pass_rate: computedRate,
        passed,
        failed,
        total: expectations.length,
        time_seconds: seconds,
        tokens,
        tool_calls: metrics.total_tool_calls ?? 0, // null = この executor では測れない
        errors: metrics.errors_encountered ?? 0,
      },
      expectations,
      notes: [],
    },
  };
}

function runNumber(runDir) {
  const m = /run-(\d+)$/.exec(runDir);
  if (!m) die(`${runDir}: run ディレクトリ名から run 番号を読めない`);
  return Number(m[1]);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const evalDirs = listDirs(opts.dir, "eval-");
  if (evalDirs.length === 0)
    die(`${opts.dir}: eval-* ディレクトリが無い（対象 0 件を成功に倒さない）`);

  // **実在する子ディレクトリを列挙して、知らない名前を黙って捨てない。** 既知の 2 名だけを
  // `existsSync` で拾う形だと、`without-skill` のような 1 文字違いの成果物が誰にも告げられずに
  // 集計から消え、「片側だけの iteration」として exit 0 で通る（実測）。除外は人が明示する。
  const unknownDirs = [];
  for (const evalDir of evalDirs) {
    for (const name of listDirs(join(opts.dir, evalDir), "")) {
      if (!CONFIGURATIONS.includes(name)) unknownDirs.push(`${evalDir}/${name}`);
    }
  }
  if (unknownDirs.length > 0) {
    die(
      `configuration に使えないディレクトリがある（${unknownDirs.join(", ")}）。` +
        `名前を ${CONFIGURATIONS.join(" / ")} に揃えるか、iteration から外す`,
    );
  }

  const loaded = [];
  const ungraded = [];
  const perPair = new Map();
  const presentByEval = new Map(evalDirs.map((d) => [d, []]));
  for (const configuration of CONFIGURATIONS) {
    for (const evalDir of evalDirs) {
      const configDir = join(opts.dir, evalDir, configuration);
      if (!existsSync(configDir)) continue;
      presentByEval.get(evalDir).push(configuration);
      const runDirs = listDirs(configDir, "run-");
      if (runDirs.length === 0) die(`${configDir}: run-* ディレクトリが無い`);
      // `run-` に一致しないディレクトリも同じく黙って落とさない（`run1` / `retry-run-2` 等）。
      const strayRuns = listDirs(configDir, "").filter((n) => !runDirs.includes(n));
      if (strayRuns.length > 0) {
        die(
          `run ディレクトリの名前が run-<番号> でない（${strayRuns.map((n) => `${evalDir}/${configuration}/${n}`).join(", ")}）。` +
            "名前を揃えるか、iteration から外す",
        );
      }
      let graded = 0;
      for (const runDir of runDirs) {
        const abs = join(configDir, runDir);
        if (!existsSync(join(abs, "grading.json"))) {
          // 汚染・`invalid_run` の run は `grading.json` を置かない運用。**黙って落とさない。**
          ungraded.push(abs);
          continue;
        }
        loaded.push(loadRun(abs, configuration, evalDir));
        graded++;
      }
      perPair.set(`${evalDir}/${configuration}`, graded);
    }
  }

  if (ungraded.length > 0) {
    console.error(`採点の無い run が ${ungraded.length} 件ある:`);
    for (const p of ungraded) console.error(`  ${p}`);
    if (opts.ungraded === "fail") {
      die(
        "採点の無い run を黙って除外しない。取り直すか、除外を承知のうえで --ungraded skip を付けて、除外した件数とパスを notes に残す",
      );
    }
    console.error("--ungraded skip: 上記を集計から除外した（除外の経緯は notes に残す）");
  }
  if (loaded.length === 0) die(`${opts.dir}: 採点済みの run が 1 件も無い`);

  // executor / model が混ざった run を同じ母集団へ集計しない（iteration を分ける）。
  const executorKeys = new Set(
    loaded.map((r) =>
      JSON.stringify([
        r.executor?.name ?? null,
        r.executor?.model ?? null,
        r.executor?.reasoning_effort ?? null,
      ]),
    ),
  );
  // **「記録が無い」を「揃っている」に倒さない。** `timing.executor` を欠く run ばかりだと
  // キーが全部 `[null,null,null]` になり、本当に混ざっていても size 1 で素通りする
  // （本リポの成果物にも executor を欠く run が 20 件ある）。名前は必須にする。
  const missingExecutor = loaded.filter((r) => !r.executor?.name).map((r) => r.runDir);
  if (missingExecutor.length > 0) {
    die(
      `timing.json に executor.name が無い run がある（${missingExecutor.length} 件。例: ${missingExecutor[0]}）。` +
        "executor を記録した run で取り直す（記録が無いと母集団が揃っているか確かめられない）",
    );
  }
  if (executorKeys.size > 1) {
    die(
      `executor / model / effort が混ざっている（iteration を分ける）: ${[...executorKeys].join(" | ")}`,
    );
  }
  console.error(`executor（timing.json 実測）: ${[...executorKeys][0]}`);

  // **configuration の欠落を「揃っている」に倒さない。** `perPair` には存在しない
  // configuration のエントリが立たないので、片側だけの eval は run 数の突き合わせを素通りし、
  // Delta が**eval 集合の違う母集団同士**の比較になる（with は 2 eval・without は 1 eval でも
  // `runs_per_configuration` は 1 のまま揃って見える）。iteration 全体が片側だけ（Delta を
  // 出さない）のは許すので、**eval 間で揃っているか**を見る。
  const shapes = new Map();
  for (const [evalDir, configs] of presentByEval) {
    const key = configs.join("+") || "(configuration なし)";
    if (!shapes.has(key)) shapes.set(key, []);
    shapes.get(key).push(evalDir);
  }
  if (shapes.size > 1) {
    die(
      "eval ごとに揃っている configuration が違う（" +
        [...shapes].map(([k, v]) => `${k}: ${v.join(", ")}`).join(" / ") +
        "）。揃えるか iteration を分ける",
    );
  }

  // **採点済み 0 件の pair を 0 のまま捨てない。** `--ungraded skip` で片側の run が全部
  // 未採点になった pair は `graded` が 0 になり、その 0 を集合から消すと run 数の突き合わせを
  // 素通りする（ディレクトリは在るので上の configuration 検査も通る）。実測で、with_skill が
  // 2 eval・without_skill が 1 eval のまま `delta` が出た。除外の判断は人が下すので落とす。
  const emptyPairs = [...perPair].filter(([, n]) => n === 0).map(([k]) => k);
  if (emptyPairs.length > 0) {
    die(
      `採点済みの run が 1 件も無い eval × configuration がある（${emptyPairs.join(", ")}）。` +
        "取り直すか、その eval を iteration から外す（--ungraded skip は余分な run の除外にしか使えない）",
    );
  }
  const counts = new Set(perPair.values());
  if (counts.size !== 1) {
    die(
      "eval × configuration ごとの run 数が揃っていない（" +
        [...perPair].map(([k, v]) => `${k}=${v}`).join(", ") +
        "）。揃えるか iteration を分ける",
    );
  }
  const runsPerConfiguration = [...counts][0];

  // **同じ (eval_id, configuration, run_number) の run が 2 件あれば落とす。** 置き直した
  // コピー（`eval-1` と `eval-1-retry` が同じ eval_id）や `run-1` / `run-01` の同居で、
  // 片方の eval が 2 倍の重みで mean に入るのを防ぐ（成果物からは判別できない）。
  const seenRuns = new Map();
  for (const r of loaded) {
    const key = `${r.run.eval_id}/${r.run.configuration}/run-${r.run.run_number}`;
    if (seenRuns.has(key)) {
      die(
        `同じ run（${key}）が 2 つのディレクトリから来ている: ${seenRuns.get(key)} と ${r.runDir}。` +
          "置き直したコピーを iteration から外す",
      );
    }
    seenRuns.set(key, r.runDir);
  }

  // **同じ eval の run が同じ assertion 集合を採点していることを確かめる。** run の合間に
  // `evals.json` を編集すると、各 run は自分の宣言と整合したまま assertion 数が変わり、
  // `pass_rate` の分母が run 間で違う（mean / stddev / delta が別の採点基準の混合平均になる）。
  // eval_id とディレクトリ名・executor の混在と同じ「母集団を混ぜない」検査。
  const assertionSets = new Map();
  for (const r of loaded) {
    const key = r.run.eval_id;
    const set = JSON.stringify([...r.assertions].sort());
    if (!assertionSets.has(key)) assertionSets.set(key, new Map());
    const byShape = assertionSets.get(key);
    if (!byShape.has(set)) byShape.set(set, []);
    byShape.get(set).push(`${r.run.configuration}/run-${r.run.run_number}`);
  }
  for (const [evalId, byShape] of assertionSets) {
    if (byShape.size > 1) {
      die(
        `eval ${evalId} の run が違う assertion 集合を採点している（` +
          [...byShape]
            .map(([set, runs]) => `${runs.join(" ")}: ${JSON.parse(set).length} 件`)
            .join(" / ") +
          "）。run の合間に assertion を変えた iteration は分ける",
      );
    }
  }

  const runs = loaded.map((r) => r.run);
  const evalsRun = [...new Set(runs.map((r) => r.eval_id))].sort((a, b) => a - b);

  const runSummary = {};
  for (const configuration of CONFIGURATIONS) {
    const rows = runs.filter((r) => r.configuration === configuration);
    if (rows.length === 0) continue;
    runSummary[configuration] = {
      pass_rate: stats(rows.map((r) => r.result.pass_rate)),
      time_seconds: stats(rows.map((r) => r.result.time_seconds)),
      tokens: stats(rows.map((r) => r.result.tokens)),
    };
  }
  const [a, b] = CONFIGURATIONS;
  if (runSummary[a] && runSummary[b]) {
    runSummary.delta = {
      pass_rate: signed(runSummary[a].pass_rate.mean - runSummary[b].pass_rate.mean, 2),
      time_seconds: signed(runSummary[a].time_seconds.mean - runSummary[b].time_seconds.mean, 1),
      tokens: signed(runSummary[a].tokens.mean - runSummary[b].tokens.mean, 0),
    };
  }

  let notes = [];
  if (opts.notesFile) {
    const path = resolve(opts.notesFile);
    if (!existsSync(path)) die(`--notes-file が無い: ${path}`);
    const raw = readFileSync(path, "utf8");
    // notes は**文字列配列**なので `readJson`（plain object を要求する）は通さない。
    notes = path.endsWith(".json")
      ? parseNotesJson(path, raw)
      : raw
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
    if (!Array.isArray(notes) || notes.some((n) => typeof n !== "string")) {
      die(`--notes-file は 1 行 1 note のテキストか、文字列配列の JSON`);
    }
  }

  const benchmark = {
    metadata: {
      skill_name: opts.skillName,
      skill_path: opts.skillPath,
      executor_model: opts.executorModel,
      analyzer_model: opts.analyzerModel,
      timestamp: opts.timestamp ?? `${new Date().toISOString().slice(0, 19)}Z`,
      evals_run: evalsRun,
      runs_per_configuration: runsPerConfiguration,
    },
    runs,
    run_summary: runSummary,
    notes,
  };

  const json = `${JSON.stringify(benchmark, null, 2)}\n`;
  if (opts.stdout) {
    process.stdout.write(json);
    return;
  }
  const out = resolve(opts.out ?? join(opts.dir, "benchmark.json"));
  if (existsSync(out) && !opts.force) {
    die(`${out} が既にある。手で足した notes を消さないため、上書きするなら --force を付ける`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(
    `${out}: runs=${runs.length} evals=${evalsRun.length} runs_per_configuration=${runsPerConfiguration}`,
  );
}

main();
