// replace-strategy の書き戻し漏れチェッカ（evidence-gap-check.mjs）の回帰テスト（Issue #380）。
//
// 「要求単位の根拠」は確定した本人が書き戻すか、確定できなければ parity-suite が unmeasured へ宣言する。
// どちらも行われないと status がその口を永久に未確認として報告し続けるが、散文の規約だけでは
// 「確定できなかった」と「確定したのに書き戻していない」が同じ見え方になる。
//
// 陽性コントロール（全て実測なら exit 0・宣言済みなら exit 0）を置く——これが無いと「常に落とす」実装と
// 区別できない。併せて、口の対応づけを部分一致・散文に緩めないこと（別の口を宣言済みに化けさせない）と、
// 判定できない入力を合格に倒さないことを測る。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/replace-strategy/scripts/evidence-gap-check.mjs");

/**
 * 機能一覧だけを持つ最小の features.md を作る。
 * @param {{ api: string, evidence: string, slug?: string, extraRows?: string[], header?: string }} row
 */
function features(row) {
  const slug = row.slug ?? "plan";
  const header =
    row.header ?? "| slug | 機能名 | 新規実装 API | 要求単位の根拠 | テーブル | Issue |";
  const delimiter = `|${"---|".repeat(header.split("|").length - 2)}`;
  return [
    "# 機能インベントリ（features）",
    "",
    "## 機能一覧",
    "",
    header,
    delimiter,
    `| ${slug} | 計画管理 | ${row.api} | ${row.evidence} | MST_PLAN | #210 |`,
    ...(row.extraRows ?? []),
    "",
  ].join("\n");
}

function run(dir, files, args) {
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "evidence-gap-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MEASURED_BOTH = features({
  api: "GET /api/plans, POST /api/plans",
  evidence:
    "GET /api/plans → 実測: 入口 SELECT と応答への写像を読了（母集合=MST_PLAN / 1 行=計画 1 件）／POST /api/plans → 実測: 要求の組み立てとハンドラのトランザクション境界を読了（1 要求が扱う対象=1 件）",
});

const ONE_ESTIMATED = features({
  api: "GET /api/plans, POST /api/plans",
  evidence:
    "GET /api/plans → 実測: 入口 SELECT と応答への写像を読了（母集合=MST_PLAN / 1 行=計画 1 件）／POST /api/plans → 推定: 同形の参照なし・要求単位は未確定",
});

function metadata(entries, options = {}) {
  const unmeasured = { declared: true, entries, reason: null };
  return JSON.stringify(options.omitUnmeasured ? { dataset_version: 3 } : { unmeasured }, null, 2);
}

