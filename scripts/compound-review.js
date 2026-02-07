#!/usr/bin/env node
/**
 * AutoMem Compound Review - Nightly batch processing of pi sessions
 *
 * Scans all pi sessions from the last 24 hours, extracts learnings using
 * pi itself (with gemini-3-flash via antigravity), and stores them in AutoMem.
 *
 * This is the pi equivalent of the "Compound Review" step in Ryan Carson's
 * nightly agent loop, but stores learnings in AutoMem instead of AGENTS.md.
 *
 * Usage:
 *   node compound-review.js                    # Process last 24 hours
 *   node compound-review.js --hours 48         # Process last 48 hours
 *   node compound-review.js --dry-run          # Preview without storing
 *   node compound-review.js --session <path>   # Process specific session
 *
 * Environment:
 *   AUTOMEM_URL   - AutoMem API URL (default: http://localhost:8001)
 *   AUTOMEM_TOKEN - API token (required)
 *
 * Uses pi with google-antigravity/gemini-3-flash for extraction.
 * Requires: pi must be installed and authenticated (/login google-antigravity)
 *
 * Schedule with cron/systemd:
 *   0 22 * * * /path/to/compound-review.js >> /var/log/automem-compound.log 2>&1
 */

import { readFileSync, readdirSync, statSync, existsSync, appendFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execSync, spawn } from "node:child_process";

// Configuration
const AUTOMEM_URL = process.env.AUTOMEM_URL || "http://localhost:8001";
const AUTOMEM_TOKEN = process.env.AUTOMEM_TOKEN;

// Parse arguments
const args = process.argv.slice(2);
const hoursArg = args.indexOf("--hours");
const hours = hoursArg !== -1 ? parseInt(args[hoursArg + 1], 10) : 24;
const dryRun = args.includes("--dry-run");
const sessionArg = args.indexOf("--session");
const specificSession = sessionArg !== -1 ? args[sessionArg + 1] : null;
const verbose = args.includes("--verbose") || args.includes("-v");

// Processed sessions tracking (avoid re-processing)
const PROCESSED_FILE = join(homedir(), ".pi/agent/automem-processed-sessions.log");

function log(...msgs) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}]`, ...msgs);
}

function debug(...msgs) {
  if (verbose) log("[DEBUG]", ...msgs);
}

function getProcessedSessions() {
  if (!existsSync(PROCESSED_FILE)) return new Set();
  const content = readFileSync(PROCESSED_FILE, "utf-8");
  return new Set(content.split("\n").filter(Boolean));
}

function markSessionProcessed(sessionPath) {
  if (!dryRun) {
    appendFileSync(PROCESSED_FILE, sessionPath + "\n");
  }
}

/**
 * Find all session files modified in the last N hours
 */
function findRecentSessions(baseDir, hoursAgo) {
  const sessions = [];
  const cutoff = Date.now() - hoursAgo * 60 * 60 * 1000;

  function scanDir(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "subagent-artifacts") {
          scanDir(fullPath);
        } else if (entry.name.endsWith(".jsonl")) {
          const stat = statSync(fullPath);
          if (stat.mtimeMs >= cutoff) {
            sessions.push({
              path: fullPath,
              mtime: stat.mtimeMs,
              name: entry.name,
            });
          }
        }
      }
    } catch (e) {
      // Ignore permission errors
    }
  }

  scanDir(baseDir);
  return sessions.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Parse a pi session file and extract conversation
 */
function parseSession(sessionPath) {
  const content = readFileSync(sessionPath, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  const entries = [];
  let turnCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "message" && entry.message) {
        const msg = entry.message;

        // Extract text from various message formats
        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((c) => c.type === "text" && c.text)
            .map((c) => c.text)
            .join("\n");
        }

        if (text.trim() && (msg.role === "user" || msg.role === "assistant")) {
          if (msg.role === "user") turnCount++;
          entries.push({
            role: msg.role,
            text: text.slice(0, 2000), // Truncate long responses
          });
        }
      }
    } catch (e) {
      // Skip malformed lines
    }
  }

  return { entries, turnCount };
}

/**
 * Format entries for LLM extraction
 */
function formatConversation(entries) {
  return entries
    .map((e) => `${e.role.toUpperCase()}: ${e.text}`)
    .join("\n\n");
}

/**
 * Call pi with gemini-3-flash to extract memories
 */
async function extractMemories(conversationText) {
  // Limit conversation to ~15k chars to keep extraction fast
  const truncatedConversation = conversationText.slice(0, 15000);
  
  const extractionPrompt = `Analyze this coding session and extract important learnings.

Extract ONLY:
- Decisions (architecture, tools, approaches)
- Insights (gotchas, bugs, findings)
- Patterns (preferences, style, habits)
- Context (project structure, constraints)

Skip routine tool usage and file reads.

For each memory provide: content (1-2 sentences), type (Decision/Insight/Pattern/Preference/Context), importance (0.5-1.0), tags (array).

<conversation>
${truncatedConversation}
</conversation>

