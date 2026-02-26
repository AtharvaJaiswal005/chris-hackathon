// HackExt Extension - Background Service Worker
console.log('[BG] Service worker starting...');

const WEBHOOK = 'https://rigchris.app.n8n.cloud/webhook/092771e6-73e1-4cca-8941-c84b7210f4e0';
const COACH_WEBHOOK = 'https://rigchris.app.n8n.cloud/webhook/be253eb0-537a-4e3f-bfe7-b49e9d8dd17a/chat';
const ROLEPLAY_WEBHOOK = 'https://rigchris.app.n8n.cloud/webhook/2cca4c7d-1531-40b6-a818-b0b2495ec415/chat';
let sessionId = 'ext-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);

// --- Listener MUST be at top level, registered synchronously ---
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  console.log('[BG] Got message:', message.type, 'from tab:', sender.tab?.id);

  if (message.type === 'GET_REPLY') {
    console.log('[BG] Processing GET_REPLY, text length:', message.text?.length);

    // Do the fetch
    doFetch(message.text, message.platform, message.replyMode, message.pageUrl, message.pageTitle, message.fullPage)
      .then(function (result) {
        console.log('[BG] Fetch success, sending response');
        sendResponse(result);
      })
      .catch(function (err) {
        console.error('[BG] Fetch error:', err.message);
        sendResponse({ success: false, error: err.message });
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

async function doFetch(text, platform, replyMode, pageUrl, pageTitle, fullPage) {
  console.log('[BG] doFetch called', fullPage ? '(full page mode)' : '(selection mode)');

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

  console.log('[BG] Fetching:', WEBHOOK);

  const response = await fetch(WEBHOOK, {
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

  return {
    success: true,
    structured: false,
    raw: raw
  };
}

// --- Coach chat fetch ---
async function doCoachFetch(chatInput, chatSessionId) {
  console.log('[BG] doCoachFetch called, input length:', chatInput.length);

  const payload = {
    chatInput: chatInput,
    sessionId: chatSessionId,
    type: 'text'
  };

  const response = await fetch(COACH_WEBHOOK + '?action=sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('Coach webhook returned ' + response.status);
  }

  const data = await response.json();
  console.log('[BG] Coach response keys:', Object.keys(data));

  const botResponse = unwrapCoachResponse(data);

  return {
    success: true,
    botResponse: botResponse
  };
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

// --- Scoring fetch ---
async function doScoreFetch(transcript, scoreSessionId) {
  console.log('[BG] doScoreFetch called, transcript length:', transcript.length);

  // Match exactly what the main app sends:
  // body.mode = sendMode value ('scoring'), no separate sendMode field
  const payload = {
    chatInput: transcript,
    sessionId: scoreSessionId,
    mode: 'scoring',
    type: 'text'
  };

  console.log('[BG] Score payload:', JSON.stringify(payload).substring(0, 200));

  const response = await fetch(ROLEPLAY_WEBHOOK + '?action=sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('Scoring webhook returned ' + response.status);
  }

  const data = await response.json();
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
    id: 'hackext-reply',
    title: 'Get sales reply with HackExt',
    contexts: ['selection']
  });
  chrome.storage.local.get('enabled', function (result) {
    if (result.enabled === undefined) chrome.storage.local.set({ enabled: true });
  });
  // Enable side panel
  chrome.sidePanel.setOptions({ enabled: true }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'hackext-reply' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_MENU_REPLY', text: info.selectionText });
  }
});

console.log('[BG] Service worker ready');
