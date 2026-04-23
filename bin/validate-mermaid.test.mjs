#!/usr/bin/env node
/**
 * Tests for validate-mermaid.mjs hook script.
 *
 * Spawns the script as a child process, pipes JSON payloads, and asserts on
 * exit codes and stderr output — testing actual hook behavior end-to-end.
 */

import { spawnSync } from 'child_process';
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'validate-mermaid.mjs');

function run(payload) {
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
  });
  return { code: result.status, stderr: result.stderr ?? '' };
}

// -- Helpers --

function bashPayload(command) {
  return { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } };
}

function writePayload(content, filePath = 'test.md') {
  return { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { content, file_path: filePath } };
}

function editPayload(newString, filePath = 'test.md') {
  return { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { new_string: newString, file_path: filePath } };
}

function structuredOutputPayload(content) {
  return { hook_event_name: 'PreToolUse', tool_name: 'StructuredOutput', tool_input: { type: 'plan', content } };
}

const VALID_MERMAID = '```mermaid\ngraph TD\n  A --> B\n```';
const INVALID_MERMAID = '```mermaid\ngraph NOTVALID\n  ??? broken syntax ###\n```';

// ============================================================================
// Bash / gh pr commands
// ============================================================================

{
  // gh pr create with valid mermaid → exit 0
  const { code } = run(bashPayload(`gh pr create --title "My PR" --body '${VALID_MERMAID}'`));
  assert.strictEqual(code, 0, 'gh pr create with valid mermaid should exit 0');
  console.log('PASS: gh pr create with valid mermaid → exit 0');
}

{
  // gh pr create with invalid mermaid → exit 2
  const { code, stderr } = run(bashPayload(`gh pr create --title "My PR" --body '${INVALID_MERMAID}'`));
  assert.strictEqual(code, 2, 'gh pr create with invalid mermaid should exit 2');
  assert.ok(stderr.includes('Mermaid validation failed'), 'stderr should mention validation failure');
  console.log('PASS: gh pr create with invalid mermaid → exit 2');
}

{
  // gh pr edit with invalid mermaid → exit 2
  const { code, stderr } = run(bashPayload(`gh pr edit 42 --body '${INVALID_MERMAID}'`));
  assert.strictEqual(code, 2, 'gh pr edit with invalid mermaid should exit 2');
  assert.ok(stderr.includes('Mermaid validation failed'), 'stderr should mention validation failure');
  console.log('PASS: gh pr edit with invalid mermaid → exit 2');
}

{
  // gh pr create with no mermaid → exit 0
  const { code } = run(bashPayload("gh pr create --title 'My PR' --body 'Just some text, no diagrams.'"));
  assert.strictEqual(code, 0, 'gh pr create with no mermaid should exit 0');
  console.log('PASS: gh pr create with no mermaid → exit 0');
}

{
  // Non-gh-pr Bash command → exit 0, no validation
  const { code } = run(bashPayload('ls -la'));
  assert.strictEqual(code, 0, 'non-gh-pr Bash command should exit 0');
  console.log('PASS: non-gh-pr Bash command (ls -la) → exit 0');
}

{
  // Another non-gh-pr command containing mermaid text (should pass through)
  const { code } = run(bashPayload(`cat README.md | grep '${INVALID_MERMAID}'`));
  assert.strictEqual(code, 0, 'non-gh-pr Bash command should exit 0 even with mermaid text');
  console.log('PASS: non-gh-pr Bash command with mermaid text → exit 0 (no validation)');
}

{
  // gh pr comment with invalid mermaid → exit 2
  const { code, stderr } = run(bashPayload(`gh pr comment 42 --body '${INVALID_MERMAID}'`));
  assert.strictEqual(code, 2, 'gh pr comment with invalid mermaid should exit 2');
  assert.ok(stderr.includes('Mermaid validation failed'), 'stderr should mention validation failure');
  console.log('PASS: gh pr comment with invalid mermaid → exit 2');
}

