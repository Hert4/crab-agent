/**
 * Permission Manager - Claude-style permission system.
 * Controls what actions the agent can take on which domains.
 *
 * Permission Modes:
 * - "ask" (default): Prompt user before each action on a new domain
 * - "follow_a_plan": Claude submits plan via update_plan; approved domains pre-authorized
 * - "skip_all_permission_checks": Auto-approve everything
 *
 * Permission Types:
 * - NAVIGATE: navigate tool
 * - READ_PAGE_CONTENT: read_page, computer(screenshot/scroll/scroll_to/zoom)
 * - CLICK: computer(left_click/right_click/double_click/triple_click/hover/drag)
 * - TYPE: computer(type/key)
 * - UPLOAD_IMAGE: upload_image
 * - PLAN_APPROVAL: update_plan
 * - DOMAIN_TRANSITION: navigating from one domain to another
 *
 * Permission Durations:
 * - "once": Single use, tied to a specific toolUseId. Auto-revoked after use.
 * - "always": Persistent for that domain until manually revoked.
 */

// ========== Constants ==========

export const PERMISSION_TYPES = {
  NAVIGATE: 'NAVIGATE',
  READ_PAGE_CONTENT: 'READ_PAGE_CONTENT',
  CLICK: 'CLICK',
  TYPE: 'TYPE',
  UPLOAD_IMAGE: 'UPLOAD_IMAGE',
  PLAN_APPROVAL: 'PLAN_APPROVAL',
  DOMAIN_TRANSITION: 'DOMAIN_TRANSITION'
};

export const PERMISSION_MODES = {
  ASK: 'ask',
  FOLLOW_A_PLAN: 'follow_a_plan',
  SKIP_ALL: 'skip_all_permission_checks'
};

export const PERMISSION_DURATIONS = {
  ONCE: 'once',
  ALWAYS: 'always'
};

// Map computer actions → permission types
const ACTION_PERMISSION_MAP = {
  screenshot: PERMISSION_TYPES.READ_PAGE_CONTENT,
  scroll: PERMISSION_TYPES.READ_PAGE_CONTENT,
  scroll_to: PERMISSION_TYPES.READ_PAGE_CONTENT,
  zoom: PERMISSION_TYPES.READ_PAGE_CONTENT,
  left_click: PERMISSION_TYPES.CLICK,
  right_click: PERMISSION_TYPES.CLICK,
  double_click: PERMISSION_TYPES.CLICK,
  triple_click: PERMISSION_TYPES.CLICK,
  hover: PERMISSION_TYPES.CLICK,
  left_click_drag: PERMISSION_TYPES.CLICK,
  type: PERMISSION_TYPES.TYPE,
  key: PERMISSION_TYPES.TYPE
};

// ========== Domain Safety ==========

const DOMAIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Known dangerous domain patterns
const BLOCKED_DOMAIN_PATTERNS = [
  /^.*\.onion$/,
  /^.*malware.*/i,
  /^.*phishing.*/i
];

// Domains that always require prompt (no "always allow" option)
const FORCE_PROMPT_DOMAINS = new Set([
  'accounts.google.com',
  'login.microsoftonline.com',
  'signin.aws.amazon.com',
  'github.com/login',
  'bank', 'banking'
]);

// ========== Permission Manager Class ==========

class PermissionManager {
  constructor() {
    /** @type {string} Current permission mode */
    this.mode = PERMISSION_MODES.ASK;

    /** @type {Map<string, Map<string, { duration: string, grantedAt: number, toolUseId?: string }>>} */
    // domain → permType → grant info
    this.grants = new Map();

    /** @type {Set<string>} Domains pre-authorized by plan approval */
    this.planApprovedDomains = new Set();

    /** @type {Map<string, { category: string, checkedAt: number }>} Domain safety cache */
    this.domainSafetyCache = new Map();

    /** @type {Set<string>} User-configured blocked domains */
    this.blockedDomains = new Set();

    /** @type {Set<string>} User-configured allowed domains */
    this.allowedDomains = new Set();

    /** @type {Function|null} Callback to ask user for permission */
    this._askUserCallback = null;

    /** @type {string|null} Last known domain for transition detection */
    this._lastDomain = null;
  }

  // ========== Configuration ==========

  /**
   * Set the permission mode.
   */
  setMode(mode) {
    if (Object.values(PERMISSION_MODES).includes(mode)) {
      this.mode = mode;
    }
  }

  /**
   * Set the callback for asking user permission.
   * Callback signature: (domain, permType, toolUseId) => Promise<{ granted: boolean, duration: string }>
   */
  setAskUserCallback(callback) {
    this._askUserCallback = callback;
  }

  /**
   * Load allowed/blocked domains from settings.
   */
  async loadDomainRules() {
    try {
      const { allowedDomains = '', blockedDomains = '' } = await chrome.storage.local.get([
        'allowedDomains', 'blockedDomains'
      ]);
      this.allowedDomains = new Set(
        String(allowedDomains).split('\n').map(d => d.trim().toLowerCase()).filter(Boolean)
      );
      this.blockedDomains = new Set(
        String(blockedDomains).split('\n').map(d => d.trim().toLowerCase()).filter(Boolean)
      );
    } catch (e) {
      console.warn('[PermissionManager] Failed to load domain rules:', e.message);
    }
  }

