import { afterEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn();
const listToolsMock = vi.fn();
const callToolMock = vi.fn();
const closeMock = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(...args: unknown[]) {
      return await connectMock(...args);
    }
    async listTools(...args: unknown[]) {
      return await listToolsMock(...args);
    }
    async callTool(...args: unknown[]) {
      return await callToolMock(...args);
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockTransport {
    close = closeMock;
  },
}));

vi.mock("../../gateway/mcp-auth-store.js", () => ({
  getDelegatedJwtForSession: vi.fn(() => "jwt-test"),
}));

async function importModule() {
  return await import(`./remote-mcp.ts?test=${Date.now()}-${Math.random()}`);
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.BITTENSOR_MCP_URL;
  delete process.env.BITTENSOR_MCP_MANIFEST;
  delete process.env.BITTENSOR_MCP_ENABLED_PLUGINS;
});

describe("remote MCP tools", () => {
  it("returns no tools when MCP URL is unset", async () => {
    const mod = await importModule();
    expect(mod.createRemoteMcpTools({ agentSessionKey: "main" })).toEqual([]);
  });

  it("builds tools from the manifest and executes tool calls", async () => {
    process.env.BITTENSOR_MCP_URL = "http://127.0.0.1:3102/mcp";
    process.env.BITTENSOR_MCP_MANIFEST = JSON.stringify({
      sourceUrl: "http://127.0.0.1:3102/mcp",
      tools: [
        {
          name: "chi_index",
          description: "Read the chi index",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });
    listToolsMock.mockResolvedValue({ tools: [] });
    callToolMock.mockResolvedValue({
      content: [{ type: "text", text: "INDEX.yaml" }],
      isError: false,
    });

    const mod = await importModule();
    const tools = mod.createRemoteMcpTools({ agentSessionKey: "main" });
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("chi_index");

    const result = await tools[0].execute("tool-1", {});
    expect(connectMock).toHaveBeenCalled();
    expect(callToolMock).toHaveBeenCalledWith({
      name: "chi_index",
      arguments: {},
    });
    expect(result).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("INDEX.yaml") }],
    });
  });

  it("retries recoverable tool-call failures once", async () => {
    process.env.BITTENSOR_MCP_URL = "http://127.0.0.1:3102/mcp";
    process.env.BITTENSOR_MCP_MANIFEST = JSON.stringify({
      sourceUrl: "http://127.0.0.1:3102/mcp",
      tools: [{ name: "chi_index", inputSchema: { type: "object", properties: {} } }],
    });
    listToolsMock.mockResolvedValue({ tools: [] });
    callToolMock.mockRejectedValueOnce(new Error("Unauthorized")).mockResolvedValueOnce({
      content: [{ type: "text", text: "INDEX.yaml" }],
    });

    const mod = await importModule();
    const tools = mod.createRemoteMcpTools({ agentSessionKey: "main" });
    const result = await tools[0].execute("tool-1", {});
    expect(callToolMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("INDEX.yaml") }],
    });
  });

  it("enables configured plugins before calling remote tools", async () => {
    process.env.BITTENSOR_MCP_URL = "http://127.0.0.1:3102/mcp";
    process.env.BITTENSOR_MCP_ENABLED_PLUGINS = JSON.stringify(["numinous"]);
    process.env.BITTENSOR_MCP_MANIFEST = JSON.stringify({
      sourceUrl: "http://127.0.0.1:3102/mcp",
      tools: [{ name: "numinous_predict_query", inputSchema: { type: "object", properties: {} } }],
    });
    listToolsMock.mockResolvedValue({ tools: [] });
    callToolMock
      .mockResolvedValueOnce({
        content: [{ type: "text", text: 'Enabled "Numinous Predictions"' }],
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "42.0%" }],
      });

    const mod = await importModule();
    const tools = mod.createRemoteMcpTools({ agentSessionKey: "main" });
    const result = await tools[0].execute("tool-1", {});
    expect(callToolMock).toHaveBeenNthCalledWith(1, {
      name: "bittensor_enable_plugin",
      arguments: { plugin_name: "Numinous Predictions" },
    });
    expect(callToolMock).toHaveBeenNthCalledWith(2, {
      name: "numinous_predict_query",
      arguments: {},
    });
    expect(result).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("42.0%") }],
    });
  });
});
