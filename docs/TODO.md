# TODO: Part 2 - Project-Level Auto-Compound

## Context

This implementation covers **Part 1** of Ryan Carson's compound learning pattern:
- ✅ Nightly compound review (extract learnings from sessions)
- ✅ Store in AutoMem (semantic memory)

**Part 2** (autonomous implementation loop) is out of scope for now.

## Why Part 2 is Different

Part 1 operates at the **global level**:
- Analyzes ALL sessions across ALL projects across ALL machines
- Extracts workflow learnings, tool patterns, model behaviors
- Runs once nightly on the desktop (where AutoMem lives)
- Learnings apply universally to how you use pi

Part 2 operates at the **project level**:
- Reads a specific project's prioritized backlog
- Creates PRDs for features in THAT project
- Implements changes in THAT codebase
- Opens PRs to THAT repository

This means Part 2 should be:
- Configured per-project (not globally)
- Run in the project's working directory
- Use project-specific context (AGENTS.md, codebase knowledge)

## Part 2 Components to Build

### 1. Prioritized Backlog System

Where do priorities come from?
- `reports/*.md` - Markdown files with prioritized items
- `tasks/backlog.json` - Structured task list
- GitHub Issues with priority labels
- Linear/Jira integration

### 2. PRD Generation

```bash
# Using pi's existing skills/agents
pi -p "Create a PRD for: $PRIORITY_ITEM" --skill prd-writer
```

Or use pi-messenger crew mode:
```javascript
pi_messenger({ action: "plan", prd: "docs/feature.md" })
```

### 3. Task Breakdown

Convert PRD to executable tasks:
```bash
pi -p "Break this PRD into tasks" --output tasks/current.json
```

Or use crew's built-in planning:
```javascript
pi_messenger({ action: "plan" })  // Auto-discovers PRD
```

### 4. Execution Loop

Run tasks until complete or blocked:
```javascript
pi_messenger({ action: "work", autonomous: true })
```

Or a custom loop script:
```bash
#!/bin/bash
# scripts/auto-implement.sh
MAX_ITERATIONS=25
for i in $(seq 1 $MAX_ITERATIONS); do
  pi -p "Work on the next task. If blocked, stop."
  if [ $? -ne 0 ]; then break; fi
done
```

### 5. PR Creation

```bash
git push -u origin "$BRANCH_NAME"
gh pr create --draft --title "Auto: $PRIORITY_ITEM" --base main
```

## Proposed Project-Level Setup

For a project that wants Part 2, add:

```
project/
├── .pi/
│   └── AGENTS.md           # Project-specific context
├── scripts/
│   └── auto-compound.sh    # Project's implementation script
├── reports/
│   └── priorities.md       # Prioritized backlog
└── tasks/
    └── current.json        # Active task breakdown
```

With a project-specific systemd timer or cron job.

## Integration Points

- **pi-messenger crew**: Already has plan/work/review actions
- **Subagents**: Can delegate to specialized agents
- **AutoMem**: Query for relevant learnings before implementation

Example flow:
```javascript
// 1. Recall relevant learnings from AutoMem
const learnings = await automem_recall({ query: "Next.js API routes" });

// 2. Plan from PRD
await pi_messenger({ action: "plan", prd: "docs/feature.md" });

// 3. Work autonomously
await pi_messenger({ action: "work", autonomous: true });

// 4. Create PR
execSync("gh pr create --draft");
```

## References

- [Compound Product](https://github.com/ryancarson/compound-product) - Ryan Carson's auto-compound.sh
- [Ralph](https://github.com/anthropics/ralph) - Autonomous agent loop
- [pi-messenger crew](~/.pi/agent/skills/pi-messenger-crew/SKILL.md) - Pi's task orchestration

## Timeline

Not currently planned. Implement when:
1. A specific project needs autonomous overnight implementation
2. Backlog/prioritization system is in place
3. Confidence in pi's autonomous execution is high enough
