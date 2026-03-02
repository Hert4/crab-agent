/**
 * Update Plan Tool - Agent explicitly updates its execution plan.
 * Stored in execution state and displayed in UI.
 */

export const updatePlanTool = {
  name: 'update_plan',
  description: 'Update the execution plan for the current task. Use this to record your strategy, track progress, and communicate your approach. The plan is shown in the UI so the user can see your progress.',
  parameters: {
    plan: {
      type: 'string',
      description: 'The current plan text. Use markdown with checkboxes for steps: "- [x] Done step\\n- [ ] Next step".'
    },
    status: {
      type: 'string',
      enum: ['planning', 'executing', 'blocked', 'almost_done'],
      description: 'Current phase of execution. Default "executing".'
    },
    progress: {
      type: 'number',
      description: 'Estimated progress percentage (0-100). Optional.'
    }
  },

  async execute(params, context) {
    if (!params.plan) return { success: false, error: 'plan parameter required.' };

    const plan = {
      text: params.plan,
      status: params.status || 'executing',
      progress: typeof params.progress === 'number' ? Math.max(0, Math.min(100, params.progress)) : null,
      updatedAt: Date.now()
    };

    // Store in execution context if available
    if (context.exec) {
      context.exec.currentPlan = plan;
    }

    // Notify sidepanel via message
    try {
      await chrome.runtime.sendMessage({
        type: 'plan_updated',
        plan
      });
    } catch (e) {
      // Sidepanel might not be open - that's fine
    }

    return {
      success: true,
      plan,
      message: `Plan updated (${plan.status}${plan.progress != null ? `, ${plan.progress}%` : ''})`
    };
  }
};

export default updatePlanTool;
