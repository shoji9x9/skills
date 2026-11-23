// `@bcoe/v8-coverage` の型（パッケージが型の宣言を持たない）。`tsconfig.repo.json` の `paths` がこのファイルへ解決する。
// `scripts/coverage/run-coverage.ts` が使う関数と形だけを書く。使う関数や欄を増やしたら、ここにも足す。

/** V8 の記録の 1 つのブロックの範囲と、実行された回数。 */
export interface RangeCov {
  startOffset: number;
  endOffset: number;
  count: number;
}

/** V8 の記録の 1 つの関数。 */
export interface FunctionCov {
  functionName: string;
  ranges: RangeCov[];
  isBlockCoverage: boolean;
}

/** V8 の記録の 1 つのスクリプト。 */
export interface ScriptCov {
  scriptId: string;
  url: string;
  functions: FunctionCov[];
}

/** V8 の記録の 1 ファイル（NODE_V8_COVERAGE が書く 1 プロセス分）。 */
export interface ProcessCov {
  result: ScriptCov[];
}

/** 同じ URL のスクリプトの記録を合算する。渡した値は書き換えられるので、後で使わない。 */
export declare function mergeProcessCovs(processCovs: readonly ProcessCov[]): ProcessCov;
