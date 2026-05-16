// ─── LiAutopilot · utils.js ─────────────────────────────────────────────────
// Shared utilities used by all content scripts.
// Loaded first via manifest content_scripts order.

window.LiAP = window.LiAP || {};

// ── Delay helpers ────────────────────────────────────────────────────────────

/** Sleep for exactly ms milliseconds */
LiAP.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Random delay between min and max ms — mimics human hesitation */
LiAP.randomDelay = async (min = 2000, max = 6000) => {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await LiAP.sleep(ms);
  return ms;
};

/** Longer "reading" pause every N actions */
LiAP.readingPause = async () => {
  const ms = Math.floor(Math.random() * 60000) + 30000; // 30–90s
  await LiAP.sleep(ms);
};

// ── DOM helpers ──────────────────────────────────────────────────────────────

/** Wait for a selector to appear in DOM, timeout after ms */
LiAP.waitFor = (selector, timeout = 8000) => {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
  });
};

/** Safely click an element (dispatches both mousedown and click) */
LiAP.click = async (el) => {
  if (!el) return false;
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await LiAP.sleep(120);
  el.click();
  await LiAP.sleep(180);
  return true;
};

/** Fill an input field the human way (focus → clear → type) */
LiAP.fill = async (el, value) => {
  if (!el) return;
  el.focus();
  await LiAP.sleep(80);
  // Clear existing value
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await LiAP.sleep(60);
  // Set new value
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await LiAP.sleep(100);
};

/** Scroll the page down by px amount */
LiAP.scrollDown = async (px = 600) => {
  window.scrollBy({ top: px, behavior: 'smooth' });
  await LiAP.sleep(800);
};

/** Scroll to bottom of page */
LiAP.scrollToBottom = async () => {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  await LiAP.sleep(1500);
};

// ── Storage helpers ──────────────────────────────────────────────────────────

LiAP.getStorage = (keys) =>
  new Promise(resolve => chrome.storage.local.get(keys, resolve));

LiAP.setStorage = (data) =>
  new Promise(resolve => chrome.storage.local.set(data, resolve));

// ── Logger ──────────────────────────────────────────────────────────────────

LiAP.log = async (type, message, meta = {}) => {
  const entry = {
    type,         // 'connect' | 'apply' | 'skip' | 'error' | 'info'
    message,
    meta,
    ts: Date.now()
  };
  console.log(`[LiAP:${type}]`, message, meta);
  const { activityLog = [] } = await LiAP.getStorage(['activityLog']);
  activityLog.unshift(entry);
  // Keep last 200 entries
  await LiAP.setStorage({ activityLog: activityLog.slice(0, 200) });
  // Notify background to update badge
  chrome.runtime.sendMessage({ action: 'logEntry', entry }).catch(() => {});
};

// ── Safety guard ─────────────────────────────────────────────────────────────

/** Returns true if automation should be running */
LiAP.isActive = async () => {
  const data = await LiAP.getStorage(['masterOn']);
  return data.masterOn === true;
};

/** Check if LinkedIn is showing a CAPTCHA or restriction warning */
LiAP.isCaptcha = () => {
  const body = document.body.innerText || '';
  return (
    document.querySelector('[data-test-id="challenge-submit-button"]') !== null ||
    body.includes('security verification') ||
    body.includes('Let\'s do a quick security check') ||
    body.includes('invitation limit')
  );
};

// ── Daily counter helpers ────────────────────────────────────────────────────

LiAP.getTodayKey = () => new Date().toISOString().slice(0, 10); // "2026-05-16"

LiAP.getDailyCount = async (type) => {
  const key = `daily_${type}_${LiAP.getTodayKey()}`;
  const data = await LiAP.getStorage([key]);
  return data[key] || 0;
};

LiAP.incrementDailyCount = async (type) => {
  const key = `daily_${type}_${LiAP.getTodayKey()}`;
  const current = await LiAP.getDailyCount(type);
  await LiAP.setStorage({ [key]: current + 1 });
  return current + 1;
};

console.log('[LiAP] utils.js loaded');
