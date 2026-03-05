/**
 * LLM Client - Multi-provider LLM API client.
 * Supports: OpenAI, Anthropic, Google, OpenRouter, Ollama, OpenAI-compatible.
 * For Anthropic/Claude: uses native tool_use API (like Claude extension).
 */

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_TOKENS = 10000;

let currentAbortController = null;

/**
 * Call LLM API with messages.
 * @param {Array} messages - Conversation messages with { role, content, images? }
 * @param {Object} settings - Provider settings
 * @param {boolean} useVision - Whether to include images
 * @param {Array} toolSchemas - Tool schemas for native tool_use (optional)
 * @param {Object} extraOptions - { quickMode: boolean } for Quick Mode support
 * @returns {Object} { text, toolUse } - text response and/or structured tool_use
 */
export async function callLLM(messages, settings, useVision = false, toolSchemas = null, extraOptions = {}) {
  let { provider, apiKey, model, baseUrl } = settings;
  const configuredTimeout = Number(settings?.llmTimeoutMs);
  const llmTimeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(300000, Math.max(15000, configuredTimeout))
    : DEFAULT_TIMEOUT_MS;
  const enableThinking = !!settings?.enableThinking;
  const thinkingBudgetTokens = Math.min(3072, Math.max(1024, Number(settings?.thinkingBudgetTokens) || 1024));

  // Model name normalization
  if (model === 'custom' && settings.customModel) model = settings.customModel;
  if (!model || model === 'custom') model = 'gpt-4o';

  const isClaudeModel = /claude/i.test(String(model));
  const isOpenAIStyleProvider = provider === 'openai' || provider === 'openai-compatible';
  const claudeThinkingEnabled = enableThinking && isClaudeModel;

  let endpoint, headers, body;

  // Auto-detect Anthropic Messages API format for openai-compatible provider
  const isAnthropicEndpoint = provider === 'openai-compatible'
    && typeof baseUrl === 'string'
    && /\/v1\/messages\/?$/i.test(baseUrl.replace(/\/+$/, ''));

  // Determine if we should use native tool_use/function calling
  const hasTools = toolSchemas && toolSchemas.length > 0;
  const isQuickMode = !!extraOptions.quickMode;
  const useNativeTools = hasTools && !isQuickMode; // Quick Mode sends no tools

  switch (provider) {
    case 'openai':
    case 'openai-compatible':
      if (isAnthropicEndpoint) {
        ({ endpoint, headers, body } = _buildAnthropicRequest(
          messages, model, apiKey, baseUrl, useVision, claudeThinkingEnabled, thinkingBudgetTokens,
          hasTools ? toolSchemas : null
        ));
        delete headers['x-api-key'];
        delete headers['anthropic-version'];
        headers['Authorization'] = `Bearer ${apiKey}`;
        provider = '_anthropic_via_openai_compat';
      } else {
        ({ endpoint, headers, body } = _buildOpenAIRequest(
          messages, model, apiKey, baseUrl, useVision, claudeThinkingEnabled,
          isClaudeModel && isOpenAIStyleProvider, thinkingBudgetTokens,
          hasTools ? toolSchemas : null
        ));
      }
      break;

    case 'anthropic':
      ({ endpoint, headers, body } = _buildAnthropicRequest(
        messages, model, apiKey, baseUrl, useVision, claudeThinkingEnabled, thinkingBudgetTokens,
        hasTools ? toolSchemas : null
      ));
      break;

    case 'google':
      ({ endpoint, headers, body } = _buildGoogleRequest(
        messages, model, apiKey, useVision,
        hasTools ? toolSchemas : null
      ));
      break;

    case 'openrouter':
      ({ endpoint, headers, body } = _buildOpenRouterRequest(
        messages, model, apiKey, useVision,
        hasTools ? toolSchemas : null
      ));
      break;

    case 'ollama':
      ({ endpoint, headers, body } = _buildOllamaRequest(messages, model, baseUrl, useVision));
      break;

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  // Quick Mode: override tools with empty array and add stop sequences
  if (isQuickMode) {
    if (body.tools) delete body.tools;
    if (body.tool_choice) delete body.tool_choice;
    body.stop = ['\n<<END>>'];
  }

  console.log('[LLM] Request:', { endpoint: endpoint?.substring(0, 120), provider, model, timeout: llmTimeoutMs, nativeTools: useNativeTools, quickMode: isQuickMode, bodyKeys: Object.keys(body) });

  // Determine if we should use streaming
  const enableStreaming = !!extraOptions.stream && _isStreamableProvider(provider);
  const onThinking = extraOptions.onThinking; // callback for partial text

  if (enableStreaming) {
    try {
      return await _callLLMStreaming(endpoint, headers, body, provider, useNativeTools, isQuickMode, llmTimeoutMs, onThinking);
    } catch (streamError) {
      console.warn('[LLM] Streaming failed, falling back to non-streaming:', streamError.message);
      // Fall through to non-streaming
    }
  }

  // Execute request with timeout (non-streaming)
  let response;
  let abortedByTimeout = false;
  currentAbortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortedByTimeout = true;
    currentAbortController?.abort();
  }, llmTimeoutMs);

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: currentAbortController.signal
    });
  } catch (fetchError) {
    if (fetchError.name === 'AbortError') {
      throw new Error(abortedByTimeout ? `Request timed out after ${Math.round(llmTimeoutMs / 1000)}s` : 'Request cancelled');
    }
    throw new Error(`Network error: ${fetchError.message}`);
  } finally {
    clearTimeout(timeoutId);
    currentAbortController = null;
  }

  const responseText = await response.text();
  console.log('[LLM] Response status:', response.status, 'length:', responseText.length, 'preview:', responseText.substring(0, 200));
  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} - ${responseText.substring(0, 500)}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
  }

  if (data?.error) {
    const errMsg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
    throw new Error(`LLM provider error: ${errMsg}`);
  }

  // Quick Mode: return raw text response (no tool parsing)
  if (isQuickMode) {
    const textContent = data.choices?.[0]?.message?.content
      || (Array.isArray(data.content) ? data.content.filter(b => b.type === 'text').map(b => b.text).join('') : '')
      || '';
    return { text: textContent, toolUse: null, thinking: '', quickMode: true, _raw: data };
  }

  // For native tool use: return structured result based on provider
  if (useNativeTools) {
    if (provider === 'anthropic' || provider === '_anthropic_via_openai_compat') {
      return _extractAnthropicToolUse(data);
    }
    if (provider === 'google') {
      const googleTool = _extractGoogleToolCall(data);
      if (googleTool) return googleTool;
      // No function call in response (model chose end_turn with tool_config:AUTO)
      const googleText = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      if (googleText) {
        return { text: googleText, toolUse: null, thinking: '', _raw: data };
      }
    }
    // OpenAI / OpenRouter / openai-compatible
    if (['openai', 'openai-compatible', 'openrouter'].includes(provider)) {
      const openaiTool = _extractOpenAIToolCall(data);
      if (openaiTool) return openaiTool;
      // No tool_calls in response (model chose end_turn with tool_choice:auto)
      // Return structured object so agent-loop can handle it properly
      const textContent = data.choices?.[0]?.message?.content || '';
      if (textContent) {
        return { text: textContent, toolUse: null, thinking: '', _raw: data };
      }
    }
  }

  // For text-based providers: return text string (legacy)
  return _extractResponseText(data, provider);
}

