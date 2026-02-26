// HackExt Extension - Popup Script

const toggle = document.getElementById('enableToggle');
const statusText = document.getElementById('statusText');

// Load current state
chrome.storage.local.get('enabled', (result) => {
  const isEnabled = result.enabled !== false;
  toggle.checked = isEnabled;
  updateStatus(isEnabled);
});

// Handle toggle
toggle.addEventListener('change', () => {
  const isEnabled = toggle.checked;
  chrome.storage.local.set({ enabled: isEnabled });
  updateStatus(isEnabled);
});

function updateStatus(enabled) {
  statusText.textContent = enabled
    ? 'Highlight any text to get reply suggestions'
    : 'Extension is paused — toggle on to activate';
}

// Open side panel
document.getElementById('openSidePanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  }
});
