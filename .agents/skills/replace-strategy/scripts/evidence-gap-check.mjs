// 「要求単位の根拠」の書き戻し漏れを数える（正本）。
//
// .replace/features.md の「要求単位の根拠」列は、口の要求単位を確定した本人が
// replace-strategy evidence で 推定 → 実測 へ更新する。確定できなかった口は 推定 のまま残し、
// 測るまで機能を閉じさせないものは parity-suite が .replace/parity/<slug>/metadata.json の
// unmeasured へ宣言する。どちらも行われないと、確定済みの口が status の未検証領域に残り続け、
// 未検証領域の一覧が実態より多く出る（読まれなくなる）。
//
// このツールが数えるのは 1 つだけ:
//   「未確認の口」のうち、unmeasured にも宣言されていないもの = 書き戻しか宣言の漏れ
//
// 未確認の口の定義（正本は references/status.md の導出項目 11）:
//   - 根拠が 推定 の口
//   - API 列にあるのに、根拠列のどのエントリにも対応づかない口（根拠が無い＝未確認）
//   - 根拠の語彙が 実測: / 推定: のどちらでもない口（語彙外は未確認に倒す。fail-closed。
//     区切りまで見る——前方一致だと「実測できず」が 実測 に化ける）
//
// 対応づけの単位（宣言）: 口の文字列の完全一致。根拠エントリの `<口> → <根拠>` の矢印より前を
//   `,` / `、` で分割し、空白を 1 つに畳んでから API 列の口と突き合わせる。
//   散文（「両方」等）は口に一致しないので対応づかないものとして数える——
//   曖昧な対応づけを許すと、書き戻し漏れが「まとめて書いてある」に化ける。
//   unmeasured 側も同じ単位で、entries[].endpoint の完全一致だけを宣言として数える
//   （item の散文に口が含まれることを宣言に数えない。部分一致は別の口を宣言済みに化けさせる）。
//   unmeasured.declared: false は「宣言を持たない」なので entries を読まない
//   （parity-suite の artifact-health-check.mjs はその節を判定しないため、読むと誰も効かせていない宣言で通る）。
//
// fail-closed: 列が無い・宣言の有無を判定できない・入力が壊れているものを合格に倒さない。
// 対象外（バッチ・「その他の Issue」の行）は不合格ではないが exit 0 とも分ける——
// 口を持たない行と「口はあるが未確認 0 件」を同じ出口にすると、表を置き間違えた行が合格に化ける。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。TypeScript 構文は使わない（型は JSDoc）。

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** ツールのバージョン（正本）。判定ロジック・出力形状を変えたら上げる。 */
export const VERSION = "1";

/** 使い方の誤り・入力の不備（exit 2）。 */
export class UsageError extends Error {}

/** 判定不能（exit 3）。合格にも不合格にも倒さない。 */
export class UndecidableError extends Error {}

/**
 * 対象外（exit 4）。口を持たない表の行（バッチ・「その他の Issue」）。
 * 検査すべき口が存在しないので不合格ではないが、「検査した結果 0 件」とも区別する
 * （exit 0 に畳むと、口を持つ行が表を間違えて置かれたときに合格へ化ける）。
 */
export class NotApplicableError extends Error {}

/** 根拠列の見出し（features.md の正本）。 */
const EVIDENCE_HEADER = "要求単位の根拠";

/** 口を並べる列の見出し（機能一覧は「新規実装 API」、横断 API 表は「API」）。 */
const ENDPOINT_HEADERS = ["新規実装 API", "API"];

/** 根拠の語彙。 */
const MEASURED = "実測";
const ESTIMATED = "推定";

/**
 * 語彙は区切り（`実測:` / `推定:`）まで見て判定する。前方一致だけだと
 * 「実測できず」「実測不能」「実測予定」が 実測 に化けて、確定していない口が
 * 書き戻し済みとして素通りする（語彙外を未確認へ倒す fail-closed が、この 1 語で裏返る）。
 */
const VERDICT_PATTERNS = [
  { verdict: MEASURED, pattern: /^実測\s*[:：]/u },
  { verdict: ESTIMATED, pattern: /^推定\s*[:：]/u },
];

/** 口の欄に「無い」と書くときの語（口として数えない）。 */
const NO_ENDPOINT_MARKERS = new Set(["-", "‐", "–", "—", "ー", "なし", "無し"]);

