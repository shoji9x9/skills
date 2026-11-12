// spec-parity の lib/pending-state.mjs（保留 1 件の状態の判定）の回帰テスト（Issue #995）。
//
// 判定は replace-strategy の scripts/lib/pending-state.mjs と同じ中身で持つ。
// 原本の振る舞いは replace-strategy の pending-decisions-check.test.ts が測り、中身が同じことは check-identical-copies.ts が確かめる。
// カバレッジの閾値はファイルごとに測るので、このテストは spec-parity のコピーの判定を呼び、状態の定義（replace-strategy の references/autonomy.md「保留の状態」）どおりに数えることを確かめる。

import { describe, expect, test } from "vitest";
import { classifyDecision as copy } from "../../../skills/spec-parity/scripts/lib/pending-state.mjs";

const ANSWERED = { answer: "A にする", answered_at: "2026-11-11T00:00:00Z" };
const RESUMED = { at: "2026-11-11T01:00:00Z", evidence: ["verify.md"] };
const FOLLOW_UP = { what: "残りの確認", tracked_in: "#12" };

const cases: [string, unknown, "open" | "decided" | "settled"][] = [
  ["要素がオブジェクトでない", "pd-1", "open"],
  ["resolution が null", { blocks: ["x"], resolution: null }, "open"],
  ["resolution が欠落", { blocks: ["x"] }, "open"],
  ["resolution がオブジェクトでない", { blocks: ["x"], resolution: true }, "open"],
  ["answer が無い", { blocks: [], resolution: { answered_at: "t" } }, "open"],
  ["answer が雛形の値", { blocks: [], resolution: { ...ANSWERED, answer: "<回答>" } }, "open"],
  ["answered_at が無い", { blocks: [], resolution: { answer: "a" } }, "open"],
  ["blocks が空", { blocks: [], resolution: ANSWERED }, "settled"],
  ["blocks があり、実施の記録も置き場も無い", { blocks: ["x"], resolution: ANSWERED }, "decided"],
  [
    "blocks があり、実施の記録がある",
    { blocks: ["x"], resolution: { ...ANSWERED, resumed: RESUMED } },
    "settled",
  ],
  [
    "実施の記録の証拠が雛形の値だけ",
    { blocks: ["x"], resolution: { ...ANSWERED, resumed: { ...RESUMED, evidence: ["<証拠>"] } } },
    "decided",
  ],
  [
    "blocks があり、置き場がある",
    { blocks: ["x"], resolution: { ...ANSWERED, follow_up: FOLLOW_UP } },
    "settled",
  ],
  [
    "置き場の残作業が無い",
    { blocks: ["x"], resolution: { ...ANSWERED, follow_up: { tracked_in: "#12" } } },
    "decided",
  ],
  [
    "blocks が配列でなく、実施の記録がある",
    { blocks: "x", resolution: { ...ANSWERED, resumed: RESUMED } },
    "settled",
  ],
  ["blocks が配列でなく、実施の記録が無い", { blocks: "x", resolution: ANSWERED }, "decided"],
];

describe("保留 1 件の状態（spec-parity のコピー）", () => {
  test.each(cases)("%s なら、定義どおりの状態にする", (_name, element, state) => {
    expect(copy(element).state).toBe(state);
  });
});
