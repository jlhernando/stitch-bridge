#!/bin/bash
# telegram-me hook v3 (multi-provider)

# Permission Hook for telegram-me (works with Claude Code and Gemini CLI)
#
# Claude: PreToolUse + PermissionRequest events
# Gemini: BeforeTool event
#
# Auto-approves in autonomous mode, notification otherwise.
# Relays thinking text to Telegram in both modes.

# Read the hook input from stdin
input=$(cat)

# Detect hook event type and provider.
# Both Claude Code and Gemini CLI now send hook_event_name, but with different values:
# - Gemini: BeforeTool, AfterTool
# - Claude: PreToolUse, PostToolUse, PermissionRequest
hook_event=$(echo "$input" | jq -r '.hook_event_name // empty')
if [ -n "$hook_event" ]; then
  hook_type="$hook_event"
else
  hook_type=$(echo "$input" | jq -r 'if has("permission") then "PermissionRequest" else "PreToolUse" end')
fi
# Gemini detection: use event name (BeforeTool/AfterTool) or GEMINI_PROJECT_DIR
is_gemini=false
case "$hook_type" in BeforeTool|AfterTool) is_gemini=true ;; esac
[ -n "$GEMINI_PROJECT_DIR" ] && is_gemini=true

# Extract tool name and input
tool_name=$(echo "$input" | jq -r '.tool_name // .permission // "Unknown"')
tool_input=$(echo "$input" | jq -r '.tool_input // {}')

AUTONOMOUS_FLAG="/tmp/telegram-me-autonomous.flag"
PERMISSION_PENDING="/tmp/telegram-me-permission.pending"
PERMISSION_RESPONSE="/tmp/telegram-me-permission.response"

# Load bot credentials from the current project's config (multi-provider)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${GEMINI_PROJECT_DIR:-$(dirname "$0")/../..}}"

try_config() {
  local cfg="$1"
  if [ -f "$cfg" ] && command -v jq &>/dev/null; then
    TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(jq -r '.mcpServers["telegram-me"].env.TELEGRAM_BOT_TOKEN // empty' "$cfg" 2>/dev/null)}"
    TELEGRAM_USER_ID="${TELEGRAM_USER_ID:-$(jq -r '.mcpServers["telegram-me"].env.TELEGRAM_USER_ID // empty' "$cfg" 2>/dev/null)}"
    [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_USER_ID" ] && return 0
  fi
  return 1
}
load_credentials() {
  # Check provider-specific config first, then fall back to others
  if [ "$is_gemini" = "true" ]; then
    try_config "$PROJECT_DIR/.gemini/settings.json" && return
    try_config "$PROJECT_DIR/.mcp.json" && return
  else
    try_config "$PROJECT_DIR/.mcp.json" && return
    try_config "$PROJECT_DIR/.gemini/settings.json" && return
  fi
  # Try .env (fallback)
  [ -f "$PROJECT_DIR/.env" ] && source "$PROJECT_DIR/.env"
}
load_credentials

