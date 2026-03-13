// Pitho.ai Side Panel

const content = document.getElementById('content');
const statusDot = document.getElementById('statusDot');
const controlsBar = document.getElementById('controlsBar');
const modeSelect = document.getElementById('modeSelect');
const engineBar = document.getElementById('engineBar');
const spSubtitle = document.getElementById('spSubtitle');
const chatContainer = document.getElementById('chatContainer');
const chatMessagesEl = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatContextEl = document.getElementById('chatContext');
const scoreContainer = document.getElementById('scoreContainer');
const scoreContextEl = document.getElementById('scoreContext');
const scoreBody = document.getElementById('scoreBody');

// Agent & HUD elements (declared early — referenced by setGenerating/showReply)
const agentLogoBtn = document.getElementById('agentLogoBtn');
const agentBar = document.getElementById('agentBar');
const spHeader = document.querySelector('.sp-header');
const agentStatusText = document.getElementById('agentStatusText');
const hudPlatformVal = document.getElementById('hudPlatformVal');
const hudProspectVal = document.getElementById('hudProspectVal');
const hudMsgsVal = document.getElementById('hudMsgsVal');
const hudRipsVal = document.getElementById('hudRipsVal');
const hudRipsChip = document.getElementById('hudRips');
let sessionRipCount = 0;

// Reply mode state
let currentMode = 'auto';
let currentText = '';
let currentMessages = [];
let currentFullPage = null;
let currentPlatform = 'other';
let closerContactId = null;
let isGenerating = false;
let activePort = null;

// Performance metrics state
let metricsEnabled = false;
let metricsRequestStart = 0;
let metricsFirstToken = 0;
let metricsEndTime = 0;
let metricsTokenCount = 0;

const stopBtn = document.getElementById('stopBtn');
const headerAnalyzeBtn = document.getElementById('headerAnalyzeBtn');
const btnMetrics = document.getElementById('btnMetrics');

// Load metrics setting
chrome.storage.local.get('metricsEnabled', (r) => {
  metricsEnabled = !!r.metricsEnabled;
  if (metricsEnabled) btnMetrics.classList.add('sp-action-metrics-on');
});

btnMetrics.addEventListener('click', () => {
  metricsEnabled = !metricsEnabled;
  chrome.storage.local.set({ metricsEnabled: metricsEnabled });
  btnMetrics.classList.toggle('sp-action-metrics-on', metricsEnabled);
});

// Alt+I hotkey — cycles through messages: 1st press = Message 1, 2nd = Message 2, etc.
let insertCycleIdx = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_INSERT_TEXT') {
    const allMsgs = content.querySelectorAll('.sp-message-text[data-idx]');
    if (allMsgs.length === 0) {
      sendResponse({ text: '' });
      return true;
    }

    // Wrap around if we've gone past the last message
    if (insertCycleIdx >= allMsgs.length) insertCycleIdx = 0;

    const targetMsg = allMsgs[insertCycleIdx];
    const text = targetMsg ? targetMsg.innerText.trim() : '';
    sendResponse({ text: text });

    // Flash the corresponding insert button
    if (text) {
      const btn = content.querySelector('.sp-insert-btn[data-idx="' + insertCycleIdx + '"]');
      if (btn) {
        const insertIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
        const kbdHtml = ' <kbd>Alt+I</kbd>';
        btn.textContent = 'Inserted!';
        btn.style.color = '#22c55e';
        setTimeout(() => { btn.innerHTML = insertIcon + ' Insert' + kbdHtml; btn.style.color = ''; }, 1500);
      }
    }

    // Advance to next message for the next press
    insertCycleIdx++;
    return true;
  }
});

function setGenerating(val) {
  isGenerating = val;
  stopBtn.style.display = val ? '' : 'none';
  headerAnalyzeBtn.style.display = val ? 'none' : '';
  if (hudRipsChip) hudRipsChip.classList.toggle('sp-hud-live', val);
}

// Stop button
stopBtn.addEventListener('click', () => {
  if (activePort) {
    try { activePort.disconnect(); } catch (e) {}
    activePort = null;
  }
  setGenerating(false);
  statusDot.className = 'sp-status';
  statusDot.innerHTML = '<span class="sp-dot"></span> Ready';
});

// Header analyze button
headerAnalyzeBtn.addEventListener('click', () => {
  if (!isGenerating) autoAnalyze();
});

// Open CRM dashboard
document.getElementById('openCRMBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('crm/crm.html') });
});

// Check auth and show sign-in prompt if needed
(async () => {
  const result = await chrome.storage.local.get('pitho_session');
  const session = result.pitho_session;
  if (!session || !session.access_token || session.expires_at < Date.now()) {
    // Show a small sign-in indicator
    const crmBtn = document.getElementById('openCRMBtn');
    if (crmBtn) {
      crmBtn.title = 'Sign in to use CRM';
      crmBtn.addEventListener('click', (e) => {
        // If not signed in, open auth page instead
        chrome.storage.local.get('pitho_session', (r) => {
          if (!r.pitho_session || !r.pitho_session.access_token) {
            e.stopPropagation();
            chrome.tabs.create({ url: chrome.runtime.getURL('auth/auth.html') });
          }
        });
      }, true); // Use capture to run before the CRM handler
    }
  }
})();

// Chat mode state
let chatMode = false;
let chatSessionId = null;
let chatMessages = [];
let chatSending = false;

// Score mode state
let scoreMode = false;

function esc(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

// ===== Mode Switching =====

function switchToReplyMode() {
  chatMode = false;
  scoreMode = false;
  content.style.display = '';
  chatContainer.style.display = 'none';
  scoreContainer.style.display = 'none';
  controlsBar.style.display = '';
  spSubtitle.textContent = '';
}

function switchToChatMode() {
  chatMode = true;
  scoreMode = false;
  content.style.display = 'none';
  chatContainer.style.display = 'flex';
  scoreContainer.style.display = 'none';
  controlsBar.style.display = 'none';
  spSubtitle.textContent = 'Coaching Chat';
  chatMessages = [];
  chatMessagesEl.innerHTML = '';
  chatInput.value = '';
  chatInput.focus();
}

function switchToScoreMode() {
  chatMode = false;
  scoreMode = true;
  content.style.display = 'none';
  chatContainer.style.display = 'none';
  scoreContainer.style.display = 'flex';
  controlsBar.style.display = 'none';
  spSubtitle.textContent = 'Conversation Analysis';
  scoreBody.innerHTML = '';
}

// ===== Reply Mode (existing) =====

// Mode dropdown
modeSelect.addEventListener('change', () => {
  currentMode = modeSelect.value;
  if (currentText) {
    doRequest(currentText, currentMode);
  }
});

// Backend engine buttons — sync to storage
chrome.storage.local.get('backend', (result) => {
  const backend = result.backend || 'thinking';
  engineBar.querySelectorAll('.sp-engine-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.backend === backend);
  });
});
engineBar.querySelectorAll('.sp-engine-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    engineBar.querySelectorAll('.sp-engine-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chrome.storage.local.set({ backend: btn.dataset.backend });
  });
});

