/**
 * Crab-Agent Visual Indicator
 * Shows glow border and stop button when agent is running
 * Inspired by Claude extension's visual feedback
 */

(function() {
  'use strict';

  // Prevent double injection
  if (window.__crabAgentVisualIndicator) return;
  window.__crabAgentVisualIndicator = true;

  let glowBorder = null;
  let stopContainer = null;
  let staticIndicator = null;
  let isAgentActive = false;
  let isStaticMode = false;
  let heartbeatInterval = null;

  // Crab orange color
  const CRAB_COLOR = 'rgba(255, 107, 53, 1)';
  const CRAB_COLOR_LIGHT = 'rgba(255, 107, 53, 0.5)';
  const CRAB_COLOR_LIGHTER = 'rgba(255, 107, 53, 0.3)';
  const CRAB_COLOR_LIGHTEST = 'rgba(255, 107, 53, 0.1)';

  /**
   * Inject animation styles
   */
  function injectStyles() {
    if (document.getElementById('crab-agent-animation-styles')) return;

    const style = document.createElement('style');
    style.id = 'crab-agent-animation-styles';
    style.textContent = `
      @keyframes crab-pulse {
        0% {
          box-shadow:
            inset 0 0 10px ${CRAB_COLOR_LIGHT},
            inset 0 0 20px ${CRAB_COLOR_LIGHTER},
            inset 0 0 30px ${CRAB_COLOR_LIGHTEST};
        }
        50% {
          box-shadow:
            inset 0 0 15px ${CRAB_COLOR_LIGHT},
            inset 0 0 25px ${CRAB_COLOR_LIGHT},
            inset 0 0 35px ${CRAB_COLOR_LIGHTER};
        }
        100% {
          box-shadow:
            inset 0 0 10px ${CRAB_COLOR_LIGHT},
            inset 0 0 20px ${CRAB_COLOR_LIGHTER},
            inset 0 0 30px ${CRAB_COLOR_LIGHTEST};
        }
      }

      @keyframes crab-slide-up {
        from {
          transform: translateY(100px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      @keyframes crab-slide-down {
        from {
          transform: translateY(0);
          opacity: 1;
        }
        to {
          transform: translateY(100px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Create glow border element
   */
  function createGlowBorder() {
    const el = document.createElement('div');
    el.id = 'crab-agent-glow-border';
    el.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 2147483646;
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
      animation: crab-pulse 2s ease-in-out infinite;
      box-shadow:
        inset 0 0 10px ${CRAB_COLOR_LIGHT},
        inset 0 0 20px ${CRAB_COLOR_LIGHTER},
        inset 0 0 30px ${CRAB_COLOR_LIGHTEST};
    `;
    return el;
  }

  /**
   * Create stop button container
   */
  function createStopContainer() {
    const container = document.createElement('div');
    container.id = 'crab-agent-stop-container';
    container.style.cssText = `
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      justify-content: center;
      align-items: center;
      pointer-events: none;
      z-index: 2147483647;
    `;

    const button = document.createElement('button');
    button.id = 'crab-agent-stop-button';
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; vertical-align: middle;">
        <circle cx="12" cy="12" r="10"></circle>
        <rect x="9" y="9" width="6" height="6"></rect>
      </svg>
      <span style="vertical-align: middle;">Stop Crab</span>
    `;
    button.style.cssText = `
      position: relative;
      transform: translateY(100px);
      padding: 12px 20px;
      background: #FAF9F5;
      color: #141413;
      border: 1px solid rgba(255, 107, 53, 0.4);
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow:
        0 40px 80px rgba(255, 107, 53, 0.24),
        0 4px 14px rgba(255, 107, 53, 0.24);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      opacity: 0;
      user-select: none;
      pointer-events: auto;
      white-space: nowrap;
    `;

    button.addEventListener('mouseenter', () => {
      if (isAgentActive) {
        button.style.background = '#FFF5F0';
        button.style.borderColor = CRAB_COLOR;
        button.style.boxShadow = '0 40px 80px rgba(255, 107, 53, 0.3), 0 4px 14px rgba(255, 107, 53, 0.3)';
      }
    });

    button.addEventListener('mouseleave', () => {
      if (isAgentActive) {
        button.style.background = '#FAF9F5';
        button.style.borderColor = 'rgba(255, 107, 53, 0.4)';
        button.style.boxShadow = '0 40px 80px rgba(255, 107, 53, 0.24), 0 4px 14px rgba(255, 107, 53, 0.24)';
      }
    });

    button.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'STOP_AGENT', fromTabId: 'CURRENT_TAB' });
      } catch (e) {
        console.error('[CrabVisual] Failed to send stop message:', e);
      }
    });

    container.appendChild(button);
    return container;
  }

  /**
   * Create static indicator (shown when agent is active in tab group)
   */
  function createStaticIndicator() {
    const container = document.createElement('div');
    container.id = 'crab-agent-static-indicator';
    container.innerHTML = `
      <span style="vertical-align: middle; color: #141413; font-size: 14px; display: inline-flex; align-items: center;">
        <span style="display: inline-block; width: 8px; height: 8px; background: #FF6B35; border-radius: 50%; margin-right: 8px; animation: crab-pulse 1.5s ease-in-out infinite;"></span>
        Crab is active in this tab
      </span>
      <div style="display: inline-block; width: 1px; height: 20px; background: rgba(31, 30, 29, 0.15); margin: 0 12px; vertical-align: middle;"></div>
      <button id="crab-static-open-chat" style="
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px 12px;
        background: transparent;
        border: 1px solid rgba(255, 107, 53, 0.3);
        border-radius: 6px;
        cursor: pointer;
        pointer-events: auto;
        font-size: 12px;
        color: #FF6B35;
        transition: all 0.2s;
      ">Open Chat</button>
      <button id="crab-static-dismiss" style="
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 6px;
        background: transparent;
        border: none;
        cursor: pointer;
        pointer-events: auto;
        margin-left: 8px;
        color: #666;
        transition: color 0.2s;
      ">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    container.style.cssText = `
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 16px;
      background: #FAF9F5;
      border: 1px solid rgba(31, 30, 29, 0.2);
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
      z-index: 2147483647;
      pointer-events: none;
      white-space: nowrap;
      user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
    `;

    // Add event listeners after appending to DOM
    setTimeout(() => {
      const openBtn = container.querySelector('#crab-static-open-chat');
      const dismissBtn = container.querySelector('#crab-static-dismiss');

      if (openBtn) {
        openBtn.addEventListener('mouseenter', () => {
          openBtn.style.background = 'rgba(255, 107, 53, 0.1)';
        });
        openBtn.addEventListener('mouseleave', () => {
          openBtn.style.background = 'transparent';
        });
        openBtn.addEventListener('click', async () => {
          try {
            await chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
          } catch (e) {
            console.error('[CrabVisual] Failed to open sidepanel:', e);
          }
        });
      }

      if (dismissBtn) {
        dismissBtn.addEventListener('mouseenter', () => {
          dismissBtn.style.color = '#FF6B35';
        });
        dismissBtn.addEventListener('mouseleave', () => {
          dismissBtn.style.color = '#666';
        });
        dismissBtn.addEventListener('click', () => {
          hideStaticIndicator();
        });
      }
    }, 100);

    return container;
  }

  /**
   * Show agent indicators (glow border + stop button)
   */
  function showAgentIndicators() {
    isAgentActive = true;
    injectStyles();

    if (!glowBorder) {
      glowBorder = createGlowBorder();
      document.body.appendChild(glowBorder);
    } else {
      glowBorder.style.display = '';
    }

    if (!stopContainer) {
      stopContainer = createStopContainer();
      document.body.appendChild(stopContainer);
    } else {
      stopContainer.style.display = '';
    }

    // Animate in
    requestAnimationFrame(() => {
      if (glowBorder) {
        glowBorder.style.opacity = '1';
      }
      if (stopContainer) {
        const btn = stopContainer.querySelector('#crab-agent-stop-button');
        if (btn) {
          btn.style.transform = 'translateY(0)';
          btn.style.opacity = '1';
        }
      }
    });
  }

  /**
   * Hide agent indicators
   */
  function hideAgentIndicators() {
    if (!isAgentActive) return;
    isAgentActive = false;

    if (glowBorder) {
      glowBorder.style.opacity = '0';
    }

    if (stopContainer) {
      const btn = stopContainer.querySelector('#crab-agent-stop-button');
      if (btn) {
        btn.style.transform = 'translateY(100px)';
        btn.style.opacity = '0';
      }
    }

    // Remove after animation
    setTimeout(() => {
      if (!isAgentActive) {
        if (glowBorder && glowBorder.parentNode) {
          glowBorder.parentNode.removeChild(glowBorder);
          glowBorder = null;
        }
        if (stopContainer && stopContainer.parentNode) {
          stopContainer.parentNode.removeChild(stopContainer);
          stopContainer = null;
        }
      }
    }, 300);
  }

  /**
   * Show static indicator
   */
  function showStaticIndicator() {
    isStaticMode = true;
    injectStyles();

    if (!staticIndicator) {
      staticIndicator = createStaticIndicator();
      document.body.appendChild(staticIndicator);
    } else {
      staticIndicator.style.display = '';
    }

    requestAnimationFrame(() => {
      if (staticIndicator) {
        staticIndicator.style.opacity = '1';
      }
    });

    // Start heartbeat
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'STATIC_INDICATOR_HEARTBEAT' });
        if (!response?.success) {
          hideStaticIndicator();
        }
      } catch (e) {
        hideStaticIndicator();
      }
    }, 5000);
  }

  /**
   * Hide static indicator
   */
  function hideStaticIndicator() {
    isStaticMode = false;

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    if (staticIndicator) {
      staticIndicator.style.opacity = '0';
      setTimeout(() => {
        if (!isStaticMode && staticIndicator && staticIndicator.parentNode) {
          staticIndicator.parentNode.removeChild(staticIndicator);
          staticIndicator = null;
        }
      }, 300);
    }
  }

  /**
   * Temporarily hide for tool use
   */
  function hideForToolUse() {
    if (glowBorder) glowBorder.style.display = 'none';
    if (stopContainer) stopContainer.style.display = 'none';
    if (staticIndicator) staticIndicator.style.display = 'none';
  }

  /**
   * Show after tool use
   */
  function showAfterToolUse() {
    if (isAgentActive) {
      if (glowBorder) glowBorder.style.display = '';
      if (stopContainer) stopContainer.style.display = '';
    }
    if (isStaticMode && staticIndicator) {
      staticIndicator.style.display = '';
    }
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'SHOW_AGENT_INDICATORS':
        showAgentIndicators();
        sendResponse({ success: true });
        break;
      case 'HIDE_AGENT_INDICATORS':
        hideAgentIndicators();
        sendResponse({ success: true });
        break;
      case 'SHOW_STATIC_INDICATOR':
        showStaticIndicator();
        sendResponse({ success: true });
        break;
      case 'HIDE_STATIC_INDICATOR':
        hideStaticIndicator();
        sendResponse({ success: true });
        break;
      case 'HIDE_FOR_TOOL_USE':
        hideForToolUse();
        sendResponse({ success: true });
        break;
      case 'SHOW_AFTER_TOOL_USE':
        showAfterToolUse();
        sendResponse({ success: true });
        break;
    }
    return false;
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    hideAgentIndicators();
    hideStaticIndicator();
  });

  console.log('[CrabVisual] Visual indicator loaded');
})();