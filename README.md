# AutoMem Pi Package

Long-term memory integration for [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

## Installation

### From git (recommended)

```bash
pi install git:github.com/Whamp/pi-automem
```

### From local clone

```bash
pi install ~/projects/pi-automem
```

## Configuration

Set these environment variables (add to `~/.bashrc` or `~/.zshrc`):

```bash
export AUTOMEM_URL="http://localhost:8001"  # Your AutoMem API URL
export AUTOMEM_TOKEN="your-api-token"       # Required
```

## Tools

The extension provides three tools:

### automem_store

Store a memory for long-term recall.

```
"Remember that we use PostgreSQL for all new projects"
"Store this decision: Using Tailwind CSS for the dashboard"
```

Parameters:

- `content` (required): The memory content
- `type`: Decision, Pattern, Preference, Style, Habit, Insight, or Context
- `importance`: 0-1 score (default 0.7)
- `tags`: Array of tags for filtering

### automem_recall

Search and retrieve memories.

```
"What are my database preferences?"
"Recall decisions about the auth system"
```

Parameters:

- `query` (required): Search query
- `limit`: Max results (default 5)
- `tags`: Filter by tags
- `time_query`: Natural language time filter ("last week", "last month")

### automem_health

Check AutoMem service connectivity.

## Development

### Running Tests

```bash
# Install dependencies
npm install

# Run unit tests
npm run test

# Run unit tests with watch mode
npm run test:watch

# Run with coverage report
npm run test:coverage
```

### Integration Tests

Integration tests run against an isolated AutoMem instance to avoid polluting production data.

```bash
# Start test containers + run integration tests + cleanup
npm run test:integration

# Or manually:
# 1. Start the test instance
npm run docker:test:up

# 2. Run integration tests
npx vitest run --config vitest.integration.config.mts

# 3. Stop and clean up
npm run docker:test:down
```

The test instance runs on different ports to avoid conflicts:

- AutoMem API: `localhost:18001` (vs production `8001`)
- FalkorDB: `localhost:16379` (vs production `6379`)
- Qdrant: `localhost:16333` (vs production `6333`)

### Test Structure

```
tests/
├── fixtures.ts                  # Mock utilities and sample data
├── automem.test.ts             # Unit tests (mocked fetch)
├── edge-cases.test.ts          # Edge case unit tests
└── automem.integration.test.ts # Integration tests (real API)
```

### Test Script

A convenience script is also available:

```bash
./run-tests.sh          # Unit tests only
./run-tests.sh --all    # Unit + integration tests
./run-tests.sh --int    # Integration tests only
```

## Requirements

- AutoMem service running and accessible
- `AUTOMEM_TOKEN` environment variable set

## See Also

- [AutoMem Documentation](https://github.com/verygoodplugins/automem)
- [Pi Coding Agent](https://github.com/mariozechner/pi-coding-agent)
