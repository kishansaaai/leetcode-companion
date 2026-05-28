import { getProblemsByCompany, PROBLEM_DB, ALL_COMPANIES } from './data/problemDatabase';
import type { 
  SidebarData, 
  CurrentProblem, 
  RelatedProblem, 
  CompanyInsight, 
  ContestInfo, 
  ExtensionSettings,
  LeetCodeProblem,
  CompanyTag,
  StreakState,
  SolvedProblem
} from './types';

console.log('LeetCode Companion: Content script loaded.');

// Global state
let currentSlug = '';
let currentData: SidebarData | null = null;
let settings: ExtensionSettings = {
  isEnabled: true,
  sidebarPosition: 'right',
  theme: 'auto',
  keyboardShortcut: 'Alt+L',
  showCompanyInsights: true,
  showRelatedProblems: true,
  showPairFrequency: true,
  showContestHistory: true,
  showPredictions: true,
  cacheExpiry: 24
};
let bookmarks: string[] = [];
let streak: StreakState = {
  currentStreak: 0,
  lastSolvedDate: '',
  solvedHistory: []
};
let activeTabId = 'similar-problems';
let isSidebarOpen = false;
let selectedCompanyFilter: string | null = null;
let lastScrapedCode = '';
let lastAnalysisResult = '';
let isAnalyzingCode = false;
let analysisError = '';

// Use the complete list of 100+ companies
const UNIQUE_COMPANIES = ALL_COMPANIES;

// DOM Elements inside Shadow Root
let shadowRoot: ShadowRoot | null = null;
let sidebarElement: HTMLDivElement | null = null;
let toggleButton: HTMLDivElement | null = null;
let modalElement: HTMLDivElement | null = null;

// Initialize Content Script
function init() {
  console.log('LeetCode Companion: Initializing content script...');
  // Read initial settings, bookmarks, and streak, then start URL observer
  chrome.storage.local.get(['settings', 'bookmarks', 'streak'], (result) => {
    console.log('LeetCode Companion: Loaded settings from storage:', result.settings);
    if (result.settings) {
      settings = result.settings;
    }
    if (result.bookmarks) {
      bookmarks = result.bookmarks;
    }
    if (result.streak) {
      streak = result.streak;
    }

    if (!settings.isEnabled) {
      console.log('LeetCode Companion: Extension is disabled in settings.');
      return;
    }

    createShadowDom();
    startUrlObserver();
  });

  // Listen to chrome storage changes to synchronize bookmarks/settings/streaks instantly
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = changes.settings.newValue;
      applySettings();
    }
    if (changes.bookmarks) {
      bookmarks = changes.bookmarks.newValue;
      renderSidebarContent();
    }
    if (changes.streak) {
      streak = changes.streak.newValue;
      renderSidebarContent();
    }
  });

  // Listen to background messages (e.g. DATA_RESPONSE, TOGGLE_SIDEBAR)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DATA_RESPONSE') {
      currentData = message.payload;
      renderSidebarContent();
    } else if (message.type === 'TOGGLE_SIDEBAR') {
      toggleSidebar();
    } else if (message.type === 'ANALYZE_CODE_RESPONSE') {
      isAnalyzingCode = false;
      if (message.payload.error) {
        analysisError = message.payload.error;
      } else if (message.payload.review) {
        lastAnalysisResult = message.payload.review;
      } else {
        analysisError = 'Unknown response payload received.';
      }
      renderSidebarContent();
    }
  });

  // Start dynamic code sync interval to poll LeetCode editor changes
  setInterval(() => {
    // Only sync if sidebar is open and we are on the AI Review tab
    if (!isSidebarOpen || activeTabId !== 'ai-review') return;

    if (shadowRoot) {
      const textarea = shadowRoot.querySelector('.lc-review-textarea') as HTMLTextAreaElement | null;
      // If textarea is not focused, auto-sync it with the page editor
      if (textarea && document.activeElement !== textarea && shadowRoot.activeElement !== textarea) {
        const currentCode = scrapeCodeFromPage();
        if (currentCode && currentCode !== lastScrapedCode) {
          lastScrapedCode = currentCode;
          textarea.value = currentCode;
        }
      }
    }
  }, 1000);

  // Poll for Accepted submission status to auto-increment streak
  setInterval(() => {
    detectAcceptedSubmission();
  }, 2000);
}

/**
 * Creates the Shadow DOM container to isolate styles from LeetCode.
 */