/**
 * Cancel any in-flight LLM request.
 */
export function cancelLLMRequest() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

// ========== Streaming Support ==========

/**
 * Check if a provider supports SSE streaming.
 */
function _isStreamableProvider(provider) {
  return ['openai', 'openai-compatible', 'openrouter'].includes(provider);
}

/**
 * Call LLM with SSE streaming. Accumulates text and tool_calls from chunks.
 * Emits partial text via onThinking callback for real-time UI updates.
 * @returns {Object} Same format as non-streaming: { text, toolUse, thinking, _raw }
 */
async function _callLLMStreaming(endpoint, headers, body, provider, useNativeTools, isQuickMode, timeoutMs, onThinking) {
  // Enable streaming in the request body
  const streamBody = { ...body, stream: true };

  currentAbortController = new AbortController();
  let abortedByTimeout = false;
  const timeoutId = setTimeout(() => {
    abortedByTimeout = true;
    currentAbortController?.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(streamBody),
      signal: currentAbortController.signal
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    currentAbortController = null;
    if (fetchError.name === 'AbortError') {
      throw new Error(abortedByTimeout ? `Stream timed out after ${Math.round(timeoutMs / 1000)}s` : 'Stream cancelled');
    }
    throw new Error(`Stream network error: ${fetchError.message}`);
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    currentAbortController = null;
    const errText = await response.text();
    throw new Error(`Stream API error: ${response.status} - ${errText.substring(0, 500)}`);
  }

  // Parse SSE stream
  let accumulatedText = '';
  let toolCallId = null;
  let toolCallName = '';
  let toolCallArgs = '';
  let finishReason = null;

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.substring(6).trim();
        if (data === '[DONE]') continue;

        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue; // Skip malformed chunks
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Accumulate text content
        if (delta.content) {
          accumulatedText += delta.content;
          // Emit partial text for real-time UI
          if (onThinking && typeof onThinking === 'function') {
            try { onThinking(delta.content, accumulatedText); } catch(e) {}
          }
        }

        // Accumulate tool calls
        if (delta.tool_calls && delta.tool_calls.length > 0) {
          const tc = delta.tool_calls[0];
          if (tc.id) toolCallId = tc.id;
          if (tc.function?.name) toolCallName = tc.function.name;
          if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
        }

        // Track finish reason
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
    currentAbortController = null;
  }

  // Build response in same format as non-streaming
  if (isQuickMode) {
    return { text: accumulatedText, toolUse: null, thinking: '', quickMode: true };
  }

  if (useNativeTools && toolCallName) {
    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(toolCallArgs || '{}');
    } catch (e) {
      console.warn('[LLM/Stream] Failed to parse tool_calls arguments:', e.message);
    }
    return {
      text: accumulatedText,
      toolUse: {
        id: toolCallId || `call_${Date.now()}`,
        name: toolCallName,
        parameters: parsedArgs
      },
      thinking: ''
    };
  }

  // No tool call — return text (may signal end of task)
  if (useNativeTools) {
    return { text: accumulatedText, toolUse: null, thinking: '' };
  }

  // Legacy text mode
  return accumulatedText;
}

