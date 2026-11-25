// 撮影の前に、ページの時刻と乱数を固定する（原本）。
// 原本はこのスキル側にあり、実行時はプロジェクトの `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う。
// 現側の採取のスペックと、parity-diff の新側の採取の雛形が、同じコピーを import する。
//
// なぜ要るか: アニメーションを止めてマスクを当てても、ページが読む時刻（`Date`）と乱数（`Math.random`・`crypto`）は
// 撮るたびに変わる。「〜分前」の表示、日付で決まる表示、乱数で決まる並びや ID は、2 回撮るだけで差分になり、
// マスクで隠すしかなかった。
//
// 固定するものは次のとおりである。
//   - 時刻: Playwright の `page.clock.setFixedTime` で、`Date.now()` と `new Date()` が固定の時刻を返すようにする。
//     タイマー（setTimeout・requestAnimationFrame）は止めない。止めると、ノイズを測る 2 回撮りで揺れを 0 と記録してしまう。
//     出典: https://playwright.dev/docs/api/class-clock#clock-set-fixed-time
//   - 乱数: `page.addInitScript` で、ページの scripts より先に `Math.random`・`crypto.getRandomValues`・
//     `crypto.randomUUID` を seed 付きの関数に差し替える。init script はすべてのフレームで、文書を作るたびに実行される。
//     出典: https://playwright.dev/docs/api/class-page#page-add-init-script
//
// 乱数の固定の限界: 同じ seed でも、ページが乱数を呼ぶ順序と回数が違えば、違う値になる。
// 現行と新側は実装が違うので、seed を揃えても乱数で決まる表示が揃うとは限らない。揃わなければ、parity-diff の差分として報告される。
// Web Worker・Service Worker の中の乱数と、サーバーが決める値は、ここでは固定しない。
//
// 記録: 固定した時刻と seed は `metadata.json.capture_conditions.determinism` に書き、parity-diff は同じ値で新側を撮る。
// 形と、記録が無いときの扱いの原本は parity-suite の references/baseline.md「時刻と乱数を固定する」である。
//
// Playwright はピア前提であり import しない（Page は引数で受け取る）。TypeScript 構文は使わない（型は JSDoc）。

import { PAGE_VERSION, installSeededRandom } from "./page/determinism.page.mjs";

/**
 * ツールのバージョン（原本）。読み取りの規則・当て方・確かめ方を変えたら上げる。
 * 上げるときは、page/determinism.page.mjs の PAGE_VERSION も同じ値にする（違うと applyDeterminism が当てずに止める）。
 * @type {string}
 */
export const VERSION = "1";

/**
 * page ファイルの PAGE_VERSION が、このスクリプトの VERSION と同じかを確かめる。違えば、片方だけを古いバージョンのまま
 * コピーしてあるので、当てずに失敗する。
 * @param {string} pageVersion
 */
export function assertPageVersion(pageVersion) {
  if (pageVersion !== VERSION) {
    throw new Error(
      `determinism: page/determinism.page.mjs has PAGE_VERSION ${pageVersion} but determinism.mjs has VERSION ${VERSION}; copy both files from the same version`,
    );
  }
}

/** seed に使える最大の値（32 ビットの符号なし整数）。 */
const MAX_SEED = 0xffffffff;

/** 時刻の書式。タイムゾーンを省いた形は、撮る環境のタイムゾーンで解釈が変わるので受け付けない。 */
const FIXED_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * 時刻の文字列を UTC のミリ秒にする。暦に無い日時（2 月 31 日・24 時など）とオフセットは null にする。
 * `Date.parse` は暦に無い日付を次の月へ繰り越して有限の値を返す（`2026-02-31` は `2026-03-03` になる）ので、
 * 年月日と時分秒を組み立て直して、入力と同じになるかで確かめる。
 * @param {string} value - FIXED_TIME_PATTERN に一致した文字列
 * @returns {number | null}
 */