function createShadowDom() {
  const container = document.createElement('div');
  container.id = 'leetcode-companion-root';
  // Ensure the extension container rests on top of everything
  container.style.position = 'fixed';
  container.style.zIndex = '999999';
  container.style.top = '0';
  container.style.left = '0';
  container.style.width = '0';
  container.style.height = '0';
  document.body.appendChild(container);

  shadowRoot = container.attachShadow({ mode: 'open' });

  // Inject Google Fonts and content.css into the Shadow Root
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap';
  shadowRoot.appendChild(fontLink);

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('content.css');
  shadowRoot.appendChild(styleLink);

  // Create Sidebar Drawer
  sidebarElement = document.createElement('div');
  sidebarElement.className = `lc-sidebar ${settings.sidebarPosition}`;
  shadowRoot.appendChild(sidebarElement);

  // Create Floating Toggle Button
  toggleButton = document.createElement('div');
  toggleButton.className = `lc-toggle-btn ${settings.sidebarPosition}`;
  toggleButton.innerHTML = `
    <div class="lc-toggle-btn-pulse"></div>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
    </svg>
    <span class="lc-toggle-tooltip">LeetCode Companion</span>
  `;
  toggleButton.addEventListener('click', toggleSidebar);
  shadowRoot.appendChild(toggleButton);

  // Create Code Modal Viewer
  modalElement = document.createElement('div');
  modalElement.id = 'lcCodeModal';
  modalElement.className = 'lc-code-modal';
  modalElement.innerHTML = `
    <div class="lc-code-modal-backdrop"></div>
    <div class="lc-code-modal-content">
      <div class="lc-code-block-header">
        <span class="lc-code-block-lang" id="lcCodeModalLang">CPP</span>
        <div class="lc-code-block-actions">
          <button class="lc-code-block-copy-btn" id="lcCodeModalCopy">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
          <button class="lc-code-modal-close-btn" id="lcCodeModalClose">Close</button>
        </div>
      </div>
      <pre class="lc-markdown-code-block"><code id="lcCodeModalCode"></code></pre>
    </div>
  `;
  shadowRoot.appendChild(modalElement);

  // Bind modal close buttons
  const backdrop = modalElement.querySelector('.lc-code-modal-backdrop');
  const closeBtn = modalElement.querySelector('#lcCodeModalClose');
  backdrop?.addEventListener('click', closeCodeModal);
  closeBtn?.addEventListener('click', closeCodeModal);

  // Bind modal copy button
  const modalCopyBtn = modalElement.querySelector('#lcCodeModalCopy') as HTMLElement | null;
  modalCopyBtn?.addEventListener('click', () => {
    const codeEncoded = modalCopyBtn.getAttribute('data-code');
    if (codeEncoded) {
      const code = decodeURIComponent(codeEncoded);
      navigator.clipboard.writeText(code).then(() => {
        const originalHTML = modalCopyBtn.innerHTML;
        modalCopyBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Copied!
        `;
        modalCopyBtn.style.color = '#22c55e';
        setTimeout(() => {
          modalCopyBtn.innerHTML = originalHTML;
          modalCopyBtn.style.color = '';
        }, 2000);
      });
    }
  });

  applySettings();
}

/**
 * Periodically observes changes in LeetCode's URL to handle SPA navigation.
 */
function startUrlObserver() {
  setInterval(() => {
    const match = window.location.href.match(/problems\/([^/]+)/);
    const slug = match ? match[1] : '';
    if (slug && slug !== currentSlug && slug !== 'all') {
      currentSlug = slug;
      onProblemChanged(slug);
    }
  }, 1000);
}

/**
 * Handles detection of a new LeetCode problem.
 */
function onProblemChanged(slug: string) {
  console.log('LeetCode Companion: Problem changed. New slug:', slug);
  selectedCompanyFilter = null;
  // Put sidebar into loading state
  currentData = null;
  renderSidebarContent();

  // Try scraping details from the page as fallback parameters
  setTimeout(() => {
    const title = scrapeTitle(slug);
    const difficulty = scrapeDifficulty();
    const topics = scrapeTopics();

    const currentProblem: CurrentProblem = {
      id: 0, // Will be matched in background script if inside db
      title,
      slug,
      difficulty,
      topics,
      url: window.location.href,
      detectedAt: Date.now()
    };

    chrome.runtime.sendMessage({
      type: 'PROBLEM_DETECTED',
      payload: currentProblem
    }, (response: SidebarData) => {
      console.log('LeetCode Companion: Received direct response from background:', response);
      if (response) {
        currentData = response;
        renderSidebarContent();
      } else {
        console.warn('LeetCode Companion: Received empty response from background.');
      }
    });
  }, 1500); // Wait slightly for LeetCode to render dynamic components
}

/**
 * Scrapes problem title from page title or DOM.
 */
function scrapeTitle(slug: string): string {
  let pageTitle = document.title || '';
  if (pageTitle.includes(' - LeetCode')) {
    pageTitle = pageTitle.replace(' - LeetCode', '');
  }
  const match = pageTitle.match(/^\d+\.\s*(.*)$/);
  if (match) return match[1].trim();

  // Try format slug: "two-sum" -> "Two Sum"
  return slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Scrapes problem difficulty from LeetCode DOM styles/texts.
 */
function scrapeDifficulty(): 'Easy' | 'Medium' | 'Hard' {
  const elements = Array.from(document.querySelectorAll('*'));
  for (const el of elements) {
    if (el.children.length === 0 && el.textContent) {
      const txt = el.textContent.trim();
      if (txt === 'Easy') return 'Easy';
      if (txt === 'Medium') return 'Medium';
      if (txt === 'Hard') return 'Hard';
    }
  }
  return 'Easy';
}

/**
 * Scrapes topics/tags from LeetCode page.
 */
function scrapeTopics(): string[] {
  const topics: string[] = [];
  const tagElements = document.querySelectorAll('a[href^="/tag/"]');
  tagElements.forEach(el => {
    if (el.textContent) {
      topics.push(el.textContent.trim());
    }
  });
  return topics;
}

/**
 * Toggles the sidebar display.
 */
function toggleSidebar() {
  if (!sidebarElement) return;
  isSidebarOpen = !isSidebarOpen;
  if (isSidebarOpen) {
    sidebarElement.classList.add('open');
    toggleButton?.classList.add('active');
    renderSidebarContent();
  } else {
    sidebarElement.classList.remove('open');
    toggleButton?.classList.remove('active');
  }
}

/**
 * Applies the extension settings (Theme, Alignment) to the elements.
 */
function applySettings() {
  if (!sidebarElement || !toggleButton) return;

  // Position alignment
  sidebarElement.className = `lc-sidebar ${settings.sidebarPosition} ${isSidebarOpen ? 'open' : ''}`;
  toggleButton.className = `lc-toggle-btn ${settings.sidebarPosition} ${isSidebarOpen ? 'active' : ''}`;

  // Theme support
  let resolvedTheme = settings.theme;
  if (resolvedTheme === 'auto') {
    resolvedTheme = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark') ? 'dark' : 'light';
  }

  if (resolvedTheme === 'dark') {
    sidebarElement.classList.add('theme-dark');
    sidebarElement.classList.remove('theme-light');
    if (modalElement) {
      modalElement.classList.add('theme-dark');
      modalElement.classList.remove('theme-light');
    }
  } else {
    sidebarElement.classList.add('theme-light');
    sidebarElement.classList.remove('theme-dark');
    if (modalElement) {
      modalElement.classList.add('theme-light');
      modalElement.classList.remove('theme-dark');
    }
  }
}

/**
 * Formats a percentage.
 */
function formatPercent(val?: number): string {
  if (val === undefined) return 'N/A';
  return `${val.toFixed(1)}%`;
}

/**
 * Render complete sidebar DOM elements.
 */
function renderSidebarContent() {
  if (!sidebarElement) return;

  // Show loading spinner if no data is loaded yet
  if (!currentData) {
    sidebarElement.innerHTML = `
      <div class="lc-header">
        <div class="lc-header-title">LeetCode Companion</div>
        <button class="lc-close-btn">&times;</button>
      </div>
      <div class="lc-loading-container">
        <div class="lc-spinner"></div>
        <div class="lc-loading-text">Analyzing LeetCode problem...</div>
      </div>
    `;
    sidebarElement.querySelector('.lc-close-btn')?.addEventListener('click', toggleSidebar);
    return;
  }

  const { currentProblem, relatedProblems, companyInsights, contestHistory, pairFrequency, nextPredictions } = currentData;
  const isBookmarked = bookmarks.includes(currentProblem.slug);
  const todayDateStr = getLocalDateString();
  const isSolvedToday = streak.solvedHistory.some(p => p.slug === currentProblem.slug && p.dateString === todayDateStr);

  let htmlContent = `
    <!-- Header -->
    <div class="lc-header">
      <div class="lc-meta-section">
        <span class="lc-id-badge">#${currentProblem.id || '???'}</span>
        <span class="lc-diff-badge ${currentProblem.difficulty.toLowerCase()}">${currentProblem.difficulty}</span>
        ${streak.currentStreak > 0 ? `
          <span class="lc-streak-badge" title="Your current solve streak! Keep it up!">
            🔥 ${streak.currentStreak} Day${streak.currentStreak === 1 ? '' : 's'}
          </span>
        ` : ''}
      </div>
      <div class="lc-title-row">
        <h2 class="lc-problem-title" title="${currentProblem.title}">${currentProblem.title}</h2>
        <div class="lc-action-btns">
          <button class="lc-solve-btn ${isSolvedToday ? 'active' : ''}" title="${isSolvedToday ? 'Solved Today! Click to undo.' : 'Mark as Solved Today'}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
          <button class="lc-bookmark-btn ${isBookmarked ? 'active' : ''}" title="${isBookmarked ? 'Remove Bookmark' : 'Bookmark Problem'}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </button>
          <button class="lc-close-btn" title="Close Sidebar">&times;</button>
        </div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="lc-tabs">
      <button class="lc-tab-link ${activeTabId === 'similar-problems' ? 'active' : ''}" data-tab="similar-problems">Similar</button>
      <button class="lc-tab-link ${activeTabId === 'companies' ? 'active' : ''}" data-tab="companies">Companies</button>
      <button class="lc-tab-link ${activeTabId === 'patterns' ? 'active' : ''}" data-tab="patterns">Patterns</button>
      <button class="lc-tab-link ${activeTabId === 'ai-review' ? 'active' : ''}" data-tab="ai-review">AI Review</button>
    </div>

    <div class="lc-scrollable-content">
  `;

  if (currentData.error) {
    htmlContent += `
      <div class="lc-error-banner" style="background: rgba(239, 68, 68, 0.12); color: #f43f5e; padding: 10px 12px; margin-bottom: 16px; border-radius: 8px; font-size: 11px; border: 1px solid rgba(244, 63, 94, 0.25); line-height: 1.4;">
        ⚠️ <strong>Error:</strong> ${currentData.error}
      </div>
    `;
  }

  // --- TAB 1: RELATED PROBLEMS ---
  if (activeTabId === 'similar-problems') {
    htmlContent += `<div class="lc-tab-panel active">`;
    
    if (settings.showRelatedProblems) {
      htmlContent += `
        <div class="lc-section-header">Recommended Similar Problems</div>
      `;

      if (relatedProblems.length === 0) {
        htmlContent += `<div class="lc-empty-state">No similar problems found in database.</div>`;
      } else {
        htmlContent += `<div class="lc-problems-list">`;
        relatedProblems.forEach(prob => {
          const relationPercent = Math.round(prob.relationScore * 100);
          const badgeClass = prob.difficulty.toLowerCase();
          const listBadges = [];
          if (prob.isBlind75) listBadges.push('<span class="lc-list-badge b75" title="Blind 75">B75</span>');
          if (prob.isNeetcode) listBadges.push('<span class="lc-list-badge nc" title="Neetcode 150">NC</span>');
          if (prob.isGrind75) listBadges.push('<span class="lc-list-badge g75" title="Grind 75">G75</span>');

          htmlContent += `
            <div class="lc-problem-card">
              <div class="lc-card-row">
                <a href="${prob.url}" class="lc-card-title" target="_blank">${prob.title}</a>
                <span class="lc-score-badge" style="background: hsla(${relationPercent}, 80%, 40%, 0.15); color: hsl(${relationPercent}, 80%, 45%);">
                  ${relationPercent}% Match
                </span>
              </div>
              <div class="lc-card-row mini">
                <span class="lc-diff-badge-mini ${badgeClass}">${prob.difficulty}</span>
                <div class="lc-list-badges-row">${listBadges.join('')}</div>
              </div>
              <div class="lc-card-explanation">${prob.relationExplanation}</div>
            </div>
          `;
        });
        htmlContent += `</div>`;
      }
    } else {
      htmlContent += `<div class="lc-empty-state">Similar problems are disabled in settings.</div>`;
    }
    
    htmlContent += `</div>`;
  }

  // --- TAB 2: COMPANY INSIGHTS ---
  if (activeTabId === 'companies') {
    htmlContent += `<div class="lc-tab-panel active">`;

    if (settings.showCompanyInsights) {
      if (selectedCompanyFilter) {
        // Render sub-view of company problems
        const probs = getProblemsByCompany([selectedCompanyFilter as CompanyTag]);
        const sortedProbs = probs
          .sort((a, b) => (b.frequency || 0) - (a.frequency || 0));

        htmlContent += `
          <button class="lc-company-back-btn">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            Back to problem insights
          </button>
          <div class="lc-section-header">Top Asked at ${selectedCompanyFilter}</div>
        `;

        if (sortedProbs.length === 0) {
          htmlContent += `<div class="lc-empty-state">No questions found in database.</div>`;
        } else {
          htmlContent += `<div class="lc-problems-list">`;
          sortedProbs.forEach(prob => {
            const badgeClass = prob.difficulty.toLowerCase();
            htmlContent += `
              <div class="lc-problem-card">
                <div class="lc-card-row">
                  <a href="${prob.url}" class="lc-card-title" target="_blank">${prob.title}</a>
                  <span class="lc-company-tag">${prob.frequency || 0}% Freq</span>
                </div>
                <div class="lc-card-row mini" style="margin-top: 4px;">
                  <span class="lc-diff-badge-mini ${badgeClass}">${prob.difficulty}</span>
                </div>
              </div>
            `;
          });
          htmlContent += `</div>`;
        }
      } else {
        // Render normal list of companies
        htmlContent += `
          <div class="lc-section-header">Company Frequency Metrics</div>
          <div class="lc-company-search-box">
            <input type="text" class="lc-company-search-input" placeholder="Search other companies..." autocomplete="off">
            <div class="lc-company-suggestions"></div>
          </div>
          <div class="lc-section-subinfo" style="font-size: 10px; opacity: 0.5; margin-top: -8px; margin-bottom: 12px;">💡 Click any company to browse its top interview questions.</div>
        `;

        if (companyInsights.length === 0) {
          htmlContent += `<div class="lc-empty-state">No company insights found for this problem.</div>`;
        } else {
          htmlContent += `<div class="lc-company-list">`;
          const maxFreq = Math.max(...companyInsights.map(c => c.frequency));

          companyInsights.forEach(insight => {
            const pct = maxFreq > 0 ? (insight.frequency / maxFreq) * 100 : 0;
            htmlContent += `
              <div class="lc-company-row lc-company-row-clickable" data-company="${insight.company}">
                <div class="lc-company-info">
                  <span class="lc-company-name">${insight.company}</span>
                  <span class="lc-company-count">${insight.frequency} times</span>
                </div>
                <div class="lc-bar-wrapper">
                  <div class="lc-bar-fill" style="width: ${pct}%;"></div>
                </div>
                <div class="lc-company-meta-tags">
                  <span class="lc-company-tag round">${insight.round}</span>
                  <span class="lc-company-tag recency">${insight.recency}</span>
                </div>
              </div>
            `;
          });
          htmlContent += `</div>`;
        }
      }
    } else {
      htmlContent += `<div class="lc-empty-state">Company insights are disabled in settings.</div>`;
    }

    htmlContent += `</div>`;
  }

  // --- TAB 3: PATTERNS & PREDICTIONS ---
  if (activeTabId === 'patterns') {
    htmlContent += `<div class="lc-tab-panel active">`;

    // Generate the last 7 days activity grid
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const last7Days: { name: string; dateStr: string; isSolved: boolean }[] = [];
    const nowTimestamp = Date.now();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(nowTimestamp - i * 24 * 60 * 60 * 1000);
      const dayOffset = d.getTimezoneOffset();
      const localD = new Date(d.getTime() - (dayOffset * 60 * 1000));
      const dateStr = localD.toISOString().split('T')[0];
      const name = daysOfWeek[d.getDay()];
      const isSolved = streak.solvedHistory.some(p => p.dateString === dateStr);
      last7Days.push({ name, dateStr, isSolved });
    }

    const gridHtml = last7Days.map(day => `
      <div class="lc-activity-day ${day.isSolved ? 'solved' : ''}" title="${day.dateStr}${day.isSolved ? ': Solved!' : ': No solves'}">
        <span class="lc-activity-day-name">${day.name[0]}</span>
        <div class="lc-activity-day-block"></div>
      </div>
    `).join('');

    htmlContent += `
      <div class="lc-streak-container">
        <div class="lc-streak-card">
          <div class="lc-streak-header">
            <span class="lc-streak-card-title">Daily Practice Streak</span>
            <span class="lc-streak-card-badge">${streak.currentStreak} Day${streak.currentStreak === 1 ? '' : 's'}</span>
          </div>
          <div class="lc-streak-body">
            <div class="lc-streak-main-value">
              <span class="lc-streak-number">${streak.currentStreak}</span>
              <span class="lc-streak-fire">🔥</span>
            </div>
            <div class="lc-streak-message">
              ${streak.currentStreak > 0 
                ? `You're on a roll! Keep solving daily to build your practice habit!` 
                : `Solve a problem today to kickstart your practice streak! 🚀`}
            </div>
          </div>
          <div class="lc-activity-grid">
            ${gridHtml}
          </div>
        </div>
      </div>
    `;

    // 1. Contest History
    if (settings.showContestHistory && contestHistory && contestHistory.length > 0) {
      htmlContent += `
        <div class="lc-section-header">Contest History</div>
        <div class="lc-contest-card">
          <div class="lc-contest-row">
            <span class="lc-contest-name">${contestHistory[0].contestName}</span>
            <span class="lc-contest-pos">Q${contestHistory[0].problemPosition}</span>
          </div>
          <div class="lc-contest-date">${contestHistory[0].contestDate}</div>
        </div>
      `;
    }

    // 2. Next Predictions
    if (settings.showPredictions && nextPredictions && nextPredictions.length > 0) {
      htmlContent += `
        <div class="lc-section-header">Next Recommended Step</div>
        <div class="lc-prediction-card">
          <div class="lc-prediction-header">
            <a href="${nextPredictions[0].url}" class="lc-pred-title" target="_blank">${nextPredictions[0].title}</a>
            <span class="lc-diff-badge-mini ${nextPredictions[0].difficulty.toLowerCase()}">${nextPredictions[0].difficulty}</span>
          </div>
          <div class="lc-pred-desc">${nextPredictions[0].relationExplanation}</div>
          <div class="lc-pred-action-row">
            <a href="${nextPredictions[0].url}" target="_blank" class="lc-pred-btn">
              Solve Next
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </a>
          </div>
        </div>
      `;
    }

    // 3. Paired Frequency
    if (settings.showPairFrequency && pairFrequency && pairFrequency.length > 0) {
      htmlContent += `
        <div class="lc-section-header">Frequently Asked Together</div>
        <div class="lc-paired-list">
      `;
      pairFrequency.forEach(prob => {
        htmlContent += `
          <div class="lc-paired-item">
            <a href="${prob.url}" class="lc-paired-title" target="_blank">${prob.title}</a>
            <span class="lc-diff-badge-mini ${prob.difficulty.toLowerCase()}">${prob.difficulty}</span>
          </div>
        `;
      });
      htmlContent += `</div>`;
    }

    htmlContent += `</div>`;
  }

  // --- TAB 4: AI REVIEW ---
  if (activeTabId === 'ai-review') {
    // Dynamically sync code before render if not focused
    const currentCode = scrapeCodeFromPage();
    if (currentCode) {
      if (shadowRoot) {
        const textarea = shadowRoot.querySelector('.lc-review-textarea') as HTMLTextAreaElement | null;
        if (!textarea || (document.activeElement !== textarea && shadowRoot.activeElement !== textarea)) {
          lastScrapedCode = currentCode;
        }
      } else {
        lastScrapedCode = currentCode;
      }
    }

    htmlContent += `<div class="lc-tab-panel active">`;
    
    const apiKey = settings.geminiApiKey;
    if (!apiKey) {
      htmlContent += `
        <div class="lc-section-header">AI Code Review & Optimizer</div>
        <div class="lc-empty-state" style="border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.02); color: #f43f5e; opacity: 1; padding: 16px; font-weight: 500; text-align: left; line-height: 1.4;">
          ⚠️ <strong>API Key Missing</strong><br><br>
          Please configure your Gemini API Key in the extension settings popup (click the LeetCode Companion icon in your toolbar) to enable the AI Reviewer.
        </div>
      `;
    } else {
      htmlContent += `
        <div class="lc-section-header">AI Code Review & Optimizer</div>
        <div class="lc-review-container">
          <div style="font-size: 11px; opacity: 0.6; margin-bottom: 8px;">Your code is dynamically synced from the LeetCode editor. Click analyze to get feedback.</div>
          
          <div class="lc-review-action-row" style="margin-bottom: 10px;">
            <button class="lc-review-action-btn analyze" style="width: 100%; background: #6366f1; color: white; justify-content: center;">
              🚀 Run AI Analysis
            </button>
          </div>

          <textarea class="lc-review-textarea" placeholder="Your solution code will automatically sync here..." spellcheck="false">${lastScrapedCode}</textarea>
          
          <div class="lc-review-output" style="margin-top: 16px;"></div>
        </div>
      `;
    }

    htmlContent += `</div>`;
  }

  htmlContent += `
    </div> <!-- scrollable content -->
  `;

  sidebarElement.innerHTML = htmlContent;

  // Bind Event Listeners
  sidebarElement.querySelector('.lc-close-btn')?.addEventListener('click', toggleSidebar);
  
  sidebarElement.querySelector('.lc-bookmark-btn')?.addEventListener('click', () => {
    toggleBookmark(currentProblem.slug);
  });

  sidebarElement.querySelector('.lc-solve-btn')?.addEventListener('click', () => {
    toggleSolved(currentProblem.slug, currentProblem.title, currentProblem.difficulty);
  });

  const tabLinks = sidebarElement.querySelectorAll('.lc-tab-link');
  tabLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const targetTab = (e.target as HTMLElement).getAttribute('data-tab');
      if (targetTab) {
        activeTabId = targetTab;
        renderSidebarContent();
      }
    });
  });

  // Bind company row clicks
  const companyRows = sidebarElement.querySelectorAll('.lc-company-row-clickable');
  companyRows.forEach(row => {
    row.addEventListener('click', () => {
      const comp = row.getAttribute('data-company');
      if (comp) {
        selectedCompanyFilter = comp;
        renderSidebarContent();
      }
    });
  });

  // Bind back button click
  const backBtn = sidebarElement.querySelector('.lc-company-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      selectedCompanyFilter = null;
      renderSidebarContent();
    });
  }

  // Bind company search autocomplete inside sidebar
  const searchInput = sidebarElement.querySelector('.lc-company-search-input') as HTMLInputElement | null;
  const suggestionsContainer = sidebarElement.querySelector('.lc-company-suggestions') as HTMLDivElement | null;

  if (searchInput && suggestionsContainer) {
    let sidebarActiveIndex = -1;
    let sidebarFiltered: string[] = [];

    const showSidebarSuggestions = (list: string[]) => {
      sidebarFiltered = list;
      if (list.length === 0) {
        suggestionsContainer.style.display = 'none';
        return;
      }
      suggestionsContainer.innerHTML = '';
      list.forEach((comp, idx) => {
        const item = document.createElement('div');
        item.className = 'lc-company-suggestion-item';
        if (idx === sidebarActiveIndex) {
          item.classList.add('active-selection');
        }
        item.textContent = comp;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          selectSidebarCompany(comp);
        });
        suggestionsContainer.appendChild(item);
      });
      suggestionsContainer.style.display = 'block';
    };

    const selectSidebarCompany = (companyName: string) => {
      selectedCompanyFilter = companyName;
      sidebarActiveIndex = -1;
      renderSidebarContent();
    };

    searchInput.addEventListener('input', () => {
      const val = searchInput.value.trim().toLowerCase();
      sidebarActiveIndex = -1;
      if (!val) {
        showSidebarSuggestions([]);
        return;
      }
      const matched = UNIQUE_COMPANIES.filter(c => c.toLowerCase().includes(val));
      showSidebarSuggestions(matched);
    });

    searchInput.addEventListener('focus', () => {
      const val = searchInput.value.trim().toLowerCase();
      const matched = val 
        ? UNIQUE_COMPANIES.filter(c => c.toLowerCase().includes(val))
        : UNIQUE_COMPANIES;
      showSidebarSuggestions(matched);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (suggestionsContainer.style.display === 'none') return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        sidebarActiveIndex = (sidebarActiveIndex + 1) % sidebarFiltered.length;
        showSidebarSuggestions(sidebarFiltered);
        const activeEl = suggestionsContainer.children[sidebarActiveIndex] as HTMLElement;
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        sidebarActiveIndex = (sidebarActiveIndex - 1 + sidebarFiltered.length) % sidebarFiltered.length;
        showSidebarSuggestions(sidebarFiltered);
        const activeEl = suggestionsContainer.children[sidebarActiveIndex] as HTMLElement;
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (sidebarActiveIndex >= 0 && sidebarActiveIndex < sidebarFiltered.length) {
          selectSidebarCompany(sidebarFiltered[sidebarActiveIndex]);
        } else if (sidebarFiltered.length > 0) {
          selectSidebarCompany(sidebarFiltered[0]);
        }
      } else if (e.key === 'Escape') {
        suggestionsContainer.style.display = 'none';
        sidebarActiveIndex = -1;
      }
    });

    const closeSuggestionsHandler = (e: MouseEvent) => {
      const path = e.composedPath();
      if (!path.includes(searchInput) && !path.includes(suggestionsContainer)) {
        suggestionsContainer.style.display = 'none';
        sidebarActiveIndex = -1;
        document.removeEventListener('click', closeSuggestionsHandler);
      }
    };
    searchInput.addEventListener('focus', () => {
      document.addEventListener('click', closeSuggestionsHandler);
    });
  }

  // Bind AI Review UI actions
  if (activeTabId === 'ai-review') {
    const textarea = sidebarElement.querySelector('.lc-review-textarea') as HTMLTextAreaElement | null;
    const outputDiv = sidebarElement.querySelector('.lc-review-output') as HTMLDivElement | null;
    const analyzeBtn = sidebarElement.querySelector('.lc-review-action-btn.analyze');

    if (textarea) {
      textarea.addEventListener('input', () => {
        lastScrapedCode = textarea.value;
      });
    }

    if (outputDiv) {
      if (isAnalyzingCode) {
        outputDiv.innerHTML = `
          <div class="lc-loading-container" style="padding: 24px 0;">
            <div class="lc-spinner"></div>
            <div class="lc-loading-text" style="font-weight: 600; background: linear-gradient(135deg, #818cf8 0%, #c084fc 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Analyzing code... Acting as FAANG interviewer</div>
          </div>
        `;
      } else if (analysisError) {
        outputDiv.innerHTML = `
          <div class="lc-empty-state" style="border-color: rgba(239, 68, 68, 0.25); background: rgba(239, 68, 68, 0.05); color: #f43f5e; opacity: 1; text-align: left; padding: 14px;">
            ❌ <strong>Error:</strong> ${analysisError}
          </div>
        `;
      } else if (lastAnalysisResult) {
        outputDiv.innerHTML = `
          <div class="lc-markdown-output">
            ${parseMarkdown(lastAnalysisResult)}
          </div>
        `;
      }
    }

    if (analyzeBtn && textarea) {
      analyzeBtn.addEventListener('click', () => {
        const code = textarea.value.trim();
        if (!code) {
          alert('Please enter your code first.');
          return;
        }

        isAnalyzingCode = true;
        analysisError = '';
        lastAnalysisResult = '';
        renderSidebarContent(); // re-render to show loading state

        chrome.runtime.sendMessage({
          type: 'ANALYZE_CODE',
          payload: {
            code,
            currentProblem
          }
        });
      });
    }
  }

  // Bind Code Block copy and expand buttons inside AI Review tab
  if (activeTabId === 'ai-review' && sidebarElement) {
    const copyButtons = sidebarElement.querySelectorAll('.lc-code-block-copy-btn');
    copyButtons.forEach(button => {
      const btn = button as HTMLElement;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const codeEncoded = btn.getAttribute('data-code');
        if (codeEncoded) {
          const code = decodeURIComponent(codeEncoded);
          navigator.clipboard.writeText(code).then(() => {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              Copied!
            `;
            btn.style.color = '#22c55e';
            setTimeout(() => {
              btn.innerHTML = originalHTML;
              btn.style.color = '';
            }, 2000);
          });
        }
      });
    });

    const expandButtons = sidebarElement.querySelectorAll('.lc-code-block-expand-btn');
    expandButtons.forEach(button => {
      const btn = button as HTMLElement;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const codeEncoded = btn.getAttribute('data-code');
        const lang = btn.getAttribute('data-lang') || 'CODE';
        if (codeEncoded) {
          const code = decodeURIComponent(codeEncoded);
          openCodeModal(code, lang);
        }
      });
    });
  }
}

