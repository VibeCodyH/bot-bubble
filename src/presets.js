// Bots offered in Settings → Add a bot. Anything here can also be added by hand.
module.exports = [
  { group: 'Bots', label: 'Dots', type: 'web', url: 'https://chatgpt.com/dots', note: 'OpenAI · ChatGPT Pro or Business Premium' },
  { group: 'Bots', label: 'Muse', type: 'web', url: 'https://muse.ai', note: 'Meta' },
  { group: 'Bots', label: 'Grok Bot', type: 'app', command: ['grok-bot'], avatar: ['/opt/Grok Bot/resources/icon.png'], note: 'xAI · opens the desktop app' },
  { group: 'Chat', label: 'ChatGPT', type: 'web', url: 'https://chatgpt.com', note: 'OpenAI' },
  { group: 'Chat', label: 'Claude', type: 'web', url: 'https://claude.ai', note: 'Anthropic' },
  { group: 'Chat', label: 'Grok', type: 'web', url: 'https://grok.com', note: 'xAI' },
  { group: 'Chat', label: 'Gemini', type: 'web', url: 'https://gemini.google.com', note: 'Google' },
  { group: 'Chat', label: 'Meta AI', type: 'web', url: 'https://www.meta.ai', note: 'Meta' },
  { group: 'Chat', label: 'Perplexity', type: 'web', url: 'https://www.perplexity.ai', note: 'Perplexity' },
  { group: 'Agent CLIs', label: 'Claude Code', type: 'cli', agent: 'claude', note: 'runs `claude` on your Claude login' },
  { group: 'Agent CLIs', label: 'Codex', type: 'cli', agent: 'codex', note: 'runs `codex` on your ChatGPT login' },
  { group: 'Agent CLIs', label: 'Grok Build', type: 'cli', agent: 'grok', note: 'runs `grok` on your Grok login' },
  { group: 'Agent CLIs', label: 'Muse Code', type: 'cli', agent: 'muse', note: 'runs `muse` on your Meta login' },
  { group: 'Custom', label: 'Custom web bot', type: 'web', url: 'https://', custom: true, note: 'any site, signed in as you' },
  { group: 'Custom', label: 'Custom app', type: 'app', command: [], custom: true, note: 'any desktop app command' },
];
