# Project conventions for Claude

This file captures conventions Claude should follow when editing this repo.

## Repo layout

```
.
├── .claude-plugin/
│   ├── plugin.json              # Claude Code plugin manifest
│   └── marketplace.json         # Single-plugin marketplace manifest
├── .github/workflows/
│   ├── validate-patterns.yml    # CI: runs bin/validate-patterns on PRs
│   ├── check-skill-urls.yml     # CI: runs bin/check-skill-urls on PRs + weekly cron
│   └── check-trusted-urls.yml   # CI: runs bin/check-trusted-urls on every PR
├── .trusted-urls.yml            # Allowlist of URL prefixes permitted anywhere in repo
├── bin/
│   ├── validate-patterns        # Ruby stdlib — validates detection YAML
│   ├── check-skill-urls         # Bash + curl — verifies every URL in skills/**/*.md is alive
│   ├── check-trusted-urls       # Ruby stdlib — enforces .trusted-urls.yml across the repo
│   └── refresh-openapi-snapshot # Python stdlib — refreshes the v2 OpenAPI snapshot; --check mode for runtime drift detection
├── skills/
│   ├── feedback-collection/     # Planner: scans, designs strategy, dispatches
│   │   ├── SKILL.md
│   │   ├── source_apis.yml      # Per-provider response ID field names and example values
│   │   └── detection-patterns/
│   │       └── providers.yml    # Provider/SDK detection patterns + per-language extraction snippets
│   ├── coolhand-integration/    # 3a: install SDKs against managed coolhandlabs.com
│   │   └── SKILL.md
│   └── self-hosted-feedback/    # 3b: scaffold endpoints on user's own backend
│       ├── SKILL.md
│       └── references/
│           ├── api-spec.md                       # Wire format + SQL schemas for self-hosted
│           ├── coolhand-openapi-v2.json          # Snapshot of the v2 spec (canonical form)
│           └── coolhand-openapi-v2.meta.json     # Snapshot metadata: timestamp + SHA-256 + source URL
├── CHANGELOG.md
├── CLAUDE.md                    # This file
├── LICENSE                      # Apache-2.0
└── README.md
```

**One plugin, three skills.** The plugin (`feedback-collection`) ships three skills under `skills/`. The planner (`feedback-collection`) is the user-facing entry point and dispatches to either implementation skill (`coolhand-integration` or `self-hosted-feedback`) at its Phase 5. None of the three skills is independently useful — install the plugin and all three load together.

Each skill's frontmatter `name` must match its directory name under `skills/`. Out-of-sync names break skill discovery silently.

**Architecture rules:**
- The planner does not install SDKs, write endpoints, or touch UI. It scans, designs, proposes, and dispatches.
- The two implementation skills assume the planner has already produced an approved strategy. If a user invokes one directly without the planner, the implementation skill should route them back to the planner first.
- Shared resources (`detection-patterns/providers.yml`, the OpenAPI spec snapshot, the rationalizations table) live with the skill that owns them and are referenced by sibling skills via relative paths in their SKILL.md.

## SKILL.md description field

`SKILL.md`'s frontmatter `description` must contain **triggering conditions only** — symptoms, situations, slash-command aliases, package names. Do **not** summarize the skill's workflow or phases.

**Why:** When the description summarizes the skill's process, Claude treats the summary as a sufficient briefing and skips reading the body. Eval evidence from the superpowers skills library shows skills with workflow summaries get partial-compliance behavior; skills with trigger-only descriptions get full body-reading and phase-following behavior.

**How to apply:** Every line of the description should answer "should I load this skill right now?" not "what does this skill do?". Test by asking: if I deleted the SKILL.md body and kept only the description, would Claude still know what to do? If yes, the description has too much workflow. Strip it.

## Detection patterns (`skills/feedback-collection/detection-patterns/providers.yml`)

Adding or updating LLM provider detection is a YAML edit, not a SKILL.md edit.

**Schema** (enforced by `bin/validate-patterns`):

- Top-level required keys: `version`, `description`, `sdk_imports`, `inference_calls`, `http_inference_hosts`, `existing_coolhand`, `existing_feedback_ui`, `request_id_extraction`.
- `sdk_imports` is a hash with keys `python`, `node`, `ruby`. Each maps to a list of non-empty strings. Every language key must be present (use an empty array if a provider has no entry for that language — but the language key itself must exist).
- `inference_calls`, `http_inference_hosts`, `existing_coolhand`, `existing_feedback_ui` are non-empty lists of non-empty unique strings.
- `request_id_extraction` is a hash keyed by provider; values are hashes mapping language → extraction snippet.

