// Pitho.ai - Popup Script

const toggle = document.getElementById('enableToggle');
const statusText = document.getElementById('statusText');
const backendDesc = document.getElementById('backendDesc');

const BACKEND_DESCRIPTIONS = {
  thinking: 'deeprip — Deep analysis + dual KB (~8s)',
  fast: 'quickrip — Quick reply pipeline (~4s)'
};

// Load current state
chrome.storage.local.get(['enabled', 'backend'], (result) => {
  const isEnabled = result.enabled !== false;
  toggle.checked = isEnabled;
  updateStatus(isEnabled);

  const backend = result.backend || 'thinking';
  document.querySelectorAll('.backend-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.backend === backend);
  });
  backendDesc.textContent = BACKEND_DESCRIPTIONS[backend];
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

// Backend toggle
document.querySelectorAll('.backend-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const backend = btn.dataset.backend;
    chrome.storage.local.set({ backend });
    document.querySelectorAll('.backend-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    backendDesc.textContent = BACKEND_DESCRIPTIONS[backend];
  });
});

// Open side panel
document.getElementById('openSidePanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  }
});

// Open CRM dashboard
document.getElementById('openCRM').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('crm/crm.html') });
  window.close();
});
