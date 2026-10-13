// Content script for real-browser bots. browser.js prepends page-watch.js, so
// botBubbleWatch is in scope. Bytes travel as base64 (messages are JSON).
botBubbleWatch((type, payload) => {
  if (payload && payload.data) {
    let bin = '';
    for (let i = 0; i < payload.data.length; i += 0x8000) bin += String.fromCharCode.apply(null, payload.data.subarray(i, i + 0x8000));
    payload = { kind: payload.kind, mime: payload.mime, meta: payload.meta, b64: btoa(bin) };
  }
  chrome.runtime.sendMessage({ type, payload }).catch(() => {});
});
