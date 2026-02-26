// HackExt Extension - Content Script

(function () {
  'use strict';

  console.log('[HackExt] Loaded on', window.location.hostname);

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
    return 'other';
  }

  function getPlatformLabel() {
    const p = detectPlatform();
    const labels = { linkedin: 'LinkedIn', gmail: 'Gmail', salesforce: 'Salesforce', hubspot: 'HubSpot', instagram: 'Instagram', facebook: 'Facebook', x: 'X', other: null };
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
      console.log('[HackExt] Scrape error, falling back to generic:', e.message);
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

      console.log('[HackExt] Sending to background:', msg.type, msg.platform, msg.replyMode, fullPageData ? '(full page)' : '(selection)');

      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[HackExt] lastError:', chrome.runtime.lastError.message);
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
    floatingBtn.id = 'hackext-float-btn';

    // Clamp position so it stays on screen (bar is ~560px wide with 4 buttons)
    const barWidth = 560;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampedX = Math.max(8, Math.min(x, vw - barWidth - 8));
    const clampedY = Math.max(8, Math.min(y + 8, vh - 50));

    floatingBtn.style.left = clampedX + 'px';
    floatingBtn.style.top = clampedY + 'px';

    floatingBtn.innerHTML = `
      <div class="hackext-float-option" data-action="reply">
        <img src="${logoURL}" width="16" height="16" style="border-radius:3px;">
        <span>Reply</span>
      </div>
      <div class="hackext-float-divider"></div>
      <div class="hackext-float-option" data-action="analyze">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <span>Analyze & Reply</span>
      </div>
      <div class="hackext-float-divider"></div>
      <div class="hackext-float-option" data-action="analyze-chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>Analyze & Chat</span>
      </div>
      <div class="hackext-float-divider"></div>
      <div class="hackext-float-option" data-action="analyze-score">
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
      overlay.className = 'hackext-highlight-overlay';
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
    loaderPill.id = 'hackext-loader-pill';

    const shuffled = getShuffledStatus();
    const platform = getPlatformLabel();
    const platformTag = platform ? `<span class="hackext-pill-platform">${platform}</span>` : '';
    const modeTag = currentInputMode === 'analyze' ? `<span class="hackext-pill-mode">Full Page</span>` : '';

    loaderPill.innerHTML = `
      <div class="hackext-pill-inner">
        <img class="hackext-pill-gif" src="${loaderGifURL}" alt="">
        <span class="hackext-pill-text">${shuffled[0]}</span>
        ${platformTag}${modeTag}
      </div>`;

    loaderPill.style.left = x + 'px';
    loaderPill.style.top = (y + 8) + 'px';
    document.body.appendChild(loaderPill);

    let idx = 0;
    const textEl = loaderPill.querySelector('.hackext-pill-text');
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
    replyPanel.id = 'hackext-reply-panel';

    const platform = getPlatformLabel();
    const platformTag = platform ? `<span class="hackext-header-platform">${platform}</span>` : '';

    replyPanel.innerHTML = `
      <div class="hackext-panel-header">
        <div class="hackext-panel-title"><img class="hackext-logo" src="${logoURL}" alt="C"> HackExt ${platformTag}</div>
        <div class="hackext-header-actions">
          <button class="hackext-analyze-btn" title="Analyze full page"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button>
          <button class="hackext-expand-btn" title="Open in side panel"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg></button>
          <button class="hackext-panel-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="hackext-mode-bar">
        <button class="hackext-mode-btn${currentReplyMode === 'auto' ? ' active' : ''}" data-mode="auto">Auto</button>
        <button class="hackext-mode-btn${currentReplyMode === 'objection' ? ' active' : ''}" data-mode="objection">Objection</button>
        <button class="hackext-mode-btn${currentReplyMode === 'follow_up' ? ' active' : ''}" data-mode="follow_up">Follow Up</button>
        <button class="hackext-mode-btn${currentReplyMode === 'close' ? ' active' : ''}" data-mode="close">Close</button>
        <button class="hackext-mode-btn${currentReplyMode === 're_engage' ? ' active' : ''}" data-mode="re_engage">Re-engage</button>
      </div>
      <div class="hackext-panel-body"></div>`;

    const vw = window.innerWidth, vh = window.innerHeight;
    replyPanel.style.left = Math.max(10, Math.min(x, vw - 380)) + 'px';
    replyPanel.style.top = Math.max(10, Math.min(y + 10, vh - 350)) + 'px';

    makeDraggable(replyPanel, replyPanel.querySelector('.hackext-panel-header'));
    replyPanel.querySelector('.hackext-panel-close').addEventListener('click', removeReplyPanel);
    replyPanel.querySelector('.hackext-expand-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
    });
    replyPanel.querySelector('.hackext-analyze-btn').addEventListener('click', () => {
      currentInputMode = 'analyze';
      const rect = replyPanel.getBoundingClientRect();
      removeReplyPanel();
      requestAnalyzeReply(rect.left, rect.top);
    });
    replyPanel.querySelectorAll('.hackext-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === currentReplyMode) return;
        replyPanel.querySelectorAll('.hackext-mode-btn').forEach(b => b.classList.remove('active'));
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
      if (e.target.closest('.hackext-panel-close') || e.target.closest('.hackext-expand-btn') || e.target.closest('.hackext-analyze-btn')) return;
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
    if (e.target.closest('#hackext-reply-panel') || e.target.closest('#hackext-float-btn')) return;
    if (isInputElement(e.target)) {
      lastFocusedInput = e.target;
    }
  }, true);

  function insertIntoInput(text) {
    const el = lastFocusedInput;
    if (!el) return false;

    // Focus the element first
    el.focus();

    const tag = el.tagName?.toLowerCase();

    // For textarea / input
    if (tag === 'textarea' || tag === 'input') {
      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;
      const before = el.value.substring(0, start);
      const after = el.value.substring(end);
      el.value = before + text + after;
      el.selectionStart = el.selectionEnd = start + text.length;
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
    const body = replyPanel.querySelector('.hackext-panel-body');
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
      html += `<div class="hackext-analysis">
        <div class="hackext-analysis-row"><span class="hackext-analysis-label">Stage</span><span class="hackext-analysis-value">${esc(analysis.stage || '')}</span></div>
        <div class="hackext-analysis-row"><span class="hackext-analysis-label">Energy</span><span class="hackext-analysis-value">${esc(analysis.energy || '')}</span></div>
        <div class="hackext-analysis-row"><span class="hackext-analysis-label">Read</span><span class="hackext-analysis-value">${esc(analysis.realMeaning || '')}</span></div>
      </div>`;
    }
    html += '<div class="hackext-messages">';
    messages.forEach((msg, i) => {
      html += `<div class="hackext-message-block">
        <div class="hackext-message-label">Message ${i + 1}</div>
        <div class="hackext-message-text">${esc(msg)}</div>
        <div class="hackext-message-actions">
          <button class="hackext-copy-btn" data-idx="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>
          <button class="hackext-insert-btn" data-idx="${i}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg> Insert</button>
        </div>
      </div>`;
    });
    html += `<div class="hackext-bottom-actions">
      <button class="hackext-copy-all-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy All</button>
      <button class="hackext-insert-all-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg> Insert All</button>
    </div></div>`;
    if (reasoning) {
      html += `<div class="hackext-reasoning"><div class="hackext-reasoning-label">Why this works</div><div class="hackext-reasoning-text">${esc(reasoning)}</div></div>`;
    }
    body.innerHTML = html;

    const copyIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const insertIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>';

    body.querySelectorAll('.hackext-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(messages[parseInt(btn.dataset.idx)]).then(() => {
          btn.textContent = 'Copied!'; btn.style.color = '#22c55e';
          setTimeout(() => { btn.innerHTML = copyIcon + ' Copy'; btn.style.color = ''; }, 1500);
        });
      });
    });

    body.querySelectorAll('.hackext-insert-btn').forEach(btn => {
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

    const cab = body.querySelector('.hackext-copy-all-btn');
    if (cab) cab.addEventListener('click', () => {
      navigator.clipboard.writeText(messages.join('\n\n')).then(() => {
        cab.textContent = 'Copied all!'; cab.style.color = '#22c55e';
        setTimeout(() => { cab.innerHTML = copyIcon + ' Copy All'; cab.style.color = ''; }, 1500);
      });
    });

    const iab = body.querySelector('.hackext-insert-all-btn');
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
    const body = replyPanel.querySelector('.hackext-panel-body');
    body.innerHTML = `<div class="hackext-error"><span>Something went wrong</span><p>${esc(msg)}</p><button class="hackext-retry-btn">Try Again</button></div>`;
    body.querySelector('.hackext-retry-btn').addEventListener('click', () => {
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
    sendToBackground(text, replyMode)
      .then(result => {
        console.log('[HackExt] Success:', result.structured ? 'structured' : 'plain');
        // Use saved position — selection is often lost by the time response arrives
        handleResult(result, savedX || 100, savedY || 100);
      })
      .catch(err => {
        console.error('[HackExt] Failed:', err.message);
        handleError(err, savedX || 100, savedY || 100);
      });
  }

  function doAnalyzeRequest(replyMode) {
    const scraped = scrapePageContent();
    console.log('[HackExt] Scraped page:', scraped.type, 'messages:', scraped.messageCount);

    // Include highlighted text so the agent knows what the rep is focused on
    if (currentSelection && currentSelection.length > 5) {
      scraped.highlightedText = currentSelection;
    }

    sendToBackground(scraped.conversation, replyMode || 'auto', scraped)
      .then(result => {
        console.log('[HackExt] Analyze success:', result.structured ? 'structured' : 'plain');
        const vw = window.innerWidth;
        handleResult(result, vw / 2 - 190, 80);
      })
      .catch(err => {
        console.error('[HackExt] Analyze failed:', err.message);
        handleError(err, window.innerWidth / 2 - 190, 80);
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
    console.log('[HackExt] Analyze & Chat scraped:', scraped.type, 'messages:', scraped.messageCount);

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
        console.error('[HackExt] Analyze & Chat error:', chrome.runtime.lastError.message);
      }
    });
  }

  function requestAnalyzeScore() {
    removeFloatingBtn();
    removeReplyPanel();

    const scraped = scrapePageContent();
    console.log('[HackExt] Analyze & Score scraped:', scraped.type, 'messages:', scraped.messageCount);

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
        console.error('[HackExt] Analyze & Score error:', chrome.runtime.lastError.message);
      }
    });
  }

  // --- Selection listener ---

  document.addEventListener('mouseup', (e) => {
    if (!enabled) return;
    if (e.target.closest('#hackext-float-btn') || e.target.closest('#hackext-reply-panel') || e.target.closest('#hackext-loader-pill')) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (text && text.length > 10) {
        currentSelection = text;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        createFloatingBtn(rect.left + (rect.width / 2) - 280, rect.bottom);
      } else if (!e.target.closest('#hackext-reply-panel')) {
        removeFloatingBtn();
      }
    }, 10);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONTEXT_MENU_REPLY') {
      currentSelection = message.text;
      currentInputMode = 'select';
      requestReply(message.text, 'auto');
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
