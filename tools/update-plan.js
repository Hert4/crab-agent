/**
 * Update Plan Tool - Present plan to user for approval.
 * Aligned with Claude spec:
 *   - domains: array of domains to visit (auto-authorized on approval)
 *   - approach: array of 3-7 high-level action descriptions
 *   - Integrates with permission-manager for domain pre-authorization
 *   - Also keeps legacy plan text + status + progress for backward compat
 */

import { permissionManager } from '../core/permission-manager.js';

export const updatePlanTool = {
  name: 'update_plan',
  description: 'Present a plan to the user for approval before taking actions. List the domains you will visit and your high-level approach. Once approved, listed domains are pre-authorized for navigation.',
  parameters: {
    domains: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of domains to visit (approved when user accepts the plan).'
    },
    approach: {
      type: 'array',
      items: { type: 'string' },
      description: 'High-level description of actions. 3-7 items.'
    },
    // Legacy params (backward compat)
    plan: {
      type: 'string',
      description: 'Legacy: plan text with markdown checkboxes.'
    },
    status: {
      type: 'string',
      enum: ['planning', 'executing', 'blocked', 'almost_done'],
      description: 'Current phase of execution. Default "planning".'
    },
    progress: {
      type: 'number',
      description: 'Estimated progress percentage (0-100). Optional.'
    }
  },

  async execute(params, context) {
    // Require at least domains+approach (Claude format) or plan (legacy format)
    if (!params.domains && !params.approach && !params.plan) {
      return { success: false, error: 'Either (domains + approach) or plan parameter required.' };
    }

    const plan = {
      domains: params.domains || [],
      approach: params.approach || [],
      // Legacy fields
      text: params.plan || (params.approach ? params.approach.map((s, i) => `${i + 1}. ${s}`).join('\n') : ''),
      status: params.status || 'planning',
      progress: typeof params.progress === 'number' ? Math.max(0, Math.min(100, params.progress)) : null,
      updatedAt: Date.now(),
      approved: false
    };

    // Store in execution context
    if (context.exec) {
      context.exec.currentPlan = plan;
    }

    // If in "follow_a_plan" permission mode, send plan for approval
    // The sidepanel will show the plan and let user approve/reject
    try {
      await chrome.runtime.sendMessage({
        type: 'plan_updated',
        plan,
        requiresApproval: permissionManager.mode === 'follow_a_plan'
      });
    } catch (e) {
      // Sidepanel might not be open
    }

    // If in skip_all mode, auto-authorize domains immediately
    if (permissionManager.mode === 'skip_all_permission_checks') {
      for (const domain of plan.domains) {
        permissionManager.grantPermission(domain, 'NAVIGATE', 'always');
        permissionManager.grantPermission(domain, 'READ_PAGE_CONTENT', 'always');
        permissionManager.grantPermission(domain, 'CLICK', 'always');
        permissionManager.grantPermission(domain, 'TYPE', 'always');
      }
      plan.approved = true;
    }

    // Build readable summary
    const domainList = plan.domains.length > 0
      ? `\nDomains: ${plan.domains.join(', ')}`
      : '';
    const approachList = plan.approach.length > 0
      ? `\nApproach:\n${plan.approach.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`
      : '';

    return {
      success: true,
      plan,
      message: `Plan submitted for approval.${domainList}${approachList}`,
      requiresApproval: permissionManager.mode === 'follow_a_plan'
    };
  }
};

/**
 * Called when user approves the plan — pre-authorize all listed domains.
 * Should be called from background.js when receiving plan_approved message.
 */
export function approvePlan(plan) {
  if (!plan || !plan.domains) return;

  for (const domain of plan.domains) {
    permissionManager.grantPermission(domain, 'NAVIGATE', 'always');
    permissionManager.grantPermission(domain, 'READ_PAGE_CONTENT', 'always');
    permissionManager.grantPermission(domain, 'CLICK', 'always');
    permissionManager.grantPermission(domain, 'TYPE', 'always');
  }

  plan.approved = true;
  console.log(`[UpdatePlan] Plan approved. Pre-authorized ${plan.domains.length} domains:`, plan.domains);
}

export default updatePlanTool;