test("陽性コントロール: 全ての口が実測なら exit 0", () => {
  withDir((dir) => {
    const r = run(dir, { "features.md": MEASURED_BOTH }, [
      "--features",
      "features.md",
      "--slug",
      "plan",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("実測 2");
    expect(r.stdout).toContain("ok:");
  });
});

test("推定の口が宣言されていなければ exit 1 で名指しする", () => {
  withDir((dir) => {
    const r = run(dir, { "features.md": ONE_ESTIMATED }, [
      "--features",
      "features.md",
      "--slug",
      "plan",
    ]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("POST /api/plans");
    expect(r.stdout).toContain("根拠が推定");
    expect(r.stdout).not.toContain("GET /api/plans（");
  });
});

test("陽性コントロール: 推定の口が unmeasured の endpoint に宣言済みなら exit 0", () => {
  withDir((dir) => {
    const r = run(
      dir,
      {
        "features.md": ONE_ESTIMATED,
        "metadata.json": metadata([
          {
            item: "POST /api/plans の要求単位",
            reason: "ハンドラが受領資産に無い",
            endpoint: "POST /api/plans",
            disposition: "blocking",
          },
        ]),
      },
      ["--features", "features.md", "--slug", "plan", "--unmeasured", "metadata.json"],
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("宣言済み 1");
  });
});

test("item の散文に口が含まれるだけでは宣言に数えない（部分一致で別の口を宣言済みにしない）", () => {
  withDir((dir) => {
    const r = run(
      dir,
      {
        "features.md": ONE_ESTIMATED,
        "metadata.json": metadata([
          { item: "POST /api/plans の要求単位", reason: "未読", disposition: "blocking" },
        ]),
      },
      ["--features", "features.md", "--slug", "plan", "--unmeasured", "metadata.json"],
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("宣言されていない");
  });
});

test("別の口の endpoint 宣言では通らない", () => {
  withDir((dir) => {
    const r = run(
      dir,
      {
        "features.md": ONE_ESTIMATED,
        "metadata.json": metadata([
          {
            item: "GET の要求単位",
            reason: "未読",
            endpoint: "GET /api/plans",
            disposition: "blocking",
          },
        ]),
      },
      ["--features", "features.md", "--slug", "plan", "--unmeasured", "metadata.json"],
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("POST /api/plans");
  });
});

test("API 列にあるのに根拠のエントリが対応づかない口を未確認として数える", () => {
  withDir((dir) => {
    const text = features({
      api: "GET /api/plans, DELETE /api/plans/:id",
      evidence:
        "GET /api/plans → 実測: 入口 SELECT と応答への写像を読了（母集合=MST_PLAN / 1 行=計画 1 件）",
    });
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("DELETE /api/plans/:id");
    expect(r.stdout).toContain("根拠のエントリが対応づかない");
  });
});

test("散文で口をまとめたエントリ（両方）は対応づけに数えない", () => {
  withDir((dir) => {
    const text = features({
      api: "GET /api/plans, GET /api/plans/:id",
      evidence: "両方 → 実測: 入口 SELECT と応答への写像を読了（母集合=MST_PLAN / 1 行=計画 1 件）",
    });
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("未確認 2");
    expect(r.stdout).toContain("根拠エントリの口 両方 は API 列に無い");
  });
});

test("語彙外の根拠は実測に倒さず未確認として数える", () => {
  withDir((dir) => {
    const text = features({
      api: "GET /api/plans",
      evidence: "GET /api/plans → 入口クエリあり（ソース）",
    });
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("語彙が実測でも推定でもない");
  });
});

test("実測と推定の両方が同じ口へ対応づくのは矛盾として未確認に倒す", () => {
  withDir((dir) => {
    const text = features({
      api: "GET /api/plans",
      evidence:
        "GET /api/plans → 実測: 読了（母集合=MST_PLAN / 1 行=計画 1 件）／GET /api/plans → 推定: 要求単位は未確定",
    });
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("矛盾");
  });
});

test("根拠列を持たない features.md は判定不能（exit 3）で、合格に倒さない", () => {
  withDir((dir) => {
    const text = [
      "## 機能一覧",
      "",
      "| slug | 機能名 | 新規実装 API | テーブル |",
      "|---|---|---|---|",
      "| plan | 計画管理 | GET /api/plans | MST_PLAN |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("undecidable:");
  });
});

test("unmeasured キーの無い旧成果物は判定不能（exit 3）", () => {
  withDir((dir) => {
    const r = run(
      dir,
      { "features.md": ONE_ESTIMATED, "metadata.json": metadata([], { omitUnmeasured: true }) },
      ["--features", "features.md", "--slug", "plan", "--unmeasured", "metadata.json"],
    );
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("unmeasured");
  });
});

test("slug が無い・重複する入力は不備（exit 2）", () => {
  withDir((dir) => {
    const missing = run(dir, { "features.md": ONE_ESTIMATED }, [
      "--features",
      "features.md",
      "--slug",
      "order",
    ]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("行がインベントリに無い");

    const duplicated = features({
      api: "GET /api/plans",
      evidence: "GET /api/plans → 実測: 読了（母集合=MST_PLAN / 1 行=計画 1 件）",
      extraRows: [
        "| plan | 計画管理（別表記） | GET /api/plans | GET /api/plans → 推定: 未確定 | MST_PLAN | #211 |",
      ],
    });
    const twice = run(dir, { "features.md": duplicated }, [
      "--features",
      "features.md",
      "--slug",
      "plan",
    ]);
    expect(twice.status).toBe(2);
    expect(twice.stderr).toContain("2 件ある");
  });
});

test("API 列に同じ口が 2 回あるのは不備（exit 2）", () => {
  withDir((dir) => {
    const text = features({
      api: "GET /api/plans, GET /api/plans",
      evidence: "GET /api/plans → 実測: 読了（母集合=MST_PLAN / 1 行=計画 1 件）",
    });
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("重複");
  });
});

test("横断 API 表（API 列）の行も対象にする", () => {
  withDir((dir) => {
    const text = [
      "## 横断 API（リソース単位）",
      "",
      "| slug | リソース | API | 要求単位の根拠 | 参照テーブル |",
      "|---|---|---|---|---|",
      "| user | ユーザー | GET /api/users | GET /api/users → 推定: 出どころ不明・要求単位は未確定 | MST_USER |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "user"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("GET /api/users");
  });
});

test("整形の揺れ（桁詰め・全角空白）では判定が変わらない", () => {
  withDir((dir) => {
    const text = features({
      api: "GET　/api/plans,   POST /api/plans",
      evidence:
        "GET /api/plans  →  実測: 読了（母集合=MST_PLAN / 1 行=計画 1 件）／ POST　/api/plans → 実測: 要求の組み立てとハンドラの境界を読了（1 要求が扱う対象=1 件）",
    });
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(0);
  });
});

test("実測 の前方一致では通さない（実測できず を 実測 に化けさせない）", () => {
  withDir((dir) => {
    const text = features({
      api: "GET /api/plans, POST /api/plans",
      evidence:
        "GET /api/plans → 実測: 読了（母集合=MST_PLAN / 1 行=計画 1 件）／POST /api/plans → 実測できず: ハンドラが受領資産に無い",
    });
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("POST /api/plans");
    expect(r.stdout).toContain("語彙が実測でも推定でもない");
  });
});

test("unmeasured.declared: false の entries は宣言に数えない（誰も効かせていない宣言で通さない）", () => {
  withDir((dir) => {
    const r = run(
      dir,
      {
        "features.md": ONE_ESTIMATED,
        "metadata.json": JSON.stringify({
          unmeasured: {
            declared: false,
            reason: "未測定は無い",
            entries: [
              {
                item: "POST /api/plans の要求単位",
                reason: "未読",
                endpoint: "POST /api/plans",
                disposition: "blocking",
              },
            ],
          },
        }),
      },
      ["--features", "features.md", "--slug", "plan", "--unmeasured", "metadata.json"],
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("宣言されていない");
  });
});

test("unmeasured.declared が真偽値でない成果物は不備（exit 2）", () => {
  withDir((dir) => {
    const r = run(
      dir,
      {
        "features.md": ONE_ESTIMATED,
        "metadata.json": JSON.stringify({ unmeasured: { entries: [] } }),
      },
      ["--features", "features.md", "--slug", "plan", "--unmeasured", "metadata.json"],
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("declared");
  });
});

test("コードフェンスの中の例示の表は読まない", () => {
  withDir((dir) => {
    const text = [
      "# 機能インベントリ（features）",
      "",
      "## 書き方の例",
      "",
      "```text",
      "| slug | 機能名 | 新規実装 API | 要求単位の根拠 | Issue |",
      "|---|---|---|---|---|",
      "| plan | 例 | GET /api/example | GET /api/example → 実測: 例 | #1 |",
      "```",
      "",
      "## 機能一覧",
      "",
      "| slug | 機能名 | 新規実装 API | 要求単位の根拠 | Issue |",
      "|---|---|---|---|---|",
      "| plan | 計画管理 | GET /api/plans | GET /api/plans → 推定: 未確定 | #210 |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("口 1 件");
    expect(r.stdout).toContain("GET /api/plans");
  });
});

test("口を持たない行（なし）を口として数えない", () => {
  withDir((dir) => {
    const text = features({ api: "なし", evidence: "-" });
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("口 0 件");
  });
});

test("根拠列がその行の表にだけ無いのは判定不能（exit 3。行が無い＝不備に倒さない）", () => {
  withDir((dir) => {
    const text = [
      "## 機能一覧",
      "",
      "| slug | 機能名 | 新規実装 API | 要求単位の根拠 | Issue |",
      "|---|---|---|---|---|",
      "| plan | 計画管理 | GET /api/plans | GET /api/plans → 実測: 読了（母集合=P / 1 行=1 件） | #210 |",
      "",
      "## 横断 API（リソース単位）",
      "",
      "| slug | リソース | API | 参照テーブル |",
      "|---|---|---|---|",
      "| user | ユーザー | GET /api/users | MST_USER |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "user"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("undecidable:");
  });
});

test("読めない入力（ディレクトリ）は exit 2（漏れありの exit 1 に化けさせない）", () => {
  withDir((dir) => {
    const r = run(dir, { "features.md": ONE_ESTIMATED }, ["--features", ".", "--slug", "plan"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("error:");
  });
});

test("GFM の短い区切り（|-|-|）でも表として読む", () => {
  withDir((dir) => {
    const text = [
      "## 機能一覧",
      "",
      "| slug | 新規実装 API | 要求単位の根拠 |",
      "|-|-|-|",
      "| plan | GET /api/plans | GET /api/plans → 推定: 要求単位は未確定 |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain("undecidable:");
  });
});

test("行頭・行末の | が無い表も読む（exit 3 の誤判定に倒さない）", () => {
  withDir((dir) => {
    const text = [
      "## 機能一覧",
      "",
      "slug | 新規実装 API | 要求単位の根拠",
      "--- | --- | ---",
      "plan | GET /api/plans | GET /api/plans → 推定: 要求単位は未確定",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain("undecidable:");
  });
});

test("API 列が空欄は未調査（exit 2）——明示の「なし」（exit 0）と分ける", () => {
  withDir((dir) => {
    const blank = features({ api: "", evidence: "" });
    const r = run(dir, { "features.md": blank }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("空欄");

    const none = features({
      api: "なし",
      evidence: "なし → 実測: 口を持たない画面（根拠: UI の実動作）",
    });
    const r2 = run(dir, { "features.md": none }, ["--features", "features.md", "--slug", "plan"]);
    expect(r2.status).toBe(0);
  });
});

test("対象外の判定は --unmeasured の読み取りより先（未生成でも exit 4）", () => {
  withDir((dir) => {
    const text = [
      "## バッチ",
      "",
      "| slug | バッチ名 | 入力 | 比較する出力 | 参照テーブル | Issue |",
      "|---|---|---|---|---|---|",
      "| monthly-summary | 月次集計 | ゴールデンデータセット | summaries | MST_PLAN | #220 |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, [
      "--features",
      "features.md",
      "--slug",
      "monthly-summary",
      "--unmeasured",
      "missing-metadata.json",
    ]);
    expect(r.status).toBe(4);
    expect(r.stderr).not.toContain("ENOENT");
  });
});

test("全ての口が実測なら、unmeasured キーの無い旧成果物でも exit 0（判定不能に倒さない）", () => {
  withDir((dir) => {
    const r = run(
      dir,
      { "features.md": MEASURED_BOTH, "metadata.json": metadata([], { omitUnmeasured: true }) },
      ["--features", "features.md", "--slug", "plan", "--unmeasured", "metadata.json"],
    );
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("undecidable:");
  });
});

test("口の列らしい見出しがあれば、根拠列が無くても対象外（exit 4）に倒さない", () => {
  withDir((dir) => {
    const text = [
      "## 機能一覧",
      "",
      "| slug | 新規実装API |",
      "|---|---|",
      "| plan | GET /api/plans |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(2);
    expect(r.stderr).not.toContain("not-applicable:");
  });
});

test("引数の不備は exit 2 で使い方を出す", () => {
  withDir((dir) => {
    const r = run(dir, { "features.md": ONE_ESTIMATED }, ["--features", "features.md"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--slug は必須");
  });
});

test("バッチ表の行は対象外（exit 4）で、行が無い（exit 2）にも判定不能（exit 3）にも倒さない", () => {
  withDir((dir) => {
    const text = [
      "## バッチ",
      "",
      "| slug | バッチ名 | 入力 | 比較する出力 | 参照テーブル | Issue |",
      "|---|---|---|---|---|---|",
      "| monthly-summary | 月次集計 | ゴールデンデータセット | summaries | MST_PLAN | #220 |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, [
      "--features",
      "features.md",
      "--slug",
      "monthly-summary",
    ]);
    expect(r.status).toBe(4);
    expect(r.stderr).toContain("not-applicable:");
    expect(r.stderr).toContain("API の口を持たない表");
  });
});

test("根拠列はあるのに口の列名がずれている表は入力の不備（exit 2）——対象外へ倒さない", () => {
  withDir((dir) => {
    const text = [
      "## 機能一覧",
      "",
      "| slug | 新規実装API | 要求単位の根拠 |",
      "|---|---|---|",
      "| plan | GET /api/plans | GET /api/plans → 推定: 要求単位は未確定 |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("列名が規約とずれている");
    expect(r.stderr).not.toContain("not-applicable:");
  });
});

test("「その他の Issue」表の行も対象外（exit 4）", () => {
  withDir((dir) => {
    const text = [
      "## その他の Issue（4 種以外）",
      "",
      "| slug | 内容 | 依存順 | 影響範囲 | Issue |",
      "|---|---|---|---|---|",
      "| schema | 新側スキーマを先に作る | 先頭 | 全テーブル | #221 |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "schema"]);
    expect(r.status).toBe(4);
  });
});

test("口を持つ表と持たない表の両方に同じ slug があれば重複として exit 2（対象外へ倒さない）", () => {
  withDir((dir) => {
    const text = [
      features({
        api: "GET /api/plans",
        evidence: "GET /api/plans → 実測: 読了（母集合=MST_PLAN / 1 行=計画 1 件）",
      }),
      "## バッチ",
      "",
      "| slug | バッチ名 | 入力 | 比較する出力 | 参照テーブル | Issue |",
      "|---|---|---|---|---|---|",
      "| plan | 計画集計 | ゴールデンデータセット | summaries | MST_PLAN | #220 |",
      "",
    ].join("\n");
    const r = run(dir, { "features.md": text }, ["--features", "features.md", "--slug", "plan"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("2 件ある");
  });
});

test("features.md が無ければ exit 2（合格に倒さない）", () => {
  withDir((dir) => {
    const r = run(dir, {}, ["--features", "missing.md", "--slug", "plan"]);
    expect(r.status).toBe(2);
  });
});
