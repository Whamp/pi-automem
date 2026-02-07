/**
 * AutoMem Extension - Long-term memory for pi coding agent
 *
 * Provides tools to store and recall memories from AutoMem service,
 * plus automatic session processing to extract learnings on shutdown.
 *
 * Configuration via environment variables:
 *   AUTOMEM_URL   - AutoMem API URL (default: http://localhost:8001)
 *   AUTOMEM_TOKEN - API authentication token (required)
 *   AUTOMEM_AUTO_EXTRACT - Enable auto-extraction on session end (default: true)
 *   AUTOMEM_MIN_TURNS - Minimum conversation turns before extraction (default: 3)
 *   GEMINI_API_KEY - Required for realtime extraction (get from ai.google.dev)
 *
 * Tools provided:
 *   automem_store  - Store a memory with content, type, importance, tags
 *   automem_recall - Search memories by query with optional filters
 *   automem_health - Check AutoMem service connectivity
 *
 * Automatic features:
 *   - On session_shutdown: Extract decisions, insights, patterns from conversation
 *   - Uses Gemini 2.0 Flash for fast extraction
 *   - Stores extracted memories with source: "session-extraction"
 *
 * Note: For realtime extraction (on session end), set GEMINI_API_KEY.
 * The nightly compound-review.js script uses pi itself and doesn't need this.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { Type } from "@sinclair/typebox";

// Configuration from environment
const AUTOMEM_URL = process.env.AUTOMEM_URL || "http://localhost:8001";
const { AUTOMEM_TOKEN } = process.env;
const AUTOMEM_AUTO_EXTRACT = process.env.AUTOMEM_AUTO_EXTRACT !== "false";
const AUTOMEM_MIN_TURNS = parseInt(process.env.AUTOMEM_MIN_TURNS || "3", 10);

// Gemini API for extraction
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash"; // Fast and cheap for extraction

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

interface ExtractedMemory {
  content: string;
  type: "Decision" | "Insight" | "Pattern" | "Preference" | "Context";
  importance: number;
  tags: string[];
}

function automemRequest(
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

/**
 * Extract conversation content from session entries for summarization.
 * Filters to user messages and assistant text responses.
 */
function extractConversationText(
  entries: Array<{ type: string; data?: unknown }>
): { text: string; turnCount: number } {
  const lines: string[] = [];
  let turnCount = 0;

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.data) continue;

    const msg = entry.data as {
      role?: string;
      content?: string | Array<{ type: string; text?: string }>;
    };

    if (!msg.role || !msg.content) continue;

    // Extract text content
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
    }

    if (!text.trim()) continue;

    if (msg.role === "user") {
      lines.push(`USER: ${text}`);
      turnCount++;
    } else if (msg.role === "assistant") {
      // Truncate long assistant responses
      const truncated = text.length > 2000 ? text.slice(0, 2000) + "..." : text;
      lines.push(`ASSISTANT: ${truncated}`);
    }
  }

  return { text: lines.join("\n\n"), turnCount };
}

/**
 * Call Gemini 3 Flash to extract memories from conversation.
 */