/**
 * Scrapes the code from Monaco Editor (.view-line) or CodeMirror (.CodeMirror-code).
 */
function scrapeCodeFromPage(): string {
  // Query all line elements inside Monaco editor
  const viewLines = document.querySelectorAll('.view-line');
  if (viewLines.length > 0) {
    return Array.from(viewLines).map(line => line.textContent || '').join('\n');
  }

  // Fallback for CodeMirror
  const codeMirror = document.querySelector('.CodeMirror-code');
  if (codeMirror) {
    return codeMirror.textContent || '';
  }

  return '';
}

/**
 * A lightweight markdown parser to convert headers, list items, bold texts, and code blocks into HTML.
 */
function parseMarkdown(text: string): string {
  if (!text) return '';

  // Escapes HTML entities
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // ── Extract and render [RATING:Label:X/10] tokens ──
  const ratingRegex = /\[RATING:([^:]+):(\d+)\/10\]/g;
  const ratings: { label: string; score: number }[] = [];
  let ratingMatch;
  while ((ratingMatch = ratingRegex.exec(html)) !== null) {
    ratings.push({ label: ratingMatch[1].trim(), score: parseInt(ratingMatch[2], 10) });
  }
  // Remove rating tokens from text flow including trailing newlines
  html = html.replace(/\[RATING:[^\]]+\]\r?\n?/g, '');

  let ratingsHtml = '';
  if (ratings.length > 0) {
    const getColor = (score: number): string => {
      if (score >= 9) return '#22c55e';
      if (score >= 7) return '#3b82f6';
      if (score >= 5) return '#f59e0b';
      if (score >= 3) return '#f97316';
      return '#ef4444';
    };
    const getLabel = (score: number): string => {
      if (score >= 9) return 'Excellent';
      if (score >= 7) return 'Good';
      if (score >= 5) return 'Average';
      if (score >= 3) return 'Needs Work';
      return 'Poor';
    };

    // Separate the Overall rating from dimension ratings
    const overallIdx = ratings.findIndex(r => r.label.toLowerCase() === 'overall');
    let overallRating: { label: string; score: number } | null = null;
    const dimensionRatings = [...ratings];
    if (overallIdx !== -1) {
      overallRating = dimensionRatings.splice(overallIdx, 1)[0];
    }

    let overallHtml = '';
    if (overallRating) {
      const oColor = getColor(overallRating.score);
      const oPercent = overallRating.score * 10;
      const circumference = 2 * Math.PI * 38;
      const dashOffset = circumference - (oPercent / 100) * circumference;
      overallHtml = `
        <div class="lc-rating-overall">
          <div class="lc-rating-ring-wrap">
            <svg viewBox="0 0 84 84" class="lc-rating-ring-svg">
              <circle cx="42" cy="42" r="38" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="4"/>
              <circle cx="42" cy="42" r="38" fill="none" stroke="${oColor}" stroke-width="4"
                stroke-linecap="round" stroke-dasharray="${circumference.toFixed(1)}"
                stroke-dashoffset="${dashOffset.toFixed(1)}"
                transform="rotate(-90 42 42)"
                class="lc-rating-ring-progress"/>
            </svg>
            <div class="lc-rating-ring-score" style="color: ${oColor};">${overallRating.score}</div>
          </div>
          <div class="lc-rating-overall-text">
            <span class="lc-rating-overall-label">Overall Score</span>
            <span class="lc-rating-overall-quality" style="color: ${oColor};">${getLabel(overallRating.score)}</span>
          </div>
        </div>`;
    }

    let dimensionsHtml = dimensionRatings.map(r => {
      const color = getColor(r.score);
      const percent = r.score * 10;
      return `
        <div class="lc-rating-item">
          <div class="lc-rating-item-header">
            <span class="lc-rating-item-label">${r.label}</span>
            <span class="lc-rating-item-score" style="color: ${color};">${r.score}<span class="lc-rating-item-max">/10</span></span>
          </div>
          <div class="lc-rating-bar-track">
            <div class="lc-rating-bar-fill" style="width: ${percent}%; background: ${color};"></div>
          </div>
          <span class="lc-rating-item-quality" style="color: ${color};">${getLabel(r.score)}</span>
        </div>`;
    }).join('');

    ratingsHtml = `<div class="lc-ratings-card">${overallHtml}<div class="lc-ratings-grid">${dimensionsHtml}</div></div>`;
  }

  // Code blocks: ```cpp ... ``` with optional language, allowing unclosed block at end of text
  html = html.replace(/```([a-zA-Z0-9+#]*)\s*\r?\n([\s\S]*?)(?:\r?\n```|$)/g, (match, lang, code) => {
    const displayLang = lang ? lang.toUpperCase() : 'CODE';
    const rawCode = decodeEntities(code);
    const highlighted = highlightCode(rawCode, displayLang);
    return `
      <div class="lc-code-block-container">
        <div class="lc-code-block-header">
          <span class="lc-code-block-lang">${displayLang}</span>
          <div class="lc-code-block-actions">
            <button class="lc-code-block-expand-btn" data-code="${encodeURIComponent(rawCode)}" data-lang="${displayLang}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
              Expand
            </button>
            <button class="lc-code-block-copy-btn" data-code="${encodeURIComponent(rawCode)}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copy
            </button>
          </div>
        </div>
        <pre class="lc-markdown-code-block"><code>${highlighted}</code></pre>
      </div>
    `;
  });

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="lc-markdown-inline-code">$1</code>');

  // Headers: ###, ##, #
  html = html.replace(/^### (.*$)/gim, '<h3 class="lc-markdown-h3">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="lc-markdown-h2">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="lc-markdown-h1">$1</h1>');

  // Headers: bold text mapping
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Replace Markdown divider lines
  html = html.replace(/^(?:---|━━━*)$/gm, '<hr class="lc-markdown-hr">');

  // Bullet points
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li class="lc-markdown-li">$1</li>');

  // Wrap loose list items in a single ul list
  html = html.replace(/((?:<li class="lc-markdown-li">[\s\S]*?<\/li>\s*)+)/g, '<ul class="lc-markdown-ul">$1</ul>');

  // Line breaks for general text, preserving HTML tags
  const segments = html.split(/(<div class="lc-code-block-container"[\s\S]*?<\/pre>\s*<\/div>)/);
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].startsWith('<div class="lc-code-block-container"')) {
      segments[i] = segments[i].replace(/\r?\n/g, '<br>');
    }
  }
  html = segments.join('');

  // Inject ratings card at the top of the output
  if (ratingsHtml) {
    html = ratingsHtml + html;
  }

  return html;
}