**Required before committing any change to a YAML file under `detection-patterns/`:** run `bin/validate-patterns` and `bin/validate-patterns --self-test`. Both must exit 0. CI runs the same two commands and will block PRs with broken YAML, missing keys, empty patterns, or duplicate entries.

**When to add a provider:** any new LLM provider that has a Python, Node, or Ruby SDK and a public REST API. List import patterns for every language with a first-party SDK; list inference call methods that are stable across SDK versions; list the HTTP host (without scheme) for direct-HTTP detection.

**Don't:**
- Add regex syntax to pattern strings — these are substring matches, not regexes. The validator does not compile them.
- Inline a new provider into SKILL.md instead of the YAML. Phase 1 of the skill points at the YAML; SKILL.md inlining will drift.

## Rationalizations to resist (in SKILL.md)

The "Rationalizations to resist" section in SKILL.md is the skill's compliance shield. It enumerates excuses an agent will use to bypass the three hardest guardrails (PII in `creator_unique_id`, per-UI-change approval, the API-key prerequisite).

**When to add a new rationalization:** when a real session shows an agent inventing a new excuse to bypass a guardrail. Include the excuse verbatim and the counter. Do not add hypothetical rationalizations — the section grows from observed failures, not imagination.

**Don't soften existing entries.** The section is deliberately blunt because pressure-testing has shown polite hedging is rationalized through. If you find an entry abrasive, leave it; the abrasiveness is doing work.

## Trusted URL policy (`.trusted-urls.yml`, `bin/check-trusted-urls`)

Every `http://` or `https://` reference in this repo must start with a prefix listed in `.trusted-urls.yml`. The allowlist is split into two sections:

- **`coolhand:`** — first-party trust core. Coolhand-owned domains and the `Coolhand-Labs` GitHub org. Adding to this section is uncontroversial; adding to it should still be done in a reviewed commit.
- **`infrastructure:`** — non-Coolhand URLs that the repo legitimately depends on (Apache license boilerplate, the Claude Code download link, the canonical coolhand-js CDN, RFC-reserved test fixtures). Each entry has an inline comment justifying it. **Adding a new infrastructure prefix is the equivalent of taking a dependency** — review with the same care.

`bin/check-trusted-urls` scans every text file in the repo (excluding `.git/`, `node_modules/`, `vendor/`, `tmp/`, `.bundle/`) and fails if any URL doesn't match an allowed prefix. CI runs it on every PR. The script's own self-test (`--self-test`) writes fixture files to a tmpdir and asserts the matcher accepts allowed URLs and rejects un-allowed ones — the violation-fixture URL is built via string concatenation so the script's own source contains no URL literal that would otherwise be flagged.

**Before adding a URL anywhere in this repo:**

1. Is the host already covered by a `coolhand:` prefix? If so, just add the URL.
2. If not, can the URL be removed entirely (e.g., a citation that reads fine as prose)? Prefer that.
3. If the URL is genuinely required, add a prefix to `.trusted-urls.yml` under `infrastructure:` with an inline comment explaining why.

Run locally:

```
bin/check-trusted-urls --self-test
bin/check-trusted-urls
```

## URL liveness (`bin/check-skill-urls`)

Every `SKILL.md` and every `references/*.md` referenced by a skill contains URLs that Claude follows at runtime — SDK READMEs the skill fetches, GitHub issue endpoints it points the user at, deferred-scope tracking links, the docs site, the canonical CDN. When any of these rot, the skill silently degrades — fetches fall back to alternates, links go to 404. The script `bin/check-skill-urls` GETs every `https://` URL across every `skills/**/SKILL.md` and `skills/**/references/*.md`, and fails on any 4xx/5xx or DNS failure. CI runs it on PRs that touch those files and on a weekly cron so rot is caught even when nobody is editing.

Scope is intentionally narrow: markdown only. JSON/YAML references (the OpenAPI snapshot, the detection-patterns YAML) are excluded because they may contain third-party example URLs that aren't ours to monitor. URLs in `README.md`, top-level `CLAUDE.md`, and `CHANGELOG.md` are human-facing and not consulted at runtime — also out of scope here. The trusted-URL check (`bin/check-trusted-urls`) covers those instead.

The script is Bash, not Ruby. The whole job is "loop, curl, check exit code" — Bash with curl is shorter and clearer than Net::HTTP for this. The `validate-patterns` script stays in Ruby because it parses YAML and runs structural assertions, where Ruby's standard library is the right fit.

Run locally before committing changes to `SKILL.md`:

```
bin/check-skill-urls --self-test
bin/check-skill-urls
```

## OpenAPI snapshot freshness (`bin/refresh-openapi-snapshot`)

`skills/self-hosted-feedback/references/coolhand-openapi-v2.json` is a snapshot of the Coolhand v2 OpenAPI spec from coolhandlabs.com/docs. It's the source of truth for 3b's scaffolding because it gives deterministic output, works offline, and is reviewable in PRs.

