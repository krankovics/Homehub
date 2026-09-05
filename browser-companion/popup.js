const status = document.getElementById('status');
const open = document.getElementById('open');

function refresh() {
  chrome.runtime.sendMessage({ type: 'HOMEHUB_NCORE_PING' }, (response) => {
    if (chrome.runtime.lastError) {
      status.className = 'status warn';
      status.textContent = 'A Companion háttérfolyamat nem elérhető.';
      return;
    }
    if (response?.ready) {
      status.className = 'status ok';
      status.textContent = `nCore fül kész · Companion ${response.version || ''}`;
    } else {
      status.className = 'status warn';
      status.textContent = 'Nincs megnyitott nCore fül. Nyisd meg és jelentkezz be.';
    }
  });
}

open.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://ncore.pro/torrents.php' });
  setTimeout(refresh, 1200);
});

refresh();