/**
 * Bookmark toggle execution.
 */
function toggleBookmark(slug: string) {
  let updatedBookmarks = [...bookmarks];
  const idx = updatedBookmarks.indexOf(slug);
  if (idx > -1) {
    updatedBookmarks.splice(idx, 1);
  } else {
    updatedBookmarks.push(slug);
  }

  chrome.storage.local.set({ bookmarks: updatedBookmarks }, () => {
    bookmarks = updatedBookmarks;
    renderSidebarContent();
  });
}

/**
 * Gets local date string in YYYY-MM-DD format.
 */
function getLocalDateString(): string {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
}

/**
 * Calculates current consecutive streak from sorted unique date strings.
 */
function calculateStreakFromDates(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sortedDates = [...dates].sort();
  const todayStr = getLocalDateString();
  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayOffset = yesterday.getTimezoneOffset();
  const yesterdayLocal = new Date(yesterday.getTime() - (yesterdayOffset * 60 * 1000));
  const yesterdayStr = yesterdayLocal.toISOString().split('T')[0];

  const lastDate = sortedDates[sortedDates.length - 1];
  if (lastDate !== todayStr && lastDate !== yesterdayStr) {
    return 0;
  }

  let currentStreak = 1;
  for (let i = sortedDates.length - 1; i > 0; i--) {
    const currStr = sortedDates[i];
    const prevStr = sortedDates[i - 1];
    
    const curr = new Date(currStr);
    const prev = new Date(prevStr);
    const diffTime = Math.abs(curr.getTime() - prev.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
      currentStreak++;
    } else if (diffDays > 1) {
      break;
    }
  }
  return currentStreak;
}

