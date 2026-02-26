/**
 * Crab-Agent Content Script v2.0
 * Injected into web pages to enable DOM interaction, Set-of-Mark overlay,
 * and advanced action handling.
 */

(function() {
  'use strict';

  // Prevent double injection
  if (window.__crabAgentContentScriptInjected) {
    return;
  }
  window.__crabAgentContentScriptInjected = true;

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  const CONFIG = {
    SOM_CONTAINER_ID: 'crab-agent-som-container',
    HIGHLIGHT_Z_INDEX: 2147483647,
    DEFAULT_WAIT_TIMEOUT: 5000,
    MUTATION_DEBOUNCE: 100
  };

  const HIGHLIGHT_COLORS = [
    '#FF0000', '#00FF00', '#0000FF', '#FFA500', '#800080',
    '#008080', '#FF69B4', '#FFD700', '#00CED1', '#FF4500',
    '#9400D3', '#32CD32', '#FF1493', '#00BFFF', '#FF6347'
  ];

  // ============================================================================
  // SET-OF-MARK (SoM) OVERLAY SYSTEM
  // ============================================================================

  /**
   * Create Set-of-Mark container
   */
  function createSoMContainer() {
    let container = document.getElementById(CONFIG.SOM_CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = CONFIG.SOM_CONTAINER_ID;
      Object.assign(container.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: String(CONFIG.HIGHLIGHT_Z_INDEX)
      });
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * Draw bounding boxes for elements (Set-of-Mark visualization)
   * @param {Array} elementsList List of elements with rect and index
   * @returns {HTMLElement} Container element
   */
  function drawBoundingBoxes(elementsList) {
    // Clean up existing
    cleanupSoM();

    const container = createSoMContainer();

    for (const elInfo of elementsList) {
      try {
        const { index, rect, obstructed } = elInfo;
        if (!rect || rect.width === 0 || rect.height === 0) continue;

        const color = HIGHLIGHT_COLORS[index % HIGHLIGHT_COLORS.length];

        // Create bounding box
        const box = document.createElement('div');
        box.className = 'crab-som-box';
        box.setAttribute('data-som-index', index);

        Object.assign(box.style, {
          position: 'fixed',
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          border: `3px solid ${color}`,
          backgroundColor: obstructed ? `${color}11` : `${color}15`,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          boxShadow: `0 0 0 1px rgba(255,255,255,0.3), inset 0 0 0 1px rgba(255,255,255,0.2)`
        });

        // Create label - larger and more visible
        const label = document.createElement('div');
        label.className = 'crab-som-label';
        label.textContent = String(index);

        Object.assign(label.style, {
          position: 'absolute',
          top: '-22px',
          left: '-2px',
          backgroundColor: obstructed ? '#666' : color,
          color: 'white',
          fontSize: '14px',
          fontWeight: 'bold',
          fontFamily: 'Arial, sans-serif',
          padding: '2px 6px',
          borderRadius: '4px',
          minWidth: '20px',
          textAlign: 'center',
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.5)',
          textShadow: '0 1px 1px rgba(0,0,0,0.5)'
        });

        if (obstructed) {
          label.textContent += ' ⚠';
        }

        box.appendChild(label);
        container.appendChild(box);
      } catch (e) {
        // Skip element on error
      }
    }

    return container;
  }

  /**
   * Clean up all Set-of-Mark overlays
   */
  function cleanupSoM() {
    const container = document.getElementById(CONFIG.SOM_CONTAINER_ID);
    if (container) {
      container.remove();
    }

    // Also clean up any loose overlays
    document.querySelectorAll('.crab-som-box, .crab-agent-highlight-overlay')
      .forEach(el => el.remove());
  }

  // ============================================================================
  // ACTION HANDLERS
  // ============================================================================

  /**
   * Handle click_element action
   */
  function handleClickElement(index) {
    if (!window.AgentSDom?.lastBuildResult) {
      return { success: false, error: 'No DOM tree built' };
    }

    const element = window.AgentSDom.lastBuildResult.elementMap[index];
    if (!element) {
      return { success: false, error: `Element ${index} not found` };
    }

    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Simulate human-like click sequence
      element.dispatchEvent(new MouseEvent('mouseenter', {
        bubbles: true, cancelable: true, view: window
      }));
      element.dispatchEvent(new MouseEvent('mouseover', {
        bubbles: true, cancelable: true, view: window
      }));

      // Short delay then click
      setTimeout(() => {
        element.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, view: window
        }));
        element.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true, cancelable: true, view: window
        }));
        element.click();
      }, 50);

      return { success: true, message: `Clicked element ${index}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Handle hover_element action
   */
  function handleHoverElement(index) {
    if (!window.AgentSDom?.lastBuildResult) {
      return { success: false, error: 'No DOM tree built' };
    }

    const element = window.AgentSDom.lastBuildResult.elementMap[index];
    if (!element) {
      return { success: false, error: `Element ${index} not found` };
    }

    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Dispatch hover events
      element.dispatchEvent(new MouseEvent('mouseenter', {
        bubbles: true, cancelable: true, view: window
      }));
      element.dispatchEvent(new MouseEvent('mouseover', {
        bubbles: true, cancelable: true, view: window
      }));

      // For tooltip/dropdown triggers, also try focus
      if (element.matches('button, [role="button"], [aria-haspopup]')) {
        element.focus();
      }

      return { success: true, message: `Hovered element ${index}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Handle input_text action with robust target resolution
   */
  function handleInputText(index, text) {
    if (!window.AgentSDom?.lastBuildResult) {
      return { success: false, error: 'No DOM tree built' };
    }

    const element = window.AgentSDom.lastBuildResult.elementMap[index];
    if (!element) {
      return { success: false, error: `Element ${index} not found` };
    }

    try {
      const normalize = value => (value == null ? '' : String(value));
      const expected = normalize(text);

      const DISABLED_INPUT_TYPES = new Set([
        'hidden', 'button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'
      ]);

      const dispatchInputEvents = (el) => {
        try {
          el.dispatchEvent(new InputEvent('input', {
            bubbles: true, data: expected, inputType: 'insertText'
          }));
        } catch (e) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const isEditable = (el) => {
        if (!el) return false;
        if (el instanceof HTMLTextAreaElement) {
          return !el.disabled && !el.readOnly;
        }
        if (el instanceof HTMLInputElement) {
          const type = (el.type || '').toLowerCase();
          return !el.disabled && !el.readOnly && !DISABLED_INPUT_TYPES.has(type);
        }
        return !!(el instanceof HTMLElement && el.isContentEditable);
      };

      const findEditableDescendant = (root) => {
        if (!(root instanceof HTMLElement)) return null;
        const selector = [
          'textarea',
          'input:not([type="hidden"]):not([type="button"]):not([type="submit"])',
          '[contenteditable="true"]',
          '[contenteditable=""]'
        ].join(', ');
        const nodes = root.querySelectorAll(selector);
        for (const node of nodes) {
          if (isEditable(node)) return node;
        }
        return null;
      };

      const resolveEditableTarget = (candidate) => {
        if (isEditable(candidate)) return candidate;
        const descendant = findEditableDescendant(candidate);
        if (descendant) return descendant;

        const active = document.activeElement;
        if (isEditable(active)) return active;
        const activeDescendant = findEditableDescendant(active);
        if (activeDescendant) return activeDescendant;
        return null;
      };

      const readElementText = (el) => {
        if (!el) return '';
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          return normalize(el.value);
        }
        if (el.isContentEditable) {
          return normalize(el.innerText || el.textContent)
            .replace(/\u00a0/g, ' ').trim();
        }
        return '';
      };

      const setNativeValue = (el, value) => {
        const proto = el instanceof HTMLInputElement ?
          HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor?.set) {
          descriptor.set.call(el, value);
        } else {
          el.value = value;
        }
      };

      const setContentEditableValue = (el, value) => {
        el.focus();
        try {
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(el);
            selection.removeAllRanges();
            selection.addRange(range);
          }
          if (typeof document.execCommand === 'function') {
            document.execCommand('delete', false);
            document.execCommand('insertText', false, value);
          } else {
            el.textContent = value;
          }
        } catch (e) {
          el.textContent = value;
        }
      };

      const verify = (el, value) => {
        const actual = readElementText(el);
        if (el.isContentEditable) {
          return value.trim() === '' ?
            actual.trim() === '' :
            actual.includes(value.trim());
        }
        return actual === value;
      };

      const elementMeta = (el) => {
        if (!el) return 'unknown';
        const tag = (el.tagName || '').toLowerCase();
        const id = el.id || '';
        const role = el.getAttribute?.('role') || '';
        return `tag=${tag} id=${id} role=${role}`;
      };

      // Scroll and focus
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.focus();

      // Resolve actual editable target
      const target = resolveEditableTarget(element);
      if (!target) {
        return {
          success: false,
          error: `Element ${index} is not editable`,
          meta: elementMeta(element)
        };
      }

      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus();

      // Set value
      if (target.isContentEditable) {
        setContentEditableValue(target, expected);
      } else {
        setNativeValue(target, expected);
      }
      dispatchInputEvents(target);

      // Verify and retry if needed
      if (!verify(target, expected)) {
        // Fallback attempt
        if (target.isContentEditable) {
          target.textContent = expected;
        } else {
          setNativeValue(target, expected);
        }
        dispatchInputEvents(target);
      }

      const actual = readElementText(target);
      if (!verify(target, expected)) {
        return {
          success: false,
          error: `Text verification failed. Expected "${expected}" but got "${actual}"`,
          meta: elementMeta(target)
        };
      }

      return {
        success: true,
        message: `Input text to element ${index}`,
        meta: elementMeta(target)
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Handle wait_for_element action
   */
  async function handleWaitForElement(selector, timeout = CONFIG.DEFAULT_WAIT_TIMEOUT) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      // Check if already exists
      const existing = document.querySelector(selector);
      if (existing && window.AgentSDom?.isElementVisible?.(existing)) {
        resolve({ success: true, message: `Element found: ${selector}` });
        return;
      }

      // Use MutationObserver
      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element && window.AgentSDom?.isElementVisible?.(element)) {
          observer.disconnect();
          resolve({ success: true, message: `Element appeared: ${selector}` });
        } else if (Date.now() - startTime > timeout) {
          observer.disconnect();
          resolve({ success: false, error: `Timeout waiting for: ${selector}` });
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });

      // Timeout fallback
      setTimeout(() => {
        observer.disconnect();
        const element = document.querySelector(selector);
        if (element) {
          resolve({ success: true, message: `Element found: ${selector}` });
        } else {
          resolve({ success: false, error: `Timeout waiting for: ${selector}` });
        }
      }, timeout);
    });
  }

  /**
   * Handle wait_for_dom_stable action
   */
  function handleWaitForDomStable(timeout = 2000, threshold = 500) {
    return new Promise((resolve) => {
      let lastMutationTime = Date.now();
      let resolved = false;

      const observer = new MutationObserver(() => {
        lastMutationTime = Date.now();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });

      const checkStable = () => {
        if (resolved) return;

        const timeSinceLastMutation = Date.now() - lastMutationTime;

        if (timeSinceLastMutation >= threshold) {
          resolved = true;
          observer.disconnect();
          resolve({ success: true, message: 'DOM stable' });
        } else if (Date.now() - lastMutationTime > timeout) {
          resolved = true;
          observer.disconnect();
          resolve({ success: true, message: 'DOM stable (timeout)' });
        } else {
          setTimeout(checkStable, 100);
        }
      };

      // Start checking after initial delay
      setTimeout(checkStable, threshold);

      // Hard timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve({ success: true, message: 'DOM stable (hard timeout)' });
        }
      }, timeout);
    });
  }

  /**
   * Handle scroll action
   */
  function handleScroll(direction, amount) {
    try {
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
        default:
          return { success: false, error: `Unknown scroll direction: ${direction}` };
      }

      return { success: true, message: `Scrolled ${direction}` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Get page info
   */
  function getPageInfo() {
    return {
      success: true,
      url: window.location.href,
      title: document.title,
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      domHash: window.AgentSDom?.computeDomHash?.() || ''
    };
  }

  // ============================================================================
  // SCRIPT INJECTION
  // ============================================================================

  /**
   * Inject the buildDomTree script
   */
  function injectScript(src) {
    return new Promise((resolve, reject) => {
      try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(src);
        script.onload = () => {
          script.remove();
          resolve();
        };
        script.onerror = (e) => {
          script.remove();
          reject(new Error(`Failed to load script: ${src}`));
        };
        (document.head || document.documentElement).appendChild(script);
      } catch (e) {
        reject(e);
      }
    });
  }

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  function onDOMReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback);
    } else {
      callback();
    }
  }

  onDOMReady(() => {
    console.log('Crab-Agent content script v2.0 loaded');

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Handle async responses
      const handleAsync = async () => {
        try {
          switch (message.type) {
            case 'ping':
              return { status: 'ok', version: '2.0' };

            case 'inject_script':
              await injectScript(message.src || 'lib/buildDomTree.js');
              return { success: true };

            case 'build_dom_tree':
              if (!window.AgentSDom) {
                return { success: false, error: 'AgentSDom not loaded' };
              }
              const result = window.AgentSDom.buildDomTree(message.options || {});
              window.AgentSDom.lastBuildResult = result;
              return {
                success: true,
                textRepresentation: result.textRepresentation,
                viewportInfo: result.viewportInfo,
                url: result.url,
                title: result.title,
                elementCount: result.elements.length,
                domHash: window.AgentSDom.computeDomHash?.() || '',
                elements: result.elements // For SoM rendering
              };

            case 'draw_som':
              if (!message.elements) {
                return { success: false, error: 'No elements provided' };
              }
              drawBoundingBoxes(message.elements);
              return { success: true };

            case 'cleanup_som':
              cleanupSoM();
              if (window.AgentSDom) {
                window.AgentSDom.removeHighlights();
              }
              return { success: true };

            case 'remove_highlights':
              cleanupSoM();
              if (window.AgentSDom) {
                window.AgentSDom.removeHighlights();
              }
              return { success: true };

            case 'click_element':
              return handleClickElement(message.index);

            case 'hover_element':
              return handleHoverElement(message.index);

            case 'input_text':
              return handleInputText(message.index, message.text);

            case 'scroll':
              return handleScroll(message.direction, message.amount);

            case 'wait_for_element':
              return await handleWaitForElement(
                message.selector,
                message.timeout || CONFIG.DEFAULT_WAIT_TIMEOUT
              );

            case 'wait_for_dom_stable':
              return await handleWaitForDomStable(
                message.timeout || 2000,
                message.threshold || 500
              );

            case 'get_page_info':
              return getPageInfo();

            case 'get_markdown':
              if (!window.AgentSDom) {
                return { success: false, error: 'AgentSDom not loaded' };
              }
              return {
                success: true,
                markdown: window.AgentSDom.getMarkdownContent()
              };

            case 'compute_dom_hash':
              if (!window.AgentSDom) {
                return { success: false, error: 'AgentSDom not loaded' };
              }
              return {
                success: true,
                hash: window.AgentSDom.computeDomHash()
              };

            default:
              return { success: false, error: `Unknown message type: ${message.type}` };
          }
        } catch (error) {
          console.error('Crab-Agent message handler error:', error);
          return { success: false, error: error.message };
        }
      };

      // Execute async handler and send response
      handleAsync().then(sendResponse);

      // Return true to indicate async response
      return true;
    });
  });

  // ============================================================================
  // CLEANUP ON UNLOAD
  // ============================================================================

  window.addEventListener('beforeunload', () => {
    try {
      cleanupSoM();
      if (window.AgentSDom) {
        window.AgentSDom.removeHighlights();
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

})();
