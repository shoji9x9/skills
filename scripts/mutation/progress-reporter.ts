// ミューテーションテストのランナーが子の vitest に足す reporter。
// テストが始まるときと終わるときに 1 行ずつ、`MUTATION_PROOF_PROGRESS_FILE` に書く。
// 包む側のプロセス（`test-group-wrapper.ts`）は、この行が書かれない時間で、テストが進まなくなったことを知る。
//
// 行の形はタブ区切りで、次の 2 つである。名前に含まれるタブと改行は空白にする。
//   ready\t<テストの上限（ミリ秒）>\t<id>\t<名前>
//   result\t<id>\t<名前>
// 上限を書くのは、包む側が、上限の長いテストの実行中に誤って止めないようにするためである。
import { appendFileSync } from "node:fs";

type TestCaseLike = { id: string; fullName: string; options: { timeout?: number } };

function clean(text: string): string {
  return text.replace(/[\t\r\n]/g, " ");
}

export default class ProgressReporter {
  private readonly file = process.env.MUTATION_PROOF_PROGRESS_FILE;

  private write(line: string) {
    if (this.file) appendFileSync(this.file, `${line}\n`);
  }

  onTestCaseReady(testCase: TestCaseLike) {
    const timeout = testCase.options.timeout ?? 0;
    this.write(`ready\t${timeout}\t${testCase.id}\t${clean(testCase.fullName)}`);
  }

  onTestCaseResult(testCase: TestCaseLike) {
    this.write(`result\t${testCase.id}\t${clean(testCase.fullName)}`);
  }
}
