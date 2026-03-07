/**
 * Message Manager - Manages conversation history for LLM calls.
 * Handles message formatting, token budgeting, and image attachments.
 * Supports both text-based and structured content (for Anthropic native tool_use).
 */

export class MessageManager {
  constructor(maxTokens = 128000) {
    this.messages = [];
    this.maxTokens = maxTokens;
    // Claude-style compaction thresholds (progressive)
    this._compactionThresholds = {
      soft: 15 * 1024 * 1024,   // 15MB - start stripping old images
      hard: 25 * 1024 * 1024,   // 25MB - aggressive image removal
      critical: 35 * 1024 * 1024 // 35MB - drop old messages entirely
    };
    this._tokensSaved = 0;
    this._bytesSaved = 0;
    this._compactedCount = 0;
    this._imagesRemoved = 0;
    this._onCompaction = null;  // Callback for UI updates
  }

  /**
   * Set callback for compaction events (for UI display).
   */
  onCompaction(callback) {
    this._onCompaction = callback;
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
   * Compact messages using progressive thresholds (Claude-style).
   * - Soft (15MB): Strip images from old messages, keep recent 8
   * - Hard (25MB): Aggressive image removal, keep recent 4
   * - Critical (35MB): Drop old messages entirely
   *
   * @param {boolean} force - Force compaction regardless of threshold
   * @returns {{ compacted: boolean, bytesSaved: number, level: string }}
   */
  compactIfNeeded(force = false) {
    const totalBytes = this._estimateTotalBytes();
    const { soft, hard, critical } = this._compactionThresholds;

    // Determine compaction level
    let level = 'none';
    let keepRecent = 8;

    if (totalBytes >= critical) {
      level = 'critical';
      keepRecent = 2;
    } else if (totalBytes >= hard) {
      level = 'hard';
      keepRecent = 4;
    } else if (totalBytes >= soft || force) {
      level = 'soft';
      keepRecent = 8;
    } else {
      return { compacted: false, bytesSaved: 0, level: 'none' };
    }

    console.log(`[MessageManager] Compacting (${level}): ${(totalBytes / 1024 / 1024).toFixed(1)}MB`);

    const protectedEnd = Math.max(1, this.messages.length - keepRecent);
    let saved = 0;
    let imagesRemoved = 0;

    // Phase 1: Strip images from older messages
    for (let i = 1; i < protectedEnd; i++) {
      const msg = this.messages[i];
      const result = this._compactMessage(msg, level === 'hard' || level === 'critical');
      saved += result.bytes;
      imagesRemoved += result.images;
    }

    // Phase 2: Critical level - drop very old messages (keep system + recent)
    if (level === 'critical' && this.messages.length > keepRecent + 3) {
      const dropCount = Math.min(
        Math.floor((this.messages.length - keepRecent - 1) / 2),
        10  // Max 10 messages at a time
      );

      if (dropCount > 0) {
        // Remove oldest non-system messages, respecting tool_use/tool_result pairs
        let dropped = 0;
        let idx = 1;
        while (dropped < dropCount && idx < this.messages.length - keepRecent) {
          const msg = this.messages[idx];

          // Skip if this would orphan a tool_result
          const isToolCall = (msg.role === 'assistant' && msg.tool_calls) ||
            (msg.role === 'assistant' && Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool_use'));

          if (isToolCall) {
            // Find and remove the pair together
            const pairResult = this._removeToolPair(idx);
            saved += pairResult.bytes;
            dropped += pairResult.count;
          } else if (msg.role === 'tool' ||
                     (msg.role === 'user' && Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool_result'))) {
            // Orphan tool response - skip it (will be cleaned by next pair removal)
            idx++;
          } else {
            saved += this._estimateMsgBytes(msg);
            this.messages.splice(idx, 1);
            dropped++;
          }
        }
        console.log(`[MessageManager] Critical: dropped ${dropped} old messages`);
      }
    }

    if (saved > 0) {
      this._bytesSaved += saved;
      this._tokensSaved += Math.ceil(saved / 4);
      this._imagesRemoved += imagesRemoved;
      this._compactedCount++;

      const stats = {
        level,
        bytesSaved: saved,
        totalBytesSaved: this._bytesSaved,
        tokensSaved: this._tokensSaved,
        imagesRemoved: this._imagesRemoved,
        compactionCount: this._compactedCount,
        currentSize: this._estimateTotalBytes(),
        messageCount: this.messages.length
      };

      console.log(`[MessageManager] Compaction #${this._compactedCount}: -${(saved / 1024).toFixed(0)}KB (${this._tokensSaved} tokens saved, ${this._imagesRemoved} images removed)`);

      // Notify UI if callback is set
      if (this._onCompaction) {
        try { this._onCompaction(stats); } catch (e) {}
      }
    }

    return { compacted: saved > 0, bytesSaved: saved, level };
  }

  /**
   * Remove a tool_use + tool_result pair starting at index.
   * @returns {{ bytes: number, count: number }}
   */
  _removeToolPair(startIdx) {
    const msg = this.messages[startIdx];
    let bytes = this._estimateMsgBytes(msg);
    let count = 1;

    // Collect tool IDs
    const toolIds = new Set();
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id) toolIds.add(tc.id);
      }
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.id) toolIds.add(block.id);
      }
    }

    // Find matching tool responses
    const toRemove = [startIdx];
    for (let j = startIdx + 1; j < this.messages.length && toolIds.size > 0; j++) {
      const next = this.messages[j];
      let matched = false;

      if (next.role === 'tool' && next.tool_call_id && toolIds.has(next.tool_call_id)) {
        toolIds.delete(next.tool_call_id);
        matched = true;
      } else if (next.role === 'user' && Array.isArray(next.content)) {
        for (const block of next.content) {
          if (block.type === 'tool_result' && block.tool_use_id && toolIds.has(block.tool_use_id)) {
            toolIds.delete(block.tool_use_id);
            matched = true;
          }
        }
      }

      if (matched) {
        toRemove.push(j);
        bytes += this._estimateMsgBytes(next);
        count++;
      } else {
        break;
      }
    }

    // Remove in reverse order to preserve indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.messages.splice(toRemove[i], 1);
    }

    return { bytes, count };
  }

  /**
   * Compact a single message: strip base64 images, replace with placeholders.
   * @param {Object} msg - Message to compact
   * @param {boolean} aggressive - If true, also strip large text content
   * @returns {{ bytes: number, images: number }} Bytes and images removed
   */
  _compactMessage(msg, aggressive = false) {
    let saved = 0;
    let imagesRemoved = 0;

    // 1. Handle .images array (our custom format for screenshots)
    if (msg.images && msg.images.length > 0) {
      for (const img of msg.images) {
        if (typeof img === 'string' && img.length > 500) {
          saved += img.length;
          imagesRemoved++;
        } else if (img?.data && img.data.length > 500) {
          saved += img.data.length;
          imagesRemoved++;
        }
      }
      const count = msg.images.length;
      msg.images = [];
      // Append placeholder to content
      const placeholder = `[${count} screenshot(s) removed - conversation compacted]`;
      if (typeof msg.content === 'string') {
        if (!msg.content.includes('screenshot(s) removed') && !msg.content.includes('image(s) removed')) {
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
          imagesRemoved++;
          newContent.push({
            type: 'text',
            text: '[screenshot removed - conversation compacted]'
          });
        } else if (block.type === 'image_url' && block.image_url?.url) {
          // OpenAI image_url format
          const urlLen = block.image_url.url.length;
          if (block.image_url.url.startsWith('data:')) {
            saved += urlLen;
            imagesRemoved++;
            newContent.push({
              type: 'text',
              text: '[screenshot removed - conversation compacted]'
            });
          } else {
            newContent.push(block);
          }
        } else if (block.type === 'tool_result') {
          // Check if tool_result contains embedded base64
          const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '');
          const b64Regex = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{500,}/g;
          const matches = content.match(b64Regex);
          if (matches) {
            let cleaned = content;
            for (const match of matches) {
              saved += match.length;
              imagesRemoved++;
              cleaned = cleaned.replace(match, '[screenshot removed]');
            }
            newContent.push({ ...block, content: cleaned });
          } else {
            newContent.push(block);
          }
        } else if (block.type === 'text' && aggressive && block.text && block.text.length > 5000) {
          // Aggressive mode: truncate very long text blocks
          const truncated = block.text.substring(0, 2000) + '\n[...truncated for space...]';
          saved += block.text.length - truncated.length;
          newContent.push({ ...block, text: truncated });
        } else {
          newContent.push(block);
        }
      }
      msg.content = newContent;
    }

    // 3. Handle string content with embedded base64
    if (typeof msg.content === 'string') {
      const b64Regex = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{500,}/g;
      const matches = msg.content.match(b64Regex);
      if (matches) {
        for (const match of matches) {
          saved += match.length;
          imagesRemoved++;
          msg.content = msg.content.replace(match, '[screenshot removed]');
        }
      }

      // Aggressive mode: truncate very long string content
      if (aggressive && msg.content.length > 8000) {
        const original = msg.content.length;
        msg.content = msg.content.substring(0, 4000) + '\n[...content truncated for space...]';
        saved += original - msg.content.length;
      }
    }

    return { bytes: saved, images: imagesRemoved };
  }

  /**
   * Get compaction stats for UI display.
   */
  get compactionStats() {
    const currentBytes = this._estimateTotalBytes();
    const { soft, hard, critical } = this._compactionThresholds;

    return {
      tokensSaved: this._tokensSaved,
      bytesSaved: this._bytesSaved,
      imagesRemoved: this._imagesRemoved,
      compactionCount: this._compactedCount,
      currentBytes,
      currentMB: (currentBytes / 1024 / 1024).toFixed(1),
      messageCount: this.messages.length,
      thresholds: { soft, hard, critical },
      level: currentBytes >= critical ? 'critical' :
             currentBytes >= hard ? 'high' :
             currentBytes >= soft ? 'medium' : 'ok',
      percentUsed: Math.round((currentBytes / hard) * 100)
    };
  }

  /**
   * Force immediate compaction (useful before long operations).
   */
  forceCompact() {
    return this.compactIfNeeded(true);
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
   * Export conversation history for storage (Claude-style conversation memory).
   * Strips base64 images but preserves text, tool_use, tool_result structure.
   * @returns {Array} Storable message history
   */
  exportForStorage() {
    const exported = [];

    for (const msg of this.messages) {
      const clone = { role: msg.role };

      // Handle content
      if (typeof msg.content === 'string') {
        // Strip embedded base64
        clone.content = msg.content.replace(
          /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g,
          '[image]'
        );
      } else if (Array.isArray(msg.content)) {
        clone.content = msg.content.map(block => {
          if (block.type === 'image' || block.type === 'image_url') {
            return { type: 'text', text: '[screenshot]' };
          }
          if (block.type === 'tool_result' && typeof block.content === 'string') {
            return {
              ...block,
              content: block.content.replace(
                /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g,
                '[image]'
              )
            };
          }
          return block;
        });
      } else {
        clone.content = msg.content;
      }

      // Skip images array entirely (too large)
      // Preserve tool_calls for OpenAI format
      if (msg.tool_calls) clone.tool_calls = msg.tool_calls;
      if (msg.tool_call_id) clone.tool_call_id = msg.tool_call_id;

      exported.push(clone);
    }

    return exported;
  }

  /**
   * Import conversation history from storage (restore previous session).
   * @param {Array} history - Previously exported history
   * @param {string} systemPrompt - Current system prompt (replaces stored one)
   */
  importFromStorage(history, systemPrompt) {
    if (!Array.isArray(history) || history.length === 0) return false;

    this.messages = [];

    for (const msg of history) {
      // Skip or replace system prompt with current one
      if (msg.role === 'system') {
        if (systemPrompt) {
          this.messages.push({ role: 'system', content: systemPrompt });
        }
        continue;
      }
      this.messages.push({ ...msg });
    }

    // Ensure system prompt is first if not already
    if (systemPrompt && (this.messages.length === 0 || this.messages[0].role !== 'system')) {
      this.messages.unshift({ role: 'system', content: systemPrompt });
    }

    console.log(`[MessageManager] Imported ${this.messages.length} messages from storage`);
    return true;
  }

  /**
   * Get a summary of the conversation for context (when full history not available).
   * @returns {string} Text summary
   */
  getSummary() {
    const lines = [];
    let actionCount = 0;
    let lastActions = [];

    for (const msg of this.messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'user') {
        const text = typeof msg.content === 'string'
          ? msg.content
          : (msg.content?.find?.(b => b.type === 'text')?.text || '');
        if (text && !text.includes('[screenshot') && text.length > 10) {
          lines.push(`User: ${text.substring(0, 200)}`);
        }
      } else if (msg.role === 'assistant') {
        // Check for tool_use
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool_use') {
              actionCount++;
              lastActions.push(`${block.name}(${JSON.stringify(block.input || {}).substring(0, 50)})`);
              if (lastActions.length > 5) lastActions.shift();
            }
          }
        }
        const text = typeof msg.content === 'string'
          ? msg.content
          : (msg.content?.find?.(b => b.type === 'text')?.text || '');
        if (text && text.length > 20) {
          lines.push(`Assistant: ${text.substring(0, 200)}`);
        }
      }
    }

    let summary = '';
    if (actionCount > 0) {
      summary += `[${actionCount} actions performed. Recent: ${lastActions.join(', ')}]\n`;
    }
    summary += lines.slice(-10).join('\n');

    return summary;
  }

  /**
   * Get message count.
   */
  get length() {
    return this.messages.length;
  }
}

export default MessageManager;
