// golden-dataset の lib/fence.mjs（コードフェンスを開く行と閉じる行の判定）の回帰テスト（Issue #679）。

import { expect, test } from "vitest";
import { stepFence } from "../../../skills/golden-dataset/scripts/lib/fence.mjs";

// フェンスの開閉（Issue #679）。閉じる行は、開いた記号と同じ文字で同じ長さ以上の記号の後ろが空白だけの行（CommonMark）。
test.each<{
  name: string;
  fence: string | null;
  line: string | undefined;
  expected: { fence: string | null; marker: boolean };
}>([
  {
    name: "開いていない・``` で開く",
    fence: null,
    line: "```",
    expected: { fence: "```", marker: true },
  },
  {
    name: "開いていない・情報文字列付きで開く",
    fence: null,
    line: "```bash",
    expected: { fence: "```", marker: true },
  },
  {
    name: "開いていない・情報文字列に行区切りの文字があっても開く",
    fence: null,
    line: "```a\u2028b",
    expected: { fence: "```", marker: true },
  },
  {
    name: "開いていない・~~~ で開く",
    fence: null,
    line: "~~~",
    expected: { fence: "~~~", marker: true },
  },
  {
    name: "開いていない・情報文字列にバッククォートを含む ``` は開かない",
    fence: null,
    line: "```x``` はインラインのコード",
    expected: { fence: null, marker: false },
  },
  {
    name: "開いていない・情報文字列にバッククォートを含む ~~~ は開く",
    fence: null,
    line: "~~~ `x`",
    expected: { fence: "~~~", marker: true },
  },
  {
    name: "開いていない・字下げ 4 文字は開かない",
    fence: null,
    line: "    ```",
    expected: { fence: null, marker: false },
  },
  {
    name: "開いていない・行が無い",
    fence: null,
    line: undefined,
    expected: { fence: null, marker: false },
  },
  {
    name: "開いている・同じ記号で閉じる",
    fence: "```",
    line: "```",
    expected: { fence: null, marker: true },
  },
  {
    name: "開いている・情報文字列付きの行では閉じない",
    fence: "```",
    line: "```bash",
    expected: { fence: "```", marker: false },
  },
  {
    name: "開いている・~~~ の情報文字列付きの行では閉じない",
    fence: "~~~",
    line: "~~~ text",
    expected: { fence: "~~~", marker: false },
  },
  {
    name: "開いている・後ろの空白とタブは閉じる",
    fence: "```",
    line: "```  \t",
    expected: { fence: null, marker: true },
  },
  {
    name: "開いている・長い記号で閉じる",
    fence: "```",
    line: "`````",
    expected: { fence: null, marker: true },
  },
  {
    name: "開いている・短い記号では閉じない",
    fence: "````",
    line: "```",
    expected: { fence: "````", marker: false },
  },
  {
    name: "開いている・別の文字では閉じない",
    fence: "```",
    line: "~~~",
    expected: { fence: "```", marker: false },
  },
  {
    name: "開いている・字下げ 3 文字は閉じる",
    fence: "```",
    line: "   ```",
    expected: { fence: null, marker: true },
  },
  {
    name: "開いている・字下げ 4 文字は閉じない",
    fence: "```",
    line: "    ```",
    expected: { fence: "```", marker: false },
  },
  {
    name: "開いている・行が無い",
    fence: "```",
    line: undefined,
    expected: { fence: "```", marker: false },
  },
])("stepFence: $name", ({ fence, line, expected }) => {
  expect(stepFence(fence, line)).toEqual(expected);
});