/**
 * Plays a beautiful CSS confetti explosion when solving a problem.
 */
function triggerCelebrationAnimation() {
  if (!sidebarElement) return;
  
  const solveBtn = sidebarElement.querySelector('.lc-solve-btn');
  if (solveBtn) {
    solveBtn.classList.add('lc-celebrate-pulse');
    setTimeout(() => solveBtn.classList.remove('lc-celebrate-pulse'), 800);
  }

  const header = sidebarElement.querySelector('.lc-header') as HTMLElement;
  if (header) {
    for (let i = 0; i < 20; i++) {
      const dot = document.createElement('div');
      dot.className = 'lc-confetti-dot';
      const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#f97316'];
      dot.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      dot.style.left = `${65 + (Math.random() - 0.5) * 20}%`;
      dot.style.top = `${40 + (Math.random() - 0.5) * 20}%`;
      dot.style.setProperty('--tx', `${(Math.random() - 0.5) * 240}px`);
      dot.style.setProperty('--ty', `${-(Math.random() * 160 + 60)}px`);
      dot.style.setProperty('--rot', `${Math.random() * 720}deg`);
      header.appendChild(dot);
      setTimeout(() => dot.remove(), 1200);
    }
  }
}

/**
 * Toggles solved state for the current problem and updates local daily streak.
 */