// Back buttons
document.getElementById('scoreBackBtn').addEventListener('click', () => {
  switchToReplyMode();
});
document.getElementById('coachBackBtn').addEventListener('click', () => {
  switchToReplyMode();
});

// Score button
document.getElementById('btnScore').addEventListener('click', () => {
  if (!currentText && !currentFullPage) {
    // Need to scrape first
    chrome.runtime.sendMessage({ type: 'SCRAPE_PAGE' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.success) return;
      const scraped = resp.data;
      if (!scraped || !scraped.conversation || scraped.conversation.trim().length < 10) return;
      currentText = scraped.conversation;
      currentFullPage = scraped;
      currentPlatform = resp.platform || 'other';
      triggerScore();
    });
  } else {
    triggerScore();
  }
});

function triggerScore() {
  const ctx = {
    scrapedData: currentFullPage || { conversation: currentText },
    platform: currentPlatform,
    selectedText: '',
    sessionId: 'score-' + Date.now()
  };
  switchToScoreMode();
  showScoreContext(ctx);
  showScoreLoader();
  runScoring(ctx);
}

// Coach button
document.getElementById('btnCoach').addEventListener('click', () => {
  if (!currentText && !currentFullPage) {
    chrome.runtime.sendMessage({ type: 'SCRAPE_PAGE' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.success) return;
      const scraped = resp.data;
      if (!scraped || !scraped.conversation || scraped.conversation.trim().length < 10) return;
      currentText = scraped.conversation;
      currentFullPage = scraped;
      currentPlatform = resp.platform || 'other';
      triggerCoach();
    });
  } else {
    triggerCoach();
  }
});

function triggerCoach() {
  const ctx = {
    scrapedData: currentFullPage || { conversation: currentText },
    platform: currentPlatform,
    selectedText: '',
    sessionId: 'coach-' + Date.now()
  };
  chatSessionId = ctx.sessionId;
  switchToChatMode();
  showChatContext(ctx);
  const firstMessage = buildInitialCoachMessage(ctx);
  sendCoachMessage(firstMessage, true);
}

// Listen for data from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SIDE_PANEL_REQUEST') {
    switchToReplyMode();
    currentText = message.text;
    currentMode = message.replyMode || 'auto';
    modeSelect.value = currentMode;
    doRequest(currentText, currentMode);
  }

  if (message.type === 'SIDE_PANEL_RESULT') {
    showReply(message.data);
  }
});

// Tell background we're ready, then auto-analyze
chrome.runtime.sendMessage({ type: 'SIDE_PANEL_READY' });

// Auto-analyze: scrape the active tab and generate a reply
function autoAnalyze() {
  setGenerating(true);
  showLoading('Scanning page...');
  chrome.runtime.sendMessage({ type: 'SCRAPE_PAGE' }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.success) {
      setGenerating(false);
      showEmpty();
      return;
    }
    const scraped = resp.data;
    if (!scraped || !scraped.conversation || scraped.conversation.trim().length < 10) {
      setGenerating(false);
      showEmpty('No conversation detected on this page.');
      return;
    }
    currentText = scraped.conversation;
    currentFullPage = scraped;
    currentPlatform = resp.platform || 'other';
    updateHud();

    // Auto-check Closer Bot whitelist on Revio pages
    if (currentPlatform === 'revio' && scraped.contactId) {
      closerContactId = scraped.contactId;
      chrome.runtime.sendMessage({ type: 'CLOSER_CHECK', contactId: closerContactId }, (r) => {
        if (chrome.runtime.lastError) return;
        if (r && r.success) {
          setAgentActive(r.whitelisted);
        }
      });
    }

    doRequest(currentText, currentMode);
  });
}

function showEmpty(msg) {
  statusDot.className = 'sp-status';
  statusDot.innerHTML = '<span class="sp-dot"></span> Ready';
  content.innerHTML = `<div class="sp-empty">
    <div class="sp-empty-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </div>
    <div class="sp-empty-title">${msg || 'No conversation found'}</div>
    <div class="sp-empty-desc">Navigate to a sales conversation (LinkedIn, Gmail, etc.) and click the <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> button to analyze.</div>
  </div>`;
}

// Trigger auto-analyze on load
autoAnalyze();

function doRequest(text, replyMode) {
  // Disconnect any existing port
  if (activePort) {
    try { activePort.disconnect(); } catch (e) {}
  }

  setGenerating(true);
  showLoading(text);

  // Metrics timing
  metricsRequestStart = performance.now();
  metricsFirstToken = 0;
  metricsEndTime = 0;
  metricsTokenCount = 0;

  // Use streaming port connection
  const port = chrome.runtime.connect({ name: 'stream-reply' });
  activePort = port;
  let streamingStarted = false;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'STREAM_START') {
      streamingStarted = true;
      if (!metricsFirstToken) metricsFirstToken = performance.now();
      showStreamingView(msg.backend);
    }

    if (msg.type === 'STREAM_CHUNK') {
      if (!metricsFirstToken) metricsFirstToken = performance.now();
      metricsTokenCount++;
      updateStreamingText(msg.accumulated);
    }

    if (msg.type === 'STREAM_END') {
      metricsEndTime = performance.now();
      setGenerating(false);
      activePort = null;
      showReply(msg.data);
      port.disconnect();
    }

    if (msg.type === 'COMPLETE') {
      metricsEndTime = performance.now();
      setGenerating(false);
      activePort = null;
      if (msg.data.success) {
        showReply(msg.data);
      } else {
        showError(msg.data.error || 'Unknown error');
      }
      port.disconnect();
    }

    if (msg.type === 'ERROR') {
      metricsEndTime = performance.now();
      setGenerating(false);
      activePort = null;
      showError(msg.error);
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    if (isGenerating) {
      setGenerating(false);
      activePort = null;
    }
  });

  port.postMessage({
    type: 'START_STREAM',
    text: text,
    platform: currentPlatform || 'other',
    replyMode: replyMode || 'auto',
    fullPage: currentFullPage || null
  });
}

