## Shared detection references

Two files in the `feedback-collection` skill are the canonical source for
provider-specific details. The planner and the two implementation skills
(the skills that opt into this shared prose) reference them:

- **`skills/feedback-collection/source_apis.yml`**: the response-ID field name
  and an example value for each LLM provider. Use it to capture
  `llm_provider_unique_id` from the raw response object, before any output
  transformation.
- **`skills/feedback-collection/detection-patterns/providers.yml`**: provider
  and SDK detection patterns plus per-language extraction snippets. Use
  `request_id_extraction` for `llm_provider_unique_id` and
  `server_sdk_log_id_extraction` for `llm_request_log_id`.

When a phase below needs a provider's field name or an extraction snippet, read
these files rather than guessing.

## Coolhand Help Center

For questions about how Coolhand behaves (what it records per provider, feedback
matching, partial/chained feedback, log fields, SDK best practices), do not answer
from memory. Fetch `https://coolhandlabs.com/help.md`: an index of every article
with a one-line summary and a per-article `.md` URL. Pick the relevant article and
fetch that. For the raw API reference, use `https://coolhandlabs.com/docs`.

## Using the latest coolhand-cli

Always use the latest `coolhand-cli`. Run `npx coolhand-cli@latest <command>` for a
zero-install one-shot, or `npm install -g coolhand-cli@latest` for a persistent
install. Check the installed version with `coolhand --version`; if a command is
missing or behaves unexpectedly, upgrade before assuming a bug.

`coolhand help` lists every command and `coolhand help <command>` is the
authoritative flag reference. Do not guess flags. Command groups:

- **Auth:** `login`, `logout`, `status`, `whoami`, `clients`. `--client-id ID` (or
  `COOLHAND_CLIENT_ID`) selects a stored client. `login --scope private` also
  provisions the private key.
- **Optimizations:** `search-optimizations`, `get-optimization`,
  `update-optimization`, `close-optimization`.
- **Feedback, logs, templates, workloads:** `search-feedback`, `get-feedback`,
  `search-logs`, `fetch-log`, `search-templates`, `get-template`, `list-workloads`,
  `get-workload`, `update-workload`.
- **Capture:** `claude` and `monitor` run a CLI through the Coolhand proxy to
  capture its LLM calls.
- **Agent complaint box:** `wildcard` (aliases `complaint-box`, `report-blocker`).
- **Claude session tooling:** `analyze-claude-sessions`, `map-claude-projects`,
  `sync-skills`, `upload-client-file`, `search-referenced-files`,
  `list-referenced-file-sessions`.

Commands that read data (`search-feedback`, `get-feedback`, the optimization and
template commands) require the private key, `COOLHAND_PRIVATE_KEY`. It is for
server-side and CLI use only, never frontend code.
