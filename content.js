/**
 * Crab-Agent Content Script
 * Injected into web pages to enable DOM interaction
 */

(function() {
  'use strict';

  // Check if already injected
  if (window.__agentSContentScriptInjected) {
    return;
  }
  window.__agentSContentScriptInjected = true;

  console.log('Crab-Agent content script loaded');

  // Inject the buildDomTree script
  function injectScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(src);
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = reject;
      (document.head || document.documentElement).appendChild(script);
    });
  }

  // Wait for DOM to be ready
  function onDOMReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback);
    } else {
      callback();
    }
  }

  // Initialize
  onDOMReady(async () => {
    try {
      // The buildDomTree.js will be injected by background script when needed
      // But we can pre-load it for faster execution

      // Listen for messages from background
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
          switch (message.type) {
            case 'ping':
              sendResponse({ status: 'ok' });
              break;

            case 'build_dom_tree':
              if (window.AgentSDom) {
                const result = window.AgentSDom.buildDomTree(message.options || {});
                window.AgentSDom.lastBuildResult = result;
                sendResponse({
                  success: true,
                  textRepresentation: result.textRepresentation,
                  viewportInfo: result.viewportInfo,
                  url: result.url,
                  title: result.title,
                  elementCount: result.elements.length
                });
              } else {
                sendResponse({ success: false, error: 'AgentSDom not loaded' });
              }
              break;

            case 'remove_highlights':
              if (window.AgentSDom) {
                window.AgentSDom.removeHighlights();
                sendResponse({ success: true });
              } else {
                sendResponse({ success: false, error: 'AgentSDom not loaded' });
              }
              break;

            case 'click_element':
              if (window.AgentSDom?.lastBuildResult) {
                const element = window.AgentSDom.lastBuildResult.elementMap[message.index];
                if (element) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  element.click();
                  sendResponse({ success: true });
                } else {
                  sendResponse({ success: false, error: 'Element not found' });
                }
              } else {
                sendResponse({ success: false, error: 'No DOM tree built' });
              }
              break;

            case 'input_text':
              if (window.AgentSDom?.lastBuildResult) {
                const element = window.AgentSDom.lastBuildResult.elementMap[message.index];
                if (element) {
                  const normalize = value => (value == null ? '' : String(value));
                  const expected = normalize(message.text);
                  const disabledInputTypes = new Set(['hidden', 'button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image']);

                  const dispatchInputEvents = (el) => {
                    try {
                      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: null, inputType: 'insertText' }));
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
                      return !el.disabled && !el.readOnly && !disabledInputTypes.has(type);
                    }
                    return !!(el instanceof HTMLElement && el.isContentEditable);
                  };

                  const getAttr = (el, name) => {
                    if (!el || typeof el.getAttribute !== 'function') return '';
                    return normalize(el.getAttribute(name));
                  };

                  const elementMeta = (el) => {
                    if (!el) return 'tag=unknown';
                    const tag = normalize(el.tagName).toLowerCase();
                    const id = normalize(el.id || '');
                    const name = getAttr(el, 'name');
                    const role = getAttr(el, 'role');
                    const ariaLabel = getAttr(el, 'aria-label');
                    const placeholder = getAttr(el, 'placeholder');
                    const className = normalize(el.className || '');
                    return `tag=${tag} id=${id} name=${name} role=${role} aria-label=${ariaLabel} placeholder=${placeholder} class=${className}`;
                  };

                  const findEditableDescendant = (root) => {
                    if (!(root instanceof HTMLElement)) return null;
                    const selector = [
                      'textarea',
                      'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"])',
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
                      return normalize(el.innerText || el.textContent).replace(/\u00a0/g, ' ').trim();
                    }
                    return '';
                  };

                  const setNativeValue = (el, value) => {
                    if (el instanceof HTMLInputElement) {
                      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                      if (descriptor && descriptor.set) {
                        descriptor.set.call(el, value);
                        return;
                      }
                      el.value = value;
                      return;
                    }
                    if (el instanceof HTMLTextAreaElement) {
                      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
                      if (descriptor && descriptor.set) {
                        descriptor.set.call(el, value);
                        return;
                      }
                      el.value = value;
                      return;
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
                      const actualText = actual.trim();
                      const expectedText = value.trim();
                      return expectedText === '' ? actualText === '' : (actualText === expectedText || actualText.includes(expectedText));
                    }
                    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                      return actual === value;
                    }
                    return false;
                  };

                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  element.focus();

                  const target = resolveEditableTarget(element);
                  if (!target) {
                    sendResponse({
                      success: false,
                      error: `Element ${message.index} is not an editable input target`,
                      message: elementMeta(element)
                    });
                    break;
                  }

                  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  target.focus();

                  if (target.isContentEditable) {
                    setContentEditableValue(target, expected);
                  } else {
                    setNativeValue(target, expected);
                  }
                  dispatchInputEvents(target);

                  if (!verify(target, expected)) {
                    const fallbackTarget = resolveEditableTarget(document.activeElement);
                    if (fallbackTarget && fallbackTarget !== target) {
                      fallbackTarget.focus();
                      if (fallbackTarget.isContentEditable) {
                        setContentEditableValue(fallbackTarget, expected);
                      } else {
                        setNativeValue(fallbackTarget, expected);
                      }
                      dispatchInputEvents(fallbackTarget);
                    }
                  }

                  if (!verify(target, expected)) {
                    if (target.isContentEditable) {
                      target.textContent = expected;
                    } else {
                      setNativeValue(target, expected);
                    }
                    dispatchInputEvents(target);
                  }

                  const actual = readElementText(target);
                  if (!verify(target, expected)) {
                    sendResponse({
                      success: false,
                      error: `Text verification failed. Expected "${expected}" but got "${actual}" on ${(target.tagName || '').toLowerCase()}`,
                      message: elementMeta(target)
                    });
                  } else {
                    sendResponse({ success: true, message: elementMeta(target) });
                  }
                } else {
                  sendResponse({ success: false, error: 'Element not found' });
                }
              } else {
                sendResponse({ success: false, error: 'No DOM tree built' });
              }
              break;

            case 'scroll':
              if (window.AgentSDom) {
                window.AgentSDom.scrollPage(message.direction, message.amount);
                sendResponse({ success: true });
              } else {
                // Fallback scrolling
                const viewportHeight = window.innerHeight;
                switch (message.direction) {
                  case 'up':
                    window.scrollBy(0, -viewportHeight * 0.8);
                    break;
                  case 'down':
                    window.scrollBy(0, viewportHeight * 0.8);
                    break;
                  case 'top':
                    window.scrollTo(0, 0);
                    break;
                  case 'bottom':
                    window.scrollTo(0, document.documentElement.scrollHeight);
                    break;
                }
                sendResponse({ success: true });
              }
              break;

            case 'get_page_info':
              sendResponse({
                success: true,
                url: window.location.href,
                title: document.title,
                scrollY: window.scrollY,
                scrollHeight: document.documentElement.scrollHeight,
                viewportHeight: window.innerHeight
              });
              break;

            case 'get_markdown':
              if (window.AgentSDom) {
                const markdown = window.AgentSDom.getMarkdownContent();
                sendResponse({ success: true, markdown });
              } else {
                sendResponse({ success: false, error: 'AgentSDom not loaded' });
              }
              break;

            default:
              sendResponse({ success: false, error: 'Unknown message type' });
          }
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }

        return true; // Keep channel open for async response
      });

    } catch (error) {
      console.error('Crab-Agent content script initialization error:', error);
    }
  });

  // Handle page unload - cleanup highlights
  window.addEventListener('beforeunload', () => {
    if (window.AgentSDom) {
      try {
        window.AgentSDom.removeHighlights();
      } catch (e) {
        // Ignore errors during unload
      }
    }
  });

})();
