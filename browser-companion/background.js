const VERSION = '0.1.0';

function sendToNcore(command) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: 'https://ncore.pro/*' }, (tabs) => {
      const tab = tabs.find((t) => Number.isInteger(t.id));
      if (!tab?.id) return resolve({ ok: false, error: 'ncore_browser_tab_missing' });
      chrome.tabs.sendMessage(tab.id, { type: 'HOMEHUB_NCORE_EXECUTE', command }, (response) => {
        if (chrome.runtime.lastError) {
          return resolve({ ok: false, error: 'ncore_browser_tab_not_ready' });
        }
        resolve(response || { ok: false, error: 'ncore_browser_no_response' });
      });
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'HOMEHUB_NCORE_PING') {
    chrome.tabs.query({ url: 'https://ncore.pro/*' }, (tabs) => {
      sendResponse({ ok: true, ready: tabs.some((t) => Number.isInteger(t.id)), version: VERSION });
    });
    return true;
  }

  if (message?.type === 'HOMEHUB_NCORE_COMMAND') {
    sendToNcore(message.command).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }
});
