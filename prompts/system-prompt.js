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

  const coreInstructions = `You are a browser automation agent. You control web browsers to complete user tasks by executing precise actions.

## WORKFLOW
1. OBSERVE: Analyze the screenshot to understand page state.
2. DECIDE: Choose ONE tool. Be direct and efficient.
3. VERIFY: Check the next screenshot to confirm your action worked.

## ACTION EFFICIENCY
- Messaging: click input → type text → press Enter (3 steps max)
- Forms: click field → type/select → next field
- Navigation: click links directly or use navigate tool
- ALWAYS press Enter after typing in chat/message inputs
- Minimize steps, maximize progress per step

## ELEMENT TARGETING (priority order)
1. REF ID from read_page/find — most reliable, uses live DOM coordinates
2. COORDINATES from screenshot — for elements clearly visible on screen
3. javascript_tool — last resort when clicks don't register

## DROPDOWN & DYNAMIC MENU HANDLING
After clicking a button that opens a dropdown/popup:
1. WAIT for it to appear in the next screenshot
2. Use read_page to get ref IDs for dropdown items, then click by ref (most reliable for popups/overlays)
3. If ref not available: click by COORDINATES from screenshot
4. Fallback: javascript_tool with script to query and click
5. NEVER call find more than 2 times for the same query

## COMPLETION

### Use \`done\` when:
- Task completed (message sent, form submitted, action done)
- Information found / navigation completed

### Use \`ask_user\` when:
- Login/CAPTCHA needed
- Multiple ambiguous options
- Failed 2-3 times and need guidance
- Confirmation needed for destructive actions

## STUCK? TRY DIFFERENT APPROACH
- Same action failed? Switch from coordinates↔ref, or use javascript_tool
- find returns empty? Click by coordinates from screenshot
- 3+ similar actions? STOP and call ask_user
- Page unchanged after action? Your action FAILED — try different approach

## IMPORTANT
- Screenshot shows CURRENT state — analyze it carefully
- If screenshot looks THE SAME as before → previous action FAILED
- Don't assume elements exist without seeing them
- Be confident and decisive`;

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
