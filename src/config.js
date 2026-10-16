// User config (~/.config/bot-bubble/config.json, edited from the Settings window)
// and runtime state (~/.local/share/bot-bubble/state.json).
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = os.homedir();
const configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'bot-bubble');
const dataDir = path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'bot-bubble');
const configPath = path.join(configDir, 'config.json');
const statePath = path.join(dataDir, 'state.json');

// type "web": the bot's own web app in a persistent, logged-in view.
// type "app": the vendor's desktop app, parked over the bubble.
// type "cli": an agent CLI on the user's subscription login, rendered in our own chat UI.
const DEFAULT_CONFIG = {
  active: 'dots',
  providers: [
    { id: 'dots', label: 'Dots', type: 'web', url: 'https://chatgpt.com/dots' },
    { id: 'muse', label: 'Muse', type: 'web', url: 'https://muse.ai' },
    { id: 'grokbot', label: 'Grok Bot', type: 'web', url: 'https://grok.com/bot', loadWidth: 768 },
    { id: 'claude', label: 'Claude Code', type: 'cli', agent: 'claude' },
  ],
  // keepLoaded: web bots load at startup and stay loaded so a reply can light the badge.
  settings: { keepLoaded: true, showTabs: true, defaultBot: 'last' },
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

// Fill gaps so the rest of the app can trust the shape.
function normalize(cfg) {
  const seen = new Set();
  cfg.providers = (Array.isArray(cfg.providers) ? cfg.providers : []).filter((p) => {
    // ids end up in file paths and compositor rules, so keep them plain.
    const ok = p && typeof p.id === 'string' && /^[\w-]+$/.test(p.id) && !seen.has(p.id) && ['web', 'app', 'cli'].includes(p.type);
    if (ok) seen.add(p.id);
    return ok;
  });
  if (cfg.providers.length === 0) cfg.providers = structuredClone(DEFAULT_CONFIG.providers);
  if (!cfg.providers.some((p) => p.enabled !== false)) cfg.providers[0].enabled = true;
  cfg.settings = { ...DEFAULT_CONFIG.settings, ...cfg.settings };
  if (!cfg.providers.some((p) => p.id === cfg.active && p.enabled !== false)) {
    cfg.active = cfg.providers.find((p) => p.enabled !== false).id;
  }
  return cfg;
}

function loadConfig() {
  if (!fs.existsSync(configPath)) writeJson(configPath, DEFAULT_CONFIG);
  return normalize(readJson(configPath, structuredClone(DEFAULT_CONFIG)));
}

function saveConfig(cfg) {
  const clean = normalize(structuredClone(cfg));
  writeJson(configPath, clean);
  return clean;
}

module.exports = {
  dataDir,
  configPath,
  loadConfig,
  saveConfig,
  loadState: () => readJson(statePath, {}),
  saveState: (s) => writeJson(statePath, s),
};
