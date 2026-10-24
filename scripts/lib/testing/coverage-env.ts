// カバレッジを測る実行（scripts/coverage/run-coverage.ts）で、子プロセスに渡す計測の環境変数。
//
// 計測の環境変数は NODE_V8_COVERAGE だけで、Node は環境を明示して起動した子プロセスにもこれを自分で引き継ぐ。
// そのため、この関数が返す値は、Node が引き継ぐ値と同じで、足しても結果は変わらない。
// 測らない実行では空の object を返すので、テストの条件は変わらない。

/** 計測の環境変数のうち、親に設定されているもの。 */
export function coverageEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const v8 = process.env.NODE_V8_COVERAGE;
  if (v8) env.NODE_V8_COVERAGE = v8;
  return env;
}