# --- Thinking text relay: sends Claude's reasoning to Telegram ---
# Reads the session transcript, finds new assistant text since last check,
# and sends it to Telegram with 💭 prefix. Runs in background to not block hooks.
relay_thinking_text() {
  local session_id transcript_path
  session_id=$(echo "$input" | jq -r '.session_id // empty')
  transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')

  # Bail if missing data or no credentials
  if [[ -z "$session_id" || -z "$transcript_path" ]] || [ ! -f "$transcript_path" ]; then
    return
  fi

  # Share transcript path with MCP server for rate limit detection
  local bot_id="${TELEGRAM_BOT_TOKEN%%:*}"
  [ -n "$bot_id" ] && echo "$transcript_path" > "/tmp/telegram-me-transcript-${bot_id}.path"
  if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_USER_ID" ]]; then
    return
  fi

  # Sanitize session_id for safe use in file paths
  local safe_id="${session_id//[^a-zA-Z0-9_-]/}"
  local offset_file="/tmp/telegram-me-thinking-${safe_id}"
  local last_lines=0
  [ -f "$offset_file" ] && last_lines=$(cat "$offset_file")

  local total_lines
  total_lines=$(wc -l < "$transcript_path" | tr -d ' ')

  # Nothing new since last check
  [ "$total_lines" -le "$last_lines" ] && return

  # Extract new transcript lines once (reused for text + tool relays)
  local new_lines
  new_lines=$(tail -n +"$((last_lines + 1))" "$transcript_path")

  # Extract assistant text blocks as JSON array (Claude + Gemini formats)
  local texts_json
  texts_json=$(echo "$new_lines" | \
    jq -sc '[.[] | select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text]' 2>/dev/null)
  local count_check
  count_check=$(echo "$texts_json" | jq 'length' 2>/dev/null)
  if [ -z "$count_check" ] || [ "$count_check" = "0" ]; then
    # Try Gemini format: type == "gemini" with content[].text
    texts_json=$(echo "$new_lines" | \
      jq -sc '[.[] | select(.type == "gemini") | .content[]? | select(.type == "text") | .text]' 2>/dev/null)
  fi

  # Extract tool_use blocks as JSON array [{name, input}] (Claude + Gemini formats)
  local tools_json
  tools_json=$(echo "$new_lines" | \
    jq -sc '[.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | {name: .name, input: .input}]' 2>/dev/null)
  local tools_check
  tools_check=$(echo "$tools_json" | jq 'length' 2>/dev/null)
  if [ -z "$tools_check" ] || [ "$tools_check" = "0" ]; then
    tools_json=$(echo "$new_lines" | \
      jq -sc '[.[] | select(.type == "gemini") | .content[]? | select(.type == "tool_use") | {name: .name, input: .input}]' 2>/dev/null)
  fi

  # Update offset synchronously (prevents duplicate sends on next invocation)
  echo "$total_lines" > "$offset_file"

  # Send everything in background to avoid blocking the hook
  (
    # --- Relay text blocks (💭 prefix) ---
    local count
    count=$(echo "$texts_json" | jq 'length' 2>/dev/null)
    if [ -n "$count" ] && [ "$count" -gt 0 ]; then
      for ((i=0; i<count; i++)); do
        local text
        text=$(echo "$texts_json" | jq -r ".[$i]")

        # Skip empty/whitespace-only text
        [ -z "$(echo "$text" | tr -d '[:space:]')" ] && continue
        # Skip Telegram message echoes (already shown in chat)
        [[ "$text" == *"Telegram message received:"* ]] && continue

        # Trim leading/trailing whitespace and blank lines
        text=$(echo "$text" | sed '/^[[:space:]]*$/d' | sed '1s/^[[:space:]]*//;$s/[[:space:]]*$//')
        [ -z "$text" ] && continue

        # Truncate to fit Telegram's 4096 char limit (with room for 💭 prefix)
        if [ ${#text} -gt 4000 ]; then
          text="${text:0:3997}..."
        fi

        local escaped
        escaped=$(printf '💭 %s' "$text" | jq -Rs .)
        curl -s --connect-timeout 5 --max-time 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
          -H "Content-Type: application/json" \
          -d "{\"chat_id\": $TELEGRAM_USER_ID, \"text\": $escaped}" > /dev/null 2>&1
      done
    fi

    # --- Relay tool calls (🔧 prefix, batched into one message) ---
    local tool_count
    tool_count=$(echo "$tools_json" | jq 'length' 2>/dev/null)
    if [ -n "$tool_count" ] && [ "$tool_count" -gt 0 ]; then
      local tool_lines=""
      for ((j=0; j<tool_count; j++)); do
        local tname tdetail
        tname=$(echo "$tools_json" | jq -r ".[$j].name")

        # Skip noisy/internal tools
        case "$tname" in
          *get_user_message*|*health_check*|*notify_user*|*ask_user*|*edit_message*|*send_image*|*send_document*|*approve_plan*) continue ;;
        esac

        # Strip MCP server prefix for cleaner display (e.g. mcp__playwright__browser_click → browser_click)
        local short_name="${tname##*__}"

        # Extract the most meaningful input field
        tdetail=$(echo "$tools_json" | jq -r ".[$j].input | .file_path // .command // .pattern // .query // .url // .skill // .description // \"\" | tostring | .[0:80]" 2>/dev/null)

        if [ -n "$tdetail" ]; then
          tool_lines+="${short_name} → ${tdetail}"$'\n'
        else
          tool_lines+="${short_name}"$'\n'
        fi
      done

      # Send batched tool message if any tools passed the filter
      if [ -n "$tool_lines" ]; then
        local tool_msg
        tool_msg=$(printf '🔧 %s' "$tool_lines" | sed '$ { /^$/d; }')
        # Truncate if too long
        if [ ${#tool_msg} -gt 4000 ]; then
          tool_msg="${tool_msg:0:3997}..."
        fi
        local tool_escaped
        tool_escaped=$(printf '%s' "$tool_msg" | jq -Rs .)
        curl -s --connect-timeout 5 --max-time 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
          -H "Content-Type: application/json" \
          -d "{\"chat_id\": $TELEGRAM_USER_ID, \"text\": $tool_escaped}" > /dev/null 2>&1
      fi
    fi
  ) &
}

# --- Helper: output provider-appropriate auto-approve response ---
auto_approve() {
  if [ "$is_gemini" = "true" ]; then
    # Gemini format
    echo '{"decision":"allow"}'
  elif [ "$1" = "PermissionRequest" ]; then
    cat <<EOF
{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}
EOF
  else
    cat <<EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Auto-approved: telegram-me autonomous mode"}}
EOF
  fi
}

# --- Send tool notification to Telegram (background, non-blocking) ---
notify_tool() {
  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_USER_ID" ]; then return; fi
  # Skip noisy/internal tools
  case "$tool_name" in
    *get_user_message*|*health_check*|*notify_user*|*ask_user*|*edit_message*|*send_image*|*send_document*|*approve_plan*) return ;;
  esac
  local short_name="${tool_name##*__}"
  local detail
  detail=$(echo "$tool_input" | jq -r '.file_path // .path // .command // .pattern // .query // .url // .description // "" | tostring | .[0:80]' 2>/dev/null)
  local msg="🔧 ${short_name}"
  [ -n "$detail" ] && msg="${msg} → ${detail}"
  local escaped
  escaped=$(printf '%s' "$msg" | jq -Rs .)
  curl -s --connect-timeout 5 --max-time 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": $TELEGRAM_USER_ID, \"text\": $escaped}" > /dev/null 2>&1
}

# --- PreToolUse / BeforeTool handler ---
if [ "$hook_type" = "PreToolUse" ] || [ "$hook_type" = "BeforeTool" ]; then
  # Relay thinking text from transcript (both Claude and Gemini provide transcript_path)
  relay_thinking_text

  if [ -f "$AUTONOMOUS_FLAG" ]; then
    # For Gemini: send tool notification directly (no transcript relay available)
    if [ "$is_gemini" = "true" ]; then
      notify_tool &
    fi
    auto_approve "PreToolUse"
    exit 0
  fi

  # Not autonomous: handle permission flow
  file_path=$(echo "$tool_input" | jq -r '.file_path // .path // .command // "N/A"' 2>/dev/null | head -c 100)

  if [ "$is_gemini" = "true" ] && [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_USER_ID" ]; then
    # Gemini has no PermissionRequest — do blocking permission forwarding in BeforeTool
    message="🔐 Permission: $tool_name — $file_path"
    escaped_message=$(echo "$message" | jq -Rs .)
    keyboard='{"keyboard":[["Approve","Deny"]],"one_time_keyboard":true,"resize_keyboard":true}'
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -H "Content-Type: application/json" \
      -d "{\"chat_id\": $TELEGRAM_USER_ID, \"text\": $escaped_message, \"reply_markup\": $keyboard}" > /dev/null 2>&1

    rm -f "$PERMISSION_PENDING" "$PERMISSION_RESPONSE"
    echo "$tool_name" > "$PERMISSION_PENDING"
    timeout=300; elapsed=0
    while [ $elapsed -lt $timeout ]; do
      if [ -f "$PERMISSION_RESPONSE" ]; then
        response=$(cat "$PERMISSION_RESPONSE")
        rm -f "$PERMISSION_PENDING" "$PERMISSION_RESPONSE"
        if [ "$response" = "approve" ]; then
          echo '{"decision":"allow"}'
        else
          echo '{"decision":"deny","reason":"Denied via Telegram"}'
        fi
        exit 0
      fi
      sleep 1; elapsed=$((elapsed + 1))
    done
    rm -f "$PERMISSION_PENDING"
    echo '{"decision":"deny","reason":"Permission timed out (5 min)"}'
    exit 0
  fi

  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_USER_ID" ]; then
    # Claude: notification only (PermissionRequest handler does the blocking)
    message="🔧 $tool_name — $file_path"
    escaped_message=$(echo "$message" | jq -Rs .)
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -H "Content-Type: application/json" \
      -d "{\"chat_id\": $TELEGRAM_USER_ID, \"text\": $escaped_message}" > /dev/null 2>&1
  fi
  exit 0
fi

# --- PermissionRequest handler (Claude only, Gemini has no equivalent) ---

permission=$(echo "$input" | jq -r '.permission // "Unknown"')

if [ -f "$AUTONOMOUS_FLAG" ]; then
  auto_approve "PermissionRequest"
  exit 0
fi

# Forward to Telegram and wait for user's Approve/Deny response

# Clean up any stale permission files
rm -f "$PERMISSION_PENDING" "$PERMISSION_RESPONSE"

message="🔐 Permission needed: $permission

Approve or Deny?"

if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_USER_ID" ]; then
  escaped_message=$(echo "$message" | jq -Rs .)
  keyboard='{"keyboard":[["Approve","Deny"]],"one_time_keyboard":true,"resize_keyboard":true}'

  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": $TELEGRAM_USER_ID, \"text\": $escaped_message, \"reply_markup\": $keyboard}" > /dev/null 2>&1

  echo "$permission" > "$PERMISSION_PENDING"

  timeout=300
  elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if [ -f "$PERMISSION_RESPONSE" ]; then
      response=$(cat "$PERMISSION_RESPONSE")
      rm -f "$PERMISSION_PENDING" "$PERMISSION_RESPONSE"

      if [ "$response" = "approve" ]; then
        auto_approve "PermissionRequest"
        exit 0
      else
        cat <<EOF
{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied via Telegram"}}}
EOF
        exit 0
      fi
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  rm -f "$PERMISSION_PENDING"
  exit 0
fi

if [ -f "$AUTONOMOUS_FLAG" ]; then
  auto_approve "PermissionRequest"
  exit 0
fi

exit 0