/**
 * 空白を 1 つに畳み、前後を除く（Markdown の表はフォーマッタが桁を詰め直すため素の比較では揺れる）。
 * @param {string} value
 * @returns {string}
 */
export function collapse(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

/**
 * Markdown の表を全て取り出す。
 * @param {string} text
 * @returns {{ headers: string[], rows: string[][] }[]}
 */
export function parseTables(text) {
  const lines = text.split(/\r?\n/u);
  /** @type {{ headers: string[], rows: string[][] }[]} */
  const tables = [];
  // コードフェンスの中は例示であって台帳ではない。読むと、例の表が本物の行と並んで
  // 「slug が 2 件ある」（exit 2）に化けたり、例の列で判定可能に見えたりする。
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const fenceMark = fenceOf(lines[i]);
    if (fenceMark !== null) {
      if (fence === null) fence = fenceMark;
      else if (fenceMark[0] === fence[0] && fenceMark.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const header = splitRow(lines[i]);
    if (header === null) continue;
    const delimiter = splitRow(lines[i + 1]);
    // 区切り行のハイフンは GFM では 1 個以上。3 個以上を要求すると `|-|-|` の表を読み落とす。
    if (delimiter === null || !delimiter.every((cell) => /^:?-+:?$/u.test(cell.trim()))) continue;
    if (delimiter.length !== header.length) continue;
    /** @type {string[][]} */
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const row = splitRow(lines[j]);
      if (row === null) break;
      rows.push(row);
    }
    tables.push({ headers: header.map(collapse), rows });
    i = j - 1;
  }
  return tables;
}

/**
 * コードフェンスの開始／終了記号を返す（フェンス行でなければ null）。
 * @param {string | undefined} line
 * @returns {string | null}
 */
function fenceOf(line) {
  if (line === undefined) return null;
  const match = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
  return match === null ? null : match[1];
}

/**
 * `| a | b |` を配列にする（表の行でなければ null）。
 * @param {string | undefined} line
 * @returns {string[] | null}
 */
function splitRow(line) {
  if (line === undefined) return null;
  let trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  // GFM は行頭・行末の `|` を必須にしない。必須にすると、外側の `|` を省いた正当な
  // インベントリが「表が無い」と読まれ、exit 3（列の導入前）に化ける——
  // parity-replace 手順 8 は exit 3 で完了を止めないので、推定の口が残る台帳が黙って通る。
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|");
}

/**
 * 口の一覧を列のセルから取り出す。
 * @param {string} cell
 * @returns {string[]}
 */
export function parseEndpoints(cell) {
  return cell
    .split(/[,、]/u)
    .map(collapse)
    .filter((value) => value.length > 0 && !NO_ENDPOINT_MARKERS.has(value));
}

/**
 * 根拠セルをエントリへ分解する。
 * @param {string} cell
 * @returns {{ endpoints: string[], verdict: string, raw: string }[]}
 */
export function parseEvidenceEntries(cell) {
  return cell
    .split("／")
    .map((chunk) => collapse(chunk))
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const arrow = chunk.indexOf("→");
      if (arrow < 0) return { endpoints: [], verdict: "", raw: chunk };
      const endpoints = parseEndpoints(chunk.slice(0, arrow));
      const body = collapse(chunk.slice(arrow + 1));
      const matched = VERDICT_PATTERNS.find(({ pattern }) => pattern.test(body));
      return { endpoints, verdict: matched === undefined ? "" : matched.verdict, raw: chunk };
    });
}

/**
 * features.md から対象 slug の口と根拠を取り出す。
 * @param {string} text
 * @param {string} slug
 * @returns {{ endpointCell: string, endpoints: string[], entries: { endpoints: string[], verdict: string, raw: string }[] }}
 */
