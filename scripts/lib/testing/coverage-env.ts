// カバレッジを測る実行（scripts/coverage/run-coverage.ts）で、子プロセスに引き継ぐ環境変数。
//
// 子プロセスの環境を明示した値だけで組み立てると、計測の環境変数が子プロセスに渡らない。
// 渡らないと、その子プロセスの実行がカバレッジに数えられない。そこで、組み立てた環境にこの値を足す。
// 測らない実行では空の object を返すので、テストの条件は変わらない。
// NODE_V8_COVERAGE は、Node が環境を明示した子プロセスにも自分で引き継ぐ。ここで渡す値はそれと同じなので、結果は変わらない。

/** 計測の環境変数のうち、親に設定されているもの。 */
export function coverageEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const v8 = process.env.NODE_V8_COVERAGE;
  if (v8) env.NODE_V8_COVERAGE = v8;
  return env;
}
