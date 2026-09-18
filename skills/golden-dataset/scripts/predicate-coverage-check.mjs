// 参照表の役割と行数を、消費側の全部から決めるための検査（正本）。Issue #388。
//
// 何のためか: データ設計は「入れたものが入ったか」までしか数えていない。
// **「入れたもので現行のどの分岐が踏めるか」を数える段が無い**ので、
// 踏めない分岐は下流（parity-suite / parity-replace）が「観測できない」に当たってから分かる。
// そのときにはベースラインを採り終えているため、行を足すと version が上がり交差する slug の採取物が陳腐化する。
//
// この検査が落とすのは 3 つ。
//   1. **写し漏れ**: `.replace/features.md` の 3 表（機能一覧「テーブル」・横断 API「参照テーブル」・バッチ「参照テーブル」）に
//      在る (テーブル, slug) が `design.md`「対象テーブル」表の写しに無い。写しが落ちると
//      「どの機能もこの表を読まない」と読める状態になり、役割が「読み取りだけ」へ倒れて行数を増やす検討に入らない。
//   2. **役割の矛盾**: 消費側 slug が 1 つでも在るのに役割が「読み取りだけ」。
//      役割は**消費するかどうか**で決まる（`JOIN` で引くか `FROM` の母集合として引くかは関係がない）。
//   3. **踏めない分岐**: 参照表の件数が 0 / 1、または述語の真・偽どちらかの該当行数が 0。
//      0 件は真の分岐へ入れず、1 件は絞り込みを外しても結果が変わらない（絞り込みが効いていることを観測できない）。
//      踏めない分岐は「足す」か「gaps に記録」かを**設計の段で**選ばせる（足すと版が上がるため、選択は判断であって既定値ではない）。
//
// 決定論的: 乱数・現在時刻・ネットワークに依存しない。読むのは Markdown だけで DB へは接続しない
// （投入後の実測件数は `verification.md` に書かれたものを読む）。TypeScript 構文は使わない（型は JSDoc）。
//
// 終了コード: 0 ＝ 条件を満たす、1 ＝ 不備が残る（設計へ戻す）、2 ＝ 使い方の誤り・表が読めない。

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ツールのバージョン（正本）。判定規則・出力形状を変えたら上げる。
 * @type {string}
 */
export const VERSION = "1";

/**
 * 役割の語彙（正本）。
 *
 * `FK 親のみ` は**消費側がどの表からも直接読まないが、FK を満たすために投入が要る親表**
 * （`orders` の背後の `customers` 等）。`投入する` にすると「消費側が居ない」で落ち、
 * `読み取りだけ` にすると投入対象から外れて FK が満たせない——どちらも事実と違うので別の語にする。
 */
export const ROLES = ["投入する", "読み取りだけ", "FK 親のみ"];

/** 踏めない分岐の扱いの語彙（正本）。 */
export const DISPOSITIONS = ["足す", "gaps に記録"];

/** 「読むテーブル無し」の sentinel（正本は replace-strategy）。 */
const NONE_SENTINEL = "-";

/**
 * セルの表記ゆれを畳む。コード引用（`）・強調（*）・全角空白・前後の空白を落とす。
 *
 * **`_` は落とさない**——識別子（`order_items`）の一部であり、落とすと別のテーブル名
 * （`orders_2024` と `orders2024`）が同じ鍵に潰れる。`_` による強調は表のセルでは使わない。
 * @param {string} cell
 * @returns {string}
 */
