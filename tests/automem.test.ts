/**
 * Unit tests for pi-automem extension
 *
 * These tests mock the fetch API to avoid needing a real AutoMem instance.
 * They verify the extension's behavior including:
 * - Tool registration
 * - Parameter handling
 * - Response formatting
 * - Error handling
 * - Session event handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createMockExtensionAPI,
  createMockResponse,
  createMockUIContext,
  getTool,
  getEventHandler,
  SAMPLE_RESPONSES,
  type MockExtensionAPI,
  type CapturedTool,
} from "./fixtures";

// Store original env and fetch
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

describe("automem extension", () => {
  let mockApi: MockExtensionAPI;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset environment
    process.env.AUTOMEM_URL = "http://test-automem:8001";
    process.env.AUTOMEM_TOKEN = "test-token";

    // Setup mock fetch
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    // Create fresh mock API
    mockApi = createMockExtensionAPI();
  });

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  /**
   * Helper to load the extension fresh with current env.
   *
   * This uses vi.resetModules() and dynamic import to ensure the extension
   * re-reads process.env at the top level for each test case. This is
   * necessary because the extension captures configuration values like
   * AUTOMEM_TOKEN during module initialization.
   *
   * Note: The relative parent import is required here because we need to
   * import the actual extension module, and vitest resolves this correctly.
   */
  async function loadExtension(): Promise<void> {
    vi.resetModules();
    // eslint-disable-next-line eslint-plugin-import/no-relative-parent-imports
    const mod = await import("../extensions/automem.ts");
    mod.default(mockApi as unknown as Parameters<typeof mod.default>[0]);
  }

  /**
   * Helper to load extension and get a specific tool
   */
  async function loadAndGetTool(toolName: string): Promise<CapturedTool> {
    await loadExtension();
    return getTool(mockApi, toolName);
  }

  describe("initialization", () => {
    it("should register all three tools when token is present", async () => {
      await loadExtension();

      expect(mockApi.tools.has("automem_store")).toBeTruthy();
      expect(mockApi.tools.has("automem_recall")).toBeTruthy();
      expect(mockApi.tools.has("automem_health")).toBeTruthy();
    });

    it("should register session_start handler when token is present", async () => {
      await loadExtension();

      const sessionHandlers = mockApi.eventHandlers.filter(
        (h) => h.event === "session_start"
      );
      expect(sessionHandlers).toHaveLength(1);
    });

    it("should not register tools when AUTOMEM_TOKEN is missing", async () => {
      delete process.env.AUTOMEM_TOKEN;
      await loadExtension();

      expect(mockApi.tools.size).toBe(0);
    });

    it("should register warning handler when token is missing", async () => {
      delete process.env.AUTOMEM_TOKEN;
      await loadExtension();

      const sessionHandlers = mockApi.eventHandlers.filter(
        (h) => h.event === "session_start"
      );
      expect(sessionHandlers).toHaveLength(1);

      // Trigger the handler and verify warning
      const ctx = { ui: createMockUIContext() };
      const [handler] = sessionHandlers;
      await handler.handler({}, ctx);

      expect(ctx.ui.notifications).toHaveLength(1);
      expect(ctx.ui.notifications[0].type).toBe("warning");
      expect(ctx.ui.notifications[0].message).toContain("AUTOMEM_TOKEN");
    });
  });

  describe("automem_store", () => {
    it("should store memory with all parameters", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.store, { status: 201 })
      );

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", {
        content: "Test memory content",
        type: "Decision",
        importance: 0.9,
        tags: ["test", "unit"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Memory stored successfully");
      expect(result.content[0].text).toContain(
        SAMPLE_RESPONSES.store.memory_id
      );

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledOnce();
      const [[url, options]] = mockFetch.mock.calls;
      expect(url).toBe("http://test-automem:8001/memory");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body);
      expect(body.content).toBe("Test memory content");
      expect(body.type).toBe("Decision");
      expect(body.importance).toBe(0.9);
      expect(body.tags).toStrictEqual(["test", "unit"]);
    });

    it("should use default importance when not specified", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.store, { status: 201 })
      );

      const tool = await loadAndGetTool("automem_store");

      await tool.execute("call-1", { content: "Minimal memory" });

      const [[, options]] = mockFetch.mock.calls;
      const body = JSON.parse(options.body);
      expect(body.importance).toBe(0.7);
    });

    it("should handle API errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Internal Server Error", { ok: false, status: 500 })
      );

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", { content: "Test memory" });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Failed to store memory");
    });

    it("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", { content: "Test memory" });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Error connecting to AutoMem");
    });
  });

  describe("automem_recall", () => {
    it("should search with query parameter", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.recall)
      );

      const tool = await loadAndGetTool("automem_recall");

      const result = await tool.execute("call-1", {
        query: "TypeScript architecture",
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Found 2 memories");
      expect(result.details?.count).toBe(2);

      // Verify URL construction
      const [[url]] = mockFetch.mock.calls;
      expect(url).toContain("/recall?");
      expect(url).toContain("query=TypeScript+architecture");
      expect(url).toContain("limit=5");
    });

    it("should include tags in search", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.recall)
      );

      const tool = await loadAndGetTool("automem_recall");

      await tool.execute("call-1", {
        query: "preferences",
        tags: ["coding-style", "typescript"],
      });

      const [[url]] = mockFetch.mock.calls;
      expect(url).toContain("tags=coding-style");
      expect(url).toContain("tags=typescript");
    });

    it("should include time_query in search", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.recall)
      );

      const tool = await loadAndGetTool("automem_recall");

      await tool.execute("call-1", {
        query: "recent decisions",
        time_query: "last week",
      });

      const [[url]] = mockFetch.mock.calls;
      expect(url).toContain("time_query=last+week");
    });

    it("should respect limit parameter", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.recall)
      );

      const tool = await loadAndGetTool("automem_recall");

      await tool.execute("call-1", { query: "test", limit: 20 });

      const [[url]] = mockFetch.mock.calls;
      expect(url).toContain("limit=20");
    });

    it("should handle empty results", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.recallEmpty)
      );

      const tool = await loadAndGetTool("automem_recall");

      const result = await tool.execute("call-1", {
        query: "nonexistent topic xyz",
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("No memories found");
      expect(result.details?.count).toBe(0);
    });

    it("should format results with tags and scores", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.recall)
      );

      const tool = await loadAndGetTool("automem_recall");

      const result = await tool.execute("call-1", { query: "TypeScript" });

      const [firstContent] = result.content;
      const { text } = firstContent;
      expect(text).toContain("[Decision]");
      expect(text).toContain("Score:");
      expect(text).toContain("Importance:");
      expect(text).toContain("Tags:");
    });

    it("should handle API errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Bad Request", { ok: false, status: 400 })
      );

      const tool = await loadAndGetTool("automem_recall");

      const result = await tool.execute("call-1", { query: "test" });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Failed to recall memories");
    });
  });

  describe("automem_health", () => {
    it("should return health status when service is healthy", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.health)
      );

      const tool = await loadAndGetTool("automem_health");

      const result = await tool.execute("call-1", {});

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("AutoMem Status: healthy");
      expect(result.content[0].text).toContain("Memories: 42");
      expect(result.content[0].text).toContain("FalkorDB: connected");
      expect(result.content[0].text).toContain("Qdrant: connected");

      expect(result.details).toStrictEqual(SAMPLE_RESPONSES.health);
    });

    it("should handle degraded status", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.healthDegraded)
      );

      const tool = await loadAndGetTool("automem_health");

      const result = await tool.execute("call-1", {});

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Status: degraded");
    });

    it("should handle unhealthy response", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Service Unavailable", { ok: false, status: 503 })
      );

      const tool = await loadAndGetTool("automem_health");

      const result = await tool.execute("call-1", {});

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("not healthy");
    });

    it("should handle connection errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const tool = await loadAndGetTool("automem_health");

      const result = await tool.execute("call-1", {});

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Cannot reach AutoMem");
    });
  });

  describe("session_start notification", () => {
    it("should notify on successful connection", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.health)
      );

      await loadExtension();

      const sessionHandler = getEventHandler(mockApi, "session_start");
      expect(sessionHandler).toBeDefined();

      const ctx = { ui: createMockUIContext() };
      await sessionHandler.handler({}, ctx);

      expect(ctx.ui.notifications).toHaveLength(1);
      expect(ctx.ui.notifications[0].type).toBe("info");
      expect(ctx.ui.notifications[0].message).toContain("AutoMem connected");
      expect(ctx.ui.notifications[0].message).toContain("42 memories");
    });

    it("should silently fail on connection error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      await loadExtension();

      const sessionHandler = getEventHandler(mockApi, "session_start");

      const ctx = { ui: createMockUIContext() };
      await sessionHandler.handler({}, ctx);

      // Should not throw and should not notify on failure
      expect(ctx.ui.notifications).toHaveLength(0);
    });
  });

  describe("authorization", () => {
    it("should include Bearer token in requests", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.health)
      );

      const tool = await loadAndGetTool("automem_health");

      await tool.execute("call-1", {});

      const [[, options]] = mockFetch.mock.calls;
      expect(options.headers.Authorization).toBe("Bearer test-token");
    });

    it("should include Content-Type header", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.store)
      );

      const tool = await loadAndGetTool("automem_store");

      await tool.execute("call-1", { content: "test" });

      const [[, options]] = mockFetch.mock.calls;
      expect(options.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("url configuration", () => {
    it("should use AUTOMEM_URL from environment", async () => {
      process.env.AUTOMEM_URL = "http://custom-host:9000";

      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.health)
      );

      const tool = await loadAndGetTool("automem_health");

      await tool.execute("call-1", {});

      const [[url]] = mockFetch.mock.calls;
      expect(url).toContain("http://custom-host:9000/health");
    });

    it("should default to localhost:8001", async () => {
      delete process.env.AUTOMEM_URL;

      mockFetch.mockResolvedValueOnce(
        createMockResponse(SAMPLE_RESPONSES.health)
      );

      const tool = await loadAndGetTool("automem_health");

      await tool.execute("call-1", {});

      const [[url]] = mockFetch.mock.calls;
      expect(url).toContain("http://localhost:8001/health");
    });
  });
});
