import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { getDelegatedJwtForSession } from "../../gateway/mcp-auth-store.js";
import { jsonResult, ToolInputError } from "./common.js";

const MANIFEST_ENV_KEY = "BITTENSOR_MCP_MANIFEST";
const URL_ENV_KEY = "BITTENSOR_MCP_URL";
const ENABLED_PLUGINS_ENV_KEY = "BITTENSOR_MCP_ENABLED_PLUGINS";
const BASILICA_AUTH_TOKEN_ENV_KEY = "BASILICA_AUTH_TOKEN";
const BASILICA_AUTH_TOKEN_HEADER = "x-basilica-api-token";
const MCP_PLUGIN_OPTIONS = {
  basilica: {
    pluginName: "Basilica GPU Cloud",
  },
  numinous: {
    pluginName: "Numinous Predictions",
  },
  synthdata: {
    pluginName: "SynthData Forecasting",
  },
} as const;

type RemoteMcpManifestTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type RemoteMcpManifest = {
  sourceUrl?: string;
  tools?: RemoteMcpManifestTool[];
};

type RemoteMcpClientState = {
  endpoint: string;
  jwt?: string;
  basilicaAuthToken?: string;
  clientPromise: Promise<Client>;
};

const clientStates = new Map<string, RemoteMcpClientState>();
let manifestCache: RemoteMcpManifest | null | undefined;

function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function resolveMcpEndpoint(): string | undefined {
  const raw = process.env[URL_ENV_KEY]?.trim();
  if (!raw) {
    return undefined;
  }
  if (raw.endsWith("/mcp")) {
    return raw;
  }
  return `${raw.replace(/\/+$/, "")}/mcp`;
}

function loadManifest(): RemoteMcpManifest {
  if (manifestCache) {
    return manifestCache;
  }
  const raw = process.env[MANIFEST_ENV_KEY]?.trim();
  if (!raw) {
    manifestCache = { tools: [] };
    return manifestCache;
  }
  try {
    const parsed = JSON.parse(raw) as RemoteMcpManifest;
    const tools = Array.isArray(parsed.tools)
      ? parsed.tools.filter((tool): tool is RemoteMcpManifestTool =>
          Boolean(tool && typeof tool.name === "string" && tool.name.trim()),
        )
      : [];
    manifestCache = {
      sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : undefined,
      tools,
    };
    return manifestCache;
  } catch {
    manifestCache = { tools: [] };
    return manifestCache;
  }
}

function loadEnabledPlugins(): string[] {
  const raw = process.env[ENABLED_PLUGINS_ENV_KEY]?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => entry in MCP_PLUGIN_OPTIONS);
      }
    } catch {
      // Fall back to manifest inference below.
    }
  }
  const inferred = new Set<string>();
  const manifestTools = loadManifest().tools ?? [];
  for (const tool of manifestTools) {
    const name = typeof tool?.name === "string" ? tool.name : "";
    if (name.startsWith("basilica_")) {
      inferred.add("basilica");
    }
    if (name.startsWith("numinous_")) {
      inferred.add("numinous");
    }
    if (name.startsWith("synthdata_")) {
      inferred.add("synthdata");
    }
  }
  return Array.from(inferred);
}

async function enableConfiguredPlugins(client: Client, pluginIds: string[]): Promise<void> {
  for (const pluginId of pluginIds) {
    const plugin = MCP_PLUGIN_OPTIONS[pluginId as keyof typeof MCP_PLUGIN_OPTIONS];
    if (!plugin) {
      continue;
    }
    await client.callTool({
      name: "bittensor_enable_plugin",
      arguments: {
        plugin_name: plugin.pluginName,
      },
    });
  }
}

async function getClient(endpoint: string, jwt: string | undefined): Promise<Client> {
  const basilicaAuthToken = process.env[BASILICA_AUTH_TOKEN_ENV_KEY]?.trim();
  const stateKey = `${endpoint}::${jwt ?? ""}::${basilicaAuthToken ?? ""}`;
  let state = clientStates.get(stateKey);
  if (!state) {
    const enabledPlugins = loadEnabledPlugins();
    state = {
      endpoint,
      jwt,
      basilicaAuthToken,
      clientPromise: (async () => {
        const client = new Client({
          name: "openclaw-remote-mcp",
          version: process.env.OPENCLAW_VERSION ?? process.env.npm_package_version ?? "dev",
        });
        const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
          requestInit:
            jwt || basilicaAuthToken
              ? {
                  headers: {
                    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
                    ...(basilicaAuthToken
                      ? { [BASILICA_AUTH_TOKEN_HEADER]: basilicaAuthToken }
                      : {}),
                  },
                }
              : undefined,
        });
        await client.connect(transport);
        await enableConfiguredPlugins(client, enabledPlugins);
        return client;
      })(),
    };
    clientStates.set(stateKey, state);
  }
  return await state.clientPromise;
}

async function callRemoteTool(params: {
  endpoint: string;
  sessionKey?: string;
  name: string;
  args: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const jwt = getDelegatedJwtForSession(params.sessionKey);
  const client = await getClient(params.endpoint, jwt);
  try {
    return /** @type {Record<string, unknown>} */ (
      await client.callTool({
        name: params.name,
        arguments: params.args,
      })
    );
  } catch (error) {
    const basilicaAuthToken = process.env[BASILICA_AUTH_TOKEN_ENV_KEY]?.trim();
    const stateKey = `${params.endpoint}::${jwt ?? ""}::${basilicaAuthToken ?? ""}`;
    clientStates.delete(stateKey);
    const message = error instanceof Error ? error.message : formatUnknown(error);
    const recoverable =
      message.includes("session") || message.includes("Unauthorized") || message.includes("closed");
    if (!recoverable) {
      throw error;
    }
    const retriedClient = await getClient(params.endpoint, jwt);
    return /** @type {Record<string, unknown>} */ (
      await retriedClient.callTool({
        name: params.name,
        arguments: params.args,
      })
    );
  }
}

function normalizeToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function createRemoteMcpTools(opts?: { agentSessionKey?: string }): AnyAgentTool[] {
  const endpoint = resolveMcpEndpoint();
  if (!endpoint) {
    return [];
  }
  const manifest = loadManifest();
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  return tools.map((tool) => {
    const toolName = normalizeToolName(tool.name);
    return {
      label: "Bittensor MCP",
      name: toolName,
      description: tool.description ?? `Remote MCP tool: ${tool.name}`,
      parameters:
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? tool.inputSchema
          : Type.Object({}, { additionalProperties: true }),
      execute: async (_toolCallId, args) => {
        const params =
          args && typeof args === "object" && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {};
        const result = await callRemoteTool({
          endpoint,
          sessionKey: opts?.agentSessionKey,
          name: tool.name,
          args: params,
        });
        if (!result || typeof result !== "object") {
          throw new ToolInputError("Remote MCP returned an invalid tool result");
        }
        return jsonResult(result);
      },
    } as AnyAgentTool;
  });
}