// ========== Provider-specific request builders ==========

function _detectMimeType(dataUrl) {
  const match = dataUrl.match(/^data:(image\/\w+);base64,/);
  if (match) return match[1];
  const raw = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  if (raw.startsWith('/9j/') || raw.startsWith('/9j+')) return 'image/jpeg';
  if (raw.startsWith('iVBOR')) return 'image/png';
  if (raw.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

function _formatMessagesWithImages(messages, useVision, imageFormat = 'openai') {
  return messages.map(m => {
    // Pass through tool role messages (OpenAI tool results)
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
    }

    // Pass through assistant messages with tool_calls (OpenAI format)
    if (m.role === 'assistant' && m.tool_calls) {
      const result = { role: 'assistant', tool_calls: m.tool_calls };
      if (m.content) result.content = m.content;
      return result;
    }

    // If content is already structured (array of blocks), pass through as-is
    // This handles Anthropic native tool_use/tool_result blocks
    if (Array.isArray(m.content)) {
      if (m.images && useVision && m.images.length > 0 && imageFormat === 'anthropic') {
        return {
          role: m.role,
          content: [
            ...m.images.map(img => ({
              type: 'image',
              source: { type: 'base64', media_type: _detectMimeType(img), data: img.replace(/^data:image\/\w+;base64,/, '') }
            })),
            ...m.content
          ]
        };
      }
      return { role: m.role, content: m.content };
    }

    // String content with images
    if (m.images && useVision && m.images.length > 0) {
      if (imageFormat === 'anthropic') {
        return {
          role: m.role,
          content: [
            ...m.images.map(img => ({
              type: 'image',
              source: { type: 'base64', media_type: _detectMimeType(img), data: img.replace(/^data:image\/\w+;base64,/, '') }
            })),
            { type: 'text', text: m.content }
          ]
        };
      }
      // OpenAI format
      return {
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          ...m.images.map(img => ({ type: 'image_url', image_url: { url: img, detail: 'high' } }))
        ]
      };
    }

    // Plain string content
    return { role: m.role, content: m.content };
  });
}

