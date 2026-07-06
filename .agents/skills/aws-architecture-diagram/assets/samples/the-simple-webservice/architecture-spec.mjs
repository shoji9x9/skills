// The Simple Webservice の base 仕様。
// 出典: cdk-patterns/serverless の the-simple-webservice（MIT）の CDK コードから構成を導出
// （lib/the-simple-webservice-stack.ts。同リポジトリの構成図画像は参照していない）。
//
// CDK から読み取った構成:
//   - DynamoDB Table "Hits"（partitionKey: path）
//   - Lambda "DynamoLambdaHandler"（env: HITS_TABLE_NAME、table.grantReadWriteData で read/write）
//   - API Gateway HTTP API "Endpoint"（defaultIntegration = LambdaProxyIntegration(dynamoLambda)）
//   → 利用者 → API Gateway → Lambda → DynamoDB の単純な 1 本のチェーン。
//
// 作図ルールは references/conventions.md を参照。

const W = 1040;
const H = 440;

const nodes = [
  {
    id: "client",
    icon: "browser",
    label: ["利用者", "（HTTP クライアント）"],
    x: 100,
    y: 240,
    lp: "top",
  },

  // アプリ層
  {
    id: "api",
    icon: "aws-icons/api-gateway",
    label: ["API Gateway", "（HTTP API）"],
    x: 330,
    y: 240,
    lp: "bottom",
  },
  {
    id: "fn",
    icon: "aws-icons/lambda",
    label: ["Lambda", "DynamoLambdaHandler"],
    x: 560,
    y: 240,
    lp: "bottom",
  },

  // 永続層
  {
    id: "table",
    icon: "aws-icons/dynamodb",
    label: ["DynamoDB: Hits"],
    x: 840,
    y: 240,
    lp: "bottom",
  },
];

const edges = [
  { from: "client", to: "api", label: "HTTP" },
  { from: "api", to: "fn", label: "Lambda proxy" },
  { from: "fn", to: "table", label: "read/write" },
];

const groups = [
  { label: "アプリ層", x: 235, y: 150, w: 420, h: 180, color: "#7AA116" },
  { label: "永続層", x: 740, y: 150, w: 200, h: 180, color: "#C925D1" },
];

export const baseSpec = {
  W,
  H,
  title: "The Simple Webservice",
  nodes,
  edges,
  groups,
};
