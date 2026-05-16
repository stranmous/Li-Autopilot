// ─── LiAutopilot · connect.js ────────────────────────────────────────────────
// Handles the Auto Connect module.
// Runs on LinkedIn search results pages, finds Connect buttons, clicks them.

window.LiAP = window.LiAP || {};

LiAP.Connect = (() => {
  let running = false;
  let actionCount = 0; // actions this session (for reading-pause cadence)
  const processedButtons = new WeakSet();

  // ── Selectors (centralised — update here if LinkedIn changes DOM) ──────────
  const SEL = {
    connectPage:      'https://www.linkedin.com/mynetwork/grow/',
    cardContainers: [
      '.mn-pymk-list__card',
      '.discover-person-card',
      '.discover-entity-type-card',
      '.artdeco-card',
      'li',
      'article'
    ],
    connectBtn: [
      'button[aria-label^="Connect with"]',
      'button[aria-label^="Invite"]',
      'button[aria-label*="Connect"]',
      'button span.artdeco-button__text',
      '.artdeco-button--secondary[aria-label*="Connect"]',
      '.artdeco-button[aria-label*="Connect"]'
    ],
    modalRoot: '.artdeco-modal, .send-invite, .artdeco-modal-overlay',
    addNoteBtn:    'button[aria-label="Add a note"]',
    sendWithoutNoteBtn: 'button[aria-label="Send without a note"]',
    noteTextarea:  '#custom-message',
    sendNoteBtn:   'button[aria-label="Send invitation"]',
    modalDismiss:  'button[aria-label="Dismiss"]',
    moreBtn:       'button[aria-label^="More actions for"]'
  };

  const findInScope = (scope, selectors) => {
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (el) {
        return el;
      }
    }
    return null;
  };

  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };

  const buttonText = (el) => (el?.innerText || el?.textContent || '').trim();

  const isConnectAction = (el) => {
    const text = buttonText(el).toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    if (!text && !aria) return false;
    if (text.includes('send without') || text.includes('add a note')) return false;
    if (aria.includes('send without') || aria.includes('add a note')) return false;
    return text.includes('connect') || aria.includes('connect') || aria.includes('invite');
  };

  const getCardForElement = (el) => {
    for (const sel of SEL.cardContainers) {
      const card = el.closest(sel);
      if (card) return card;
    }
    return el.parentElement;
  };

  // ── Check if a card is already connected/pending ──────────────────────────
  const isAlreadyConnected = (card) => {
    const text = card.innerText || '';
    return (
      text.includes('Pending') ||
      text.includes('Message') ||
      text.includes('1st') ||
      text.includes('Following') ||
      card.querySelector('button[aria-label^="Message"]') !== null
    );
  };

  // ── Get person name from card ─────────────────────────────────────────────
  const getPersonName = (card) => {
    const el = card.querySelector('.entity-result__title-text a span[aria-hidden]') ||
               card.querySelector('.discover-person-card__name') ||
               card.querySelector('.app-aware-link span[aria-hidden]') ||
               card.querySelector('a span[aria-hidden]');
    return el ? el.innerText.trim().split('\n')[0] : 'this person';
  };

  // ── Build personalised note ───────────────────────────────────────────────
  const buildNote = (name, settings) => {
    if (!settings.sendNote) return null;
    const template = settings.noteTemplate ||
      `Hi {name}, I came across your profile and would love to connect and expand our networks!`;
    return template.replace('{name}', name.split(' ')[0]);
  };

  // ── Handle the Connect modal (note or send directly) ─────────────────────
  const handleModal = async (name, settings) => {
    await LiAP.sleep(800);

    const note = buildNote(name, settings);

    if (note) {
      const addNoteEl = document.querySelector(SEL.addNoteBtn);
      if (addNoteEl) {
        await LiAP.click(addNoteEl);
        await LiAP.sleep(600);
        const textarea = await LiAP.waitFor(SEL.noteTextarea, 4000).catch(() => null);
        if (textarea) {
          await LiAP.fill(textarea, note.slice(0, 300)); // LinkedIn 300 char limit
          await LiAP.sleep(400);
        }
        const sendBtn = document.querySelector(SEL.sendNoteBtn);
        if (sendBtn) {
          await LiAP.click(sendBtn);
          return true;
        }
      }
    }

    // Send without note
    const sendWithout = document.querySelector(SEL.sendWithoutNoteBtn);
    if (sendWithout) {
      await LiAP.click(sendWithout);
      return true;
    }

    // Fallback: dismiss modal
    const dismiss = document.querySelector(SEL.modalDismiss);
    if (dismiss) await LiAP.click(dismiss);
    return false;
  };

  const findVisibleConnectButtons = () => {
    const allButtons = [...document.querySelectorAll('button')].filter(isVisible);
    return allButtons.filter((btn) => {
      if (processedButtons.has(btn) || btn.disabled || !isConnectAction(btn)) {
        return false;
      }

      const card = getCardForElement(btn);
      if (!card || isAlreadyConnected(card)) {
        return false;
      }

      return true;
    });
  };

  const getButtonDiagnostics = () => {
    const allButtons = [...document.querySelectorAll('button')];
    const visibleButtons = allButtons.filter(isVisible);
    const connectLike = visibleButtons.filter(isConnectAction);
    const samples = connectLike.slice(0, 5).map((btn) => ({
      text: buttonText(btn),
      aria: btn.getAttribute('aria-label') || '',
      className: btn.className || ''
    }));

    return {
      allButtons: allButtons.length,
      visibleButtons: visibleButtons.length,
      connectLike: connectLike.length,
      samples
    };
  };

  const findOverflowConnectButton = async (card) => {
    let connectEl = findInScope(card, SEL.connectBtn);
    if (!connectEl || !isConnectAction(connectEl)) {
      connectEl = null;
    }

    if (!connectEl) {
      const moreEl = card?.querySelector(SEL.moreBtn);
      if (moreEl && isVisible(moreEl)) {
        await LiAP.click(moreEl);
        await LiAP.sleep(600);
        const dropdownItems = document.querySelectorAll('.artdeco-dropdown__content li button');
        for (const item of dropdownItems) {
          if (isConnectAction(item)) {
            connectEl = item;
            break;
          }
        }
      }
    }

    if (!connectEl || connectEl.disabled || processedButtons.has(connectEl)) {
      return null;
    }
    return connectEl && isVisible(connectEl) ? connectEl : null;
  };

  const processConnectButton = async (connectEl, settings) => {
    const card = getCardForElement(connectEl);
    const name = getPersonName(card || document.body);

    if (!card || isAlreadyConnected(card)) {
      await LiAP.log('skip', `Already connected or pending for ${name}`);
      return false;
    }

    let button = connectEl;
    if (!button || button.disabled || !isVisible(button)) {
      button = await findOverflowConnectButton(card);
    }

    if (!button || button.disabled) {
      await LiAP.log('skip', `No Connect button for ${name}`);
      return false;
    }

    // Click Connect
    const previousText = buttonText(button);
    processedButtons.add(button);
    await LiAP.click(button);
    await LiAP.sleep(1000);

    const modalOpen = document.querySelector(SEL.modalRoot) ||
      document.querySelector(SEL.addNoteBtn) ||
      document.querySelector(SEL.sendWithoutNoteBtn) ||
      document.querySelector(SEL.noteTextarea);

    if (!modalOpen) {
      const updatedText = button.isConnected ? buttonText(button) : '';
      if (!button.isConnected || (updatedText && updatedText.toLowerCase() !== previousText.toLowerCase())) {
        await LiAP.incrementDailyCount('connect');
        await LiAP.log('connect', `Sent connection request to ${name}`, { name, mode: 'direct' });
        return true;
      }
    }

    // Handle modal
    const sent = await handleModal(name, settings);

    if (sent) {
      await LiAP.incrementDailyCount('connect');
      await LiAP.log('connect', `Sent connection request to ${name}`, { name });
      return true;
    } else {
      await LiAP.log('skip', `Modal handling failed for ${name}`);
      return false;
    }
  };

  // ── Main run loop ─────────────────────────────────────────────────────────
  const run = async () => {
    if (running) return;
    running = true;

    try {
      const data = await LiAP.getStorage([
        'masterOn', 'connectOn', 'connectLimit', 'connectSettings'
      ]);

      if (!data.masterOn || !data.connectOn) {
        running = false;
        return;
      }

      const settings = data.connectSettings || {};
      const dailyLimit = Math.min(data.connectLimit || 20, 50); // hard cap 50
      const todayCount = await LiAP.getDailyCount('connect');

      if (todayCount >= dailyLimit) {
        await LiAP.log('info', `Daily connect limit reached (${todayCount}/${dailyLimit})`);
        running = false;
        return;
      }

      await LiAP.log('info', 'Auto Connect started', { todayCount, dailyLimit });

      let remaining = dailyLimit - todayCount;
      let idlePasses = 0;

      if (!window.location.href.startsWith(SEL.connectPage)) {
        window.location.href = SEL.connectPage;
        running = false;
        return;
      }

      while (remaining > 0 && idlePasses < 4) {
        if (LiAP.isCaptcha()) {
          await LiAP.log('error', 'CAPTCHA detected — pausing automation');
          chrome.runtime.sendMessage({ action: 'captchaDetected' });
          break;
        }

        if (!await LiAP.isActive()) break;

        const buttons = findVisibleConnectButtons();
        let sentThisPass = 0;

        if (buttons.length === 0) {
          const diag = getButtonDiagnostics();
          await LiAP.log(
            'info',
            `No visible Connect buttons found on pass ${idlePasses + 1}`,
            diag
          );
        }

        for (const button of buttons) {
          if (remaining <= 0) break;
          if (!await LiAP.isActive()) break;

          const sent = await processConnectButton(button, settings);
          if (!sent) continue;

          actionCount++;
          sentThisPass++;
          remaining--;

          // Human delay between each action
          await LiAP.randomDelay(2500, 7000);

          // Reading pause every 5 actions
          if (actionCount % 5 === 0) {
            await LiAP.log('info', 'Taking a natural reading pause...');
            await LiAP.readingPause();
          }
        }

        if (remaining <= 0 || !await LiAP.isActive()) break;

        if (sentThisPass === 0) {
          idlePasses++;
        } else {
          idlePasses = 0;
        }

        await LiAP.scrollDown(900);
        await LiAP.sleep(1800);
      }

      await LiAP.log('info', 'Auto Connect session finished');

    } catch (err) {
      console.error('[LiAP:Connect]', err);
      await LiAP.log('error', 'Connect module error: ' + err.message);
    } finally {
      running = false;
    }
  };

  // ── Listen for commands ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'startConnect') run();
    if (msg.action === 'stopAll') running = false;
  });

  return { run, isRunning: () => running };
})();

console.log('[LiAP] connect.js loaded');
