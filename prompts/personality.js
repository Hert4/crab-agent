/**
 * Crab Personality - Lightweight UI formatting helpers.
 *
 * Personality/tone is now handled by the LLM via system prompt instructions.
 * This module only provides minimal formatting for UI elements (questions, suggestions)
 * that are rendered directly by the sidepanel, not by the LLM.
 */

export const CrabPersonality = {
  /**
   * Format a question for the UI (ask_user flow).
   * Just structures the question + options — no personality injection.
   */
  formatQuestion(question, options = []) {
    let formatted = `❓ ${question}`;
    if (options && options.length > 0) {
      formatted += '\n\n' + options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
    }
    return formatted;
  },

  /**
   * Format a context rule suggestion for the UI.
   */
  formatSuggestion(rule, reason = '') {
    let formatted = `💡 "${rule}"`;
    if (reason) formatted += `\n\n(${reason})`;
    formatted += '\n\n👆 Add this to Context Rules?';
    return formatted;
  }
};

/**
 * Pass-through: personality is now in the system prompt, so we just return text as-is.
 * Kept for backward compatibility with agent-loop.js call sites.
 */
export function formatCrabResponse(text, _mood = 'success') {
  return text;
}

export function updateUserStyle(_message) {
  // No-op: LLM adapts to user style via system prompt instructions.
}

export function getSessionStyle() {
  return 'friendly';
}

export default CrabPersonality;
