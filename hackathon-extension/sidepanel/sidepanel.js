// HackExt Side Panel

const content = document.getElementById('content');
const statusDot = document.getElementById('statusDot');
const replyModes = document.getElementById('replyModes');
const spSubtitle = document.getElementById('spSubtitle');
const chatContainer = document.getElementById('chatContainer');
const chatMessagesEl = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatContextEl = document.getElementById('chatContext');
const scoreContainer = document.getElementById('scoreContainer');
const scoreContextEl = document.getElementById('scoreContext');
const scoreBody = document.getElementById('scoreBody');

// Reply mode state
let currentMode = 'auto';
let currentText = '';
let currentMessages = [];

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
  replyModes.style.display = '';
  spSubtitle.textContent = 'AI Sales Coach';
}

function switchToChatMode() {
  chatMode = true;
  scoreMode = false;
  content.style.display = 'none';
  chatContainer.style.display = 'flex';
  scoreContainer.style.display = 'none';
  replyModes.style.display = 'none';
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
  replyModes.style.display = 'none';
  spSubtitle.textContent = 'Conversation Analysis';
  scoreBody.innerHTML = '';
}

// ===== Reply Mode (existing) =====

// Mode buttons
document.querySelectorAll('.sp-mode').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === currentMode && !currentText) return;
    document.querySelectorAll('.sp-mode').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = mode;
    if (currentText) {
      doRequest(currentText, mode);
    }
  });
});

// Listen for data from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SIDE_PANEL_REQUEST') {
    // Switch to reply mode if we were in chat mode
    switchToReplyMode();
    currentText = message.text;
    currentMode = message.replyMode || 'auto';
    document.querySelectorAll('.sp-mode').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === currentMode);
    });
    doRequest(currentText, currentMode);
  }

  if (message.type === 'SIDE_PANEL_RESULT') {
    showReply(message.data);
  }
});

// Tell background we're ready
chrome.runtime.sendMessage({ type: 'SIDE_PANEL_READY' });

function doRequest(text, replyMode) {
  showLoading(text);
  chrome.runtime.sendMessage({
    type: 'GET_REPLY',
    text: text,
    platform: 'other',
    replyMode: replyMode || 'auto'
  }, (response) => {
    if (chrome.runtime.lastError) {
      showError(chrome.runtime.lastError.message);
      return;
    }
    if (!response) {
      showError('No response from background');
      return;
    }
    if (response.success) {
      showReply(response);
    } else {
      showError(response.error || 'Unknown error');
    }
  });
}

function showLoading(text) {
  statusDot.className = 'sp-status loading';
  statusDot.innerHTML = '<span class="sp-dot"></span> Generating...';

  let html = '';
  if (text) {
    const preview = text.length > 150 ? text.substring(0, 150) + '...' : text;
    html += `<div class="sp-selected-preview">
      <div class="sp-selected-label">Selected text</div>
      <div class="sp-selected-text">${esc(preview)}</div>
    </div>`;
  }
  html += '<div class="sp-loading"><div class="sp-spinner"></div><span>Crafting your reply...</span></div>';
  content.innerHTML = html;
}

function showReply(response) {
  statusDot.className = 'sp-status';
  statusDot.innerHTML = '<span class="sp-dot"></span> Ready';

  let messages, analysis = null, reasoning = null;

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

  // Selected text preview
  if (currentText) {
    const preview = currentText.length > 150 ? currentText.substring(0, 150) + '...' : currentText;
    html += `<div class="sp-selected-preview">
      <div class="sp-selected-label">Selected text</div>
      <div class="sp-selected-text">${esc(preview)}</div>
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
      <div class="sp-message-text">${esc(msg)}</div>
      <button class="sp-copy-btn" data-idx="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>
    </div>`;
  });
  html += `<button class="sp-copy-all-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy All</button></div>`;

  // Reasoning
  if (reasoning) {
    html += `<div class="sp-reasoning">
      <div class="sp-reasoning-label">Why this works</div>
      <div class="sp-reasoning-text">${esc(reasoning)}</div>
    </div>`;
  }

  content.innerHTML = html;

  // Copy handlers
  content.querySelectorAll('.sp-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(messages[parseInt(btn.dataset.idx)]).then(() => {
        btn.textContent = 'Copied!';
        btn.style.color = '#22c55e';
        setTimeout(() => { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy'; btn.style.color = ''; }, 1500);
      });
    });
  });

  const cab = content.querySelector('.sp-copy-all-btn');
  if (cab) cab.addEventListener('click', () => {
    navigator.clipboard.writeText(messages.join('\n\n')).then(() => {
      cab.textContent = 'Copied all!';
      cab.style.color = '#22c55e';
      setTimeout(() => { cab.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy All'; cab.style.color = ''; }, 1500);
    });
  });
}

function showError(msg) {
  statusDot.className = 'sp-status';
  statusDot.innerHTML = '<span class="sp-dot"></span> Ready';

  content.innerHTML = `<div class="sp-error">
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
    hubspot: 'HubSpot', other: 'Page'
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

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'COACH_CHAT_SEND',
        chatInput: text,
        sessionId: chatSessionId
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

    chatMessages.push({ role: 'assistant', content: response.botResponse });
  } catch (err) {
    console.error('[SP] Coach chat error:', err);
    chatMessages.push({
      role: 'assistant',
      content: 'Error: Unable to reach the coach. Please try again.'
    });
  }

  removeTypingIndicator();
  renderChatMessages();
  scrollChatToBottom();

  statusDot.className = 'sp-status';
  statusDot.innerHTML = '<span class="sp-dot"></span> Ready';

  chatSending = false;
  chatInput.focus();
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
  // Use marked.js + DOMPurify (same as main HackExt app)
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
    hubspot: 'HubSpot', other: 'Page'
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
    facebook: 'Facebook Messenger', x: 'X/Twitter DMs', other: 'a messaging platform'
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
        <span>HackExt Performance Index</span>
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
