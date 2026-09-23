// eval assertion の到達性宣言（reachability）検査の回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸             | 値                                                                              |
// | -------------- | -------------------------------------------------------------------------------- |
// | skill_name     | 正常 / 欠落 / ":" を含む                                                          |
// | evals          | 配列 / 非配列                                                                     |
// | eval           | オブジェクト / null                                                               |
// | id             | 数値 / 文字列 / 欠落 / ":" を含む / 重複                                          |
// | prompt         | 正常 / 空                                                                         |
// | assertions     | 正常 / 空配列 / 空要素 / テキスト重複                                             |
// | reachability   | 無い（免除あり・指紋一致 / 免除あり・指紋不一致 / 免除なし） / ある                |
// | reachability[] | 正常 / 非オブジェクト / assertion 不在 / assertion 重複 / quote 空 / quote 非部分文字列 |
// | 網羅           | 全 assertion に対応あり / 対応の無い assertion が残る                             |
// | backlog        | 存在 / 不在 / 孤児キー / reachability 済みなのに残存                              |
// | 走査モード     | 全走査（孤児を見る） / 部分走査（見ない）                                          |
//
// 陰性コントロール（通さねばならない入力）は 2 つ——(1) reachability を正しく書いた eval、
// (2) **実リポジトリ全体**（299 eval が backlog の宣言で通ること）。
// 陽性コントロールも実データから取る（実在の eval の prompt を 1 文字変えると指紋が外れること）。
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKLOG_PATH,
  backlogKey,
  checkAll,
  checkEvalFile,
  evalFingerprint,
  listEvalFiles,
} from "./check-eval-reachability.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-eval-reachability.js");

const PROMPT = "この画面の回帰を見たい。撮る状態をどう決めて、何をどこに残すか教えて。";
const A1 = "撮る状態の決め方を述べている";
const A2 = "残す場所を述べている";

const file = (overrides = {}, evalOverrides = {}) =>
  JSON.stringify({
    skill_name: "demo",
    evals: [
      {
        id: 1,
        prompt: PROMPT,
        assertions: [A1, A2],
        reachability: [
          { assertion: A1, prompt_quote: "撮る状態をどう決めて" },
          { assertion: A2, prompt_quote: "何をどこに残すか" },
        ],
        ...evalOverrides,
      },
    ],
    ...overrides,
  });

const check = (source, backlog = {}) => checkEvalFile("evals.json", source, backlog).violations;

test("陰性コントロール: 正しい reachability は違反 0 件", () => {
  expect(check(file())).toEqual([]);
});

test("陰性コントロール（実データ）: 実リポジトリの全 eval が backlog の宣言で通る", () => {
  const files = listEvalFiles(repoRoot);
  expect(files.length).toBeGreaterThan(0);
  const { evals, violations } = checkAll(repoRoot, files);
  expect(violations).toEqual([]);
  expect(evals).toBeGreaterThan(100);
});

test("陽性コントロール（実データ）: 実在の eval の prompt を変えると免除の指紋が外れる", () => {
  const files = listEvalFiles(repoRoot);
  const target = files[0];
  const parsed = JSON.parse(readFileSync(target, "utf8"));
  const ev = parsed.evals.find((e) => !Object.hasOwn(e, "reachability"));
  expect(ev).toBeDefined();
  const backlog = JSON.parse(readFileSync(join(repoRoot, BACKLOG_PATH), "utf8")).exempt;
  const key = backlogKey(parsed.skill_name, ev.id);
  expect(backlog[key]).toBe(evalFingerprint(ev));
  // prompt を 1 文字足すと指紋が変わる＝免除が外れる。
  expect(evalFingerprint({ ...ev, prompt: `${ev.prompt}。` })).not.toBe(backlog[key]);
});

test("reachability が無く免除も無ければ落とす（指紋を添えて案内する）", () => {
  const v = check(file({}, { reachability: undefined }));
  expect(v).toHaveLength(1);
  expect(v[0]).toMatch(/reachability が無い/);
  expect(v[0]).toContain(`"demo:1"`);
});

test("免除があり指紋が一致すれば通す（段階適用）", () => {
  const source = file({}, { reachability: undefined });
  const ev = JSON.parse(source).evals[0];
  expect(check(source, { "demo:1": evalFingerprint(ev) })).toEqual([]);
});

test("免除の指紋が古ければ落とす（eval を書き換えたら免除は外れる）", () => {
  const source = file({}, { reachability: undefined });
  const v = check(source, { "demo:1": "0000000000000000" });
  expect(v).toHaveLength(1);
  expect(v[0]).toMatch(/backlog の指紋が古い/);
});

