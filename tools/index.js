/**
 * Tool Registry - Central dispatcher for all Crab-Agent tools (21 external + 2 internal).
 * Each tool has: name, description, parameters schema, execute function.
 */

import { computerTool } from './computer.js';
import { navigateTool } from './navigate.js';
import { readPageTool } from './read-page.js';
import { findTool } from './find.js';
import { formInputTool } from './form-input.js';
import { getPageTextTool } from './get-page-text.js';
import { tabsContextTool, tabsCreateTool, switchTabTool, closeTabTool } from './tabs.js';
import { readConsoleTool } from './read-console.js';
import { readNetworkTool } from './read-network.js';
import { resizeWindowTool } from './resize-window.js';
import { updatePlanTool } from './update-plan.js';
import { fileUploadTool, uploadImageTool } from './file-upload.js';
import { gifCreatorTool } from './gif-creator.js';
import { shortcutsListTool, shortcutsExecuteTool } from './shortcuts.js';
import { javascriptTool } from './javascript-tool.js';
import { canvasToolkitTool } from './canvas-toolkit.js';

/**
 * All registered tools.
 */
export const TOOLS = {
  computer: computerTool,
  navigate: navigateTool,
  read_page: readPageTool,
  find: findTool,
  form_input: formInputTool,
  get_page_text: getPageTextTool,
  tabs_context: tabsContextTool,
  tabs_create: tabsCreateTool,
  switch_tab: switchTabTool,
  close_tab: closeTabTool,
  read_console_messages: readConsoleTool,
  read_network_requests: readNetworkTool,
  resize_window: resizeWindowTool,
  update_plan: updatePlanTool,
  file_upload: fileUploadTool,
  upload_image: uploadImageTool,
  gif_creator: gifCreatorTool,
  shortcuts_list: shortcutsListTool,
  shortcuts_execute: shortcutsExecuteTool,
  javascript_tool: javascriptTool,
  canvas_toolkit: canvasToolkitTool
};

/**
 * Internal tools (not exposed to LLM as callable tools).
 */
export const INTERNAL_TOOLS = {
  done: {
    name: 'done',
    description: 'Complete the current task with a result message. Call this when the task is finished.',
    parameters: {
      text: { type: 'string', description: 'Summary of what was accomplished or the answer to user\'s question.', required: true },
      success: { type: 'boolean', description: 'Whether the task was completed successfully. Default true.' }
    },
    execute: async (params) => ({
      isDone: true,
      success: params.success !== false,
      message: params.text || 'Task completed'
    })
  },
  ask_user: {
    name: 'ask_user',
    description: 'Ask the user a question when you need clarification before proceeding.',
    parameters: {
      question: { type: 'string', description: 'The question to ask the user.', required: true },
      options: { type: 'array', items: { type: 'string' }, description: 'Optional multiple-choice options.' }
    },
    execute: async (params) => ({
      isAskUser: true,
      question: params.question || '',
      options: params.options || [],
      message: params.question
    })
  }
};

/**
 * Execute a tool by name.
 * @param {string} toolName - Tool name
 * @param {Object} params - Tool parameters
 * @param {Object} context - Execution context { tabId, exec, cdp }
 * @returns {Object} Tool result
 */
export async function executeTool(toolName, params, context) {
  // Check internal tools first
  if (INTERNAL_TOOLS[toolName]) {
    return await INTERNAL_TOOLS[toolName].execute(params, context);
  }

  const tool = TOOLS[toolName];
  if (!tool) {
    return { success: false, error: `Unknown tool: ${toolName}. Available: ${Object.keys(TOOLS).join(', ')}` };
  }

  try {
    return await tool.execute(params, context);
  } catch (error) {
    console.error(`[Tool] ${toolName} error:`, error);
    return { success: false, error: `Tool ${toolName} failed: ${error.message}` };
  }
}

/**
 * Get all tool schemas for system prompt generation.
 * @returns {Array<{name: string, description: string, parameters: Object}>}
 */
export function getToolSchemas() {
  const schemas = [];
  for (const [name, tool] of Object.entries(TOOLS)) {
    schemas.push({
      name,
      description: tool.description,
      parameters: tool.parameters || {}
    });
  }
  // Add internal tools
  for (const [name, tool] of Object.entries(INTERNAL_TOOLS)) {
    schemas.push({ name, description: tool.description, parameters: tool.parameters || {} });
  }
  return schemas;
}

/**
 * Get tool names list.
 */
export function getToolNames() {
  return [...Object.keys(TOOLS), ...Object.keys(INTERNAL_TOOLS)];
}

export default { TOOLS, INTERNAL_TOOLS, executeTool, getToolSchemas, getToolNames };