function showLoading(text) {
  statusDot.className = 'sp-status loading';
  statusDot.innerHTML = '<span class="sp-dot"></span> Generating...';

  let html = '';
  html += `<div class="sp-loading">
    <div class="sp-loader-banner">
      <img src="../loading.gif" alt="">
      <span>Analyzing your conversation...</span>
    </div>
    <div class="sp-loader-steps">
      <div class="sp-loader-step active" id="step-scan">
        <div class="sp-loader-step-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </div>
        <span>Scanning conversation...</span>
      </div>
      <div class="sp-loader-step" id="step-analyze">
        <div class="sp-loader-step-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        </div>
        <span>Crafting reply options...</span>
      </div>
    </div>
  </div>`;
  content.innerHTML = html;

  // Animate steps
  setTimeout(() => {
    const stepScan = document.getElementById('step-scan');
    const stepAnalyze = document.getElementById('step-analyze');
    if (stepScan) { stepScan.classList.remove('active'); stepScan.classList.add('done'); }
    if (stepAnalyze) stepAnalyze.classList.add('active');
  }, 1500);
}

let streamIsJson = false;
let streamDomReady = false;
let streamMsgCount = 0;
let streamActiveField = null;
let streamBackend = 'thinking';
let streamCardCount = 0;

function showStreamingView(backend) {
  statusDot.className = 'sp-status loading';
  statusDot.innerHTML = '<span class="sp-dot"></span> Streaming...';
  streamIsJson = false;
  streamDomReady = false;
  streamMsgCount = 0;
  streamActiveField = null;
  lastStreamText = '';
  streamBackend = backend;
  streamCardCount = 0;

  const badgeMap = {
    thinking: { cls: 'sp-backend-thinking', label: 'deeprip' },
    fast: { cls: 'sp-backend-fast', label: 'quickrip' }
  };
  const badge = badgeMap[backend] || badgeMap.thinking;

  content.innerHTML =
    '<div class="sp-backend-badge ' + badge.cls + '">' + badge.label + '</div>' +
    '<div class="sp-stream-output" id="streamOutput">' +
      '<div id="streamContent"></div><span class="sp-stream-cursor" id="streamCursor"></span>' +
    '</div>';
}

// --- Partial JSON extraction helpers ---

function jsonUnescape(s) {
  return s.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function jsonExtractString(json, key) {
  var keyStr = '"' + key + '"';
  var idx = json.indexOf(keyStr);
  if (idx === -1) return null;
  var colonIdx = json.indexOf(':', idx + keyStr.length);
  if (colonIdx === -1) return null;
  var quoteIdx = json.indexOf('"', colonIdx + 1);
  if (quoteIdx === -1) return null;
  var end = quoteIdx + 1;
  while (end < json.length) {
    if (json[end] === '\\') { end += 2; continue; }
    if (json[end] === '"') return { value: jsonUnescape(json.substring(quoteIdx + 1, end)), done: true };
    end++;
  }
  return { value: jsonUnescape(json.substring(quoteIdx + 1, end)), done: false };
}

function jsonExtractMessages(json) {
  var idx = json.indexOf('"messages"');
  if (idx === -1) return { complete: [], partial: null };
  var arrStart = json.indexOf('[', idx);
  if (arrStart === -1) return { complete: [], partial: null };
  var complete = [];
  var partial = null;
  var i = arrStart + 1;
  while (i < json.length) {
    while (i < json.length && ' ,\n\r\t'.indexOf(json[i]) !== -1) i++;
    if (i >= json.length || json[i] === ']') break;
    if (json[i] !== '"') { i++; continue; }
    var end = i + 1;
    while (end < json.length) {
      if (json[end] === '\\') { end += 2; continue; }
      if (json[end] === '"') break;
      end++;
    }
    var value = jsonUnescape(json.substring(i + 1, end));
    if (end < json.length && json[end] === '"') {
      complete.push(value);
      i = end + 1;
    } else {
      partial = value;
      break;
    }
  }
  return { complete: complete, partial: partial };
}

// --- Build DOM structure once, then only update textContent ---

function buildStreamDom() {
  var el = document.getElementById('streamOutput');
  if (!el) return;
  // Replace entire streamOutput contents for JSON streaming mode
  el.innerHTML =
    '<div class="sp-analysis" id="s-analysis" style="display:none">' +
      '<div class="sp-analysis-row" id="s-stage-row" style="display:none"><span class="sp-analysis-label">Stage</span><span class="sp-analysis-value" id="s-stage-val"></span></div>' +
      '<div class="sp-analysis-row" id="s-energy-row" style="display:none"><span class="sp-analysis-label">Energy</span><span class="sp-analysis-value" id="s-energy-val"></span></div>' +
      '<div class="sp-analysis-row" id="s-read-row" style="display:none"><span class="sp-analysis-label">Read</span><span class="sp-analysis-value" id="s-read-val"></span></div>' +
    '</div>' +
    '<div class="sp-messages" id="s-messages" style="display:none"></div>' +
    '<div class="sp-reasoning" id="s-reasoning" style="display:none">' +
      '<div class="sp-reasoning-label">Why this works</div>' +
      '<div class="sp-reasoning-text" id="s-reasoning-val"></div>' +
    '</div>';
  streamDomReady = true;
  streamMsgCount = 0;
}

function setStreamCursor(fieldId) {
  // Move the "typing" class to the active field (CSS ::after draws the cursor)
  if (streamActiveField === fieldId) return;
  if (streamActiveField) {
    var prev = document.getElementById(streamActiveField);
    if (prev) prev.classList.remove('sp-typing-field');
  }
  streamActiveField = fieldId;
  if (fieldId) {
    var el = document.getElementById(fieldId);
    if (el) el.classList.add('sp-typing-field');
  }
}

function updateStreamDom(json) {
  // Analysis fields
  var stage = jsonExtractString(json, 'stage');
  var energy = jsonExtractString(json, 'energy');
  var realMeaning = jsonExtractString(json, 'realMeaning');

  if (stage || energy || realMeaning || json.indexOf('"analysis"') !== -1) {
    var a = document.getElementById('s-analysis');
    if (a) a.style.display = '';
  }

  if (stage) {
    var row = document.getElementById('s-stage-row');
    var val = document.getElementById('s-stage-val');
    if (row) row.style.display = '';
    if (val) val.textContent = stage.value;
    if (!stage.done) setStreamCursor('s-stage-val');
    else if (streamActiveField === 's-stage-val') setStreamCursor(null);
  }

  if (energy) {
    var row = document.getElementById('s-energy-row');
    var val = document.getElementById('s-energy-val');
    if (row) row.style.display = '';
    if (val) val.textContent = energy.value;
    if (!energy.done) setStreamCursor('s-energy-val');
    else if (streamActiveField === 's-energy-val') setStreamCursor(null);
  }

  if (realMeaning) {
    var row = document.getElementById('s-read-row');
    var val = document.getElementById('s-read-val');
    if (row) row.style.display = '';
    if (val) val.textContent = realMeaning.value;
    if (!realMeaning.done) setStreamCursor('s-read-val');
    else if (streamActiveField === 's-read-val') setStreamCursor(null);
  }

  // Messages — only append new blocks, update text on existing
  var msgs = jsonExtractMessages(json);
  var msgsEl = document.getElementById('s-messages');
  var totalNeeded = msgs.complete.length + (msgs.partial !== null ? 1 : 0);

  if (msgsEl && totalNeeded > 0) {
    msgsEl.style.display = '';

    // Add new message blocks if needed
    while (streamMsgCount < totalNeeded) {
      var block = document.createElement('div');
      block.className = 'sp-message-block';
      block.innerHTML = '<div class="sp-message-label">Message ' + (streamMsgCount + 1) + '</div><div class="sp-message-text" id="s-msg-' + streamMsgCount + '"></div>';
      msgsEl.appendChild(block);
      streamMsgCount++;
    }

    // Update complete messages
    for (var i = 0; i < msgs.complete.length; i++) {
      var el = document.getElementById('s-msg-' + i);
      if (el && el.textContent !== msgs.complete[i]) el.textContent = msgs.complete[i];
      if (streamActiveField === 's-msg-' + i) setStreamCursor(null);
    }

    // Update partial message
    if (msgs.partial !== null) {
      var pIdx = msgs.complete.length;
      var el = document.getElementById('s-msg-' + pIdx);
      if (el) el.textContent = msgs.partial;
      setStreamCursor('s-msg-' + pIdx);
    }
  }

  // Reasoning
  var reasoning = jsonExtractString(json, 'reasoning');
  if (reasoning) {
    var rEl = document.getElementById('s-reasoning');
    var rVal = document.getElementById('s-reasoning-val');
    if (rEl) rEl.style.display = '';
    if (rVal) rVal.textContent = reasoning.value;
    if (!reasoning.done) setStreamCursor('s-reasoning-val');
    else if (streamActiveField === 's-reasoning-val') setStreamCursor(null);
  }

  content.scrollTop = content.scrollHeight;
}

let lastStreamText = '';
let lastStreamRafId = null;

function updateStreamingText(text) {
  var el = document.getElementById('streamOutput');
  if (!el) return;

  var trimmed = text.trimStart();
  if (!streamIsJson && trimmed.startsWith('{')) {
    streamIsJson = true;
    // Replace streamOutput internals for JSON mode
    var contentDiv = document.getElementById('streamContent');
    var cursorEl = document.getElementById('streamCursor');
    if (cursorEl) cursorEl.remove();
    buildStreamDom();
  }

  if (streamIsJson) {
    if (!streamDomReady) buildStreamDom();
    updateStreamDom(trimmed);
    return;
  }

  // Non-JSON stream: update only the content div, leave cursor untouched
  if (text === lastStreamText) return; // Skip duplicate updates
  lastStreamText = text;

  var contentDiv = document.getElementById('streamContent');
  if (!contentDiv) return;

  var rendered;
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    rendered = DOMPurify.sanitize(marked.parse(text), { USE_PROFILES: { html: true } });
  } else {
    rendered = esc(text).replace(/\n/g, '<br>');
  }
  contentDiv.innerHTML = rendered;
  content.scrollTop = content.scrollHeight;
}