export function readRow(text, slug) {
  const tables = parseTables(text);
  /** @type {{ endpointCell: string, endpoints: string[], entries: ReturnType<typeof parseEvidenceEntries> }[]} */
  const matched = [];
  // 根拠列を持たない表にその slug の行があるかも数える——列の追加が一部の表にしか
  // 及んでいない状態を「行が無い」（exit 2）で片付けると、旧インベントリと同じ
  // 判定不能（exit 3）が入力の不備に化ける。
  let legacyRows = 0;
  // 口の列そのものを持たない表（バッチ・「その他の Issue」）の行。これらは設計上 API の口を
  // 持たないので、「行が無い」（exit 2）でも「列が未導入」（exit 3）でもなく対象外（exit 4）。
  // 3 つを同じ終了コードへ畳むと、バッチ slug を渡した呼び出し側が入力を直しようがないまま詰まる。
  let nonEndpointRows = 0;
  // 根拠列はあるのに口の列が無い表の行。列名が規約（新規実装 API / API）とずれている入力の不備で、
  // 「列の導入前」（exit 3）でも「対象外」（exit 4）でもない——どちらへ倒しても完了判定が通ってしまう。
  let malformedRows = 0;
  for (const table of tables) {
    const slugIndex = table.headers.indexOf("slug");
    if (slugIndex < 0) continue;
    const endpointIndex = table.headers.findIndex((header) => ENDPOINT_HEADERS.includes(header));
    const evidenceIndex = table.headers.indexOf(EVIDENCE_HEADER);
    for (const row of table.rows) {
      if (collapse(row[slugIndex] ?? "") !== slug) continue;
      if (endpointIndex < 0) {
        // 口の列も根拠列も無い表＝バッチ・「その他の Issue」。設計上どちらの列も持たない。
        // 根拠列はあるのに口の列だけ無いのは列名のずれ（規約外の見出し）なので対象外にしない——
        // そこを対象外へ倒すと、推定の口が残る機能行が exit 4 で完了判定を通る（fail-open）。
        if (evidenceIndex < 0) {
          nonEndpointRows += 1;
          continue;
        }
        malformedRows += 1;
        continue;
      }
      if (evidenceIndex < 0) {
        legacyRows += 1;
        continue;
      }
      matched.push({
        endpointCell: collapse(row[endpointIndex] ?? ""),
        endpoints: parseEndpoints(row[endpointIndex] ?? ""),
        entries: parseEvidenceEntries(row[evidenceIndex] ?? ""),
      });
    }
  }
  const total = matched.length + legacyRows + nonEndpointRows + malformedRows;
  if (total > 1) {
    throw new UsageError(
      `slug ${slug} の行が ${total} 件ある（slug はインベントリ全体で一意。どちらが正かを決めるまで判定しない）`,
    );
  }
  if (matched.length === 0 && malformedRows > 0) {
    throw new UsageError(
      `slug ${slug} の行の表は「${EVIDENCE_HEADER}」列を持つのに口の列（${ENDPOINT_HEADERS.join(" / ")}）が無い——列名が規約とずれている。対象外にも判定不能にも倒さない`,
    );
  }
  if (matched.length === 0 && nonEndpointRows > 0) {
    throw new NotApplicableError(
      `slug ${slug} の行は API の口を持たない表（バッチ・「その他の Issue」）にある——要求単位の根拠は口ごとの記録なので、この行に検査対象は無い`,
    );
  }
  if (matched.length === 0 && legacyRows > 0) {
    throw new UndecidableError(
      `slug ${slug} の行の表に「${EVIDENCE_HEADER}」列が無い（列の導入前に作られたインベントリ）——列の追加は replace-strategy の setup / issues が行う`,
    );
  }
  if (matched.length === 0 && !tables.some((table) => table.headers.includes(EVIDENCE_HEADER))) {
    throw new UndecidableError(
      `「${EVIDENCE_HEADER}」列を持つ表が無い（列の導入前に作られたインベントリ）——列の追加は replace-strategy の setup / issues が行う`,
    );
  }
  if (matched.length === 0) throw new UsageError(`slug ${slug} の行がインベントリに無い`);
  const row = matched[0];
  if (row.endpointCell.length === 0) {
    throw new UsageError(
      `slug ${slug} の API 列が空欄——口が無いことを確かめたなら \`-\` か \`なし\` と書く。空欄は未調査であり、口 0 件（合格）に倒さない`,
    );
  }
  const seen = new Set();
  for (const endpoint of row.endpoints) {
    if (seen.has(endpoint)) throw new UsageError(`口 ${endpoint} が API 列に重複している`);
    seen.add(endpoint);
  }
  return row;
}

/**
 * parity-suite の metadata.json から宣言済みの口を取り出す。
 * @param {string} text
 * @param {string} path
 * @returns {Set<string>}
 */
