/**
 * State Manager - Simplified: no loop detection, no action blocking.
 * Model relies on screenshot reasoning to detect stuck states.
 */

export class StateManager {
  constructor() {
    this.reset();
  }

  reset() {
    // Keep minimal state for compatibility
    this.currentState = null;
  }

  captureState(url, domHash, viewportInfo = {}) {
    return { url, domHash, timestamp: Date.now() };
  }

  recordPreActionState(url, domHash, viewportInfo = {}) {
    this.currentState = this.captureState(url, domHash, viewportInfo);
    return this.currentState;
  }

  checkStateChanged(url, domHash, viewportInfo = {}) {
    // No tracking — always return true (no warnings generated)
    return true;
  }

  buildActionKey(actionName, params) {
    return `${actionName}:${JSON.stringify(params)}`;
  }

  recordActionResult(actionName, params, success, details = '') {
    // No-op — no tracking
  }

  isActionBlocked(actionName, params) {
    // Never block — model decides via reasoning
    return { blocked: false };
  }

  getWarningBlock() {
    // No warnings — model relies on screenshots
    return '';
  }

  getStuckWarning(actionHistory = []) {
    // No stuck detection — model reasons from screenshots
    return null;
  }

  resetPatterns() {
    // No-op
  }
}

/**
 * Screenshot Comparator - Simple approach: store previous screenshot
 * and send BOTH to model for visual comparison.
 * Model does the comparison using its vision capabilities.
 */
export class ScreenshotComparator {
  constructor() {
    this.previousScreenshot = null; // base64 of previous screenshot
    this.previousFormat = 'jpeg';
  }

  reset() {
    this.previousScreenshot = null;
    this.previousFormat = 'jpeg';
  }

  /**
   * Update with new screenshot and return the previous one.
   * @param {string} currentBase64 - Current screenshot base64
   * @param {string} format - Image format (jpeg/png)
   * @returns {Object} { previous: base64|null, hasPrevious: boolean }
   */
  update(currentBase64, format = 'jpeg') {
    const previous = this.previousScreenshot;
    const previousFormat = this.previousFormat;
    const hasPrevious = !!previous;

    // Store current as new previous
    this.previousScreenshot = currentBase64;
    this.previousFormat = format;

    return {
      previous,
      previousFormat,
      hasPrevious
    };
  }

  /**
   * Get previous screenshot data URL for sending to model
   */
  getPreviousDataUrl() {
    if (!this.previousScreenshot) return null;
    return `data:image/${this.previousFormat};base64,${this.previousScreenshot}`;
  }
}

/**
 * Visual State Tracker - Simplified: no change streak tracking.
 * Model relies on screenshot reasoning to detect stuck states.
 */
export class VisualStateTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.previousDomHash = null;
    this.previousUrl = null;
  }

  captureBeforeState(domHash, url) {
    this.previousDomHash = domHash;
    this.previousUrl = url;
  }

  compareWithCurrent(currentDomHash, currentUrl) {
    return {
      domChanged: this.previousDomHash !== currentDomHash,
      urlChanged: this.previousUrl !== currentUrl,
      likelyNoChange: false
    };
  }

  getNoChangeStreak() {
    // Always return 0 — no streak tracking
    return 0;
  }
}

export default StateManager;
