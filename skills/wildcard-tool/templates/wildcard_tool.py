# wildcard_tool.py — agent-side "complaint box" for stuck AI agents.
#
# When your agent gets stuck (failed tool call, wrong data, missing capability)
# it calls `wildcard(...)`. The call is logged either to Coolhand (if
# COOLHAND_API_KEY is set) or appended to .wildcard-feedback.jsonl in the
# current working directory (zero-config fallback). The agent always receives
# the same response string so it continues with what it has.
#
# Wiring into an Anthropic SDK agent loop:
#
#     from wildcard_tool import wildcard
#
#     tools = [
#         {
#             "name": "wildcard",
#             "description": wildcard.__doc__.strip(),
#             "input_schema": {
#                 "type": "object",
#                 "properties": {
#                     "task_description":          {"type": "string"},
#                     "tool_or_capability_needed": {"type": "string"},
#                     "last_tool_called":          {"type": "string"},
#                     "error_or_wrong_output":     {"type": "string"},
#                 },
#                 "required": ["task_description", "tool_or_capability_needed"],
#             },
#         },
#         # ... your other tools ...
#     ]
#
# In your tool-dispatch switch, when the agent calls `wildcard`, invoke
# `wildcard(**tool_call.input)` and pass the returned string back as the
# tool result.

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from typing import Optional

# The Coolhand v2 feedback endpoint. Single source of truth — swap here if
# Coolhand confirms a different production URL.
COOLHAND_FEEDBACK_URL = "https://coolhandlabs.com/api/v2/feedback"

FALLBACK_FILE = ".wildcard-feedback.jsonl"

_RESPONSE = (
    "Your feedback has been logged. The capability you need is not available "
    "right now. Please continue the task using only your existing tools, or "
    "ask the user for help if you cannot proceed."
)


def wildcard(
    task_description: str,
    tool_or_capability_needed: str,
    last_tool_called: Optional[str] = None,
    error_or_wrong_output: Optional[str] = None,
) -> str:
    """Use this tool when you are stuck: when a tool call failed, returned
    incomplete or wrong data, or when you need a capability that does not
    exist in your current tool set. Tell this tool what you were trying to
    do, what went wrong, and what you need. This tool will log your feedback
    and tell you how to proceed."""

    payload = {
        "client_unique_id": str(uuid.uuid4()),
        "creator_unique_id": "wildcard-agent",
        "collector": "wildcard-tool-v0.1.0",
        "sentiment": "dislike",
        "explanation": (
            f"Task: {task_description}\n"
            f"Missing: {tool_or_capability_needed}\n"
            f"Last tool: {last_tool_called or 'n/a'}\n"
            f"Error: {error_or_wrong_output or 'n/a'}"
        ),
    }

    api_key = os.environ.get("COOLHAND_API_KEY")
    if api_key:
        _post_to_coolhand(payload, api_key)
    else:
        _append_to_fallback(payload)

    return _RESPONSE


def _post_to_coolhand(payload: dict, api_key: str) -> None:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        COOLHAND_FEEDBACK_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10):
            pass
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        # Never fail the agent on a network hiccup. The response string is
        # the contract; logging is best-effort.
        print(f"[wildcard] coolhand POST failed: {exc}", file=sys.stderr)


def _append_to_fallback(payload: dict) -> None:
    try:
        with open(FALLBACK_FILE, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload) + "\n")
    except OSError as exc:
        print(f"[wildcard] fallback write failed: {exc}", file=sys.stderr)
