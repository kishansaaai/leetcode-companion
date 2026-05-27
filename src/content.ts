import { getProblemsByCompany, PROBLEM_DB, ALL_COMPANIES } from './data/problemDatabase';
import type { 
  SidebarData, 
  CurrentProblem, 
  RelatedProblem, 
  CompanyInsight, 
  ContestInfo, 
  ExtensionSettings,
  LeetCodeProblem,
  CompanyTag
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

// Initialize Content Script
function init() {
  console.log('LeetCode Companion: Initializing content script...');
  // Read initial settings and bookmarks, then start URL observer
  chrome.storage.local.get(['settings', 'bookmarks'], (result) => {
    console.log('LeetCode Companion: Loaded settings from storage:', result.settings);
    if (result.settings) {
      settings = result.settings;
    }
    if (result.bookmarks) {
      bookmarks = result.bookmarks;
    }

    if (!settings.isEnabled) {
      console.log('LeetCode Companion: Extension is disabled in settings.');
      return;
    }

    createShadowDom();
    startUrlObserver();
  });

  // Listen to chrome storage changes to synchronize bookmarks/settings instantly
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = changes.settings.newValue;
      applySettings();
    }
    if (changes.bookmarks) {
      bookmarks = changes.bookmarks.newValue;
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
    }
  });
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
  } else {
    sidebarElement.classList.add('theme-light');
    sidebarElement.classList.remove('theme-dark');
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

  let htmlContent = `
    <!-- Header -->
    <div class="lc-header">
      <div class="lc-meta-section">
        <span class="lc-id-badge">#${currentProblem.id || '???'}</span>
        <span class="lc-diff-badge ${currentProblem.difficulty.toLowerCase()}">${currentProblem.difficulty}</span>
      </div>
      <div class="lc-title-row">
        <h2 class="lc-problem-title" title="${currentProblem.title}">${currentProblem.title}</h2>
        <div class="lc-action-btns">
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
          <div style="font-size: 11px; opacity: 0.6; margin-bottom: 8px;">Submit your code below or auto-extract it directly from your LeetCode code editor window.</div>
          
          <div class="lc-review-action-row" style="display: flex; gap: 8px; margin-bottom: 10px;">
            <button class="lc-review-action-btn scrape" style="flex: 1;">
              📥 Scrape Editor Code
            </button>
            <button class="lc-review-action-btn analyze" style="flex: 1; background: #6366f1; color: white;">
              🚀 Run AI Analysis
            </button>
          </div>

          <textarea class="lc-review-textarea" placeholder="Paste your solution code here (or click Scrape Editor Code)..." spellcheck="false">${lastScrapedCode}</textarea>
          
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
    const scrapeBtn = sidebarElement.querySelector('.lc-review-action-btn.scrape');
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

    if (scrapeBtn && textarea) {
      scrapeBtn.addEventListener('click', () => {
        const code = scrapeCodeFromPage();
        if (code) {
          lastScrapedCode = code;
          textarea.value = code;
        } else {
          alert('Failed to automatically locate LeetCode editor code. Please paste your code manually.');
        }
      });
    }

    if (analyzeBtn && textarea) {
      analyzeBtn.addEventListener('click', () => {
        const code = textarea.value.trim();
        if (!code) {
          alert('Please enter or scrape your code first.');
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
        }, (response) => {
          isAnalyzingCode = false;
          if (response?.error) {
            analysisError = response.error;
          } else if (response?.review) {
            lastAnalysisResult = response.review;
          } else {
            analysisError = 'Unknown response payload received.';
          }
          renderSidebarContent(); // re-render to display result
        });
      });
    }
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

  // Code blocks: ```cpp ... ```
  html = html.replace(/```(?:[a-zA-Z0-9+#]+)?\n([\s\S]*?)\n```/g, (match, code) => {
    return `<pre class="lc-markdown-code-block"><code>${code}</code></pre>`;
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
  const segments = html.split(/(<pre[\s\S]*?<\/pre>)/);
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].startsWith('<pre')) {
      segments[i] = segments[i].replace(/\n/g, '<br>');
    }
  }
  html = segments.join('');

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

// Start core execution
init();
