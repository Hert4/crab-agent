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