function parseFixedTime(value) {
  const match = FIXED_TIME_PATTERN.exec(value);
  if (match === null) return null;
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    fraction = "",
    ,
    sign,
    offsetHour = "0",
    offsetMinute = "0",
  ] = match;
  const fields = [year, month, day, hour, minute, second].map(Number);
  const local = Date.UTC(
    fields[0],
    fields[1] - 1,
    fields[2],
    fields[3],
    fields[4],
    fields[5],
    Number(fraction.padEnd(3, "0")),
  );
  const back = new Date(local);
  const same = [
    back.getUTCFullYear(),
    back.getUTCMonth() + 1,
    back.getUTCDate(),
    back.getUTCHours(),
    back.getUTCMinutes(),
    back.getUTCSeconds(),
  ].every((n, i) => n === fields[i]);
  if (!same || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;
  const offset =
    sign === undefined
      ? 0
      : (sign === "-" ? -1 : 1) * (Number(offsetHour) * 60 + Number(offsetMinute));
  return local - offset * 60000;
}

/**
 * 撮影に当てる時刻と乱数の条件。
 * @typedef {{ fixedTimeMs: number | null, randomSeed: number | null }} Determinism
 */

/**
 * テンプレートの `<…>` や TODO のまま残した理由か。
 * @param {string} text
 * @returns {boolean}
 */
function isPlaceholder(text) {
  // `\b` は ASCII の英数字との境界にしか当たらないので、日本語の「未確認」には付けない
  return /^<.*>$/s.test(text) || /^(?:(?:TODO|TBD)\b|未確認)/i.test(text);
}

/**
 * 時刻の記録を読む。形が違えば例外にする。
 * @param {Record<string, unknown>} record
 * @returns {{ fixedTimeMs: number | null }}
 */
function readFixedTime(record) {
  if (!Object.hasOwn(record, "fixed_time")) {
    throw new Error(
      "determinism.fixed_time is missing (固定した時刻の ISO 8601 か、固定しないなら null と fixed_time_reason を書く)",
    );
  }
  const value = record.fixed_time;
  if (value === null) {
    const reason = record.fixed_time_reason;
    if (typeof reason !== "string" || reason.trim() === "" || isPlaceholder(reason.trim())) {
      throw new Error(
        "determinism.fixed_time is null but fixed_time_reason is missing or a placeholder",
      );
    }
    return { fixedTimeMs: null };
  }
  if (typeof value !== "string" || !FIXED_TIME_PATTERN.test(value)) {
    throw new Error(
      `determinism.fixed_time must be ISO 8601 with a timezone (e.g. 2026-01-02T03:04:05Z) or null (got ${JSON.stringify(value)})`,
    );
  }
  const ms = parseFixedTime(value);
  if (ms === null) {
    throw new Error(`determinism.fixed_time is not a valid date (got ${JSON.stringify(value)})`);
  }
  return { fixedTimeMs: ms };
}

/**
 * seed の記録を読む。形が違えば例外にする。
 * @param {Record<string, unknown>} record
 * @returns {{ randomSeed: number | null }}
 */
function readRandomSeed(record) {
  if (!Object.hasOwn(record, "random_seed")) {
    throw new Error(
      "determinism.random_seed is missing (seed 付きにするなら 0〜4294967295 の整数、しないなら null を書く)",
    );
  }
  const value = record.random_seed;
  if (value === null) return { randomSeed: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_SEED) {
    throw new Error(
      `determinism.random_seed must be an integer from 0 to ${MAX_SEED} or null (got ${JSON.stringify(value)})`,
    );
  }
  return { randomSeed: value };
}

/**
 * `capture_conditions` から時刻と乱数の条件を読む。
 * 記録が無い・形が違うときは例外にする（撮らずに止まる）。記録が無いまま撮ると、現側と新側で時刻と乱数の扱いが揃っているかを
 * 誰も確かめられない。
 * @param {unknown} captureConditions - metadata.json の capture_conditions
 * @returns {Determinism}
 */
export function readDeterminism(captureConditions) {
  if (captureConditions === null || typeof captureConditions !== "object") {
    throw new Error("capture_conditions is missing: parity-suite で撮影条件を記録させる");
  }
  const record = "determinism" in captureConditions ? captureConditions.determinism : undefined;
  if (record === undefined) {
    throw new Error(
      "capture_conditions.determinism is missing: parity-suite で時刻と乱数の扱いを記録させる（baseline.md「時刻と乱数を固定する」）",
    );
  }
  // JSON から読んだオブジェクトだけを受け付ける（配列・null・文字列を落とす）
  if (
    record === null ||
    typeof record !== "object" ||
    Object.getPrototypeOf(record) !== Object.prototype
  ) {
    throw new Error(
      `capture_conditions.determinism must be an object (got ${JSON.stringify(record)})`,
    );
  }
  /** @type {Record<string, unknown>} */
  const fields = Object.fromEntries(Object.entries(record));
  return { ...readFixedTime(fields), ...readRandomSeed(fields) };
}

