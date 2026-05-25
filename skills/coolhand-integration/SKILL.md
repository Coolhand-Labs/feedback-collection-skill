---
name: coolhand-integration
description: |
  Use when the user has confirmed they want the managed Coolhand backend at
  coolhandlabs.com (rather than self-hosting). Triggers from the
  feedback-collection planner skill at Phase 5 dispatch when the user picks
  "managed" / "Coolhand" / "default". Also use when the user directly says
  "set up Coolhand," "install the Coolhand SDK," or asks for a Coolhand API
  key flow.
version: 0.2.0
---

# Coolhand Integration (Managed)

Install the Coolhand server SDK and (optionally) the coolhand-js widget against the managed `coolhandlabs.com` backend, using the strategy approved by the planner skill in Phase 4.

This skill assumes:
- The planner has already produced an approved feedback strategy (matching, signal, `creator_unique_id` rules).
- `COOLHAND_API_KEY` is set in `.env*` (the planner's Phase 0 gate already enforced this).

If those assumptions don't hold, route the user back to the planner first.

## Rationalizations to resist

These three guardrails bite hardest at implementation time. The full discussion lives in the planner; recap here so they're present at the moment of temptation:

| Excuse | Counter |
|---|---|
| "The user ID is internal-only / non-PII, hashing is overkill." | Hash anyway. SHA-256 of the internal ID, every time. No exceptions. |
| "We approved the widget once; this next placement is similar." | Every UI change gets its own diff and its own sign-off. Approved one ≠ approved all. |
| "API key is missing; the user is in a hurry; I'll wire up and they can fill it in later." | Stop. Wait for the key. Implementing without it produces silent send failures at runtime. |

If you find yourself constructing a fourth rationalization, surface it to the user instead of acting on it.

## CLI troubleshooting

If any `coolhand` CLI call is not found or behaves unexpectedly, run `npm install -g coolhand-cli` (or `npx coolhand-cli <command>` for a zero-install one-shot) and retry. See https://github.com/Coolhand-Labs/coolhand-cli for full install instructions.

## Phase A: Fetch current SDK READMEs

Implementation details (auto-monitoring entry points, configuration syntax) drift between SDK versions. Before writing code, fetch the README from the SDK(s) the user's stack needs:

- https://raw.githubusercontent.com/Coolhand-Labs/coolhand-node/main/README.md
- https://raw.githubusercontent.com/Coolhand-Labs/coolhand-python/main/README.md
- https://raw.githubusercontent.com/Coolhand-Labs/coolhand-ruby/main/README.md
- https://raw.githubusercontent.com/Coolhand-Labs/coolhand-js/main/README.md (only if active UI was approved)

If a fetch fails, fall back to https://coolhandlabs.com/docs.

## Phase B: Install the server SDK

Reference the README from Phase A for current package names and install commands. General patterns:

Ruby — add to `Gemfile`, then `bundle install`:
```ruby
gem 'coolhand'
```

Python — add to `requirements.txt` or `pyproject.toml`, then `pip install` / `poetry add`:
```
coolhand
```

Node.js:
```bash
npm install coolhand-node
```

## Phase C: Configure the SDK

Use the current README syntax — configuration APIs change between SDK versions. General patterns:

Ruby (`config/initializers/coolhand.rb` for Rails, or app boot setup):
```ruby
require 'coolhand'
Coolhand.configure do |config|
  config.api_key = ENV['COOLHAND_API_KEY']
end
```

Python (auto-init from `COOLHAND_API_KEY`; explicit construction optional):
```python
import coolhand
# or:
from coolhand import Coolhand
client = Coolhand(api_key=os.environ['COOLHAND_API_KEY'])
```

Node.js:
```javascript
import 'coolhand-node/auto-monitor';
// or:
import { initializeGlobalMonitoring } from 'coolhand-node';
await initializeGlobalMonitoring({ apiKey: process.env.COOLHAND_API_KEY });
```

The SDK's `base_url` is left at its default (`https://coolhandlabs.com`); the SDK will route to managed Coolhand automatically.

## Phase D: Implement feedback calls

Always include in every feedback call:

- `collector: "<your-app-slug>-manual"` — replace `<your-app-slug>` with a slug identifying this integration. Helps Coolhand analytics distinguish your data.
- `creator_unique_id` — the SHA-256 hashing pattern from the planner's Phase 3.
- The best available matching field (`llm_request_log_id` if SDK auto-monitor is on — see `../feedback-collection/detection-patterns/providers.yml` → `server_sdk_log_id_extraction` for per-language access patterns; otherwise `llm_provider_unique_id` — see `../feedback-collection/source_apis.yml` for the field name per provider and `../feedback-collection/detection-patterns/providers.yml` → `request_id_extraction` for per-language snippets).
- **At least one of `client_unique_id` or `original_output`** — the floor rule from the planner's Phase 3 applies in implementation, not just in planning. Both is better than one when both are available. If using `original_output`, it must be the raw response content before any transformation (see Phase 3 item #4).
- The highest achievable signal field (`revised_output` > `explanation` > `sentiment`).
- For binary signals, use `sentiment` (`"like"` / `"dislike"` / `"neutral"`), not the deprecated `like` boolean.

## Phase E: For approved active (UI) collection only

Only run this phase if the planner's Phase 4 proposal flagged active UI changes that the user approved.

Add coolhand-js. Use the README from Phase A for the current CDN URL and npm package. General pattern:

Via CDN (place before `</body>`):
```html
<script src="https://cdn.jsdelivr.net/npm/coolhand@latest/dist/coolhand.min.js"></script>
<script>
  CoolhandJS.init('YOUR_PUBLIC_API_KEY', {
    clientUniqueId: USER_HASH_HERE,
    widgetStyle: 'overlay'
  });
</script>
```

On any element displaying AI output:
```html
<div coolhand-feedback>{{ ai_generated_content }}</div>
```

Notes:
- `CoolhandJS.init` takes the **public** API key (safe to embed in frontend code), not the server-side private key.
- The widget sets its own `coolhand_fingerprint_id` for cross-session correlation. Do not pass `coolhandFingerprintId` from server code; the widget owns that field.

## Phase F: Private key and optimization tools (optional)

Only proceed with this phase if the user wants to call Coolhand's optimization tools — searching, reviewing, commenting on, or acting on optimizations. Skip if the workflow only needs log ingest and feedback submission.

### F.1 — Obtain the private key

The optimization commands require a private key (`ch_priv_*`), stored separately from the public key (`ch_pub_*`) used by the server SDK.

If `COOLHAND_PRIVATE_KEY` is not already set in the user's env file, ask which file to write it to — use the same path where `COOLHAND_API_KEY` was written in Phase 0, or ask the user if that path isn't known. Then run:

```bash
coolhand login --scope private --write-env <path>
# npx coolhand-cli login --scope private --write-env <path>
```

The browser opens to the Coolhand authorization page with a **red "Private API Key Request" banner**. The user must check two confirmation boxes. The CLI writes both keys to the same env file:

```
COOLHAND_API_KEY=ch_pub_...       # server SDK and log ingest (unchanged)
COOLHAND_PRIVATE_KEY=ch_priv_...  # optimization commands only
```

Security rule: `COOLHAND_PRIVATE_KEY` must never appear in frontend code or be committed to source control. The `coolhand-js` widget and the server SDK use only `COOLHAND_API_KEY`.

### F.2 — Run optimization commands via the CLI

All optimization operations are available as `coolhand` subcommands. Run `coolhand help <command>` for the full flag reference.

| CLI command | What it does |
|---|---|
| `coolhand search-optimizations` | List and filter optimizations (status, type, category, text, date range) |
| `coolhand get-optimization <id>` | Full detail including analysis, plan, comments, and orchestrator history |
| `coolhand add-optimization-comment <id> <comment>` | Append a human-feedback comment (≥ 20 chars) |
| `coolhand close-optimization <id> <reason>` | Dismiss a draft/proposed optimization with ≥ 50-char explanation |
| `coolhand create-optimization` | Create a new draft optimization |
| `coolhand update-optimization <id>` | Enrich a draft with title, analysis, and implementation plan |

Each command reads `COOLHAND_PRIVATE_KEY` from the environment or from `~/.coolhand/config.json`. If the key is missing, the CLI exits with a clear error pointing to `coolhand login --scope private`.

### F.3 — CLI upgrade (if subcommands are missing)

If `coolhand help` does not list `search-optimizations`, the CLI predates these subcommands (requires v0.2.0+). Upgrade and retry:

```bash
npm install -g coolhand-cli@latest
# or: npx coolhand-cli@latest <command>
```

See https://github.com/Coolhand-Labs/coolhand-cli for full install instructions.

## Phase G: Post-implementation checklist

After implementing, remind the user:

- [ ] `creator_unique_id` is consistent across every feedback submission (same hash, same source field).
- [ ] No PII appears in `creator_unique_id` (no emails, names, government IDs).
- [ ] At least one of `client_unique_id` or `original_output` accompanies every feedback call (the floor rule).
- [ ] If the coolhand-js widget was added: verify visually in a browser that placement does not overlap other UI elements.
- [ ] Sentiment uses the string enum (`"like"`/`"dislike"`/`"neutral"`), not the deprecated boolean.
- [ ] The Coolhand server SDK auto-monitor is active so future LLM calls automatically populate `llm_request_log_id`.
- [ ] If `COOLHAND_PRIVATE_KEY` was configured: confirm it is absent from every frontend bundle and not committed to source control.