/**
 * Convert tool schemas to Anthropic tools format.
 * Maps crab-agent tool definitions → Anthropic API tool schema.
 * Also ensures array types have 'items' for cross-provider compatibility.
 */
function _buildAnthropicTools(toolSchemas) {
  return toolSchemas.map(tool => {
    const paramEntries = Object.entries(tool.parameters || {});

    // Tools with no parameters (done, ask_user, etc.)
    if (paramEntries.length === 0) {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: { type: 'object', properties: {} }
      };
    }

    const properties = {};
    const required = [];

    for (const [name, spec] of paramEntries) {
      const prop = { type: spec.type || 'string' };
      if (spec.description) prop.description = spec.description;
      if (spec.enum) prop.enum = spec.enum;
      if (spec.items) prop.items = spec.items;
      if (spec.minimum !== undefined) prop.minimum = spec.minimum;
      if (spec.maximum !== undefined) prop.maximum = spec.maximum;
      if (spec.minItems !== undefined) prop.minItems = spec.minItems;
      if (spec.maxItems !== undefined) prop.maxItems = spec.maxItems;
      // Copy nested properties for object types
      if (spec.properties) prop.properties = spec.properties;
      if (spec.required && typeof spec.required !== 'boolean') prop.required = spec.required;

      // Safety: array type should have 'items'
      if (prop.type === 'array' && !prop.items) {
        prop.items = { type: 'object' };
      }

      properties[name] = prop;

      // Mark as required if spec says so, or if it's the primary action/command parameter
      if (spec.required === true || name === 'action') {
        required.push(name);
      }
    }

    const schema = { type: 'object', properties };
    if (required.length > 0) schema.required = required;

    return {
      name: tool.name,
      description: tool.description,
      input_schema: schema
    };
  });
}

/**
 * Convert tool schemas to OpenAI function calling format.
 * Used by OpenAI, OpenRouter, and openai-compatible providers.
 * Ensures all array types have 'items' (required by OpenAI strict schema validation).
 */
function _buildOpenAITools(toolSchemas) {
  return toolSchemas.map(tool => {
    const paramEntries = Object.entries(tool.parameters || {});
    const properties = {};
    const required = [];

    for (const [name, spec] of paramEntries) {
      const prop = { type: spec.type || 'string' };
      if (spec.description) prop.description = spec.description;
      if (spec.enum) prop.enum = spec.enum;
      if (spec.items) prop.items = spec.items;
      if (spec.minimum !== undefined) prop.minimum = spec.minimum;
      if (spec.maximum !== undefined) prop.maximum = spec.maximum;
      // Copy nested properties for object types
      if (spec.properties) prop.properties = spec.properties;
      if (spec.required && typeof spec.required !== 'boolean') prop.required = spec.required;
      if (spec.minItems !== undefined) prop.minItems = spec.minItems;
      if (spec.maxItems !== undefined) prop.maxItems = spec.maxItems;

      // OpenAI strict validation: array type MUST have 'items'. Auto-fix if missing.
      if (prop.type === 'array' && !prop.items) {
        prop.items = { type: 'object' };
      }

      properties[name] = prop;

      if (spec.required === true || name === 'action') {
        required.push(name);
      }
    }

    const schema = { type: 'object', properties };
    if (required.length > 0) schema.required = required;

    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: schema
      }
    };
  });
}

/**
 * Convert tool schemas to Google Gemini function_declarations format.
 */
function _buildGoogleTools(toolSchemas) {
  return [{
    function_declarations: toolSchemas.map(tool => {
      const paramEntries = Object.entries(tool.parameters || {});
      const properties = {};
      const required = [];

      for (const [name, spec] of paramEntries) {
        const prop = { type: (spec.type || 'string').toUpperCase() };
        if (spec.description) prop.description = spec.description;
        if (spec.enum) prop.enum = spec.enum;
        properties[name] = prop;

        if (spec.required || name === 'action') {
          required.push(name);
        }
      }

      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'OBJECT',
          properties,
          ...(required.length > 0 ? { required } : {})
        }
      };
    })
  }];
}

