#!/usr/bin/env bash
# Test script to validate OpenCode invocation with Kimi K2.5.
#
# Two test phases:
#   1. Basic invocation — send a simple task, verify JSON events stream correctly
#   2. JSON schema enforcement — send a prompt with embedded schema (like Orkestra
#      does for providers without native --json-schema), verify the agent responds
#      with valid JSON matching the schema

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

MODEL="${1:-opencode/kimi-k2.5-free}"

echo -e "${BOLD}OpenCode Integration Test${NC}"
echo -e "${DIM}Model: ${MODEL}${NC}"
echo -e "${DIM}Working dir: ${PROJECT_DIR}${NC}"
echo ""

# Check prerequisites
if ! command -v opencode &>/dev/null; then
    echo -e "${RED}ERROR: opencode not found in PATH${NC}"
    exit 1
fi
if ! command -v jq &>/dev/null; then
    echo -e "${RED}ERROR: jq not found in PATH${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} opencode found: $(which opencode) ($(opencode --version 2>/dev/null || echo '?'))"

# Temp files
OUTPUT_FILE=$(mktemp)
SCHEMA_OUTPUT_FILE=$(mktemp)
trap "rm -f $OUTPUT_FILE $SCHEMA_OUTPUT_FILE" EXIT

# ============================================================================
# Test 1: Basic Invocation
# ============================================================================

BASIC_PROMPT="List the files in the current directory. Just run ls and report what you see. Do NOT create or modify any files."

echo ""
echo -e "${BOLD}═══ Test 1: Basic Invocation ═══${NC}"
echo -e "${DIM}Prompt: ${BASIC_PROMPT}${NC}"
echo ""

echo "$BASIC_PROMPT" | opencode run \
    --model "$MODEL" \
    --format json \
    2>/dev/null | while IFS= read -r line; do

    trimmed="$(echo "$line" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    if [ -z "$trimmed" ]; then continue; fi

    EVENT_TYPE=$(echo "$line" | jq -r '.type // empty' 2>/dev/null || true)

    if [ -n "$EVENT_TYPE" ]; then
        case "$EVENT_TYPE" in
            text|assistant)
                CONTENT=$(echo "$line" | jq -r '.part.text // .content // .text // "(empty)"' 2>/dev/null || echo "?")
                echo -e "${CYAN}[${EVENT_TYPE}]${NC} ${CONTENT:0:200}"
                ;;
            tool_use)
                TOOL=$(echo "$line" | jq -r '.part.tool // .name // .tool // "?"' 2>/dev/null || echo "?")
                echo -e "${GREEN}[tool_use]${NC} ${TOOL}"
                ;;
            step_start|step_finish)
                REASON=$(echo "$line" | jq -r '.part.reason // ""' 2>/dev/null || true)
                if [ -n "$REASON" ]; then
                    echo -e "${DIM}[${EVENT_TYPE}]${NC} ${REASON}"
                else
                    echo -e "${DIM}[${EVENT_TYPE}]${NC}"
                fi
                ;;
            error)
                MSG=$(echo "$line" | jq -r '.message // .error // "?"' 2>/dev/null || echo "?")
                echo -e "${RED}[error]${NC} ${MSG}"
                ;;
            *)
                echo -e "${YELLOW}[${EVENT_TYPE}]${NC}"
                ;;
        esac
    else
        echo -e "${DIM}[raw]${NC} ${line:0:120}"
    fi

    echo "$line" >> "$OUTPUT_FILE"
done

echo ""

# Validate basic invocation
BASIC_PASS=true

if [ ! -s "$OUTPUT_FILE" ]; then
    echo -e "${RED}FAIL: No output received${NC}"
    BASIC_PASS=false
