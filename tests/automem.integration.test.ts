/**
 * Integration tests for pi-automem extension
 *
 * These tests run against a real (but isolated) AutoMem instance.
 * The test instance runs on port 18001 to avoid conflicts with production.
 *
 * Prerequisites:
 *   npm run docker:test:up
 *
 * The tests use unique IDs and clean up after themselves to ensure isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TEST_CONFIG, wait } from "./fixtures";

// Test instance configuration
const BASE_URL = TEST_CONFIG.url;
const API_TOKEN = TEST_CONFIG.token;

// Helper to make authenticated requests
function apiRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_TOKEN}`,
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  return fetch(url, { ...options, headers });
}

// Check if test instance is available
async function isTestInstanceAvailable(): Promise<boolean> {
  try {
    const response = await apiRequest("/health", { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

// Generate unique test ID to avoid conflicts
function testId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Track created memories for cleanup
const createdMemories: string[] = [];
const TEST_TAG = "pi-integration-test";

// Cleanup stale data from previous failed runs
async function cleanupStaleTestData(): Promise<void> {
  try {
    const response = await apiRequest(`/memory/by-tag?tags=${TEST_TAG}`);
    if (response.ok) {
      const data = await response.json();
      if (data.memories && Array.isArray(data.memories)) {
        for (const memory of data.memories) {
          await apiRequest(`/memory/${memory.id}`, { method: "DELETE" });
        }
      }
    }
  } catch (error) {
    console.error("Stale data cleanup failed:", error);
  }
}

describe("integration: automem extension", () => {
  beforeAll(async () => {
    const available = await isTestInstanceAvailable();
    if (!available) {
      console.warn(
        `\n⚠️  Test AutoMem instance not available at ${BASE_URL}\n` +
          "   Run: npm run docker:test:up\n"
      );
      throw new Error("Test instance not available - run docker:test:up");
    }

    // Clean up any stale data from previous runs
    await cleanupStaleTestData();
  });

  afterAll(async () => {
    // Clean up any memories created during tests
    for (const memoryId of createdMemories) {
      try {
        await apiRequest(`/memory/${memoryId}`, { method: "DELETE" });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("health endpoint", () => {
    it("should return healthy status", async () => {
      const response = await apiRequest("/health");
      expect(response.ok).toBeTruthy();

      const data = await response.json();
      expect(data.status).toBe("healthy");
      expect(data.falkordb).toBe("connected");
      expect(data.qdrant).toBe("connected");
      expect(typeof data.memory_count).toBe("number");
    });
  });

  describe("memory storage", () => {
    it("should store a basic memory", async () => {
      const content = `Integration test memory ${testId()}`;

      const response = await apiRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          content,
          importance: 0.7,
          tags: [TEST_TAG],
        }),
      });

      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.status).toBe("success");
      expect(data.memory_id).toBeDefined();
      expect(data.type).toBeDefined();

      createdMemories.push(data.memory_id);
    });

    it("should store memory with all parameters", async () => {
      const content = `Full params memory ${testId()}`;

      const response = await apiRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          content,
          type: "Decision",
          importance: 0.95,
          tags: ["integration-test", "full-params", TEST_TAG],
          metadata: { source: "vitest", environment: "test" },
        }),
      });

      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.memory_id).toBeDefined();
      expect(data.type).toBe("Decision");

      createdMemories.push(data.memory_id);
    });

    it("should store memories with different types", async () => {
      const types = [
        "Decision",
        "Pattern",
        "Preference",
        "Style",
        "Insight",
        "Context",
      ];

      for (const type of types) {
        const response = await apiRequest("/memory", {
          method: "POST",
          body: JSON.stringify({
            content: `${type} memory ${testId()}`,
            type,
            importance: 0.6,
            tags: ["type-test", TEST_TAG],
          }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.type).toBe(type);

        createdMemories.push(data.memory_id);
      }
    });

    it("should store memory with minimum importance", async () => {
      const response = await apiRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          content: `Low importance memory ${testId()}`,
          importance: 0,
          tags: [TEST_TAG],
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      createdMemories.push(data.memory_id);
    });

    it("should store memory with maximum importance", async () => {
      const response = await apiRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          content: `High importance memory ${testId()}`,
          importance: 1,
          tags: [TEST_TAG],
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      createdMemories.push(data.memory_id);
    });

    it("should reject memory without content", async () => {
      const response = await apiRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          importance: 0.5,
          tags: ["no-content"],
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("memory recall", () => {
    let searchableMemoryId: string;
    const uniqueSearchTerm = `uniqueterm${testId().replaceAll("-", "")}`;

    beforeAll(async () => {
      // Create a memory we can search for
      const response = await apiRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          content: `This memory contains the ${uniqueSearchTerm} for testing recall`,
          type: "Context",
          importance: 0.8,
          tags: ["recall-test", "searchable", TEST_TAG],
        }),
      });

      const data = await response.json();
      searchableMemoryId = data.memory_id;
      createdMemories.push(searchableMemoryId);

      // Wait for embedding to be processed
      await wait(1000);
    });

    it("should recall memories by semantic query", async () => {
      const response = await apiRequest(
        `/recall?query=${encodeURIComponent(uniqueSearchTerm)}&limit=10`
      );

      expect(response.ok).toBeTruthy();

      const data = await response.json();
      expect(data.status).toBe("success");
      expect(data.results).toBeDefined();
      expect(Array.isArray(data.results)).toBeTruthy();
    });

    it("should respect limit parameter", async () => {
      const response = await apiRequest("/recall?query=test&limit=3");

      expect(response.ok).toBeTruthy();

      const data = await response.json();
      expect(data.results.length).toBeLessThanOrEqual(3);
    });

    it("should filter by tags", async () => {
      const response = await apiRequest(
        "/recall?query=testing&tags=recall-test&limit=10"
      );

      expect(response.ok).toBeTruthy();

      const data = await response.json();
      expect(data.status).toBe("success");
      expect(data.results.length).toBeGreaterThan(0);

      // Results should only contain memories with the tag
      for (const result of data.results) {
        expect(result.memory).toBeDefined();
        expect(result.memory.tags).toBeDefined();
        expect(Array.isArray(result.memory.tags)).toBeTruthy();
        expect(
          result.memory.tags.some((t: string) => t.startsWith("recall"))
        ).toBeTruthy();
      }
    });

    it("should filter by multiple tags", async () => {
      const response = await apiRequest(
        "/recall?tags=recall-test&tags=searchable&limit=10"
      );

      expect(response.ok).toBeTruthy();

      const data = await response.json();
      expect(data.status).toBe("success");
    });

    it("should handle time_query parameter", async () => {
      const response = await apiRequest(
        "/recall?time_query=last%207%20days&limit=10"
      );

      expect(response.ok).toBeTruthy();

      const data = await response.json();
      expect(data.status).toBe("success");
      expect(data.time_window).toBeDefined();
    });

    it("should return empty results for non-matching query", async () => {
      const nonsenseQuery = `xyznonexistent${Math.random().toString(36)}`;
      const response = await apiRequest(
        `/recall?query=${encodeURIComponent(nonsenseQuery)}&limit=5`
      );

      expect(response.ok).toBeTruthy();

      const data = await response.json();
      expect(data.status).toBe("success");
      expect(data.results).toHaveLength(0);
    });

    it("should include score and match type in results", async () => {
      const response = await apiRequest(
        `/recall?query=${encodeURIComponent(uniqueSearchTerm)}&limit=5`
      );

      expect(response.ok).toBeTruthy();

      const data = await response.json();
      // Only check structure if we have results
      expect(data.results).toBeDefined();
      expect(Array.isArray(data.results)).toBeTruthy();

      // If there are results, verify their structure
      const results = data.results as {
        score: number;
        memory: { id: string; content: string };
      }[];
      for (const result of results) {
        expect(typeof result.score).toBe("number");
        expect(result.memory).toBeDefined();
        expect(result.memory.id).toBeDefined();
        expect(result.memory.content).toBeDefined();
      }
    });
  });

  describe("error handling", () => {
    it("should reject requests without authorization", async () => {
      const response = await fetch(`${BASE_URL}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Unauthorized test" }),
      });

      // Should fail with 401 or 403
      expect([401, 403]).toContain(response.status);
    });

    it("should reject requests with invalid token", async () => {
      const response = await fetch(`${BASE_URL}/memory`, {
        method: "POST",
        headers: {
          Authorization: "Bearer invalid-token-12345",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Invalid token test" }),
      });

      expect([401, 403]).toContain(response.status);
    });

    it("should handle malformed JSON gracefully", async () => {
      const response = await fetch(`${BASE_URL}/memory`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: "{ invalid json",
      });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent memory", async () => {
      const fakeId = `nonexistent-memory-${testId()}`;
      const response = await apiRequest(`/memory/${fakeId}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("memory lifecycle", () => {
    it("should complete full CRUD lifecycle", async () => {
      const uniqueContent = `Lifecycle test ${testId()}`;

      // CREATE
      const createResponse = await apiRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          content: uniqueContent,
          type: "Pattern",
          importance: 0.75,
          tags: ["lifecycle-test", TEST_TAG],
        }),
      });

      expect(createResponse.status).toBe(201);
      const { memory_id: memoryId } = await createResponse.json();

      // Wait for indexing
      await wait(500);

      // READ (via recall)
      const readResponse = await apiRequest(
        `/recall?query=${encodeURIComponent(uniqueContent)}&limit=5`
      );
      expect(readResponse.ok).toBeTruthy();

      // UPDATE
      const updateResponse = await apiRequest(`/memory/${memoryId}`, {
        method: "PATCH",
        body: JSON.stringify({
          content: `Updated: ${uniqueContent}`,
          importance: 0.9,
        }),
      });
      expect(updateResponse.ok).toBeTruthy();

      // DELETE
      const deleteResponse = await apiRequest(`/memory/${memoryId}`, {
        method: "DELETE",
      });
      expect(deleteResponse.ok).toBeTruthy();

      // VERIFY DELETED
      const verifyResponse = await apiRequest(`/memory/${memoryId}`, {
        method: "DELETE",
      });
      expect(verifyResponse.status).toBe(404);
    });
  });

  describe("tag-based retrieval", () => {
    const testTag = `testtag-${testId().replaceAll("-", "")}`;
    const memoryIds: string[] = [];

    beforeAll(async () => {
      // Create several memories with the same tag
      for (let i = 0; i < 3; i++) {
        const response = await apiRequest("/memory", {
          method: "POST",
          body: JSON.stringify({
            content: `Tag test memory ${i} - ${testId()}`,
            importance: 0.5 + i * 0.1,
            tags: [testTag, `index-${i}`, TEST_TAG],
          }),
        });

        const data = await response.json();
        memoryIds.push(data.memory_id);
        createdMemories.push(data.memory_id);
      }
    });

    it("should retrieve memories by tag", async () => {
      const response = await apiRequest(
        `/memory/by-tag?tags=${encodeURIComponent(testTag)}`
      );

      expect(response.ok).toBeTruthy();

      const data = await response.json();
      expect(data.status).toBe("success");
      expect(data.memories).toBeDefined();
      expect(data.memories.length).toBeGreaterThanOrEqual(3);

      // All results should have our tag
      for (const memory of data.memories) {
        expect(memory.tags).toContain(testTag);
      }
    });

    it("should return 400 when no tags provided", async () => {
      const response = await apiRequest("/memory/by-tag");
      expect(response.status).toBe(400);
    });
  });
});
