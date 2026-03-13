// Pitho Extension - Background Service Worker
console.log('[BG] Service worker starting...');

const BACKEND_BASE = 'https://backend-extention-production.up.railway.app';
const WEBHOOKS = {
  thinking: BACKEND_BASE + '/api/reply/thinking',
  fast: BACKEND_BASE + '/api/reply/fast'
};
const COACH_WEBHOOK = 'https://rigchris.app.n8n.cloud/webhook/be253eb0-537a-4e3f-bfe7-b49e9d8dd17a/chat';
const ROLEPLAY_WEBHOOK = 'https://rigchris.app.n8n.cloud/webhook/2cca4c7d-1531-40b6-a818-b0b2495ec415/chat';
let sessionId = 'ext-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);

// --- Listener MUST be at top level, registered synchronously ---
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  console.log('[BG] Got message:', message.type, 'from tab:', sender.tab?.id);

  if (message.type === 'GET_REPLY') {
    console.log('[BG] Processing GET_REPLY, text length:', message.text?.length);

    // Check which backend to use
    chrome.storage.local.get('backend', function (result) {
      const backend = result.backend || 'thinking';
      console.log('[BG] Using backend:', backend);

      const webhookUrl = WEBHOOKS[backend] || WEBHOOKS.thinking;
      doFetch(webhookUrl, message.text, message.platform, message.replyMode, message.pageUrl, message.pageTitle, message.fullPage)
        .then(function (res) {
          res.backend = backend;
          console.log('[BG] Fetch success, sending response');
          sendResponse(res);
        })
        .catch(function (err) {
          console.error('[BG] Fetch error:', err.message);
          sendResponse({ success: false, error: err.message });
        });
    });

    // MUST return true to keep sendResponse alive
    return true;
  }

  if (message.type === 'ANALYZE_CHAT') {
    console.log('[BG] Analyze & Chat request');
    const tabId = sender.tab?.id;

    // Generate a unique session ID for this chat
    const chatSessionId = 'ext-chat-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);

    // Store context in session storage so the side panel can pick it up
    chrome.storage.session.set({
      pendingChatContext: {
        sessionId: chatSessionId,
        platform: message.platform,
        pageUrl: message.pageUrl,
        pageTitle: message.pageTitle,
        scrapedData: message.scrapedData,
        selectedText: message.selectedText
      }
    });

    // Open the side panel
    if (tabId) {
      chrome.sidePanel.open({ tabId: tabId }).then(() => {
        console.log('[BG] Side panel opened for chat mode');
      }).catch(err => {
        console.error('[BG] Side panel error:', err);
      });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs[0]) {
          chrome.sidePanel.open({ tabId: tabs[0].id }).catch(err => {
            console.error('[BG] Side panel fallback error:', err);
          });
        }
      });
    }

    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'COACH_CHAT_SEND') {
    console.log('[BG] Coach chat send, sessionId:', message.sessionId);

    doCoachFetch(message.chatInput, message.sessionId)
      .then(function (result) {
        console.log('[BG] Coach chat success');
        sendResponse(result);
      })
      .catch(function (err) {
        console.error('[BG] Coach chat error:', err.message);
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }

  if (message.type === 'ANALYZE_SCORE') {
    console.log('[BG] Analyze & Score request');
    const tabId = sender.tab?.id;
    const scoreSessionId = 'ext-score-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);

    // Store scoring context for the side panel
    chrome.storage.session.set({
      pendingScoreContext: {
        sessionId: scoreSessionId,
        platform: message.platform,
        pageUrl: message.pageUrl,
        pageTitle: message.pageTitle,
        scrapedData: message.scrapedData,
        selectedText: message.selectedText
      }
    });

    // Open the side panel
    if (tabId) {
      chrome.sidePanel.open({ tabId: tabId }).then(() => {
        console.log('[BG] Side panel opened for score mode');
      }).catch(err => {
        console.error('[BG] Side panel error:', err);
      });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs[0]) {
          chrome.sidePanel.open({ tabId: tabs[0].id }).catch(err => {
            console.error('[BG] Side panel fallback error:', err);
          });
        }
      });
    }

    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'SCORE_CONVERSATION') {
    console.log('[BG] Score conversation, sessionId:', message.sessionId);

    doScoreFetch(message.transcript, message.sessionId)
      .then(function (result) {
        console.log('[BG] Score success');
        sendResponse(result);
      })
      .catch(function (err) {
        console.error('[BG] Score error:', err.message);
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }

  if (message.type === 'SCRAPE_PAGE') {
    console.log('[BG] Scrape page request');
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'SCRAPE_PAGE' }, function (resp) {
        if (chrome.runtime.lastError) {
          console.error('[BG] Scrape relay error:', chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse(resp || { success: false, error: 'No response from content script' });
      });
    });
    return true;
  }

  if (message.type === 'INSERT_TEXT') {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'INSERT_TEXT', text: message.text }, function (resp) {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse(resp || { success: false, error: 'No response' });
      });
    });
    return true;
  }

  if (message.type === 'OPEN_SIDE_PANEL') {
    console.log('[BG] Opening side panel');
    const tabId = sender.tab?.id || message.tabId;
    if (tabId) {
      chrome.sidePanel.open({ tabId: tabId }).then(() => {
        console.log('[BG] Side panel opened');
      }).catch(err => {
        console.error('[BG] Side panel error:', err);
      });
    } else {
      // Fallback: get active tab
      chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs[0]) {
          chrome.sidePanel.open({ tabId: tabs[0].id }).catch(err => {
            console.error('[BG] Side panel fallback error:', err);
          });
        }
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'SIDE_PANEL_READY') {
    console.log('[BG] Side panel ready');
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'PING') {
    console.log('[BG] PING received, sending PONG');
    sendResponse({ pong: true });
    return true;
  }

});

