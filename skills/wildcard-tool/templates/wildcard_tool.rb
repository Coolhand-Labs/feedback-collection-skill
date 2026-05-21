# wildcard_tool.rb — agent-side "complaint box" for stuck AI agents.
#
# When your agent gets stuck (failed tool call, wrong data, missing capability)
# it calls WildcardTool.wildcard(...). The call is logged either to Coolhand
# (if COOLHAND_API_KEY is set) or appended to .wildcard-feedback.jsonl in the
# current working directory (zero-config fallback). The agent always receives
# the same response string so it continues with what it has.
#
# Wiring into a Ruby Anthropic agent loop:
#
#     require_relative "wildcard_tool"
#
#     tools = [
#       {
#         name: "wildcard",
#         description: WildcardTool::DESCRIPTION,
#         input_schema: {
#           type: "object",
#           properties: {
#             task_description:          { type: "string" },
#             tool_or_capability_needed: { type: "string" },
#             last_tool_called:          { type: "string" },
#             error_or_wrong_output:     { type: "string" },
#           },
#           required: %w[task_description tool_or_capability_needed],
#         },
#       },
#       # ... your other tools ...
#     ]
#
#     # In your tool-dispatch switch:
#     if tool_use.name == "wildcard"
#       result = WildcardTool.wildcard(**tool_use.input.transform_keys(&:to_sym))
#       # pass `result` back as the tool result content
#     end

require "json"
require "net/http"
require "securerandom"
require "uri"

module WildcardTool
  # The Coolhand v2 feedback endpoint. Single source of truth — swap here if
  # Coolhand confirms a different production URL.
  COOLHAND_FEEDBACK_URL = "https://coolhandlabs.com/api/v2/feedback"

  FALLBACK_FILE = ".wildcard-feedback.jsonl"

  DESCRIPTION = (
    "Use this tool when you are stuck: when a tool call failed, returned " \
    "incomplete or wrong data, or when you need a capability that does not " \
    "exist in your current tool set. Tell this tool what you were trying " \
    "to do, what went wrong, and what you need. This tool will log your " \
    "feedback and tell you how to proceed."
  ).freeze

  RESPONSE = (
    "Your feedback has been logged. The capability you need is not " \
    "available right now. Please continue the task using only your " \
    "existing tools, or ask the user for help if you cannot proceed."
  ).freeze

  def self.wildcard(task_description:, tool_or_capability_needed:,
                    last_tool_called: nil, error_or_wrong_output: nil)
    payload = {
      client_unique_id: SecureRandom.uuid,
      creator_unique_id: "wildcard-agent",
      collector: "wildcard-tool-v0.1.0",
      sentiment: "dislike",
      explanation: [
        "Task: #{task_description}",
        "Missing: #{tool_or_capability_needed}",
        "Last tool: #{last_tool_called || 'n/a'}",
        "Error: #{error_or_wrong_output || 'n/a'}",
      ].join("\n"),
    }

    api_key = ENV["COOLHAND_API_KEY"]
    if api_key && !api_key.empty?
      post_to_coolhand(payload, api_key)
    else
      append_to_fallback(payload)
    end

    RESPONSE
  end

  def self.post_to_coolhand(payload, api_key)
    uri = URI.parse(COOLHAND_FEEDBACK_URL)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = (uri.scheme == "https")
    http.open_timeout = 5
    http.read_timeout = 10

    request = Net::HTTP::Post.new(uri.request_uri,
      "Content-Type" => "application/json",
      "X-API-Key"    => api_key)
    request.body = JSON.generate(payload)

    http.request(request)
  rescue StandardError => e
    # Never fail the agent on a network hiccup. The response string is the
    # contract; logging is best-effort.
    warn("[wildcard] coolhand POST failed: #{e.class}: #{e.message}")
  end

  def self.append_to_fallback(payload)
    File.open(FALLBACK_FILE, "a") do |fh|
      fh.write(JSON.generate(payload))
      fh.write("\n")
    end
  rescue StandardError => e
    warn("[wildcard] fallback write failed: #{e.class}: #{e.message}")
  end

  private_class_method :post_to_coolhand, :append_to_fallback
end
