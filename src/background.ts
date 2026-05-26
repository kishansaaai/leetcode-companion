import { 
  PROBLEM_DB, 
  TOPIC_TO_PATTERN, 
  FREQUENT_PAIRS, 
  getProblemBySlug 
} from './data/problemDatabase';
import type { 
  LeetCodeProblem, 
  RelatedProblem, 
  CompanyInsight, 
  ContestInfo, 
  SidebarData, 
  CurrentProblem, 
  RelationReason, 
  ExtensionSettings,
  MessagePayload
} from './types';

// Default extension settings
const DEFAULT_SETTINGS: ExtensionSettings = {
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

// Initialize settings on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['settings', 'bookmarks'], (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
    if (!result.bookmarks) {
      chrome.storage.local.set({ bookmarks: [] });
    }
  });
});

// Listener for extension icon click
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' });
  }
});

// Listener for shortcut commands
if (chrome.commands) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-sidebar') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.id) {
          chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_SIDEBAR' });
        }
      });
    }
  });
}

// Listener for messages from content script or popup
chrome.runtime.onMessage.addListener((message: MessagePayload, sender, sendResponse) => {
  console.log('LeetCode Companion (Background): Received message:', message.type, message.payload);
  if (message.type === 'PROBLEM_DETECTED') {
    const currentProblem = message.payload as CurrentProblem;
    try {
      const sidebarData = getSidebarDataForProblem(currentProblem);
      sendResponse(sidebarData);
    } catch (err) {
      console.error('LeetCode Companion (Background): Error processing problem:', err);
      sendResponse({
        isLoading: false,
        error: String(err),
        currentProblem: {
          id: 0,
          title: currentProblem.title,
          slug: currentProblem.slug,
          difficulty: currentProblem.difficulty,
          topics: currentProblem.topics,
          url: currentProblem.url,
          detectedAt: Date.now()
        },
        relatedProblems: [],
        companyInsights: [],
        contestHistory: [],
        pairFrequency: [],
        nextPredictions: []
      } as any);
    }
  }
  return true; // Use true to indicate asynchronous response callback
});

/**
 * Main processor when a problem page is loaded/navigated.
 */
function getSidebarDataForProblem(currentProblem: CurrentProblem): SidebarData {
  console.log('LeetCode Companion (Background): Processing problem detection for:', currentProblem.slug);

  const slug = currentProblem.slug;
  const dbProblem = getProblemBySlug(slug);
  console.log('LeetCode Companion (Background): DB lookup result:', dbProblem ? 'Found in DB' : 'Not found in DB');

  // 1. Prepare base problem details
  const problemDetails: CurrentProblem = dbProblem ? {
    id: dbProblem.id,
    title: dbProblem.title,
    slug: dbProblem.slug,
    difficulty: dbProblem.difficulty,
    topics: dbProblem.topics,
    url: dbProblem.url,
    detectedAt: Date.now()
  } : {
    ...currentProblem,
    detectedAt: Date.now()
  };

  // 2. Compute similar/related problems
  const relatedProblems = computeRelatedProblems(problemDetails, dbProblem);

  // 3. Compile company insights
  const companyInsights = compileCompanyInsights(dbProblem);

  // 4. Compile contest history
  const contestHistory = compileContestHistory(problemDetails);

  // 5. Compute frequently paired problems
  const pairFrequency = compilePairFrequency(problemDetails);

  // 6. Compute predictions (suggested next steps)
  const nextPredictions = computePredictions(problemDetails, relatedProblems);

  // Construct complete sidebar data payload
  return {
    currentProblem: problemDetails,
    relatedProblems,
    companyInsights,
    contestHistory,
    pairFrequency,
    nextPredictions,
    isLoading: false,
    lastUpdated: Date.now()
  };
}

/**
 * Calculates similar problems using a scoring heuristic based on topic overlaps,
 * difficulty progressions, and company tags.
 */