function toggleSolved(slug: string, title: string, difficulty: 'Easy' | 'Medium' | 'Hard') {
  chrome.storage.local.get(['streak'], (result) => {
    let currentStreakState: StreakState = result.streak || {
      currentStreak: 0,
      lastSolvedDate: '',
      solvedHistory: []
    };

    const today = getLocalDateString();
    const history = [...currentStreakState.solvedHistory];
    const existingIndex = history.findIndex(p => p.slug === slug && p.dateString === today);

    if (existingIndex > -1) {
      history.splice(existingIndex, 1);
      
      const solvedDates = Array.from(new Set(history.map(p => p.dateString))).sort();
      let newStreak = 0;
      let lastSolved = '';
      
      if (solvedDates.length > 0) {
        newStreak = calculateStreakFromDates(solvedDates);
        lastSolved = solvedDates[solvedDates.length - 1];
      }
      
      currentStreakState.currentStreak = newStreak;
      currentStreakState.lastSolvedDate = lastSolved;
      currentStreakState.solvedHistory = history;
    } else {
      const newSolved: SolvedProblem = {
        slug,
        title,
        difficulty,
        solvedAt: Date.now(),
        dateString: today
      };
      history.push(newSolved);

      const solvedDates = Array.from(new Set(history.map(p => p.dateString))).sort();
      let newStreak = calculateStreakFromDates(solvedDates);
      
      currentStreakState.currentStreak = newStreak;
      currentStreakState.lastSolvedDate = today;
      currentStreakState.solvedHistory = history;

      triggerCelebrationAnimation();
    }

    chrome.storage.local.set({ streak: currentStreakState }, () => {
      streak = currentStreakState;
      renderSidebarContent();
    });
  });
}

