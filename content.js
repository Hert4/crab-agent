/**
 * Crab-Agent Content Script v2.1 (Modular)
 * Injected into web pages for:
 * - Set-of-Mark (SoM) overlay visualization (for user visibility)
 * - Page info queries
 * - Message relay to background service worker
 *
 * NOTE: Action execution (clicks, typing, scrolling) is now handled by
 * CDP via core/cdp-manager.js - this script no longer dispatches synthetic events.
 */

(function() {
  'use strict';

  if (window.__crabAgentContentScriptInjected) return;
  window.__crabAgentContentScriptInjected = true;

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  const CONFIG = {
    SOM_CONTAINER_ID: 'crab-agent-som-container',
    HIGHLIGHT_Z_INDEX: 2147483647
  };

  const HIGHLIGHT_COLORS = [
    '#FF0000', '#00FF00', '#0000FF', '#FFA500', '#800080',
    '#008080', '#FF69B4', '#FFD700', '#00CED1', '#FF4500',
    '#9400D3', '#32CD32', '#FF1493', '#00BFFF', '#FF6347'
  ];

  // ============================================================================
  // SET-OF-MARK (SoM) OVERLAY SYSTEM
  // Kept for user visibility - shows numbered boxes over interactive elements.
  // ============================================================================

  function createSoMContainer() {
    let container = document.getElementById(CONFIG.SOM_CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = CONFIG.SOM_CONTAINER_ID;
      Object.assign(container.style, {
        position: 'fixed',
        top: '0', left: '0',
        width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: String(CONFIG.HIGHLIGHT_Z_INDEX)
      });
      document.body.appendChild(container);
    }
    return container;
  }

  function drawBoundingBoxes(elementsList) {
    cleanupSoM();
    const container = createSoMContainer();

    for (const elInfo of elementsList) {
      try {
        const { index, rect, obstructed } = elInfo;
        if (!rect || rect.width === 0 || rect.height === 0) continue;

        const color = HIGHLIGHT_COLORS[index % HIGHLIGHT_COLORS.length];

        const box = document.createElement('div');
        box.className = 'crab-som-box';
        box.setAttribute('data-som-index', index);
        Object.assign(box.style, {
          position: 'fixed',
          left: `${rect.x}px`, top: `${rect.y}px`,
          width: `${rect.width}px`, height: `${rect.height}px`,
          border: `3px solid ${color}`,
          backgroundColor: obstructed ? `${color}11` : `${color}15`,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.3)'
        });

        const label = document.createElement('div');
        label.className = 'crab-som-label';
        label.textContent = String(index);
        Object.assign(label.style, {
          position: 'absolute',
          top: '-22px', left: '-2px',
          backgroundColor: obstructed ? '#666' : color,
          color: 'white',
          fontSize: '14px', fontWeight: 'bold',
          fontFamily: 'Arial, sans-serif',
          padding: '2px 6px', borderRadius: '4px',
          minWidth: '20px', textAlign: 'center',
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.5)'
        });
        if (obstructed) label.textContent += ' ⚠';

        box.appendChild(label);
        container.appendChild(box);
      } catch (e) {}
    }
    return container;
  }

  function cleanupSoM() {
    const container = document.getElementById(CONFIG.SOM_CONTAINER_ID);
    if (container) container.remove();
    document.querySelectorAll('.crab-som-box, .crab-agent-highlight-overlay').forEach(el => el.remove());
  }

  // ============================================================================
  // PAGE INFO
  // ============================================================================

  function getPageInfo() {
    return {
      success: true,
      url: window.location.href,
      title: document.title,
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth
    };
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
    console.log('[Crab-Agent] Content script v2.1 loaded');

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const handleAsync = async () => {
        try {
          switch (message.type) {
            case 'ping':
              return { status: 'ok', version: '2.1' };

            case 'draw_som':
              if (!message.elements) return { success: false, error: 'No elements' };
              drawBoundingBoxes(message.elements);
              return { success: true };

            case 'cleanup_som':
              cleanupSoM();
              if (window.AgentSDom) window.AgentSDom.removeHighlights();
              return { success: true };

            case 'remove_highlights':
              cleanupSoM();
              if (window.AgentSDom) window.AgentSDom.removeHighlights();
              return { success: true };

            case 'get_page_info':
              return getPageInfo();

            case 'build_dom_tree':
              // Legacy support: still allow building DOM tree for SoM overlay
              if (!window.AgentSDom) {
                // Try to inject the script
                try {
                  const script = document.createElement('script');
                  script.src = chrome.runtime.getURL('lib/buildDomTree.js');
                  document.head.appendChild(script);
                  await new Promise(r => setTimeout(r, 500));
                  script.remove();
                } catch (e) {}
              }
              if (!window.AgentSDom) return { success: false, error: 'AgentSDom not loaded' };

              const result = window.AgentSDom.buildDomTree(message.options || {});
              window.AgentSDom.lastBuildResult = result;
              return {
                success: true,
                textRepresentation: result.textRepresentation,
                viewportInfo: result.viewportInfo,
                url: result.url,
                title: result.title,
                elementCount: result.elements.length,
                elements: result.elements
              };

            case 'compute_dom_hash':
              return {
                success: true,
                hash: window.AgentSDom?.computeDomHash?.() || String(document.body?.innerHTML?.length || 0)
              };

            default:
              return { success: false, error: `Unknown message type: ${message.type}` };
          }
        } catch (error) {
          console.error('[Crab-Agent] Message handler error:', error);
          return { success: false, error: error.message };
        }
      };

      handleAsync().then(sendResponse);
      return true; // Async response
    });
  });

  // ============================================================================
  // CLEANUP
  // ============================================================================

  window.addEventListener('beforeunload', () => {
    try {
      cleanupSoM();
      if (window.AgentSDom) window.AgentSDom.removeHighlights();
    } catch (e) {}
  });

})();