function showReply(response) {
  statusDot.className = 'sp-status';
  statusDot.innerHTML = '<span class="sp-dot"></span> Ready';

  // Track rips for HUD
  sessionRipCount++;
  if (hudRipsVal) {
    hudRipsVal.textContent = String(sessionRipCount);
    hudFlash(hudRipsVal);
  }
  if (hudRipsChip) hudRipsChip.classList.remove('sp-hud-live');
  updateHud();

  // Reset hotkey cycle so Alt+I starts from Message 1 again
  insertCycleIdx = 0;

  let messages, analysis = null, reasoning = null;
  const backend = response.backend || 'thinking';

  const badgeMap = {
    thinking: { cls: 'sp-backend-thinking', label: 'deeprip' },
    fast: { cls: 'sp-backend-fast', label: 'quickrip' }
  };
  const badge = badgeMap[backend] || badgeMap.thinking;

  if (response.structured && response.messages) {
    messages = response.messages;
    analysis = response.analysis;
    reasoning = response.reasoning;
  } else {
    const raw = response.raw || '';
    let parts = raw.split(/\*?\*?Message\s*\d+:?\*?\*?\s*/i).filter(s => s.trim());
    if (parts.length <= 1) parts = raw.split(/\n\s*\d+\.\s+/).filter(s => s.trim());
    if (parts.length <= 1) parts = raw.split(/\n\n+/).filter(s => s.trim());
    if (parts.length === 0) parts = [raw.trim()];
    messages = parts.map(s => s.trim());
  }

  currentMessages = messages;

  let html = '';

  // Backend badge + fallback indicator
  html += `<div class="sp-backend-badge ${badge.cls}">
    ${badge.label}${response.fallback ? ' (fallback)' : ''}
  </div>`;

  // Performance metrics (only when enabled)
  if (metricsEnabled && metricsRequestStart) {
    const ttft = metricsFirstToken ? ((metricsFirstToken - metricsRequestStart) / 1000).toFixed(2) : '—';
    const total = metricsEndTime ? ((metricsEndTime - metricsRequestStart) / 1000).toFixed(2) : '—';
    const chunks = metricsTokenCount;
    html += `<div class="sp-metrics-bar">
      <span class="sp-metric-item"><span class="sp-metric-label">TTFT</span> ${ttft}s</span>
      <span class="sp-metric-item"><span class="sp-metric-label">Total</span> ${total}s</span>
      <span class="sp-metric-item"><span class="sp-metric-label">Chunks</span> ${chunks}</span>
    </div>`;
  }

  // Analysis
  if (analysis) {
    html += `<div class="sp-analysis">
      <div class="sp-analysis-row"><span class="sp-analysis-label">Stage</span><span class="sp-analysis-value">${esc(analysis.stage || '')}</span></div>
      <div class="sp-analysis-row"><span class="sp-analysis-label">Energy</span><span class="sp-analysis-value">${esc(analysis.energy || '')}</span></div>
      <div class="sp-analysis-row"><span class="sp-analysis-label">Read</span><span class="sp-analysis-value">${esc(analysis.realMeaning || '')}</span></div>
    </div>`;
  }

  // Messages
  html += '<div class="sp-messages">';
  messages.forEach((msg, i) => {
    html += `<div class="sp-message-block">
      <div class="sp-message-label">Message ${i + 1}</div>
      <div class="sp-message-text" contenteditable="true" data-idx="${i}">${esc(msg)}</div>
      <div class="sp-message-actions">
        <button class="sp-copy-btn" data-idx="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>
        <button class="sp-insert-btn" data-idx="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg> Insert <kbd>Alt+I</kbd></button>
      </div>
    </div>`;
  });
  html += `<button class="sp-copy-all-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy All</button>`;

  // Regenerate button
  html += `<button class="sp-regenerate-btn" id="regenBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> Regenerate</button>`;

  html += '</div>';

  // Reasoning
  if (reasoning) {
    html += `<div class="sp-reasoning">
      <div class="sp-reasoning-label">Why this works</div>
      <div class="sp-reasoning-text">${esc(reasoning)}</div>
    </div>`;
  }

  content.innerHTML = html;

  // Helper: read current (possibly edited) text from a message block
  function getMessageText(idx) {
    const el = content.querySelector('.sp-message-text[data-idx="' + idx + '"]');
    return el ? el.innerText.trim() : messages[idx];
  }

  // Copy handlers
  const copyIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  content.querySelectorAll('.sp-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(getMessageText(parseInt(btn.dataset.idx))).then(() => {
        btn.textContent = 'Copied!';
        btn.style.color = '#22c55e';
        setTimeout(() => { btn.innerHTML = copyIcon + ' Copy'; btn.style.color = ''; }, 1500);
      });
    });
  });

  const cab = content.querySelector('.sp-copy-all-btn');
  if (cab) cab.addEventListener('click', () => {
    const allTexts = messages.map((_, i) => getMessageText(i));
    navigator.clipboard.writeText(allTexts.join('\n\n')).then(() => {
      cab.textContent = 'Copied all!';
      cab.style.color = '#22c55e';
      setTimeout(() => { cab.innerHTML = copyIcon + ' Copy All'; cab.style.color = ''; }, 1500);
    });
  });

  // Insert handlers
  const insertIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
  const kbdHtml = ' <kbd>Alt+I</kbd>';
  content.querySelectorAll('.sp-insert-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = getMessageText(parseInt(btn.dataset.idx));
      chrome.runtime.sendMessage({ type: 'INSERT_TEXT', text: text }, (resp) => {
        if (resp && resp.success) {
          btn.textContent = 'Inserted!';
          btn.style.color = '#22c55e';
          setTimeout(() => { btn.innerHTML = insertIcon + ' Insert' + kbdHtml; btn.style.color = ''; }, 1500);
        } else {
          btn.textContent = 'No input found';
          btn.style.color = '#f59e0b';
          setTimeout(() => { btn.innerHTML = insertIcon + ' Insert' + kbdHtml; btn.style.color = ''; }, 1500);
        }
      });
    });
  });

  // Regenerate handler
  const regenBtn = document.getElementById('regenBtn');
  if (regenBtn) {
    regenBtn.addEventListener('click', () => {
      if (!isGenerating && currentText) {
        autoAnalyze();
      }
    });
  }

}