/**
 * Escapes HTML entities inside code block parsing.
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Decodes HTML entities to raw string for tokenization.
 */
function decodeEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Custom syntactic highlighting tokenizer.
 */
function highlightCode(code: string, lang: string): string {
  const isPython = ['PYTHON', 'PYTHON3', 'PY', 'RUBY', 'RB'].includes(lang.toUpperCase());
  
  // RegEx for tokens:
  // 1. Whitespace: (\s+)
  // 2. Single-line comment: (\/\/.*)
  // 3. Multi-line comment: (\/\*[\s\S]*?\*\/)
  // 4. Hash-comment/preprocessor: (#.*)
  // 5. Double-quoted string: ("(?:\\.|[^"\\])*")
  // 6. Single-quoted string: ('(?:\\.|[^'\\])*')
  // 7. Numbers: (\b\d+(?:\.\d+)?\b)
  // 8. Identifiers: (\b[a-zA-Z_]\w*\b)
  // 9. Symbols: ([^\w\s]+)
  const tokenRegex = /(\s+)|(\/\/.*)|(\/\*[\s\S]*?\*\/)|(#.*)|("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_]\w*\b)|([^\w\s]+)/g;
  
  const keywords = new Set([
    'class', 'struct', 'public', 'private', 'protected', 'int', 'float', 'double', 'char', 'bool', 'void', 'vector', 'string', 'unordered_map', 'unordered_set', 'map', 'set', 'pair', 'auto', 'const', 'while', 'if', 'else', 'for', 'return', 'true', 'false', 'namespace', 'using', 'template', 'typename', 'static', 'virtual', 'override', 'new', 'delete', 'null', 'nullptr', 'nil', 'def', 'self', 'import', 'from', 'as', 'in', 'and', 'or', 'not', 'is', 'lambda', 'elif', 'try', 'except', 'finally', 'raise', 'with', 'pass', 'break', 'continue', 'let', 'function', 'var', 'interface', 'type', 'package', 'func', 'fn', 'impl', 'use', 'pub', 'mut', 'async', 'await', 'extern'
  ]);

  interface Token {
    text: string;
    type: 'whitespace' | 'comment' | 'string' | 'number' | 'identifier' | 'symbol';
  }

  const tokens: Token[] = [];
  let match;
  
  tokenRegex.lastIndex = 0;
  while ((match = tokenRegex.exec(code)) !== null) {
    const [
      full,
      whitespace,
      slComment,
      mlComment,
      hashComment,
      dqString,
      sqString,
      number,
      identifier,
      symbol
    ] = match;

    if (whitespace !== undefined) {
      tokens.push({ text: whitespace, type: 'whitespace' });
    } else if (slComment !== undefined) {
      tokens.push({ text: slComment, type: 'comment' });
    } else if (mlComment !== undefined) {
      tokens.push({ text: mlComment, type: 'comment' });
    } else if (hashComment !== undefined) {
      if (isPython) {
        tokens.push({ text: hashComment, type: 'comment' });
      } else {
        if (hashComment.startsWith('#')) {
          tokens.push({ text: hashComment, type: 'identifier' });
        } else {
          tokens.push({ text: hashComment, type: 'symbol' });
        }
      }
    } else if (dqString !== undefined) {
      tokens.push({ text: dqString, type: 'string' });
    } else if (sqString !== undefined) {
      tokens.push({ text: sqString, type: 'string' });
    } else if (number !== undefined) {
      tokens.push({ text: number, type: 'number' });
    } else if (identifier !== undefined) {
      tokens.push({ text: identifier, type: 'identifier' });
    } else if (symbol !== undefined) {
      tokens.push({ text: symbol, type: 'symbol' });
    }
  }

  function getVariableColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `code-var-${Math.abs(hash) % 8}`;
  }

  let resultHtml = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    
    if (token.type === 'whitespace') {
      resultHtml += token.text;
    } else if (token.type === 'comment') {
      resultHtml += `<span class="code-comment">${escapeHTML(token.text)}</span>`;
    } else if (token.type === 'string') {
      resultHtml += `<span class="code-string">${escapeHTML(token.text)}</span>`;
    } else if (token.type === 'number') {
      resultHtml += `<span class="code-number">${escapeHTML(token.text)}</span>`;
    } else if (token.type === 'identifier') {
      const text = token.text;
      const lowerText = text.toLowerCase();
      if (text.startsWith('#')) {
        resultHtml += `<span class="code-keyword">${escapeHTML(text)}</span>`;
      } else if (keywords.has(text) || keywords.has(lowerText)) {
        resultHtml += `<span class="code-keyword">${escapeHTML(text)}</span>`;
      } else {
        let isFunc = false;
        for (let j = i + 1; j < tokens.length; j++) {
          if (tokens[j].type === 'whitespace') continue;
          if (tokens[j].type === 'symbol' && tokens[j].text.startsWith('(')) {
            isFunc = true;
          }
          break;
        }

        if (isFunc) {
          resultHtml += `<span class="code-function">${escapeHTML(text)}</span>`;
        } else {
          resultHtml += `<span class="${getVariableColor(text)}">${escapeHTML(text)}</span>`;
        }
      }
    } else if (token.type === 'symbol') {
      resultHtml += escapeHTML(token.text);
    }
  }

  return resultHtml;
}