console.log('[BG] Message listener registered');

// --- Streaming port handler ---
chrome.runtime.onConnect.addListener(function (port) {
  if (port.name === 'stream-reply') {
    console.log('[BG] Stream reply port connected');

    port.onMessage.addListener(function (msg) {
      if (msg.type === 'START_STREAM') {
        console.log('[BG] Starting streaming reply');
        chrome.storage.local.get('backend', function (result) {
          const backend = result.backend || 'thinking';
          console.log('[BG] Streaming with backend:', backend);

          const webhookUrl = WEBHOOKS[backend] || WEBHOOKS.thinking;
          doStreamFetch(port, webhookUrl, backend, msg.text, msg.platform, msg.replyMode, msg.pageUrl, msg.pageTitle, msg.fullPage)
            .catch(function (err) {
              console.error('[BG] Stream error:', err.message);
              port.postMessage({ type: 'ERROR', error: err.message });
            });
        });
      }
    });
  }

  if (port.name === 'stream-coach') {
    console.log('[BG] Stream coach port connected');

    port.onMessage.addListener(function (msg) {
      if (msg.type === 'COACH_SEND') {
        console.log('[BG] Starting streaming coach, sessionId:', msg.sessionId);
        doCoachStreamFetch(port, msg.chatInput, msg.sessionId)
          .catch(function (err) {
            console.error('[BG] Coach stream error:', err.message);
            port.postMessage({ type: 'ERROR', error: err.message });
          });
      }
    });
  }
});

