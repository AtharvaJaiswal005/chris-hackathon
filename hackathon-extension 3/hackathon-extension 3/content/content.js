// Pitho Extension - Content Script

(function () {
  'use strict';

  console.log('[Pitho] Loaded on', window.location.hostname);

  let enabled = true;
  let floatingBtn = null;
  let replyPanel = null;
  let loaderPill = null;
  let currentSelection = '';
  let currentReplyMode = 'auto';
  let currentInputMode = 'select'; // 'select' or 'analyze'
  let statusInterval = null;
  let lastFocusedInput = null;

  const logoURL = chrome.runtime.getURL('icons/icon48.png');
  const loaderGifURL = chrome.runtime.getURL('loading.gif');

  // Cycling status words — shuffled per request
  const allStatusWords = [
    'Reading the conversation',
    'Analyzing their energy',
    'Searching 1,230 real DMs',
    'Matching top closer patterns',
    'Picking the right framework',
    'Crafting your reply',
    'Refining the approach',
    'Reading between the lines',
    'Decoding their objections',
    'Calibrating the tone',
    'Finding the right angle',
    'Building frame control',
    'Mapping the sales stage',
    'Studying what top reps do here',
    'Checking objection playbooks',
    'Matching their pacing',
    'Dialing in the energy',
    'Running it through KB1',
    'Pulling proven frameworks',
    'Finishing touches'
  ];

  function getShuffledStatus() {
    const arr = allStatusWords.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  chrome.storage.local.get('enabled', (result) => {
    enabled = result.enabled !== false;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      enabled = changes.enabled.newValue;
      if (!enabled) { removeFloatingBtn(); removeReplyPanel(); removeLoader(); }
    }
  });

  function detectPlatform() {
    const h = window.location.hostname;
    if (h.includes('linkedin.com')) return 'linkedin';
    if (h.includes('mail.google.com') || h.includes('gmail.com')) return 'gmail';
    if (h.includes('salesforce.com') || h.includes('force.com')) return 'salesforce';
    if (h.includes('hubspot.com')) return 'hubspot';
    if (h.includes('instagram.com')) return 'instagram';
    if (h.includes('facebook.com') || h.includes('messenger.com')) return 'facebook';
    if (h.includes('twitter.com') || h.includes('x.com')) return 'x';
    if (h.includes('sbccrm.com')) return 'revio';
    return 'other';
  }

  function getPlatformLabel() {
    const p = detectPlatform();
    const labels = { linkedin: 'LinkedIn', gmail: 'Gmail', salesforce: 'Salesforce', hubspot: 'HubSpot', instagram: 'Instagram', facebook: 'Facebook', x: 'X', revio: 'Revio', other: null };
    return labels[p];
  }

  // =============================================
  // PAGE SCRAPERS — Platform-specific extractors
  // =============================================

  function scrapePageContent() {
    const platform = detectPlatform();
    let scraped = null;

    try {
      switch (platform) {
        case 'linkedin': scraped = scrapeLinkedIn(); break;
        case 'gmail': scraped = scrapeGmail(); break;
        case 'instagram': scraped = scrapeInstagram(); break;
        case 'facebook': scraped = scrapeFacebook(); break;
        case 'x': scraped = scrapeX(); break;
        default: scraped = scrapeGeneric(); break;
      }
    } catch (e) {
      console.log('[Pitho] Scrape error, falling back to generic:', e.message);
      scraped = scrapeGeneric();
    }

    if (!scraped || !scraped.conversation || scraped.conversation.trim().length < 10) {
      scraped = scrapeGeneric();
    }

    return scraped;
  }

  function scrapeLinkedIn() {
    // LinkedIn messaging thread
    const msgs = document.querySelectorAll('.msg-s-event-listitem, .msg-s-message-list__event, [class*="msg-s-event"]');
    if (msgs.length > 0) {
      const thread = [];
      msgs.forEach(msg => {
        const sender = msg.querySelector('.msg-s-message-group__name, [class*="message-group__name"], .msg-s-event-listitem__name')?.textContent?.trim();
        const body = msg.querySelector('.msg-s-event-listitem__body, [class*="event-listitem__body"], .msg-s-event__content')?.textContent?.trim();
        if (body) {
          thread.push(sender ? `${sender}: ${body}` : body);
        }
      });
      if (thread.length > 0) {
        const profileName = document.querySelector('.msg-overlay-conversation-bubble__header-name, .msg-conversation-card__participant-names, h2.msg-overlay-bubble-header__title')?.textContent?.trim();
        return {
          type: 'dm_thread',
          contactName: profileName || '',
          conversation: thread.join('\n\n'),
          messageCount: thread.length
        };
      }
    }

    // LinkedIn feed post/comments
    const postBody = document.querySelector('.feed-shared-update-v2__description, .feed-shared-text, [class*="feed-shared-text"]')?.textContent?.trim();
    if (postBody) {
      const comments = [];
      document.querySelectorAll('.comments-comment-item, [class*="comment-item"]').forEach(c => {
        const author = c.querySelector('.comments-post-meta__name, [class*="comment-item__name"]')?.textContent?.trim();
        const text = c.querySelector('.comments-comment-item__main-content, [class*="comment-item__content"]')?.textContent?.trim();
        if (text) comments.push(author ? `${author}: ${text}` : text);
      });
      return {
        type: 'post_comments',
        conversation: `[Post]\n${postBody}\n\n[Comments]\n${comments.join('\n\n')}`,
        messageCount: comments.length + 1
      };
    }

    // LinkedIn profile
    const profileSection = document.querySelector('.pv-top-card, [class*="profile-top-card"]');
    if (profileSection) {
      const name = profileSection.querySelector('.text-heading-xlarge, [class*="top-card__title"]')?.textContent?.trim();
      const headline = profileSection.querySelector('.text-body-medium, [class*="top-card__headline"]')?.textContent?.trim();
      const about = document.querySelector('#about ~ .display-flex .pv-shared-text-with-see-more span, [class*="about"] span')?.textContent?.trim();
      return {
        type: 'profile',
        contactName: name || '',
        conversation: `Profile: ${name || 'Unknown'}\nHeadline: ${headline || ''}\nAbout: ${about || ''}`,
        messageCount: 0
      };
    }

    return scrapeGeneric();
  }

  function scrapeGmail() {
    // Gmail email thread - need to grab ALL emails including collapsed ones
    const thread = [];

    // Strategy 1: Each email in a thread lives in a .gs container (both expanded & collapsed)
    document.querySelectorAll('.gs').forEach(emailBlock => {
      // Sender from the header area
      const sender = emailBlock.querySelector('.gD[name]')?.getAttribute('name') ||
                     emailBlock.querySelector('.gD, [email]')?.textContent?.trim() ||
                     emailBlock.querySelector('.yP, .zF')?.getAttribute('name') ||
                     emailBlock.querySelector('.yP, .zF')?.textContent?.trim() || '';
      // Expanded email body
      let body = emailBlock.querySelector('.a3s.aiL, .ii.gt')?.textContent?.trim();
      // Collapsed email snippet (when thread is collapsed)
      if (!body || body.length < 5) {
        body = emailBlock.querySelector('.y2, .xT .y2, .snippet')?.textContent?.trim();
      }
      if (body && body.length > 5) {
        thread.push(`${sender || 'Unknown'}: ${body}`);
      }
    });

    // Strategy 2: Try the old selectors if .gs didn't work
    if (thread.length === 0) {
      document.querySelectorAll('.h7, .gE.iv.gt, .kv').forEach(emailBlock => {
        const sender = emailBlock.querySelector('.gD, [email]')?.getAttribute('name') ||
                       emailBlock.querySelector('.gD, [email]')?.textContent?.trim() || '';
        const bodyEl = emailBlock.querySelector('.a3s.aiL, .ii.gt');
        let body = bodyEl?.textContent?.trim();
        // For collapsed (.kv), grab snippet
        if (!body || body.length < 5) {
          body = emailBlock.querySelector('.y2, .snippet')?.textContent?.trim();
        }
        if (body && body.length > 5) {
          thread.push(`${sender || 'Unknown'}: ${body}`);
        }
      });
    }

    // Strategy 3: Grab all email body elements directly
    if (thread.length === 0) {
      document.querySelectorAll('.a3s.aiL, .ii.gt, [class*="gmail_default"], .adO').forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length > 10) thread.push(text);
      });
    }

    // Strategy 4: Last resort - grab the entire thread container text
    if (thread.length <= 1) {
      const threadContainer = document.querySelector('.AO, [role="list"], .Bs.nH .nH');
      if (threadContainer) {
        const fullText = threadContainer.innerText?.trim();
        if (fullText && fullText.length > 50 && fullText.length > (thread[0]?.length || 0) * 2) {
          // The full container has much more content - use it instead
          thread.length = 0;
          thread.push(fullText);
        }
      }
    }

    // Get subject
    const subject = document.querySelector('.hP, h2.hP')?.textContent?.trim() || '';
    // Get the first/external sender as contact name
    const allSenders = document.querySelectorAll('.gD[name]');
    let senderName = '';
    allSenders.forEach(el => {
      const name = el.getAttribute('name') || '';
      if (name && !senderName) senderName = name;
    });

    if (thread.length > 0) {
      return {
        type: 'email_thread',
        contactName: senderName,
        subject: subject,
        conversation: (subject ? `Subject: ${subject}\n\n` : '') + thread.join('\n\n---\n\n'),
        messageCount: thread.length
      };
    }

    return scrapeGeneric();
  }

  function scrapeInstagram() {
    // Instagram DMs
    const msgs = document.querySelectorAll('[role="row"], [class*="message"], div[dir="auto"]');
    const thread = [];

    msgs.forEach(msg => {
      const text = msg.textContent?.trim();
      if (text && text.length > 1 && text.length < 2000) {
        thread.push(text);
      }
    });

    if (thread.length > 2) {
      return {
        type: 'dm_thread',
        conversation: thread.slice(-30).join('\n\n'),
        messageCount: thread.length
      };
    }

    return scrapeGeneric();
  }

  function scrapeFacebook() {
    // Facebook/Messenger DMs
    const msgs = document.querySelectorAll('[role="row"] [dir="auto"], [data-scope="messages_table"] [dir="auto"]');
    const thread = [];

    msgs.forEach(msg => {
      const text = msg.textContent?.trim();
      if (text && text.length > 1 && text.length < 2000) {
        thread.push(text);
      }
    });

    if (thread.length > 2) {
      return {
        type: 'dm_thread',
        conversation: thread.slice(-30).join('\n\n'),
        messageCount: thread.length
      };
    }

    return scrapeGeneric();
  }

  function scrapeX() {
    // X/Twitter DMs
    const msgs = document.querySelectorAll('[data-testid="messageEntry"], [data-testid="tweetText"]');
    const thread = [];

    msgs.forEach(msg => {
      const text = msg.textContent?.trim();
      if (text && text.length > 1) thread.push(text);
    });

    if (thread.length > 0) {
      return {
        type: 'dm_thread',
        conversation: thread.slice(-30).join('\n\n'),
        messageCount: thread.length
      };
    }

    return scrapeGeneric();
  }

  function scrapeGeneric() {
    // Get main content area text
    const mainContent = document.querySelector('main, [role="main"], .content, #content, article');
    const text = (mainContent || document.body).innerText?.substring(0, 5000)?.trim();
    return {
      type: 'generic',
      conversation: text || '',
      messageCount: 0,
      rawHTML: (mainContent || document.body).innerHTML?.substring(0, 10000) || ''
    };
  }

  // =============================================
  // REVIO API — Fetch conversations via API
  // =============================================

  const REVIO_BASE = 'https://app.sbccrm.com/bld/api';

  function getRevioToken() {
    const match = document.cookie.split(';').find(c => c.trim().startsWith('token='));
    return match ? match.split('=').slice(1).join('=') : null;
  }

  function getRevioXsrf() {
    const match = document.cookie.split(';').find(c => c.trim().startsWith('XSRF-TOKEN='));
    return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
  }

  function revioHeaders() {
    const token = getRevioToken();
    if (!token) return null;
    const headers = {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json',
    };
    const xsrf = getRevioXsrf();
    if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;
    return headers;
  }

  function getRevioContactId() {
    const match = window.location.pathname.match(/\/inbox\/([a-f0-9]{24})/);
    return match ? match[1] : null;
  }

  async function fetchRevioContact(contactId) {
    const headers = revioHeaders();
    if (!headers) return null;
    try {
      const resp = await fetch(REVIO_BASE + '/contacts/' + contactId, { headers });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      console.log('[Pitho] Revio contact fetch error:', e.message);
      return null;
    }
  }

  async function fetchRevioMessages(contactId, maxPages) {
    maxPages = maxPages || 10;
    const headers = revioHeaders();
    if (!headers) return [];
    const allMessages = [];
    try {
      for (let page = 1; page <= maxPages; page++) {
        const resp = await fetch(REVIO_BASE + '/messages/' + contactId + '?page=' + page, { headers });
        if (!resp.ok) break;
        const data = await resp.json();
        if (!data.data || data.data.length === 0) break;
        allMessages.push.apply(allMessages, data.data);
      }
    } catch (e) {
      console.log('[Pitho] Revio messages fetch error:', e.message);
    }
    allMessages.sort(function(a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    return allMessages;
  }

  let _revioCache = { contactId: null, data: null, ts: 0 };
  const REVIO_CACHE_TTL = 10000;

  async function scrapeRevioAsync() {
    const contactId = getRevioContactId();
    if (!contactId) return scrapeGeneric();

    if (_revioCache.contactId === contactId && Date.now() - _revioCache.ts < REVIO_CACHE_TTL) {
      console.log('[Pitho] Using cached Revio data for', contactId);
      return _revioCache.data;
    }

    console.log('[Pitho] Fetching Revio data for contact:', contactId);

    const contact = await fetchRevioContact(contactId);
    const rawMessages = await fetchRevioMessages(contactId);

    const messages = rawMessages
      .filter(function(m) { return m.message_type === 'text' && m.text && m.timestamp && m.direction; })
      .map(function(m) {
        return {
          text: m.text,
          direction: m.direction,
          timestamp: m.timestamp,
          channel: m.channel || 'sms'
        };
      });

    if (messages.length === 0) {
      console.log('[Pitho] No Revio messages found, falling back to generic scraper');
      return scrapeGeneric();
    }

    // Build conversation text with clear labels
    const contactName = contact ? (contact.full_name || contact.name || '') : '';
    const thread = messages.map(function(m) {
      const sender = m.direction === 'received' ? (contactName || 'PROSPECT') : 'REP';
      const time = new Date(m.timestamp).toLocaleString();
      return sender + ' [' + time + ']: ' + m.text;
    });

    console.log('[Pitho] Revio API scraped', messages.length, 'messages for', contactName);

    const result = {
      type: 'dm_thread',
      contactName: contactName,
      contactId: contactId,
      conversation: thread.join('\n\n'),
      messageCount: messages.length,
      messages: messages,
      contactDetails: contact ? {
        stage: contact.stage || '',
        score: contact.rocket_selling_score || null,
        currentBox: contact.rocket_selling_current_box || null,
        channel: contact.channel || null,
        tags: contact.tags || [],
        notes: contact.ai_notes || ''
      } : null
    };
    _revioCache = { contactId: contactId, data: result, ts: Date.now() };
    return result;
  }

  // --- Send to service worker ---

  function sendToBackground(text, replyMode, fullPageData) {
    return new Promise((resolve, reject) => {
      if (!chrome.runtime || !chrome.runtime.id) {
        reject(new Error('Extension context invalid. Please reload the page.'));
        return;
      }

      const msg = {
        type: 'GET_REPLY',
        text: text,
        platform: detectPlatform(),
        replyMode: replyMode || 'auto',
        pageUrl: window.location.href,
        pageTitle: document.title,
        fullPage: fullPageData || null
      };

      console.log('[Pitho] Sending to background:', msg.type, msg.platform, msg.replyMode, fullPageData ? '(full page)' : '(selection)');

      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Pitho] lastError:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response) {
          reject(new Error('No response from background'));
          return;
        }

        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }
      });
    });
  }

  // --- Floating button bar (Reply + Analyze) ---

  function createFloatingBtn(x, y) {
    removeFloatingBtn();
    floatingBtn = document.createElement('div');
    floatingBtn.id = 'chatripper-float-btn';

    // Clamp position so it stays on screen (bar is ~560px wide with 4 buttons)
    const barWidth = 560;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampedX = Math.max(8, Math.min(x, vw - barWidth - 8));
    const clampedY = Math.max(8, Math.min(y + 8, vh - 50));

    floatingBtn.style.left = clampedX + 'px';
    floatingBtn.style.top = clampedY + 'px';

    floatingBtn.innerHTML = `
      <div class="chatripper-float-option" data-action="reply">
        <img src="${logoURL}" width="16" height="16" style="border-radius:3px;">
        <span>Reply</span>
      </div>
      <div class="chatripper-float-divider"></div>
      <div class="chatripper-float-option" data-action="analyze">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <span>Analyze & Reply</span>
      </div>
      <div class="chatripper-float-divider"></div>
      <div class="chatripper-float-option" data-action="analyze-chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>Analyze & Chat</span>
      </div>
      <div class="chatripper-float-divider"></div>
      <div class="chatripper-float-option" data-action="analyze-score">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        <span>Analyze & Score</span>
      </div>`;

    floatingBtn.querySelector('[data-action="reply"]').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      currentInputMode = 'select';
      requestReply(currentSelection, 'auto');
    });

    floatingBtn.querySelector('[data-action="analyze"]').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      currentInputMode = 'analyze';
      requestAnalyzeReply();
    });

    floatingBtn.querySelector('[data-action="analyze-chat"]').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestAnalyzeChat();
    });

    floatingBtn.querySelector('[data-action="analyze-score"]').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestAnalyzeScore();
    });

    document.body.appendChild(floatingBtn);
    setTimeout(() => { if (floatingBtn && !replyPanel && !loaderPill) removeFloatingBtn(); }, 5000);
  }

  function removeFloatingBtn() {
    if (floatingBtn) { floatingBtn.remove(); floatingBtn = null; }
  }

  // --- Selection highlight (overlay-based, works on cross-element selections) ---

  let highlightOverlays = [];

  function highlightSelection() {
    removeHighlight();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    if (!rects || rects.length === 0) return;

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r.width < 2 || r.height < 2) continue;
      const overlay = document.createElement('div');
      overlay.className = 'chatripper-highlight-overlay';
      overlay.style.position = 'absolute';
      overlay.style.left = (r.left + window.scrollX) + 'px';
      overlay.style.top = (r.top + window.scrollY) + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
      overlay.style.pointerEvents = 'none';
      document.body.appendChild(overlay);
      highlightOverlays.push(overlay);
    }
  }

  function removeHighlight() {
    highlightOverlays.forEach(o => o.remove());
    highlightOverlays = [];
  }

  // --- Loader pill ---

  function createLoaderPill(x, y) {
    removeLoader();
    loaderPill = document.createElement('div');
    loaderPill.id = 'chatripper-loader-pill';

    const shuffled = getShuffledStatus();
    const platform = getPlatformLabel();
    const platformTag = platform ? `<span class="chatripper-pill-platform">${platform}</span>` : '';
    const modeTag = currentInputMode === 'analyze' ? `<span class="chatripper-pill-mode">Full Page</span>` : '';

    loaderPill.innerHTML = `
      <div class="chatripper-pill-inner">
        <img class="chatripper-pill-gif" src="${loaderGifURL}" alt="">
        <span class="chatripper-pill-text">${shuffled[0]}</span>
        ${platformTag}${modeTag}
      </div>`;

    loaderPill.style.left = x + 'px';
    loaderPill.style.top = (y + 8) + 'px';
    document.body.appendChild(loaderPill);

    let idx = 0;
    const textEl = loaderPill.querySelector('.chatripper-pill-text');
    statusInterval = setInterval(() => {
      idx = (idx + 1) % shuffled.length;
      if (textEl) {
        textEl.style.opacity = '0';
        textEl.style.transform = 'translateY(4px)';
        setTimeout(() => {
          textEl.textContent = shuffled[idx];
          textEl.style.opacity = '1';
          textEl.style.transform = 'translateY(0)';
        }, 150);
      }
    }, 2200);
  }

  function removeLoader() {
    if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
    if (loaderPill) { loaderPill.remove(); loaderPill = null; }
  }

  // --- Reply panel ---

  function createReplyPanel(x, y) {
    removeReplyPanel();
    replyPanel = document.createElement('div');
    replyPanel.id = 'chatripper-reply-panel';

    const platform = getPlatformLabel();
    const platformTag = platform ? `<span class="chatripper-header-platform">${platform}</span>` : '';

    replyPanel.innerHTML = `
      <div class="chatripper-panel-header">
        <div class="chatripper-panel-title"><img class="chatripper-logo" src="${logoURL}" alt="C"> Pitho ${platformTag}</div>
        <div class="chatripper-header-actions">
          <button class="chatripper-analyze-btn" title="Analyze full page"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button>
          <button class="chatripper-expand-btn" title="Open in side panel"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg></button>
          <button class="chatripper-panel-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="chatripper-mode-bar">
        <button class="chatripper-mode-btn${currentReplyMode === 'auto' ? ' active' : ''}" data-mode="auto">Auto</button>
        <button class="chatripper-mode-btn${currentReplyMode === 'objection' ? ' active' : ''}" data-mode="objection">Objection</button>
        <button class="chatripper-mode-btn${currentReplyMode === 'follow_up' ? ' active' : ''}" data-mode="follow_up">Follow Up</button>
        <button class="chatripper-mode-btn${currentReplyMode === 'close' ? ' active' : ''}" data-mode="close">Close</button>
        <button class="chatripper-mode-btn${currentReplyMode === 're_engage' ? ' active' : ''}" data-mode="re_engage">Re-engage</button>
      </div>
      <div class="chatripper-panel-body"></div>`;

    const vw = window.innerWidth, vh = window.innerHeight;
    replyPanel.style.left = Math.max(10, Math.min(x, vw - 380)) + 'px';
    replyPanel.style.top = Math.max(10, Math.min(y + 10, vh - 350)) + 'px';

    makeDraggable(replyPanel, replyPanel.querySelector('.chatripper-panel-header'));
    replyPanel.querySelector('.chatripper-panel-close').addEventListener('click', removeReplyPanel);
    replyPanel.querySelector('.chatripper-expand-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    });
    replyPanel.querySelector('.chatripper-analyze-btn').addEventListener('click', () => {
      currentInputMode = 'analyze';
      const rect = replyPanel.getBoundingClientRect();
      removeReplyPanel();
      requestAnalyzeReply(rect.left, rect.top);
    });
    replyPanel.querySelectorAll('.chatripper-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === currentReplyMode) return;
        replyPanel.querySelectorAll('.chatripper-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentReplyMode = mode;
        const rect = replyPanel.getBoundingClientRect();
        removeReplyPanel();
        createLoaderPill(rect.left, rect.top);
        if (currentInputMode === 'analyze') {
          doAnalyzeRequest(mode);
        } else {
          highlightSelection();
          doRequest(currentSelection, mode, rect.left, rect.top);
        }
      });
    });
    document.body.appendChild(replyPanel);
  }

  function makeDraggable(el, handle) {
    let sx = 0, sy = 0, dragging = false;
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('.chatripper-panel-close') || e.target.closest('.chatripper-expand-btn') || e.target.closest('.chatripper-analyze-btn')) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      handle.style.cursor = 'grabbing';
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      e.preventDefault();
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      const rect = el.getBoundingClientRect();
      el.style.left = (rect.left + window.scrollX + dx) + 'px';
      el.style.top = (rect.top + window.scrollY + dy) + 'px';
      sx = e.clientX;
      sy = e.clientY;
    }, true);
    document.addEventListener('mouseup', () => {
      if (dragging) { dragging = false; handle.style.cursor = 'grab'; }
    }, true);
  }

  // --- Track last focused input for Insert feature ---

  function isInputElement(el) {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'textarea' || (tag === 'input' && el.type !== 'hidden')) return true;
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
    if (el.getAttribute('role') === 'textbox') return true;
    return false;
  }

  document.addEventListener('focusin', (e) => {
    if (e.target.closest('#chatripper-reply-panel') || e.target.closest('#chatripper-float-btn')) return;
    if (isInputElement(e.target)) {
      lastFocusedInput = e.target;
    }
  }, true);

  // Try to find the main chat input on the page
  function findChatInput() {
    // 1. Check lastFocusedInput first
    if (lastFocusedInput && document.body.contains(lastFocusedInput)) return lastFocusedInput;

    // 2. Common chat textareas (by placeholder or role)
    const selectors = [
      'textarea[placeholder*="type a message" i]',
      'textarea[placeholder*="press R" i]',
      'textarea[placeholder*="write a message" i]',
      'textarea[placeholder*="send a message" i]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-placeholder]',
      'div.msg-form__contenteditable[contenteditable="true"]',      // LinkedIn
      'div[aria-label*="message" i][contenteditable="true"]',       // Gmail / generic
      'p.selectable-text[contenteditable]',                          // WhatsApp Web
      'textarea.custom-scrollbar',                                   // SBC / Revio style
      'div[role="textbox"][contenteditable="true"]',
      'textarea'                                                     // last resort: any textarea
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function insertIntoInput(text, replace) {
    const el = findChatInput();
    if (!el) return false;

    // Focus the element first
    el.focus();

    const tag = el.tagName?.toLowerCase();

    // For textarea / input
    if (tag === 'textarea' || tag === 'input') {
      if (replace) {
        // Replace entire content (used by hotkey cycling)
        el.value = text;
        el.selectionStart = el.selectionEnd = text.length;
      } else {
        // Insert at cursor (used by manual Insert button click)
        const start = el.selectionStart || 0;
        const end = el.selectionEnd || 0;
        const before = el.value.substring(0, start);
        const after = el.value.substring(end);
        el.value = before + text + after;
        el.selectionStart = el.selectionEnd = start + text.length;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // For contenteditable (LinkedIn, Gmail, Instagram, etc.)
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') {
      el.focus();

      // Convert newlines to <br> for proper formatting in contenteditable
      const html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

      // Select all existing content and replace with formatted HTML
      if (document.execCommand('selectAll', false, null)) {
        document.execCommand('insertHTML', false, html);
      } else {
        el.innerHTML = html;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    return false;
  }

  function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  function showReply(response) {
    if (!replyPanel) return;
    const body = replyPanel.querySelector('.chatripper-panel-body');
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

    let html = '';
    if (analysis) {
      html += `<div class="chatripper-analysis">
        <div class="chatripper-analysis-row"><span class="chatripper-analysis-label">Stage</span><span class="chatripper-analysis-value">${esc(analysis.stage || '')}</span></div>
        <div class="chatripper-analysis-row"><span class="chatripper-analysis-label">Energy</span><span class="chatripper-analysis-value">${esc(analysis.energy || '')}</span></div>
        <div class="chatripper-analysis-row"><span class="chatripper-analysis-label">Read</span><span class="chatripper-analysis-value">${esc(analysis.realMeaning || '')}</span></div>
      </div>`;
    }
    html += '<div class="chatripper-messages">';
    messages.forEach((msg, i) => {
      html += `<div class="chatripper-message-block">
        <div class="chatripper-message-label">Message ${i + 1}</div>
        <div class="chatripper-message-text">${esc(msg)}</div>
        <div class="chatripper-message-actions">
          <button class="chatripper-copy-btn" data-idx="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>
          <button class="chatripper-insert-btn" data-idx="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg> Insert</button>
        </div>
      </div>`;
    });
    html += `<div class="chatripper-bottom-actions">
      <button class="chatripper-copy-all-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy All</button>
      <button class="chatripper-insert-all-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg> Insert All</button>
    </div></div>`;
    if (reasoning) {
      html += `<div class="chatripper-reasoning"><div class="chatripper-reasoning-label">Why this works</div><div class="chatripper-reasoning-text">${esc(reasoning)}</div></div>`;
    }
    body.innerHTML = html;

    const copyIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const insertIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>';

    body.querySelectorAll('.chatripper-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(messages[parseInt(btn.dataset.idx)]).then(() => {
          btn.textContent = 'Copied!'; btn.style.color = '#22c55e';
          setTimeout(() => { btn.innerHTML = copyIcon + ' Copy'; btn.style.color = ''; }, 1500);
        });
      });
    });

    body.querySelectorAll('.chatripper-insert-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ok = insertIntoInput(messages[parseInt(btn.dataset.idx)]);
        if (ok) {
          btn.textContent = 'Inserted!'; btn.style.color = '#22c55e';
          setTimeout(() => { btn.innerHTML = insertIcon + ' Insert'; btn.style.color = ''; }, 1500);
        } else {
          btn.textContent = 'Click an input first'; btn.style.color = '#f87171';
          setTimeout(() => { btn.innerHTML = insertIcon + ' Insert'; btn.style.color = ''; }, 2000);
        }
      });
    });

    const cab = body.querySelector('.chatripper-copy-all-btn');
    if (cab) cab.addEventListener('click', () => {
      navigator.clipboard.writeText(messages.join('\n\n')).then(() => {
        cab.textContent = 'Copied all!'; cab.style.color = '#22c55e';
        setTimeout(() => { cab.innerHTML = copyIcon + ' Copy All'; cab.style.color = ''; }, 1500);
      });
    });

    const iab = body.querySelector('.chatripper-insert-all-btn');
    if (iab) iab.addEventListener('click', () => {
      const ok = insertIntoInput(messages.join('\n\n'));
      if (ok) {
        iab.textContent = 'Inserted!'; iab.style.color = '#22c55e';
        setTimeout(() => { iab.innerHTML = insertIcon + ' Insert All'; iab.style.color = ''; }, 1500);
      } else {
        iab.textContent = 'Click an input first'; iab.style.color = '#f87171';
        setTimeout(() => { iab.innerHTML = insertIcon + ' Insert All'; iab.style.color = ''; }, 2000);
      }
    });
  }

  function showError(msg) {
    if (!replyPanel) return;
    const body = replyPanel.querySelector('.chatripper-panel-body');
    body.innerHTML = `<div class="chatripper-error"><span>Something went wrong</span><p>${esc(msg)}</p><button class="chatripper-retry-btn">Try Again</button></div>`;
    body.querySelector('.chatripper-retry-btn').addEventListener('click', () => {
      if (currentInputMode === 'analyze') requestAnalyzeReply();
      else requestReply(currentSelection, currentReplyMode);
    });
  }

  function removeReplyPanel() {
    if (replyPanel) { replyPanel.remove(); replyPanel = null; }
  }

  // --- Core requests ---

  function handleResult(result, x, y) {
    removeLoader();
    removeHighlight();
    createReplyPanel(x || 100, y || 100);
    showReply(result);
  }

  function handleError(err, x, y) {
    removeLoader();
    removeHighlight();
    createReplyPanel(x || 100, y || 100);
    showError(err.message);
  }

  function doRequest(text, replyMode, savedX, savedY) {
    const platform = detectPlatform();
    const x = savedX || 100;
    const y = savedY || 100;

    if (platform === 'revio') {
      scrapeRevioAsync().then(function(scraped) {
        sendToBackground(text, replyMode, scraped)
          .then(result => handleResult(result, x, y))
          .catch(err => handleError(err, x, y));
      }).catch(function() {
        // Fallback to plain text if Revio fetch fails
        sendToBackground(text, replyMode)
          .then(result => handleResult(result, x, y))
          .catch(err => handleError(err, x, y));
      });
      return;
    }

    sendToBackground(text, replyMode)
      .then(result => {
        console.log('[Pitho] Success:', result.structured ? 'structured' : 'plain');
        handleResult(result, x, y);
      })
      .catch(err => {
        console.error('[Pitho] Failed:', err.message);
        handleError(err, x, y);
      });
  }

  function doAnalyzeRequest(replyMode) {
    const platform = detectPlatform();
    const x = window.innerWidth / 2 - 190;
    const y = 80;

    if (platform === 'revio') {
      scrapeRevioAsync().then(function(scraped) {
        console.log('[Pitho] Revio analyze scraped:', scraped.type, 'messages:', scraped.messageCount);
        if (currentSelection && currentSelection.length > 5) {
          scraped.highlightedText = currentSelection;
        }
        sendToBackground(scraped.conversation, replyMode || 'auto', scraped)
          .then(result => handleResult(result, x, y))
          .catch(err => handleError(err, x, y));
      }).catch(function() {
        // Fallback to generic scraper
        const scraped = scrapePageContent();
        if (currentSelection && currentSelection.length > 5) {
          scraped.highlightedText = currentSelection;
        }
        sendToBackground(scraped.conversation, replyMode || 'auto', scraped)
          .then(result => handleResult(result, x, y))
          .catch(err => handleError(err, x, y));
      });
      return;
    }

    const scraped = scrapePageContent();
    console.log('[Pitho] Scraped page:', scraped.type, 'messages:', scraped.messageCount);

    if (currentSelection && currentSelection.length > 5) {
      scraped.highlightedText = currentSelection;
    }

    sendToBackground(scraped.conversation, replyMode || 'auto', scraped)
      .then(result => {
        console.log('[Pitho] Analyze success:', result.structured ? 'structured' : 'plain');
        handleResult(result, x, y);
      })
      .catch(err => {
        console.error('[Pitho] Analyze failed:', err.message);
        handleError(err, x, y);
      });
  }

  function requestReply(text, replyMode) {
    removeFloatingBtn();
    removeReplyPanel();
    currentReplyMode = replyMode || 'auto';
    currentInputMode = 'select';

    const sel = window.getSelection();
    let x = 100, y = 100;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        x = r.left + (r.width / 2) - 100;
        y = r.bottom;
      }
    }

    // Save position for when response arrives (selection may be lost by then)
    const savedX = x, savedY = y;
    highlightSelection();
    createLoaderPill(x, y);
    doRequest(text, replyMode, savedX, savedY);
  }

  function requestAnalyzeReply(x, y) {
    removeFloatingBtn();
    removeReplyPanel();
    currentReplyMode = 'auto';
    currentInputMode = 'analyze';

    const px = x || (window.innerWidth / 2 - 100);
    const py = y || 80;

    createLoaderPill(px, py);
    doAnalyzeRequest('auto');
  }

  function requestAnalyzeChat() {
    removeFloatingBtn();
    removeReplyPanel();

    // Scrape the page using existing scrapers
    const scraped = scrapePageContent();
    console.log('[Pitho] Analyze & Chat scraped:', scraped.type, 'messages:', scraped.messageCount);

    // Include highlighted text
    if (currentSelection && currentSelection.length > 5) {
      scraped.highlightedText = currentSelection;
    }

    // Send to service worker to open side panel + initiate chat
    chrome.runtime.sendMessage({
      type: 'ANALYZE_CHAT',
      platform: detectPlatform(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      scrapedData: scraped,
      selectedText: currentSelection || ''
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Pitho] Analyze & Chat error:', chrome.runtime.lastError.message);
      }
    });
  }

  function requestAnalyzeScore() {
    removeFloatingBtn();
    removeReplyPanel();

    const scraped = scrapePageContent();
    console.log('[Pitho] Analyze & Score scraped:', scraped.type, 'messages:', scraped.messageCount);

    if (currentSelection && currentSelection.length > 5) {
      scraped.highlightedText = currentSelection;
    }

    chrome.runtime.sendMessage({
      type: 'ANALYZE_SCORE',
      platform: detectPlatform(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      scrapedData: scraped,
      selectedText: currentSelection || ''
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Pitho] Analyze & Score error:', chrome.runtime.lastError.message);
      }
    });
  }

  // --- Selection listener (floating button disabled — side panel auto-analyzes) ---

  document.addEventListener('mouseup', (e) => {
    if (!enabled) return;
    if (e.target.closest('#chatripper-reply-panel') || e.target.closest('#chatripper-loader-pill')) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (text && text.length > 10) {
        currentSelection = text;
      }
    }, 10);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CONTEXT_MENU_REPLY') {
      currentSelection = message.text;
      currentInputMode = 'select';
      requestReply(message.text, 'auto');
    }

    // Side panel asks us to insert text into the page input
    if (message.type === 'INSERT_TEXT') {
      const ok = insertIntoInput(message.text, message.replace);
      sendResponse({ success: ok });
      return true;
    }

    // Side panel asks us to scrape the current page
    if (message.type === 'SCRAPE_PAGE') {
      const platform = detectPlatform();

      // Revio uses async API calls — handle separately
      if (platform === 'revio') {
        scrapeRevioAsync().then(function(scraped) {
          sendResponse({
            success: true,
            data: scraped,
            platform: 'revio',
            pageUrl: window.location.href,
            pageTitle: document.title,
            selectedText: currentSelection || ''
          });
        }).catch(function(err) {
          console.error('[Pitho] Revio scrape error:', err);
          // Fallback to generic scraper
          const scraped = scrapeGeneric();
          sendResponse({
            success: true,
            data: scraped,
            platform: 'revio',
            pageUrl: window.location.href,
            pageTitle: document.title,
            selectedText: currentSelection || ''
          });
        });
        return true; // Keep sendResponse channel open for async
      }

      // All other platforms — synchronous scraping
      const scraped = scrapePageContent();
      sendResponse({
        success: true,
        data: scraped,
        platform: platform,
        pageUrl: window.location.href,
        pageTitle: document.title,
        selectedText: currentSelection || ''
      });
      return true;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!enabled) return;
    // Ctrl+Shift+K = reply to selection
    if (e.ctrlKey && e.shiftKey && e.key === 'K') {
      e.preventDefault();
      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.length > 5) { currentSelection = sel; currentInputMode = 'select'; requestReply(sel, 'auto'); }
    }
    // Ctrl+Shift+L = analyze full page
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      e.preventDefault();
      currentInputMode = 'analyze';
      requestAnalyzeReply();
    }
    // Ctrl+Shift+J = analyze & chat
    if (e.ctrlKey && e.shiftKey && e.key === 'J') {
      e.preventDefault();
      requestAnalyzeChat();
    }
    // Ctrl+Shift+U = analyze & score
    if (e.ctrlKey && e.shiftKey && e.key === 'U') {
      e.preventDefault();
      requestAnalyzeScore();
    }
  });
})();
