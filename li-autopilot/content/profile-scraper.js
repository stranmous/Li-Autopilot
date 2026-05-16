// ─── LiAutopilot · profile-scraper.js ───────────────────────────────────────
// Runs on your LinkedIn profile page and extracts your own data.
// Triggered by background service worker via chrome.tabs.sendMessage.

window.LiAP = window.LiAP || {};

LiAP.scrapeMyProfile = async () => {
  if (!window.location.href.includes('/in/')) return null;

  const getText = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.innerText.trim() : '';
  };

  const cleanText = (value = '') => value.replace(/\s+/g, ' ').trim();

  const getTitleFallback = () => {
    const title = cleanText(document.title || '');
    if (!title) return '';
    return title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  };

  const getMetaFallback = () => {
    const meta = document.querySelector('meta[property="og:title"], meta[name="title"]');
    return cleanText(meta?.getAttribute('content') || '').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  };

  const getFirstMeaningfulHeading = () => {
    const headings = [...document.querySelectorAll('main h1, h1')];
    for (const heading of headings) {
      const text = cleanText(heading.innerText || heading.textContent || '');
      if (text && !/linkedin/i.test(text)) {
        return text;
      }
    }
    return '';
  };

  try {
    await LiAP.waitFor('main', 10000).catch(() => null);
    await LiAP.sleep(1200);

    // ── Basic info ──────────────────────────────────────────────────────────
    const name = cleanText(
      getText('h1.text-heading-xlarge') ||
      getText('.pv-text-details__left-panel h1') ||
      getText('h1[data-generated-suggestion-target]') ||
      getText('.inline.t-24.v-align-middle.break-words') ||
      getText('.inline.t-24.v-align-middle.break-words span[aria-hidden]') ||
      getText('[data-view-name="profile-card"] h1') ||
      getText('main h1') ||
      getFirstMeaningfulHeading() ||
      getMetaFallback() ||
      getTitleFallback()
    );

    const headline = cleanText(
      getText('.text-body-medium.break-words') ||
      getText('.pv-text-details__left-panel .text-body-medium') ||
      getText('.text-body-medium') ||
      getText('[data-field="headline"]')
    );

    const location = cleanText(
      getText('.text-body-small.inline.t-black--light.break-words') ||
      getText('.pv-text-details__left-panel .text-body-small') ||
      getText('.text-body-small.inline')
    );

    // ── About section ───────────────────────────────────────────────────────
    const about = getText('#about ~ .display-flex .full-width .pv-shared-text-with-see-more span') ||
                  getText('.pv-about__summary-text') || '';

    // ── Experience ──────────────────────────────────────────────────────────
    const expItems = document.querySelectorAll('#experience ~ .pvs-list__outer-container li.artdeco-list__item');
    const experience = [...expItems].slice(0, 5).map(el => {
      const title = el.querySelector('.t-bold span[aria-hidden]')?.innerText?.trim() || '';
      const company = el.querySelector('.t-14.t-normal span[aria-hidden]')?.innerText?.trim() || '';
      const dates = el.querySelector('.t-14.t-normal.t-black--light span[aria-hidden]')?.innerText?.trim() || '';
      return { title, company, dates };
    }).filter(e => e.title);

    // ── Education ───────────────────────────────────────────────────────────
    const eduItems = document.querySelectorAll('#education ~ .pvs-list__outer-container li.artdeco-list__item');
    const education = [...eduItems].slice(0, 3).map(el => {
      const school = el.querySelector('.t-bold span[aria-hidden]')?.innerText?.trim() || '';
      const degree = el.querySelector('.t-14.t-normal span[aria-hidden]')?.innerText?.trim() || '';
      return { school, degree };
    }).filter(e => e.school);

    // ── Skills ──────────────────────────────────────────────────────────────
    const skillEls = document.querySelectorAll('#skills ~ .pvs-list__outer-container li .t-bold span[aria-hidden]');
    const skills = [...skillEls].map(el => el.innerText.trim()).filter(Boolean).slice(0, 20);

    // ── Compute years of experience ─────────────────────────────────────────
    let yearsExp = 0;
    experience.forEach(exp => {
      const match = exp.dates.match(/(\d+)\s*yr/i);
      if (match) yearsExp += parseInt(match[1]);
    });
    if (yearsExp === 0 && experience.length > 0) yearsExp = experience.length; // rough fallback

    const profile = {
      name,
      headline,
      location,
      about,
      experience,
      education,
      skills,
      yearsExp,
      scrapedAt: Date.now()
    };

    if (!profile.name) {
      await LiAP.log('error', 'Profile sync failed: could not detect your profile name', {
        titleFallback: getTitleFallback(),
        metaFallback: getMetaFallback(),
        headingFallback: getFirstMeaningfulHeading()
      });
      return null;
    }

    await LiAP.setStorage({ myProfile: profile });
    await LiAP.log('info', 'Profile scraped and saved', {
      name,
      headline,
      location,
      experienceCount: experience.length,
      educationCount: education.length,
      skillsCount: skills.length
    });
    console.log('[LiAP] Profile saved:', profile);
    return profile;

  } catch (err) {
    console.error('[LiAP] Profile scrape error:', err);
    await LiAP.log('error', 'Profile sync failed: ' + err.message);
    return null;
  }
};

// Listen for scrape command from background or popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scrapeProfile') {
    LiAP.scrapeMyProfile().then(profile => sendResponse({ profile }));
    return true; // keep channel open for async
  }
});

console.log('[LiAP] profile-scraper.js loaded');
