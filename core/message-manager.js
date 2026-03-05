/**
 * Message Manager - Manages conversation history for LLM calls.
 * Handles message formatting, token budgeting, and image attachments.
 * Supports both text-based and structured content (for Anthropic native tool_use).
 */

export class MessageManager {
  constructor(maxTokens = 128000) {
    this.messages = [];
    this.maxTokens = maxTokens;
    this._compactionThreshold = 25 * 1024 * 1024; // 25MB
    this._tokensSaved = 0;
    this._compactedCount = 0;
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
   * Skips tool_result messages (role=user with tool_result blocks, or role=tool)
   * to avoid breaking tool_calls/tool_response pairing.
   */
  removeLastStateMessage() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === 'user') {
        // Skip if this is a tool_result message (Anthropic format)
        if (Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool_result')) {
          continue;
        }
        this.messages.splice(i, 1);
        break;
      }
    }
  }

  /**
   * Estimate the total byte size of all messages (for compaction threshold check).
   * @returns {number} Approximate byte size
   */
  _estimateTotalBytes() {
    let total = 0;
    for (const msg of this.messages) {
      total += this._estimateMsgBytes(msg);
    }
    return total;
  }

  /**
   * Estimate byte size of a single message.
   */
  _estimateMsgBytes(msg) {
    let bytes = 0;
    const content = msg.content;
    if (typeof content === 'string') {
      bytes += content.length;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text') bytes += (block.text || '').length;
        else if (block.type === 'image') bytes += (block.source?.data || '').length;
        else if (block.type === 'tool_use') bytes += JSON.stringify(block.input || {}).length;
        else if (block.type === 'tool_result') bytes += (typeof block.content === 'string' ? block.content.length : JSON.stringify(block.content || '').length);
        else bytes += JSON.stringify(block).length;
      }
    } else if (content) {
      bytes += JSON.stringify(content).length;
    }
    // base64 images in .images array are ~1.37x the raw image size
    if (msg.images) {
      for (const img of msg.images) {
        if (typeof img === 'string') bytes += img.length;
        else if (img?.data) bytes += img.data.length;
        else bytes += JSON.stringify(img).length;
      }
    }
    return bytes;
  }

  /**
   * Compact messages when total size exceeds threshold (~25MB).
   * Extracts base64 images from older messages and replaces with placeholders.
   * Keeps the most recent 6 messages untouched.
   * Claude-style: only strips images, preserves text/tool_use/tool_result content.
   */
  compactIfNeeded() {
    const totalBytes = this._estimateTotalBytes();
    if (totalBytes < this._compactionThreshold) return false;

    console.log(`[MessageManager] Compacting: ${(totalBytes / 1024 / 1024).toFixed(1)}MB exceeds ${(this._compactionThreshold / 1024 / 1024).toFixed(0)}MB threshold`);

    const KEEP_RECENT = 6;
    const protectedEnd = Math.max(0, this.messages.length - KEEP_RECENT);
    let saved = 0;

    // Walk messages from oldest to newest (skip system + recent)
    for (let i = 1; i < protectedEnd; i++) {
      const msg = this.messages[i];
      saved += this._compactMessage(msg);
    }

    if (saved > 0) {
      this._tokensSaved += Math.ceil(saved / 4); // rough token estimate
      this._compactedCount++;
      console.log(`[MessageManager] Compaction #${this._compactedCount}: removed ~${(saved / 1024).toFixed(0)}KB of base64 data (${this._tokensSaved} tokens saved total)`);
    }

    return saved > 0;
  }

  /**
   * Compact a single message: strip base64 images, replace with placeholders.
   * @returns {number} Bytes saved
   */
  _compactMessage(msg) {
    let saved = 0;

    // 1. Handle .images array (our custom format for screenshots)
    if (msg.images && msg.images.length > 0) {
      for (const img of msg.images) {
        if (typeof img === 'string' && img.length > 1000) {
          saved += img.length;
        } else if (img?.data && img.data.length > 1000) {
          saved += img.data.length;
        }
      }
      const count = msg.images.length;
      msg.images = [];
      // Append placeholder to content
      const placeholder = `[${count} image(s) removed for space]`;
      if (typeof msg.content === 'string') {
        if (!msg.content.includes('[image(s) removed')) {
          msg.content += `\n${placeholder}`;
        }
      }
    }

    // 2. Handle structured content blocks (Anthropic format)
    if (Array.isArray(msg.content)) {
      const newContent = [];
      for (const block of msg.content) {
        if (block.type === 'image') {
          // base64 image block - replace with text placeholder
          const dataLen = (block.source?.data || '').length;
          saved += dataLen;
          newContent.push({
            type: 'text',
            text: '[screenshot removed for space]'
          });
        } else if (block.type === 'tool_result' && typeof block.content === 'string') {
          // Check if tool_result contains embedded base64
          const b64Regex = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{1000,}/g;
          const matches = block.content.match(b64Regex);
          if (matches) {
            let cleaned = block.content;
            for (const match of matches) {
              saved += match.length;
              cleaned = cleaned.replace(match, '[base64 image removed for space]');
            }
            newContent.push({ ...block, content: cleaned });
          } else {
            newContent.push(block);
          }
        } else {
          newContent.push(block);
        }
      }
      msg.content = newContent;
    }

    // 3. Handle string content with embedded base64
    if (typeof msg.content === 'string') {
      const b64Regex = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{1000,}/g;
      const matches = msg.content.match(b64Regex);
      if (matches) {
        for (const match of matches) {
          saved += match.length;
          msg.content = msg.content.replace(match, '[base64 image removed for space]');
        }
      }
    }

    return saved;
  }

  /**
   * Get compaction stats.
   */
  get compactionStats() {
    return {
      tokensSaved: this._tokensSaved,
      compactedCount: this._compactedCount,
      currentBytes: this._estimateTotalBytes(),
      threshold: this._compactionThreshold
    };
  }

  /**
   * Trim conversation to fit within token budget.
   * Keeps system prompt and recent messages.
   */
  trimToFit() {
    // First try compaction (strip images) before dropping messages entirely
    this.compactIfNeeded();

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

    // Keep first (system) and last 6 messages, trim middle.
    // IMPORTANT: Remove tool_calls + tool_response pairs together to avoid
    // "tool_call_id not found" errors from OpenAI-compatible APIs.
    while (totalTokens > this.maxTokens && this.messages.length > 8) {
      const removeIdx = 1; // After system prompt
      const msg = this.messages[removeIdx];

      // Check if this is an assistant message with tool_calls (OpenAI format)
      const hasToolCalls = msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0;

      // Check if this is an assistant message with tool_use content blocks (Anthropic format)
      const hasToolUseBlocks = msg.role === 'assistant' && Array.isArray(msg.content) &&
        msg.content.some(b => b.type === 'tool_use');

      if (hasToolCalls || hasToolUseBlocks) {
        // Count how many follow-up tool response messages to remove together
        let pairCount = 1; // Start with the assistant message itself
        const toolCallIds = new Set();

        if (hasToolCalls) {
          for (const tc of msg.tool_calls) {
            if (tc.id) toolCallIds.add(tc.id);
          }
        } else if (hasToolUseBlocks) {
          for (const block of msg.content) {
            if (block.type === 'tool_use' && block.id) toolCallIds.add(block.id);
          }
        }

        // Look ahead for matching tool response messages
        for (let j = removeIdx + 1; j < this.messages.length && toolCallIds.size > 0; j++) {
          const next = this.messages[j];
          // OpenAI format: role=tool with tool_call_id
          if (next.role === 'tool' && next.tool_call_id && toolCallIds.has(next.tool_call_id)) {
            toolCallIds.delete(next.tool_call_id);
            pairCount++;
            continue;
          }
          // Anthropic format: role=user with tool_result content blocks
          if (next.role === 'user' && Array.isArray(next.content)) {
            let found = false;
            for (const block of next.content) {
              if (block.type === 'tool_result' && block.tool_use_id && toolCallIds.has(block.tool_use_id)) {
                toolCallIds.delete(block.tool_use_id);
                found = true;
              }
            }
            if (found) {
              pairCount++;
              continue;
            }
          }
          break; // Stop if next message is not a matching tool response
        }

        // Remove the entire pair (assistant + tool responses) together
        for (let k = 0; k < pairCount; k++) {
          totalTokens -= estimateTokens(this.messages[removeIdx]);
          this.messages.splice(removeIdx, 1);
        }
      } else if (msg.role === 'tool' || (msg.role === 'user' && Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool_result'))) {
        // Orphan tool response without a preceding assistant tool_calls — remove it
        totalTokens -= estimateTokens(msg);
        this.messages.splice(removeIdx, 1);
      } else {
        // Regular message (user text, assistant text) — safe to remove individually
        totalTokens -= estimateTokens(this.messages[removeIdx]);
        this.messages.splice(removeIdx, 1);
      }
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