// --- Streaming fetch for n8n ---
async function doStreamFetch(port, webhookUrl, backend, text, platform, replyMode, pageUrl, pageTitle, fullPage) {
  const chatInput = buildChatInput(text, platform, replyMode, pageUrl, pageTitle, fullPage);
  const payload = {
    chatInput: JSON.stringify(chatInput),
    sessionId: sessionId,
    type: 'text',
    mode: 'select_reply'
  };

  console.log('[BG] Stream fetching:', webhookUrl);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('Webhook returned ' + response.status);
  }

  const contentType = response.headers.get('content-type') || '';
  console.log('[BG] Stream response content-type:', contentType);

  // Check if response is SSE stream
  if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
    console.log('[BG] SSE/text stream detected, reading chunks...');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';

    port.postMessage({ type: 'STREAM_START', backend: backend });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // Parse SSE format: "data: ...\n\n"
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const token = parsed.token || parsed.text || parsed.content || parsed.output || '';
            if (token) {
              accumulated += token;
              port.postMessage({ type: 'STREAM_CHUNK', token: token, accumulated: accumulated });
            }
          } catch (e) {
            if (data.trim()) {
              accumulated += data;
              port.postMessage({ type: 'STREAM_CHUNK', token: data, accumulated: accumulated });
            }
          }
        }
      }
    }

    const result = parseN8nOutput(accumulated);
    result.backend = backend;
    port.postMessage({ type: 'STREAM_END', data: result });

    // Save lead to CRM (fire and forget)
    const chatInputObj = buildChatInput(text, platform, replyMode, pageUrl, pageTitle, fullPage);
    saveLead(JSON.stringify(chatInputObj), platform, pageUrl, pageTitle, accumulated, fullPage);
    return;
  }

  // Read response body through stream reader (handles both NDJSON and regular JSON)
  console.log('[BG] Reading response body via stream reader...');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let fullBody = '';
  let streamStarted = false;
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullBody += chunk;
      buffer += chunk;

      // Process complete lines looking for NDJSON
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'begin' && !streamStarted) {
            port.postMessage({ type: 'STREAM_START', backend: backend });
            streamStarted = true;
          } else if (parsed.type === 'item' && parsed.content) {
            accumulated += parsed.content;
            port.postMessage({ type: 'STREAM_CHUNK', token: parsed.content, accumulated: accumulated });
          }
        } catch (e) {
          // Not NDJSON line — part of regular JSON body
        }
      }
    }
  } catch (err) {
    console.error('[BG] Stream read error:', err.message);
  }

  // Handle remaining buffer
  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim());
      if (parsed.type === 'item' && parsed.content) {
        accumulated += parsed.content;
        port.postMessage({ type: 'STREAM_CHUNK', token: parsed.content, accumulated: accumulated });
      }
    } catch (e) {}
  }

  const chatInputObj2 = buildChatInput(text, platform, replyMode, pageUrl, pageTitle, fullPage);
  if (streamStarted && accumulated) {
    // NDJSON streaming completed
    console.log('[BG] NDJSON stream complete, accumulated:', accumulated.length, 'chars');
    const result = parseN8nOutput(accumulated);
    result.backend = backend;
    port.postMessage({ type: 'STREAM_END', data: result });
    saveLead(JSON.stringify(chatInputObj2), platform, pageUrl, pageTitle, accumulated, fullPage);
  } else {
    // Regular JSON response
    console.log('[BG] Non-NDJSON response, parsing as JSON');
    try {
      const data = JSON.parse(fullBody);
      const result = parseN8nResponse(data);
      result.backend = backend;
      port.postMessage({ type: 'COMPLETE', data: result });
      saveLead(JSON.stringify(chatInputObj2), platform, pageUrl, pageTitle, result.raw || fullBody, fullPage);
    } catch (e) {
      const result = parseN8nOutput(fullBody);
      result.backend = backend;
      port.postMessage({ type: 'COMPLETE', data: result });
      saveLead(JSON.stringify(chatInputObj2), platform, pageUrl, pageTitle, result.raw || fullBody, fullPage);
    }
  }
}

// --- Streaming coach fetch (NDJSON from n8n Chat Trigger) ---
async function doCoachStreamFetch(port, chatInputText, chatSessionId) {
  console.log('[BG] doCoachStreamFetch called, input length:', chatInputText.length);

  const payload = {
    chatInput: chatInputText,
    sessionId: chatSessionId,
    type: 'text'
  };

  const response = await fetch(COACH_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('Coach webhook returned ' + response.status);
  }

  // Read response body through stream reader (n8n Chat Trigger sends NDJSON)
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let fullBody = '';
  let streamStarted = false;
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullBody += chunk;
      buffer += chunk;

      // Process complete NDJSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'begin' && !streamStarted) {
            port.postMessage({ type: 'STREAM_START' });
            streamStarted = true;
          } else if (parsed.type === 'item' && parsed.content) {
            accumulated += parsed.content;
            port.postMessage({ type: 'STREAM_CHUNK', token: parsed.content, accumulated: accumulated });
          }
        } catch (e) {
          // Not NDJSON line
        }
      }
    }
  } catch (err) {
    console.error('[BG] Coach stream read error:', err.message);
  }

  // Handle remaining buffer
  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim());
      if (parsed.type === 'item' && parsed.content) {
        accumulated += parsed.content;
        port.postMessage({ type: 'STREAM_CHUNK', token: parsed.content, accumulated: accumulated });
      }
    } catch (e) {}
  }

  if (streamStarted && accumulated) {
    console.log('[BG] Coach NDJSON stream complete, accumulated:', accumulated.length, 'chars');
    const cleaned = unwrapCoachResponse({ output: accumulated });
    port.postMessage({ type: 'STREAM_END', botResponse: cleaned });
  } else if (fullBody) {
    // Not NDJSON — try to parse as regular JSON
    console.log('[BG] Coach non-NDJSON response, parsing as JSON');
    try {
      const data = JSON.parse(fullBody);
      const botResponse = unwrapCoachResponse(data);
      port.postMessage({ type: 'COMPLETE', botResponse: botResponse });
    } catch (e) {
      port.postMessage({ type: 'COMPLETE', botResponse: fullBody });
    }
  } else {
    port.postMessage({ type: 'ERROR', error: 'Empty response from coach' });
  }
}