function showError(msg) {
  statusDot.className = 'sp-status';
  statusDot.innerHTML = '<span class="sp-dot"></span> Ready';

  content.innerHTML = `<div class="sp-error">
    <div class="sp-error-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
    </div>
    <div class="sp-error-title">Something went wrong</div>
    <div class="sp-error-msg">${esc(msg)}</div>
    <button class="sp-retry-btn">Try Again</button>
  </div>`;

  content.querySelector('.sp-retry-btn').addEventListener('click', () => {
    if (currentText) doRequest(currentText, currentMode);
  });
}

// ===== Chat Mode =====

function checkPendingChatContext() {
  chrome.storage.session.get('pendingChatContext', (result) => {
    if (result.pendingChatContext) {
      const ctx = result.pendingChatContext;
      console.log('[SP] Found pending chat context, switching to chat mode');

      // Clear so we don't re-trigger
      chrome.storage.session.remove('pendingChatContext');

      // Switch to chat mode
      chatSessionId = ctx.sessionId;
      switchToChatMode();

      // Show context banner
      showChatContext(ctx);

      // Build and auto-send the first message
      const firstMessage = buildInitialCoachMessage(ctx);
      sendCoachMessage(firstMessage, true);
    }
  });
}

// Check on load
checkPendingChatContext();

// Also listen for storage changes (panel might already be open)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.pendingChatContext && changes.pendingChatContext.newValue) {
    checkPendingChatContext();
  }
});

function buildInitialCoachMessage(ctx) {
  const scraped = ctx.scrapedData;
  let msg = 'I need your help analyzing a sales conversation. Here\'s the context:\n\n';

  if (ctx.platform && ctx.platform !== 'other') {
    msg += 'Platform: ' + ctx.platform + '\n';
  }
  if (scraped.contactName) {
    msg += 'Contact: ' + scraped.contactName + '\n';
  }
  if (scraped.subject) {
    msg += 'Subject: ' + scraped.subject + '\n';
  }
  if (scraped.type) {
    msg += 'Type: ' + scraped.type + '\n';
  }

  msg += '\n---\n\nFull Conversation:\n' + scraped.conversation + '\n';

  if (ctx.selectedText && ctx.selectedText.length > 5) {
    msg += '\n---\n\nI highlighted this specific part:\n"' + ctx.selectedText + '"\n';
  }

  msg += '\n---\n\nAnalyze this conversation. What\'s the prospect\'s energy? What stage are we at? What should I do next and why?';

  return msg;
}

function showChatContext(ctx) {
  const scraped = ctx.scrapedData;
  const platformLabels = {
    linkedin: 'LinkedIn', gmail: 'Gmail', instagram: 'Instagram',
    facebook: 'Facebook', x: 'X', salesforce: 'Salesforce',
    hubspot: 'HubSpot', revio: 'Revio', other: 'Page'
  };
  const label = platformLabels[ctx.platform] || 'Page';
  const contact = scraped.contactName ? ' with ' + esc(scraped.contactName) : '';
  const count = scraped.messageCount ? ' (' + scraped.messageCount + ' messages)' : '';

  chatContextEl.innerHTML = `<div class="sp-chat-context-inner">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
    <span>Analyzing ${label} conversation${contact}${count}</span>
  </div>`;
}

