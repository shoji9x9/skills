// 構成図の「単一ソース」となる base 仕様。この配列だけを編集して図を更新する。
// 描画はスキル同梱のエンジン（assets/engine/diagram-engine.mjs）、環境ごとの派生は
// environments.mjs。作図ルールは references/conventions.md を参照。base は各環境で共有する
// 正規の構成で、環境ごとの差分は environments.mjs の transform で表現する（base を直せば
// 全環境が追従）。どの環境が base と同じかは対象システム次第（例: prod は base そのまま、
// local はローカル開発の差分を transform で表現）。
//
// これは汎用のサンプル構成（典型的なサーバーレス Web アプリ）。自分のシステムに
// 合わせて nodes / edges / groups を書き換える。座標は「同じ層は x か y を共有して
// 格子に乗せる」方針で決める（例: 永続層は x≈1190 の縦一列）。
//
// 配置方針: 外部 API（上段）→ 永続層（下段）を右側に縦に積み、アプリ層からの線が
//   永続層を貫通しないようにする。アプリ層 → 永続層は枠の左手前の隙間に幹線 x を
//   2 本（api 用 / worker 用）立て、枠線から十分離してから枠へ直交で入れる。

const W = 1540;
const H = 860;

// node: id, icon（iconDir 相対・拡張子なし。null は無地の箱）, label（複数行可）,
//        x/y（中心）, lp（ラベル位置: top/bottom/left/right。線の出ていない辺へ寄せる）
const nodes = [
  { id: "browser", icon: "browser", label: ["ブラウザ（利用者）"], x: 90, y: 380, lp: "top" },

  // アプリ層
  { id: "cf", icon: "aws-icons/cloudfront", label: ["CloudFront"], x: 260, y: 380, lp: "bottom" },
  {
    id: "s3site",
    icon: "aws-icons/s3",
    label: ["S3 SiteBucket", "（SPA 配信）"],
    x: 470,
    y: 230,
    lp: "bottom",
  },
  {
    id: "apigw",
    icon: "aws-icons/api-gateway",
    label: ["API Gateway", "Cognito Authorizer"],
    x: 470,
    y: 380,
    lp: "bottom",
  },
  { id: "api", icon: "aws-icons/lambda", label: ["Lambda: ApiFn"], x: 690, y: 380, lp: "top" },
  { id: "queue", icon: "aws-icons/sqs", label: ["SQS"], x: 690, y: 540, lp: "bottom" },
  {
    id: "events",
    icon: "aws-icons/eventbridge",
    label: ["EventBridge"],
    x: 470,
    y: 540,
    lp: "left",
  },
  {
    id: "worker",
    icon: "aws-icons/lambda",
    label: ["Lambda: Worker"],
    x: 920,
    y: 540,
    lp: "bottom",
  },

  // 外部 API（上段）
  { id: "extapi", icon: "internet", label: ["外部 API"], x: 1200, y: 235, lp: "top" },

  // 永続層（下段。x≈1190 の縦一列に揃える）
  { id: "ddb", icon: "aws-icons/dynamodb", label: ["DynamoDB"], x: 1190, y: 450, lp: "right" },
  {
    id: "ssm",
    icon: "aws-icons/ssm",
    label: ["SSM Parameter Store"],
    x: 1190,
    y: 620,
    lp: "bottom",
  },
  {
    id: "cognito",
    icon: "aws-icons/cognito",
    label: ["Cognito UserPool"],
    x: 1350,
    y: 450,
    lp: "top",
  },
];

// edge: from, to, label?, dashed?, waypoints?（経由点で他アイコン/ラベルを避けて直交配線）
const edges = [
  { from: "browser", to: "cf" },
  {
    from: "browser",
    to: "cognito",
    label: "認証 OTP",
    dashed: true,
    waypoints: [
      [90, 820],
      [1350, 820],
    ],
  },
  { from: "cf", to: "s3site", label: "既定" },
  { from: "cf", to: "apigw", label: "/api 配下" },
  { from: "apigw", to: "api" },
  { from: "api", to: "queue" },
  // アプリ層 → 永続層: api 用の幹線 x=1055（枠の左手前）に寄せてから各ノードへ分岐。
  {
    from: "api",
    to: "ddb",
    waypoints: [
      [1055, 380],
      [1055, 435],
    ],
  },
  {
    from: "api",
    to: "ssm",
    waypoints: [
      [1055, 380],
      [1055, 605],
    ],
  },
  {
    from: "events",
    to: "worker",
    waypoints: [
      [470, 600],
      [800, 600],
      [800, 540],
    ],
  },
  { from: "queue", to: "worker" },
  {
    from: "worker",
    to: "extapi",
    waypoints: [
      [1010, 540],
      [1010, 320],
      [1200, 320],
    ],
  },
  // worker 用の幹線 x=1080（api の幹線と 25px 離す）。進入 y を api 側とずらす。
  {
    from: "worker",
    to: "ddb",
    waypoints: [
      [1080, 540],
      [1080, 465],
    ],
  },
  {
    from: "worker",
    to: "ssm",
    waypoints: [
      [1080, 540],
      [1080, 635],
    ],
  },
];

// group: 背景の枠（ラベル付き）。x,y,w,h は左上基準。枠同士は重ねない。
const groups = [
  { label: "アプリ層", x: 175, y: 150, w: 855, h: 470, color: "#7AA116" },
  { label: "外部 API", x: 1100, y: 150, w: 390, h: 150, color: "#5A6B86" },
  { label: "永続層", x: 1100, y: 360, w: 390, h: 350, color: "#C925D1" },
];

// 各環境で共有する base 仕様（環境ごとの差分は environments.mjs の transform で表現）。
// title は環境ごとに environments.mjs で上書きする。
export const baseSpec = {
  W,
  H,
  title: "システム構成図",
  nodes,
  edges,
  groups,
};