// --- Get current user session ---
async function getSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get('pitho_session', (result) => {
      resolve(result.pitho_session || null);
    });
  });
}

// --- Save Lead to CRM ---
async function saveLead(chatInput, platform, pageUrl, pageTitle, replyText, fullPage) {
  try {
    // Get user session — need user_id for lead ownership
    const session = await getSession();
    if (!session || !session.user) {
      console.warn('[BG] No user session, skipping lead save. User needs to sign in.');
      return;
    }

    // Extract prospect name from fullPage or pageTitle
    let prospectName = 'Unknown Prospect';
    if (fullPage && fullPage.contactName) {
      prospectName = fullPage.contactName;
    } else if (pageTitle) {
      // Try to extract name from page title (LinkedIn: "Name | LinkedIn", Gmail: "Name - Subject")
      const cleaned = pageTitle.replace(/\s*[\|–-]\s*(LinkedIn|Gmail|Instagram|Messenger|Messages).*$/i, '').trim();
      if (cleaned && cleaned.length > 1 && cleaned.length < 80) {
        prospectName = cleaned;
      }
    }

    // Extract conversation from fullPage
    let conversation = [];
    let lastMessage = '';
    if (fullPage && fullPage.conversation) {
      lastMessage = typeof fullPage.conversation === 'string'
        ? fullPage.conversation.slice(-200)
        : '';
      conversation = fullPage.conversation;
    } else if (typeof chatInput === 'string') {
      lastMessage = chatInput.slice(0, 200);
    }

    // Detect platform
    let detectedPlatform = platform || 'other';
    if (pageUrl) {
      if (pageUrl.includes('linkedin.com')) detectedPlatform = 'linkedin';
      else if (pageUrl.includes('mail.google.com') || pageUrl.includes('gmail')) detectedPlatform = 'gmail';
      else if (pageUrl.includes('instagram.com')) detectedPlatform = 'instagram';
    }

    const payload = {
      name: prospectName,
      platform: detectedPlatform,
      tag: 'warm',
      score: 50,
      last_message: lastMessage,
      conversation: typeof conversation === 'string' ? [{ text: conversation }] : conversation,
      page_url: pageUrl || '',
      reply_generated: replyText || '',
      notes: fullPage ? `${fullPage.messageCount || 0} messages scraped` : '',
      user_id: session.user.id,
    };

    console.log('[BG] Saving lead to CRM:', prospectName, detectedPlatform, 'user:', session.user.id);

    const resp = await fetch(BACKEND_BASE + '/api/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': session.user.id,
      },
      body: JSON.stringify(payload)
    });

    if (resp.ok) {
      const result = await resp.json();
      console.log('[BG] Lead saved:', result.action, result.lead?.id);
    } else {
      console.warn('[BG] Lead save failed:', resp.status);
    }
  } catch (err) {
    console.warn('[BG] Lead save error (non-blocking):', err.message);
  }
}

// --- Shared helpers ---

