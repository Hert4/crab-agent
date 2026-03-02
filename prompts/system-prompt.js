/**
 * System Prompt Builder - Auto-generates system prompt from tool schemas.
 * Replaces hardcoded 900+ line prompt with dynamic generation.
 */

import { getToolSchemas } from '../tools/index.js';

/**
 * Build the full system prompt for the LLM.
 * @param {Object} options - Build options
 * @param {string} options.contextRules - Domain-specific context rules
 * @param {string} options.memory - Agent memory from previous steps
 * @param {string} options.warnings - State manager warnings
 * @param {boolean} options.nativeToolUse - If true, tools go through API (Anthropic), skip tool docs in prompt
 * @returns {string} Complete system prompt
 */
export function buildSystemPrompt(options = {}) {
  const { contextRules = '', memory = '', warnings = '', nativeToolUse = false } = options;

  const coreInstructions = `You are Crab-Agent, a browser automation agent. You control web browsers to complete user tasks.

## How to work
1. Look at the screenshot to understand the current page state.
2. Choose one tool to execute. Be direct and efficient.
3. After the action, verify the result on the next screenshot.

## Key guidelines
- For messaging/chat: click input area → type text → press Enter. 3 steps max.
- Prefer coordinates from screenshot for visible elements. Use read_page only if needed.
- Chat inputs are often contenteditable divs. Click them, then type.
- After typing, press Enter to send messages.
- Don't take extra screenshots between actions unless something failed.
- Be fast: minimize steps, maximize progress per step.

## Element targeting
- BEST: ref from read_page/find → computer tool ref parameter
- GOOD: coordinates from screenshot → computer tool coordinate parameter
- Use form_input for standard form fields (input, select, textarea)

## Completion
- Use done tool when task is complete.
- Use ask_user tool when you need clarification.`;

  // For non-native tool use providers, include tool docs and JSON response format
  let toolSection = '';
  if (!nativeToolUse) {
    const toolDocs = _buildToolDocs();
    toolSection = `

## Available Tools
${toolDocs}

## Response Format (JSON ONLY)
\`\`\`json
{
  "thought": {
    "observation": "What I see on the current page",
    "analysis": "Current state vs goal, identify gaps",
    "plan": "Why I'm choosing this specific action"
  },
  "tool_use": {
    "name": "tool_name",
    "parameters": { "param": "value" }
  }
}
\`\`\``;
  }

  return `<system_instructions>
${coreInstructions}
${toolSection}
${contextRules ? `\n## Context Rules\n${contextRules}` : ''}
${memory ? `\n## Memory\n${memory}` : ''}
${warnings ? `\n## Warnings\n${warnings}` : ''}
</system_instructions>`;
}

/**
 * Build tool documentation from schemas.
 */
function _buildToolDocs() {
  const schemas = getToolSchemas();
  return schemas.map(tool => {
    const params = tool.parameters || {};
    const paramLines = Object.entries(params).map(([name, spec]) => {
      const type = spec.type || 'any';
      const enumVals = spec.enum ? ` (${spec.enum.join('|')})` : '';
      const desc = spec.description || '';
      return `    - ${name}: ${type}${enumVals} - ${desc}`;
    });

    const paramBlock = paramLines.length > 0
      ? `  Parameters:\n${paramLines.join('\n')}`
      : '  No parameters.';

    return `### ${tool.name}\n  ${tool.description}\n${paramBlock}`;
  }).join('\n\n');
}

/**
 * Build a condensed tool list (for token-constrained contexts).
 */
export function buildToolListShort() {
  const schemas = getToolSchemas();
  return schemas.map(t => `- ${t.name}: ${t.description.split('\n')[0]}`).join('\n');
}

export default { buildSystemPrompt, buildToolListShort };
