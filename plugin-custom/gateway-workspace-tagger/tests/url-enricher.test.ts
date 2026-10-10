import { describe, expect, test } from "vitest";
import { enrichUrlWithWorkspace, isGatewayBaseUrl } from "../shared/url-enricher.js";

describe("isGatewayBaseUrl", () => {
  test("matches well-known LLM gateway base URL keys", () => {
    expect(isGatewayBaseUrl("ANTHROPIC_BASE_URL")).toBe(true);
    expect(isGatewayBaseUrl("OPENAI_BASE_URL")).toBe(true);
    expect(isGatewayBaseUrl("OPENAI_API_BASE")).toBe(true);
    expect(isGatewayBaseUrl("OPENCODE_BASE_URL")).toBe(true);
    expect(isGatewayBaseUrl("CODEX_BASE_URL")).toBe(true);
    expect(isGatewayBaseUrl("OLLAMA_HOST")).toBe(true);
  });

  test("matches generic *_BASE_URL suffix", () => {
    expect(isGatewayBaseUrl("CUSTOM_AI_BASE_URL")).toBe(true);
    expect(isGatewayBaseUrl("PATH")).toBe(false);
    expect(isGatewayBaseUrl("HOME")).toBe(false);
  });

  test("matches extra configured env keys", () => {
    expect(isGatewayBaseUrl("MY_CUSTOM_ENDPOINT", ["MY_CUSTOM_ENDPOINT"])).toBe(true);
    expect(isGatewayBaseUrl("ANOTHER_VAR", ["MY_CUSTOM_ENDPOINT"])).toBe(false);
  });
});

describe("enrichUrlWithWorkspace", () => {
  test("appends source and workspace_id to standard HTTP URL", () => {
    const result = enrichUrlWithWorkspace("https://gateway.example.com/v1", {
      workspaceId: "ws_my_test",
      source: "paseo",
    });
    expect(result).toBe("https://gateway.example.com/v1?source=paseo&workspace_id=ws_my_test");
  });

  test("injects agent_id when includeAgentId is true", () => {
    const result = enrichUrlWithWorkspace("https://gateway.example.com/v1", {
      workspaceId: "ws_my_test",
      agentId: "agent_abc123",
      includeAgentId: true,
    });
    expect(result).toBe(
      "https://gateway.example.com/v1?source=paseo&workspace_id=ws_my_test&agent_id=agent_abc123",
    );
  });

  test("supports customized parameter names", () => {
    const result = enrichUrlWithWorkspace("https://gateway.example.com/v1", {
      workspaceId: "ws_my_test",
      agentId: "agent_abc123",
      includeAgentId: true,
      workspaceParamName: "workspaceId",
      sourceParamName: "client",
      agentParamName: "sessionId",
      source: "pasu",
    });
    expect(result).toBe(
      "https://gateway.example.com/v1?client=pasu&workspaceId=ws_my_test&sessionId=agent_abc123",
    );
  });

  test("filters by targetHosts whitelist", () => {
    const gatewayUrl = "https://gateway.my-corp.com/v1";
    const officialUrl = "https://api.anthropic.com/v1";

    const allowedResult = enrichUrlWithWorkspace(gatewayUrl, {
      workspaceId: "ws_123",
      targetHosts: ["gateway.my-corp.com"],
    });
    expect(allowedResult).toBe("https://gateway.my-corp.com/v1?source=paseo&workspace_id=ws_123");

    const skippedResult = enrichUrlWithWorkspace(officialUrl, {
      workspaceId: "ws_123",
      targetHosts: ["gateway.my-corp.com"],
    });
    expect(skippedResult).toBe("https://api.anthropic.com/v1");
  });

  test("preserves existing query parameters", () => {
    const result = enrichUrlWithWorkspace("https://gateway.example.com/v1?foo=bar&debug=1", {
      workspaceId: "ws_my_test",
      source: "paseo",
    });
    expect(result).toBe(
      "https://gateway.example.com/v1?foo=bar&debug=1&source=paseo&workspace_id=ws_my_test",
    );
  });

  test("handles custom source", () => {
    const result = enrichUrlWithWorkspace("https://gateway.example.com/v1", {
      workspaceId: "ws_my_test",
      source: "custom-pasu",
    });
    expect(result).toBe(
      "https://gateway.example.com/v1?source=custom-pasu&workspace_id=ws_my_test",
    );
  });

  test("interpolates placeholders if present", () => {
    const template =
      "https://gateway.example.com/pasu/${PASEO_WORKSPACE_ID}/v1?client=${PASEO_SOURCE}";
    const result = enrichUrlWithWorkspace(template, {
      workspaceId: "ws_12345",
      source: "paseo",
    });
    expect(result).toBe("https://gateway.example.com/pasu/ws_12345/v1?client=paseo");
  });

  test("safely returns invalid url without throwing", () => {
    const invalid = "some:invalid:url";
    expect(enrichUrlWithWorkspace(invalid, { workspaceId: "ws_test" })).toBe(invalid);
  });
});
