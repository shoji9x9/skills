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

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    die(`${path} を読めない: ${err.message}`);
  }
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
  const named = /^eval-(\d+)$/.exec(evalDir);
  if (named && Number(named[1]) !== evalId) {
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
  if (typeof summary.pass_rate !== "number" || round(summary.pass_rate, 4) !== computedRate) {
    die(
      `${gradingPath}: summary.pass_rate=${summary.pass_rate} が採点内訳（${computedRate}）と違う`,
    );
  }

  const seconds = timing.total_duration_seconds;
  if (typeof seconds !== "number") die(`${timingPath}: total_duration_seconds が数値でない`);
  const tokens = timing.total_tokens ?? 0;
  if (typeof tokens !== "number") die(`${timingPath}: total_tokens が数値でない`);
  const metricsPath = join(runDir, "outputs", "metrics.json");
  const metrics = existsSync(metricsPath) ? readJson(metricsPath) : {};

  return {
    runDir,
    executor: timing.executor ?? null,
    run: {
      eval_id: evalId,
      configuration,
      run_number: runNumber(runDir),
      result: {
        pass_rate: summary.pass_rate,
        passed,
        failed,
        total: expectations.length,
        time_seconds: seconds,
        tokens,
        tool_calls: metrics.total_tool_calls ?? 0,
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

  const counts = new Set(perPair.values());
  counts.delete(0);
  if (counts.size !== 1) {
    die(
      "eval × configuration ごとの run 数が揃っていない（" +
        [...perPair].map(([k, v]) => `${k}=${v}`).join(", ") +
        "）。揃えるか iteration を分ける",
    );
  }
  const runsPerConfiguration = [...counts][0];

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
    notes = path.endsWith(".json")
      ? readJson(path)
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
