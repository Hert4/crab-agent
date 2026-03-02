/**
 * Get Page Text Tool - Extract readable text content from page.
 * Uses Readability-style extraction for article/main content.
 */

const MAX_OUTPUT_CHARS = 50000;

export const getPageTextTool = {
  name: 'get_page_text',
  description: 'Extract readable text content from the current page. Useful for reading articles, documentation, or any page where you need the actual text content rather than the DOM structure.',
  parameters: {
    selector: {
      type: 'string',
      description: 'Optional CSS selector to extract text from specific element (e.g. "article", "main", "#content"). Defaults to auto-detecting main content.'
    },
    maxLength: {
      type: 'number',
      description: `Max characters to return. Default ${MAX_OUTPUT_CHARS}.`
    },
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    const selector = params.selector || null;
    const maxLength = Math.min(params.maxLength || MAX_OUTPUT_CHARS, MAX_OUTPUT_CHARS);

    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel, maxLen) => {
          // Get the root element to extract text from
          let root;
          if (sel) {
            root = document.querySelector(sel);
            if (!root) return { success: false, error: `Selector "${sel}" not found on page.` };
          } else {
            // Auto-detect main content area (Readability-style heuristic)
            root = _findMainContent();
          }

          const title = document.title || '';
          const url = location.href;
          const text = _extractCleanText(root, maxLen);

          return {
            success: true,
            title,
            url,
            text,
            length: text.length,
            truncated: text.length >= maxLen
          };

          // ---- Helper functions (must be inside executeScript func) ----

          function _findMainContent() {
            // Priority: article, main, [role=main], #content, .content, .article, .post
            const candidates = [
              'article',
              'main',
              '[role="main"]',
              '#content',
              '#main-content',
              '.article-body',
              '.post-content',
              '.entry-content',
              '.article',
              '.content'
            ];

            for (const sel of candidates) {
              const el = document.querySelector(sel);
              if (el && el.innerText && el.innerText.trim().length > 200) {
                return el;
              }
            }

            // Fallback: find the element with the most text content
            const allBlocks = document.querySelectorAll('div, section');
            let best = document.body;
            let bestLen = 0;

            for (const el of allBlocks) {
              const text = el.innerText || '';
              // Prefer elements with substantial text that aren't too nested
              if (text.length > bestLen && el.children.length < 100) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 200 && rect.height > 200) {
                  best = el;
                  bestLen = text.length;
                }
              }
            }

            return best;
          }

          function _extractCleanText(element, limit) {
            if (!element) return '';

            // Remove script, style, nav, footer, header, aside elements
            const clone = element.cloneNode(true);
            const removeTags = ['script', 'style', 'noscript', 'nav', 'footer', 'aside',
                                'iframe', 'svg', 'canvas', 'video', 'audio'];
            for (const tag of removeTags) {
              const els = clone.querySelectorAll(tag);
              for (const el of els) el.remove();
            }

            // Get text and clean up whitespace
            let text = clone.innerText || clone.textContent || '';
            // Collapse excessive newlines
            text = text.replace(/\n{3,}/g, '\n\n');
            // Collapse spaces
            text = text.replace(/[ \t]{2,}/g, ' ');
            text = text.trim();

            if (text.length > limit) {
              text = text.substring(0, limit) + '\n\n[... truncated at ' + limit + ' chars]';
            }

            return text;
          }
        },
        args: [selector, maxLength]
      });

      const payload = result?.[0]?.result;
      if (!payload) return { success: false, error: 'get_page_text script returned no result' };
      if (!payload.success) return payload;

      // Build content string for LLM
      let content = '';
      if (payload.title) content += `Title: ${payload.title}\n`;
      if (payload.url) content += `URL: ${payload.url}\n`;
      content += `\n${payload.text}`;

      if (payload.truncated) {
        content += `\n\n[Content truncated. Use selector parameter to focus on specific section.]`;
      }

      return {
        success: true,
        content,
        title: payload.title,
        length: payload.length,
        truncated: payload.truncated,
        message: `Extracted ${payload.length} chars from "${payload.title}"`
      };
    } catch (e) {
      return { success: false, error: `get_page_text failed: ${e.message}` };
    }
  }
};

export default getPageTextTool;
