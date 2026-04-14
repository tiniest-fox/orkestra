#!/usr/bin/env node
/**
 * Validates mermaid diagram blocks in files and assistant responses.
 *
 * Called as two different Claude Code hooks:
 *
 *   PreToolUse (Write, Edit):
 *     Checks content before it is written. For Write, checks tool_input.content.
 *     For Edit, checks tool_input.new_string (the incoming change).
 *     Exits 2 on failure, which blocks the write entirely.
 *
 *   Stop:
 *     Checks the assistant's final response text for invalid mermaid blocks.
 *     Exits 2 on failure, which blocks the response and forces a retry.
 *
 * Validation uses mermaid.parse() directly — real parse-level checking, not
 * just diagram type name matching.
 */

import { readFileSync } from 'fs';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false });

// ============================================================================
// Parsing
// ============================================================================

function extractMermaidBlocks(content) {
  const blocks = [];
  const re = /```mermaid\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

async function validateBlock(diagram) {
  try {
    await mermaid.parse(diagram.trim());
    return null;
  } catch (err) {
    const msg = String(err?.message ?? err);
    const isDomError = msg.includes('DOMPurify') || msg.includes('is not a function');
    return isDomError ? 'Invalid mermaid syntax (parse error)' : `Invalid mermaid syntax: ${msg}`;
  }
}

async function validateBlocks(blocks, source) {
  const errors = [];
  for (let i = 0; i < blocks.length; i++) {
    const err = await validateBlock(blocks[i]);
    if (err) errors.push(`Mermaid block ${i + 1} in ${source}: ${err}`);
  }
  return errors;
}

// ============================================================================
// Main
// ============================================================================

const raw = readFileSync('/dev/stdin', 'utf-8').trim();
if (!raw) process.exit(0);

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const hookEvent = payload.hook_event_name ?? '';
const toolName = payload.tool_name ?? '';
const toolInput = payload.tool_input ?? {};

let content = '';
let source = '';

if (hookEvent === 'Stop') {
  content = payload.last_assistant_message ?? '';
  source = 'response';
} else if (toolName === 'Write') {
  content = toolInput.content ?? '';
  source = toolInput.file_path ?? '<write>';
} else if (toolName === 'Edit') {
  content = toolInput.new_string ?? '';
  source = toolInput.file_path ?? '<edit>';
} else {
  process.exit(0);
}

const blocks = extractMermaidBlocks(content);
if (blocks.length === 0) process.exit(0);

const errors = await validateBlocks(blocks, source);
if (errors.length > 0) {
  const label = hookEvent === 'Stop' ? 'Mermaid validation failed in response' : 'Mermaid validation failed';
  process.stderr.write(`${label}:\n\n`);
  for (const err of errors) process.stderr.write(`  ${err}\n\n`);
  process.exit(2);
}

process.exit(0);
