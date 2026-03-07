/**
 * CDP Manager - Chrome DevTools Protocol wrapper for Crab-Agent
 * Provides hardware-level browser interaction (click, type, scroll, screenshot)
 * instead of DOM synthetic events.
 */

const CDP_VERSION = '1.3';
const MOUSE_MOVE_STEPS = 5;  // Increased for smoother movement (Claude uses ~5 steps)
const DEFAULT_CLICK_DELAY = 80;  // Increased delay for better click registration
const MOUSE_MOVE_DELAY = 100;  // Delay before click after mouse move (matching Claude)
const SCREENSHOT_QUALITY = {
  INITIAL_JPEG_QUALITY: 80,
  JPEG_QUALITY_STEP: 10,
  MIN_JPEG_QUALITY: 40,
  MAX_BASE64_CHARS: 500000,
  MAX_TARGET_PX: 1568   // Claude-style: max dimension for token optimization
};

class CDPManager {
  constructor() {
    /** @type {Map<number, { refCount: number, detachTimer: number|null }>} */
    this.attachedTabs = new Map();
    /** @type {Map<number, { enabled: boolean, requests: Array }>} */
    this.networkTracking = new Map();
    /** @type {Map<number, { enabled: boolean, messages: Array }>} */
    this.consoleTracking = new Map();
    /** @type {Map<number, { width: number, height: number, devicePixelRatio: number }>} */
    this.viewportCache = new Map();
    /** @type {Map<string, { x: number, y: number, ts: number, tabId: number }>} */
    this.refCache = new Map();  // Cache resolved ref coordinates (TTL 2s)
    this.refCacheTTL = 2000;  // 2 second cache TTL
  }

  // ========== Connection Management ==========

  /**
   * Ensure CDP debugger is attached to tab, reusing existing connections.
   */
  async ensureAttached(tabId) {
    const existing = this.attachedTabs.get(tabId);
    if (existing) {
      existing.refCount++;
      if (existing.detachTimer) {
        clearTimeout(existing.detachTimer);
        existing.detachTimer = null;
      }
      return true;
    }

    try {
      await chrome.debugger.attach({ tabId }, CDP_VERSION);
      this.attachedTabs.set(tabId, { refCount: 1, detachTimer: null });
      return true;
    } catch (error) {
      const msg = String(error?.message || error || '');
      if (/already attached|another debugger/i.test(msg)) {
        // Already attached by something else, we can still use it
        this.attachedTabs.set(tabId, { refCount: 1, detachTimer: null });
        return true;
      }
      console.error(`[CDP] Failed to attach to tab ${tabId}:`, msg);
      return false;
    }
  }

