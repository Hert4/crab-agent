/**
 * Crab-Agent Accessibility Tree Injector
 * Injected into all pages at document_start.
 * Generates a lightweight accessibility tree with ref_ids for element targeting.
 * Ported from Claude Extension's approach with Crab-Agent enhancements.
 */

(function() {
  'use strict';

  // Prevent double injection
  if (window.__crabAccessibilityTreeInjected) return;
  window.__crabAccessibilityTreeInjected = true;

  // Element tracking via WeakRef
  window.__crabElementMap = window.__crabElementMap || {};
  window.__crabRefCounter = window.__crabRefCounter || 0;

  // ========== Role Mapping ==========

  const TAG_TO_ROLE = {
    a: 'link',
    button: 'button',
    select: 'combobox',
    textarea: 'textbox',
    h1: 'heading', h2: 'heading', h3: 'heading',
    h4: 'heading', h5: 'heading', h6: 'heading',
    img: 'image',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    section: 'region',
    article: 'article',
    aside: 'complementary',
    form: 'form',
    table: 'table',
    ul: 'list', ol: 'list',
    li: 'listitem',
    label: 'label',
    details: 'group',
    summary: 'button'
  };

  const INPUT_TYPE_TO_ROLE = {
    submit: 'button',
    button: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    file: 'button'
  };

  const INTERACTIVE_TAGS = new Set([
    'a', 'button', 'input', 'select', 'textarea', 'details', 'summary'
  ]);

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'switch',
    'textbox', 'combobox', 'listbox', 'searchbox',
    'treeitem', 'slider', 'spinbutton', 'gridcell'
  ]);

  const SKIP_TAGS = new Set([
    'script', 'style', 'meta', 'link', 'title', 'noscript'
  ]);

  const LANDMARK_TAGS = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'nav', 'main', 'header', 'footer', 'section', 'article', 'aside'
  ]);

  // ========== Utility Functions ==========

  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;

    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return INPUT_TYPE_TO_ROLE[type] || 'textbox';
    }
    // Detect contenteditable as textbox (e.g. Facebook Messenger, Slack)
    if (el.isContentEditable && !['body', 'html'].includes(tag)) {
      return 'textbox';
    }
    return TAG_TO_ROLE[tag] || 'generic';
  }

  function getLabel(el) {
    const tag = el.tagName.toLowerCase();

    // Select: show selected option
    if (tag === 'select') {
      const selected = el.querySelector('option[selected]') || el.options?.[el.selectedIndex];
      if (selected?.textContent?.trim()) return selected.textContent.trim();
    }

    // aria-label
    const ariaLabel = (el.getAttribute('aria-label') || '').trim();
    if (ariaLabel) return ariaLabel;

    // placeholder
    const placeholder = (el.getAttribute('placeholder') || '').trim();
    if (placeholder) return placeholder;

    // data-placeholder (used by Facebook, Slack, etc.)
    const dataPlaceholder = (el.getAttribute('data-placeholder') || '').trim();
    if (dataPlaceholder) return dataPlaceholder;

    // title
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;

    // alt (for images)
    const alt = (el.getAttribute('alt') || '').trim();
    if (alt) return alt;

    // label[for]
    if (el.id) {
      const labelEl = document.querySelector(`label[for="${el.id}"]`);
      if (labelEl?.textContent?.trim()) return labelEl.textContent.trim();
    }

    // Input value for submit buttons
    if (tag === 'input') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      const value = el.getAttribute('value');
      if (type === 'submit' && value?.trim()) return value.trim();
      if (el.value && el.value.length < 50 && el.value.trim()) return el.value.trim();
    }

    // Direct text for buttons, links, headings, summary
    if (['button', 'a', 'summary'].includes(tag) || tag.match(/^h[1-6]$/)) {
      let directText = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          directText += child.textContent;
        }
      }
      directText = directText.trim();
      if (directText) return directText.substring(0, 100);

      // Fallback: full textContent for headings
      if (tag.match(/^h[1-6]$/)) {
        const full = (el.textContent || '').trim();
        if (full) return full.substring(0, 100);
      }
    }

    // Image without alt
    if (tag === 'img') return '';

    // Generic: try direct text children
    let directText = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        directText += child.textContent;
      }
    }
    directText = directText.trim();
    if (directText && directText.length >= 3) {
      return directText.length > 100 ? directText.substring(0, 100) + '...' : directText;
    }

    return '';
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.opacity === '0') return false;
    if (el.offsetWidth <= 0 || el.offsetHeight <= 0) return false;
    return true;
  }

  function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0
    );
  }

  function isInteractive(el) {
    if (!(el instanceof Element)) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (INTERACTIVE_ROLES.has(role)) return true;
    if (el.getAttribute('onclick') !== null) return true;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && tabindex !== '-1') return true;
    if (el.isContentEditable) return true;
    // Check for event listeners via common framework patterns
    if (el.getAttribute('data-action') !== null) return true;
    if (el.getAttribute('ng-click') !== null) return true;
    if (el.getAttribute('v-on:click') !== null || el.getAttribute('@click') !== null) return true;
    // Check cursor style - pointer cursor usually means clickable
    try {
      const cursor = window.getComputedStyle(el).cursor;
      if (cursor === 'pointer') return true;
    } catch (e) {}
    return false;
  }

  function isLandmark(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (LANDMARK_TAGS.has(tag)) return true;
    const role = el.getAttribute('role');
    return role !== null && role !== 'generic';
  }

  function shouldInclude(el, filter, checkViewport) {
    const tag = (el.tagName || '').toLowerCase();
    if (SKIP_TAGS.has(tag)) return false;
    if (filter !== 'all' && el.getAttribute('aria-hidden') === 'true') return false;
    if (filter !== 'all' && !isVisible(el)) return false;
    if (checkViewport && !isInViewport(el)) return false;

    if (filter === 'interactive') return isInteractive(el);
    if (isInteractive(el)) return true;
    if (isLandmark(el)) return true;
    if (getLabel(el).length > 0) return true;

    const role = getRole(el);
    return role !== null && role !== 'generic' && role !== 'image';
  }

  function getOrCreateRef(el) {
    // Check if element already has a ref
    for (const [refId, weakRef] of Object.entries(window.__crabElementMap)) {
      const stored = weakRef.deref ? weakRef.deref() : weakRef;
      if (stored === el) return refId;
    }

    // Create new ref
    const refId = 'ref_' + (++window.__crabRefCounter);
    window.__crabElementMap[refId] = new WeakRef(el);
    return refId;
  }

  // ========== Main Tree Builder ==========

  /**
   * Generate accessibility tree (Claude extension compatible).
   * @param {string} filter - "all" | "interactive"
   * @param {number} maxDepth - Max tree depth (default 15)
   * @param {string|null} focusRefId - Focus on subtree of this ref
   * @param {boolean} includeCoords - Include coordinates in output (default true)
   * @param {number} maxChars - Max output chars (default 50000)
   * @returns {{ success: boolean, lines: string[], nodeCount: number, truncated: boolean }}
   */
  window.__generateAccessibilityTree = function(filter, maxDepth, focusRefId, includeCoords, maxChars) {
    filter = filter || 'all';
    maxDepth = maxDepth != null ? maxDepth : 15;
    includeCoords = includeCoords !== false;  // Default true
    maxChars = maxChars || 50000;

    const lines = [];
    let nodeCount = 0;
    let charCount = 0;
    let truncated = false;
    const MAX_NODES = 500;

    // Cleanup stale refs
    for (const [refId, weakRef] of Object.entries(window.__crabElementMap)) {
      const el = weakRef.deref ? weakRef.deref() : weakRef;
      if (!el || !el.isConnected) {
        delete window.__crabElementMap[refId];
      }
    }

    // Find root element
    let root = document.body;
    if (focusRefId) {
      const map = window.__crabElementMap;
      const weakRef = map[focusRefId];
      const el = weakRef?.deref ? weakRef.deref() : weakRef;
      if (el && el.isConnected) {
        root = el;
      } else {
        // Try finding by attribute
        const found = document.querySelector(`[data-crab-ref-id="${focusRefId}"]`);
        if (found) root = found;
        else return { lines: [`(ref_id not found: ${focusRefId})`], nodeCount: 0, truncated: false };
      }
    }

    function walk(node, depth) {
      if (truncated || !(node instanceof Element)) return;
      if (nodeCount >= MAX_NODES) { truncated = true; return; }
      if (charCount >= maxChars) { truncated = true; return; }
      if (depth > maxDepth) return;

      // viewportOnly check only when not focusing on a subtree
      const include = shouldInclude(node, filter, !focusRefId);

      if (include) {
        nodeCount++;
        const role = getRole(node);
        const label = getLabel(node).replace(/\s+/g, ' ').substring(0, 100);
        const refId = getOrCreateRef(node);
        const indent = ' '.repeat(depth);

        let line = `${indent}${role}`;
        if (label) line += ` "${label.replace(/"/g, '\\"')}"`;
        line += ` [${refId}]`;

        // Extra attributes
        const href = node.getAttribute('href');
        if (href) line += ` href="${href.substring(0, 80)}"`;

        const type = node.getAttribute('type');
        if (type) line += ` type="${type}"`;

        const placeholder = node.getAttribute('placeholder');
        if (placeholder && !label.includes(placeholder)) line += ` placeholder="${placeholder.substring(0, 50)}"`;

        const ariaExpanded = node.getAttribute('aria-expanded');
        if (ariaExpanded) line += ` expanded=${ariaExpanded}`;

        const ariaSelected = node.getAttribute('aria-selected');
        if (ariaSelected === 'true') line += ` selected`;

        const ariaChecked = node.getAttribute('aria-checked');
        if (ariaChecked) line += ` checked=${ariaChecked}`;

        const disabled = node.hasAttribute('disabled');
        if (disabled) line += ` disabled`;

        const value = node.value;
        if (value && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') && value.length < 50) {
          line += ` value="${value.replace(/"/g, '\\"')}"`;
        }

        // Add coordinates if requested (for click targeting)
        if (includeCoords) {
          try {
            const rect = node.getBoundingClientRect();
            const cx = Math.round(rect.x + rect.width / 2);
            const cy = Math.round(rect.y + rect.height / 2);
            line += ` @(${cx},${cy})`;
          } catch(e) {}
        }

        // Check char limit before adding
        if (charCount + line.length > maxChars) {
          truncated = true;
          return;
        }

        lines.push(line);
        charCount += line.length + 1;

        // For select elements, show options
        if (node.tagName.toLowerCase() === 'select') {
          for (const opt of node.options) {
            if (charCount >= maxChars) { truncated = true; break; }
            const optLabel = (opt.textContent || '').trim().substring(0, 100);
            const optRef = getOrCreateRef(opt);
            let optLine = `${' '.repeat(depth + 1)}option "${optLabel.replace(/"/g, '\\"')}" [${optRef}]`;
            if (opt.selected) optLine += ' (selected)';
            if (opt.value && opt.value !== optLabel) optLine += ` value="${opt.value.replace(/"/g, '\\"')}"`;
            lines.push(optLine);
            charCount += optLine.length + 1;
            nodeCount++;
          }
          return; // Don't recurse into select children
        }
      }

      // Recurse children
      if (node.children) {
        for (const child of node.children) {
          walk(child, include ? depth + 1 : depth);
          if (truncated) break;
        }
      }
    }

    walk(root, 0);

    if (lines.length === 0) {
      lines.push('(no matching elements)');
    }

    return { success: true, lines, nodeCount, truncated, filter, depth: maxDepth };
  };

  /**
   * Resolve a ref_id to element info (coordinates, tag, text).
   */
  window.__resolveRef = function(refId) {
    const map = window.__crabElementMap;
    if (!map) return null;

    const weakRef = map[refId];
    if (!weakRef) return null;

    const el = weakRef.deref ? weakRef.deref() : weakRef;
    if (!el || !el.isConnected) {
      delete map[refId];
      return null;
    }

    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      tag: (el.tagName || '').toLowerCase(),
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 80),
      visible: isVisible(el),
      interactive: isInteractive(el)
    };
  };

  /**
   * Set form value on element by ref_id.
   * Handles: input, textarea, select, checkbox, radio, contenteditable.
   */
  window.__setFormValue = function(refId, value) {
    const map = window.__crabElementMap;
    if (!map) return { success: false, error: 'Element map not initialized' };

    const weakRef = map[refId];
    if (!weakRef) return { success: false, error: `Ref ${refId} not found` };

    const el = weakRef.deref ? weakRef.deref() : weakRef;
    if (!el || !el.isConnected) return { success: false, error: `Element for ${refId} disconnected` };

    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();

    try {
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.focus();

      if (tag === 'select') {
        // Set select value
        const options = Array.from(el.options);
        const target = options.find(o =>
          o.value === value ||
          o.textContent.trim().toLowerCase() === String(value).toLowerCase()
        );
        if (target) {
          el.value = target.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, message: `Selected "${target.textContent.trim()}"` };
        }
        return { success: false, error: `Option "${value}" not found in select` };
      }

      if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
        const shouldCheck = value === true || value === 'true' || value === 'on' || value === '1';
        if (el.checked !== shouldCheck) {
          el.checked = shouldCheck;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return { success: true, message: `Set ${type} to ${shouldCheck}` };
      }

      if (tag === 'input' || tag === 'textarea') {
        // Clear existing value first
        const proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

        // Select all existing text and delete it first
        el.select && el.select();

        if (descriptor?.set) {
          descriptor.set.call(el, value);
        } else {
          el.value = value;
        }
        // Dispatch events in the right order for React/Vue/Angular
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Also dispatch keyboard event for frameworks that listen to keyup
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        return { success: true, message: `Set value to "${String(value).substring(0, 50)}"` };
      }

      if (el.isContentEditable) {
        el.focus();
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(el);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        document.execCommand('insertText', false, value);
        return { success: true, message: `Set contenteditable to "${String(value).substring(0, 50)}"` };
      }

      return { success: false, error: `Element <${tag}> type="${type}" is not a form input` };
    } catch (e) {
      return { success: false, error: `setFormValue error: ${e.message}` };
    }
  };

  /**
   * Extract readable text content from page.
   */
  window.__getPageText = function(maxLength) {
    maxLength = maxLength || 50000;

    // Try to find article content first
    const articleSelectors = [
      'article', '[role="main"]', 'main',
      '.article-body', '.post-content', '.entry-content',
      '#content', '.content', '.story-body'
    ];

    for (const selector of articleSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.innerText?.trim();
        if (text && text.length > 100) {
          return text.substring(0, maxLength);
        }
      }
    }

    // Fallback: entire body text
    const bodyText = document.body?.innerText?.trim() || '';
    return bodyText.substring(0, maxLength);
  };

  console.log('[Crab-Agent] Accessibility tree injector loaded');
})();
