import { expect, test } from "vitest";
import { sanitizeClaudeSettings } from "./sanitize-claude-settings.ts";

test.each([
  ["許可リストの外のキーだけ", { hooks: {}, theme: "dark" }, {}],
  [
    "model と apiKeyHelper",
    { model: "opus", apiKeyHelper: "/bin/key" },
    { model: "opus", apiKeyHelper: "/bin/key" },
  ],
  [
    "Bedrock の認証に使う awsAuthRefresh と awsCredentialExport",
    { awsAuthRefresh: "aws sso login", awsCredentialExport: "/bin/creds", hooks: {} },
    { awsAuthRefresh: "aws sso login", awsCredentialExport: "/bin/creds" },
  ],
  [
    "env は接続先の接頭辞を持つ名前だけを残す",
    {
      env: { ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "r", MY_TOOL: "x" },
    },
    { env: { ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "r" } },
  ],
  [
    "env はプロキシと CA 証明書の名前も残し、似た名前は残さない",
    {
      env: {
        HTTPS_PROXY: "http://p:8080",
        no_proxy: "localhost",
        NODE_EXTRA_CA_CERTS: "/ca.pem",
        HTTPS_PROXY_EXTRA: "x",
      },
    },
    {
      env: { HTTPS_PROXY: "http://p:8080", no_proxy: "localhost", NODE_EXTRA_CA_CERTS: "/ca.pem" },
    },
  ],
  ["env が許可リストの名前を 1 つも持たなければ、env を置かない", { env: { MY_TOOL: "x" } }, {}],
  ["接頭辞を途中に含むだけの名前は残さない", { env: { MY_ANTHROPIC_KEY: "x" } }, {}],
])("%s", (_label, input, expected) => {
  expect(sanitizeClaudeSettings(JSON.stringify(input))).toEqual(expected);
});

test.each([
  ["JSON でない", "{ not json", /JSON/u],
  ["オブジェクトでない", "[]", /オブジェクトでない/u],
  ["env がオブジェクトでない", JSON.stringify({ env: "x" }), /env がオブジェクトでない/u],
])("%s なら例外にする", (_label, text, message) => {
  expect(() => sanitizeClaudeSettings(text)).toThrow(message);
});