async function sendCoachMessage(text, isAutoSend) {
  if (chatSending || !text.trim()) return;
  chatSending = true;

  // Add user message to UI (skip for auto-sent context)
  if (!isAutoSend) {
    chatMessages.push({ role: 'user', content: text });
    renderChatMessages();
  }

  // Show typing indicator
  showTypingIndicator();

  // Update status
  statusDot.className = 'sp-status loading';
  statusDot.innerHTML = '<span class="sp-dot"></span> Thinking...';

  // Use streaming port for coach
  const port = chrome.runtime.connect({ name: 'stream-coach' });
  let streamingStarted = false;
  let streamBubbleId = null;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'STREAM_START') {
      streamingStarted = true;
      removeTypingIndicator();
      statusDot.innerHTML = '<span class="sp-dot"></span> Streaming...';

      // Add a live bot bubble for streaming
      streamBubbleId = 'stream-bubble-' + Date.now();
      const bubbleDiv = document.createElement('div');
      bubbleDiv.id = streamBubbleId;
      bubbleDiv.className = 'sp-chat-msg sp-chat-msg-bot';
      bubbleDiv.innerHTML = `<div class="sp-chat-bubble-bot"><span class="sp-stream-cursor"></span></div>`;
      chatMessagesEl.appendChild(bubbleDiv);
      scrollChatToBottom();
    }

    if (msg.type === 'STREAM_CHUNK') {
      const bubble = document.getElementById(streamBubbleId);
      if (bubble) {
        const inner = bubble.querySelector('.sp-chat-bubble-bot');
        if (inner) {
          let rendered;
          if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true });
            rendered = DOMPurify.sanitize(marked.parse(msg.accumulated), { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] });
          } else {
            rendered = esc(msg.accumulated).replace(/\n/g, '<br>');
          }
          inner.innerHTML = rendered + '<span class="sp-stream-cursor"></span>';
          scrollChatToBottom();
        }
      }
    }

    if (msg.type === 'STREAM_END') {
      finishCoachResponse(msg.botResponse);
      port.disconnect();
    }

    if (msg.type === 'COMPLETE') {
      // Non-streaming fallback
      finishCoachResponse(msg.botResponse);
      port.disconnect();
    }

    if (msg.type === 'ERROR') {
      finishCoachResponse('Error: Unable to reach the coach. Please try again.');
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    if (chatSending) {
      finishCoachResponse('Error: Connection lost. Please try again.');
    }
  });

  function finishCoachResponse(botResponse) {
    // Remove the streaming bubble if it exists
    if (streamBubbleId) {
      const bubble = document.getElementById(streamBubbleId);
      if (bubble) bubble.remove();
    }

    removeTypingIndicator();
    chatMessages.push({ role: 'assistant', content: botResponse });
    renderChatMessages();
    scrollChatToBottom();

    statusDot.className = 'sp-status';
    statusDot.innerHTML = '<span class="sp-dot"></span> Ready';

    chatSending = false;
    chatInput.focus();
  }

  port.postMessage({
    type: 'COACH_SEND',
    chatInput: text,
    sessionId: chatSessionId
  });
}

function renderChatMessages() {
  let html = '';
  chatMessages.forEach((msg) => {
    if (msg.role === 'user') {
      html += `<div class="sp-chat-msg sp-chat-msg-user">
        <div class="sp-chat-bubble-user">${esc(msg.content)}</div>
      </div>`;
    } else {
      html += `<div class="sp-chat-msg sp-chat-msg-bot">
        <div class="sp-chat-bubble-bot">${formatBotMessage(msg.content)}</div>
      </div>`;
    }
  });
  chatMessagesEl.innerHTML = html;
  scrollChatToBottom();
}

function formatBotMessage(text) {
  // Use marked.js + DOMPurify (same as main Pitho.ai app)
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    const html = marked.parse(text);
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target'] });
  }
  // Fallback if libs fail to load
  return esc(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function showTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'sp-typing-indicator';
  indicator.className = 'sp-chat-msg sp-chat-msg-bot';
  indicator.innerHTML = `<div class="sp-chat-bubble-bot sp-typing">
    <div class="sp-typing-dot"></div>
    <div class="sp-typing-dot"></div>
    <div class="sp-typing-dot"></div>
  </div>`;
  chatMessagesEl.appendChild(indicator);
  scrollChatToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById('sp-typing-indicator');
  if (el) el.remove();
}

function scrollChatToBottom() {
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// Chat input handlers
chatSendBtn.addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (text) {
    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendCoachMessage(text);
  }
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text) {
      chatInput.value = '';
      chatInput.style.height = 'auto';
      sendCoachMessage(text);
    }
  }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

// ===== Score Mode =====

function checkPendingScoreContext() {
  chrome.storage.session.get('pendingScoreContext', (result) => {
    if (result.pendingScoreContext) {
      const ctx = result.pendingScoreContext;
      console.log('[SP] Found pending score context, switching to score mode');
      chrome.storage.session.remove('pendingScoreContext');

      switchToScoreMode();
      showScoreContext(ctx);
      showScoreLoader();
      runScoring(ctx);
    }
  });
}

checkPendingScoreContext();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.pendingScoreContext && changes.pendingScoreContext.newValue) {
    checkPendingScoreContext();
  }
});

function showScoreContext(ctx) {
  const scraped = ctx.scrapedData;
  const platformLabels = {
    linkedin: 'LinkedIn', gmail: 'Gmail', instagram: 'Instagram',
    facebook: 'Facebook', x: 'X', salesforce: 'Salesforce',
    hubspot: 'HubSpot', revio: 'Revio', other: 'Page'
  };
  const label = platformLabels[ctx.platform] || 'Page';
  const contact = scraped.contactName ? ' with ' + esc(scraped.contactName) : '';
  const count = scraped.messageCount ? ' (' + scraped.messageCount + ' messages)' : '';

  scoreContextEl.innerHTML = `<div class="sp-chat-context-inner">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
    </svg>
    <span>Scoring ${label} conversation${contact}${count}</span>
  </div>`;
}

function showScoreLoader() {
  statusDot.className = 'sp-status loading';
  statusDot.innerHTML = '<span class="sp-dot"></span> Scoring...';

  scoreBody.innerHTML = `
    <div class="sp-score-loader-banner">
      <img class="sp-score-loader-gif" src="../loading.gif" alt="">
      <span>Analyzing your conversation...</span>
    </div>`;
}

