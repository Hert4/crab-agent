/**
 * Crab Personality - Vietnamese crab-themed response formatting.
 * Extracted from background.js CrabPersonality object.
 */

export const CrabPersonality = {
  moods: {
    greeting: ['🦀 Ê!', '🦀 Yoo!', '🦀 Hehe, chào nha!', '🦀 Hi hi!'],
    success: ['✅ Xong rồi nè!', '✅ Được luôn!', '✅ Ez game!', '✅ Okela!', '🦀 Done nha!', '🦀 Xử xong rồi!'],
    thinking: ['🤔 Để cua xem...', '💭 Hmm...', '🦀 Coi coi...', '🦀 Wait tí...'],
    failed: ['😅 Lỗi rồi, thử lại nha', '🦀 Oops, không được', '😬 Fail rồi...', '🦀 Hông được, thử cách khác nha'],
    confused: ['❓ Cua chưa hiểu lắm...', '🦀 Giải thích thêm được không?', '🤔 Ý bạn là sao nhỉ?', '❓ Cần thêm info nha'],
    asking: ['🦀 Cua hỏi tí nha:', '❓ Cho cua hỏi:', '🤔 Này này:'],
    suggesting: ['💡 Cua gợi ý nè:', '🦀 Hay là:', '💭 Cua nghĩ:'],
    working: ['🦀 Đang làm...', '⚡ On it!', '🦀 Chờ tí nha...']
  },

  pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  },

  detectStyle(message) {
    if (!message) return 'friendly';
    const lower = message.toLowerCase();
    if (/\b(ê|ơi|nha|nè|đi|luôn|hen|ha|á|ạ|nhé)\b/.test(lower)) return 'casual';
    if (/\b(please|could you|would you|kindly|xin|vui lòng)\b/.test(lower)) return 'formal';
    if (message.length < 30 && /^(click|go|open|search|type|send)/i.test(lower)) return 'brief';
    return 'friendly';
  },

  format(text, mood = 'success', userStyle = 'friendly') {
    const prefix = this.pick(this.moods[mood] || this.moods.success);
    let simplified = text;
    if (userStyle !== 'formal') {
      simplified = simplified
        .replace(/element\s*\d+/gi, 'cái đó')
        .replace(/clicked?\s*(on\s*)?/gi, 'bấm ')
        .replace(/navigat(ed|ing)\s*(to)?/gi, 'chuyển đến ')
        .replace(/successfully/gi, '')
        .replace(/\[effect:[^\]]+\]/gi, '')
        .replace(/\[trusted\]/gi, '')
        .replace(/at\s*\(\d+,\s*\d+\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (userStyle === 'brief' && simplified.length > 50) {
      simplified = simplified.substring(0, 47) + '...';
    }
    return `${prefix} ${simplified}`.trim();
  },

  formatQuestion(question, options = []) {
    const prefix = this.pick(this.moods.asking);
    let formatted = `${prefix}\n${question}`;
    if (options && options.length > 0) {
      formatted += '\n\n' + options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
    }
    return formatted;
  },

  formatSuggestion(rule, reason = '') {
    const prefix = this.pick(this.moods.suggesting);
    let formatted = `${prefix}\n"${rule}"`;
    if (reason) formatted += `\n\n(${reason})`;
    formatted += '\n\n👆 Thêm rule này vào Context Rules không?';
    return formatted;
  }
};

// Session state
let sessionUserStyle = 'friendly';

export function updateUserStyle(message) {
  sessionUserStyle = CrabPersonality.detectStyle(message);
}

export function formatCrabResponse(text, mood = 'success') {
  return CrabPersonality.format(text, mood, sessionUserStyle);
}

export function getSessionStyle() {
  return sessionUserStyle;
}

export default CrabPersonality;
