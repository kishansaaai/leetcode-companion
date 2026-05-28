export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export type CompanyTag = string;

export type AlgorithmPattern =
  | 'Two Pointers' | 'Sliding Window' | 'Binary Search' | 'DFS' | 'BFS'
  | 'Dynamic Programming' | 'Backtracking' | 'Greedy' | 'Divide and Conquer'
  | 'Graph' | 'Tree' | 'Trie' | 'Heap' | 'Stack' | 'Queue' | 'Hash Map'
  | 'Linked List' | 'Array' | 'String' | 'Math' | 'Bit Manipulation'
  | 'Monotonic Stack' | 'Union Find' | 'Topological Sort' | 'Segment Tree';

export type RelationReason =
  | 'same_pattern'
  | 'same_algorithm'
  | 'same_data_structure'
  | 'difficulty_progression'
  | 'frequently_paired'
  | 'company_asked_together'
  | 'same_topic';

export interface LeetCodeProblem {
  id: number;
  title: string;
  slug: string;
  difficulty: Difficulty;
  topics: string[];
  companies: CompanyTag[];
  frequency?: number; // 0-100
  acceptance?: number; // percentage
  isPremium?: boolean;
  isBlind75?: boolean;
  isNeetcode?: boolean;
  isGrind75?: boolean;
  url: string;
}

export interface RelatedProblem extends LeetCodeProblem {
  relationReason: RelationReason;
  relationScore: number; // 0-1 similarity score
  relationExplanation: string;
}

export interface CompanyInsight {
  company: CompanyTag;
  frequency: number; // times asked
  round: 'Online Assessment' | 'Phone Screen' | 'Technical' | 'Onsite' | 'Unknown';
  recency: 'Last 6 months' | 'Last year' | 'Last 2 years' | 'All time';
}

export interface ContestInfo {
  contestName: string;
  contestDate: string;
  contestUrl?: string;
  problemPosition: number; // 1-4 (problem position in contest)
}

export interface CurrentProblem {
  id: number;
  title: string;
  slug: string;
  difficulty: Difficulty;
  topics: string[];
  url: string;
  detectedAt: number; // timestamp
}

export interface SidebarData {
  currentProblem: CurrentProblem;
  relatedProblems: RelatedProblem[];
  companyInsights: CompanyInsight[];
  contestHistory: ContestInfo[];
  pairFrequency: LeetCodeProblem[]; // commonly asked with
  nextPredictions: RelatedProblem[];
  isLoading: boolean;
  error?: string;
  lastUpdated?: number;
}

export interface FilterState {
  companies: CompanyTag[];
  difficulties: Difficulty[];
  patterns: AlgorithmPattern[];
  showBlind75Only: boolean;
  showNeetcodeOnly: boolean;
  showGrind75Only: boolean;
}

export interface BookmarkState {
  bookmarkedSlugs: string[];
}

export interface ExtensionSettings {
  isEnabled: boolean;
  sidebarPosition: 'right' | 'left';
  theme: 'auto' | 'dark' | 'light';
  keyboardShortcut: string;
  showCompanyInsights: boolean;
  showRelatedProblems: boolean;
  showPairFrequency: boolean;
  showContestHistory: boolean;
  showPredictions: boolean;
  cacheExpiry: number; // hours
  geminiApiKey?: string;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  slug: string;
}

export interface MessagePayload {
  type: string;
  payload?: unknown;
}

export interface ProblemDetectedMessage extends MessagePayload {
  type: 'PROBLEM_DETECTED';
  payload: CurrentProblem;
}

export interface ToggleSidebarMessage extends MessagePayload {
  type: 'TOGGLE_SIDEBAR';
}

export interface DataResponseMessage extends MessagePayload {
  type: 'DATA_RESPONSE';
  payload: Partial<SidebarData>;
}

export interface SolvedProblem {
  slug: string;
  title: string;
  difficulty: Difficulty;
  solvedAt: number; // timestamp
  dateString: string; // YYYY-MM-DD
}

export interface StreakState {
  currentStreak: number;
  lastSolvedDate: string; // YYYY-MM-DD
  solvedHistory: SolvedProblem[];
}

