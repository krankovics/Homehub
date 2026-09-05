const CHANNEL = 'homehub-ncore-companion-v1';

function reply(id, payload) {
  window.postMessage({ channel: CHANNEL, type: 'response', id, payload }, window.location.origin);
}

function announce() {
  chrome.runtime.sendMessage({ type: 'HOMEHUB_NCORE_PING' }, (response) => {
    window.postMessage({
      channel: CHANNEL,
      type: 'ready',
      ready: Boolean(response?.ready),
      version: response?.version || '',
      error: response?.error || ''
    }, window.location.origin);
  });
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const msg = event.data;
  if (!msg || msg.channel !== CHANNEL) return;

  if (msg.type === 'ping') {
    announce();
    return;
  }

  if (msg.type !== 'request' || !msg.id || !msg.command) return;
  chrome.runtime.sendMessage({ type: 'HOMEHUB_NCORE_COMMAND', command: msg.command }, (response) => {
    if (chrome.runtime.lastError) {
      reply(msg.id, { ok: false, error: 'ncore_browser_extension_error' });
      return;
    }
    reply(msg.id, response || { ok: false, error: 'ncore_browser_no_response' });
  });
});

announce();
