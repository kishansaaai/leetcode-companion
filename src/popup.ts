import { PROBLEM_DB, getProblemBySlug, getProblemsByCompany, ALL_COMPANIES } from './data/problemDatabase';
import type { ExtensionSettings, CompanyTag, StreakState } from './types';

// Global popup state
let settings: ExtensionSettings;
let bookmarks: string[] = [];
let streak: StreakState;

// DOM Elements
const isEnabledInput = document.getElementById('isEnabled') as HTMLInputElement;
const sidebarPositionSelect = document.getElementById('sidebarPosition') as HTMLSelectElement;
const themeSelect = document.getElementById('theme') as HTMLSelectElement;
const showRelatedProblemsInput = document.getElementById('showRelatedProblems') as HTMLInputElement;
const showCompanyInsightsInput = document.getElementById('showCompanyInsights') as HTMLInputElement;
const showPredictionsInput = document.getElementById('showPredictions') as HTMLInputElement;
const showPairFrequencyInput = document.getElementById('showPairFrequency') as HTMLInputElement;
const showContestHistoryInput = document.getElementById('showContestHistory') as HTMLInputElement;
const bookmarksListContainer = document.getElementById('bookmarksList') as HTMLDivElement;
const companySearchInput = document.getElementById('companySearchInput') as HTMLInputElement;
const companySuggestionsContainer = document.getElementById('companySuggestions') as HTMLDivElement;
const companyProblemsListContainer = document.getElementById('companyProblemsList') as HTMLDivElement;
const geminiApiKeyInput = document.getElementById('geminiApiKey') as HTMLInputElement;
const toggleApiKeyVisibilityBtn = document.getElementById('toggleApiKeyVisibility') as HTMLButtonElement;

// Use the complete list of 100+ companies
const UNIQUE_COMPANIES = ALL_COMPANIES;

