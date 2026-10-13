// Service worker for real-browser bots. browser.js prepends `const BRIDGE = {...}`
// (port, token, bot id). Forwards page reports to Bot Bubble on loopback.
chrome.runtime.onMessage.addListener((msg) => {
  fetch(`http://127.0.0.1:${BRIDGE.port}/${msg.type}/${encodeURIComponent(BRIDGE.bot)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bot-bubble': BRIDGE.token },
    body: JSON.stringify(msg.payload || {}),
  }).catch(() => {});
});
