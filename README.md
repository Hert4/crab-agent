# Agent-S - AI Browser Agent

A powerful AI-powered browser automation extension built with vanilla JavaScript. No build step required! Just plug in and use it !!!

## Features

- **AI-Powered Navigation**: Automatically navigate and interact with web pages using natural language commands
- **Multiple LLM Providers**: Support for OpenAI, Anthropic (Claude), Google (Gemini), OpenRouter, and Ollama
- **Visual Understanding**: Optional screenshot analysis for better context (Vision mode)
- **Chat History**: Full conversation history with searchable task list
- **Context Rules**: Domain-specific instructions that automatically apply when visiting matching sites
- **Planner + Navigator**: Dual-agent architecture for intelligent task planning and execution

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the `agent-s` folder
5. Click the Agent-S icon in your toolbar to open the side panel

## Setup

1. Click the settings icon (gear) in the chat header
2. Select your LLM provider (OpenAI, Anthropic, etc.)

> The demo that I have made only test on OpenAI Compatible. Recommend using the MLLM. Pure text might not a *good* idea.

3. Enter your API key
4. Choose your preferred model
5. Adjust other settings as needed

## Usage

### Basic Commands

Just type what you want the agent to do:

- "Search for the latest news about AI"
- "Fill out this form with my information"
- "Find and click the login button"
- "Scroll down and find the pricing section"
- "Extract all product names from this page"

### Context Rules

Add domain-specific instructions that automatically apply:

1. Go to "Context Rules" tab
2. Click "Add New Rule"
3. Enter a domain pattern (e.g., `*.amazon.com`)
4. Add your custom instructions

Example rule:
```
Domain: *.amazon.com
Context: When searching for products, always sort by customer reviews.
Look for products with at least 4 stars and 100+ reviews.
```

## Architecture

- **Navigator Agent**: Executes browser interactions (clicks, typing, scrolling)
- **Planner Agent**: Evaluates progress and determines next steps
- **DOM Tree Builder**: Creates a structured representation of interactive elements
- **Action System**: Handles all browser automation actions

## Files Structure

```
agent-s/
├── manifest.json       # Extension manifest
├── background.js       # Service worker (main agent logic)
├── sidepanel.html      # Side panel UI
├── sidepanel.js        # UI logic
├── content.js          # Content script
├── lib/
│   ├── agent.js        # Core agent system
│   ├── prompts.js      # System prompts
│   └── buildDomTree.js # DOM tree builder
├── styles/
│   └── main.css        # Styling
└── icons/              # Extension icons
```

## Tips

1. **Be specific**: Clear instructions get better results
2. **Use vision mode**: Enable for complex visual pages
3. **Check progress**: Watch the execution bar for real-time status
4. **Add context rules**: Customize behavior for frequently used sites
5. **Review history**: Learn from past tasks to improve future commands

## Troubleshooting

- **"Please set your API key"**: Go to settings and add your API key
- **Actions failing**: Try enabling Vision mode for better element detection
- **Slow execution**: Reduce max steps or use a faster model
- **Element not found**: The page may have changed; try refreshing

## Privacy

- API keys are stored locally in Chrome storage
- No data is sent to any server except your chosen LLM provider
- All processing happens locally in your browser

## License

MIT License