// Initialize Popup
function init() {
  // Load settings, bookmarks, and streak from chrome storage
  chrome.storage.local.get(['settings', 'bookmarks', 'streak'], (result) => {
    if (result.settings) {
      settings = result.settings;
      populateSettingsUI();
      applyPopupTheme();
    }
    if (result.bookmarks) {
      bookmarks = result.bookmarks;
      renderBookmarks();
    }
    if (result.streak) {
      streak = result.streak;
      renderPopupStreak();
    }
  });

  // Bind change listeners to UI inputs to save instantly
  const inputs = [
    { el: isEnabledInput, key: 'isEnabled', type: 'checkbox' },
    { el: sidebarPositionSelect, key: 'sidebarPosition', type: 'select' },
    { el: themeSelect, key: 'theme', type: 'select' },
    { el: showRelatedProblemsInput, key: 'showRelatedProblems', type: 'checkbox' },
    { el: showCompanyInsightsInput, key: 'showCompanyInsights', type: 'checkbox' },
    { el: showPredictionsInput, key: 'showPredictions', type: 'checkbox' },
    { el: showPairFrequencyInput, key: 'showPairFrequency', type: 'checkbox' },
    { el: showContestHistoryInput, key: 'showContestHistory', type: 'checkbox' },
    { el: geminiApiKeyInput, key: 'geminiApiKey', type: 'text' }
  ];

  inputs.forEach(({ el, key, type }) => {
    if (!el) return;
    el.addEventListener('change', () => {
      let value: unknown;
      if (type === 'checkbox') {
        value = (el as HTMLInputElement).checked;
      } else {
        value = (el as HTMLSelectElement).value;
      }

      // Update settings state and storage
      settings = {
        ...settings,
        [key]: value
      };

      chrome.storage.local.set({ settings }, () => {
        if (key === 'theme') {
          applyPopupTheme();
        }
      });
    });
  });

  // Bind API Key visibility toggle
  if (toggleApiKeyVisibilityBtn && geminiApiKeyInput) {
    toggleApiKeyVisibilityBtn.addEventListener('click', () => {
      const type = geminiApiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
      geminiApiKeyInput.setAttribute('type', type);
      toggleApiKeyVisibilityBtn.textContent = type === 'password' ? '👁️' : '🙈';
    });
  }

  // Bind company search autocomplete listener
  let activeSuggestionIndex = -1;
  let filteredCompanies: string[] = [];

  function showSuggestions(list: string[]) {
    if (!companySuggestionsContainer) return;
    filteredCompanies = list;
    
    if (list.length === 0) {
      companySuggestionsContainer.style.display = 'none';
      return;
    }

    companySuggestionsContainer.innerHTML = '';
    list.forEach((comp, idx) => {
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      if (idx === activeSuggestionIndex) {
        div.classList.add('active-selection');
      }
      div.textContent = comp;
      div.addEventListener('click', () => {
        selectCompany(comp);
      });
      companySuggestionsContainer.appendChild(div);
    });
    companySuggestionsContainer.style.display = 'block';
  }

  function selectCompany(companyName: string) {
    if (companySearchInput) {
      companySearchInput.value = companyName;
    }
    if (companySuggestionsContainer) {
      companySuggestionsContainer.style.display = 'none';
    }
    activeSuggestionIndex = -1;
    renderCompanyProblems(companyName as CompanyTag);
  }

  if (companySearchInput) {
    companySearchInput.addEventListener('input', () => {
      const val = companySearchInput.value.trim().toLowerCase();
      activeSuggestionIndex = -1;
      if (!val) {
        showSuggestions([]);
        if (companyProblemsListContainer) {
          companyProblemsListContainer.innerHTML = '<div class="empty-bookmarks">Search and select a company to browse questions.</div>';
        }
        return;
      }
      const matched = UNIQUE_COMPANIES.filter(c => c.toLowerCase().includes(val));
      showSuggestions(matched);
    });

    companySearchInput.addEventListener('focus', () => {
      const val = companySearchInput.value.trim().toLowerCase();
      const matched = val 
        ? UNIQUE_COMPANIES.filter(c => c.toLowerCase().includes(val))
        : UNIQUE_COMPANIES;
      showSuggestions(matched);
    });

    companySearchInput.addEventListener('keydown', (e) => {
      if (!companySuggestionsContainer || companySuggestionsContainer.style.display === 'none') {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % filteredCompanies.length;
        showSuggestions(filteredCompanies);
        const activeEl = companySuggestionsContainer.children[activeSuggestionIndex] as HTMLElement;
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex - 1 + filteredCompanies.length) % filteredCompanies.length;
        showSuggestions(filteredCompanies);
        const activeEl = companySuggestionsContainer.children[activeSuggestionIndex] as HTMLElement;
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeSuggestionIndex >= 0 && activeSuggestionIndex < filteredCompanies.length) {
          selectCompany(filteredCompanies[activeSuggestionIndex]);
        } else if (filteredCompanies.length > 0) {
          selectCompany(filteredCompanies[0]);
        }
      } else if (e.key === 'Escape') {
        companySuggestionsContainer.style.display = 'none';
        activeSuggestionIndex = -1;
      }
    });
  }

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (companySearchInput && companySuggestionsContainer && !companySearchInput.contains(target) && !companySuggestionsContainer.contains(target)) {
      companySuggestionsContainer.style.display = 'none';
      activeSuggestionIndex = -1;
    }
  });
}

/**
 * Sync UI settings inputs with the loaded settings.
 */
function populateSettingsUI() {
  if (!settings) return;
  
  if (isEnabledInput) isEnabledInput.checked = settings.isEnabled;
  if (sidebarPositionSelect) sidebarPositionSelect.value = settings.sidebarPosition;
  if (themeSelect) themeSelect.value = settings.theme;
  if (showRelatedProblemsInput) showRelatedProblemsInput.checked = settings.showRelatedProblems;
  if (showCompanyInsightsInput) showCompanyInsightsInput.checked = settings.showCompanyInsights;
  if (showPredictionsInput) showPredictionsInput.checked = settings.showPredictions;
  if (showPairFrequencyInput) showPairFrequencyInput.checked = settings.showPairFrequency;
  if (showContestHistoryInput) showContestHistoryInput.checked = settings.showContestHistory;
  if (geminiApiKeyInput) geminiApiKeyInput.value = settings.geminiApiKey || '';
}

/**
 * Adjust the popup body classes to match the theme selection.
 */
function applyPopupTheme() {
  if (!settings) return;
  
  let resolvedTheme = settings.theme;
  if (resolvedTheme === 'auto') {
    resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  if (resolvedTheme === 'light') {
    document.body.classList.add('theme-light');
  } else {
    document.body.classList.remove('theme-light');
  }
}

/**
 * Render list of bookmarks dynamically.
 */
function renderBookmarks() {
  if (!bookmarksListContainer) return;
  bookmarksListContainer.innerHTML = '';

  if (bookmarks.length === 0) {
    bookmarksListContainer.innerHTML = '<div class="empty-bookmarks">No bookmarked problems yet.</div>';
    return;
  }

  bookmarks.forEach((slug) => {
    const dbProblem = getProblemBySlug(slug);
    const title = dbProblem ? dbProblem.title : slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const item = document.createElement('div');
    item.className = 'bookmark-item';

    const link = document.createElement('a');
    link.href = '#';
    link.className = 'bookmark-link';
    link.title = title;
    link.textContent = title;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: `https://leetcode.com/problems/${slug}/` });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'bookmark-delete-btn';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.title = 'Delete Bookmark';
    deleteBtn.addEventListener('click', () => {
      deleteBookmark(slug);
    });

    item.appendChild(link);
    item.appendChild(deleteBtn);
    bookmarksListContainer.appendChild(item);
  });
}

