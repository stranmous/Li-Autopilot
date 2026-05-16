// ─── LiAutopilot · popup.js ──────────────────────────────────────────────────
// Controls the popup UI — reads/writes chrome.storage, sends messages.

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const get = (keys) => new Promise(r => chrome.storage.local.get(keys, r));
const set = (data) => new Promise(r => chrome.storage.local.set(data, r));

const getTodayKey = () => new Date().toISOString().slice(0, 10);
const getDailyCount = async (type) => {
  const key = `daily_${type}_${getTodayKey()}`;
  const d = await get([key]);
  return d[key] || 0;
};

function showToast(msg, duration = 2000) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderProfileInfo(profile) {
  if (profile?.name) {
    const syncedAt = profile.scrapedAt
      ? new Date(profile.scrapedAt).toLocaleString([], {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'just now';
    $('profileInfo').textContent = `Profile: ${profile.name} · synced ${syncedAt}`;
    return;
  }

  $('profileInfo').textContent = 'Profile not synced yet — click Sync My Profile';
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab, .panel').forEach(el => el.classList.remove('active'));
    tab.classList.add('active');
    $('tab-' + tab.dataset.tab).classList.add('active');

    if (tab.dataset.tab === 'log') renderLog();
  });
});

// ── Status pill ───────────────────────────────────────────────────────────────
async function updateStatusPill() {
  const data = await get(['masterOn', 'connectOn', 'applyOn']);
  const pill = $('statusPill');
  if (!data.masterOn) {
    pill.textContent = '● Idle';
    pill.className = 'status-pill';
  } else if (data.connectOn || data.applyOn) {
    pill.textContent = '● Running';
    pill.className = 'status-pill running';
  } else {
    pill.textContent = '● On — No modules';
    pill.className = 'status-pill paused';
  }
}

// ── Load all saved settings into UI ───────────────────────────────────────────
async function loadSettings() {
  const data = await get([
    'masterOn', 'connectOn', 'applyOn',
    'connectLimit', 'applyLimit',
    'connectSettings', 'applySettings', 'qaAnswers', 'myProfile'
  ]);

  // Main toggles
  $('masterOn').checked  = !!data.masterOn;
  $('connectOn').checked = !!data.connectOn;
  $('applyOn').checked   = !!data.applyOn;

  // Connect tab
  const cs = data.connectSettings || {};
  $('connectLimit').value    = data.connectLimit || 20;
  $('connectSendNote').checked = !!cs.sendNote;
  $('connectNote').value     = cs.noteTemplate || 'Hi {name}, I came across your profile and would love to connect!';
  toggleNoteTemplate(!!cs.sendNote);

  // Apply tab
  const as = data.applySettings || {};
  $('applyKeywords').value   = as.keywords || '';
  $('applyLocation').value   = as.location || '';
  $('applyExpLevel').value   = as.experienceLevel || '';
  $('applyLimit').value      = data.applyLimit || 10;

  // Q&A tab
  const qa = data.qaAnswers || {};
  $('qaPhone').value     = qa.phone || '';
  $('qaCity').value      = qa.city  || '';
  $('qaAddress').value   = qa.address || '';
  $('qaState').value     = qa.state || '';
  $('qaPostal').value    = qa.postal || '';
  $('qaSalary').value    = qa.salary || '';
  $('qaYearsExp').value  = qa['years of experience'] || '';
  $('qaNotice').value    = qa['notice period'] || '';
  $('qaVisa').value      = qa.visa || '';
  $('qaRelocate').value  = qa.relocate || 'Yes';

  renderProfileInfo(data.myProfile);

  await updateStats();
  await updateStatusPill();
}

// ── Update stats & progress bars ──────────────────────────────────────────────
async function updateStats() {
  const [connectCount, applyCount, data] = await Promise.all([
    getDailyCount('connect'),
    getDailyCount('apply'),
    get(['connectLimit', 'applyLimit'])
  ]);

  const cLimit = Math.min(data.connectLimit || 20, 50);
  const aLimit = Math.min(data.applyLimit || 10, 25);

  $('statConnect').textContent = connectCount;
  $('statApply').textContent   = applyCount;
  $('connectCount').textContent = `${connectCount}/${cLimit}`;
  $('applyCount').textContent   = `${applyCount}/${aLimit}`;
  $('connectBar').style.width  = `${Math.min((connectCount / cLimit) * 100, 100)}%`;
  $('applyBar').style.width    = `${Math.min((applyCount  / aLimit) * 100, 100)}%`;
}

// ── Render activity log ───────────────────────────────────────────────────────
async function renderLog() {
  const { activityLog = [] } = await get(['activityLog']);
  const list = $('logList');

  if (activityLog.length === 0) {
    list.innerHTML = '<div class="log-empty">No activity yet. Start a module to begin.</div>';
    return;
  }

  list.innerHTML = activityLog.slice(0, 50).map(entry => `
    <div class="log-entry">
      <span class="log-badge badge-${entry.type}">${entry.type}</span>
      <span class="log-msg">${entry.message}</span>
      <span class="log-time">${formatTime(entry.ts)}</span>
    </div>
  `).join('');
}

