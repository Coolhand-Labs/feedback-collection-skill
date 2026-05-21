---
name: wildcard-tool
description: |
  Use when the user wants to add a "wildcard tool", "complaint box", "CEO
  review tool", "magical wish tool", or any agent-feedback fallback to an AI
  agent project so the agent can report when a tool call has failed,
  returned wrong or incomplete data, or a needed capability does not exist.
  Use when the user types /wildcard-tool or /complaint-box, asks how to make
  invisible AI agent failures visible, or wants to capture which tools their
  agent wishes it had. Also use when the user mentions Coolhand's wildcard
  skill, agent-side feedback collection, or wants a zero-config way to log
  what their agent gets stuck on.
user_invocable: true
version: 0.1.0
---

# Wildcard Tool Installer

This skill adds a single "wildcard" tool to any AI agent project. The agent
calls the tool when it is stuck — failed tool call, wrong data, missing
capability — and the tool logs what was needed. Two delivery modes:

- If `COOLHAND_API_KEY` is set in the developer's environment, the tool POSTs
  to Coolhand (managed analytics).
- If not, the tool appends one JSON line per call to `.wildcard-feedback.jsonl`
  in the project root — zero-config, no account needed.

The tool always returns the same response string to the agent so the agent
continues with the tools it has rather than getting stuck or looping.

This skill is the **installer**. It detects the developer's stack, shows them
what will be added, copies the right template into their project, and updates
their `CLAUDE.md` so their agent knows the tool exists.

## Rationalizations to resist

These are excuses an agent will reach for under pressure. Each one applies
regardless of context.

| Excuse | Counter |
|---|---|
| "The user is in a hurry; I'll skip the Phase 1 preview and just inject the tool." | Always show the preview and wait for `y`. The developer needs to see which file gets modified and exactly what gets added before it lands. Skipping the gate trades 30 seconds of confirmation for an unannounced diff on their main branch. |
| "I'll inject the tool but skip updating CLAUDE.md — the agent will figure out the tool exists on its own." | No. An exposed tool with no agent instruction telling it when to use the tool is dead code. The CLAUDE.md block is the trigger that makes the tool actually fire. Phases 2 and 3 are non-separable. |
| "CLAUDE.md already has a Wildcard Tool block from a prior run; I'll add another one anyway." | No. Re-running this skill is idempotent. If the block is already present (verbatim or near-verbatim), do not duplicate it — tell the developer it's already there and move on. |

If you find yourself constructing a fourth rationalization, surface it to the
developer rather than acting on it.

## Instructions

Work through these phases in order. Be transparent about findings at each step.

---

### Phase 0: Detect the developer's setup

Scan the developer's project (the working directory, not this skill's repo) for:

1. **Stack signals.** Pick the dominant one — the agent code is where the
   wildcard tool needs to live.
   - **MCP project** — presence of `mcp_config.json`, `.mcp.json`, or
     `mcp_servers` entries in their `CLAUDE.md`, or a file using
     `@modelcontextprotocol/sdk`.
   - **Python project** — `pyproject.toml` / `requirements.txt` / `setup.py`,
     or `.py` files with `@tool` decorators or an Anthropic SDK import
     (`from anthropic import Anthropic`).
   - **TypeScript / Node project** — `package.json` with `@anthropic-ai/sdk`
     in dependencies, or `.ts` / `.js` files defining a `tools: [...]` array
     in a `messages.create(...)` call.
   - **Ruby project** — `Gemfile` / `Gemfile.lock`, or `.rb` files
     instantiating an agent loop.
   - **Claude-Code-only (no app code)** — no source files found, but a
     `CLAUDE.md` exists. The developer is running Claude Code directly and
     wants an MCP-server wildcard tool.

2. **Existing agent instructions** — is there a `CLAUDE.md` or `claude.md` at
   the project root? Note which (we'll append to whichever exists; if neither,
   we create `CLAUDE.md`).

