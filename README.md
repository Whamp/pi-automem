# AutoMem Pi Package

Long-term memory integration for [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

## Installation

### From git (recommended)

```bash
pi install git:github.com/verygoodplugins/automem/pi-package
```

### From local clone

```bash
pi install /path/to/automem/pi-package
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

## Requirements

- AutoMem service running and accessible
- `AUTOMEM_TOKEN` environment variable set

## See Also

- [AutoMem Documentation](https://github.com/verygoodplugins/automem)
- [Pi Coding Agent](https://github.com/mariozechner/pi-coding-agent)