function buildTranscript(ctx) {
  const scraped = ctx.scrapedData;
  let transcript = '';

  // Preamble: tell the scoring agent what it's looking at
  transcript += 'SCORE THIS CONVERSATION. Below is a scraped sales conversation from ';
  const platformLabels = {
    linkedin: 'LinkedIn DMs', gmail: 'a Gmail email thread', instagram: 'Instagram DMs',
    facebook: 'Facebook Messenger', x: 'X/Twitter DMs', revio: 'Revio CRM', other: 'a messaging platform'
  };
  transcript += (platformLabels[ctx.platform] || 'a messaging platform') + '.\n';

  if (scraped.contactName) {
    transcript += 'The prospect is: ' + scraped.contactName + '\n';
  }
  if (scraped.subject) {
    transcript += 'Subject: ' + scraped.subject + '\n';
  }

  transcript += '\nThe conversation may not have explicit REP:/PROSPECT: labels. ';
  transcript += 'Figure out who is the sales rep and who is the prospect from context. ';
  transcript += 'The person selling/offering a service is the REP. The person asking questions or showing interest is the PROSPECT.\n';
  transcript += '\n--- CONVERSATION START ---\n\n';

  // Try to format the conversation with labels if we can detect sender patterns
  const conv = scraped.conversation || '';

  // Gmail format: "SenderName: message" separated by ---
  // LinkedIn format: "SenderName: message" separated by \n\n
  // Try to convert to REP:/PROSPECT: format if possible
  if (scraped.contactName && conv.includes(scraped.contactName)) {
    // We know the prospect name - label their messages as PROSPECT
    const lines = conv.split(/\n\n---\n\n|\n\n/);
    const labeled = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check if line starts with prospect name
      if (trimmed.toLowerCase().startsWith(scraped.contactName.toLowerCase())) {
        // Remove the name prefix and label as PROSPECT
        const msg = trimmed.replace(new RegExp('^' + scraped.contactName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*', 'i'), '');
        labeled.push('PROSPECT: ' + (msg || trimmed));
      } else {
        // Check if it starts with "Subject:" or other metadata
        if (trimmed.startsWith('Subject:')) {
          continue; // skip, already in header
        }
        // Try to detect if it starts with another name (rep)
        const nameMatch = trimmed.match(/^([^:]{2,30}):\s+(.+)/s);
        if (nameMatch) {
          labeled.push('REP: ' + nameMatch[2]);
        } else {
          labeled.push(trimmed);
        }
      }
    }
    transcript += labeled.join('\n');
  } else {
    // No contact name - fallback: send raw content with strong prompt instructions
    transcript += 'IMPORTANT: The messages below may not have clear sender labels. ';
    transcript += 'This is raw scraped content from ' + (platformLabels[ctx.platform] || 'a platform') + '. ';
    transcript += 'Do your best to identify who is the sales REP and who is the PROSPECT from context clues. ';
    transcript += 'If you truly cannot tell, assume alternating messages where the first message is from the PROSPECT.\n\n';
    transcript += conv;

    // Also include raw HTML if conversation text is thin
    if ((!conv || conv.length < 100) && scraped.rawHTML) {
      transcript += '\n\n--- RAW PAGE CONTENT (use this if conversation above is incomplete) ---\n';
      transcript += scraped.rawHTML.substring(0, 8000);
    }
  }

  transcript += '\n\n--- CONVERSATION END ---\n';

  // If user highlighted specific text
  if (ctx.selectedText && ctx.selectedText.length > 5) {
    transcript += '\nThe user highlighted this part specifically:\n"' + ctx.selectedText + '"\n';
  }

  transcript += '\nSCORE THE ABOVE CONVERSATION NOW. This is a special case — even if the format is imperfect, you MUST still score it. ';
  transcript += 'Do not refuse or return nulls. Analyze whatever content is available and provide your best scoring. ';
  transcript += 'Return valid JSON with playByPlay, score, maxScore, metrics, and takeaways.';

  return transcript;
}

async function runScoring(ctx) {
  const transcript = buildTranscript(ctx);

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'SCORE_CONVERSATION',
        transcript: transcript,
        sessionId: ctx.sessionId
      }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.success) {
          reject(new Error(resp?.error || 'No response'));
          return;
        }
        resolve(resp);
      });
    });

    statusDot.className = 'sp-status';
    statusDot.innerHTML = '<span class="sp-dot"></span> Ready';

    if (response.scoringResult) {
      renderScoringResult(response.scoringResult);
    } else {
      scoreBody.innerHTML = '<div class="sp-error"><div class="sp-error-title">No scoring data</div><div class="sp-error-msg">The agent did not return a structured score.</div></div>';
    }
  } catch (err) {
    console.error('[SP] Scoring error:', err);
    statusDot.className = 'sp-status';
    statusDot.innerHTML = '<span class="sp-dot"></span> Ready';
    scoreBody.innerHTML = `<div class="sp-error"><div class="sp-error-title">Scoring failed</div><div class="sp-error-msg">${esc(err.message)}</div></div>`;
  }
}

function getScoreColor(score, max) {
  const pct = score / max;
  if (pct >= 0.8) return '#22c55e';
  if (pct >= 0.6) return '#f59e0b';
  if (pct >= 0.4) return '#f97316';
  return '#ef4444';
}

function renderScoringResult(result) {
  const color = getScoreColor(result.score, 25);
  const arcLen = Math.PI * 86;
  const offset = arcLen - (result.score / 25) * arcLen;
  const needleAngle = -90 + (result.score / 25) * 180;

  let html = '';

  // Gauge
  html += `
    <div class="sp-gauge">
      <div class="sp-gauge-title">
        <span>Pitho.ai Performance Index</span>
        <span class="sp-gauge-title-score">${result.score}/25</span>
      </div>
      <div class="sp-gauge-wrap">
        <div class="sp-gauge-arc">
          <svg viewBox="0 0 200 200">
            <path class="sp-gauge-bg" d="M 14 100 A 86 86 0 0 1 186 100"/>
            <path class="sp-gauge-fill" d="M 14 100 A 86 86 0 0 1 186 100"
              style="stroke:${color};stroke-dasharray:${arcLen};stroke-dashoffset:${offset};filter:drop-shadow(0 0 6px ${color})"/>
          </svg>
          <div class="sp-gauge-needle" style="transform:translateX(-50%) rotate(${needleAngle}deg)"></div>
        </div>
        <div class="sp-gauge-value">${result.score}<span>/25</span></div>
      </div>
      <div class="sp-gauge-labels"><span>0</span><span>25</span></div>
    </div>`;

  // Feedback
  if (result.feedback) {
    html += `
      <div class="sp-score-feedback">
        <div class="sp-score-section-title">Coach's Take</div>
        <div class="sp-score-feedback-text">${esc(result.feedback)}</div>
      </div>`;
  }

  // Metrics
  if (result.metrics && result.metrics.length) {
    result.metrics.forEach(function(metric) {
      const isNull = metric.score === null;
      const s = metric.score || 0;
      const c = isNull ? 'rgba(255,255,255,0.1)' : getScoreColor(s, 5);
      html += `
        <div class="sp-metric ${isNull ? 'sp-metric-null' : ''}">
          <div class="sp-metric-header">
            <span class="sp-metric-name">${esc(metric.name)}</span>
            <span class="sp-metric-score" style="color:${c}">${isNull ? '---' : s + '/5'}</span>
          </div>
          <div class="sp-metric-bar">
            <div class="sp-metric-bar-fill" style="width:${(s / 5) * 100}%;background:${c}"></div>
          </div>
          <div class="sp-metric-desc">${esc(metric.description)}</div>
        </div>`;
    });
  }

  // Play by Play
  if (result.playByPlay && result.playByPlay.length) {
    html += '<div class="sp-pbp-section"><div class="sp-score-section-title">Play by Play</div>';
    result.playByPlay.forEach(function(item) {
      const shortText = (item.message || '').length > 50 ? item.message.substring(0, 50) + '...' : (item.message || '');
      const pbpColor = item.color || 'yellow';
      html += `
        <div class="sp-pbp sp-pbp-${pbpColor}">
          <div class="sp-pbp-dot"></div>
          <div class="sp-pbp-content">
            <div class="sp-pbp-msg">You: ${esc(shortText)}</div>
            <div class="sp-pbp-note">${esc(item.note)}</div>
          </div>
        </div>`;
    });
    html += '</div>';
  }

  // Takeaways
  if (result.takeaways && result.takeaways.length) {
    html += '<div class="sp-takeaways-section"><div class="sp-score-section-title">What to Change</div>';
    result.takeaways.forEach(function(text, i) {
      html += `
        <div class="sp-takeaway">
          <span class="sp-takeaway-num">${i + 1}.</span>
          <span class="sp-takeaway-text">${esc(text)}</span>
        </div>`;
    });
    html += '</div>';
  }

  scoreBody.innerHTML = html;
}