{
  // gh pr review with invalid mermaid → exit 2
  const { code, stderr } = run(bashPayload(`gh pr review 42 --body '${INVALID_MERMAID}'`));
  assert.strictEqual(code, 2, 'gh pr review with invalid mermaid should exit 2');
  assert.ok(stderr.includes('Mermaid validation failed'), 'stderr should mention validation failure');
  console.log('PASS: gh pr review with invalid mermaid → exit 2');
}

{
  // gh pr create with HEREDOC-style valid mermaid → exit 0
  const heredocValid = `gh pr create --body "$(cat <<'EOF'\n${VALID_MERMAID}\nEOF\n)"`;
  const { code } = run(bashPayload(heredocValid));
  assert.strictEqual(code, 0, 'gh pr create with HEREDOC valid mermaid should exit 0');
  console.log('PASS: gh pr create with HEREDOC valid mermaid → exit 0');
}

{
  // gh pr create with HEREDOC-style invalid mermaid → exit 2
  const heredocInvalid = `gh pr create --body "$(cat <<'EOF'\n${INVALID_MERMAID}\nEOF\n)"`;
  const { code, stderr } = run(bashPayload(heredocInvalid));
  assert.strictEqual(code, 2, 'gh pr create with HEREDOC invalid mermaid should exit 2');
  assert.ok(stderr.includes('Mermaid validation failed'), 'stderr should mention validation failure');
  console.log('PASS: gh pr create with HEREDOC invalid mermaid → exit 2');
}

// ============================================================================
// Regression: Write / Edit still work
// ============================================================================

{
  // Write with valid mermaid → exit 0
  const { code } = run(writePayload(`# Doc\n\n${VALID_MERMAID}\n`));
  assert.strictEqual(code, 0, 'Write with valid mermaid should exit 0');
  console.log('PASS: Write with valid mermaid → exit 0');
}

{
  // Write with invalid mermaid → exit 2
  const { code, stderr } = run(writePayload(`# Doc\n\n${INVALID_MERMAID}\n`));
  assert.strictEqual(code, 2, 'Write with invalid mermaid should exit 2');
  assert.ok(stderr.includes('Mermaid validation failed'), 'stderr should mention validation failure');
  console.log('PASS: Write with invalid mermaid → exit 2');
}

{
  // Edit with invalid mermaid → exit 2
  const { code, stderr } = run(editPayload(INVALID_MERMAID));
  assert.strictEqual(code, 2, 'Edit with invalid mermaid should exit 2');
  assert.ok(stderr.includes('Mermaid validation failed'), 'stderr should mention validation failure');
  console.log('PASS: Edit with invalid mermaid → exit 2');
}

// ============================================================================
// StructuredOutput
// ============================================================================

{
  // StructuredOutput with valid mermaid → exit 0
  const { code } = run(structuredOutputPayload(`## Summary\n\n${VALID_MERMAID}\n`));
  assert.strictEqual(code, 0, 'StructuredOutput with valid mermaid should exit 0');
  console.log('PASS: StructuredOutput with valid mermaid → exit 0');
}

{
  // StructuredOutput with invalid mermaid → exit 2
  const { code, stderr } = run(structuredOutputPayload(`## Summary\n\n${INVALID_MERMAID}\n`));
  assert.strictEqual(code, 2, 'StructuredOutput with invalid mermaid should exit 2');
  assert.ok(stderr.includes('Mermaid validation failed'), 'stderr should mention validation failure');
  console.log('PASS: StructuredOutput with invalid mermaid → exit 2');
}

{
  // StructuredOutput with no mermaid → exit 0
  const { code } = run(structuredOutputPayload('## Summary\n\nJust text, no diagrams.\n'));
  assert.strictEqual(code, 0, 'StructuredOutput with no mermaid should exit 0');
  console.log('PASS: StructuredOutput with no mermaid → exit 0');
}

console.log('\nAll tests passed.');