  /**
   * Release a reference. Detach after short delay if no more refs.
   */
  release(tabId) {
    const entry = this.attachedTabs.get(tabId);
    if (!entry) return;

    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount <= 0 && !entry.detachTimer) {
      // Keep attached for 30s to avoid attach/detach churn
      entry.detachTimer = setTimeout(() => {
        this._detach(tabId);
      }, 30000);
    }
  }

  /**
   * Force-detach from a tab immediately.
   * Use this when a task completes to remove the "debugging this browser" bar right away.
   */
  async forceDetach(tabId) {
    const entry = this.attachedTabs.get(tabId);
    if (entry?.detachTimer) {
      clearTimeout(entry.detachTimer);
      entry.detachTimer = null;
    }
    await this._detach(tabId);
  }

  async _detach(tabId) {
    const entry = this.attachedTabs.get(tabId);
    if (!entry) return;

    this.attachedTabs.delete(tabId);
    this.networkTracking.delete(tabId);
    this.consoleTracking.delete(tabId);
    this.viewportCache.delete(tabId);

    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {
      // Already detached or tab closed
    }
  }

  /**
   * Send a CDP command to a tab.
   */
  async sendCommand(tabId, method, params = {}) {
    const attached = await this.ensureAttached(tabId);
    if (!attached) {
      throw new Error(`Cannot attach CDP debugger to tab ${tabId}`);
    }
    try {
      return await chrome.debugger.sendCommand({ tabId }, method, params);
    } catch (error) {
      const msg = String(error?.message || error || '');
      // If debugger was detached, try reattaching once
      if (/not attached|detached/i.test(msg)) {
        this.attachedTabs.delete(tabId);
        const reattached = await this.ensureAttached(tabId);
        if (reattached) {
          return await chrome.debugger.sendCommand({ tabId }, method, params);
        }
      }
      throw error;
    }
  }

  // ========== Viewport Info ==========

  async getViewport(tabId) {
    const cached = this.viewportCache.get(tabId);
    if (cached && Date.now() - (cached._ts || 0) < 5000) return cached;

    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1
        })
      });
      const vp = result?.[0]?.result || { width: 1280, height: 720, devicePixelRatio: 1 };
      vp._ts = Date.now();
      this.viewportCache.set(tabId, vp);
      return vp;
    } catch (e) {
      return { width: 1280, height: 720, devicePixelRatio: 1 };
    }
  }

  // ========== Mouse Actions (Hardware-level) ==========

  /**
   * Move mouse smoothly to target position with intermediate steps
   * for better hover detection on modern web frameworks.
   * Matches Claude extension behavior with proper delays.
   */
  async _moveMouse(tabId, x, y) {
    const steps = MOUSE_MOVE_STEPS;
    // Get approximate current position (default center if unknown)
    const cx = this._lastMouseX ?? Math.round(x * 0.8);
    const cy = this._lastMouseY ?? Math.round(y * 0.8);

    // Calculate distance for adaptive timing
    const distance = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2));
    const stepDelay = distance > 200 ? 15 : 10;  // Slower for long movements

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // Use easeOutQuad for natural movement
      const eased = 1 - Math.pow(1 - t, 2);
      const mx = Math.round(cx + (x - cx) * eased);
      const my = Math.round(cy + (y - cy) * eased);
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: mx,
        y: my,
        button: 'none',
        buttons: 0,
        pointerType: 'mouse'
      });
      if (i < steps) await new Promise(r => setTimeout(r, stepDelay));
    }

    this._lastMouseX = x;
    this._lastMouseY = y;

    // Delay after move before click (Claude-style)
    await new Promise(r => setTimeout(r, MOUSE_MOVE_DELAY));
  }

  /**
   * Left click at coordinates via CDP.
   */
  async click(tabId, x, y, options = {}) {
    const px = Math.round(x);
    const py = Math.round(y);
    const { modifiers = 0 } = options;

    try {
      await this.ensureAttached(tabId);

      // Move mouse to target
      await this._moveMouse(tabId, px, py);

      // Mouse down
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: px, y: py,
        button: 'left',
        buttons: 1,
        clickCount: 1,
        modifiers,
        pointerType: 'mouse'
      });

      // Short delay for natural feel
      await new Promise(r => setTimeout(r, DEFAULT_CLICK_DELAY));

      // Mouse up
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: px, y: py,
        button: 'left',
        buttons: 0,
        clickCount: 1,
        modifiers,
        pointerType: 'mouse'
      });

      return { success: true, x: px, y: py, action: 'left_click' };
    } catch (error) {
      return { success: false, error: `CDP click failed: ${error.message}` };
    }
  }

  /**
   * Right click at coordinates.
   */
  async rightClick(tabId, x, y) {
    const px = Math.round(x);
    const py = Math.round(y);

    try {
      await this.ensureAttached(tabId);
      await this._moveMouse(tabId, px, py);

      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: px, y: py,
        button: 'right', buttons: 2, clickCount: 1,
        pointerType: 'mouse'
      });
      await new Promise(r => setTimeout(r, DEFAULT_CLICK_DELAY));
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: px, y: py,
        button: 'right', buttons: 0, clickCount: 1,
        pointerType: 'mouse'
      });

      return { success: true, x: px, y: py, action: 'right_click' };
    } catch (error) {
      return { success: false, error: `CDP right click failed: ${error.message}` };
    }
  }

  /**
   * Double click at coordinates.
   */
  async doubleClick(tabId, x, y) {
    const px = Math.round(x);
    const py = Math.round(y);

    try {
      await this.ensureAttached(tabId);
      await this._moveMouse(tabId, px, py);

      for (let clickCount = 1; clickCount <= 2; clickCount++) {
        await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: px, y: py,
          button: 'left', buttons: 1, clickCount,
          pointerType: 'mouse'
        });
        await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: px, y: py,
          button: 'left', buttons: 0, clickCount,
          pointerType: 'mouse'
        });
        if (clickCount === 1) await new Promise(r => setTimeout(r, 30));
      }

      return { success: true, x: px, y: py, action: 'double_click' };
    } catch (error) {
      return { success: false, error: `CDP double click failed: ${error.message}` };
    }
  }

  /**
   * Triple click at coordinates (select all text in element).
   */
  async tripleClick(tabId, x, y) {
    const px = Math.round(x);
    const py = Math.round(y);

    try {
      await this.ensureAttached(tabId);
      await this._moveMouse(tabId, px, py);

      for (let clickCount = 1; clickCount <= 3; clickCount++) {
        await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: px, y: py,
          button: 'left', buttons: 1, clickCount,
          pointerType: 'mouse'
        });
        await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: px, y: py,
          button: 'left', buttons: 0, clickCount,
          pointerType: 'mouse'
        });
        if (clickCount < 3) await new Promise(r => setTimeout(r, 30));
      }

      return { success: true, x: px, y: py, action: 'triple_click' };
    } catch (error) {
      return { success: false, error: `CDP triple click failed: ${error.message}` };
    }
  }

  /**
   * Drag from start to end coordinates.
   */
  async drag(tabId, startX, startY, endX, endY, options = {}) {
    const { steps = 10, duration = 300 } = options;
    const sx = Math.round(startX);
    const sy = Math.round(startY);
    const ex = Math.round(endX);
    const ey = Math.round(endY);

    try {
      await this.ensureAttached(tabId);

      // Move to start
      await this._moveMouse(tabId, sx, sy);
      await new Promise(r => setTimeout(r, 50));

      // Press at start
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: sx, y: sy,
        button: 'left', buttons: 1, clickCount: 1,
        pointerType: 'mouse'
      });

      // Move in steps
      const stepDelay = duration / steps;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const mx = Math.round(sx + (ex - sx) * t);
        const my = Math.round(sy + (ey - sy) * t);
        await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: mx, y: my,
          button: 'left', buttons: 1,
          pointerType: 'mouse'
        });
        await new Promise(r => setTimeout(r, stepDelay));
      }

      // Release at end
      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: ex, y: ey,
        button: 'left', buttons: 0, clickCount: 1,
        pointerType: 'mouse'
      });

      return { success: true, start: [sx, sy], end: [ex, ey], action: 'drag' };
    } catch (error) {
      return { success: false, error: `CDP drag failed: ${error.message}` };
    }
  }

  /**
   * Hover (move mouse without clicking).
   */
  async hover(tabId, x, y) {
    try {
      await this.ensureAttached(tabId);
      await this._moveMouse(tabId, Math.round(x), Math.round(y));
      return { success: true, x: Math.round(x), y: Math.round(y), action: 'hover' };
    } catch (error) {
      return { success: false, error: `CDP hover failed: ${error.message}` };
    }
  }

  // ========== Keyboard Actions ==========

  /**
   * Key name mapping for CDP Input.dispatchKeyEvent.
   */
  _resolveKey(key) {
    const KEY_MAP = {
      'enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
      'return': { key: 'Enter', code: 'Enter', keyCode: 13 },
      'tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
      'escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
      'esc': { key: 'Escape', code: 'Escape', keyCode: 27 },
      'backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      'delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
      'space': { key: ' ', code: 'Space', keyCode: 32 },
      'arrowup': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      'arrowdown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      'arrowleft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
      'arrowright': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      'home': { key: 'Home', code: 'Home', keyCode: 36 },
      'end': { key: 'End', code: 'End', keyCode: 35 },
      'pageup': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
      'pagedown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },
      'f1': { key: 'F1', code: 'F1', keyCode: 112 },
      'f2': { key: 'F2', code: 'F2', keyCode: 113 },
      'f3': { key: 'F3', code: 'F3', keyCode: 114 },
      'f4': { key: 'F4', code: 'F4', keyCode: 115 },
      'f5': { key: 'F5', code: 'F5', keyCode: 116 },
      'f11': { key: 'F11', code: 'F11', keyCode: 122 },
      'f12': { key: 'F12', code: 'F12', keyCode: 123 },
    };

    const lower = key.toLowerCase();
    if (KEY_MAP[lower]) return KEY_MAP[lower];

    // Single character
    if (key.length === 1) {
      const code = key.charCodeAt(0);
      return {
        key: key,
        code: `Key${key.toUpperCase()}`,
        keyCode: code >= 97 && code <= 122 ? code - 32 : code
      };
    }

    return { key, code: key, keyCode: 0 };
  }

  /**
   * Parse modifier string like "ctrl+shift" into CDP modifier flags.
   */
  _parseModifiers(modStr) {
    if (!modStr) return 0;
    let flags = 0;
    const parts = String(modStr).toLowerCase().split('+');
    for (const part of parts) {
      const p = part.trim();
      if (p === 'alt') flags |= 1;
      if (p === 'ctrl' || p === 'control') flags |= 2;
      if (p === 'meta' || p === 'cmd' || p === 'command' || p === 'win' || p === 'windows') flags |= 4;
      if (p === 'shift') flags |= 8;
    }
    return flags;
  }

  /**
   * Type text character by character via CDP.
   * Uses keyDown+keyUp for characters that have keyCodes (like Claude extension),
   * and Input.insertText for special/unicode characters.
   * This ensures compatibility with frameworks that only listen to keyDown/keyUp.
   */
  async type(tabId, text) {
    if (!text) return { success: true, action: 'type', text: '' };

    try {
      await this.ensureAttached(tabId);

      for (const char of text) {
        // Handle newlines as Enter key press
        if (char === '\n' || char === '\r') {
          const enterKey = this._resolveKey('enter');
          await this.sendCommand(tabId, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: enterKey.key,
            code: enterKey.code,
            windowsVirtualKeyCode: enterKey.keyCode,
            nativeVirtualKeyCode: enterKey.keyCode,
            text: '\r',
            unmodifiedText: '\r'
          });
          await this.sendCommand(tabId, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: enterKey.key,
            code: enterKey.code,
            windowsVirtualKeyCode: enterKey.keyCode,
            nativeVirtualKeyCode: enterKey.keyCode
          });
          await new Promise(r => setTimeout(r, 20));
          continue;
        }

        // Try to find a keyCode for standard ASCII characters
        const keyCode = this._getCharKeyCode(char);
        if (keyCode) {
          // Dispatch proper keyDown + keyUp (like Claude extension)
          const needsShift = this._requiresShift(char);
          const modifiers = needsShift ? 8 : 0;

          await this.sendCommand(tabId, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: char,
            code: keyCode.code,
            windowsVirtualKeyCode: keyCode.keyCode,
            nativeVirtualKeyCode: keyCode.keyCode,
            text: char,
            unmodifiedText: char,
            modifiers
          });
          await this.sendCommand(tabId, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: char,
            code: keyCode.code,
            windowsVirtualKeyCode: keyCode.keyCode,
            nativeVirtualKeyCode: keyCode.keyCode,
            modifiers
          });
        } else {
          // Unicode/special characters: use insertText
          await this.sendCommand(tabId, 'Input.insertText', { text: char });
        }

        // Small delay between characters for natural feel
        await new Promise(r => setTimeout(r, 15));
      }

      return { success: true, action: 'type', text: text.substring(0, 50) };
    } catch (error) {
      return { success: false, error: `CDP type failed: ${error.message}` };
    }
  }

  /**
   * Get key code info for a printable ASCII character.
   * Returns null for non-ASCII or special characters.
   */
  _getCharKeyCode(char) {
    const code = char.charCodeAt(0);
    // a-z
    if (code >= 97 && code <= 122) {
      return { code: `Key${char.toUpperCase()}`, keyCode: code - 32 };
    }
    // A-Z
    if (code >= 65 && code <= 90) {
      return { code: `Key${char}`, keyCode: code };
    }
    // 0-9
    if (code >= 48 && code <= 57) {
      return { code: `Digit${char}`, keyCode: code };
    }
    // Space
    if (code === 32) {
      return { code: 'Space', keyCode: 32 };
    }
    // Common punctuation
    const PUNCTUATION = {
      '-': { code: 'Minus', keyCode: 189 },
      '=': { code: 'Equal', keyCode: 187 },
      '[': { code: 'BracketLeft', keyCode: 219 },
      ']': { code: 'BracketRight', keyCode: 221 },
      '\\': { code: 'Backslash', keyCode: 220 },
      ';': { code: 'Semicolon', keyCode: 186 },
      "'": { code: 'Quote', keyCode: 222 },
      ',': { code: 'Comma', keyCode: 188 },
      '.': { code: 'Period', keyCode: 190 },
      '/': { code: 'Slash', keyCode: 191 },
      '`': { code: 'Backquote', keyCode: 192 },
    };
    return PUNCTUATION[char] || null;
  }

  /**
   * Check if a character requires shift key.
   */
  _requiresShift(char) {
    const code = char.charCodeAt(0);
    // Uppercase A-Z
    if (code >= 65 && code <= 90) return true;
    // Shifted punctuation
    return '~!@#$%^&*()_+{}|:"<>?'.includes(char);
  }

  /**
   * Press a key or key combination.
   * @param {string} keys - Space-separated keys, e.g. "ctrl+a" or "Enter" or "Backspace Backspace"
   * @param {number} repeat - Number of times to repeat
   */
  async pressKey(tabId, keys, repeat = 1) {
    try {
      await this.ensureAttached(tabId);

      const keySequence = String(keys).split(/\s+/).filter(Boolean);

      for (let r = 0; r < repeat; r++) {
        for (const combo of keySequence) {
          const parts = combo.split('+');
          const mainKey = parts.pop();
          const modStr = parts.join('+');
          const modifiers = this._parseModifiers(modStr);
          const resolved = this._resolveKey(mainKey);

          // Key down
          await this.sendCommand(tabId, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: resolved.key,
            code: resolved.code,
            windowsVirtualKeyCode: resolved.keyCode,
            nativeVirtualKeyCode: resolved.keyCode,
            modifiers
          });

          // For printable characters, also insert text
          if (resolved.key.length === 1 && !modifiers) {
            await this.sendCommand(tabId, 'Input.dispatchKeyEvent', {
              type: 'char',
              text: resolved.key,
              key: resolved.key,
              code: resolved.code,
              modifiers
            });
          }

          // Key up
          await this.sendCommand(tabId, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: resolved.key,
            code: resolved.code,
            windowsVirtualKeyCode: resolved.keyCode,
            nativeVirtualKeyCode: resolved.keyCode,
            modifiers
          });
        }

        if (r < repeat - 1) await new Promise(r => setTimeout(r, 30));
      }

      return { success: true, action: 'key', keys, repeat };
    } catch (error) {
      return { success: false, error: `CDP key press failed: ${error.message}` };
    }
  }

  // ========== Scroll ==========

  /**
   * Scroll at coordinates in a direction.
   */
  async scroll(tabId, x, y, direction, amount = 3) {
    const px = Math.round(x || 0);
    const py = Math.round(y || 0);
    const scrollAmount = 120 * (amount || 3); // 120 = one "tick"

    const deltas = {
      'up': { deltaX: 0, deltaY: -scrollAmount },
      'down': { deltaX: 0, deltaY: scrollAmount },
      'left': { deltaX: -scrollAmount, deltaY: 0 },
      'right': { deltaX: scrollAmount, deltaY: 0 }
    };

    const delta = deltas[direction] || deltas['down'];

    try {
      await this.ensureAttached(tabId);

      await this.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: px, y: py,
        deltaX: delta.deltaX,
        deltaY: delta.deltaY,
        pointerType: 'mouse'
      });

      return { success: true, action: 'scroll', direction, amount, x: px, y: py };
    } catch (error) {
      return { success: false, error: `CDP scroll failed: ${error.message}` };
    }
  }

  // ========== Screenshot ==========

  /**
   * Take screenshot via CDP (better quality control than chrome.tabs.captureVisibleTab).
   * Returns screenshot scaled down to CSS pixel dimensions (accounting for devicePixelRatio)
   * and further optimized for LLM token cost (max 1568px dimension, progressive JPEG quality).
   * Coordinates in the screenshot will match viewport coordinates for CDP input events.
   */
  async screenshot(tabId, options = {}) {
    const { format = 'jpeg', quality = SCREENSHOT_QUALITY.INITIAL_JPEG_QUALITY } = options;

    try {
      // Try CDP screenshot first
      await this.ensureAttached(tabId);
      const viewport = await this.getViewport(tabId);
      const dpr = viewport.devicePixelRatio || 1;

      const result = await this.sendCommand(tabId, 'Page.captureScreenshot', {
        format,
        ...(format === 'jpeg' || format === 'webp') && { quality },
        captureBeyondViewport: false,
        fromSurface: true
      });

      if (!result?.data) {
        throw new Error('No screenshot data returned');
      }

      // Step 1: Scale from native resolution to CSS pixel dimensions
      // CDP captures at native resolution (viewport × devicePixelRatio).
      // We need CSS pixel coords so LLM coordinates match CDP Input events.
      let screenshotBase64 = result.data;
      let outputWidth = viewport.width;
      let outputHeight = viewport.height;

      if (dpr > 1) {
        try {
          const scaled = await this._scaleScreenshot(
            tabId, result.data, format,
            viewport.width, viewport.height, dpr
          );
          if (scaled) {
            screenshotBase64 = scaled.base64;
            outputWidth = scaled.width;
            outputHeight = scaled.height;
          }
        } catch (scaleErr) {
          console.warn('[CDP] DPR scaling failed, using native resolution:', scaleErr.message);
        }
      }

      // Step 2: Token optimization — scale down if larger than MAX_TARGET_PX (Claude-style)
      const maxDim = SCREENSHOT_QUALITY.MAX_TARGET_PX;
      if (outputWidth > maxDim || outputHeight > maxDim) {
        const scale = maxDim / Math.max(outputWidth, outputHeight);
        const targetW = Math.round(outputWidth * scale);
        const targetH = Math.round(outputHeight * scale);
        try {
          const optimized = await this._resizeScreenshot(tabId, screenshotBase64, format, targetW, targetH);
          if (optimized) {
            screenshotBase64 = optimized.base64;
            outputWidth = optimized.width;
            outputHeight = optimized.height;
          }
        } catch (resizeErr) {
          console.warn('[CDP] Token optimization resize failed:', resizeErr.message);
        }
      }

      // Step 3: Progressive JPEG quality reduction if still too large
      if (format === 'jpeg' && screenshotBase64.length > SCREENSHOT_QUALITY.MAX_BASE64_CHARS) {
        let q = 70;
        while (q >= SCREENSHOT_QUALITY.MIN_JPEG_QUALITY && screenshotBase64.length > SCREENSHOT_QUALITY.MAX_BASE64_CHARS) {
          try {
            const recompressed = await this._recompressJpeg(tabId, screenshotBase64, q, outputWidth, outputHeight);
            if (recompressed) {
              screenshotBase64 = recompressed;
            }
          } catch (e) {
            break;
          }
          q -= SCREENSHOT_QUALITY.JPEG_QUALITY_STEP;
        }
      }

      return {
        success: true,
        base64: screenshotBase64,
        format,
        width: outputWidth,
        height: outputHeight,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height
      };
    } catch (cdpError) {
      // Fallback to chrome.tabs.captureVisibleTab
      try {
        const tab = await chrome.tabs.get(tabId);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        return {
          success: true,
          base64,
          format: 'png',
          width: 0, height: 0,
          fallback: true
        };
      } catch (fallbackError) {
        return { success: false, error: `Screenshot failed: ${cdpError.message}` };
      }
    }
  }

  /**
   * Scale a screenshot down from native resolution to CSS pixel dimensions
   * using a content script with OffscreenCanvas/Canvas.
   */
  async _scaleScreenshot(tabId, base64Data, format, targetWidth, targetHeight, dpr) {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (b64, fmt, tw, th, devicePixelRatio) => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            // Native dimensions from CDP
            const nativeW = img.width;
            const nativeH = img.height;

            // Target CSS pixel dimensions
            const cssW = Math.round(nativeW / devicePixelRatio);
            const cssH = Math.round(nativeH / devicePixelRatio);

            // No scaling needed if already at CSS pixel size
            if (nativeW === cssW && nativeH === cssH) {
              resolve(null);
              return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = cssW;
            canvas.height = cssH;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('No 2d context'));
              return;
            }

            // High-quality downscale
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, nativeW, nativeH, 0, 0, cssW, cssH);

            const mimeType = fmt === 'png' ? 'image/png' : 'image/jpeg';
            const quality = fmt === 'jpeg' ? 0.85 : undefined;
            const dataUrl = canvas.toDataURL(mimeType, quality);
            const scaledBase64 = dataUrl.split(',')[1];

            resolve({ base64: scaledBase64, width: cssW, height: cssH });
          };
          img.onerror = () => reject(new Error('Failed to load screenshot for scaling'));
          img.src = `data:image/${fmt === 'png' ? 'png' : 'jpeg'};base64,${b64}`;
        });
      },
      args: [base64Data, format, targetWidth, targetHeight, dpr]
    });

    return result?.[0]?.result || null;
  }

  /**
   * Resize a screenshot to target dimensions for token optimization.
   * Used when screenshot CSS dimensions exceed MAX_TARGET_PX.
   */
  async _resizeScreenshot(tabId, base64Data, format, targetWidth, targetHeight) {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (b64, fmt, tw, th) => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = tw;
            canvas.height = th;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('No 2d context')); return; }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, tw, th);
            const mimeType = fmt === 'png' ? 'image/png' : 'image/jpeg';
            const quality = fmt === 'jpeg' ? 0.80 : undefined;
            const dataUrl = canvas.toDataURL(mimeType, quality);
            resolve({ base64: dataUrl.split(',')[1], width: tw, height: th });
          };
          img.onerror = () => reject(new Error('Failed to load image for resize'));
          img.src = `data:image/${fmt === 'png' ? 'png' : 'jpeg'};base64,${b64}`;
        });
      },
      args: [base64Data, format, targetWidth, targetHeight]
    });
    return result?.[0]?.result || null;
  }

  /**
   * Recompress a JPEG screenshot at a lower quality level.
   * Returns new base64 string or null on failure.
   */
  async _recompressJpeg(tabId, base64Data, quality, width, height) {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (b64, q, w, h) => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = w || img.width;
            canvas.height = h || img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('No 2d context')); return; }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', q / 100);
            resolve(dataUrl.split(',')[1]);
          };
          img.onerror = () => reject(new Error('Failed to load image for recompress'));
          img.src = `data:image/jpeg;base64,${b64}`;
        });
      },
      args: [base64Data, quality, width, height]
    });
    return result?.[0]?.result || null;
  }

  /**
   * Take a zoomed screenshot of a specific region.
   */
  async screenshotRegion(tabId, region) {
    const [x0, y0, x1, y1] = region;
    const vp = await this.getViewport(tabId);

    try {
      await this.ensureAttached(tabId);

      const clip = {
        x: Math.max(0, x0),
        y: Math.max(0, y0),
        width: Math.max(1, x1 - x0),
        height: Math.max(1, y1 - y0),
        scale: vp.devicePixelRatio || 1
      };

      const result = await this.sendCommand(tabId, 'Page.captureScreenshot', {
        format: 'png',
        clip,
        captureBeyondViewport: false,
        fromSurface: true
      });

      if (!result?.data) throw new Error('No region screenshot data');

      return {
        success: true,
        base64: result.data,
        format: 'png',
        region: [x0, y0, x1, y1]
      };
    } catch (error) {
      return { success: false, error: `Region screenshot failed: ${error.message}` };
    }
  }

  // ========== Console & Network Monitoring ==========

  /**
   * Enable console message tracking for a tab.
   */
  async enableConsoleTracking(tabId) {
    if (this.consoleTracking.has(tabId)) return;

    await this.ensureAttached(tabId);
    await this.sendCommand(tabId, 'Runtime.enable', {});

    this.consoleTracking.set(tabId, { enabled: true, messages: [] });

    // Listen for console events
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId !== tabId || method !== 'Runtime.consoleAPICalled') return;
      const tracking = this.consoleTracking.get(tabId);
      if (!tracking) return;

      const message = {
        type: params.type, // log, warn, error, info
        text: (params.args || []).map(arg => arg.value || arg.description || '').join(' '),
        timestamp: Date.now(),
        url: params.stackTrace?.callFrames?.[0]?.url || ''
      };

      tracking.messages.push(message);
      // Keep last 200 messages
      if (tracking.messages.length > 200) {
        tracking.messages = tracking.messages.slice(-200);
      }
    });
  }

  /**
   * Get collected console messages.
   */
  getConsoleMessages(tabId) {
    return this.consoleTracking.get(tabId)?.messages || [];
  }

  clearConsoleMessages(tabId) {
    const tracking = this.consoleTracking.get(tabId);
    if (tracking) tracking.messages = [];
  }

  /**
   * Enable network request tracking for a tab.
   */
  async enableNetworkTracking(tabId) {
    if (this.networkTracking.has(tabId)) return;

    await this.ensureAttached(tabId);
    await this.sendCommand(tabId, 'Network.enable', {});

    this.networkTracking.set(tabId, { enabled: true, requests: [] });

    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId !== tabId) return;
      const tracking = this.networkTracking.get(tabId);
      if (!tracking) return;

      if (method === 'Network.requestWillBeSent') {
        tracking.requests.push({
          id: params.requestId,
          url: params.request.url,
          method: params.request.method,
          type: params.type,
          timestamp: Date.now(),
          status: null,
          responseHeaders: null
        });
        // Keep last 300 requests
        if (tracking.requests.length > 300) {
          tracking.requests = tracking.requests.slice(-300);
        }
      } else if (method === 'Network.responseReceived') {
        const req = tracking.requests.find(r => r.id === params.requestId);
        if (req) {
          req.status = params.response.status;
          req.statusText = params.response.statusText;
          req.mimeType = params.response.mimeType;
        }
      }
    });
  }

  /**
   * Get collected network requests.
   */
  getNetworkRequests(tabId) {
    return this.networkTracking.get(tabId)?.requests || [];
  }

  clearNetworkRequests(tabId) {
    const tracking = this.networkTracking.get(tabId);
    if (tracking) tracking.requests = [];
  }

  // ========== Ref Resolution ==========

  /**
   * Resolve a ref_id to coordinates by looking up __crabElementMap in the page.
   * Uses caching with TTL to avoid repeated DOM queries.
   */
  async resolveRef(tabId, refId, useCache = true) {
    // Check cache first
    if (useCache) {
      const cacheKey = `${tabId}:${refId}`;
      const cached = this.refCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < this.refCacheTTL) {
        return cached;
      }
    }

    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (ref) => {
        const map = window.__crabElementMap;
        if (!map) return null;

        const weakRef = map[ref];
        if (!weakRef) return null;

        const el = weakRef.deref ? weakRef.deref() : weakRef;
        if (!el || !el.isConnected) return null;

        // Only scrollIntoView if element is NOT already in the viewport
        // This prevents dismissing dropdowns/popups that are already visible
        const rect = el.getBoundingClientRect();
        const inViewport = rect.top >= 0 && rect.left >= 0 &&
          rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
        if (!inViewport) {
          el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        }

        // Re-read rect after possible scroll
        const finalRect = inViewport ? rect : el.getBoundingClientRect();
        if (finalRect.width === 0 && finalRect.height === 0) return null;

        return {
          x: Math.round(finalRect.x + finalRect.width / 2),
          y: Math.round(finalRect.y + finalRect.height / 2),
          width: Math.round(finalRect.width),
          height: Math.round(finalRect.height),
          tag: (el.tagName || '').toLowerCase(),
          text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 80),
          scrolled: !inViewport
        };
      },
      args: [refId]
    });

    const resolved = result?.[0]?.result || null;

    // Cache the result
    if (resolved) {
      const cacheKey = `${tabId}:${refId}`;
      this.refCache.set(cacheKey, { ...resolved, ts: Date.now(), tabId });

      // Cleanup old cache entries (keep last 100)
      if (this.refCache.size > 100) {
        const entries = [...this.refCache.entries()];
        entries.sort((a, b) => a[1].ts - b[1].ts);
        for (let i = 0; i < entries.length - 100; i++) {
          this.refCache.delete(entries[i][0]);
        }
      }
    }

    return resolved;
  }

  /**
   * Invalidate ref cache for a tab (call after page navigation).
   */
  invalidateRefCache(tabId) {
    for (const key of this.refCache.keys()) {
      if (key.startsWith(`${tabId}:`)) {
        this.refCache.delete(key);
      }
    }
  }

  /**
   * Verify the tab's current URL matches expected domain.
   * Use this before mutating actions to prevent cross-domain attacks.
   */
  async verifyDomain(tabId, expectedOrigin) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.url) return { valid: false, error: 'No URL' };

      const currentOrigin = new URL(tab.url).origin;
      if (expectedOrigin && currentOrigin !== expectedOrigin) {
        return {
          valid: false,
          error: `Domain changed: expected ${expectedOrigin}, got ${currentOrigin}`,
          currentOrigin
        };
      }
      return { valid: true, currentOrigin };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  // ========== File Upload ==========

  /**
   * Set files on a file input element via CDP.
   */
  async setFileInputFiles(tabId, refId, filePaths) {
    try {
      await this.ensureAttached(tabId);

      // Get the DOM node for the file input
      const nodeResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: (ref) => {
          const el = window.__crabElementMap?.[ref]?.deref?.() ||
                     document.querySelector(`[data-crab-ref-id="${ref}"]`);
          if (!el) return null;
          return { backendNodeId: el.__backendNodeId || null };
        },
        args: [refId]
      });

      // Use CDP to set files
      const doc = await this.sendCommand(tabId, 'DOM.getDocument', {});
      const fileInput = await this.sendCommand(tabId, 'DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: `input[type="file"]`
      });

      if (fileInput?.nodeId) {
        await this.sendCommand(tabId, 'DOM.setFileInputFiles', {
          nodeId: fileInput.nodeId,
          files: filePaths
        });
        return { success: true, action: 'file_upload', files: filePaths.length };
      }

      return { success: false, error: 'No file input found' };
    } catch (error) {
      return { success: false, error: `File upload failed: ${error.message}` };
    }
  }

  // ========== Cleanup ==========

  /**
   * Detach from all tabs.
   */
  async detachAll() {
    const tabIds = [...this.attachedTabs.keys()];
    for (const tabId of tabIds) {
      await this._detach(tabId);
    }
  }
}

// Singleton instance
export const cdp = new CDPManager();
export default CDPManager;