async function callGeminiForExtraction(
  conversationText: string
): Promise<ExtractedMemory[]> {
  if (!GEMINI_API_KEY) {
    console.error("AutoMem: No GEMINI_API_KEY set for extraction");
    return [];
  }

  const extractionPrompt = `Analyze this coding session conversation and extract important learnings that should persist across sessions.

Extract ONLY items that are:
- Decisions made (architecture, tools, approaches chosen)
- Insights discovered (gotchas, bugs found, performance findings)
- Patterns identified (user preferences, coding style, workflow habits)
- Important context (project structure, constraints, requirements)

Skip routine tool usage, file reads, and implementation details unless they reveal something reusable.

For each memory, provide:
- content: A clear, self-contained statement (1-2 sentences)
- type: One of Decision, Insight, Pattern, Preference, Context
- importance: 0.5-1.0 (1.0 = critical to remember, 0.5 = nice to have)
- tags: Relevant tags for filtering (e.g., "typescript", "testing", "architecture")

<conversation>
${conversationText.slice(0, 30000)}
</conversation>

Respond ONLY with a valid JSON array of memories. If nothing worth remembering, respond with [].
Example: [{"content": "User prefers dark mode", "type": "Preference", "importance": 0.6, "tags": ["ui", "preferences"]}]`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: extractionPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("AutoMem: Gemini API error:", error);
      return [];
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON from response (handle markdown code blocks)
    let jsonText = text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const memories = JSON.parse(jsonText) as ExtractedMemory[];
    return Array.isArray(memories) ? memories : [];
  } catch (error) {
    console.error("AutoMem: Extraction failed:", error);
    return [];
  }
}

/**
 * Store multiple memories to AutoMem with session metadata.
 */
async function storeExtractedMemories(
  memories: ExtractedMemory[],
  sessionId: string | undefined,
  sessionFile: string | undefined,
  cwd: string
): Promise<{ stored: number; failed: number }> {
  let stored = 0;
  let failed = 0;

  for (const memory of memories) {
    try {
      const response = await automemRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          content: memory.content,
          type: memory.type,
          importance: memory.importance,
          tags: [...memory.tags, "auto-extracted"],
          metadata: {
            source: "session-extraction",
            session_id: sessionId,
            session_file: sessionFile,
            cwd,
            extracted_at: new Date().toISOString(),
          },
        }),
      });

      if (response.ok) {
        stored++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { stored, failed };
}

export default function automemExtension(pi: ExtensionAPI) {
  // Check configuration on load
  if (!AUTOMEM_TOKEN) {
    pi.on("session_start", (_event, ctx) => {
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
            content: [
              { type: "text", text: `Failed to store memory: ${error}` },
            ],
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
          for (const tag of tags) {
            searchParams.append("tags", tag);
          }
        }

        if (time_query) {
          searchParams.set("time_query", time_query);
        }

        const response = await automemRequest(`/recall?${searchParams}`);

        if (!response.ok) {
          const error = await response.text();
          return {
            content: [
              { type: "text", text: `Failed to recall memories: ${error}` },
            ],
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
            const tagStr = m.tags?.length
              ? `\n   Tags: ${m.tags.join(", ")}`
              : "";
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
          content: [{ type: "text", text: `Cannot reach AutoMem: ${error}` }],
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

  // Auto-extract memories on session shutdown
  if (AUTOMEM_AUTO_EXTRACT) {
    pi.on("session_shutdown", async (_event, ctx) => {
      try {
        const entries = ctx.sessionManager.getEntries();
        const { text: conversationText, turnCount } =
          extractConversationText(entries);

        // Skip short sessions
        if (turnCount < AUTOMEM_MIN_TURNS) {
          return;
        }

        // Skip if no Gemini API key
        if (!GEMINI_API_KEY) {
          return;
        }

        ctx.ui.notify("AutoMem: Extracting session learnings...", "info");

        const memories = await callGeminiForExtraction(conversationText);

        if (memories.length === 0) {
          return;
        }

        const sessionId = ctx.sessionManager.getSessionId();
        const sessionFile = ctx.sessionManager.getSessionFile();
        const cwd = ctx.sessionManager.getCwd();

        const { stored, failed } = await storeExtractedMemories(
          memories,
          sessionId,
          sessionFile,
          cwd
        );

        if (stored > 0) {
          ctx.ui.notify(
            `AutoMem: Stored ${stored} memories from session`,
            "success"
          );
        }
        if (failed > 0) {
          ctx.ui.notify(
            `AutoMem: Failed to store ${failed} memories`,
            "warning"
          );
        }
      } catch (error) {
        console.error("AutoMem session extraction failed:", error);
        // Don't block shutdown on extraction failure
      }
    });
  }
}
