---
name: feedback-collection
description: |
  Use when the user wants to add Coolhand human feedback collection to an AI/LLM
  workflow, asks about RLHF, human-in-the-loop feedback, thumbs up/down on AI
  output, capturing user edits to AI-generated content, or types /coolhand or
  /feedback-collection. Also use when the user mentions Coolhand,
  COOLHAND_API_KEY, coolhand-js, coolhand-node, coolhand-python, or coolhand-ruby.
user_invocable: true
version: 0.1.0
---

# Feedback Collection Planner

This skill is the entry point for adding human feedback collection to AI/LLM workflows. It scans the user's codebase, designs a strategy following best practices, gets approval for the plan, and then dispatches to one of two implementation skills:

- **`coolhand-integration`** — install the Coolhand SDKs against the managed `coolhandlabs.com` backend.
- **`self-hosted-feedback`** — scaffold equivalent endpoints on the user's own backend.

The planner does not install SDKs, write endpoints, or touch UI. It does discovery and proposal, then hands off.

## Rationalizations to resist

These three guardrails are the ones pressure (a hurry, a "small" exception, "we already approved similar") will push you to bypass. Each excuse below has been observed in real sessions. The counter applies regardless of context.

| Excuse | Counter |
|---|---|
| "The user ID is internal-only / numeric / non-PII, hashing is overkill." | Hash anyway. The rule is no PII in `creator_unique_id`, period. SHA-256(internal_id) costs nothing and removes the question entirely. Switching from unhashed to hashed later means rewriting historical data, and the cost of being wrong is a privacy incident. |
| "User already approved adding the widget once, I'll skip the proposal for the next AI surface." | Every UI change gets its own diff and its own sign-off. "Approved one widget" is not "approved widgets in general." The Phase 4 proposal — show the diff, name the element, wait for confirmation — applies to each placement, not the first. |
| "`COOLHAND_API_KEY` is missing but the user is in a hurry. I'll wire everything up and they can fill in the key later." | Stop and wait, every time. Phase 0 is a gate, not a suggestion. Implementing without a key produces silent send failures at runtime that the user has to debug; making them set the key first is faster end-to-end. |

If you find yourself constructing a fourth rationalization, that's the signal to stop and surface it to the user rather than act on it.

## Instructions

Work through these phases in order. Be transparent about findings at each step.

---

### Phase 0: Prerequisites

**Parse arguments:** `$ARGUMENTS` may contain an optional directory path (e.g., `/coolhand src/ai/`). If provided, restrict all file scanning to that path. If empty, scan the entire project.

**Check for API key.** Look for `COOLHAND_API_KEY` in: `.env`, `.env.local`, `.env.development`, `.env.production`, and any other `.env.*` files. If not found, tell the user:

> No `COOLHAND_API_KEY` found. You'll need one to send feedback.
> If you plan to use the managed Coolhand backend, get a key at https://coolhandlabs.com.
> If you plan to self-host, generate any opaque secret string.
> Add it to your `.env`:
> ```
> COOLHAND_API_KEY=your_key_here
> ```
> Let me know when it's set and I'll continue.

Stop and wait for confirmation before proceeding.

---

### Phase 1: Codebase Scan