  /**
   * Reset all grants (e.g. new session).
   */
  reset() {
    this.grants.clear();
    this.planApprovedDomains.clear();
    this._lastDomain = null;
  }

  // ========== Domain Safety ==========

  /**
   * Classify a domain's safety category.
   * @returns {'category0'|'category1'|'category2'|'category3'|'category_org_blocked'}
   */
  classifyDomain(domain) {
    if (!domain) return 'category0';
    const lower = domain.toLowerCase();

    // Check cached result
    const cached = this.domainSafetyCache.get(lower);
    if (cached && (Date.now() - cached.checkedAt) < DOMAIN_CACHE_TTL_MS) {
      return cached.category;
    }

    let category = 'category0';

    // User-blocked domains
    if (this.blockedDomains.has(lower)) {
      category = 'category_org_blocked';
    }
    // Pattern-matched blocked domains
    else if (BLOCKED_DOMAIN_PATTERNS.some(p => p.test(lower))) {
      category = 'category1';
    }
    // Force-prompt domains (sensitive login pages, banking, etc.)
    else if (_isSensitiveDomain(lower)) {
      category = 'category3';
    }

    // Cache result
    this.domainSafetyCache.set(lower, { category, checkedAt: Date.now() });
    return category;
  }

  /**
   * Check if navigation to a domain is allowed.
   * @returns {{ allowed: boolean, reason?: string, category: string }}
   */
  checkDomainAccess(domain) {
    const category = this.classifyDomain(domain);

    switch (category) {
      case 'category1':
      case 'category2':
        return { allowed: false, reason: `Domain "${domain}" is blocked (${category}).`, category };
      case 'category_org_blocked':
        return { allowed: false, reason: `Domain "${domain}" is blocked by your configuration.`, category };
      case 'category3':
        // Allowed but always force-prompt
        return { allowed: true, forcePrompt: true, category };
      default:
        return { allowed: true, category };
    }
  }

  // ========== Permission Checking ==========

  /**
   * Check if a tool action is permitted.
   * @param {string} domain - Current page domain
   * @param {string} permType - Permission type (from PERMISSION_TYPES)
   * @param {string} [toolUseId] - Optional tool use ID for "once" grants
   * @returns {Promise<{ granted: boolean, reason?: string }>}
   */
  async checkPermission(domain, permType, toolUseId = null) {
    // Skip all checks mode
    if (this.mode === PERMISSION_MODES.SKIP_ALL) {
      return { granted: true };
    }

    // Domain safety check
    const domainAccess = this.checkDomainAccess(domain);
    if (!domainAccess.allowed) {
      return { granted: false, reason: domainAccess.reason };
    }

    // Plan mode: check if domain is pre-approved
    if (this.mode === PERMISSION_MODES.FOLLOW_A_PLAN) {
      if (this.planApprovedDomains.has(domain?.toLowerCase())) {
        return { granted: true };
      }
      // Domain not in plan — need explicit approval
    }

    // Check existing grants
    const existing = this._getGrant(domain, permType);
    if (existing) {
      if (existing.duration === PERMISSION_DURATIONS.ALWAYS) {
        return { granted: true };
      }
      if (existing.duration === PERMISSION_DURATIONS.ONCE) {
        if (existing.toolUseId === toolUseId || !toolUseId) {
          // Consume the one-time grant
          this._revokeGrant(domain, permType);
          return { granted: true };
        }
      }
    }

    // Force-prompt domains: never allow "always" option
    const isForcePrompt = domainAccess.forcePrompt || false;

    // Ask user (if callback is set)
    if (this._askUserCallback) {
      try {
        const response = await this._askUserCallback(domain, permType, toolUseId, isForcePrompt);
        if (response?.granted) {
          const duration = isForcePrompt ? PERMISSION_DURATIONS.ONCE : (response.duration || PERMISSION_DURATIONS.ONCE);
          this._setGrant(domain, permType, duration, toolUseId);
          return { granted: true };
        }
        return { granted: false, reason: 'Permission denied by user.' };
      } catch (e) {
        console.warn('[PermissionManager] Ask user callback failed:', e.message);
        return { granted: false, reason: 'Permission check failed.' };
      }
    }

    // No callback set — in default "ask" mode, deny if no existing grant
    if (this.mode === PERMISSION_MODES.ASK) {
      // Auto-grant READ_PAGE_CONTENT for user's active tab (initial tab)
      if (permType === PERMISSION_TYPES.READ_PAGE_CONTENT) {
        return { granted: true };
      }
      // If no ask callback, auto-grant (backwards compat for headless usage)
      return { granted: true };
    }

    return { granted: false, reason: 'No permission grant found.' };
  }

  /**
   * Get the permission type for a computer tool action.
   */
  getComputerActionPermType(action) {
    return ACTION_PERMISSION_MAP[action] || PERMISSION_TYPES.CLICK;
  }

