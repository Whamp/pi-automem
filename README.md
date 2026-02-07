# pi-automem

Long-term memory for [pi coding agent](https://github.com/badlogic/pi-mono) using [AutoMem](https://github.com/verygoodplugins/automem).

This is the pi equivalent of Ryan Carson's ["How to make your agent learn and ship while you sleep"](https://x.com/ryancarson/status/2016520542723924279) pattern, but stores learnings in AutoMem instead of AGENTS.md files.

## Features

### Tools for Manual Memory Management

- **`automem_store`** - Store a memory with content, type, importance, and tags
- **`automem_recall`** - Search memories by semantic similarity with optional filters
- **`automem_health`** - Check AutoMem service connectivity

### Automatic Session Extraction

On every session shutdown, the extension:
1. Extracts the conversation text
2. Uses Gemini 3 Flash to identify decisions, insights, patterns, and context
3. Stores them in AutoMem with `auto-extracted` tag

### Nightly Compound Review

A batch script processes all sessions from the last 24 hours:
1. Finds sessions not yet processed
2. Extracts learnings using Gemini
3. Stores memories with `compound-review` tag
4. Tracks processed sessions to avoid duplicates

## Installation

### 1. Install the extension

Add to your pi packages in `~/.pi/settings.json`:

```json
{
  "packages": [
    "git:github.com/Whamp/pi-automem"
  ]
}
```

Or for development, symlink directly:

```bash
ln -s /path/to/pi-automem ~/.pi/agent/extensions/pi-automem
```

### 2. Configure environment

Create `~/.config/automem/env`:

```bash
# Required for storing memories
AUTOMEM_TOKEN=your-automem-api-token

# Optional - AutoMem server URL (default: http://localhost:8001)
# AUTOMEM_URL=http://desktop:8001

# Optional - disable auto-extraction on session end
# AUTOMEM_AUTO_EXTRACT=false

# Optional - minimum conversation turns before extraction (default: 3)
# AUTOMEM_MIN_TURNS=3
```

Add to your shell profile (`.bashrc`, `.zshrc`):

```bash
source ~/.config/automem/env
```

> **Note**: The compound-review script uses `pi` itself with `google-antigravity/gemini-3-flash` for extraction, so it automatically uses your existing pi authentication. No separate Gemini API key needed!

### 3. Set up nightly compound review (optional)

Copy the systemd units:

```bash
cp scripts/automem-compound-review.service ~/.config/systemd/user/
cp scripts/automem-compound-review.timer ~/.config/systemd/user/

# Edit paths in the service file for your system
nano ~/.config/systemd/user/automem-compound-review.service

# Enable and start
systemctl --user daemon-reload
systemctl --user enable --now automem-compound-review.timer

# Check status
systemctl --user status automem-compound-review.timer
systemctl --user list-timers
```

## Usage

### During sessions

The extension loads automatically. At session start, you'll see a notification confirming AutoMem connection.

During the session, use the tools:

```
# Store a memory manually
"Remember that we're using PostgreSQL for this project"

# Recall relevant memories
"What database decisions have we made?"
```

### At session end

When you exit pi (Ctrl+C, Ctrl+D), the extension:
1. Checks if the session had enough turns (default: 3+)
2. Extracts memories using Gemini 3 Flash
3. Stores them in AutoMem
4. Shows a notification with results

### Nightly batch processing

Run manually:

```bash
# Process last 24 hours
node scripts/compound-review.js

# Process last 48 hours
node scripts/compound-review.js --hours 48

# Preview without storing
node scripts/compound-review.js --dry-run

# Process specific session
node scripts/compound-review.js --session ~/.pi/agent/sessions/.../session.jsonl
```

Or let the systemd timer run at 10:30 PM daily.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTOMEM_URL` | `http://localhost:8001` | AutoMem API endpoint |
| `AUTOMEM_TOKEN` | (required) | API authentication token |
| `AUTOMEM_AUTO_EXTRACT` | `true` | Enable extraction on session shutdown |
| `AUTOMEM_MIN_TURNS` | `3` | Minimum turns before extraction |

The compound-review script uses `pi --provider google-antigravity --model gemini-3-flash` for extraction, so no separate API key is needed.

## How It Works

### The Compound Learning Loop

1. **During the day**: You work with pi on various tasks
2. **At session end**: Learnings are extracted and stored immediately
3. **Nightly at 10:30 PM**: Compound review catches any missed sessions
4. **Next session**: AutoMem memories are available for recall

This creates a compound effect where:
- Patterns discovered on Monday inform Tuesday's work
- Gotchas hit on Wednesday are avoided on Thursday
- Decisions made last month are instantly recallable

### Memory Types

| Type | Description | Example |
|------|-------------|---------|
| `Decision` | Architecture, tool, approach choices | "Chose PostgreSQL over MongoDB for ACID compliance" |
| `Insight` | Gotchas, bugs, performance findings | "The /recall endpoint needs time_query for date filtering" |
| `Pattern` | Preferences, coding style, workflows | "User prefers using ripgrep over find for code search" |
| `Preference` | Explicit user preferences | "User wants dark mode in all applications" |
| `Context` | Project structure, constraints | "This project uses TypeScript with strict mode" |

### Extraction Prompt

Gemini 3 Flash analyzes each conversation and extracts:
- Decisions made (architecture, tools, approaches)
- Insights discovered (gotchas, bugs, performance)
- Patterns identified (preferences, style, habits)
- Important context (structure, constraints, requirements)

Each memory includes:
- Content (1-2 sentence statement)
- Type (Decision/Insight/Pattern/Preference/Context)
- Importance (0.5-1.0)
- Tags (for filtering)
- Metadata (session ID, extraction time, source)

## Comparison with Ryan Carson's Approach

| Aspect | Carson's Approach | pi-automem |
|--------|-------------------|------------|
| Tool | Claude Code / Amp | pi |
| Memory storage | AGENTS.md files | AutoMem (FalkorDB + Qdrant) |
| Extraction | Claude Code skills | Gemini 3 Flash |
| Timing | Nightly only | Session-end + nightly |
| Search | File-based | Semantic + keyword + graph |
| Cross-project | Per-repo AGENTS.md | Centralized AutoMem |

## License

MIT