export function readDeclaredEndpoints(text, path) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${path} を JSON として読めない: ${e instanceof Error ? e.message : e}`);
  }
  if (typeof parsed !== "object" || parsed === null)
    throw new UsageError(`${path} が object でない`);
  const unmeasured = /** @type {Record<string, unknown>} */ (parsed).unmeasured;
  if (unmeasured === undefined) {
    throw new UndecidableError(
      `${path} に unmeasured キーが無い（旧版 parity-suite の成果物）——宣言の有無を判定できない`,
    );
  }
  if (typeof unmeasured !== "object" || unmeasured === null || Array.isArray(unmeasured)) {
    throw new UsageError(`${path} の unmeasured が object でない`);
  }
  // declared の扱いは parity-suite の artifact-health-check.mjs と揃える——向こうは
  // declared: false で節ごと判定せず entries の妥当性も見ないので、ここだけが entries を
  // 宣言として数えると「誰も効かせていない宣言」で合格に倒れる。
  const declaredFlag = /** @type {Record<string, unknown>} */ (unmeasured).declared;
  if (typeof declaredFlag !== "boolean") {
    throw new UsageError(
      `${path} の unmeasured.declared が真偽値でない（parity-suite の成果物として不備）`,
    );
  }
  if (!declaredFlag) return new Set();
  const entries = /** @type {Record<string, unknown>} */ (unmeasured).entries;
  if (entries === undefined) return new Set();
  if (!Array.isArray(entries)) throw new UsageError(`${path} の unmeasured.entries が配列でない`);
  /** @type {Set<string>} */
  const declared = new Set();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const endpoint = /** @type {Record<string, unknown>} */ (entry).endpoint;
    if (typeof endpoint !== "string") continue;
    const normalized = collapse(endpoint);
    if (normalized.length > 0) declared.add(normalized);
  }
  return declared;
}

/**
 * 判定する。
 * @param {{ featuresText: string, slug: string, unmeasuredPath?: string | null }} input
 * @returns {{ findings: string[], notes: string[], counts: Record<string, number> }}
 */
export function check(input) {
  // 行の分類を先に済ませる——`--unmeasured` を先に読むと、metadata.json が未生成の
  // バッチ slug が対象外（exit 4）ではなく ENOENT（exit 2）になり、
  // 「インベントリを直す」という誤った直し方へ案内してしまう。
  const row = readRow(input.featuresText, input.slug);
  const declared =
    input.unmeasuredPath === undefined || input.unmeasuredPath === null
      ? null
      : readDeclaredEndpoints(readFileSync(input.unmeasuredPath, "utf8"), input.unmeasuredPath);

  /** @type {Map<string, Set<string>>} 口 → 対応づいた根拠の語彙 */
  const verdicts = new Map();
  for (const endpoint of row.endpoints) verdicts.set(endpoint, new Set());
  /** @type {string[]} */
  const notes = [];
  for (const entry of row.entries) {
    const unmatched = entry.endpoints.filter((endpoint) => !verdicts.has(endpoint));
    for (const endpoint of unmatched) {
      notes.push(
        `根拠エントリの口 ${endpoint} は API 列に無い（対応づかないエントリ）: ${entry.raw}`,
      );
    }
    if (entry.endpoints.length === 0) {
      notes.push(`口を名指ししていない根拠エントリ（対応づかない）: ${entry.raw}`);
    }
    for (const endpoint of entry.endpoints) {
      const bucket = verdicts.get(endpoint);
      if (bucket !== undefined) bucket.add(entry.verdict);
    }
  }

  /** @type {string[]} */
  const findings = [];
  let measured = 0;
  let unresolved = 0;
  let declaredCount = 0;
  for (const endpoint of row.endpoints) {
    const bucket = verdicts.get(endpoint) ?? new Set();
    const isMeasured = bucket.size === 1 && bucket.has(MEASURED);
    if (isMeasured) {
      measured += 1;
      continue;
    }
    let reason;
    if (bucket.size === 0) reason = "根拠のエントリが対応づかない";
    else if (bucket.has(MEASURED) && bucket.has(ESTIMATED))
      reason = "実測と推定の両方が対応づく（矛盾）";
    else if (bucket.has(ESTIMATED)) reason = "根拠が推定";
    else reason = "根拠の語彙が実測でも推定でもない";
    unresolved += 1;
    if (declared !== null && declared.has(endpoint)) {
      declaredCount += 1;
      notes.push(`未確認の口 ${endpoint}（${reason}）は unmeasured に宣言済み`);
      continue;
    }
    findings.push(`未確認の口 ${endpoint}（${reason}）が unmeasured にも宣言されていない`);
  }
  return {
    findings,
    notes,
    counts: {
      endpoints: row.endpoints.length,
      measured,
      unresolved,
      declared: declaredCount,
      missing: findings.length,
    },
  };
}

/**
 * @param {string[]} argv
 * @returns {{ features: string, slug: string, unmeasured: string | null }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--features" || arg === "--slug" || arg === "--unmeasured") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} に値が無い`);
      if (opts[arg.slice(2)] !== undefined) throw new UsageError(`${arg} が 2 回指定されている`);
      opts[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new UsageError(`不明な引数: ${arg}`);
  }
  if (!opts.features) throw new UsageError("--features は必須（探索先を推測させない）");
  if (!opts.slug) throw new UsageError("--slug は必須（対象を推測させない）");
  return {
    features: resolve(opts.features),
    slug: collapse(opts.slug),
    unmeasured: opts.unmeasured === undefined ? null : resolve(opts.unmeasured),
  };
}