Respond with ONLY a JSON array. Example: [{"content": "Chose PostgreSQL", "type": "Decision", "importance": 0.8, "tags": ["db"]}]
If nothing worth remembering, respond with []`;

  // Write prompt to temp file (handles large prompts better)
  const promptFile = join(tmpdir(), `automem-extract-${Date.now()}.txt`);
  writeFileSync(promptFile, extractionPrompt);
  
  try {
    // Run pi in non-interactive mode with gemini-3-flash (90s timeout)
    const stdout = execSync(`pi --provider google-antigravity --model gemini-3-flash --thinking high --mode text -p @${promptFile}`, {
      timeout: 90000,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonText = stdout.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    
    // Find JSON array in response
    const match = jsonText.match(/\[[\s\S]*\]/);
    if (!match) {
      return [];
    }
    
    const memories = JSON.parse(match[0]);
    return Array.isArray(memories) ? memories : [];
  } catch (e) {
    if (e.killed) {
      throw new Error("Extraction timed out after 90s");
    }
    throw e;
  } finally {
    try { unlinkSync(promptFile); } catch {}
  }
}

/**
 * Store memory in AutoMem
 */
async function storeMemory(memory, sessionPath) {
  const response = await fetch(`${AUTOMEM_URL}/memory`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AUTOMEM_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: memory.content,
      type: memory.type,
      importance: memory.importance,
      tags: [...(memory.tags || []), "auto-extracted", "compound-review"],
      metadata: {
        source: "compound-review",
        session_file: sessionPath,
        extracted_at: new Date().toISOString(),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`AutoMem error: ${await response.text()}`);
  }

  return response.json();
}

/**
 * Process a single session
 */
async function processSession(sessionPath) {
  log(`Processing: ${basename(sessionPath)}`);

  const { entries, turnCount } = parseSession(sessionPath);

  if (turnCount < 3) {
    debug(`Skipping (only ${turnCount} turns)`);
    return { skipped: true, reason: "too short" };
  }

  const conversationText = formatConversation(entries);
  debug(`Conversation length: ${conversationText.length} chars`);

  const memories = await extractMemories(conversationText);
  debug(`Extracted ${memories.length} memories`);

  if (memories.length === 0) {
    return { skipped: false, memories: 0 };
  }

  if (dryRun) {
    log("DRY RUN - Would store:");
    for (const m of memories) {
      log(`  [${m.type}] ${m.content}`);
      log(`    Importance: ${m.importance}, Tags: ${(m.tags || []).join(", ")}`);
    }
    return { skipped: false, memories: memories.length, dryRun: true };
  }

  let stored = 0;
  let failed = 0;

  for (const memory of memories) {
    try {
      await storeMemory(memory, sessionPath);
      stored++;
    } catch (e) {
      log(`  Failed to store: ${e.message}`);
      failed++;
    }
  }

  return { skipped: false, memories: memories.length, stored, failed };
}

/**
 * Main
 */
async function main() {
  log("=== AutoMem Compound Review ===");

  if (!AUTOMEM_TOKEN) {
    console.error("Error: AUTOMEM_TOKEN not set");
    process.exit(1);
  }

  // Check pi is available
  try {
    execSync("pi --version", { stdio: "pipe" });
  } catch (e) {
    console.error("Error: pi not found. Install from https://github.com/badlogic/pi-mono");
    process.exit(1);
  }

  // Check AutoMem connectivity
  try {
    const health = await fetch(`${AUTOMEM_URL}/health`, {
      headers: { Authorization: `Bearer ${AUTOMEM_TOKEN}` },
    });
    if (!health.ok) throw new Error("unhealthy");
    const data = await health.json();
    log(`AutoMem: ${data.status} (${data.memory_count} memories)`);
  } catch (e) {
    console.error(`Error: Cannot connect to AutoMem at ${AUTOMEM_URL}`);
    process.exit(1);
  }

  // Find sessions to process
  let sessions;
  if (specificSession) {
    sessions = [{ path: specificSession, name: basename(specificSession) }];
  } else {
    const sessionsDir = join(homedir(), ".pi/agent/sessions");
    sessions = findRecentSessions(sessionsDir, hours);
    log(`Found ${sessions.length} sessions from last ${hours} hours`);
  }

  // Filter already-processed sessions
  const processed = getProcessedSessions();
  const toProcess = sessions.filter((s) => !processed.has(s.path));
  log(`${toProcess.length} sessions not yet processed`);

  if (toProcess.length === 0) {
    log("Nothing to process");
    return;
  }

  // Process each session
  let totalMemories = 0;
  let totalStored = 0;

  for (const session of toProcess) {
    try {
      const result = await processSession(session.path);

      if (!result.skipped) {
        totalMemories += result.memories || 0;
        totalStored += result.stored || 0;
        markSessionProcessed(session.path);
      }
    } catch (e) {
      log(`Error processing ${session.name}: ${e.message}`);
    }
  }

  log("=== Summary ===");
  log(`Sessions processed: ${toProcess.length}`);
  log(`Memories extracted: ${totalMemories}`);
  if (!dryRun) {
    log(`Memories stored: ${totalStored}`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
