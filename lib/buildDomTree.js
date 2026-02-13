/**
 * Agent-S DOM Tree Builder
 * Builds a structured representation of interactive elements on the page
 * Based on nanobrowser's buildDomTree.js with full functionality
 */

(function() {
  'use strict';

  // Highlight colors for different element types
  const HIGHLIGHT_COLORS = [
    '#FF0000', // Red
    '#00FF00', // Green
    '#0000FF', // Blue
    '#FFA500', // Orange
    '#800080', // Purple
    '#008080', // Teal
    '#FF69B4', // Pink
    '#FFD700', // Gold
    '#00CED1', // Dark Cyan
    '#FF4500', // Orange Red
    '#9400D3', // Dark Violet
    '#32CD32', // Lime Green
    '#FF1493', // Deep Pink
    '#00BFFF', // Deep Sky Blue
    '#FF6347', // Tomato
  ];

  const MAX_Z_INDEX = 2147483647;

  /**
   * Check if an element is visible
   */
  function isElementVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const style = window.getComputedStyle(element);

    // Check visibility properties
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;

    // Check dimensions
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    return true;
  }

  /**
   * Check if element is in viewport
   */
  function isInViewport(element, threshold = 0) {
    const rect = element.getBoundingClientRect();
    const viewHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewWidth = window.innerWidth || document.documentElement.clientWidth;

    return (
      rect.bottom >= -threshold &&
      rect.right >= -threshold &&
      rect.top <= viewHeight + threshold &&
      rect.left <= viewWidth + threshold
    );
  }

  /**
   * Check if element is interactive
   */
  function isInteractiveElement(element) {
    const tagName = element.tagName.toLowerCase();

    // Form elements
    if (['input', 'textarea', 'select', 'button'].includes(tagName)) {
      return true;
    }

    // Links
    if (tagName === 'a' && element.hasAttribute('href')) {
      return true;
    }

    // Elements with click handlers or roles
    if (element.onclick || element.getAttribute('onclick')) {
      return true;
    }

    const role = element.getAttribute('role');
    if (['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'switch', 'textbox', 'combobox', 'listbox', 'slider'].includes(role)) {
      return true;
    }

    // Clickable by style
    const style = window.getComputedStyle(element);
    if (style.cursor === 'pointer') {
      return true;
    }

    // tabindex makes it interactive
    if (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1') {
      return true;
    }

    // contenteditable
    if (element.isContentEditable) {
      return true;
    }

    // Data attributes that suggest interactivity
    const dataAttrs = ['data-action', 'data-toggle', 'data-target', 'data-dismiss', 'ng-click', 'v-on:click', '@click'];
    for (const attr of dataAttrs) {
      if (element.hasAttribute(attr)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get element's visible text content
   */
  function getElementText(element, maxLength = 100) {
    let text = '';

    // For input elements, get value or placeholder
    if (element.tagName.toLowerCase() === 'input') {
      text = element.value || element.placeholder || element.getAttribute('aria-label') || '';
    } else if (element.tagName.toLowerCase() === 'textarea') {
      text = element.value || element.placeholder || '';
    } else if (element.tagName.toLowerCase() === 'select') {
      const selected = element.options[element.selectedIndex];
      text = selected ? selected.text : '';
    } else if (element.tagName.toLowerCase() === 'img') {
      text = element.alt || element.title || '';
    } else {
      // Get text content, but not from hidden children
      text = element.innerText || element.textContent || '';
    }

    // Clean up text
    text = text.trim().replace(/\s+/g, ' ');

    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + '...';
    }

    return text;
  }

  /**
   * Get important attributes for an element
   */
  function getElementAttributes(element) {
    const attrs = {};
    const importantAttrs = [
      'id', 'name', 'type', 'value', 'placeholder', 'href', 'src', 'alt', 'title',
      'aria-label', 'aria-describedby', 'aria-expanded', 'aria-checked', 'aria-selected',
      'role', 'class', 'data-testid', 'data-id'
    ];

    for (const attr of importantAttrs) {
      if (element.hasAttribute(attr)) {
        let value = element.getAttribute(attr);
        // Truncate long values
        if (value && value.length > 100) {
          value = value.substring(0, 100) + '...';
        }
        // Skip empty values
        if (value) {
          attrs[attr] = value;
        }
      }
    }

    return attrs;
  }

  /**
   * Get XPath for an element
   */
  function getXPath(element) {
    if (!element) return '';
    if (element.id) {
      return `//*[@id="${element.id}"]`;
    }

    const parts = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = element.previousSibling;

      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === element.tagName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      const tagName = element.tagName.toLowerCase();
      const pathPart = index > 1 ? `${tagName}[${index}]` : tagName;
      parts.unshift(pathPart);
      element = element.parentNode;
    }

    return '/' + parts.join('/');
  }

  /**
   * Create highlight overlay for an element
   */
  function createHighlight(element, index, color) {
    const rect = element.getBoundingClientRect();

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'agents-highlight-overlay';
    overlay.setAttribute('data-agents-index', index);

    Object.assign(overlay.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      border: `2px solid ${color}`,
      backgroundColor: `${color}22`,
      pointerEvents: 'none',
      zIndex: MAX_Z_INDEX,
      boxSizing: 'border-box'
    });

    // Create index label
    const label = document.createElement('div');
    label.className = 'agents-highlight-label';
    label.textContent = index;

    Object.assign(label.style, {
      position: 'absolute',
      top: '-18px',
      left: '-2px',
      backgroundColor: color,
      color: 'white',
      fontSize: '11px',
      fontWeight: 'bold',
      fontFamily: 'Arial, sans-serif',
      padding: '1px 4px',
      borderRadius: '3px',
      minWidth: '16px',
      textAlign: 'center'
    });

    overlay.appendChild(label);
    document.body.appendChild(overlay);

    return overlay;
  }

  /**
   * Remove all highlights
   */
  function removeHighlights() {
    const overlays = document.querySelectorAll('.agents-highlight-overlay');
    overlays.forEach(overlay => overlay.remove());
  }

  /**
   * Build the DOM tree with interactive elements
   */
  function buildDomTree(options = {}) {
    const {
      highlightElements = true,
      includeAllElements = false,
      viewportOnly = true,
      maxElements = 500
    } = options;

    // Remove existing highlights
    removeHighlights();

    const elements = [];
    const elementMap = {};
    let index = 0;

    // Collect all elements including those inside Shadow DOMs and iframes
    const allElements = [];

    function collectElements(root, depth = 0) {
      if (depth > 3) return; // Limit depth to avoid infinite recursion

      const els = root.querySelectorAll('*');
      for (const el of els) {
        allElements.push(el);

        // Also collect from Shadow DOM (YouTube live chat, etc.)
        if (el.shadowRoot) {
          collectElements(el.shadowRoot, depth + 1);
        }

        // Also collect from same-origin iframes
        if (el.tagName.toLowerCase() === 'iframe') {
          try {
            const iframeDoc = el.contentDocument || el.contentWindow?.document;
            if (iframeDoc) {
              collectElements(iframeDoc, depth + 1);
            }
          } catch (e) {
            // Cross-origin iframe, can't access
          }
        }
      }
    }

    collectElements(document);

    for (const element of allElements) {
      if (index >= maxElements) break;

      // Skip script, style, and hidden elements
      const tagName = element.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'svg', 'path', 'meta', 'link', 'head'].includes(tagName)) {
        continue;
      }

      // Skip our own overlays
      if (element.classList.contains('agents-highlight-overlay') ||
          element.classList.contains('agents-highlight-label')) {
        continue;
      }

      // Check visibility
      if (!isElementVisible(element)) continue;

      // Check viewport if required
      if (viewportOnly && !isInViewport(element)) continue;

      // Check interactivity (unless including all)
      if (!includeAllElements && !isInteractiveElement(element)) continue;

      const rect = element.getBoundingClientRect();
      const text = getElementText(element);
      const attributes = getElementAttributes(element);

      const elementInfo = {
        index,
        tagName,
        text,
        attributes,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        xpath: getXPath(element),
        isInteractive: isInteractiveElement(element),
        element // Reference to actual DOM element
      };

      elements.push(elementInfo);
      elementMap[index] = element;

      // Create highlight
      if (highlightElements) {
        const color = HIGHLIGHT_COLORS[index % HIGHLIGHT_COLORS.length];
        createHighlight(element, index, color);
      }

      index++;
    }

    // Build text representation for AI
    let textRepresentation = '';
    const viewportInfo = {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth
    };

    // Add viewport info
    textRepresentation += `[Viewport: ${viewportInfo.width}x${viewportInfo.height}]\n`;
    textRepresentation += `[Scroll: Y=${Math.round(viewportInfo.scrollY)}/${viewportInfo.scrollHeight - viewportInfo.height}]\n`;
    textRepresentation += `[URL: ${window.location.href}]\n`;
    textRepresentation += `[Title: ${document.title}]\n\n`;
    textRepresentation += `Interactive Elements:\n`;

    for (const el of elements) {
      let line = `[${el.index}] <${el.tagName}>`;

      // Add important attributes
      if (el.attributes.type) line += ` type="${el.attributes.type}"`;
      if (el.attributes.role) line += ` role="${el.attributes.role}"`;
      if (el.attributes.id) line += ` id="${el.attributes.id}"`;
      if (el.attributes.name) line += ` name="${el.attributes.name}"`;
      if (el.attributes['aria-label']) line += ` aria-label="${el.attributes['aria-label']}"`;
      if (el.attributes.placeholder) line += ` placeholder="${el.attributes.placeholder}"`;
      if (el.attributes.href) {
        const href = el.attributes.href;
        line += ` href="${href.length > 50 ? href.substring(0, 50) + '...' : href}"`;
      }

      // Add text content
      if (el.text) {
        line += ` "${el.text}"`;
      }

      textRepresentation += line + '\n';
    }

    return {
      elements,
      elementMap,
      textRepresentation,
      viewportInfo,
      url: window.location.href,
      title: document.title
    };
  }

  /**
   * Get element by index
   */
  function getElementByIndex(index) {
    const overlay = document.querySelector(`[data-agents-index="${index}"]`);
    if (overlay) {
      // Find the actual element at the same position
      const rect = overlay.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      // Temporarily hide overlay to find element underneath
      overlay.style.display = 'none';
      const element = document.elementFromPoint(x, y);
      overlay.style.display = '';

      return element;
    }
    return null;
  }

  /**
   * Scroll element into view
   */
  function scrollToElement(element) {
    if (!element) return false;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  /**
   * Click on element
   */
  function clickElement(element) {
    if (!element) return false;

    // Scroll into view first
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Wait a bit then click
    setTimeout(() => {
      element.click();
    }, 100);

    return true;
  }

  /**
   * Input text into element
   */
  function inputText(element, text, clearFirst = true) {
    if (!element) return false;

    // Focus the element
    element.focus();

    // Clear existing content if requested
    if (clearFirst) {
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Set new value
    element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return true;
  }

  /**
   * Select option from dropdown
   */
  function selectOption(selectElement, optionValue) {
    if (!selectElement || selectElement.tagName.toLowerCase() !== 'select') {
      return false;
    }

    for (let i = 0; i < selectElement.options.length; i++) {
      if (selectElement.options[i].value === optionValue ||
          selectElement.options[i].text === optionValue) {
        selectElement.selectedIndex = i;
        selectElement.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }

    return false;
  }

  /**
   * Get dropdown options
   */
  function getDropdownOptions(selectElement) {
    if (!selectElement || selectElement.tagName.toLowerCase() !== 'select') {
      return [];
    }

    return Array.from(selectElement.options).map((opt, i) => ({
      index: i,
      value: opt.value,
      text: opt.text,
      selected: opt.selected
    }));
  }

  /**
   * Scroll page
   */
  function scrollPage(direction, amount = null) {
    const viewportHeight = window.innerHeight;

    switch (direction) {
      case 'up':
        window.scrollBy(0, -(amount || viewportHeight * 0.8));
        break;
      case 'down':
        window.scrollBy(0, amount || viewportHeight * 0.8);
        break;
      case 'top':
        window.scrollTo(0, 0);
        break;
      case 'bottom':
        window.scrollTo(0, document.documentElement.scrollHeight);
        break;
      case 'percent':
        const targetY = (amount / 100) * (document.documentElement.scrollHeight - viewportHeight);
        window.scrollTo(0, targetY);
        break;
    }

    return true;
  }

  /**
   * Scroll to text on page
   */
  function scrollToText(searchText) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent.toLowerCase().includes(searchText.toLowerCase())) {
        const element = node.parentElement;
        if (element && isElementVisible(element)) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Take screenshot (returns base64)
   */
  async function takeScreenshot() {
    // This will be handled by the background script using Chrome APIs
    return null;
  }

  /**
   * Get page content as markdown
   */
  function getMarkdownContent() {
    // Simple markdown conversion
    let markdown = '';

    // Title
    markdown += `# ${document.title}\n\n`;

    // Meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      markdown += `> ${metaDesc.content}\n\n`;
    }

    // Main content areas
    const mainContent = document.querySelector('main, article, [role="main"], .content, #content');
    const contentRoot = mainContent || document.body;

    // Process headings and paragraphs
    const elements = contentRoot.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, code, blockquote');

    for (const el of elements) {
      if (!isElementVisible(el)) continue;

      const tagName = el.tagName.toLowerCase();
      const text = el.innerText.trim();

      if (!text) continue;

      switch (tagName) {
        case 'h1':
          markdown += `# ${text}\n\n`;
          break;
        case 'h2':
          markdown += `## ${text}\n\n`;
          break;
        case 'h3':
          markdown += `### ${text}\n\n`;
          break;
        case 'h4':
        case 'h5':
        case 'h6':
          markdown += `#### ${text}\n\n`;
          break;
        case 'p':
          markdown += `${text}\n\n`;
          break;
        case 'li':
          markdown += `- ${text}\n`;
          break;
        case 'pre':
        case 'code':
          markdown += `\`\`\`\n${text}\n\`\`\`\n\n`;
          break;
        case 'blockquote':
          markdown += `> ${text}\n\n`;
          break;
      }
    }

    return markdown;
  }

  // Expose functions globally
  window.AgentSDom = {
    buildDomTree,
    removeHighlights,
    getElementByIndex,
    scrollToElement,
    clickElement,
    inputText,
    selectOption,
    getDropdownOptions,
    scrollPage,
    scrollToText,
    takeScreenshot,
    getMarkdownContent,
    isElementVisible,
    isInteractiveElement
  };

})();