test("reachability があるのに免除が残っていたら落とす", () => {
  const v = check(file(), { "demo:1": "0000000000000000" });
  expect(v).toEqual([
    "evals.json #1: reachability があるのに scripts/eval-reachability-backlog.json に残っている（項目を消す）",
  ]);
});

test("prompt_quote が prompt の部分文字列でなければ落とす", () => {
  const v = check(
    file(
      {},
      {
        reachability: [
          { assertion: A1, prompt_quote: "存在しない文" },
          { assertion: A2, prompt_quote: "何をどこに残すか" },
        ],
      },
    ),
  );
  expect(v).toHaveLength(1);
  expect(v[0]).toMatch(/prompt_quote が prompt の部分文字列でない/);
});

test("prompt_quote が空なら落とす", () => {
  const v = check(
    file(
      {},
      {
        reachability: [
          { assertion: A1, prompt_quote: "  " },
          { assertion: A2, prompt_quote: "何をどこに残すか" },
        ],
      },
    ),
  );
  expect(v).toEqual([
    "evals.json #1 reachability[0]: prompt_quote が空（引用を書けない assertion は prompt 側に問いを足すか落とす）",
  ]);
});

test("assertion が assertions に実在しなければ落とす（位置で対応づけない）", () => {
  const v = check(
    file(
      {},
      {
        reachability: [
          { assertion: "どこにも無い assertion", prompt_quote: "撮る状態をどう決めて" },
          { assertion: A2, prompt_quote: "何をどこに残すか" },
        ],
      },
    ),
  );
  expect(v).toHaveLength(2);
  expect(v[0]).toMatch(/assertion が assertions に実在しない/);
  expect(v[1]).toMatch(/対応要素の無い assertion/);
});

test("同じ assertion を 2 回宣言したら落とす（1 本ぶんの引用で 2 本を通さない）", () => {
  const v = check(
    file(
      {},
      {
        reachability: [
          { assertion: A1, prompt_quote: "撮る状態をどう決めて" },
          { assertion: A1, prompt_quote: "何をどこに残すか" },
        ],
      },
    ),
  );
  expect(v).toHaveLength(2);
  expect(v[0]).toMatch(/同じ assertion が 2 回宣言されている/);
  expect(v[1]).toMatch(/対応要素の無い assertion/);
});

test("対応要素の無い assertion が残れば落とす", () => {
  const v = check(
    file({}, { reachability: [{ assertion: A1, prompt_quote: "撮る状態をどう決めて" }] }),
  );
  expect(v).toHaveLength(1);
  expect(v[0]).toMatch(/対応要素の無い assertion/);
});

test("reachability の要素がオブジェクトでなければ落とす", () => {
  const v = check(file({}, { reachability: ["文字列"] }));
  expect(v.some((x) => x.includes("要素がオブジェクトでない"))).toBe(true);
});

test("reachability が配列でなければ落とす", () => {
  const v = check(file({}, { reachability: { [A1]: "撮る状態をどう決めて" } }));
  expect(v).toEqual(["evals.json #1: reachability が配列でない"]);
});

test("鍵の材料: skill_name / id に区切り文字や欠落があれば落とす", () => {
  expect(check(file({ skill_name: "de:mo" }))[0]).toMatch(/skill_name が文字列でないか/);
  expect(check(file({ skill_name: undefined }))[0]).toMatch(/skill_name が文字列でないか/);
  expect(check(file({}, { id: undefined }))[0]).toMatch(/id が無い/);
  expect(check(file({}, { id: "a:b" }))[0]).toMatch(/id に ":" を含む/);
});

test("id の重複を落とす（免除が別の eval へ効いてしまう）", () => {
  const parsed = JSON.parse(file());
  parsed.evals.push({ ...parsed.evals[0] });
  const v = check(JSON.stringify(parsed));
  expect(v).toEqual(["evals.json #1: id が重複している"]);
});

test("prompt / assertions の退化形を落とす", () => {
  expect(check(file({}, { prompt: "   " }))[0]).toMatch(/prompt が空/);
  expect(check(file({}, { assertions: [] }))[0]).toMatch(/assertions が空/);
  expect(check(file({}, { assertions: [A1, ""] }))[0]).toMatch(/空・非文字列の要素/);
  expect(check(file({}, { assertions: [A1, A1] }))[0]).toMatch(/assertions のテキストが重複/);
});

