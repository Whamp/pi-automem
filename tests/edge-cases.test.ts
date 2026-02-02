/**
 * Edge case tests for pi-automem extension
 *
 * These tests verify behavior in unusual or boundary conditions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createMockExtensionAPI,
  createMockResponse,
  getTool,
  type MockExtensionAPI,
  type CapturedTool,
} from "./fixtures";

// Store original env and fetch
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

describe("edge cases", () => {
  let mockApi: MockExtensionAPI;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.AUTOMEM_URL = "http://test-automem:8001";
    process.env.AUTOMEM_TOKEN = "test-token";
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    mockApi = createMockExtensionAPI();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  /**
   * Load extension fresh with current env.
   * Note: The relative parent import is required to import the actual extension.
   */
  async function loadExtension(): Promise<void> {
    vi.resetModules();
    // eslint-disable-next-line eslint-plugin-import/no-relative-parent-imports
    const mod = await import("../extensions/automem.ts");
    mod.default(mockApi as unknown as Parameters<typeof mod.default>[0]);
  }

  async function loadAndGetTool(toolName: string): Promise<CapturedTool> {
    await loadExtension();
    return getTool(mockApi, toolName);
  }

  describe("content edge cases", () => {
    it("should handle very long content", async () => {
      const longContent = "x".repeat(100_000);
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-long",
          type: "Context",
        })
      );

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", { content: longContent });

      expect(result.isError).toBeFalsy();

      const [[, options]] = mockFetch.mock.calls;
      const body = JSON.parse(options.body);
      expect(body.content).toHaveLength(100_000);
    });

    it("should handle content with unicode characters", async () => {
      const unicodeContent = "日本語テスト 🎉 émojis αβγδ ∑∏∫ 中文测试";
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-unicode",
          type: "Context",
        })
      );

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", { content: unicodeContent });

      expect(result.isError).toBeFalsy();

      const [[, options]] = mockFetch.mock.calls;
      const body = JSON.parse(options.body);
      expect(body.content).toBe(unicodeContent);
    });

    it("should handle content with special characters", async () => {
      const specialContent =
        'Content with "quotes", <tags>, and &amp; entities';
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-special",
          type: "Context",
        })
      );

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", { content: specialContent });

      expect(result.isError).toBeFalsy();
    });

    it("should handle content with newlines", async () => {
      const multilineContent = "Line 1\nLine 2\nLine 3\n\nDouble newline";
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-multiline",
          type: "Context",
        })
      );

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", {
        content: multilineContent,
      });

      expect(result.isError).toBeFalsy();

      const [[, options]] = mockFetch.mock.calls;
      const body = JSON.parse(options.body);
      expect(body.content).toContain("\n");
    });
  });

  describe("importance edge cases", () => {
    it("should handle importance of exactly 0", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-zero",
          type: "Context",
        })
      );

      const tool = await loadAndGetTool("automem_store");

      await tool.execute("call-1", { content: "test", importance: 0 });

      const [[, options]] = mockFetch.mock.calls;
      const body = JSON.parse(options.body);
      expect(body.importance).toBe(0);
    });

    it("should handle importance of exactly 1", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-one",
          type: "Context",
        })
      );

      const tool = await loadAndGetTool("automem_store");

      await tool.execute("call-1", { content: "test", importance: 1 });

      const [[, options]] = mockFetch.mock.calls;
      const body = JSON.parse(options.body);
      expect(body.importance).toBe(1);
    });

    it("should handle fractional importance", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-frac",
          type: "Context",
        })
      );

      const tool = await loadAndGetTool("automem_store");

      await tool.execute("call-1", {
        content: "test",
        importance: 0.123_456_789,
      });

      const [[, options]] = mockFetch.mock.calls;
      const body = JSON.parse(options.body);
      expect(body.importance).toBeCloseTo(0.123_456_789, 6);
    });
  });

  describe("tags edge cases", () => {
    it("should handle empty tags array", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-empty-tags",
          type: "Context",
        })
      );

      const tool = await loadAndGetTool("automem_store");

      await tool.execute("call-1", { content: "test", tags: [] });

      const [[, options]] = mockFetch.mock.calls;
      const body = JSON.parse(options.body);
      expect(body.tags).toStrictEqual([]);
    });

    it("should handle many tags", async () => {
      const manyTags = Array.from({ length: 100 }, (_, i) => `tag-${i}`);
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-many-tags",
          type: "Context",
        })
      );

      const tool = await loadAndGetTool("automem_store");

      await tool.execute("call-1", { content: "test", tags: manyTags });

      const [[, options]] = mockFetch.mock.calls;
      const body = JSON.parse(options.body);
      expect(body.tags).toHaveLength(100);
    });

    it("should handle tags with special characters", async () => {
      const specialTags = [
        "tag-with-hyphen",
        "tag_with_underscore",
        "tag.with.dots",
      ];
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-special-tags",
          type: "Context",
        })
      );

      const tool = await loadAndGetTool("automem_store");

      await tool.execute("call-1", { content: "test", tags: specialTags });

      const [[, options]] = mockFetch.mock.calls;
      const body = JSON.parse(options.body);
      expect(body.tags).toStrictEqual(specialTags);
    });
  });

  describe("recall edge cases", () => {
    it("should handle empty query results gracefully", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          results: [],
          count: 0,
          query: "",
        })
      );

      const tool = await loadAndGetTool("automem_recall");

      const result = await tool.execute("call-1", { query: "" });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("No memories found");
    });

    it("should handle limit of 1", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          results: [
            {
              memory: {
                id: "mem-1",
                content: "Only one",
                type: "Context",
                importance: 0.5,
                tags: [],
                timestamp: new Date().toISOString(),
                confidence: 0.8,
              },
              score: 0.9,
              match_type: "semantic",
            },
          ],
          count: 1,
          query: "test",
        })
      );

      const tool = await loadAndGetTool("automem_recall");

      const result = await tool.execute("call-1", { query: "test", limit: 1 });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Found 1 memories");
    });

    it("should handle maximum limit of 50", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          results: [],
          count: 0,
          query: "test",
        })
      );

      const tool = await loadAndGetTool("automem_recall");

      await tool.execute("call-1", { query: "test", limit: 50 });

      const [[url]] = mockFetch.mock.calls;
      expect(url).toContain("limit=50");
    });

    it("should handle query with special URL characters", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          results: [],
          count: 0,
          query: "test & query = special",
        })
      );

      const tool = await loadAndGetTool("automem_recall");

      await tool.execute("call-1", { query: "test & query = special" });

      // Verify URL encoding
      const [[url]] = mockFetch.mock.calls;
      expect(url).not.toContain("&query");
      expect(url).toContain(encodeURIComponent("&"));
    });
  });

  describe("network edge cases", () => {
    it("should handle timeout errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", { content: "test" });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Error connecting to AutoMem");
    });

    it("should handle DNS resolution errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));

      const tool = await loadAndGetTool("automem_health");

      const result = await tool.execute("call-1", {});

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Cannot reach AutoMem");
    });

    it("should handle HTTP 429 rate limiting", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Rate limit exceeded", { ok: false, status: 429 })
      );

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", { content: "test" });

      expect(result.isError).toBeTruthy();
    });

    it("should handle HTTP 502 bad gateway", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse("Bad Gateway", { ok: false, status: 502 })
      );

      const tool = await loadAndGetTool("automem_health");

      const result = await tool.execute("call-1", {});

      expect(result.isError).toBeTruthy();
    });
  });

  describe("response parsing edge cases", () => {
    it("should handle malformed JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        async text() {
          return "not json";
        },
        async json() {
          throw new SyntaxError("Unexpected token");
        },
      });

      const tool = await loadAndGetTool("automem_health");

      const result = await tool.execute("call-1", {});

      expect(result.isError).toBeTruthy();
    });

    it("should handle missing fields in response", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          // Missing memory_id and type
        })
      );

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", { content: "test" });

      // Should still work, just with undefined values
      expect(result.content[0].text).toContain("Memory stored successfully");
    });

    it("should handle extra fields in response", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: "success",
          memory_id: "mem-extra",
          type: "Context",
          extra_field: "ignored",
          another_extra: { nested: true },
        })
      );

      const tool = await loadAndGetTool("automem_store");

      const result = await tool.execute("call-1", { content: "test" });

      expect(result.isError).toBeFalsy();
    });
  });
});