else
    JSON_LINES=$(grep -c '^{' "$OUTPUT_FILE" 2>/dev/null || echo 0)
    TEXT_EVENTS=0
    TOOL_USE_EVENTS=0
    ERROR_EVENTS=0

    while IFS= read -r json_line; do
        evt=$(echo "$json_line" | jq -r '.type // empty' 2>/dev/null || true)
        case "$evt" in
            text|assistant) TEXT_EVENTS=$((TEXT_EVENTS + 1)) ;;
            tool_use)       TOOL_USE_EVENTS=$((TOOL_USE_EVENTS + 1)) ;;
            error)          ERROR_EVENTS=$((ERROR_EVENTS + 1)) ;;
        esac
    done < "$OUTPUT_FILE"

    if [ "$JSON_LINES" -eq 0 ]; then
        echo -e "${RED}FAIL: No JSON events received${NC}"
        BASIC_PASS=false
    else
        echo -e "${GREEN}✓${NC} JSON event stream working (${JSON_LINES} events)"
    fi

    if [ "$TEXT_EVENTS" -gt 0 ]; then
        echo -e "${GREEN}✓${NC} Got text events (${TEXT_EVENTS})"
    else
        echo -e "${YELLOW}WARN: No text events${NC}"
    fi

    if [ "$TOOL_USE_EVENTS" -gt 0 ]; then
        echo -e "${GREEN}✓${NC} Got tool_use events (${TOOL_USE_EVENTS})"
    else
        echo -e "${YELLOW}WARN: No tool_use events${NC}"
    fi

    if [ "$ERROR_EVENTS" -gt 0 ]; then
        echo -e "${RED}FAIL: Got error events (${ERROR_EVENTS})${NC}"
        BASIC_PASS=false
    else
        echo -e "${GREEN}✓${NC} No error events"
    fi
fi

if [ "$BASIC_PASS" = true ]; then
    echo -e "${GREEN}${BOLD}Test 1 PASS${NC}"
else
    echo -e "${RED}${BOLD}Test 1 FAIL${NC}"
fi

# ============================================================================
# Test 2: JSON Schema Enforcement
# ============================================================================

# This mirrors exactly what Orkestra does in append_schema_enforcement():
# embed the JSON schema in the prompt text and instruct the agent to output
# only valid JSON matching the schema.
SCHEMA='{
  "type": "object",
  "required": ["type", "summary"],
  "properties": {
    "type": {
      "type": "string",
      "enum": ["artifact"]
    },
    "summary": {
      "type": "string",
      "description": "A one-sentence summary of the work done"
    }
  },
  "additionalProperties": false
}'

SCHEMA_PROMPT="You are a coding assistant. Your task is: count the number of .rs files in the crates/ directory using find or ls.

## Required Output Format

You MUST respond with valid JSON matching this exact schema:

\`\`\`json
${SCHEMA}
\`\`\`

Output ONLY the JSON object. No markdown fences, no explanation, no other text."

echo ""
echo -e "${BOLD}═══ Test 2: JSON Schema Enforcement ═══${NC}"
echo -e "${DIM}Testing that agent outputs valid JSON when given an embedded schema${NC}"
echo ""

echo "$SCHEMA_PROMPT" | opencode run \
    --model "$MODEL" \
    --format json \
    2>/dev/null | while IFS= read -r line; do

    trimmed="$(echo "$line" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')"
    if [ -z "$trimmed" ]; then continue; fi

    EVENT_TYPE=$(echo "$line" | jq -r '.type // empty' 2>/dev/null || true)

    if [ -n "$EVENT_TYPE" ]; then
        case "$EVENT_TYPE" in
            text|assistant)
                CONTENT=$(echo "$line" | jq -r '.part.text // .content // .text // ""' 2>/dev/null || true)
                if [ -n "$CONTENT" ]; then
                    echo -e "${CYAN}[${EVENT_TYPE}]${NC} ${CONTENT:0:200}"
                fi
                ;;
            tool_use)
                TOOL=$(echo "$line" | jq -r '.part.tool // .name // "?"' 2>/dev/null || echo "?")
                echo -e "${GREEN}[tool_use]${NC} ${TOOL}"
                ;;
            step_start|step_finish)
                REASON=$(echo "$line" | jq -r '.part.reason // ""' 2>/dev/null || true)
                if [ -n "$REASON" ]; then
                    echo -e "${DIM}[${EVENT_TYPE}]${NC} ${REASON}"
                else
                    echo -e "${DIM}[${EVENT_TYPE}]${NC}"
                fi
                ;;
            error)
                MSG=$(echo "$line" | jq -r '.message // .error // "?"' 2>/dev/null || echo "?")
                echo -e "${RED}[error]${NC} ${MSG}"
                ;;
            *)
                echo -e "${YELLOW}[${EVENT_TYPE}]${NC}"
                ;;
        esac
    fi

    echo "$line" >> "$SCHEMA_OUTPUT_FILE"
done

echo ""

# Extract the final text output — this should be the JSON response
# Collect all text events, the last one(s) should contain the JSON
SCHEMA_PASS=true
FINAL_TEXT=""

while IFS= read -r json_line; do
    evt=$(echo "$json_line" | jq -r '.type // empty' 2>/dev/null || true)
    if [ "$evt" = "text" ] || [ "$evt" = "assistant" ]; then
        PART_TEXT=$(echo "$json_line" | jq -r '.part.text // .content // .text // ""' 2>/dev/null || true)
        if [ -n "$PART_TEXT" ]; then
            FINAL_TEXT="${FINAL_TEXT}${PART_TEXT}"
        fi
    fi
done < "$SCHEMA_OUTPUT_FILE"

# Strip markdown fences if present (agent might wrap in ```json ... ```)
CLEAN_TEXT=$(echo "$FINAL_TEXT" | sed 's/^[[:space:]]*```json//' | sed 's/^[[:space:]]*```//' | sed 's/```[[:space:]]*$//' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')