Read `detection-patterns/providers.yml` (in this skill's directory) for the canonical detection patterns. It contains five lists used in this phase:

- `sdk_imports.{python,node,ruby}` — substring patterns indicating an LLM SDK import
- `inference_calls` — method-call substrings indicating an inference call (any language)
- `http_inference_hosts` — hostname substrings for direct-HTTP inference detection (`requests.post`, `httpx.post`, `Faraday.post`, `Net::HTTP.post`, `fetch(...)`, etc. — match the hostname inside the URL)
- `existing_coolhand` — substrings indicating Coolhand is already partially integrated
- `existing_feedback_ui` — substrings indicating an existing feedback UI

These are substring matches, not regexes. Search the project (or scoped path) for each list, treating an entry as a hit when it appears anywhere in the matching language's source files.

For each AI inference call found, note:
1. File path and line number
2. Provider/SDK used
3. How the output is used: shown to a user, drives an automated decision, triggers a downstream action
4. Whether any existing downstream event naturally signals quality: a purchase, save, share, accept/reject action, copy to clipboard, delete/dismiss, retry
5. Whether a user identity is accessible in that code path

---

### Phase 2: Tech Stack Detection

Identify:
- **Language(s):** Python / Node.js (JS/TS) / Ruby / other
- **Framework:** Rails, Django, FastAPI, Flask, Express, Next.js, NestJS, etc.
- **Frontend:** HTML templates, React, Vue, Svelte — i.e., does coolhand-js apply?
- **Package manager:** pip/poetry/pipenv, npm/yarn/pnpm, bundler
- **Database/ORM (if any):** Postgres+ActiveRecord, Postgres+SQLAlchemy, Postgres+Prisma, MySQL+..., SQLite+..., or none. Look for `database.yml`, `prisma/schema.prisma`, `alembic.ini`, `models.py` with `db.Model`, etc. **This matters for the Phase 5 dispatch — `self-hosted-feedback` requires a DB.**

---

### Phase 3: Feedback Strategy Design

For each AI workflow found, design a strategy covering matching, signal quality, and creator identity.

#### Matching (linking feedback to the original LLM call)

Use the best available option, in priority order. **At least one of `client_unique_id` or `original_output` must accompany every feedback submission as a backstop.** The top two are upgrades when available.

1. **`llm_request_log_id`** *(best)* — available if the Coolhand server SDK is installed and auto-monitoring calls. The SDK captures this ID on each response automatically. Adding the SDK gives you this for free going forward.

2. **`llm_provider_unique_id`** *(second best)* — the `x-request-id` header returned by the LLM provider. Capture it from the response and store it alongside the output so it can be included when feedback is submitted later.
   - OpenAI (Python): `response.response_headers.get('x-request-id')`
   - OpenAI (Node): `response.headers.get('x-request-id')`
   - Anthropic: `response.headers.get('x-request-id')` (or `response.request_id` via SDK)
   - Ruby: `response.headers['x-request-id']`

3. **`client_unique_id`** *(backstop, always send)* — a unique ID from your own system for this request, session, conversation, or task. Something you can look up if needed. Acceptable forms: a hashed primary key, a session UUID, a conversation/job ID — any string that uniquely identifies this LLM run end-to-end.

4. **`original_output`** *(backstop, always send when available)* — the verbatim text the LLM produced, used for fuzzy matching when the upstream IDs aren't available. Should match (in whole or part) what the user is reacting to.

**The floor rule:** do not submit feedback with neither (3) nor (4). If the call site has access to neither, fix the call site to capture one before adding feedback.

#### Signal Quality (what feedback to collect)

Design for the highest signal achievable, in priority order:

1. **`revised_output`** *(best)* — the user's edited version of the AI output. Look for any textarea, editor, or inline-edit interface where users refine AI-generated content. When the user saves, capture their version as `revised_output`.

2. **`explanation`** *(medium)* — a brief text description of why the output was good or bad. Only propose adding an explanation prompt if feedback is already being actively solicited; do not introduce new explanation UI without approval.

3. **`sentiment`** *(lowest signal, easiest passive)* — a string from the enum `"like"` / `"dislike"` / `"neutral"`. Look for existing binary signals: accept/reject (`"like"` / `"dislike"`), buy/skip (`"like"` / `"dislike"`), save/delete (`"like"` / `"dislike"`), copy/dismiss (`"like"` / `"dislike"`).

> **Note:** The v2 API still accepts the legacy `like` boolean for backward compatibility, but `sentiment` takes precedence when both are sent. New code should use `sentiment`.

#### Fields the skill explicitly does not use in v0.1

- `coolhand_fingerprint_id` — set automatically by the coolhand-js widget for cross-session correlation. Do not populate this from server-side code; the widget owns it.
- `parent_feedback_hashid` — chained feedback. Out of scope (see [issue #3](https://github.com/Coolhand-Labs/feedback-collection-skill/issues/3)).
- `focus_section` / `focus_range` — partial-feedback (text-range targeting). Out of scope (see [issue #3](https://github.com/Coolhand-Labs/feedback-collection-skill/issues/3)).
- `workload_hashid` — workload grouping. Out of scope (see [issue #4](https://github.com/Coolhand-Labs/feedback-collection-skill/issues/4)). Use `client_unique_id` to convey grouping intent.

#### creator_unique_id (CRITICAL — must be consistent)

Find the user identity available in scope (session user, auth token payload, request context, etc.).

**Never use as creator_unique_id:** email address, full name, username, phone number, SSN, government-issued ID, or any string that directly identifies a person.

**Always use an opaque, hashed, consistent ID:**

Ruby:
```ruby
Digest::SHA256.hexdigest(current_user.id.to_s)
```

Python:
```python
import hashlib
hashlib.sha256(str(user_id).encode()).hexdigest()
```

Node.js:
```javascript
const crypto = require('crypto');
crypto.createHash('sha256').update(String(userId)).digest('hex');
```

**Consistency check:** Scan all identified feedback points — they must all use the same user object and the same hashing approach. If different parts of the codebase use different user fields or different ID sources, flag this prominently and propose a single canonical approach before implementing anything.

#### Passive vs. Active Collection

**Prefer passive first** — collect feedback from events that already happen without any UI change:

- User purchases an AI-recommended product → `sentiment: "like"`
- User accepts an AI-generated draft without editing → mild positive signal (omit `sentiment`, or `"like"` depending on context)
- User deletes or dismisses AI output → `sentiment: "dislike"`
- User edits AI output and saves → send their version as `revised_output`
- User retries or regenerates → `sentiment: "dislike"`

Passive changes need no UI approval. Plan and implement them first.

**Active (UI) collection** — only when passive signals are insufficient or the workflow has no natural downstream signal:

- Preference: the coolhand-js widget. Add a `coolhand-feedback` attribute to the element displaying AI output.
- Place the widget adjacent to (never overlapping) the AI output. Avoid covering other UI elements.
- Do not create new pages, separate screens, or modal dialogs solely for feedback.
- **Always present the exact UI change to the user for approval before implementing it.** Describe what element will get the widget and show the diff.

---

### Phase 4: Proposal

Present a clear, scannable proposal before touching any code:

```
━━━ FEEDBACK COLLECTION PLAN ━━━

WORKFLOWS FOUND
───────────────
1. [Descriptive name] — [file:line]
   Signal:   [revised_output | explanation | sentiment] ([how it's captured])
   Match:    [field name] ([how it's obtained])
   Backstop: client_unique_id=[source] / original_output=[source]
   Type:     PASSIVE — no UI changes needed

2. [Descriptive name] — [file:line]
   Signal:   sentiment: "like"/"dislike" ([event that triggers it])
   Match:    client_unique_id ([what ID])
   Backstop: original_output=[source]
   Type:     ACTIVE ⚠️  — coolhand-js widget on [element description]
             Needs your approval before implementing

CREATOR_UNIQUE_ID
─────────────────
  Proposed: SHA-256 of [which user field] — consistent across all feedback points
  [Flag any inconsistency found across the codebase]

SUMMARY
───────
  Passive: [N] workflow(s) — no UI changes
  Active:  [N] workflow(s) — UI changes need approval
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

After presenting, ask:
> "Does this look right? Any adjustments before I pick the implementation path?"

Wait for confirmation before Phase 5.

---

### Phase 5: Pick implementation path — managed or self-hosted

Once the user confirms the plan, ask:

> "Two ways to receive these logs and feedback:
>
> **Managed Coolhand** — install the Coolhand SDKs and let coolhandlabs.com receive the data. Fastest to set up, includes the Coolhand analytics dashboard. Recommended unless you have privacy/compliance/data-residency requirements that rule out third-party storage.
>
> **Self-hosted** — scaffold matching endpoints on your own backend; the SDKs will POST to your host instead of coolhandlabs.com. Requires a database in this project (I see [detected DB or 'none' from Phase 2]). You own the data; you also own analysis.
>
> Which would you like?"

Dispatch based on the answer:

- **"managed" / "Coolhand" / "default"** → invoke the `coolhand-integration` skill.
- **"self-hosted" / "self-host" / "own backend"** → invoke the `self-hosted-feedback` skill.
  - If Phase 2 found no DB and the user picks self-host, push back: explain that without a DB they have nowhere to store the data, and recommend starting on managed Coolhand with the option to migrate later.
  - **Honest caveat to share with the user:** the v2 API does not yet expose export endpoints (see [issue #5](https://github.com/Coolhand-Labs/feedback-collection-skill/issues/5)), so today "migrate later" means starting fresh in self-host with no historical data carried over. The user should know this before deciding.
- **"both" or unclear** → ask the user to pick one for v0.1; the other can be wired up later.

Each implementation skill picks up the proposal context and the strategy. The planner is done after dispatch.

---

### Phase 6: Issue Reporting

If the user reports a bug, unexpected behavior, or limitation with any Coolhand package or this skill:

1. Ask: "Would you like me to draft a GitHub issue for the [package] repository?"
2. If yes, draft an issue with:
   - **Title:** Concise one-line description of the problem
   - **Body:** Steps to reproduce, expected behavior, actual behavior, SDK version, language + framework + version
   - **No sensitive information:** Remove API keys, user data, internal hostnames, company-specific details
3. Show the full draft to the user for review before they submit it
4. Provide the correct "New Issue" URL:
   - coolhand-js: https://github.com/Coolhand-Labs/coolhand-js/issues/new
   - coolhand-node: https://github.com/Coolhand-Labs/coolhand-node/issues/new
   - coolhand-python: https://github.com/Coolhand-Labs/coolhand-python/issues/new
   - coolhand-ruby: https://github.com/Coolhand-Labs/coolhand-ruby/issues/new
   - This skill: https://github.com/Coolhand-Labs/feedback-collection-skill/issues/new
5. Do not submit the issue yourself — show the draft and link, let the user file it.