/**
 * Open code modal window.
 */
function openCodeModal(code: string, lang: string) {
  if (!shadowRoot) return;
  const rootContainer = document.getElementById('leetcode-companion-root');
  if (rootContainer) {
    rootContainer.style.width = '100vw';
    rootContainer.style.height = '100vh';
  }

  const modal = shadowRoot.getElementById('lcCodeModal');
  const modalLang = shadowRoot.getElementById('lcCodeModalLang');
  const modalCode = shadowRoot.getElementById('lcCodeModalCode');
  const modalCopy = shadowRoot.getElementById('lcCodeModalCopy') as HTMLElement | null;

  if (modal && modalLang && modalCode) {
    modalLang.textContent = lang.toUpperCase();
    modalCode.innerHTML = highlightCode(code, lang);
    if (modalCopy) {
      modalCopy.setAttribute('data-code', encodeURIComponent(code));
    }
    modal.classList.add('active');
  }
}

/**
 * Close code modal window.
 */
function closeCodeModal() {
  if (!shadowRoot) return;
  const modal = shadowRoot.getElementById('lcCodeModal');
  if (modal) {
    modal.classList.remove('active');
  }

  const rootContainer = document.getElementById('leetcode-companion-root');
  if (rootContainer) {
    rootContainer.style.width = '0';
    rootContainer.style.height = '0';
  }
}

/**
 * Automatically detects green "Accepted" text on the LeetCode page to log a streak update!
 */
function detectAcceptedSubmission() {
  if (!currentSlug) return;
  const todayStr = getLocalDateString();
  
  // Skip if we already marked this solved today
  const alreadySolvedToday = streak.solvedHistory.some(p => p.slug === currentSlug && p.dateString === todayStr);
  if (alreadySolvedToday) return;

  // Query common green Accepted labels in LeetCode page
  const greenTexts = Array.from(document.querySelectorAll('.text-green-s, .text-success, [data-e2e-locator="submission-result"], .success__3ZPr'));
  const hasAccepted = greenTexts.some(el => el.textContent?.trim().includes('Accepted'));

  if (hasAccepted) {
    console.log('LeetCode Companion: Detected "Accepted" solution on page! Auto-marking solved to keep streak...');
    if (currentData && currentData.currentProblem) {
      const { slug, title, difficulty } = currentData.currentProblem;
      toggleSolved(slug, title, difficulty);
    }
  }
}

// Start core execution
init();
