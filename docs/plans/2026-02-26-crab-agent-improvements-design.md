# Crab-Agent Improvements Design

**Date:** 2026-02-26
**Status:** Approved
**Author:** Claude + User

## Overview

This design addresses 4 key issues with Crab-Agent:
1. Slow response speed
2. Unnatural, characterless responses
3. Poor state comparison (stuck in loops, doesn't learn)
4. Poor information sufficiency detection (doesn't ask when confused)

**Approach:** Incremental optimization - optimize each part separately for easy testing and rollback.

---

## 1. Speed Optimization

### 1.1 Generic Caching Strategy

Since user uses Claude via OpenAI-compatible API, use provider-agnostic caching:

```javascript
// Cache system prompt hash for provider-side deduplication
const systemPromptHash = hashString(systemPrompt);

// Compress conversation history - keep 3 recent messages, summarize older
const compressedMessages = compressHistory(messages, {
  keepRecent: 3,
  summarizeOlder: true
});
```

### 1.2 Parallel Processing

Capture screenshot and build DOM in parallel:

```javascript
// Current: sequential
const dom = await buildDomTree();
const screenshot = await captureScreenshot();

// Proposed: parallel
const [dom, screenshot] = await Promise.all([
  buildDomTree(),
  captureScreenshot()
]);
```

### 1.3 Streaming Response

Display partial response immediately to reduce perceived latency:

```javascript
const stream = await fetch(endpoint, { ...options, stream: true });
for await (const chunk of stream) {
  emitPartialResponse(chunk);
}
```

### 1.4 DOM Tree Pruning

- Limit to top 100 interactive elements
- Truncate long text content (>50 chars)
- Skip invisible elements more aggressively

---

## 2. Friendly Crab Persona

### 2.1 Personality Constants

```javascript
const CRAB_PERSONALITY = {
  greetings: ["🦀 Ê!", "🦀 Yoo!", "🦀 Hehe"],
  success: ["✅ Xong rồi nè!", "✅ Được luôn!", "✅ Ez game!"],
  thinking: ["🤔 Để cua xem...", "💭 Hmm...", "🦀 Coi coi..."],
  failed: ["😅 Lỗi rồi, thử lại nha", "🦀 Oops, không được"],
  confused: ["❓ Cua chưa hiểu lắm...", "🦀 Giải thích thêm được không?"]
};
```

### 2.2 Response Formatter

Wrap `done.text` through personality layer:

```javascript
function formatCrabResponse(text, mood = 'neutral') {
  const prefix = pickRandom(CRAB_PERSONALITY[mood] || CRAB_PERSONALITY.neutral);
  const simplified = simplifyTechnicalTerms(text);
  return `${prefix} ${simplified}`;
}
```

### 2.3 Adaptive Style (No Hardcoding)

Analyze user's message style and adapt:

```javascript
function detectUserStyle(userMessage) {
  if (isInformal(userMessage)) return 'casual';     // "ê click cái kia"
  if (isFormal(userMessage)) return 'professional'; // "Please click button X"
  return 'friendly'; // default crab style
}
```

---

## 3. Visual Diff State Comparison

### 3.1 Before/After Screenshot Tracking

```javascript
class VisualStateTracker {
  constructor() {
    this.previousScreenshot = null;
    this.previousDomHash = null;
  }

  async captureAndCompare(tabId) {
    const current = await captureScreenshot(tabId);

    if (this.previousScreenshot) {
      return {
        before: this.previousScreenshot,
        after: current,
        domChanged: this.previousDomHash !== currentDomHash
      };
    }

    this.previousScreenshot = current;
    return { after: current };
  }
}
```

### 3.2 Diff Prompt Injection

Add instruction for LLM to compare before/after:

```javascript
if (visualState.before) {
  message += `
[VISUAL VERIFICATION REQUIRED]
- Image 1: BEFORE action
- Image 2: AFTER action
- Compare carefully: Did the action produce visible change?
- If images look identical → action FAILED, try different approach
- If UI changed as expected → action SUCCESS, proceed
`;
}
```

### 3.3 Automatic "No Change" Detection

```javascript
async function detectNoChange(before, after) {
  const similarity = await compareImages(before, after);

  if (similarity > 0.95) {
    return {
      noChange: true,
      warning: "Screenshots nearly identical. Action may have failed."
    };
  }
  return { noChange: false };
}
```

**Trade-off:** Sending 2 images = ~2x vision tokens, but much higher accuracy.

---

## 4. Information Sufficiency + Ask Mechanism

### 4.1 Confidence Scoring

Model self-assesses certainty:

```javascript
// Add to response format
{
  "thought": {...},
  "confidence": 0.8,  // 0-1, how sure about this action
  "uncertainty_reason": "Multiple similar buttons visible",
  "action": [...]
}
```

### 4.2 Uncertainty Actions (No Hardcoding)

Two new actions:

```javascript
// Action 1: Ask user
{ "ask_user": {
    "question": "Có 2 nút 'Save' - muốn click cái nào?",
    "options": ["Save Draft", "Save & Publish"]
}}

// Action 2: Suggest context rule
{ "suggest_rule": {
    "rule": "Khi gặp popup confirm, luôn chọn 'Accept'",
    "reason": "Noticed this pattern multiple times"
}}
```

### 4.3 Self-Explore First Policy

Enforce in prompt:

```
[UNCERTAINTY HANDLING]
When unsure how to proceed:
1. FIRST: Try exploring - scroll, hover, look for hints in UI
2. IF still stuck after 2 attempts: ask_user with clear question
3. IF you notice a repeating pattern: suggest_rule for future reference

NEVER refuse to try. NEVER hardcode assumptions.
Always ask with context-aware questions.
```

### 4.4 Dynamic Rule Suggestions

Agent suggests rules based on patterns:

```javascript
function detectPatternForRule(actionHistory) {
  const popupActions = actionHistory.filter(a => a.context.includes('popup'));
  const cancelCount = popupActions.filter(a => a.text.includes('Cancel')).length;

  if (cancelCount > 3) {
    return {
      suggestedRule: "For popup confirmations, choose 'Cancel'",
      confidence: 0.9
    };
  }
  return null;
}
```

---

## Implementation Priority

1. **High Priority (Do First)**
   - Parallel screenshot + DOM capture (quick win)
   - Personality formatter for `done.text`
   - Visual diff prompt injection

2. **Medium Priority**
   - Confidence scoring in response format
   - `ask_user` action
   - Streaming response

3. **Lower Priority**
   - `suggest_rule` action
   - Dynamic rule detection
   - History compression

---

## Files to Modify

| File | Changes |
|------|---------|
| `background.js` | Speed optimizations, visual diff, new actions |
| `content.js` | Parallel DOM/screenshot capture |
| `sidepanel.js` | Handle `ask_user` action, display personality responses |

---

## Success Criteria

1. **Speed:** Reduce average step time by 30%+
2. **Character:** User feedback that responses feel more natural
3. **State:** Reduce "stuck in loop" incidents by 50%+
4. **Info:** Agent asks clarifying questions instead of guessing wrongly