/** 使い方（stderr に出す）。 */
const usage = [
  "usage: evidence-gap-check.mjs --features <features.md> --slug <slug> [--unmeasured <parity metadata.json>]",
  "  --features    .replace/features.md のパス（必須）",
  "  --slug        対象の slug（必須。機能一覧・横断 API 表のどちらでもよい）",
  "  --unmeasured  .replace/parity/<slug>/metadata.json（省略すると宣言を考慮せず、未確認の口があれば落とす）",
  "exit: 0 = 未確認の口が無い、または全て unmeasured に宣言済み / 1 = 宣言の無い未確認の口がある（書き戻しか宣言の漏れ）",
  "      2 = 使い方の誤り・入力の不備 / 3 = 判定不能（根拠列が無い・unmeasured キーが無い）",
  "      4 = 対象外（口を持たない表の行＝バッチ・その他の Issue。検査対象が無い）",
].join("\n");

/**
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  try {
    const args = parseArgs(argv);
    const featuresText = readFileSync(args.features, "utf8");
    const { findings, notes, counts } = check({
      featuresText,
      slug: args.slug,
      unmeasuredPath: args.unmeasured,
    });
    for (const note of notes) process.stdout.write(`note: ${note}\n`);
    for (const finding of findings) process.stdout.write(`warn: ${finding}\n`);
    process.stdout.write(
      `measured: 口 ${counts.endpoints} 件（実測 ${counts.measured} / 未確認 ${counts.unresolved}` +
        `〈宣言済み ${counts.declared} / 未宣言 ${counts.missing}〉）\n`,
    );
    if (findings.length > 0) {
      process.stdout.write(
        `error: 未確認のまま宣言もされていない口が ${findings.length} 件ある — replace-strategy evidence で書き戻すか、parity-suite の unmeasured へ宣言する\n`,
      );
      return 1;
    }
    process.stdout.write(`ok: 書き戻しの漏れは無い（evidence-gap-check ${VERSION}）\n`);
    return 0;
  } catch (e) {
    if (e instanceof NotApplicableError) {
      process.stderr.write(`not-applicable: ${e.message}\n`);
      return 4;
    }
    if (e instanceof UndecidableError) {
      process.stderr.write(`undecidable: ${e.message}\n`);
      return 3;
    }
    if (e instanceof UsageError) {
      process.stderr.write(`error: ${e.message}\n${usage}\n`);
      return 2;
    }
    // 読めない入力（ENOENT だけでなく EISDIR / EACCES 等）は入力の不備。
    // 投げ直すと未捕捉例外の exit 1 になり、「宣言の無い未確認の口がある」と同じ終了コードに化ける。
    if (e instanceof Error && typeof (/** @type {NodeJS.ErrnoException} */ (e).code) === "string") {
      process.stderr.write(`error: ${e.message}\n${usage}\n`);
      return 2;
    }
    throw e;
  }
}

// CLI エントリ判定は両辺を実パスに解決してから突き合わせる（シンボリックリンク経由の起動でサイレント no-op にしない）。
const invokedAsCli = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
})();

if (invokedAsCli) {
  process.exit(main(process.argv.slice(2)));
}