function computeRelatedProblems(current: CurrentProblem, dbProblem?: LeetCodeProblem): RelatedProblem[] {
  const list: RelatedProblem[] = [];
  const activeTopics = dbProblem ? dbProblem.topics : current.topics;
  if (!activeTopics || activeTopics.length === 0) return [];

  // Mapped patterns for current problem
  const activePatterns = new Set<string>();
  activeTopics.forEach(topic => {
    const patterns = TOPIC_TO_PATTERN[topic] || [];
    patterns.forEach(p => activePatterns.add(p));
  });

  for (const prob of PROBLEM_DB) {
    if (prob.slug === current.slug) continue; // Skip itself

    let score = 0;
    let explanation = '';
    let reason: RelationReason = 'same_topic';

    // 1. Check if they are frequently paired
    const isPaired = FREQUENT_PAIRS.some(
      pair => (pair[0] === current.slug && pair[1] === prob.slug) || 
              (pair[0] === prob.slug && pair[1] === current.slug)
    );

    if (isPaired) {
      score += 0.45;
      explanation = 'Frequently asked together in the same interview loop.';
      reason = 'frequently_paired';
    }

    // 2. Topic overlap scoring
    const sharedTopics = prob.topics.filter(t => activeTopics.includes(t));
    if (sharedTopics.length > 0) {
      score += Math.min(0.3, sharedTopics.length * 0.1);
      if (!explanation) {
        explanation = `Shares core topics: ${sharedTopics.join(', ')}.`;
        reason = 'same_topic';
      }
    }

    // 3. Pattern overlap scoring
    const probPatterns = new Set<string>();
    prob.topics.forEach(t => {
      const patterns = TOPIC_TO_PATTERN[t] || [];
      patterns.forEach(p => probPatterns.add(p));
    });
    const sharedPatterns = Array.from(probPatterns).filter(p => activePatterns.has(p));
    if (sharedPatterns.length > 0) {
      score += 0.25;
      if (reason !== 'frequently_paired') {
        explanation = `Uses the same algorithmic pattern: ${sharedPatterns.join(', ')}.`;
        reason = 'same_pattern';
      }
    }

    // 4. Difficulty progression scoring
    if (dbProblem) {
      const diffLevels = { 'Easy': 1, 'Medium': 2, 'Hard': 3 };
      const currentLevel = diffLevels[dbProblem.difficulty];
      const targetLevel = diffLevels[prob.difficulty];

      if (sharedPatterns.length > 0 || sharedTopics.length > 0) {
        if (targetLevel === currentLevel + 1) {
          score += 0.15; // Extra weight for progression
          if (reason !== 'frequently_paired') {
            explanation = `Natural difficulty progression: step up to ${prob.difficulty} using similar ${sharedPatterns[0] || 'topics'}.`;
            reason = 'difficulty_progression';
          }
        } else if (targetLevel === currentLevel) {
          score += 0.05;
        }
      }
    }

    // 5. Shared companies scoring
    if (dbProblem) {
      const sharedCompanies = prob.companies.filter(c => dbProblem.companies.includes(c));
      if (sharedCompanies.length > 0) {
        score += Math.min(0.15, sharedCompanies.length * 0.03);
        if (reason === 'same_topic' && sharedCompanies.length >= 3) {
          explanation += ` Both commonly asked at ${sharedCompanies.slice(0, 2).join(', ')}.`;
          reason = 'company_asked_together';
        }
      }
    }

    // Normalize score to max 1.0
    const finalScore = Math.min(0.98, score);

    if (finalScore > 0.15) {
      list.push({
        ...prob,
        relationReason: reason,
        relationScore: parseFloat(finalScore.toFixed(2)),
        relationExplanation: explanation || 'Shares matching algorithmic structures.'
      });
    }
  }

  // Sort by score descending and return top 5
  return list.sort((a, b) => b.relationScore - a.relationScore).slice(0, 6);
}

/**
 * Compiles interview stages and recency metrics for the company tags.
 */