echo -e "${BOLD}Agent's final text output:${NC}"
echo -e "${DIM}${CLEAN_TEXT}${NC}"
echo ""

# Validate: is it valid JSON?
if echo "$CLEAN_TEXT" | jq . >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Output is valid JSON"
else
    echo -e "${RED}FAIL: Output is not valid JSON${NC}"
    SCHEMA_PASS=false
fi

# Validate: does it have the required fields?
if [ "$SCHEMA_PASS" = true ]; then
    HAS_TYPE=$(echo "$CLEAN_TEXT" | jq -r '.type // empty' 2>/dev/null || true)
    HAS_SUMMARY=$(echo "$CLEAN_TEXT" | jq -r '.summary // empty' 2>/dev/null || true)

    if [ "$HAS_TYPE" = "artifact" ]; then
        echo -e "${GREEN}✓${NC} Has \"type\": \"artifact\""
    elif [ -n "$HAS_TYPE" ]; then
        echo -e "${YELLOW}WARN: \"type\" is \"${HAS_TYPE}\" (expected \"artifact\")${NC}"
    else
        echo -e "${RED}FAIL: Missing \"type\" field${NC}"
        SCHEMA_PASS=false
    fi

    if [ -n "$HAS_SUMMARY" ]; then
        echo -e "${GREEN}✓${NC} Has \"summary\": \"${HAS_SUMMARY:0:100}\""
    else
        echo -e "${RED}FAIL: Missing \"summary\" field${NC}"
        SCHEMA_PASS=false
    fi

    # Check no extra fields
    FIELD_COUNT=$(echo "$CLEAN_TEXT" | jq 'keys | length' 2>/dev/null || echo 0)
    if [ "$FIELD_COUNT" -le 2 ]; then
        echo -e "${GREEN}✓${NC} No extra fields (${FIELD_COUNT} total)"
    else
        EXTRA_KEYS=$(echo "$CLEAN_TEXT" | jq -r 'keys | map(select(. != "type" and . != "summary")) | join(", ")' 2>/dev/null || true)
        echo -e "${YELLOW}WARN: Extra fields present: ${EXTRA_KEYS}${NC}"
    fi
fi

if [ "$SCHEMA_PASS" = true ]; then
    echo -e "${GREEN}${BOLD}Test 2 PASS${NC}"
else
    echo -e "${RED}${BOLD}Test 2 FAIL${NC}"
fi

# ============================================================================
# Final Result
# ============================================================================

echo ""
echo -e "${BOLD}═══════════════════════════${NC}"
if [ "$BASIC_PASS" = true ] && [ "$SCHEMA_PASS" = true ]; then
    echo -e "${GREEN}${BOLD}ALL TESTS PASS${NC} — OpenCode with ${MODEL} is working correctly"
else
    echo -e "${RED}${BOLD}TESTS FAILED${NC}"
    [ "$BASIC_PASS" != true ] && echo -e "  ${RED}• Basic invocation failed${NC}"
    [ "$SCHEMA_PASS" != true ] && echo -e "  ${RED}• JSON schema enforcement failed${NC}"
    exit 1
fi
