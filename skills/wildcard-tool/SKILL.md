---
name: wildcard-tool
description: |
  Your agents fail silently when they need tools or capabilities you didn't
  give them, and you have no record of what they wanted. This skill helps
  you make those invisible failures visible so you can close the gaps. Use
  when the user types /wildcard-tool, asks how to make invisible agent
  failures visible, wants to capture what tools their agent wishes it had,
  or mentions Coolhand's wildcard skill, agent-side feedback collection,
  or zero-config ways to log what their agent gets stuck on.
user_invocable: true
version: 0.3.0
---

# Wildcard Tool Consultant

This skill is a consultant, not an installer. It advises the developer's AI
assistant on how to give an agent a "wildcard" tool: one the agent can call
when it is stuck because a tool call failed, returned wrong or incomplete
data, or a needed capability does not exist. The tool logs what the agent
wanted, then returns a string telling the agent that the capability is
unavailable so it continues without looping or asking the user.

The developer's AI implements the tool in whatever language and shape fits
their codebase. This skill never writes to the developer's project. Its job
is to investigate, recommend, and explain. Implementation is downstream.

## KISS

Default to the simplest, most maintainable solution that fits the project's
existing setup.

- If the project does not already use MCP, do not introduce it.
- If the project does not already expose tools through a CLI, do not propose
  a CLI surface.
- If the project ships a single agent loop in one file, the wildcard tool
  belongs in that file.

The right answer is almost always whatever the project already does, with
one more function added. Suggesting infrastructure the project does not
have is rarely worth the cost.

## Rationalizations to resist

These are excuses an AI consultant will reach for under pressure. Each
applies regardless of context.