// ===== Agent Logo Toggle =====

function hudFlash(el) {
  el.classList.remove('sp-hud-flash');
  void el.offsetWidth; // force reflow
  el.classList.add('sp-hud-flash');
}

function updateHud() {
  const platformLabels = {
    linkedin: 'LinkedIn', gmail: 'Gmail', instagram: 'Instagram',
    facebook: 'Facebook', x: 'X', salesforce: 'Salesforce',
    hubspot: 'HubSpot', revio: 'Revio', other: '---'
  };
  const pLabel = platformLabels[currentPlatform] || '---';
  if (hudPlatformVal && hudPlatformVal.textContent !== pLabel) {
    hudPlatformVal.textContent = pLabel;
    hudFlash(hudPlatformVal);
  }

  const prospect = (currentFullPage && currentFullPage.contactName) ? currentFullPage.contactName : '---';
  if (hudProspectVal && hudProspectVal.textContent !== prospect) {
    hudProspectVal.textContent = prospect;
    if (prospect !== '---') hudFlash(hudProspectVal);
  }

  const msgCount = (currentFullPage && currentFullPage.messageCount) ? currentFullPage.messageCount : '0';
  const msgStr = String(msgCount);
  if (hudMsgsVal && hudMsgsVal.textContent !== msgStr) {
    hudMsgsVal.textContent = msgStr;
    hudFlash(hudMsgsVal);
  }

  if (hudRipsVal) {
    hudRipsVal.textContent = String(sessionRipCount);
  }
}

const agentMessages = [
  'Scanning for prospects...',
  'Monitoring conversation...',
  'Ready to engage...',
  'Target acquired...',
  'Standing by for orders...',
  'Perimeter secured...',
  'Analyzing signals...',
  'Locking onto target...',
  'Recon in progress...'
];

function getCloserMessages() {
  const name = (currentFullPage && currentFullPage.contactName) || 'contact';
  return [
    `Bot active for ${name}...`,
    'Monitoring inbox...',
    'Auto-reply enabled...',
    'Watching for messages...',
    `Bot active for ${name}...`,
    'Monitoring inbox...',
    'Auto-reply enabled...',
    'Watching for messages...',
    `Bot active for ${name}...`
  ];
}
let agentMsgInterval = null;
let agentHudInterval = null;
let agentMsgIdx = 0;

function setAgentActive(active) {
  agentLogoBtn.classList.toggle('agent-active', active);
  spHeader.classList.toggle('agent-header-active', active);
  agentBar.style.display = active ? '' : 'none';

  if (active) {
    agentMsgIdx = 0;
    updateHud();

    const msgs = (currentPlatform === 'revio' && closerContactId) ? getCloserMessages() : agentMessages;
    if (agentStatusText) agentStatusText.textContent = msgs[0];

    agentMsgInterval = setInterval(() => {
      const currentMsgs = (currentPlatform === 'revio' && closerContactId) ? getCloserMessages() : agentMessages;
      agentMsgIdx = (agentMsgIdx + 1) % currentMsgs.length;
      if (agentStatusText) {
        agentStatusText.style.opacity = '0';
        agentStatusText.style.transform = 'translateY(3px)';
        setTimeout(() => {
          agentStatusText.textContent = currentMsgs[agentMsgIdx];
          agentStatusText.style.opacity = '1';
          agentStatusText.style.transform = 'translateY(0)';
        }, 200);
      }
    }, 3000);

    // Periodic re-scrape to keep HUD data fresh
    agentHudInterval = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'SCRAPE_PAGE' }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.success) return;
        const scraped = resp.data;
        if (scraped && scraped.conversation) {
          currentFullPage = scraped;
          currentPlatform = resp.platform || currentPlatform;
          updateHud();
        }
      });
    }, 15000);
  } else {
    if (agentMsgInterval) { clearInterval(agentMsgInterval); agentMsgInterval = null; }
    if (agentHudInterval) { clearInterval(agentHudInterval); agentHudInterval = null; }
  }
}

// Load saved agent state (non-Revio only; Revio state comes from Closer API)
chrome.storage.local.get('agentEnabled', (result) => {
  if (result.agentEnabled && currentPlatform !== 'revio') setAgentActive(true);
});

agentLogoBtn.addEventListener('click', () => {
  // On Revio pages with a contact — toggle via Closer Bot Config API
  if (currentPlatform === 'revio' && closerContactId) {
    const isCurrentlyActive = agentLogoBtn.classList.contains('agent-active');
    if (isCurrentlyActive) {
      chrome.runtime.sendMessage({ type: 'CLOSER_REMOVE', contactId: closerContactId }, (r) => {
        if (chrome.runtime.lastError) return;
        setAgentActive(false);
      });
    } else {
      chrome.runtime.sendMessage({ type: 'CLOSER_ADD', contactId: closerContactId }, (r) => {
        if (chrome.runtime.lastError) return;
        setAgentActive(true);
      });
    }
    return;
  }
  // Non-Revio: local-only toggle
  const isActive = agentLogoBtn.classList.toggle('agent-active');
  chrome.storage.local.set({ agentEnabled: isActive });
  setAgentActive(isActive);
});