export function normalizeCell(cell) {
  return String(cell ?? "")
    .replace(/　/g, " ")
    .replace(/[`*]/g, "")
    .trim();
}

/**
 * Markdown のパイプ表を見出しごとに集める。
 *
 * 行頭が `|` の連続した塊のうち、2 行目が区切り行（`---`）であるものだけを表として扱う。
 * @param {string} markdown
 * @returns {{ heading: string, headers: string[], rows: string[][], line: number }[]}
 */
export function parseTables(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  /** @type {{ heading: string, headers: string[], rows: string[][], line: number }[]} */
  const tables = [];
  let heading = "";
  let i = 0;
  const splitRow = (line) => {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((c) => normalizeCell(c));
  };
  const isSeparator = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
  while (i < lines.length) {
    const line = lines[i];
    const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      heading = normalizeCell(headingMatch[1]);
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const headers = splitRow(line);
      /** @type {string[][]} */
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        rows.push(splitRow(lines[j]));
        j += 1;
      }
      tables.push({ heading, headers, rows, line: i + 1 });
      i = j;
      continue;
    }
    i += 1;
  }
  return tables;
}

/**
 * 見出しの前方一致と必須の列名から表を 1 つ引く。
 * @param {{ heading: string, headers: string[], rows: string[][], line: number }[]} tables
 * @param {string} heading
 * @param {string[]} requiredHeaders
 * @returns {{ heading: string, headers: string[], rows: string[][], line: number } | null}
 */
export function findTable(tables, heading, requiredHeaders) {
  return (
    tables.find(
      (t) => t.heading.startsWith(heading) && requiredHeaders.every((h) => t.headers.includes(h)),
    ) ?? null
  );
}

/**
 * 行を列名で引ける形にする。
 * @param {{ headers: string[], rows: string[][] }} table
 * @returns {Record<string, string>[]}
 */
export function rowsAsRecords(table) {
  return table.rows.map((cells) => {
    /** @type {Record<string, string>} */
    const record = {};
    table.headers.forEach((h, idx) => {
      record[h] = cells[idx] ?? "";
    });
    return record;
  });
}

/**
 * 一覧セル（`orders, order_items` / `-` / 空欄）を読む。
 *
 * **空欄と `-` を同じに扱わない**——空欄は「まだ調べていない」で、`-` だけが「調べた結果ゼロ件」。
 * @param {string} cell
 * @returns {{ kind: "blank" | "none" | "items", items: string[] }}
 */
export function splitList(cell) {
  const value = normalizeCell(cell);
  if (value === "") return { kind: "blank", items: [] };
  if (value === NONE_SENTINEL) return { kind: "none", items: [] };
  const items = value
    .split(/[,、／/]/)
    .map((v) => normalizeCell(v))
    .filter((v) => v !== "" && v !== NONE_SENTINEL);
  if (items.length === 0) return { kind: "blank", items: [] };
  return { kind: "items", items };
}

/**
 * 件数セルを読む。数値でなければ null（型崩れとして扱う）。
 * @param {string} cell
 * @returns {number | null}
 */
export function parseCount(cell) {
  const value = normalizeCell(cell).replace(/,/g, "");
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

/**
 * `.replace/features.md` の 3 表から「テーブル → 消費側 slug の集合」を導く。
 *
 * 3 表のどれか 1 つでも読めなければ**合格に倒さない**（読めた表だけで突き合わせると、
 * 読めなかった表にしか出てこないテーブルが写し漏れとして報告されない）。
 * @param {string} featuresMarkdown
 * @returns {{ consumers: Map<string, Set<string>>, findings: {code:string, message:string}[], structural: boolean }}
 */
export function collectConsumers(featuresMarkdown) {
  const tables = parseTables(featuresMarkdown);
  /** @type {{code:string, message:string}[]} */
  const findings = [];
  /** @type {Map<string, Set<string>>} */
  const consumers = new Map();
  let structural = false;
  const sources = [
    { heading: "機能一覧", column: "テーブル", label: "機能一覧の「テーブル」列" },
    { heading: "横断 API", column: "参照テーブル", label: "横断 API の「参照テーブル」列" },
    { heading: "バッチ", column: "参照テーブル", label: "バッチの「参照テーブル」列" },
  ];
  for (const source of sources) {
    const table = findTable(tables, source.heading, ["slug", source.column]);
    if (!table) {
      structural = true;
      findings.push({
        code: "features-table-missing",
        message: `features.md に ${source.label} を持つ表が無い（読めた表だけで突き合わせない）`,
      });
      continue;
    }
    for (const row of rowsAsRecords(table)) {
      const slug = normalizeCell(row.slug);
      if (slug === "") continue;
      const list = splitList(row[source.column]);
      if (list.kind === "blank") {
        findings.push({
          code: "features-reference-blank",
          message: `${source.label} が空欄（slug: ${slug}）。空欄は未調査であり「参照テーブル無し」ではない——replace-strategy 側で埋めてから設計する`,
        });
        continue;
      }
      for (const tableName of list.items) {
        if (!consumers.has(tableName)) consumers.set(tableName, new Set());
        consumers.get(tableName).add(slug);
      }
    }
  }
  return { consumers, findings, structural };
}

/**
 * 設計（と、渡されたなら検証記録）を突き合わせる。
 * @param {{ featuresMarkdown: string, designMarkdown: string, verificationMarkdown?: string | null }} input
 * @returns {{ findings: {code:string, message:string}[], counts: Record<string, number>, structural: boolean }}
 */
export function checkPredicateCoverage(input) {
  const {
    consumers,
    findings: featureFindings,
    structural: featuresStructural,
  } = collectConsumers(input.featuresMarkdown);
  /** @type {{code:string, message:string}[]} */
  const findings = [...featureFindings];
  let structural = featuresStructural;

  const designTables = parseTables(input.designMarkdown);
  const targetTable = findTable(designTables, "対象テーブル", [
    "テーブル",
    "features.md の機能／リソース",
    "件数",
    "役割",
  ]);
  const predicateTable = findTable(designTables, "述語ごとの分岐被覆", [
    "述語 id",
    "テーブル",
    "消費側 slug",
    "述語（列・条件）",
    "真の行数",
    "偽の行数",
    "判定",
    "扱い",
  ]);
  const paramTable = findTable(designTables, "消費側パラメータ", [
    "機能／リソース slug",
    "テーブル",
    "絞り込み列・条件",
  ]);
  if (!targetTable) {
    structural = true;
    findings.push({
      code: "design-target-table-missing",
      message:
        "design.md に「対象テーブル」表（テーブル / features.md の機能／リソース / 件数 / 役割）が無い",
    });
  }
  if (!predicateTable) {
    structural = true;
    findings.push({
      code: "design-predicate-table-missing",
      message:
        "design.md に「述語ごとの分岐被覆」表（述語 id / テーブル / 消費側 slug / 述語（列・条件） / 真の行数 / 偽の行数 / 判定 / 扱い）が無い",
    });
  }
  if (structural || !targetTable || !predicateTable) {
    return { findings, counts: { tables: 0, predicates: 0 }, structural: true };
  }

  const targetRows = rowsAsRecords(targetTable).filter(
    (row) => normalizeCell(row["テーブル"]) !== "",
  );
  /** @type {Map<string, {slugs: Set<string>, count: number|null, role: string}>} */
  const declared = new Map();
  for (const row of targetRows) {
    const name = normalizeCell(row["テーブル"]);
    const list = splitList(row["features.md の機能／リソース"]);
    const role = normalizeCell(row["役割"]);
    const count = parseCount(row["件数"]);
    if (declared.has(name)) {
      findings.push({
        code: "design-table-duplicated",
        message: `対象テーブル表に ${name} の行が 2 つ以上ある（消費側 slug の集合が 1 つに決まらない）`,
      });
    }
    declared.set(name, { slugs: new Set(list.items), count, role });
    if (!ROLES.includes(role)) {
      findings.push({
        code: "role-vocabulary",
        message: `${name} の役割「${role || "（空欄）"}」は語彙外（${ROLES.join(" / ")}）`,
      });
    }
    if (count === null) {
      findings.push({
        code: "row-count-unreadable",
        message: `${name} の件数「${normalizeCell(row["件数"]) || "（空欄）"}」を数値として読めない`,
      });
    }
  }

  // 1. 写し漏れ・写し過ぎ（集合の差）
  for (const [tableName, slugs] of consumers) {
    const entry = declared.get(tableName);
    if (!entry) {
      findings.push({
        code: "copy-missing-table",
        message: `features.md が ${tableName} を [${[...slugs].sort().join(", ")}] から参照しているのに、design.md の対象テーブル表に行が無い（写し漏れ）`,
      });
      continue;
    }
    for (const slug of [...slugs].sort()) {
      if (!entry.slugs.has(slug)) {
        findings.push({
          code: "copy-missing-slug",
          message: `${tableName} を参照する slug ${slug} が design.md の写しに無い（写しが 1 slug 落ちると役割が「読み取りだけ」へ倒れる）`,
        });
      }
    }
  }
  for (const [tableName, entry] of declared) {
    const actual = consumers.get(tableName) ?? new Set();
    for (const slug of [...entry.slugs].sort()) {
      if (!actual.has(slug)) {
        findings.push({
          code: "copy-extra-slug",
          message: `design.md が ${tableName} の消費側に ${slug} を書いているが features.md の 3 表に無い（推測で足したか features.md 側の記録漏れ）`,
        });
      }
    }
    // 2. 役割の矛盾（役割は「消費するか」で決まる。JOIN / FROM の引き方では決めない）
    if (entry.role === "読み取りだけ" && actual.size > 0) {
      findings.push({
        code: "role-contradicts-consumers",
        message: `${tableName} の役割が「読み取りだけ」だが、features.md では [${[...actual].sort().join(", ")}] が参照している（消費するなら投入対象。JOIN で引くか FROM の母集合として引くかは役割を変えない）`,
      });
    }
    if (entry.role === "投入する" && actual.size === 0) {
      findings.push({
        code: "role-without-consumer",
        message: `${tableName} の役割が「投入する」だが features.md のどの表からも参照されていない（対象の根拠が無い。FK を満たすためだけに要る親表なら「FK 親のみ」と書く）`,
      });
    }
    if (entry.role === "FK 親のみ") {
      if (actual.size > 0) {
        findings.push({
          code: "fk-parent-has-consumer",
          message: `${tableName} の役割が「FK 親のみ」だが、features.md では [${[...actual].sort().join(", ")}] が参照している（直接読まれる表は「投入する」）`,
        });
      }
      if (entry.count === 0) {
        findings.push({
          code: "fk-parent-empty",
          message: `${tableName} は「FK 親のみ」だが 0 件（子行の FK を満たせない）`,
        });
      }
    }
  }

  // 3. 参照表の件数（0 件 / 1 件は、それ自体が「踏めない」の印）
  const predicateRows = rowsAsRecords(predicateTable).filter(
    (row) => normalizeCell(row["述語 id"]) !== "",
  );
  /** @type {Map<string, Record<string,string>[]>} */
  const predicatesByTable = new Map();
  for (const row of predicateRows) {
    const name = normalizeCell(row["テーブル"]);
    if (!predicatesByTable.has(name)) predicatesByTable.set(name, []);
    predicatesByTable.get(name).push(row);
  }
  for (const [tableName, entry] of declared) {
    if (entry.role !== "投入する") continue;
    if (entry.count === null) continue;
    if (entry.count > 1) continue;
    const reason =
      entry.count === 0
        ? "0 件では真になる分岐へ入れない"
        : "1 件では絞り込みを外しても結果が変わらず、絞り込みが効いていることを観測できない";
    const rows = predicatesByTable.get(tableName) ?? [];
    const decided = rows.some((row) => DISPOSITIONS.includes(normalizeCell(row["扱い"])));
    if (!decided) {
      findings.push({
        code: "table-row-count-unusable",
        message: `${tableName} は ${entry.count} 件（${reason}）。述語ごとの分岐被覆に扱い（${DISPOSITIONS.join(" / ")}）を決めた行が無い`,
      });
    }
  }

  // 4. 述語ごとの真・偽（0 件の側があれば踏めない）
  const seenPredicateIds = new Set();
  for (const row of predicateRows) {
    const id = normalizeCell(row["述語 id"]);
    if (seenPredicateIds.has(id)) {
      findings.push({
        code: "predicate-id-duplicated",
        message: `述語 id ${id} が 2 行以上にある（検証記録と鍵で対応づけられない）`,
      });
    }
    seenPredicateIds.add(id);
    const tableName = normalizeCell(row["テーブル"]);
    if (!declared.has(tableName)) {
      findings.push({
        code: "predicate-table-unknown",
        message: `述語 ${id} のテーブル ${tableName} が対象テーブル表に無い`,
      });
    }
    const consumerList = splitList(row["消費側 slug"]);
    if (consumerList.kind !== "items") {
      findings.push({
        code: "predicate-consumer-blank",
        message: `述語 ${id} の消費側 slug が空（どの消費側の分岐かが決まらない）`,
      });
    } else {
      const actual = consumers.get(tableName) ?? new Set();
      for (const slug of consumerList.items) {
        if (!actual.has(slug)) {
          findings.push({
            code: "predicate-consumer-unknown",
            message: `述語 ${id} の消費側 slug ${slug} は features.md で ${tableName} を参照していない`,
          });
        }
      }
    }
    const trueCount = parseCount(row["真の行数"]);
    const falseCount = parseCount(row["偽の行数"]);
    const verdict = normalizeCell(row["判定"]);
    const disposition = normalizeCell(row["扱い"]);
    if (trueCount === null || falseCount === null) {
      findings.push({
        code: "predicate-count-unreadable",
        message: `述語 ${id} の真／偽の行数を数値として読めない（真: ${normalizeCell(row["真の行数"]) || "（空欄）"} / 偽: ${normalizeCell(row["偽の行数"]) || "（空欄）"}）`,
      });
      continue;
    }
    const steppable = trueCount >= 1 && falseCount >= 1;
    const expected = steppable ? "踏める" : "踏めない";
    if (verdict !== expected) {
      findings.push({
        code: "predicate-verdict-mismatch",
        message: `述語 ${id} の判定が「${verdict || "（空欄）"}」だが、真 ${trueCount} 件 / 偽 ${falseCount} 件からは「${expected}」（0 件の側がある分岐は踏めない）`,
      });
    }
    if (!steppable) {
      if (!DISPOSITIONS.includes(disposition)) {
        findings.push({
          code: "predicate-disposition-missing",
          message: `述語 ${id} は踏めない（真 ${trueCount} 件 / 偽 ${falseCount} 件）のに扱いが「${disposition || "（空欄）"}」。足すか gaps に記録するかを設計の段で選ぶ（足すと version が上がり交差する slug の採取物が陳腐化する）`,
        });
      } else if (disposition === "gaps に記録" && normalizeCell(row["根拠"]) === "") {
        findings.push({
          code: "predicate-gaps-reason-missing",
          message: `述語 ${id} は「gaps に記録」だが根拠が空欄（消費側がその分岐を使うかの判断材料が残らない）`,
        });
      }
    } else if (
      disposition !== "" &&
      disposition !== NONE_SENTINEL &&
      !DISPOSITIONS.includes(disposition)
    ) {
      findings.push({
        code: "predicate-disposition-vocabulary",
        message: `述語 ${id} の扱い「${disposition}」は語彙外（${DISPOSITIONS.join(" / ")} / ${NONE_SENTINEL}）`,
      });
    }
  }

  // 5. 消費側パラメータの絞り込みが、述語として列挙されているか
  // **表が無いときを素通りさせない**——絞り込みの一覧が読めないと、この節は 0 行の走査になり
  // 「絞り込みが 1 つも無い」と「絞り込みを数えていない」が同じ（findings 0 件）に見える。
  if (!paramTable) {
    findings.push({
      code: "design-param-table-missing",
      message:
        "design.md に「消費側パラメータ」表（機能／リソース slug / テーブル / 絞り込み列・条件）が無い（絞り込みの一覧が読めないと、述語を数え漏らしても 0 件と同じ見え方になる）",
    });
  }
  if (paramTable) {
    for (const row of rowsAsRecords(paramTable)) {
      const slug = normalizeCell(row["機能／リソース slug"]);
      const tableName = normalizeCell(row["テーブル"]);
      const filters = splitList(row["絞り込み列・条件"]);
      if (slug === "" || tableName === "") continue;
      if (filters.kind !== "items") continue;
      const rows =
        predicatesByTable
          .get(tableName)
          ?.filter((r) => splitList(r["消費側 slug"]).items.includes(slug)) ?? [];
      if (rows.length === 0) {
        findings.push({
          code: "predicate-not-enumerated",
          message: `消費側パラメータの ${slug} × ${tableName} に絞り込みがあるのに、述語ごとの分岐被覆に対応する行が無い（数えていない分岐は 0 件と同じ見え方になる）`,
        });
        continue;
      }
      // **絞り込み列は 1 行に複数並ぶ**（`status, owner_id`）。1 本でも述語行があれば足りると数えると、
      // 残りの列の分岐は「数えていない」まま 0 件と同じ見え方になる。列ごとに述語を要求する。
      // 突き合わせは述語の文面に列名が現れるかで行うため、`status = 'shipped'` のように**列名を書く**必要がある
      // （列名を書かない式は数えられていないものとして落ちる）。
      for (const filter of filters.items) {
        const column = filter.split(/[\s=<>!(）(]/)[0];
        if (column === "") continue;
        const named = rows.some((r) => normalizeCell(r["述語（列・条件）"]).includes(column));
        if (!named) {
          findings.push({
            code: "predicate-filter-not-enumerated",
            message: `消費側パラメータの ${slug} × ${tableName} の絞り込み「${filter}」に対応する述語行が無い（述語の文面に列 ${column} が現れない。1 行に複数の絞り込みが並ぶとき、1 本の述語で全部を満たしたことにしない）`,
          });
        }
      }
    }
  }

  // 6. 投入後の実測件数（渡されたときだけ）
  if (typeof input.verificationMarkdown === "string" && input.verificationMarkdown !== "") {
    const verificationTables = parseTables(input.verificationMarkdown);
    const measured = findTable(verificationTables, "述語ごとの該当行数", [
      "述語 id",
      "真の実測行数",
      "偽の実測行数",
    ]);
    if (!measured) {
      findings.push({
        code: "verification-table-missing",
        message:
          "verification.md に「述語ごとの該当行数」表（述語 id / 真の実測行数 / 偽の実測行数）が無い（投入後に 0 件・1 件が報告に出ない）",
      });
    } else {
      /** @type {Map<string, Record<string,string>>} */
      const measuredById = new Map();
      for (const row of rowsAsRecords(measured)) {
        const id = normalizeCell(row["述語 id"]);
        if (id === "") continue;
        // 後勝ちで黙って上書きしない——同じ id の行が 2 つあると、食い違うほうの実測が
        // 突き合わせに使われずに落ち、0 件の分岐が報告に出ないまま通る。
        if (measuredById.has(id)) {
          findings.push({
            code: "verification-predicate-duplicated",
            message: `verification.md の「述語ごとの該当行数」に述語 id ${id} の行が 2 つ以上ある（どちらの実測と突き合わせるか決まらない）`,
          });
        }
        measuredById.set(id, row);
      }
      for (const row of predicateRows) {
        const id = normalizeCell(row["述語 id"]);
        const designedTrue = parseCount(row["真の行数"]);
        const designedFalse = parseCount(row["偽の行数"]);
        const record = measuredById.get(id);
        if (!record) {
          findings.push({
            code: "verification-predicate-missing",
            message: `述語 ${id} の実測行数が verification.md に無い（設計の数が投入で成立したか分からない）`,
          });
          continue;
        }
        const measuredTrue = parseCount(record["真の実測行数"]);
        const measuredFalse = parseCount(record["偽の実測行数"]);
        if (measuredTrue === null || measuredFalse === null) {
          findings.push({
            code: "verification-count-unreadable",
            message: `述語 ${id} の実測行数を数値として読めない`,
          });
          continue;
        }
        if (measuredTrue !== designedTrue || measuredFalse !== designedFalse) {
          findings.push({
            code: "verification-count-mismatch",
            message: `述語 ${id} の実測（真 ${measuredTrue} / 偽 ${measuredFalse}）が設計（真 ${designedTrue} / 偽 ${designedFalse}）と違う`,
          });
        }
        if (measuredTrue === 0 || measuredFalse === 0) {
          findings.push({
            code: "verification-branch-unreachable",
            message: `述語 ${id} は投入後も踏めない（真 ${measuredTrue} 件 / 偽 ${measuredFalse} 件）`,
          });
        }
      }
    }
  }

  return {
    findings,
    counts: { tables: declared.size, predicates: predicateRows.length },
    structural,
  };
}

/**
 * CLI 本体。
 * @param {string[]} argv
 * @param {{ readFile?: (path: string) => string, cwd?: string, write?: (s: string) => void, writeErr?: (s: string) => void }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const cwd = deps.cwd ?? process.cwd();
  const write = deps.write ?? ((s) => process.stdout.write(s));
  const writeErr = deps.writeErr ?? ((s) => process.stderr.write(s));
  const usage =
    "usage: predicate-coverage-check.mjs --features <.replace/features.md> --design <.replace/dataset/design.md> [--verification <.replace/dataset/verification.md>]";
  /**
   * 引数・入力の誤りを stderr へ知らせる（判定結果ではないので stdout の JSON には混ぜない）。
   * @param {string} message
   * @returns {number}
   */
  const fail = (message) => {
    writeErr(`error: ${message}\n${usage}\n`);
    return 2;
  };
  const out = (obj) =>
    write(
      `${JSON.stringify({ tool: "predicate-coverage-check", version: VERSION, ...obj }, null, 2)}\n`,
    );
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      return fail(`不明な引数: ${key}`);
    }
    const value = argv[i + 1];
    if (typeof value !== "string" || value.startsWith("--")) {
      return fail(`${key} に値がない`);
    }
    if (args[key] !== undefined) {
      return fail(`${key} が複数ある`);
    }
    args[key] = value;
    i += 1;
  }
  const known = ["--features", "--design", "--verification"];
  const unknown = Object.keys(args).filter((k) => !known.includes(k));
  if (unknown.length > 0) {
    return fail(`不明な引数: ${unknown.join(", ")}`);
  }
  const featuresPath = args["--features"];
  const designPath = args["--design"];
  const verificationPath = args["--verification"];
  if (!featuresPath || !designPath) {
    return fail("--features と --design は必須");
  }
  /** @type {Record<string, string>} */
  const sources = {};
  /** @type {[string, string][]} */
  const inputs = [
    ["features", featuresPath],
    ["design", designPath],
  ];
  if (verificationPath) inputs.push(["verification", verificationPath]);
  for (const [key, path] of inputs) {
    try {
      sources[key] = readFile(resolve(cwd, path));
    } catch (error) {
      return fail(`${path} を読めない: ${error && error.message}`);
    }
  }
  const result = checkPredicateCoverage({
    featuresMarkdown: sources.features,
    designMarkdown: sources.design,
    verificationMarkdown: sources.verification ?? null,
  });
  if (result.structural) {
    out({ ok: false, structural: true, findings: result.findings, counts: result.counts });
    return 2;
  }
  out({
    ok: result.findings.length === 0,
    findings: result.findings,
    counts: { ...result.counts, findings: result.findings.length },
  });
  return result.findings.length === 0 ? 0 : 1;
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
  // process.exit は書き込み中の stdout を捨てるため、終了コードだけ設定して自然終了させる。
  process.exitCode = main(process.argv.slice(2));
}
