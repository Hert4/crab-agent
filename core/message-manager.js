/**
 * Message Manager - Manages conversation history for LLM calls.
 * Handles message formatting, token budgeting, and image attachments.
 * Supports both text-based and structured content (for Anthropic native tool_use).
 */

export class MessageManager {
  constructor(maxTokens = 128000) {
    this.messages = [];
    this.maxTokens = maxTokens;
  }

  /**
   * Initialize conversation with system prompt and task.
   */
  initTaskMessages(systemPrompt, taskPrompt, exampleOutput = null, taskImages = []) {
    this.messages = [{ role: 'system', content: systemPrompt }];

    if (exampleOutput) {
      this.messages.push({ role: 'user', content: 'Example task' });
      this.messages.push({ role: 'assistant', content: JSON.stringify(exampleOutput, null, 2) });
    }

    const taskMessage = { role: 'user', content: taskPrompt };
    if (Array.isArray(taskImages) && taskImages.length > 0) {
      taskMessage.images = taskImages;
    }
    this.messages.push(taskMessage);
  }

  /**
   * Initialize with system prompt and task (simplified alias).
   */
  initMessages(systemPrompt, taskPrompt) {
    this.messages = [{ role: 'system', content: systemPrompt }];
    this.messages.push({ role: 'user', content: taskPrompt });
  }

  /**
   * Add a generic message. Content can be string or structured array.
   * Extra fields (tool_calls, tool_call_id, etc.) can be passed for provider-specific formats.
   */
  addMessage(role, content, images = [], extra = {}) {
    const msg = { role, content, ...extra };
    if (Array.isArray(images) && images.length > 0) {
      msg.images = images;
    }
    this.messages.push(msg);
  }

  /**
   * Add an assistant message with native tool_use content blocks (Anthropic format).
   * @param {string} text - Optional text from the model
   * @param {Object} toolUse - { id, name, parameters }
   */
  addAssistantToolUse(text, toolUse) {
    const content = [];
    if (text) content.push({ type: 'text', text });
    content.push({
      type: 'tool_use',
      id: toolUse.id || `toolu_${Date.now()}`,
      name: toolUse.name,
      input: toolUse.parameters || {}
    });
    this.messages.push({ role: 'assistant', content });
  }

  /**
   * Add a tool_result message after tool execution (Anthropic format).
   * Must follow an assistant message with matching tool_use id.
   * @param {string} toolUseId - The tool_use block id to respond to
   * @param {string|Object} result - Tool execution result
   * @param {boolean} isError - Whether the result is an error
   */
  addToolResult(toolUseId, result, isError = false) {
    const resultContent = typeof result === 'string' ? result : JSON.stringify(result);
    this.messages.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: resultContent,
        ...(isError ? { is_error: true } : {})
      }]
    });
  }

  /**
   * Update the system prompt (first message).
   */
  updateSystemPrompt(newPrompt) {
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0].content = newPrompt;
    }
  }

  /**
   * Add a state observation message (from page state + screenshot).
   */
  addStateMessage(content, images = []) {
    const message = { role: 'user', content };
    if (images.length > 0) message.images = images;
    this.messages.push(message);
  }

  /**
   * Add model's response.
   */
  addModelOutput(content) {
    this.messages.push({ role: 'assistant', content });
  }

  /**
   * Remove the last user state message (for re-prompting).
   */
  removeLastStateMessage() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        this.messages.splice(i, 1);
        break;
      }
    }
  }

  /**
   * Trim conversation to fit within token budget.
   * Keeps system prompt and recent messages.
   */
  trimToFit() {
    // Rough estimate: 1 token ≈ 4 chars
    const estimateTokens = (msg) => {
      const content = msg.content;
      let len;
      if (typeof content === 'string') {
        len = content.length;
      } else if (Array.isArray(content)) {
        // Structured content blocks
        len = content.reduce((sum, block) => {
          if (block.type === 'text') return sum + (block.text || '').length;
          if (block.type === 'tool_use') return sum + JSON.stringify(block.input || {}).length + 50;
          if (block.type === 'tool_result') return sum + (typeof block.content === 'string' ? block.content.length : JSON.stringify(block.content || '').length);
          return sum + 50;
        }, 0);
      } else {
        len = JSON.stringify(content || '').length;
      }
      if (msg.images) len += msg.images.length * 1000;
      return Math.ceil(len / 4);
    };

    let totalTokens = this.messages.reduce((sum, msg) => sum + estimateTokens(msg), 0);

    // Keep first (system) and last 6 messages, trim middle
    while (totalTokens > this.maxTokens && this.messages.length > 8) {
      const removeIdx = 1; // After system prompt
      totalTokens -= estimateTokens(this.messages[removeIdx]);
      this.messages.splice(removeIdx, 1);
    }
  }

  /**
   * Get all messages for LLM call.
   */
  getMessages() {
    this.trimToFit();
    return [...this.messages];
  }

  /**
   * Get message count.
   */
  get length() {
    return this.messages.length;
  }
}

export default MessageManager;