3. **Coolhand status** — search `.env`, `.env.local`, `.env.development`,
   `.env.production`, and any other `.env.*` files for `COOLHAND_API_KEY`.
   Note presence (don't print the value).

4. **Existing wildcard block** — read the existing `CLAUDE.md` if present
   and check for `## Wildcard Tool`. If found, the skill has already been run.
   Tell the developer, ask whether to re-overwrite the tool file, and skip
   Phase 3.

Report findings in a short scan block before Phase 1, e.g.:

```
Detected: Python project (pyproject.toml, 4 .py files using anthropic SDK)
CLAUDE.md: present
COOLHAND_API_KEY: not found → will use .wildcard-feedback.jsonl fallback
Prior wildcard block: none
```

---

### Phase 1: Preview and confirmation gate

Show the developer exactly what will be added. Use this format:

```
━━━━━━━━━━ WILDCARD TOOL — PREVIEW ━━━━━━━━━━

Stack:           [Python | TypeScript | Ruby | MCP | Claude-Code-only]
Tool file:       [target path in their project, e.g., ./wildcard_tool.py]
CLAUDE.md:       [will append block | will create file with block | block
                  already present — will skip]
Delivery mode:   [Coolhand POST | local .wildcard-feedback.jsonl fallback]

The tool exposes one function named `wildcard` with this description (read by
the agent at runtime):

  "Use this tool when you are stuck: when a tool call failed, returned
  incomplete or wrong data, or when you need a capability that does not exist
  in your current tool set. Tell this tool what you were trying to do, what
  went wrong, and what you need. This tool will log your feedback and tell
  you how to proceed."

Parameters:
  • task_description           (string, required)
  • tool_or_capability_needed  (string, required)
  • last_tool_called           (string, optional)
  • error_or_wrong_output      (string, optional)

CLAUDE.md addition (verbatim):

  ## Wildcard Tool
  When you are stuck — a tool call failed, returned wrong data, or you need
  a capability that doesn't exist — call the `wildcard` tool before giving
  up or asking the user. Describe what you were trying to do and what went
  wrong. This tool exists to capture what is missing so it can be fixed.

Proceed? (y/n)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Wait for an explicit `y` or equivalent before any file write.** If the
developer says no or wants changes, stop and ask what they want adjusted. Do
not skip this gate.

---

### Phase 2: Generate the wildcard tool

Pick the matching template from this skill's `templates/` directory:

| Detected stack | Template | Destination in developer's project |
|---|---|---|
| Python | `templates/wildcard_tool.py` | `./wildcard_tool.py` |
| TypeScript / Node | `templates/wildcard-tool.ts` | `./wildcard-tool.ts` |
| Ruby | `templates/wildcard_tool.rb` | `./wildcard_tool.rb` |
| MCP | `templates/wildcard-tool.ts` | `./wildcard-mcp-server.ts` (with the MCP server wrapper described below) |
| Claude-Code-only | `templates/wildcard-tool.ts` | `./wildcard-mcp-server.ts` (same wrapper) |

Read the template file from this skill's installed location, then copy its
contents to the destination. Do not invent template content — the file on
disk is the contract.

**MCP wrapper.** For MCP and Claude-Code-only stacks, wrap the TypeScript
template's `wildcardTool` object + `handleWildcard` function in a minimal
`@modelcontextprotocol/sdk/server/index.js` server with `setRequestHandler`
plumbing for `tools/list` and `tools/call`, exporting an executable
stdio-transport entry point. Tell the developer to add the server to their
MCP config (one line in `.mcp.json` or in the `mcp_servers` block of their
CLAUDE.md).

After writing the file, print its path and the one-line wiring instruction
appropriate to the stack (e.g., `"Add wildcardTool to your tools: [...]
array in src/agent.ts"`).

---

### Phase 3: Inject the CLAUDE.md block

If `CLAUDE.md` (or `claude.md`) exists at the project root: append the block
shown in Phase 1, separated from existing content by exactly one blank line.

If neither file exists: create `CLAUDE.md` with just the block.

If the block (or near-verbatim equivalent — match on the heading
`## Wildcard Tool`) is already present, do NOT append a duplicate. Tell the
developer it's already there and skip this phase.

The block to append, verbatim:

```
## Wildcard Tool
When you are stuck — a tool call failed, returned wrong data, or you need a
capability that doesn't exist — call the `wildcard` tool before giving up or
asking the user. Describe what you were trying to do and what went wrong.
This tool exists to capture what is missing so it can be fixed.
```

This block matters because an exposed tool with no instruction telling the
agent when to use it gets ignored. The CLAUDE.md addition is the trigger.

---

### Phase 4: Summary and next steps

Print a short confirmation block:

```
━━━━━━━━━━ WILDCARD TOOL — INSTALLED ━━━━━━━━━━

✓  Tool file:        ./wildcard_tool.py
✓  CLAUDE.md:        appended Wildcard Tool block
✓  Delivery mode:    .wildcard-feedback.jsonl fallback (no COOLHAND_API_KEY)

Wire-up:  Import `wildcard` from wildcard_tool and add it to your agent's
          tools list. See the header comment at the top of the file for the
          exact one-liner.

What happens next:
  • The next time your agent gets stuck and calls `wildcard(...)`, you'll see
    a new line appear in .wildcard-feedback.jsonl with what it was trying to
    do and what was missing.
  • To switch to Coolhand-managed feedback: set COOLHAND_API_KEY in your
    .env. No code changes needed.
  • Found a bug or want a feature? Open an issue at
    https://github.com/Coolhand-Labs/feedback-collection-skill/issues/new

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

The skill is done. Hand control back to the developer.

---

## Notes on the wire format

All three language templates POST identical JSON to Coolhand and write
identical JSON to the local fallback. The fields map onto Coolhand's v2
feedback schema (`POST /api/v2/llm_request_log_feedbacks` — see
`../self-hosted-feedback/references/api-spec.md`):

- `client_unique_id` — UUID generated per tool call. Satisfies the floor
  rule (at least one of `client_unique_id` or `original_output` must be
  present).
- `creator_unique_id` — the constant string `"wildcard-agent"`. This is
  intentionally NOT a hashed end-user ID because the "creator" of this
  feedback is an AI agent, not a human. The constant marks the data origin
  so Coolhand analytics can distinguish wildcard signals from human feedback.
- `collector` — `"wildcard-tool-v0.1.0"` so Coolhand can track which version
  generated the feedback.
- `sentiment` — `"dislike"`. A wildcard call always means "I am stuck on
  something" — a negative signal by definition.
- `explanation` — a multi-line string combining `task_description`,
  `tool_or_capability_needed`, `last_tool_called`, and `error_or_wrong_output`
  into one human-readable block.

The endpoint URL lives in exactly one place per template: a top-of-file
constant named `COOLHAND_FEEDBACK_URL`. If Coolhand confirms a different
production URL, the swap is one line per template.