function _buildOpenAIRequest(messages, model, apiKey, baseUrl, useVision, claudeThinking, requiresTemp1, thinkingBudget, toolSchemas = null) {
  let base = (baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
  const endpoint = base.includes('/chat/completions') ? base :
    base.endsWith('/v1') ? base + '/chat/completions' : base + '/v1/chat/completions';

  const isNewModel = /^(gpt-5|gpt-6|gpt-7|o1|o3|o4)/i.test(model);
  const body = {
    model,
    messages: _formatMessagesWithImages(messages, useVision, 'openai'),
    temperature: requiresTemp1 ? 1 : 0.1,
    ...(isNewModel ? { max_completion_tokens: DEFAULT_MAX_TOKENS } : { max_tokens: DEFAULT_MAX_TOKENS })
  };

  // Add function calling tools
  if (toolSchemas) {
    body.tools = _buildOpenAITools(toolSchemas);
    body.tool_choice = 'auto'; // Let model decide (matches Claude 1.0.56)
  }

  // Only send thinking parameter when the endpoint actually supports it.
  // OpenAI-compatible gateways (non-Anthropic) typically don't understand the thinking field.
  // Note: this function is only called for non-Anthropic OpenAI-compatible endpoints.
  // Anthropic-endpoint detection routes to _buildAnthropicRequest instead.
  // Skip thinking here — gateway will ignore or error on unknown field.
  // (Thinking is properly handled in _buildAnthropicRequest for direct Anthropic API)

  return {
    endpoint,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body
  };
}

function _buildAnthropicRequest(messages, model, apiKey, baseUrl, useVision, claudeThinking, thinkingBudget, toolSchemas = null) {
  const endpoint = baseUrl || 'https://api.anthropic.com/v1/messages';
  const sysMsg = messages.find(m => m.role === 'system');
  const nonSysMsgs = messages.filter(m => m.role !== 'system');

  // Determine if thinking will actually be used
  const effectiveThinking = claudeThinking;

  const body = {
    model,
    system: sysMsg?.content || '',
    messages: _formatMessagesWithImages(nonSysMsgs, useVision, 'anthropic'),
    temperature: effectiveThinking ? 1 : 0.1,
    max_tokens: DEFAULT_MAX_TOKENS
  };

  // Add native tools if provided
  if (toolSchemas) {
    body.tools = _buildAnthropicTools(toolSchemas);
    // Let model decide — matches Claude 1.0.56 behavior
    body.tool_choice = { type: 'auto' };
  }

  // With tool_choice='auto', thinking is compatible with tools
  if (effectiveThinking) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
    body.max_tokens = Math.max(body.max_tokens, thinkingBudget + 512);
  }

  return {
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body
  };
}

function _buildGoogleRequest(messages, model, apiKey, useVision, toolSchemas = null) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: messages.filter(m => m.role !== 'system').map(m => {
      const parts = [{ text: m.content }];
      if (m.images && useVision) {
        for (const img of m.images) {
          parts.push({ inline_data: { mime_type: _detectMimeType(img), data: img.replace(/^data:image\/\w+;base64,/, '') } });
        }
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    }),
    generationConfig: { temperature: 0.1, maxOutputTokens: 8000 }
  };

  // Add function declarations
  if (toolSchemas) {
    body.tools = _buildGoogleTools(toolSchemas);
    body.tool_config = { function_calling_config: { mode: 'AUTO' } };
  }

  return { endpoint, headers: { 'Content-Type': 'application/json' }, body };
}

function _buildOpenRouterRequest(messages, model, apiKey, useVision, toolSchemas = null) {
  const isNewModel = /^(openai\/gpt-5|openai\/o1|openai\/o3|gpt-5|o1|o3)/i.test(model);
  const body = {
    model,
    messages: _formatMessagesWithImages(messages, useVision, 'openai'),
    temperature: 0.1,
    ...(isNewModel ? { max_completion_tokens: DEFAULT_MAX_TOKENS } : { max_tokens: DEFAULT_MAX_TOKENS })
  };

  // Add function calling tools (OpenRouter uses OpenAI format)
  if (toolSchemas) {
    body.tools = _buildOpenAITools(toolSchemas);
    body.tool_choice = 'auto';
  }

  return {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://crab-agent.extension'
    },
    body
  };
}