// ── Toggle note template field ────────────────────────────────────────────────
function toggleNoteTemplate(show) {
  $('noteTemplateGroup').style.display = show ? 'block' : 'none';
}
$('connectSendNote').addEventListener('change', (e) => toggleNoteTemplate(e.target.checked));

// ── Master toggle ─────────────────────────────────────────────────────────────
$('masterOn').addEventListener('change', async (e) => {
  await set({ masterOn: e.target.checked });
  if (!e.target.checked) {
    chrome.runtime.sendMessage({ action: 'stopAll' });
  }
  await updateStatusPill();
});

// ── Module toggles ────────────────────────────────────────────────────────────
$('connectOn').addEventListener('change', async (e) => {
  await set({ connectOn: e.target.checked });
  await updateStatusPill();
});
$('applyOn').addEventListener('change', async (e) => {
  await set({ applyOn: e.target.checked });
  await updateStatusPill();
});

// ── Start buttons ─────────────────────────────────────────────────────────────
$('btnStartConnect').addEventListener('click', async () => {
  const data = await get(['masterOn']);
  if (!data.masterOn) {
    showToast('Enable Master Autopilot first');
    return;
  }
  await set({ connectOn: true });
  $('connectOn').checked = true;
  chrome.runtime.sendMessage({ action: 'startConnect' });
  showToast('Auto Connect started ▶');
  await updateStatusPill();
});

$('btnStartApply').addEventListener('click', async () => {
  const data = await get(['masterOn']);
  if (!data.masterOn) {
    showToast('Enable Master Autopilot first');
    return;
  }
  await set({ applyOn: true });
  $('applyOn').checked = true;
  chrome.runtime.sendMessage({ action: 'startApply' });
  showToast('Auto Apply started ▶');
  await updateStatusPill();
});

// ── Stop all ──────────────────────────────────────────────────────────────────
$('btnStop').addEventListener('click', async () => {
  await set({ masterOn: false, connectOn: false, applyOn: false });
  $('masterOn').checked = false;
  $('connectOn').checked = false;
  $('applyOn').checked = false;
  chrome.runtime.sendMessage({ action: 'stopAll' });
  showToast('All automation stopped ■');
  await updateStatusPill();
});

// ── Sync profile ──────────────────────────────────────────────────────────────
$('btnSyncProfile').addEventListener('click', async () => {
  showToast('Opening LinkedIn profile to sync...');
  chrome.runtime.sendMessage({ action: 'triggerProfileScrape' });
  $('profileInfo').textContent = 'Syncing profile...';
});

// ── Save Connect settings ─────────────────────────────────────────────────────
$('saveConnect').addEventListener('click', async () => {
  const limit = Math.min(parseInt($('connectLimit').value) || 20, 50);
  await set({
    connectLimit: limit,
    connectSettings: {
      sendNote:     $('connectSendNote').checked,
      noteTemplate: $('connectNote').value.trim()
    }
  });
  showToast('Connect settings saved ✓');
});

// ── Save Apply settings ───────────────────────────────────────────────────────
$('saveApply').addEventListener('click', async () => {
  const limit = Math.min(parseInt($('applyLimit').value) || 10, 25);
  await set({
    applyLimit: limit,
    applySettings: {
      keywords:        $('applyKeywords').value.trim(),
      location:        $('applyLocation').value.trim(),
      experienceLevel: $('applyExpLevel').value
    }
  });
  showToast('Apply settings saved ✓');
});

// ── Save Q&A answers ──────────────────────────────────────────────────────────
$('saveQA').addEventListener('click', async () => {
  await set({
    qaAnswers: {
      phone:                  $('qaPhone').value.trim(),
      city:                   $('qaCity').value.trim(),
      address:                $('qaAddress').value.trim(),
      state:                  $('qaState').value.trim(),
      postal:                 $('qaPostal').value.trim(),
      salary:                 $('qaSalary').value.trim(),
      'years of experience':  $('qaYearsExp').value.trim(),
      'notice period':        $('qaNotice').value.trim(),
      visa:                   $('qaVisa').value.trim(),
      relocate:               $('qaRelocate').value
    }
  });
  showToast('Q&A answers saved ✓');
});

// ── Clear log ─────────────────────────────────────────────────────────────────
$('clearLog').addEventListener('click', async () => {
  await set({ activityLog: [] });
  renderLog();
  showToast('Log cleared');
});

// ── Listen for storage changes (live updates while popup is open) ─────────────
chrome.storage.onChanged.addListener(() => {
  updateStats();
  updateStatusPill();
  get(['myProfile']).then((data) => renderProfileInfo(data.myProfile));
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadSettings();
