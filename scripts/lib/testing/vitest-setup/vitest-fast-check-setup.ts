// vitest の setupFiles。プロパティベースのテスト（fast-check）が作る入力を、ミューテーションテストの実行のときだけ固定する（Issue #1071）。
//
// 通常の実行（pre-commit・CI）では seed を固定せず、実行のたびに違う入力を試す。失敗すると、fast-check が seed と path を出力する。
// ミューテーションテストは、変異を入れない実行と変異ごとの実行を比べる。入力が実行ごとに変わると、変異を検出するかも実行ごとに変わる。
// ミューテーションテストのランナー（scripts/mutation/check-mutation-proof.ts）は、子の vitest に MUTATION_PROOF_CHILD を渡すので、それで見分ける。
import fc from "fast-check";

/** ミューテーションテストの実行で使う seed。値に意味は無く、どの実行でも同じであればよい。 */
export const MUTATION_PROOF_SEED = 1071;

/** 環境変数から、固定する seed を決める。固定しないときは undefined を返す。 */
export function fastCheckSeed(env: NodeJS.ProcessEnv): number | undefined {
  return env.MUTATION_PROOF_CHILD ? MUTATION_PROOF_SEED : undefined;
}

const seed = fastCheckSeed(process.env);
if (seed !== undefined) fc.configureGlobal({ ...fc.readConfigureGlobal(), seed });
