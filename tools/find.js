/**
 * Find Tool - Semantic element finding with LLM-in-the-loop.
 *
 * Two-stage architecture (matching Claude):
 * 1. Get full accessibility tree from page
 * 2. Send tree to inner LLM call for semantic matching
 * 3. Parse structured results and return with refs + coordinates
 *
 * Falls back to DOM text search when LLM is unavailable.
 */

import { callLLM } from '../core/llm-client.js';

const INNER_LLM_SYSTEM_PROMPT = `You are an element finder for browser automation. Given an accessibility tree and a search query, find matching elements.

Rules:
- Match elements semantically, not just by exact text. E.g. "login button" should match a button with text "Sign In" or "Log In".
- Return up to 20 matches, best matches first.
- Each match must include the ref ID exactly as shown in the tree.
- For coordinates, use the center of the element's bounding box if available.

Response format (STRICT - no other text):
FOUND: <number of matches>
ref | role | name | type | x,y | reason
ref_1 | button | Sign In | submit | 450,320 | Login button matching "login button"
ref_5 | link | Log In | link | 200,180 | Alternative login link

If no matches found, respond exactly:
FOUND: 0`;

export const findTool = {
  name: 'find',
  description: 'Find elements on the page using natural language. Can search by purpose (e.g. "search bar") or text content. Returns up to 20 matching elements with references and coordinates. Uses semantic matching powered by LLM.',
  parameters: {
    query: {
      type: 'string',
      description: 'Natural language description of what to find (e.g. "login button", "search input", "main navigation menu").'
    },
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId.' };
    if (!params.query) return { success: false, error: 'query parameter required.' };

    const query = params.query;

    // CSS selector fast path (no LLM needed)
    if (query.startsWith('css:')) {
      return await _cssSelectorSearch(query, tabId);
    }

    try {
      // Stage 1: Get full accessibility tree
      const treeResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (!window.__generateAccessibilityTree) {
            return { success: false, error: 'Accessibility tree not loaded. Page may not be ready.' };
          }
          // Get full tree (all elements, no viewport filter)
          return window.__generateAccessibilityTree('all', 15, null, true);
        }
      });

      const treePayload = treeResult?.[0]?.result;
      if (!treePayload?.success && treePayload?.error) {
        return { success: false, error: treePayload.error };
      }

      const treeText = (treePayload?.lines || []).join('\n');
      if (!treeText || treeText.length < 10) {
        return { success: true, content: 'Page appears empty or not loaded yet.', message: 'Empty page' };
      }

      // Stage 2: Send to inner LLM for semantic matching
      const settings = await _getSettings();
      if (!settings?.apiKey) {
        // Fallback to DOM text search if no API key
        console.warn('[Find] No API key for inner LLM, falling back to text search');
        return await _domTextSearch(query, tabId);
      }

      const innerMessages = [
        { role: 'system', content: INNER_LLM_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Search query: "${query}"\n\nAccessibility tree:\n${treeText.substring(0, 80000)}`
        }
      ];

      // Use a fast/small model for inner call (prefer haiku-class)
      const innerSettings = {
        ...settings,
        model: _pickInnerModel(settings),
        enableThinking: false
      };

      const llmResponse = await callLLM(innerMessages, innerSettings, false, null);
      const responseText = llmResponse?.text || '';

      // Stage 3: Parse structured response
      const parsed = _parseInnerResponse(responseText);

      if (parsed.count === 0) {
        // LLM found nothing - try DOM fallback
        const fallback = await _domTextSearch(query, tabId);
        if (fallback.matches && fallback.matches.length > 0) {
          return fallback;
        }
        return { success: true, content: `No elements found matching "${query}"`, message: 'No matches' };
      }

      // Build output — coordinates are informational only, agent should use ref for clicking
      const lines = parsed.matches.map(m => {
        return `- [${m.ref}] ${m.role} "${m.name}" — ${m.reason}. Click with: computer(action="left_click", ref="${m.ref}")`;
      });

      return {
        success: true,
        content: `Found ${parsed.count} element(s) for "${query}":\n${lines.join('\n')}`,
        matches: parsed.matches,
        message: `Found ${parsed.count} matches for "${query}" (semantic)`
      };

    } catch (e) {
      console.error('[Find] LLM semantic search failed, falling back to DOM search:', e);
      // Graceful fallback to DOM search
      return await _domTextSearch(query, tabId);
    }
  }
};

/**
 * Pick a fast/cheap inner model for semantic matching.
 * Prefers haiku-class models for low latency.
 */
function _pickInnerModel(settings) {
  const model = (settings.model || '').toLowerCase();
  const provider = settings.provider || '';

  // For Anthropic, use haiku
  if (provider === 'anthropic' || /claude/i.test(model)) {
    return 'claude-haiku-4-5-20250929';
  }
  // For OpenAI, use mini
  if (provider === 'openai') {
    return 'gpt-4o-mini';
  }
  // For Google, use flash
  if (provider === 'google') {
    return 'gemini-2.0-flash';
  }
  // For others, use whatever is configured
  return settings.model;
}

/**
 * Parse the inner LLM response into structured matches.
 */
function _parseInnerResponse(text) {
  const lines = text.trim().split('\n');
  const matches = [];

  // Find the FOUND: line
  const foundLine = lines.find(l => /^FOUND:\s*\d+/i.test(l.trim()));
  if (!foundLine) return { count: 0, matches: [] };

  const count = parseInt(foundLine.match(/FOUND:\s*(\d+)/i)?.[1] || '0');
  if (count === 0) return { count: 0, matches: [] };

  // Parse pipe-delimited rows (skip header row if present)
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('FOUND:') || trimmed.startsWith('SHOWING:')) continue;
    if (trimmed.startsWith('ref |') || trimmed.startsWith('---')) continue; // header

    const parts = trimmed.split('|').map(s => s.trim());
    if (parts.length < 4) continue;

    const ref = parts[0];
    if (!ref.startsWith('ref_')) continue;

    const coords = (parts[4] || '0,0').split(',').map(Number);

    matches.push({
      ref: ref,
      role: parts[1] || 'unknown',
      name: parts[2] || '',
      type: parts[3] || '',
      x: coords[0] || 0,
      y: coords[1] || 0,
      reason: parts[5] || ''
    });

    if (matches.length >= 20) break;
  }

  return { count: matches.length, matches };
}

/**
 * Get current settings from chrome.storage.
 */
async function _getSettings() {
  try {
    const stored = await chrome.storage.local.get('settings');
    return stored.settings || null;
  } catch (e) {
    return null;
  }
}

/**
 * CSS selector search (fast path, no LLM).
 */
async function _cssSelectorSearch(query, tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (q) => {
      const matches = [];
      const MAX_RESULTS = 20;
      const selector = q.replace(/^css:\s*/, '');

      const getOrCreateRef = (el) => {
        for (const [refId, wr] of Object.entries(window.__crabElementMap || {})) {
          const stored = wr.deref ? wr.deref() : wr;
          if (stored === el) return refId;
        }
        const refId = 'ref_' + (++window.__crabRefCounter);
        window.__crabElementMap[refId] = new WeakRef(el);
        return refId;
      };

      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (matches.length >= MAX_RESULTS) break;
          const s = window.getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          matches.push({
            ref: getOrCreateRef(el),
            role: el.getAttribute('role') || el.tagName.toLowerCase(),
            name: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 80),
            type: el.type || '',
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
            reason: 'CSS selector match'
          });
        }
        return { success: true, matches };
      } catch (e) {
        return { success: false, error: `Invalid CSS selector: ${e.message}` };
      }
    },
    args: [query]
  });

  const payload = result?.[0]?.result;
  if (!payload?.success) return payload || { success: false, error: 'CSS search failed' };

  if (payload.matches.length === 0) {
    return { success: true, content: `No elements found for selector "${query}"`, message: 'No matches' };
  }

  const lines = payload.matches.map(m =>
    `- [${m.ref}] ${m.role} "${m.name}" at (${m.x},${m.y})`
  );

  return {
    success: true,
    content: `Found ${payload.matches.length} element(s) for "${query}":\n${lines.join('\n')}`,
    matches: payload.matches,
    message: `Found ${payload.matches.length} matches (CSS)`
  };
}

/**
 * DOM text search fallback (when LLM is unavailable).
 */
async function _domTextSearch(query, tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (q) => {
      const matches = [];
      const MAX_RESULTS = 20;
      const queryLower = q.toLowerCase().trim();

      const getOrCreateRef = (el) => {
        for (const [refId, wr] of Object.entries(window.__crabElementMap || {})) {
          const stored = wr.deref ? wr.deref() : wr;
          if (stored === el) return refId;
        }
        const refId = 'ref_' + (++window.__crabRefCounter);
        window.__crabElementMap[refId] = new WeakRef(el);
        return refId;
      };

      const isVisible = (el) => {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
        return el.offsetWidth > 0 && el.offsetHeight > 0;
      };

      const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
      let node;
      while ((node = treeWalker.nextNode()) && matches.length < MAX_RESULTS * 3) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'META'].includes(node.tagName)) continue;

        const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        const placeholder = (node.getAttribute('placeholder') || '').trim();
        const ariaLabel = (node.getAttribute('aria-label') || '').trim();
        const searchText = [text, placeholder, ariaLabel].join(' ').toLowerCase();

        if (!searchText.includes(queryLower)) continue;
        if (!isVisible(node)) continue;

        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const isEditable = node.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) ||
          node.getAttribute('role') === 'textbox';

        matches.push({
          ref: getOrCreateRef(node),
          role: node.getAttribute('role') || node.tagName.toLowerCase(),
          name: text.substring(0, 80),
          type: node.type || '',
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          editable: isEditable,
          reason: 'Text match'
        });
      }

      // Sort: editable first, then shorter text
      matches.sort((a, b) => {
        if (a.editable && !b.editable) return -1;
        if (!a.editable && b.editable) return 1;
        return (a.name.length || 999) - (b.name.length || 999);
      });
      matches.splice(MAX_RESULTS);

      return { success: true, matches };
    },
    args: [query]
  });

  const payload = result?.[0]?.result;
  if (!payload?.success) return payload || { success: false, error: 'DOM search failed' };

  if (payload.matches.length === 0) {
    return { success: true, content: `No elements found matching "${query}"`, message: 'No matches' };
  }

  const lines = payload.matches.map(m => {
    let desc = `- [${m.ref}] ${m.role} "${m.name}" at (${m.x},${m.y})`;
    if (m.editable) desc += ' [EDITABLE]';
    return desc;
  });

  return {
    success: true,
    content: `Found ${payload.matches.length} element(s) for "${query}":\n${lines.join('\n')}`,
    matches: payload.matches,
    message: `Found ${payload.matches.length} matches for "${query}" (text fallback)`
  };
}

export default findTool;
