// 週次の指標のスクリプトが git と gh を起動する呼び出し。check-cost-metrics.ts と test-lines.ts が共有する。
// test-lines.ts は依存を入れないジョブ（self-review.yml）からも起動するので、外部のパッケージを import しない。
import { spawnAsync } from "../../lib/spawn-async.ts";

export type Runner = (command: string, args: readonly string[]) => Promise<string>;

/** 1 回の呼び出しの上限。gh api は 1 回で数秒なので、止まったときに気付けるよう 2 分で打ち切る。 */
const CALL_TIMEOUT_MS = 120_000;

/** 本番の呼び出し。失敗（起動できない・0 以外で終わる・時間切れ）は、stderr を添えて例外にする。 */
export const defaultRunner: Runner = async (command, args) => {
  const result = await spawnAsync(command, args, { timeout: CALL_TIMEOUT_MS });
  if (result.error !== undefined || result.status !== 0) {
    const reason = result.error?.message ?? `終了コード ${String(result.status)}`;
    throw new Error(
      `${command} ${args.join(" ")} が失敗した（${reason}）: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
};
