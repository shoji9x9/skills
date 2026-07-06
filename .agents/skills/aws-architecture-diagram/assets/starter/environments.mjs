// 環境レジストリ。**このリポジトリに「どの環境の構成図があるべきか」の単一ソース**。
// base 仕様（architecture-spec.mjs）を各環境で共有し、環境ごとの差分だけを
//   { title, transform?(base) => spec }
// で表現する。transform を省略した環境は base をそのまま描く。環境の差分は
// 未使用ノード/エッジの淡色（dim）化・ラベル差し替え・環境固有フローのエッジ追加・
// 凡例（notes）付与などで表す。base の配置を直せば全環境の図が自動追従する。
//
// 環境を増やす/減らすときはこの `environments` を編集する（例: staging を足す）。
// どの環境が base と同じかは対象システム次第。ここではサンプルとして
//   prod  … base そのまま（クラウド上の正規構成）
//   local … ローカル開発の差分を transform で表現
// を定義している。render-diagram.mjs は既定でここに定義した**全環境**を対象にし、
// --env で一部だけに絞れる（詳細は references/environments.md）。
import { baseSpec } from "./architecture-spec.mjs";

// local では使われない（クラウド固有の）ノード = 淡色化する。
const localDimIds = new Set(["s3site", "apigw", "queue", "events", "cognito"]);

// local でのラベル差し替え（id → 上書きするフィールド）。
const localRelabel = {
  cf: { label: ["Vite Dev Server", "（:5173）"] },
  api: { label: ["ローカル backend", "（:3001）"] },
  worker: { label: ["Worker", "（同一プロセス）"] },
  cognito: { label: ["Cognito UserPool", "（認証スキップ）"] },
  ddb: { label: ["DynamoDB", "（クラウド共有）"] },
};

// base を「ローカル構成」に変換する。
function toLocal(base) {
  const nodes = base.nodes.map((n) => ({
    ...n,
    ...localRelabel[n.id],
    ...(localDimIds.has(n.id) ? { dim: true } : {}),
  }));

  // 端点のどちらかが淡色ノードのエッジ = local 未使用フローとして淡色化。
  const edges = base.edges.map((e) => ({
    ...e,
    ...(localDimIds.has(e.from) || localDimIds.has(e.to) ? { dim: true } : {}),
  }));

  // local の実フロー（通常色）を追加。
  edges.push(
    // SPA(:5173) → ローカル backend(:3001) を直接呼ぶ（API Gateway は介さない）。
    {
      from: "browser",
      to: "api",
      label: "API :3001",
      waypoints: [
        [90, 470],
        [690, 470],
      ],
    },
    // Worker は backend と同一プロセス（SQS を介さず直接呼出）。
    {
      from: "api",
      to: "worker",
      dashed: true,
      label: "同一プロセス",
      waypoints: [
        [760, 380],
        [760, 490],
        [920, 490],
      ],
    },
  );

  return {
    ...base, // W/H/groups 等の base フィールドを引き継ぐ（下で上書きするものだけ差し替え）
    title: "システム構成図（ローカル）",
    nodes,
    edges,
    notes: [
      {
        x: 150,
        y: 700,
        w: 460,
        title: "凡例",
        lines: [
          "通常色 = ローカル稼働 / クラウド共有 / 外部 API",
          "淡色 = クラウドのみ（ローカル未使用）",
        ],
      },
    ],
  };
}

// このリポジトリに存在すべき環境の一覧（＝更新対象の母集合）。
// 環境 → spec の解決はエンジン（render-diagram.mjs）が行うので、ここは定義だけでよい。
// transform を持つ環境の title は transform 内で設定する（下の local は toLocal が設定）。
export const environments = {
  prod: { title: "システム構成図（prod）" },
  local: { transform: toLocal },
};

// エンジンが base を読めるよう再エクスポート。
export { baseSpec };
