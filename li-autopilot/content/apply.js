// ─── LiAutopilot · apply.js ──────────────────────────────────────────────────
// Handles the Auto Apply module.
// Navigates /jobs/search/, detects Easy Apply listings, fills & submits forms.

window.LiAP = window.LiAP || {};

LiAP.Apply = (() => {
  let running = false;
  let actionCount = 0;

  const buildApplySearchUrl = (settings = {}) => {
    const params = new URLSearchParams();
    if (settings.keywords) params.set('keywords', settings.keywords);
    if (settings.location) params.set('location', settings.location);
    params.set('f_AL', 'true');
    if (settings.experienceLevel) {
      params.set('f_E', settings.experienceLevel);
    }
    return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
  };

  // ── Selectors ─────────────────────────────────────────────────────────────
  const SEL = {
    // Job listing items in the left panel
    jobCards:         '.jobs-search-results__list-item, .scaffold-layout__list-container li, li.scaffold-layout__list-item, .jobs-search-results-list__list-item',
    // Easy Apply button on job detail panel
    easyApplyBtn:     'button.jobs-apply-button[aria-label*="Easy Apply"]',
    // Modal container
    modal:            '.jobs-easy-apply-modal',
    modalContent:     '.jobs-easy-apply-modal__content, .artdeco-modal__content',
    modalFooter:      '.jobs-easy-apply-modal__footer, .artdeco-modal__actionbar',
    // Modal close
    modalClose:       'button[aria-label="Dismiss"]',
    // Common form fields
    phoneInput:       'input[id*="phone"], input[name*="phone"]',
    cityInput:        'input[id*="city"], input[id*="location"]',
    // "Follow company" checkbox (we skip this)
    followCheckbox:   'input[id*="follow"], input[type="checkbox"]',
    // Already-applied indicator
    appliedBadge:     '.jobs-details-top-card__apply-type--applied, .artdeco-inline-feedback--success'
  };

  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };

  const normalize = (value = '') => value.replace(/\s+/g, ' ').trim().toLowerCase();

  const getButtonText = (button) => normalize(button?.innerText || button?.textContent || '');

  const getModal = () => document.querySelector(SEL.modal);

  const scrollModalToBottom = async () => {
    const modalContent = document.querySelector(SEL.modalContent);
    if (modalContent) {
      modalContent.scrollTo({ top: modalContent.scrollHeight, behavior: 'smooth' });
      await LiAP.sleep(700);
    }
  };

  const getFooterButtons = () => {
    const modal = getModal();
    if (!modal) return [];
    return [...modal.querySelectorAll('button')].filter(isVisible);
  };

  const findActionButton = (matcher) => {
    return getFooterButtons().find((button) => matcher(getButtonText(button), button));
  };

  const clickActionButton = async (matcher) => {
    const button = findActionButton(matcher);
    if (!button || button.disabled) return false;
    button.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await LiAP.sleep(250);
    await LiAP.click(button);
    await LiAP.sleep(900);
    return true;
  };

  const getFieldLabel = (input) => {
    const id = input.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.innerText.trim();
    }
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const label = document.getElementById(labelledBy);
      if (label) return label.innerText.trim();
    }
    const parent = input.closest('label, .fb-dash-form-element, .jobs-easy-apply-form-section__grouping');
    return parent ? parent.innerText.trim() : '';
  };

  const isRequiredField = (input, labelText) => {
    return input.required ||
      input.getAttribute('aria-required') === 'true' ||
      /\*/.test(labelText);
  };

  const getAnswerForLabel = (label, profile, qaAnswers) => {
    const lower = normalize(label);
    const firstLocationPart = profile?.location?.split(',')[0]?.trim() || '';

    const answerMap = [
      { test: ['mobile phone number', 'phone number', 'phone'], value: qaAnswers.phone },
      { test: ['email address', 'email'], value: qaAnswers.email },
      { test: ['city'], value: qaAnswers.city || firstLocationPart },
      { test: ['address'], value: qaAnswers.address },
      { test: ['state', 'province', 'region'], value: qaAnswers.state },
      { test: ['postal', 'zip'], value: qaAnswers.postal },
      { test: ['salary', 'compensation'], value: qaAnswers.salary },
      { test: ['notice period'], value: qaAnswers['notice period'] },
      { test: ['visa', 'work authorization', 'sponsorship'], value: qaAnswers.visa },
      { test: ['relocate', 'relocation'], value: qaAnswers.relocate },
      { test: ['years of experience', 'year of experience'], value: qaAnswers['years of experience'] || String(profile?.yearsExp || '') }
    ];

    for (const entry of answerMap) {
      if (entry.test.some((token) => lower.includes(token)) && entry.value) {
        return String(entry.value).trim();
      }
    }

    for (const [key, value] of Object.entries(qaAnswers)) {
      if (value && lower.includes(normalize(key))) {
        return String(value).trim();
      }
    }

    return '';
  };

  // ── Get job title + company ───────────────────────────────────────────────
  const getJobInfo = () => {
    const title = document.querySelector('.jobs-unified-top-card__job-title')?.innerText?.trim() ||
                  document.querySelector('h2.t-24')?.innerText?.trim() || 'Unknown job';
    const company = document.querySelector('.jobs-unified-top-card__company-name')?.innerText?.trim() ||
                    document.querySelector('.jobs-unified-top-card__subtitle-primary-grouping a')?.innerText?.trim() || 'Unknown company';
    return { title, company };
  };

  // ── Check if already applied ──────────────────────────────────────────────
  const alreadyApplied = () => {
    return document.querySelector(SEL.appliedBadge) !== null ||
           document.body.innerText.includes('Applied') && 
           document.querySelector('.jobs-apply-button') === null;
  };

  // ── Check if this is an Easy Apply job ───────────────────────────────────
  const isEasyApply = () => {
    return document.querySelector(SEL.easyApplyBtn) !== null;
  };

  // ── Handle select dropdowns ───────────────────────────────────────────────
  const fillSelect = async (el, value) => {
    if (!el || el.tagName !== 'SELECT' || !value) return false;
    const options = [...el.options];
    const match = options.find(o => o.text.toLowerCase().includes(value.toLowerCase()));
    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await LiAP.sleep(200);
      return true;
    }
    return false;
  };

  const uncheckFollowCompany = async () => {
    const modal = getModal();
    if (!modal) return;

    const checkboxes = [...modal.querySelectorAll(SEL.followCheckbox)];
    for (const checkbox of checkboxes) {
      const text = normalize(checkbox.closest('label, fieldset, div')?.innerText || '');
      if (checkbox.checked && text.includes('follow')) {
        checkbox.click();
        await LiAP.sleep(200);
      }
    }
  };

  const fillCurrentStep = async (profile, qaAnswers) => {
    const modal = getModal();
    if (!modal) return { filled: 0, missingRequired: [] };

    await LiAP.sleep(600);

    const fields = [...modal.querySelectorAll('input, textarea, select')].filter((input) => {
      if (!isVisible(input) || input.disabled || input.readOnly) return false;
      const type = (input.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'file'].includes(type)) return false;
      if (type === 'checkbox' || type === 'radio') return false;
      return true;
    });

    let filled = 0;
    const missingRequired = [];

    for (const input of fields) {
      const currentValue = (input.value || '').trim();
      const label = getFieldLabel(input);
      const required = isRequiredField(input, label);

      if (currentValue) continue;
      if (!required) continue;

      const answer = getAnswerForLabel(label, profile, qaAnswers);
      if (!answer) {
        missingRequired.push(label || input.name || input.id || input.tagName);
        continue;
      }

      if (input.tagName === 'SELECT') {
        if (await fillSelect(input, answer)) filled++;
      } else {
        await LiAP.fill(input, answer);
        filled++;
      }
    }

    await uncheckFollowCompany();
    await LiAP.sleep(300);
    return { filled, missingRequired };
  };

  const closeModal = async () => {
    const closeBtn = document.querySelector(SEL.modalClose);
    if (closeBtn) {
      await LiAP.click(closeBtn);
      await LiAP.sleep(500);
    }
  };

  // ── Navigate and submit the Easy Apply modal ──────────────────────────────
  const submitApplication = async (profile, qaAnswers) => {
    const MAX_STEPS = 12;
    let step = 0;

    // Open Easy Apply modal
    const easyApplyEl = document.querySelector(SEL.easyApplyBtn);
    if (!easyApplyEl) return false;
    await LiAP.click(easyApplyEl);

    const modal = await LiAP.waitFor(SEL.modal, 6000).catch(() => null);
    if (!modal) return false;

    while (step < MAX_STEPS) {
      await LiAP.sleep(700);

      // Safety: CAPTCHA or restriction check
      if (LiAP.isCaptcha()) {
        chrome.runtime.sendMessage({ action: 'captchaDetected' });
        break;
      }

      const { missingRequired } = await fillCurrentStep(profile, qaAnswers);
      await scrollModalToBottom();
      await uncheckFollowCompany();

      if (missingRequired.length > 0) {
        await LiAP.log('skip', 'Missing required answers for Easy Apply step', {
          missingRequired
        });
        await closeModal();
        return false;
      }

      if (await clickActionButton((text) => text.includes('review'))) {
        await scrollModalToBottom();
        await uncheckFollowCompany();
        if (await clickActionButton((text) => text.includes('submit application') || text === 'submit')) {
          await LiAP.sleep(1200);
          await closeModal();
          return true;
        }
        await closeModal();
        return false;
      }

      if (await clickActionButton((text) => text.includes('submit application') || text === 'submit')) {
        await LiAP.sleep(1200);
        await closeModal();
        return true;
      }

      if (await clickActionButton((text) => text === 'next' || text.includes('next step') || text.includes('continue'))) {
        step++;
        await LiAP.sleep(800);
      } else {
        await LiAP.log('skip', 'No recognised action button in Easy Apply modal');
        await closeModal();
        return false;
      }
    }

    await LiAP.log('skip', `Exceeded Easy Apply max step count (${MAX_STEPS})`);
    await closeModal();
    return false;
  };

  // ── Process a single job card ─────────────────────────────────────────────
  const processJobCard = async (card, profile, qaAnswers) => {
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await LiAP.sleep(400);
    await LiAP.click(card);
    await LiAP.sleep(2500);

    if (alreadyApplied()) {
      await LiAP.log('skip', 'Already applied to this job');
      return false;
    }

    if (!isEasyApply()) {
      await LiAP.log('skip', 'Not an Easy Apply job — skipped');
      return false;
    }

    const { title, company } = getJobInfo();
    await LiAP.log('info', `Attempting to apply: ${title} at ${company}`);

    const success = await submitApplication(profile, qaAnswers);

    if (success) {
      await LiAP.incrementDailyCount('apply');
      await LiAP.log('apply', `Applied to ${title} at ${company}`, { title, company });
      return true;
    } else {
      await LiAP.log('skip', `Could not complete application: ${title} at ${company}`);
      return false;
    }
  };

  // ── Main run loop ─────────────────────────────────────────────────────────
  const run = async () => {
    if (running) return;
    running = true;

    try {
      const data = await LiAP.getStorage([
        'masterOn', 'applyOn', 'applyLimit', 'qaAnswers', 'myProfile', 'applySettings'
      ]);

      if (!data.masterOn || !data.applyOn) { running = false; return; }

      const profile = data.myProfile || {};
      const qaAnswers = data.qaAnswers || {};
      const applySettings = data.applySettings || {};
      const dailyLimit = Math.min(data.applyLimit || 15, 25); // hard cap 25
      const todayCount = await LiAP.getDailyCount('apply');

      if (todayCount >= dailyLimit) {
        await LiAP.log('info', `Daily apply limit reached (${todayCount}/${dailyLimit})`);
        running = false;
        return;
      }

      await LiAP.log('info', 'Auto Apply started', { todayCount, dailyLimit });
      let remaining = dailyLimit - todayCount;

      // Navigate to jobs page if not already there
      if (!window.location.href.includes('/jobs/')) {
        window.location.href = buildApplySearchUrl(applySettings);
        running = false;
        return; // Will re-trigger after navigation
      }

      await LiAP.sleep(2000);

      // Get job cards
      const cards = [...document.querySelectorAll(SEL.jobCards)].filter(isVisible);

      for (const card of cards) {
        if (remaining <= 0) break;
        if (!await LiAP.isActive()) break;
        if (LiAP.isCaptcha()) {
          chrome.runtime.sendMessage({ action: 'captchaDetected' });
          break;
        }

        const applied = await processJobCard(card, profile, qaAnswers);
        actionCount++;

        // Human delay between applications
        await LiAP.randomDelay(5000, 12000);

        // Longer pause every 3 applications
        if (actionCount % 3 === 0) {
          await LiAP.log('info', 'Taking a natural break between applications...');
          await LiAP.readingPause();
        }

        if (applied) remaining--;
      }

      await LiAP.log('info', 'Auto Apply session finished');

    } catch (err) {
      console.error('[LiAP:Apply]', err);
      await LiAP.log('error', 'Apply module error: ' + err.message);
    } finally {
      running = false;
    }
  };

  // ── Listen for commands ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'startApply') run();
    if (msg.action === 'stopAll') running = false;
  });

  return { run, isRunning: () => running };
})();

console.log('[LiAP] apply.js loaded');