/**
 * Removes a bookmark and saves to storage.
 */
function deleteBookmark(slug: string) {
  const updated = bookmarks.filter(s => s !== slug);
  chrome.storage.local.set({ bookmarks: updated }, () => {
    bookmarks = updated;
    renderBookmarks();
  });
}

/**
 * Render company problems sorted by frequency.
 */
function renderCompanyProblems(company: CompanyTag) {
  if (!companyProblemsListContainer) return;
  companyProblemsListContainer.innerHTML = '';

  const probs = getProblemsByCompany([company]);
  if (probs.length === 0) {
    companyProblemsListContainer.innerHTML = '<div class="empty-bookmarks">No problems listed for this company in DB.</div>';
    return;
  }

  // Sort by frequency (descending) and show all
  const sortedProbs = probs
    .sort((a, b) => (b.frequency || 0) - (a.frequency || 0));

  sortedProbs.forEach((prob) => {
    const item = document.createElement('div');
    item.className = 'company-problem-item';

    const link = document.createElement('a');
    link.href = '#';
    link.className = 'company-problem-link';
    link.title = prob.title;
    link.textContent = prob.title;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: prob.url });
    });

    const diffBadge = document.createElement('span');
    diffBadge.className = `popup-diff-badge ${prob.difficulty.toLowerCase()}`;
    diffBadge.textContent = prob.difficulty;

    const freqBadge = document.createElement('span');
    freqBadge.className = 'company-problem-freq';
    freqBadge.textContent = `${prob.frequency || 0}%`;

    item.appendChild(link);
    item.appendChild(diffBadge);
    item.appendChild(freqBadge);
    companyProblemsListContainer.appendChild(item);
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
 * Render streak panel dashboard in the popup dynamically.
 */
function renderPopupStreak() {
  const streakSection = document.getElementById('popupStreakSection') as HTMLDivElement;
  const streakCount = document.getElementById('popupStreakCount') as HTMLDivElement;
  const streakDesc = document.getElementById('popupStreakDesc') as HTMLDivElement;
  const activityGrid = document.getElementById('popupActivityGrid') as HTMLDivElement;

  if (!streakSection || !streakCount || !streakDesc || !activityGrid) return;

  if (!streak || streak.currentStreak === 0) {
    streakSection.style.display = 'none';
    return;
  }

  // Display streak section
  streakSection.style.display = 'block';

  // Set streak count text
  streakCount.textContent = `${streak.currentStreak} Day Streak`;

  // Set streak desc text
  const todayStr = getLocalDateString();
  const solvedToday = streak.solvedHistory.some(p => p.dateString === todayStr);
  if (solvedToday) {
    streakDesc.textContent = 'Streak protected for today! 🎉';
  } else {
    streakDesc.textContent = 'Solve a problem today to continue! ⚡';
  }

  // Render last 7 days mini-blocks
  activityGrid.innerHTML = '';
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const nowTimestamp = Date.now();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(nowTimestamp - i * 24 * 60 * 60 * 1000);
    const dayOffset = d.getTimezoneOffset();
    const localD = new Date(d.getTime() - (dayOffset * 60 * 1000));
    const dateStr = localD.toISOString().split('T')[0];
    const name = daysOfWeek[d.getDay()];
    const isSolved = streak.solvedHistory.some(p => p.dateString === dateStr);

    const blockContainer = document.createElement('div');
    blockContainer.className = `popup-activity-day ${isSolved ? 'solved' : ''}`;
    blockContainer.title = `${dateStr}${isSolved ? ': Solved!' : ': No solves'}`;

    const label = document.createElement('span');
    label.className = 'popup-activity-day-name';
    label.textContent = name[0];

    const block = document.createElement('div');
    block.className = 'popup-activity-day-block';

    blockContainer.appendChild(label);
    blockContainer.appendChild(block);
    activityGrid.appendChild(blockContainer);
  }
}

// Start core execution
init();
