/**
 * Test fixtures and mocks for pi-automem extension tests
 */

/**
 * Mock fetch responses for AutoMem API
 */
export interface MockFetchResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

/**
 * Create a mock Response object
 */
export function createMockResponse(
  data: unknown,
  options: { ok?: boolean; status?: number } = {}
): MockFetchResponse {
  const { ok = true, status = 200 } = options;
  const textValue = typeof data === "string" ? data : JSON.stringify(data);
  return {
    ok,
    status,
    async text() {
      return textValue;
    },
    async json() {
      return data;
    },
  };
}

/**
 * Mock UI context for session events
 */
export interface MockUIContext {
  notifications: { message: string; type: string }[];
  notify: (message: string, type: string) => void;
}

export function createMockUIContext(): MockUIContext {
  const notifications: { message: string; type: string }[] = [];
  return {
    notifications,
    notify: (message: string, type: string) => {
      notifications.push({ message, type });
    },
  };
}

/**
 * Captured tool registrations from the extension
 */
export interface CapturedTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown
  ) => Promise<{
    content: { type: string; text: string }[];
    details?: Record<string, unknown>;
    isError?: boolean;
  }>;
}

/**
 * Captured event handlers from the extension
 */
export interface CapturedEventHandler {
  event: string;
  handler: (event: unknown, ctx: { ui: MockUIContext }) => void | Promise<void>;
}

/**
 * Mock ExtensionAPI for capturing tool registrations and event handlers
 */
export interface MockExtensionAPI {
  tools: Map<string, CapturedTool>;
  eventHandlers: CapturedEventHandler[];
  registerTool: (tool: CapturedTool) => void;
  on: (event: string, handler: CapturedEventHandler["handler"]) => void;
}

export function createMockExtensionAPI(): MockExtensionAPI {
  const tools = new Map<string, CapturedTool>();
  const eventHandlers: CapturedEventHandler[] = [];

  return {
    tools,
    eventHandlers,
    registerTool: (tool: CapturedTool) => {
      tools.set(tool.name, tool);
    },
    on: (event: string, handler: CapturedEventHandler["handler"]) => {
      eventHandlers.push({ event, handler });
    },
  };
}

/**
 * Get a tool from the mock API, throwing if not found.
 * This avoids non-null assertions in tests.
 */
export function getTool(api: MockExtensionAPI, name: string): CapturedTool {
  const tool = api.tools.get(name);
  if (!tool) {
    throw new Error(`Tool "${name}" not found in mock API`);
  }
  return tool;
}

/**
 * Get the first event handler matching the event name, throwing if not found.
 */
export function getEventHandler(
  api: MockExtensionAPI,
  event: string
): CapturedEventHandler {
  const handler = api.eventHandlers.find((h) => h.event === event);
  if (!handler) {
    throw new Error(`Event handler for "${event}" not found`);
  }
  return handler;
}

/**
 * Sample memory data for tests
 */
export const SAMPLE_MEMORIES = {
  decision: {
    id: "mem-001",
    content: "Decided to use TypeScript for all new projects",
    type: "Decision",
    importance: 0.9,
    tags: ["typescript", "architecture"],
    timestamp: "2026-01-15T10:00:00Z",
    confidence: 0.85,
  },
  pattern: {
    id: "mem-002",
    content: "User prefers functional programming patterns over OOP",
    type: "Pattern",
    importance: 0.7,
    tags: ["coding-style", "functional"],
    timestamp: "2026-01-20T14:30:00Z",
    confidence: 0.8,
  },
  preference: {
    id: "mem-003",
    content: "Prefer dark mode themes in all IDEs",
    type: "Preference",
    importance: 0.5,
    tags: ["ui", "preferences"],
    timestamp: "2026-01-25T09:15:00Z",
    confidence: 0.95,
  },
};

/**
 * Sample API responses
 */
export const SAMPLE_RESPONSES = {
  store: {
    status: "success",
    memory_id: "mem-new-001",
    type: "Context",
  },
  recall: {
    status: "success",
    results: [
      {
        memory: SAMPLE_MEMORIES.decision,
        score: 0.92,
        match_type: "semantic",
      },
      {
        memory: SAMPLE_MEMORIES.pattern,
        score: 0.78,
        match_type: "semantic",
      },
    ],
    count: 2,
    query: "TypeScript architecture decisions",
  },
  recallEmpty: {
    status: "success",
    results: [],
    count: 0,
    query: "nonexistent topic xyz",
  },
  health: {
    status: "healthy",
    memory_count: 42,
    falkordb: "connected",
    qdrant: "connected",
  },
  healthDegraded: {
    status: "degraded",
    memory_count: 0,
    falkordb: "disconnected",
    qdrant: "connected",
  },
};

/**
 * Test AutoMem configuration
 */
export const TEST_CONFIG = {
  url: "http://localhost:18001",
  token: "test-token-pi-automem",
  adminToken: "test-admin-token-pi-automem",
};

/**
 * Helper to wait for a specified time (for embedding processing, etc.)
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
