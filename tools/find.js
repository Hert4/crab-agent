/**
 * Find Tool - Search for elements on the page by text or selector.
 */

export const findTool = {
  name: 'find',
  description: 'Search for elements on the page by text content or CSS selector. Returns matching elements with ref IDs for use with computer or form_input tools.',
  parameters: {
    query: {
      type: 'string',
      description: 'Text to search for, or CSS selector (prefix with "css:" for selectors).'
    },
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId.' };
    if (!params.query) return { success: false, error: 'query parameter required.' };

    const query = params.query;
    const isSelector = query.startsWith('css:');

    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (q, isSel) => {
          const matches = [];
          const MAX_RESULTS = 10;

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

          if (isSel) {
            // CSS selector mode
            const selector = q.replace(/^css:\s*/, '');
            try {
              const elements = document.querySelectorAll(selector);
              for (const el of elements) {
                if (matches.length >= MAX_RESULTS) break;
                if (!isVisible(el)) continue;
                const rect = el.getBoundingClientRect();
                const refId = getOrCreateRef(el);
                matches.push({
                  ref: refId,
                  tag: (el.tagName || '').toLowerCase(),
                  text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 80),
                  rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
                });
              }
            } catch (e) {
              return { success: false, error: `Invalid selector: ${e.message}` };
            }
          } else {
            // Text search mode
            const queryLower = q.toLowerCase().trim();
            const treeWalker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_ELEMENT,
              null
            );

            let node;
            while ((node = treeWalker.nextNode()) && matches.length < MAX_RESULTS * 3) {
              if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'META'].includes(node.tagName)) continue;

              // Check text content
              const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
              // Also check placeholder and aria-label attributes
              const placeholder = (node.getAttribute('placeholder') || '').trim();
              const ariaLabel = (node.getAttribute('aria-label') || '').trim();
              const dataPlaceholder = (node.getAttribute('data-placeholder') || '').trim();
              const searchText = [text, placeholder, ariaLabel, dataPlaceholder].join(' ').toLowerCase();

              if (!searchText.includes(queryLower)) continue;
              if (!isVisible(node)) continue;

              const rect = node.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;

              const refId = getOrCreateRef(node);
              const isEditable = node.isContentEditable ||
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) ||
                node.getAttribute('role') === 'textbox';

              matches.push({
                ref: refId,
                tag: (node.tagName || '').toLowerCase(),
                text: text.substring(0, 80),
                textLen: text.length,
                editable: isEditable,
                placeholder: placeholder || dataPlaceholder || '',
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
              });
            }

            // Sort: prefer editable elements first, then shorter text (more specific)
            matches.sort((a, b) => {
              if (a.editable && !b.editable) return -1;
              if (!a.editable && b.editable) return 1;
              return (a.textLen || 999) - (b.textLen || 999);
            });
            matches.splice(MAX_RESULTS);
          }

          return { success: true, matches, total: matches.length };
        },
        args: [query, isSelector]
      });

      const payload = result?.[0]?.result;
      if (!payload?.success) return payload || { success: false, error: 'find script failed' };

      if (payload.matches.length === 0) {
        return { success: true, content: `No elements found matching "${query}"`, message: 'No matches' };
      }

      const lines = payload.matches.map(m => {
        let desc = `- [${m.ref}] <${m.tag}> "${m.text}" at (${m.rect.x + m.rect.w/2}, ${m.rect.y + m.rect.h/2})`;
        if (m.editable) desc += ' [EDITABLE]';
        if (m.placeholder) desc += ` placeholder="${m.placeholder}"`;
        return desc;
      });

      return {
        success: true,
        content: `Found ${payload.total} element(s) for "${query}":\n${lines.join('\n')}`,
        matches: payload.matches,
        message: `Found ${payload.total} matches for "${query}"`
      };
    } catch (e) {
      return { success: false, error: `find failed: ${e.message}` };
    }
  }
};

export default findTool;
