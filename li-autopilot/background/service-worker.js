// ─── LiAutopilot · service-worker.js ────────────────────────────────────────
// MV3 background service worker.
// Orchestrates automation, resets daily counters, handles notifications.

// ── Keep-alive alarm (MV3 service workers sleep after 30s) ───────────────────
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.create('dailyReset', { periodInMinutes: 60 }); // check every hour

function buildConnectUrl() {
  return 'https://www.linkedin.com/mynetwork/grow/';
}

function getConnectTabPattern() {
  return 'https://www.linkedin.com/mynetwork/grow/*';
}

function buildApplyUrl(settings = {}) {
  const params = new URLSearchParams();
  if (settings.keywords) params.set('keywords', settings.keywords);
  if (settings.location) params.set('location', settings.location);
  params.set('f_AL', 'true');
  if (settings.experienceLevel) {
    params.set('f_E', settings.experienceLevel);
  }
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'keepAlive') {
    // Ping to prevent SW termination during active sessions
    const data = await chrome.storage.local.get(['masterOn']);
    if (data.masterOn) {
      console.log('[LiAP:SW] Keep-alive ping');
    }
  }

  if (alarm.name === 'dailyReset') {
    await checkAndResetDailyCounters();
  }
});

// ── Daily counter reset at midnight ──────────────────────────────────────────
async function checkAndResetDailyCounters() {
  const today = new Date().toISOString().slice(0, 10);
  const data = await chrome.storage.local.get(['lastResetDate']);
  if (data.lastResetDate !== today) {
    await chrome.storage.local.set({ lastResetDate: today });
    console.log('[LiAP:SW] Daily counters reset for', today);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(async (msg, sender) => {

  // New log entry — update extension badge
  if (msg.action === 'logEntry') {
    const { entry } = msg;
    updateBadge(entry.type);
  }

  // CAPTCHA detected — pause and notify user
  if (msg.action === 'captchaDetected') {
    await chrome.storage.local.set({ masterOn: false });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'LiAutopilot — Action Required',
      message: 'LinkedIn showed a verification. Automation paused. Please complete the CAPTCHA then re-enable.'
    });
    updateBadge('paused');
  }

  // Trigger profile scrape on the active LinkedIn tab
  if (msg.action === 'triggerProfileScrape') {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/in/*' });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'scrapeProfile' });
    } else {
      // Navigate to profile page first
      const allTabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
      const targetUrl = 'https://www.linkedin.com/in/me/';
      const tab = allTabs.length > 0
        ? await chrome.tabs.update(allTabs[0].id, { url: targetUrl })
        : await chrome.tabs.create({ url: targetUrl });
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' }).catch(() => {});
          }, 1500);
        }
      });
    }
  }

  // Start connect automation on active LinkedIn tab
  if (msg.action === 'startConnect') {
    const connectUrl = buildConnectUrl();
    const tabs = await chrome.tabs.query({ url: getConnectTabPattern() });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'startConnect' });
    } else {
      const tab = await chrome.tabs.create({ url: connectUrl });
      // Wait for tab to load then start
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: 'startConnect' }).catch(() => {});
          }, 2000);
        }
      });
    }
  }

  // Start apply automation
  if (msg.action === 'startApply') {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/jobs/*' });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'startApply' });
    } else {
      const data = await chrome.storage.local.get(['applySettings']);
      const settings = data.applySettings || {};
      const url = buildApplyUrl(settings);
      const tab = await chrome.tabs.create({ url });
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: 'startApply' }).catch(() => {});
          }, 2000);
        }
      });
    }
  }

  // Stop everything
  if (msg.action === 'stopAll') {
    await chrome.storage.local.set({ masterOn: false, connectOn: false, applyOn: false });
    const liTabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    for (const tab of liTabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'stopAll' }).catch(() => {});
    }
    updateBadge('off');
  }
});

// ── Badge helper ──────────────────────────────────────────────────────────────
function updateBadge(type) {
  const config = {
    connect: { text: '▶', color: '#0A66C2' },
    apply:   { text: '▶', color: '#1a7a4a' },
    error:   { text: '!',  color: '#b92b2b' },
    paused:  { text: '||', color: '#9a6a00' },
    off:     { text: '',   color: '#888'    },
    info:    { text: '▶', color: '#0A66C2' }
  };
  const c = config[type] || config.info;
  chrome.action.setBadgeText({ text: c.text });
  chrome.action.setBadgeBackgroundColor({ color: c.color });
}

// ── Install handler ───────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  // Set default settings
  await chrome.storage.local.set({
    masterOn: false,
    connectOn: false,
    applyOn: false,
    connectLimit: 20,
    applyLimit: 10,
    connectSettings: {
      sendNote: false,
      noteTemplate: 'Hi {name}, I came across your profile and would love to connect!'
    },
    applySettings: {
      keywords: '',
      location: '',
      experienceLevel: ''
    },
    qaAnswers: {
      phone: '',
      city: '',
      address: '',
      state: '',
      postal: '',
      salary: '',
      'years of experience': '',
      'notice period': '',
      'visa': 'No visa required'
    },
    activityLog: [],
    lastResetDate: new Date().toISOString().slice(0, 10)
  });

  console.log('[LiAP:SW] Extension installed, defaults set');
  updateBadge('off');
});

console.log('[LiAP:SW] Service worker started');