  /**
   * Get the permission type for a tool by name.
   */
  getToolPermType(toolName, params = {}) {
    switch (toolName) {
      case 'navigate':
        return PERMISSION_TYPES.NAVIGATE;
      case 'read_page':
      case 'get_page_text':
        return PERMISSION_TYPES.READ_PAGE_CONTENT;
      case 'computer':
        return this.getComputerActionPermType(params.action);
      case 'form_input':
        return PERMISSION_TYPES.TYPE;
      case 'upload_image':
      case 'file_upload':
        return PERMISSION_TYPES.UPLOAD_IMAGE;
      case 'update_plan':
        return PERMISSION_TYPES.PLAN_APPROVAL;
      case 'javascript_tool':
        // JS execution is equivalent to TYPE (mutating)
        return PERMISSION_TYPES.TYPE;
      default:
        // Read-only tools like tabs_context, read_console, etc.
        return PERMISSION_TYPES.READ_PAGE_CONTENT;
    }
  }

  // ========== Plan Approval ==========

  /**
   * Approve a plan's domains for the session.
   */
  approvePlan(domains) {
    if (!Array.isArray(domains)) return;
    for (const domain of domains) {
      this.planApprovedDomains.add(String(domain).toLowerCase());
    }
  }

  // ========== Domain Transition ==========

  /**
   * Check for domain transition and track it.
   * @returns {{ transitioned: boolean, from?: string, to?: string }}
   */
  checkDomainTransition(currentDomain) {
    const current = currentDomain?.toLowerCase();
    const last = this._lastDomain;

    if (!last || last === current) {
      this._lastDomain = current;
      return { transitioned: false };
    }

    this._lastDomain = current;
    return { transitioned: true, from: last, to: current };
  }

  // ========== URL Verification ==========

  /**
   * Verify that the current tab URL domain matches the expected domain.
   * Call before mutating actions to prevent cross-domain attacks.
   * @param {number} tabId
   * @param {string} expectedDomain - Domain when the action was planned
   * @returns {Promise<{ verified: boolean, currentDomain?: string, reason?: string }>}
   */
  async verifyUrlDomain(tabId, expectedDomain) {
    if (!expectedDomain) return { verified: true };

    try {
      const tab = await chrome.tabs.get(tabId);
      const currentDomain = _extractDomain(tab.url);

      if (!currentDomain) {
        return { verified: true }; // Can't determine domain, allow
      }

      if (currentDomain.toLowerCase() !== expectedDomain.toLowerCase()) {
        return {
          verified: false,
          currentDomain,
          reason: `Domain changed from "${expectedDomain}" to "${currentDomain}" during action. Aborting for safety.`
        };
      }

      return { verified: true, currentDomain };
    } catch (e) {
      return { verified: true }; // Tab may have closed, allow
    }
  }

  // ========== Internal Grant Management ==========

  _getGrant(domain, permType) {
    const domainKey = (domain || '').toLowerCase();
    const domainGrants = this.grants.get(domainKey);
    if (!domainGrants) return null;
    return domainGrants.get(permType) || null;
  }

  _setGrant(domain, permType, duration, toolUseId = null) {
    const domainKey = (domain || '').toLowerCase();
    if (!this.grants.has(domainKey)) {
      this.grants.set(domainKey, new Map());
    }
    this.grants.get(domainKey).set(permType, {
      duration,
      grantedAt: Date.now(),
      ...(toolUseId ? { toolUseId } : {})
    });
  }

  _revokeGrant(domain, permType) {
    const domainKey = (domain || '').toLowerCase();
    const domainGrants = this.grants.get(domainKey);
    if (domainGrants) {
      domainGrants.delete(permType);
    }
  }

  /**
   * Grant a specific permission for a domain.
   * Public API used by update-plan and navigate tools.
   */
  grantPermission(domain, permType, duration = PERMISSION_DURATIONS.ALWAYS) {
    this._setGrant(domain, permType, duration);
  }

  /**
   * Grant all permission types for a domain (used after plan approval).
   */
  grantAllForDomain(domain, duration = PERMISSION_DURATIONS.ALWAYS) {
    for (const permType of Object.values(PERMISSION_TYPES)) {
      this._setGrant(domain, permType, duration);
    }
  }

  /**
   * Revoke all grants for a domain.
   */
  revokeAllForDomain(domain) {
    this.grants.delete((domain || '').toLowerCase());
  }
}

// ========== Helpers ==========

function _extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function _isSensitiveDomain(domain) {
  const sensitivePatterns = [
    'accounts.google.com',
    'login.microsoftonline.com',
    'signin.aws.amazon.com',
    'id.apple.com',
    'login.yahoo.com',
    'auth0.com',
    'okta.com'
  ];

  const sensitiveKeywords = ['bank', 'banking', 'payment', 'checkout', 'pay.'];

  if (sensitivePatterns.some(p => domain.includes(p))) return true;
  if (sensitiveKeywords.some(k => domain.includes(k))) return true;
  return false;
}

// ========== Singleton ==========

export const permissionManager = new PermissionManager();
export default PermissionManager;