/**
 * 時刻と乱数の条件をページに当てる。ページを開く（`page.goto`）前に呼ぶ。
 * 開いた後に呼ぶと、最初の文書の scripts は固定する前の時刻と乱数を読む。
 * @param {{
 *   clock: { setFixedTime(time: Date): Promise<void> },
 *   addInitScript(script: (arg: number) => void, arg: number): Promise<void>,
 * }} page
 * @param {Determinism} determinism - readDeterminism の戻り値
 */
export async function applyDeterminism(page, determinism) {
  assertPageVersion(PAGE_VERSION);
  if (determinism.fixedTimeMs !== null)
    await page.clock.setFixedTime(new Date(determinism.fixedTimeMs));
  if (determinism.randomSeed !== null)
    await page.addInitScript(installSeededRandom, determinism.randomSeed);
}

/**
 * ページで読んだ値（最初の時刻・待った後の時刻・seed の印・差し替えた乱数の関数のままか）。
 * @typedef {{ now: number, later: number, seed: unknown, intact: boolean }} PageReading
 */

/**
 * ページで読んだ時刻と seed が、記録した条件と同じかを確かめる。ページを開いた後、撮る前に呼ぶ。
 * 食い違えば例外にする（撮らずに止まる）。当て忘れ・当てた値の誤り・別の処理による上書きを見つける。
 * 時刻を固定しない条件（fixedTimeMs が null）では、間を置いて 2 回読んだ時刻が進むこと（固定されていないこと）を確かめる。
 * seed を使う条件では、撮る前も乱数の関数が差し替えた関数のままかを確かめる。seed を使わない条件では、差し替えの印が無いことを確かめる。
 * @param {{ evaluate(fn: () => Promise<PageReading>): Promise<PageReading> }} page
 * @param {Determinism} determinism - readDeterminism の戻り値
 */
export async function verifyDeterminism(page, determinism) {
  const seen = await page.evaluate(async () => {
    /** @type {unknown} */
    const marker = Reflect.get(globalThis, "__parityRandomSeed");
    /** @type {unknown} */
    const apis = Reflect.get(globalThis, "__parityRandomApis");
    // 差し替えた後に、ページの scripts が乱数の関数を別の関数に置き換えていないか
    const cryptoObject = globalThis.crypto;
    const intact =
      typeof apis === "object" &&
      apis !== null &&
      Math.random === Reflect.get(apis, "random") &&
      (cryptoObject === undefined ||
        cryptoObject.getRandomValues === Reflect.get(apis, "getRandomValues")) &&
      (cryptoObject === undefined || cryptoObject.randomUUID === Reflect.get(apis, "randomUUID"));
    const first = Date.now();
    // 固定した時刻でもタイマーは進むので、待った後に読んだ値が同じなら時刻は固定されている
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { now: first, later: Date.now(), seed: marker === undefined ? null : marker, intact };
  });
  if (
    determinism.fixedTimeMs !== null &&
    (seen.now !== determinism.fixedTimeMs || seen.later !== seen.now)
  ) {
    throw new Error(
      `page clock reads ${new Date(seen.now).toISOString()} but capture_conditions.determinism.fixed_time is ${new Date(determinism.fixedTimeMs).toISOString()}: applyDeterminism を page.goto の前に呼ぶ`,
    );
  }
  if (determinism.fixedTimeMs === null && seen.later === seen.now) {
    throw new Error(
      "page clock is fixed but capture_conditions.determinism.fixed_time is null: 現側と同じく時刻を固定せずに撮る",
    );
  }
  if (seen.seed !== determinism.randomSeed) {
    throw new Error(
      `page random seed is ${JSON.stringify(seen.seed)} but capture_conditions.determinism.random_seed is ${JSON.stringify(determinism.randomSeed)}: applyDeterminism を page.goto の前に呼ぶ`,
    );
  }
  if (determinism.randomSeed !== null && seen.intact !== true) {
    throw new Error(
      "page replaced Math.random or crypto after the seeded functions were installed: 乱数で決まる表示を seed で固定できないので、random_seed を null にするか、置き換える処理を止める",
    );
  }
}
