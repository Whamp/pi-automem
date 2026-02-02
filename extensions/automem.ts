/**
 * AutoMem Extension - Long-term memory for pi coding agent
 *
 * Provides tools to store and recall memories from AutoMem service.
 *
 * Configuration via environment variables:
 *   AUTOMEM_URL   - AutoMem API URL (default: http://localhost:8001)
 *   AUTOMEM_TOKEN - API authentication token (required)
 *
 * Tools provided:
 *   automem_store  - Store a memory with content, type, importance, tags
 *   automem_recall - Search memories by query with optional filters
 *   automem_health - Check AutoMem service connectivity
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Configuration from environment
const AUTOMEM_URL = process.env.AUTOMEM_URL || "http://localhost:8001";
const AUTOMEM_TOKEN = process.env.AUTOMEM_TOKEN;

interface Memory {
  id: string;
  content: string;
  type: string;
  importance: number;
  tags: string[];
  timestamp: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

interface RecallResult {
  memory: Memory;
  score: number;
  match_type: string;
}

interface RecallResponse {
  status: string;
  results: RecallResult[];
  count: number;
  query: string;
}

interface StoreResponse {
  status: string;
  memory_id: string;
  type: string;
}

interface HealthResponse {
  status: string;
  memory_count: number;
  falkordb: string;
  qdrant: string;
}

async function automemRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  if (!AUTOMEM_TOKEN) {
    throw new Error("AUTOMEM_TOKEN environment variable is required");
  }

  const url = `${AUTOMEM_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${AUTOMEM_TOKEN}`,
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  return fetch(url, { ...options, headers });
}

export default function (pi: ExtensionAPI) {
  // Check configuration on load
  if (!AUTOMEM_TOKEN) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify(
        "AutoMem: AUTOMEM_TOKEN not set. Set it to enable memory tools.",
        "warning"
      );
    });
    return; // Don't register tools without token
  }

  // Store a memory
  pi.registerTool({
    name: "automem_store",
    label: "Store Memory",
    description:
      "Store a memory in AutoMem for long-term recall. Use for important decisions, insights, preferences, patterns, or context that should persist across sessions.",
    parameters: Type.Object({
      content: Type.String({
        description: "The memory content to store",
      }),
      type: Type.Optional(
        Type.String({
          description:
            "Memory type: Decision, Pattern, Preference, Style, Habit, Insight, or Context (default)",
        })
      ),
      importance: Type.Optional(
        Type.Number({
          description: "Importance score 0-1 (default 0.7)",
          minimum: 0,
          maximum: 1,
        })
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Tags for categorization and filtering",
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { content, type, importance, tags } = params as {
        content: string;
        type?: string;
        importance?: number;
        tags?: string[];
      };

      try {
        const response = await automemRequest("/memory", {
          method: "POST",
          body: JSON.stringify({
            content,
            type: type || undefined,
            importance: importance ?? 0.7,
            tags: tags || [],
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          return {
            content: [{ type: "text", text: `Failed to store memory: ${error}` }],
            details: { error: true },
            isError: true,
          };
        }

        const data = (await response.json()) as StoreResponse;
        return {
          content: [
            {
              type: "text",
              text: `Memory stored successfully.\nID: ${data.memory_id}\nType: ${data.type}`,
            },
          ],
          details: { memory_id: data.memory_id, type: data.type },
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error connecting to AutoMem: ${error}` },
          ],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // Recall memories
  pi.registerTool({
    name: "automem_recall",
    label: "Recall Memories",
    description:
      "Search and recall memories from AutoMem. Use to retrieve past decisions, preferences, patterns, or context relevant to the current task.",
    parameters: Type.Object({
      query: Type.String({
        description: "Search query for semantic similarity matching",
      }),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of results (default 5)",
          minimum: 1,
          maximum: 50,
        })
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Filter by tags (prefix matching)",
        })
      ),
      time_query: Type.Optional(
        Type.String({
          description:
            'Natural language time filter, e.g. "last week", "last month"',
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { query, limit, tags, time_query } = params as {
        query: string;
        limit?: number;
        tags?: string[];
        time_query?: string;
      };

      try {
        const searchParams = new URLSearchParams({
          query,
          limit: String(limit || 5),
        });

        if (tags && tags.length > 0) {
          tags.forEach((tag) => searchParams.append("tags", tag));
        }

        if (time_query) {
          searchParams.set("time_query", time_query);
        }

        const response = await automemRequest(`/recall?${searchParams}`);

        if (!response.ok) {
          const error = await response.text();
          return {
            content: [{ type: "text", text: `Failed to recall memories: ${error}` }],
            details: { error: true },
            isError: true,
          };
        }

        const data = (await response.json()) as RecallResponse;

        if (data.results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No memories found for query: "${query}"`,
              },
            ],
            details: { count: 0 },
          };
        }

        const formatted = data.results
          .map((r, i) => {
            const m = r.memory;
            const tagStr = m.tags?.length ? `\n   Tags: ${m.tags.join(", ")}` : "";
            return `${i + 1}. [${m.type}] ${m.content}${tagStr}\n   Score: ${r.score.toFixed(3)} | Importance: ${m.importance}`;
          })
          .join("\n\n");

        return {
          content: [
            {
              type: "text",
              text: `Found ${data.count} memories for "${query}":\n\n${formatted}`,
            },
          ],
          details: {
            count: data.count,
            results: data.results.map((r) => ({
              id: r.memory.id,
              type: r.memory.type,
              score: r.score,
            })),
          },
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error connecting to AutoMem: ${error}` },
          ],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // Health check
  pi.registerTool({
    name: "automem_health",
    label: "AutoMem Health",
    description: "Check AutoMem service health and connectivity",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      try {
        const response = await automemRequest("/health", { method: "GET" });

        if (!response.ok) {
          return {
            content: [{ type: "text", text: "AutoMem service is not healthy" }],
            details: { healthy: false },
            isError: true,
          };
        }

        const data = (await response.json()) as HealthResponse;
        return {
          content: [
            {
              type: "text",
              text: `AutoMem Status: ${data.status}\nMemories: ${data.memory_count}\nFalkorDB: ${data.falkordb}\nQdrant: ${data.qdrant}`,
            },
          ],
          details: data,
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Cannot reach AutoMem: ${error}` },
          ],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  // Notify on successful connection at session start
  pi.on("session_start", async (_event, ctx) => {
    try {
      const response = await automemRequest("/health", { method: "GET" });
      if (response.ok) {
        const data = (await response.json()) as HealthResponse;
        ctx.ui.notify(
          `AutoMem connected (${data.memory_count} memories)`,
          "info"
        );
      }
    } catch {
      // Silent fail - user can check with automem_health tool
    }
  });
}