function compileCompanyInsights(dbProblem?: LeetCodeProblem): CompanyInsight[] {
  if (!dbProblem || !dbProblem.companies) return [];

  const rounds: CompanyInsight['round'][] = ['Online Assessment', 'Phone Screen', 'Technical', 'Onsite'];
  const recencyOptions: CompanyInsight['recency'][] = ['Last 6 months', 'Last year', 'Last 2 years'];

  return dbProblem.companies.map((company, index) => {
    // Generate deterministic values based on problem id and company name hash
    const hash = (dbProblem.id + company.charCodeAt(0) + company.charCodeAt(company.length - 1)) % 100;
    
    // Base frequency linked to overall problem frequency rank
    const baseFreq = dbProblem.frequency || 50;
    const frequency = Math.max(5, Math.round(baseFreq * (1 - index * 0.15) + (hash % 10)));

    const round = rounds[hash % rounds.length];
    const recency = recencyOptions[hash % recencyOptions.length];

    return {
      company,
      frequency,
      round,
      recency
    };
  }).sort((a, b) => b.frequency - a.frequency);
}

/**
 * Simulates contest metrics for LeetCode database matches.
 */
function compileContestHistory(current: CurrentProblem): ContestInfo[] {
  // Deterministic mock contests based on problem ID
  const hash = current.id % 200;
  if (hash > 40) return []; // Not all problems are in contest history

  const contestNum = 180 + hash;
  const year = 2020 + Math.floor(hash / 40);
  const month = 1 + (hash % 12);
  const day = 1 + (hash % 28);
  const position = 1 + (hash % 4); // Problem position in contest (1: Easy, 4: Hard)

  return [{
    contestName: `Weekly Contest ${contestNum}`,
    contestDate: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
    problemPosition: position,
    contestUrl: `https://leetcode.com/contest/weekly-contest-${contestNum}`
  }];
}

/**
 * Returns a list of problems that are frequently asked in the same interview.
 */
function compilePairFrequency(current: CurrentProblem): LeetCodeProblem[] {
  const pairedSlugs = FREQUENT_PAIRS
    .filter(pair => pair[0] === current.slug || pair[1] === current.slug)
    .map(pair => pair[0] === current.slug ? pair[1] : pair[0]);

  return PROBLEM_DB.filter(p => pairedSlugs.includes(p.slug));
}

/**
 * Recommends 1 to 2 next problems for the user to tackle, focusing on difficulty ladder
 * or pattern consolidation.
 */
function computePredictions(current: CurrentProblem, related: RelatedProblem[]): RelatedProblem[] {
  if (related.length === 0) return [];

  // Filter for natural difficulty ladder (e.g. Easy -> Medium -> Hard)
  const diffLevels = { 'Easy': 1, 'Medium': 2, 'Hard': 3 };
  const currentLevel = diffLevels[current.difficulty] || 2;

  // Try to find a related problem that is exactly currentLevel + 1 (step up)
  const progression = related.filter(r => (diffLevels[r.difficulty] || 2) === currentLevel + 1);
  
  // Try to find a related problem of the same difficulty to reinforce pattern
  const consolidation = related.filter(r => (diffLevels[r.difficulty] || 2) === currentLevel);

  const predictions: RelatedProblem[] = [];

  if (progression.length > 0) {
    predictions.push({
      ...progression[0],
      relationExplanation: `Recommended to step up your difficulty to ${progression[0].difficulty} and expand on this pattern.`
    });
  }

  if (consolidation.length > 0 && predictions.length < 2) {
    const nextConsolidation = consolidation.find(c => c.slug !== (predictions[0]?.slug));
    if (nextConsolidation) {
      predictions.push({
        ...nextConsolidation,
        relationExplanation: `Reinforce the pattern by solving another ${nextConsolidation.difficulty} problem.`
      });
    }
  }

  // Fallback to highest similarity score
  if (predictions.length === 0) {
    predictions.push(related[0]);
  }

  return predictions;
}