test("evals が配列でない・JSON として壊れている入力を落とす", () => {
  expect(check(JSON.stringify({ skill_name: "demo", evals: {} }))[0]).toMatch(/evals が配列でない/);
  expect(check("{ not json")[0]).toMatch(/JSON として読めない/);
});

test("孤児の免除は全走査でだけ落とす（部分走査では正常な commit を止めない）", () => {
  const root = mkdtempSync(join(tmpdir(), "eval-reach-"));
  mkdirSync(join(root, "evals/demo"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  const evalsPath = join(root, "evals/demo/evals.json");
  writeFileSync(evalsPath, file());
  writeFileSync(
    join(root, BACKLOG_PATH),
    JSON.stringify({ exempt: { "demo:99": "0000000000000000" } }, null, 2),
  );
  expect(checkAll(root, [evalsPath]).violations).toEqual([
    `${BACKLOG_PATH}: "demo:99" に対応する eval が無い（孤児の免除）`,
  ]);
  expect(checkAll(root, [evalsPath], { fullScan: false }).violations).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});

test("配布スキルの中の eval（skills/<name>/evals/）は全走査でだけ落とす", () => {
  const root = mkdtempSync(join(tmpdir(), "eval-reach-"));
  mkdirSync(join(root, "evals/demo"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  const evalsPath = join(root, "evals/demo/evals.json");
  writeFileSync(evalsPath, file());
  writeFileSync(join(root, BACKLOG_PATH), JSON.stringify({ exempt: {} }));
  // 陰性コントロール: 置き場所が evals/<name>/ だけなら違反 0 件で、走査にも拾われる。
  expect(listEvalFiles(root)).toEqual([evalsPath]);
  expect(checkAll(root, [evalsPath]).violations).toEqual([]);
  // 陽性コントロール: 旧配置に戻すと、走査から外れる（listEvalFiles は拾わない）うえで違反になる。
  mkdirSync(join(root, "skills/demo/evals"), { recursive: true });
  writeFileSync(join(root, "skills/demo/evals/evals.json"), file());
  expect(listEvalFiles(root)).toEqual([evalsPath]);
  expect(checkAll(root, [evalsPath]).violations).toEqual([
    "skills/demo/evals/: 配布スキルの中に eval がある（下流へ配られ、この検査の走査からも外れる）。evals/demo/ へ置く",
  ]);
  expect(checkAll(root, [evalsPath], { fullScan: false }).violations).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});

test("backlog が無ければ免除の正本が読めないので落とす", () => {
  const root = mkdtempSync(join(tmpdir(), "eval-reach-"));
  mkdirSync(join(root, "evals/demo"), { recursive: true });
  const evalsPath = join(root, "evals/demo/evals.json");
  writeFileSync(evalsPath, file());
  expect(checkAll(root, [evalsPath]).violations[0]).toMatch(/宣言ファイルが無い/);
  rmSync(root, { recursive: true, force: true });
});

test("backlog が壊れていても、クラッシュせず違反として落とす", () => {
  // 不在を違反にしている以上、壊れている場合も違反にする（素の JSON.parse だと merge 衝突の
  // 残骸でスタックトレースごと検査が止まり、「検査した結果」ではなくクラッシュで落ちる）。
  const root = mkdtempSync(join(tmpdir(), "eval-reach-"));
  mkdirSync(join(root, "evals/demo"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  const evalsPath = join(root, "evals/demo/evals.json");
  writeFileSync(evalsPath, file());
  writeFileSync(join(root, BACKLOG_PATH), '{ "exempt": { "demo:1": ');
  expect(checkAll(root, [evalsPath]).violations[0]).toMatch(/宣言ファイルを読めない/);
  // トップレベルが配列の宣言ファイルも同じ扱い（exempt を読めないのは同じ）。
  writeFileSync(join(root, BACKLOG_PATH), "[]");
  expect(checkAll(root, [evalsPath]).violations[0]).toMatch(/宣言ファイルを読めない/);
  rmSync(root, { recursive: true, force: true });
});

test.each([
  ["null", "null"],
  ["配列", '[{ "id": 1 }]'],
  ["数値", "42"],
])("トップレベルが %s の evals.json はクラッシュせず違反にする", (_name, source) => {
  const violations = check(source);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/トップレベルが/);
});

test("CLI: 対象 0 件は成功に倒さず exit 1", () => {
  const root = mkdtempSync(join(tmpdir(), "eval-reach-"));
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/evals\.json が 0 件/);
  rmSync(root, { recursive: true, force: true });
});

test("CLI: 実リポジトリの全走査は exit 0 で件数を出す", () => {
  const r = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/eval-reachability: OK（\d+ ファイル・\d+ eval）/);
});
