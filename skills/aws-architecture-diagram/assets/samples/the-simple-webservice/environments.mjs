// 環境レジストリ（＝このリポジトリに存在すべき環境の単一ソース）。
// The Simple Webservice は単一デプロイのため環境は 1 つ（prod）だけ。base をそのまま描く。
// 環境ごとに構成が分かれる場合は、ここへキーを足し transform で差分を表現する
// （詳細は references/environments.md）。
import { baseSpec } from "./architecture-spec.mjs";

// 環境 → spec の解決はエンジン（render-diagram.mjs）が行うので、ここは定義だけでよい。
// title を省いた環境は base（architecture-spec.mjs）の title を既定に使う。
export const environments = {
  prod: {},
};

// エンジンが base を読めるよう再エクスポート。
export { baseSpec };