**Canonicalization.** The snapshot is stored as `json.dumps(spec, sort_keys=True, indent=2, ensure_ascii=False)` plus a trailing newline. The hash in `coolhand-openapi-v2.meta.json` is SHA-256 of those UTF-8 bytes. Any tool that re-extracts the spec from upstream and produces a comparable hash must use the same canonicalization, or the comparison will report spurious drift.

**Refreshing the snapshot (maintainer task).**

```
bin/refresh-openapi-snapshot
```

Re-fetches the spec from coolhandlabs.com/docs, extracts it, writes the canonical JSON to `coolhand-openapi-v2.json`, and updates the meta sidecar with today's date and the new hash. Commit both files together. Mention the diff in `CHANGELOG.md` so reviewers know the snapshot changed (and ideally, a one-line summary of what changed at the schema level).

**Runtime drift detection.**

```
bin/refresh-openapi-snapshot --check
```

Fetches upstream and compares hashes without writing anything. Used by 3b's Phase A. Exit codes: 0 = match, 1 = drift, 2 = fetch error. Output line is one of `MATCH:`, `DRIFT:`, or `FETCH-ERROR:`.

Drift detection runs only on user consent — 3b's Phase A asks before fetching so users on firewalled networks (a real share of self-hosted users) can decline without breaking the flow.

The script is Python because the spec extraction (brace-counting through Redoc's `__redoc_state` blob) is cleanest in Python's `re` + `json`, and Python is more universally installed than Ruby on developer machines.

## No language-specific instructions inline in SKILL.md

SKILL.md is a prompt — it is read at runtime by a language model. Inline language-specific details (per-SDK extraction snippets, per-language code samples, provider-keyed mappings) make it longer, harder to maintain, and drift-prone. When a task requires this kind of data, apply the following decision tree **before** writing anything inline:

1. **Is it static lookup data?** (provider IDs, extraction patterns, SDK import strings, inference call signatures, host names)
   → Put it in a lookup YAML and have the SKILL.md refer to that file by path and key. Two files cover most cases:
   - `detection-patterns/providers.yml` — SDK import patterns, inference call signatures, HTTP hosts, per-language extraction snippets. Validated by `bin/validate-patterns`.
   - `skills/feedback-collection/source_apis.yml` — per-provider response ID field names and example values. Add new providers here when the field name or example value is provider-specific.

2. **Is it operational logic that a CLI command could encapsulate?** (multi-step procedures, stateful operations, anything that could accept flags and return structured output)
   → Prefer `coolhand <subcommand>` per the CLI-first pattern. If no command exists yet, propose filing an issue at https://github.com/Coolhand-Labs/coolhand-cli rather than inlining the implementation.

3. **Neither fits cleanly?** → Consult the user before writing anything inline. Describe the trade-offs (YAML maintenance cost vs. CLI issue lag vs. inline drift) and let them decide.

**The test:** If adding the information requires listing the same thing once per language or once per provider, it belongs in YAML, not in SKILL.md.

## CLI-first pattern in SKILL.md

When writing skill instructions that involve an operation the `coolhand` CLI could perform, prefer a CLI invocation over inline implementation. This keeps SKILL.md token-efficient and puts the implementation spec where it can be versioned and maintained — the CLI's `--help` output.

**Preferred form:** `run \`coolhand <subcommand>\`` followed by a note that `--help` is the authoritative spec for that subcommand.

**If no CLI command exists for the needed operation:** ask the user whether to file a tracking issue on https://github.com/Coolhand-Labs/coolhand-cli before adding any inline implementation detail. Don't inline a protocol or script template as a workaround — that creates two specs to keep in sync. The ticket is the right place for the spec; the skill should just say "use `coolhand <subcommand>` once it ships."

## Versioning and CHANGELOG

- `plugin.json` and `marketplace.json` always track together — bump both in the same commit whenever the plugin is released.
- Each `SKILL.md` `version` field bumps only when that skill's content changes. Skills whose content is unchanged do not get a version bump even when the plugin version advances.
- Every change touching SKILL.md, the YAML schema, the validator, or the plugin manifests gets a CHANGELOG entry under `## Unreleased`. Cut a version section from `Unreleased` when publishing.
- CHANGELOG entries lead with the change, then a brief why. Mirror the style in `CHANGELOG.md`'s existing entries.

## Commits and PRs

- One concern per PR (skill content, schema, validator, manifests). Bundling unrelated changes makes review harder and breaks bisecting.
- Touching SKILL.md? Read the full file first — phases reference each other, and edits to one phase often need follow-up in another.
- Touching `detection-patterns/providers.yml`? Run the validator locally before pushing.