function buildChatInput(text, platform, replyMode, pageUrl, pageTitle, fullPage) {
  const chatInput = {
    selectedText: text,
    platform: platform || 'other',
    replyMode: replyMode || 'auto',
    pageUrl: pageUrl || '',
    pageTitle: pageTitle || '',
    userContext: null
  };

  if (fullPage) {
    chatInput.fullPage = {
      type: fullPage.type || 'generic',
      contactName: fullPage.contactName || '',
      subject: fullPage.subject || '',
      conversation: fullPage.conversation || '',
      messageCount: fullPage.messageCount || 0,
      highlightedText: fullPage.highlightedText || ''
    };
    chatInput.inputMode = 'analyze';
  } else {
    chatInput.inputMode = 'select';
  }

  return chatInput;
}

function parseN8nOutput(raw) {
  // Strip code fences
  raw = raw.replace(/^```[\w]*\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '').trim();

  // Try parse as structured JSON
  try {
    const parsed = JSON.parse(raw);
    if (parsed.messages && Array.isArray(parsed.messages)) {
      return {
        success: true,
        structured: true,
        analysis: parsed.analysis || null,
        messages: parsed.messages,
        reasoning: parsed.reasoning || null
      };
    }
  } catch (e) { /* not JSON */ }

  // Clean escaped chars
  raw = raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

  return {
    success: true,
    structured: false,
    raw: raw
  };
}

function parseN8nResponse(data) {
  let raw = '';
  if (data.output && typeof data.output === 'string') {
    raw = data.output;
  } else if (Array.isArray(data) && data[0]?.output) {
    raw = data[0].output;
  } else {
    raw = JSON.stringify(data);
  }
  return parseN8nOutput(raw);
}

async function doFetch(webhookUrl, text, platform, replyMode, pageUrl, pageTitle, fullPage) {
  console.log('[BG] doFetch called', webhookUrl, fullPage ? '(full page mode)' : '(selection mode)');

  const chatInput = {
    selectedText: text,
    platform: platform || 'other',
    replyMode: replyMode || 'auto',
    pageUrl: pageUrl || '',
    pageTitle: pageTitle || '',
    userContext: null
  };

  // Include full page scraped data if available
  if (fullPage) {
    chatInput.fullPage = {
      type: fullPage.type || 'generic',
      contactName: fullPage.contactName || '',
      subject: fullPage.subject || '',
      conversation: fullPage.conversation || '',
      messageCount: fullPage.messageCount || 0,
      highlightedText: fullPage.highlightedText || ''
    };
    chatInput.inputMode = 'analyze';
  } else {
    chatInput.inputMode = 'select';
  }

  const payload = {
    chatInput: JSON.stringify(chatInput),
    sessionId: sessionId,
    type: 'text',
    mode: 'select_reply'
  };

  console.log('[BG] Fetching:', webhookUrl);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  console.log('[BG] Response status:', response.status);

  if (!response.ok) {
    throw new Error('Webhook returned ' + response.status);
  }

  const data = await response.json();
  console.log('[BG] Response data keys:', Object.keys(data));

  // Unwrap - n8n wraps in {output: "..."}
  let raw = '';
  if (data.output && typeof data.output === 'string') {
    raw = data.output;
  } else if (Array.isArray(data) && data[0]?.output) {
    raw = data[0].output;
  } else {
    raw = JSON.stringify(data);
  }

  // Strip code fences
  raw = raw.replace(/^```[\w]*\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '').trim();

  // Try parse as structured JSON
  try {
    const parsed = JSON.parse(raw);
    if (parsed.messages && Array.isArray(parsed.messages)) {
      console.log('[BG] Parsed structured response:', parsed.messages.length, 'messages');
      return {
        success: true,
        structured: true,
        analysis: parsed.analysis || null,
        messages: parsed.messages,
        reasoning: parsed.reasoning || null
      };
    }
  } catch (e) {
    console.log('[BG] Not JSON, using as plain text');
  }

  // Clean escaped chars
  raw = raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

  // Save lead from non-streaming path
  saveLead(text, platform, pageUrl, pageTitle, raw, fullPage);

  return {
    success: true,
    structured: false,
    raw: raw
  };
}


