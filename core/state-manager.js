/**
 * State Manager - Tracks action patterns, loop detection, and state changes.
 * Extracted from background.js.
 */

const StateManagerConfig = {
  MAX_FAILED_ACTIONS: 20,
  DUPLICATE_ACTION_THRESHOLD: 3,
  STATE_HISTORY_SIZE: 50
};

export class StateManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.stateHistory = [];
    this.failedActions = [];
    this.actionPatterns = new Map();
    this.currentState = null;
    this.stats = {
      totalActions: 0,
      successfulActions: 0,
      failedActions: 0,
      loopsDetected: 0,
      stateUnchangedCount: 0
    };
  }

  captureState(url, domHash, viewportInfo = {}) {
    return {
      url,
      domHash,
      scrollY: viewportInfo.scrollY || 0,
      timestamp: Date.now(),
      signature: `${url}|${domHash}|${viewportInfo.scrollY || 0}`
    };
  }

  recordPreActionState(url, domHash, viewportInfo = {}) {
    this.currentState = this.captureState(url, domHash, viewportInfo);
    return this.currentState;
  }

  checkStateChanged(url, domHash, viewportInfo = {}) {
    if (!this.currentState) return true;
    const newState = this.captureState(url, domHash, viewportInfo);
    const changed =
      this.currentState.url !== newState.url ||
      this.currentState.domHash !== newState.domHash ||
      Math.abs((this.currentState.scrollY || 0) - (newState.scrollY || 0)) > 50;

    if (!changed) {
      this.stats.stateUnchangedCount++;
    } else {
      this.stats.stateUnchangedCount = 0;
    }

    this.stateHistory.push({ before: this.currentState, after: newState, changed });
    if (this.stateHistory.length > StateManagerConfig.STATE_HISTORY_SIZE) {
      this.stateHistory.shift();
    }
    return changed;
  }

  buildActionKey(actionName, params) {
    const safeParams = this._sanitizeParams(params);
    return `${actionName}:${JSON.stringify(safeParams)}`;
  }

  _sanitizeParams(params) {
    if (!params || typeof params !== 'object') return params;
    const sanitized = {};
    for (const [key, value] of Object.entries(params)) {
      if (/time|date|timestamp/i.test(key)) continue;
      if (typeof value === 'string' && value.length > 100) {
        sanitized[key] = value.slice(0, 100);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  recordActionResult(actionName, params, success, details = '') {
    this.stats.totalActions++;
    if (success) {
      this.stats.successfulActions++;
    } else {
      this.stats.failedActions++;
    }

    const actionKey = this.buildActionKey(actionName, params);

    if (!success) {
      this.failedActions.push({
        action: actionName,
        params: this._sanitizeParams(params),
        details,
        timestamp: Date.now(),
        key: actionKey
      });
      if (this.failedActions.length > StateManagerConfig.MAX_FAILED_ACTIONS) {
        this.failedActions.shift();
      }
    }

    const currentCount = this.actionPatterns.get(actionKey) || 0;
    this.actionPatterns.set(actionKey, currentCount + 1);

    if (this.actionPatterns.get(actionKey) >= StateManagerConfig.DUPLICATE_ACTION_THRESHOLD) {
      this.stats.loopsDetected++;
    }
  }

  isActionBlocked(actionName, params) {
    const actionKey = this.buildActionKey(actionName, params);
    const count = this.actionPatterns.get(actionKey) || 0;

    if (count >= StateManagerConfig.DUPLICATE_ACTION_THRESHOLD) {
      return { blocked: true, reason: `Action repeated ${count} times without success` };
    }

    const recentFailed = this.failedActions.slice(-5).filter(a => a.key === actionKey);
    if (recentFailed.length >= 2) {
      return { blocked: true, reason: 'Action failed multiple times recently' };
    }

    return { blocked: false };
  }

  getWarningBlock() {
    const warnings = [];

    if (this.failedActions.length > 0) {
      const recentFailed = this.failedActions.slice(-5);
      const failedSummary = recentFailed
        .map(a => `- ${a.action}(${JSON.stringify(a.params || {}).slice(0, 40)}) -> ${a.details || 'failed'}`)
        .join('\n');
      warnings.push(
        `[FAILED ACTIONS]\nDO NOT repeat:\n${failedSummary}\nTry different approach.`
      );
    }

    const repeatedActions = [];
    for (const [key, count] of this.actionPatterns.entries()) {
      if (count >= StateManagerConfig.DUPLICATE_ACTION_THRESHOLD - 1) {
        repeatedActions.push({ key, count });
      }
    }
    if (repeatedActions.length > 0) {
      warnings.push(
        '[LOOP DETECTED]\nRepeating actions without progress. Try: scroll, different element, use find tool.'
      );
    }

    if (this.stats.stateUnchangedCount >= 3) {
      warnings.push(
        `[STATE UNCHANGED x${this.stats.stateUnchangedCount}]\nPage not changing. Clicks may miss targets.`
      );
    }

    return warnings.join('\n\n');
  }

  resetPatterns() {
    this.actionPatterns.clear();
    this.stats.stateUnchangedCount = 0;
  }
}

/**
 * Visual State Tracker - Compares before/after screenshots for change detection.
 */
export class VisualStateTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.previousDomHash = null;
    this.previousUrl = null;
    this.comparisonHistory = [];
  }

  captureBeforeState(domHash, url) {
    this.previousDomHash = domHash;
    this.previousUrl = url;
  }

  compareWithCurrent(currentDomHash, currentUrl) {
    const result = {
      domChanged: this.previousDomHash !== currentDomHash,
      urlChanged: this.previousUrl !== currentUrl,
      likelyNoChange: false
    };

    if (!result.domChanged && !result.urlChanged) {
      result.likelyNoChange = true;
    }

    this.comparisonHistory.push({
      timestamp: Date.now(),
      domChanged: result.domChanged,
      urlChanged: result.urlChanged
    });

    if (this.comparisonHistory.length > 10) {
      this.comparisonHistory.shift();
    }

    return result;
  }

  getNoChangeStreak() {
    let streak = 0;
    for (let i = this.comparisonHistory.length - 1; i >= 0; i--) {
      if (!this.comparisonHistory[i].domChanged && !this.comparisonHistory[i].urlChanged) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }
}

export default StateManager;