function _buildOllamaRequest(messages, model, baseUrl, useVision) {
  return {
    endpoint: (baseUrl || 'http://localhost:11434') + '/api/chat',
    headers: { 'Content-Type': 'application/json' },
    body: {
      model,
      messages: messages.map(m => {
        const mapped = { role: m.role, content: m.content };
        if (m.images && useVision && m.images.length > 0) {
          mapped.images = m.images.map(img => img.replace(/^data:image\/\w+;base64,/, ''));
        }
        return mapped;
      }),
      stream: false,
      options: { temperature: 0.1 }
    }
  };
}

// ========== Response extraction ==========

/**
 * Extract structured tool_use from Anthropic response.
 * Returns { text, toolUse: { id, name, parameters }, thinking }
 */
function _extractAnthropicToolUse(data) {
  if (!data.content || !Array.isArray(data.content)) {
    throw new Error('Invalid Anthropic response: no content array');
  }

  let text = '';
  let toolUse = null;
  let thinking = '';

  for (const block of data.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolUse = {
        id: block.id,
        name: block.name,
        parameters: block.input || {}
      };
    } else if (block.type === 'thinking') {
      thinking = block.thinking || '';
    }
  }

  return { text, toolUse, thinking, _raw: data };
}

/**
 * Extract tool_calls from OpenAI/OpenRouter response.
 * Returns { text, toolUse: { id, name, parameters } } or null if no tool call.
 */
function _extractOpenAIToolCall(data) {
  const message = data.choices?.[0]?.message;
  if (!message?.tool_calls || message.tool_calls.length === 0) return null;

  const toolCall = message.tool_calls[0]; // Take first tool call
  let args = {};
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}');
  } catch (e) {
    console.warn('[LLM] Failed to parse OpenAI tool_calls arguments:', e.message);
  }

  return {
    text: message.content || '',
    toolUse: {
      id: toolCall.id || `call_${Date.now()}`,
      name: toolCall.function?.name,
      parameters: args
    },
    thinking: '',
    _raw: data
  };
}

/**
 * Extract function call from Google Gemini response.
 * Returns { text, toolUse: { id, name, parameters } } or null if no function call.
 */
function _extractGoogleToolCall(data) {
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) return null;

  let text = '';
  let toolUse = null;

  for (const part of candidate.content.parts) {
    if (part.text) text += part.text;
    if (part.functionCall) {
      toolUse = {
        id: `gemini_${Date.now()}`,
        name: part.functionCall.name,
        parameters: part.functionCall.args || {}
      };
    }
  }

  if (!toolUse) return null;
  return { text, toolUse, thinking: '', _raw: data };
}

function _extractResponseText(data, provider) {
  let text = null;

  switch (provider) {
    case 'openai':
    case 'openai-compatible':
    case 'openrouter': {
      const message = data.choices?.[0]?.message;
      if (message) {
        if (Array.isArray(message.content)) {
          text = message.content
            .map(part => typeof part === 'string' ? part : (part?.text || ''))
            .filter(Boolean)
            .join('\n');
        } else {
          text = message.content || message.reasoning_content || null;
        }
      }
      if (!text && data.content && Array.isArray(data.content)) {
        text = data.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n') || null;
      }
      break;
    }
    case 'anthropic':
    case '_anthropic_via_openai_compat': {
      if (Array.isArray(data.content)) {
        text = data.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n') || null;
      } else {
        text = data.content?.[0]?.text || null;
      }
      break;
    }
    case 'google':
      text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      break;
    case 'ollama':
      text = data.message?.content;
      break;
  }

  if (!text) {
    throw new Error(`No response content from ${provider}. Keys: ${JSON.stringify(Object.keys(data))}`);
  }

  return text;
}

export default { callLLM, cancelLLMRequest };