// --- Coach chat fetch (handles both NDJSON and regular JSON) ---
async function doCoachFetch(chatInput, chatSessionId) {
  console.log('[BG] doCoachFetch called, input length:', chatInput.length);

  const payload = {
    chatInput: chatInput,
    sessionId: chatSessionId,
    type: 'text'
  };

  const response = await fetch(COACH_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('Coach webhook returned ' + response.status);
  }

  // Read as text to handle both NDJSON and regular JSON
  const bodyText = await response.text();
  console.log('[BG] Coach response length:', bodyText.length);

  // Check if NDJSON (n8n Chat Trigger with streaming enabled)
  if (bodyText.trimStart().startsWith('{"type":"begin"') || bodyText.trimStart().startsWith('{"type":"item"')) {
    let accumulated = '';
    const lines = bodyText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === 'item' && parsed.content) {
          accumulated += parsed.content;
        }
      } catch (e) {}
    }
    const botResponse = unwrapCoachResponse({ output: accumulated });
    return { success: true, botResponse: botResponse };
  }

  // Regular JSON
  const data = JSON.parse(bodyText);
  console.log('[BG] Coach response keys:', Object.keys(data));
  const botResponse = unwrapCoachResponse(data);
  return { success: true, botResponse: botResponse };
}

function unwrapCoachResponse(data) {
  function stripFences(s) {
    if (typeof s !== 'string') return s;
    return s.replace(/^```[\w]*\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '').trim();
  }

  // Handle array wrapping
  let topLevel = data;
  if (Array.isArray(topLevel)) topLevel = topLevel[0];

  // Start with whatever n8n gave us
  let current = '';
  if (topLevel && typeof topLevel === 'object') {
    current = topLevel.output || topLevel.response || topLevel.text || topLevel.botResponse || '';
  }
  if (typeof current !== 'string') current = JSON.stringify(current);

  // Unwrap loop: strip fences -> parse JSON -> extract .output -> repeat (up to 5 layers)
  for (let i = 0; i < 5; i++) {
    current = stripFences(current);
    if (!current.startsWith('{') && !current.startsWith('[')) break;
    let parsed = null;
    try { parsed = JSON.parse(current); } catch (e) {
      try { parsed = JSON.parse(current.replace(/[\x00-\x1F]/g, ' ')); } catch (e2) { /* noop */ }
    }
    if (!parsed) break;
    if (Array.isArray(parsed)) parsed = parsed[0];
    if (!parsed || typeof parsed !== 'object') break;
    const next = parsed.output || parsed.response || parsed.text;
    if (!next || typeof next !== 'string') break;
    current = next;
  }

  current = stripFences(current);

  // Regex last resort
  if (current && current.trim().startsWith('{')) {
    const m = current.match(/"output"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) current = m[1];
  }

  // Strip leaked internal tool/agent outputs
  current = current
    .replace(/Calling \w[\w.]* with input:?\s*(\{.*?\}|\(.*?\)|".*?")/gs, '')
    .replace(/> ?(Entering|Finished) new \w+ chain\.{0,3}/gi, '')
    .replace(/^(Action|Action Input|Thought|Observation):.*$/gm, '')
    .replace(/^Tool output:.*$/gm, '')
    .replace(/^\[[\w_]+\].*$/gm, '')
    .trim();

  // Convert escaped newlines
  current = current.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

  return current || "Sorry, I couldn't process that. Please try again.";
}

// --- Scoring fetch (handles both NDJSON and regular JSON) ---
async function doScoreFetch(transcript, scoreSessionId) {
  console.log('[BG] doScoreFetch called, transcript length:', transcript.length);

  const payload = {
    chatInput: transcript,
    sessionId: scoreSessionId,
    mode: 'scoring',
    type: 'text'
  };

  console.log('[BG] Score payload:', JSON.stringify(payload).substring(0, 200));

  const response = await fetch(ROLEPLAY_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('Scoring webhook returned ' + response.status);
  }

  // Read as text to handle both NDJSON and regular JSON
  const bodyText = await response.text();
  console.log('[BG] Score response length:', bodyText.length);

  let data;
  // Check if NDJSON (Chat Trigger with streaming enabled)
  if (bodyText.trimStart().startsWith('{"type":"begin"') || bodyText.trimStart().startsWith('{"type":"item"')) {
    let accumulated = '';
    const lines = bodyText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === 'item' && parsed.content) {
          accumulated += parsed.content;
        }
      } catch (e) {}
    }
    data = { output: accumulated };
  } else {
    data = JSON.parse(bodyText);
  }

  console.log('[BG] Score RAW response:', JSON.stringify(data).substring(0, 500));

  // Parse scoring result
  const result = parseScoringResponse(data);
  console.log('[BG] Parsed scoring result:', result ? ('score=' + result.score + ', metrics=' + result.metrics.length) : 'null');

  return {
    success: true,
    scoringResult: result
  };
}

function parseScoringResponse(scoreData) {
  let scoringScore;
  let scoringMetrics = null;
  let scoringFeedback = null;
  let scoringPlayByPlay = null;
  let scoringTakeaways = null;

  function extractScoring(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.score !== undefined) scoringScore = obj.score;
    if (obj.metrics) scoringMetrics = obj.metrics;
    if (obj.feedback) scoringFeedback = obj.feedback;
    if (obj.playByPlay) scoringPlayByPlay = obj.playByPlay;
    if (obj.takeaways) scoringTakeaways = obj.takeaways;
  }

  // Step 1: Unwrap the n8n response layers (same logic as unwrapCoachResponse)
  // This handles array wrapping, nested {output: "..."}, code fences, etc.
  let topLevel = scoreData;
  if (Array.isArray(topLevel)) topLevel = topLevel[0];

  // Try direct object extraction first
  extractScoring(topLevel);

  // Try nested output/response as objects
  if (!scoringMetrics && topLevel && topLevel.output && typeof topLevel.output === 'object') {
    extractScoring(topLevel.output);
  }
  if (!scoringMetrics && topLevel && topLevel.response && typeof topLevel.response === 'object') {
    extractScoring(topLevel.response);
  }

  // Step 2: Deep unwrap string — same 5-layer loop as coach unwrapper
  if (!scoringMetrics) {
    let current = '';
    if (topLevel && typeof topLevel === 'object') {
      current = topLevel.output || topLevel.response || topLevel.text || topLevel.botResponse || '';
    }
    if (typeof current !== 'string') current = JSON.stringify(current);

    function stripFences(s) {
      if (typeof s !== 'string') return s;
      return s.replace(/^```[\w]*\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '').trim();
    }

    // Unwrap loop: strip fences -> parse JSON -> extract .output -> repeat (up to 5 layers)
    for (let i = 0; i < 5; i++) {
      current = stripFences(current);
      if (!current || (!current.startsWith('{') && !current.startsWith('['))) break;
      let parsed = null;
      try { parsed = JSON.parse(current); } catch (e) {
        try { parsed = JSON.parse(current.replace(/[\x00-\x1F]/g, ' ')); } catch (e2) { /* noop */ }
      }
      if (!parsed) break;
      if (Array.isArray(parsed)) parsed = parsed[0];
      if (!parsed || typeof parsed !== 'object') break;

      // Try extracting scoring from this layer
      extractScoring(parsed);
      if (scoringMetrics) {
        console.log('[BG] Found scoring data at unwrap layer', i);
        break;
      }

      const next = parsed.output || parsed.response || parsed.text;
      if (!next || typeof next !== 'string') break;
      current = next;
    }

    // Step 3: If still no metrics, try to find JSON in the final unwrapped string
    if (!scoringMetrics && current && typeof current === 'string') {
      current = stripFences(current);
      console.log('[BG] Unwrapped scoring string (first 300):', current.substring(0, 300));

      // Try parsing the whole string as JSON
      if (current.startsWith('{')) {
        try {
          const parsed = JSON.parse(current);
          extractScoring(parsed);
        } catch (e) {
          try {
            const parsed = JSON.parse(current.replace(/[\x00-\x1F]/g, ' '));
            extractScoring(parsed);
          } catch (e2) { /* will try regex below */ }
        }
      }

      // Step 4: Try to find JSON embedded in text (agent might wrap it in explanation)
      if (!scoringMetrics) {
        const jsonMatch = current.match(/\{[\s\S]*"score"\s*:\s*\d+[\s\S]*"metrics"\s*:\s*\[[\s\S]*\]/);
        if (jsonMatch) {
          // Find the matching closing brace
          let jsonStr = jsonMatch[0];
          let braceCount = 0;
          let endIdx = 0;
          for (let i = 0; i < jsonStr.length; i++) {
            if (jsonStr[i] === '{') braceCount++;
            if (jsonStr[i] === '}') { braceCount--; if (braceCount === 0) { endIdx = i + 1; break; } }
          }
          if (endIdx > 0) jsonStr = jsonStr.substring(0, endIdx);

          try {
            const parsed = JSON.parse(jsonStr);
            extractScoring(parsed);
            console.log('[BG] Extracted scoring from embedded JSON');
          } catch (e) {
            // Last resort: regex extraction
            console.log('[BG] Trying regex extraction');
            const sm = current.match(/"score"\s*:\s*(\d+)/);
            if (sm) scoringScore = parseInt(sm[1]);
            const mm = current.match(/"metrics"\s*:\s*(\[[\s\S]*?\](?:\s*\}))/);
            if (mm) { try { scoringMetrics = JSON.parse(mm[1].replace(/\}$/, '')); } catch (e3) {} }
            if (!scoringMetrics) {
              const mm2 = current.match(/"metrics"\s*:\s*(\[[\s\S]*?\])/);
              if (mm2) { try { scoringMetrics = JSON.parse(mm2[1]); } catch (e3) {} }
            }
            const fm = current.match(/"feedback"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (fm) scoringFeedback = fm[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
            const pbpm = current.match(/"playByPlay"\s*:\s*(\[[\s\S]*?\])/);
            if (pbpm) { try { scoringPlayByPlay = JSON.parse(pbpm[1]); } catch (e3) {} }
            const tam = current.match(/"takeaways"\s*:\s*(\[[\s\S]*?\])/);
            if (tam) { try { scoringTakeaways = JSON.parse(tam[1]); } catch (e3) {} }
          }
        }
      }
    }
  }

  // Fallback defaults if nothing was extracted
  if (!scoringMetrics || scoringScore === undefined) {
    console.log('[BG] Using fallback scoring defaults');
    scoringScore = scoringScore !== undefined ? scoringScore : 15;
    scoringMetrics = [
      { name: 'Pacing, Pressure & Timing', score: 3, description: 'See analysis for details.' },
      { name: 'Frame Control & Authority', score: 3, description: 'See analysis for details.' },
      { name: 'Message Structure & Word Economy', score: 3, description: 'See analysis for details.' },
      { name: 'Question Strategy & Depth', score: 3, description: 'See analysis for details.' },
      { name: 'Objection Handling & Close Execution', score: 3, description: 'See analysis for details.' }
    ];
    scoringTakeaways = ['Review the conversation for specific improvements.'];
    scoringPlayByPlay = [{ message: 'Your last message', color: 'yellow', note: 'Review metrics for specific feedback.' }];
  }

  if (scoringScore !== undefined && scoringMetrics) {
    return {
      score: scoringScore,
      metrics: scoringMetrics,
      playByPlay: scoringPlayByPlay || [],
      takeaways: scoringTakeaways || [],
      feedback: scoringFeedback || null
    };
  }

  return null;
}