- *"This codebase looks Python-shaped, I'll just give Python guidance and skip the abstract description."* Stay language-agnostic. Describe what the implementation must do (inputs, behavior, return value, where it sits in the agent's workflow). Let the developer's AI write it in whatever language fits. Inline language-specific code biases the developer's AI toward a stack assumption that may be wrong.
- *"The user already has Coolhand wired up, so I do not need to mention the SDK option."* Mention it. The developer may not know the Coolhand server SDK is the cleanest way to deliver the tool's payload. One sentence is the right size.
- *"Most projects use CLAUDE.md for agent instructions, so I should default to writing a CLAUDE.md block."* Do not default. Investigate where the agents in this project actually read their instructions before recommending any exposure surface. CLAUDE.md is one option among several, not the canonical choice.

If you find yourself constructing a fourth rationalization, surface it to
the developer rather than acting on it.

## Phase 0: Investigation

Develop a high-level picture of the project's agentic setup before
recommending anything. An agentic project has three things worth
identifying:

1. **Where agents live.** Source files that define an agent loop, prompt
   chain, MCP server, scheduled job, or any other place that drives an LLM
   inference call as part of the application's behavior. The agent code is
   where the wildcard tool will eventually be added.
2. **How agents receive instructions.** Some projects keep instructions in
   a CLAUDE.md or AGENTS.md file at the root. Others embed system prompts
   in code. Others rely on MCP tool listings and let the agent discover
   capabilities at runtime. Others use a CLI's `--help` output. The right
   exposure surface depends on how the project already works.
3. **Whether tools are already exposed and how.** Look for how the project
   registers tools today: an MCP server, a `tools: [...]` array in code, a
   function registry, an explicit `register_tool(...)` call somewhere. Note
   what you find. Phase 2 will use that picture to decide where the
   wildcard tool joins.

Resist the urge to hand the developer's AI a grep checklist. Describe what
to look for and trust the AI to investigate.

**Coolhand and feedback configuration.** Do not duplicate detection logic
here. The `feedback-collection` planner skill (see
`../feedback-collection/SKILL.md`) is the canonical place for Coolhand
configuration detection. If the planner has run in this project and
detected Coolhand wiring or an API key, consume its result. If it has not
run, note that the wildcard tool is being designed standalone and the
developer can wire it into Coolhand later via the planner.

## Phase 1: Preview

Before recommending anything, show the developer a short scan summary so
they can verify the investigation got the right picture. Use this format:

```
━━━━━━━━━━ WILDCARD TOOL: PREVIEW ━━━━━━━━━━

Agentic surface:    [where the agents live and what shape they have]
Instruction sink:   [where the agents read their instructions today]
Tool exposure:      [how tools are currently registered, if at all]
Coolhand status:    [detected by planner | not detected | planner not run]

Proposed wildcard tool:
  Name:             wildcard
  Behavior:         logs what the agent was trying to do and what it
                    needed, then returns a string telling the agent the
                    capability is unavailable
  Surface:          [proposed exposure surface and why it is the simplest
                    fit]
  Delivery:         [Coolhand SDK | direct HTTP to a backend | local file
                    fallback | other]

Does this match what you see in your project? Tell me what is off before
we go further.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Wait for the developer's reaction before moving on. If they flag a misread
or want a different surface, adjust the picture and show the block again.
This phase exists so the developer can correct misreads cheaply, before
any implementation work starts.

## Phase 2: Exposure

The wildcard tool only works if the agents can see it. Pick an exposure
surface by balancing three criteria:

1. **Fits the existing setup (KISS).** Whichever surface the project
   already uses is almost always the right one. If the agents read from
   CLAUDE.md, add a block there. If they discover tools via MCP, add it to
   the MCP listing. If they boot from a system prompt in code, add it to
   that prompt. Do not introduce a new surface just to expose this one
   tool.
2. **Visible to the agent at the right moment.** The wildcard tool needs
   to be in front of the agent when it is stuck, not buried in a config
   file the agent never reads. CLAUDE.md sits at the root and is read on
   every run. MCP tool listings are discovered as part of the agent's
   normal tool enumeration. A CLI surfaced via `--help` only fires if the
   agent already knows to ask. Match the surface to how the agent looks
   for tools.
3. **Minimal token overhead per call.** Every byte in the agent's
   instructions costs tokens on every inference call. MCP tool definitions
   are loaded lazily by capable runtimes and cost less per call than a
   CLAUDE.md block that prepends to every prompt. A short CLAUDE.md
   addition is cheaper than a long one. Prefer the surface that costs
   least over the lifetime of the agent.

Common surfaces and when each is the simplest fit:

- **CLAUDE.md or AGENTS.md block.** Best when the project already uses one
  of these files as the agent's instruction surface. Cheapest to add. Pays
  tokens on every run.
- **MCP tool listing.** Best when the project already runs an MCP server
  or consumes MCP tools. Tool definitions are loaded by the runtime, not
  baked into the prompt.
- **System prompt injection.** Best when the agent's instructions live
  inside application code (a Python module, a TypeScript file). Add the
  wildcard description to whatever string assembles the system prompt.
- **CLI subcommand with `--help`.** Best when the agents primarily
  interact with the project through a command-line interface. The
  wildcard tool becomes a documented subcommand the agent can invoke.
- **Language-native function or method.** Best when the agent loop is a
  tight piece of application code with no instruction file. Add the
  wildcard tool to the tools array (or equivalent) and let the runtime
  expose it.

Exposure is not optional. A wildcard tool the agents never see is dead
weight. Pick the surface that scores best across the three criteria and
explain the choice to the developer.

## Tool contract

The wildcard tool takes one parameter the agent fills in and carries one
field the framework supplies. Keep it as small as possible.

**Inputs:**

- `complaint` (string, required). The agent's own words about what went
  wrong and what it needed. Free-form. Do not impose a four-field schema
  on the agent. The agent will say what it needs to say.
- `original_output` (string, framework-captured, not asked of the agent).
  The last twenty lines of the agent's thinking chain at the moment the
  wildcard tool fired. The tool's runtime captures this automatically so
  the developer has reasoning context in the log alongside the complaint.

**Identity:**

- `creator_unique_id` (set at tool registration, not asked per call). The
  calling agent's name. Examples: `"code-review-agent"`,
  `"customer-classification-agent"`, `"onboarding-agent"`. Assigned once
  when the agent registers the wildcard tool, then carried on every call.
  Do not use a generic placeholder like `"wildcard-agent"` for every
  project. The name tells the developer which of their agents got stuck.

**Return value:**

The tool always returns the same string to the agent. The string tells the
agent explicitly that the capability is unavailable and that it should
continue without it. A useful return string sounds like:

> "Your feedback has been logged. The capability you asked for is not
> available in this environment. Continue the task using only the tools
> you already have, or stop and report to the user if you cannot proceed."

This de-loop mechanism matters. Without an explicit "do not retry" signal,
the agent will often call the wildcard tool again with a slightly
rephrased complaint, then again, in a loop. The return string is what
breaks the loop.

## Recommended delivery path

The wildcard tool's body needs to send its payload somewhere. Three
delivery paths, in order of cleanest fit:

1. **Through a Coolhand SDK already installed in the project.** If the
   project's `Gemfile` includes `gem 'coolhand'`, its Python requirements
   include `coolhand`, or its `package.json` includes `coolhand-node`, the
   wildcard tool's body should call the SDK's feedback function. The SDK
   handles transport, retries, and configuration. No new HTTP code in the
   project.
2. **A one-line mention if the planner detected Coolhand wiring without an
   SDK installed.** If the `feedback-collection` planner reported a
   Coolhand API key or partial Coolhand setup but no server SDK is
   installed, note in one sentence that adding the matching SDK
   (`coolhand` for Ruby or Python, `coolhand-node` for Node) is the
   cleanest way to wire the tool. Do not push the decision. The
   developer's AI will make the call.
3. **Minimum wire format if no Coolhand SDK or wiring is present.**
   Describe what the tool needs to send (a JSON body with the complaint,
   the captured thinking chain, and the agent name) and let the
   developer's AI implement the transport in whatever style fits the
   project. The skill does not own the wire code.

The skill should never recommend installing a Coolhand SDK in a project
that does not already have one. That decision belongs to the developer.

## Monitoring guidance

In active development the wildcard tool fires roughly once per agent run
because the toolset is still being built out; in stable production a
wildcard call is rare enough that each one is worth investigating. Suggest
the developer set a reminder for about a week out to review the
accumulated feedback, since the value of the tool is in what they do with
the log rather than in the log itself.

Once the developer has a plan for reviewing the log, the consultation is
done. Hand control back.