// --- Context menu ---
chrome.runtime.onInstalled.addListener(function () {
  console.log('[BG] Extension installed/updated');
  chrome.contextMenus.create({
    id: 'chatripper-reply',
    title: 'Get sales reply with Pitho.ai',
    contexts: ['selection']
  });
  chrome.storage.local.get('enabled', function (result) {
    if (result.enabled === undefined) chrome.storage.local.set({ enabled: true });
  });
  // Enable side panel
  chrome.sidePanel.setOptions({ enabled: true }).catch(() => {});
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(function (tab) {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'chatripper-reply' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_MENU_REPLY', text: info.selectionText });
  }
});

// Alt+I hotkey — insert reply into chat
chrome.commands.onCommand.addListener(function (command) {
  if (command === 'insert-reply') {
    console.log('[BG] insert-reply hotkey triggered');
    // Ask side panel for the current message text
    chrome.runtime.sendMessage({ type: 'GET_INSERT_TEXT' }, function (resp) {
      if (chrome.runtime.lastError || !resp || !resp.text) {
        console.log('[BG] No text from side panel');
        return;
      }
      // Send to the active tab's content script
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, { type: 'INSERT_TEXT', text: resp.text, replace: true });
      });
    });
  }
});

console.log('[BG] Service worker ready');
