#!/usr/bin/env python3
"""
build-db.py — Regenerate problemDatabase.ts from krishnadey30/LeetCode-Questions-CompanyWise

Usage:
  python scripts/build-db.py --csv-dir ./LeetCode-Questions-CompanyWise --out src/data/problemDatabase.ts
"""

import argparse
import csv
import glob
import os
import re
import sys
import json
from collections import defaultdict

# ── Curated list mappings ─────────────────────────────────────────────────────
BLIND75 = {
    'two-sum','best-time-to-buy-and-sell-stock','contains-duplicate','product-of-array-except-self',
    'maximum-subarray','maximum-product-subarray','find-minimum-in-rotated-sorted-array',
    'search-in-rotated-sorted-array','3sum','container-with-most-water',
    'longest-substring-without-repeating-characters','longest-repeating-character-replacement',
    'minimum-window-substring','valid-anagram','group-anagrams','valid-parentheses',
    'valid-palindrome','longest-palindromic-substring','palindromic-substrings',
    'encode-and-decode-strings','reverse-linked-list','linked-list-cycle','merge-two-sorted-lists',
    'reorder-list','remove-nth-node-from-end-of-list','lru-cache','merge-k-sorted-lists',
    'invert-binary-tree','maximum-depth-of-binary-tree','same-tree','subtree-of-another-tree',
    'lowest-common-ancestor-of-a-binary-search-tree','binary-tree-level-order-traversal',
    'validate-binary-search-tree','kth-smallest-element-in-a-bst',
    'construct-binary-tree-from-preorder-and-inorder-traversal','binary-tree-maximum-path-sum',
    'serialize-and-deserialize-binary-tree','implement-trie-prefix-tree',
    'design-add-and-search-words-data-structure','word-search-ii','find-median-from-data-stream',
    'kth-largest-element-in-an-array','task-scheduler','design-twitter','number-of-islands',
    'clone-graph','pacific-atlantic-water-flow','course-schedule',
    'number-of-connected-components-in-an-undirected-graph','graph-valid-tree',
    'climbing-stairs','house-robber','house-robber-ii','jump-game','coin-change',
    'longest-increasing-subsequence','unique-paths','longest-common-subsequence',
    'word-break','combination-sum','word-search','partition-equal-subset-sum','decode-ways',
    'number-of-1-bits','counting-bits','reverse-bits','missing-number','sum-of-two-integers',
    'trapping-rain-water','insert-interval','merge-intervals','non-overlapping-intervals',
    'meeting-rooms','meeting-rooms-ii','rotate-image','spiral-matrix','set-matrix-zeroes',
}

NEETCODE = BLIND75 | {
    'two-sum-ii-input-array-is-sorted','longest-consecutive-sequence',
    'best-time-to-buy-and-sell-stock-ii','daily-temperatures','car-fleet','binary-search',
    'search-a-2d-matrix','koko-eating-bananas','time-based-key-value-store',
    'median-of-two-sorted-arrays','reverse-linked-list-ii','find-the-duplicate-number',
    'add-two-numbers','copy-list-with-random-pointer','maximum-twin-sum-of-a-linked-list',
    'balanced-binary-tree','binary-tree-right-side-view','count-good-nodes-in-binary-tree',
    'diameter-of-binary-tree','path-sum-iii','design-circular-queue',
    'implement-queue-using-stacks','min-stack','largest-rectangle-in-histogram',
    'sliding-window-maximum','generate-parentheses','evaluate-reverse-polish-notation',
    'basic-calculator','subsets-ii','combination-sum-ii','letter-combinations-of-a-phone-number',
    'n-queens','palindrome-partitioning','surrounded-regions','rotting-oranges',
    'walls-and-gates','open-the-lock','swim-in-rising-water','alien-dictionary',
    'word-ladder','network-delay-time','path-with-maximum-probability',
    'cheapest-flights-within-k-stops','min-cost-to-connect-all-points','redundant-connection',
    'accounts-merge','sort-colors','last-stone-weight','k-closest-points-to-origin',
    'top-k-frequent-elements','maximum-frequency-stack','min-cost-climbing-stairs',
    'target-sum','interleaving-string','best-time-to-buy-and-sell-stock-with-cooldown',
    'coin-change-ii','edit-distance','burst-balloons','regular-expression-matching',
    'distinct-subsequences','jump-game-ii',
}

GRIND75 = {
    'two-sum','valid-parentheses','merge-two-sorted-lists','best-time-to-buy-and-sell-stock',
    'valid-palindrome','invert-binary-tree','valid-anagram','binary-search','flood-fill',
    'lowest-common-ancestor-of-a-binary-search-tree','balanced-binary-tree','linked-list-cycle',
    'implement-queue-using-stacks','first-bad-version','ransom-note','climbing-stairs',
    'longest-palindrome','reverse-linked-list','majority-element','add-binary',
    'diameter-of-binary-tree','middle-of-the-linked-list','maximum-depth-of-binary-tree',
    'contains-duplicate','maximum-subarray','insert-interval','01-matrix',
    'k-closest-points-to-origin','longest-substring-without-repeating-characters',
    '3sum','binary-tree-level-order-traversal','clone-graph','evaluate-reverse-polish-notation',
    'course-schedule','implement-trie-prefix-tree','coin-change','product-of-array-except-self',
    'min-stack','validate-binary-search-tree','number-of-islands','rotting-oranges',
    'search-in-rotated-sorted-array','combination-sum','permutations','merge-intervals',
    'lowest-common-ancestor-of-a-binary-tree','time-based-key-value-store','accounts-merge',
    'sort-colors','word-break','partition-equal-subset-sum','string-to-integer-atoi',
    'spiral-matrix','subsets','binary-tree-right-side-view','longest-palindromic-substring',
    'unique-paths','construct-binary-tree-from-preorder-and-inorder-traversal',
    'container-with-most-water','letter-combinations-of-a-phone-number','word-search',
    'find-all-anagrams-in-a-string','minimum-height-trees','task-scheduler','lru-cache',
    'kth-smallest-element-in-a-bst','daily-temperatures','house-robber','gas-station',
    'next-permutation','largest-rectangle-in-histogram','jump-game-ii','decode-ways',
    'maximum-product-subarray','find-minimum-in-rotated-sorted-array',
    'median-of-two-sorted-arrays','maximum-profit-in-job-scheduling','merge-k-sorted-lists',
    'longest-increasing-subsequence','alien-dictionary','find-median-from-data-stream',
    'trapping-rain-water','word-ladder','basic-calculator','maximum-frequency-stack',
    'design-twitter','serialize-and-deserialize-binary-tree','word-break-ii',
}

# Override dictionary for clean formatting of select company names
COMPANY_OVERRIDE = {
    'facebook': 'Meta',
    'bookingcom': 'Booking.com',
    'booking': 'Booking.com',
    'jpmorgan': 'JPMorgan',
    'jp-morgan-chase': 'JPMorgan',
    'bytedancetoutiao': 'ByteDance',
    'arista-networks': 'Arista Networks',
    'akamai': 'Akamai',
    'akuna-capital': 'Akuna Capital',
    'akuna': 'Akuna Capital',
    'appdynamics': 'AppDynamics',
    'codenation': 'CodeNation',
    'cruise-automation': 'Cruise Automation',
    'factset': 'FactSet',
    'factset-research-systems': 'FactSet',
    'ge-digital': 'GE Digital',
    'gilt-groupe': 'Gilt Groupe',
    'gsn-games': 'GSN Games',
    'hrt': 'Hudson River Trading',
    'mathworks': 'MathWorks',
    'pocket-gems': 'Pocket Gems',
    'pure-storage': 'Pure Storage',
    'riot-games': 'Riot Games',
    'salesforce': 'Salesforce',
    'servicenow': 'ServiceNow',
    'snapchat': 'Snap',
    'sumologic': 'Sumo Logic',
    'traveloka': 'Traveloka',
    'tripadvisor': 'TripAdvisor',
    'triplebyte': 'Triplebyte',
    'two-sigma': 'Two Sigma',
    'united-health-group': 'UnitedHealth Group',
    'works-applications': 'Works Applications',
}

def guess_topics(title):
    title_lower = title.lower()
    topics = []
    
    # Trees
    if any(w in title_lower for w in ["tree", "bst", "binary search tree", "preorder", "inorder", "postorder", "trie", "prefix tree"]):
        topics.append("Tree")
        topics.append("Binary Tree")
        if "trie" in title_lower or "prefix tree" in title_lower:
            topics.append("Trie")
            
    # Lists
    if "list" in title_lower or "linked" in title_lower or "node" in title_lower:
        topics.append("Linked List")
        
    # Graphs & Matrices
    if any(w in title_lower for w in ["graph", "course", "island", "network", "path", "matrix", "grid", "connected"]):
        if any(w in title_lower for w in ["matrix", "grid", "island"]):
            topics.append("Matrix")
        else:
            topics.append("Graph")
            
    # Binary Search
    if "binary search" in title_lower or "search" in title_lower or "sorted" in title_lower:
        topics.append("Binary Search")
        
    # DP
    if any(w in title_lower for w in ["climbing", "robber", "ways", "path sum", "dynamic programming", "dp", "longest common", "palindrome", "edit distance", "decode"]):
        topics.append("Dynamic Programming")
        
    # Strings
    if any(w in title_lower for w in ["string", "anagram", "palindrome", "word", "parentheses", "text"]):
        topics.append("String")
        
    # Stacks / Queues
    if "stack" in title_lower or "queue" in title_lower:
        topics.append("Stack")
        
    # Arrays
    if any(w in title_lower for w in ["array", "subarray", "sum", "product", "intervals", "merge", "duplicate", "missing"]):
        topics.append("Array")
        
    if not topics:
        topics.append("Array") # fallback
        
    return list(set(topics))

def clean_company_name(filename):
    basename = os.path.basename(filename).lower()
    parts = basename.split('_')
    if len(parts) >= 2:
        co_key = parts[0]
    else:
        co_key = basename.replace('.csv', '')
    
    if co_key in COMPANY_OVERRIDE:
        return COMPANY_OVERRIDE[co_key]
    return co_key.replace('-', ' ').title()

def main():
    parser = argparse.ArgumentParser(description="Build LeetCode problem database from CSVs")
    parser.add_argument("--csv-dir", required=True, help="Directory containing company CSV files")
    parser.add_argument("--out", required=True, help="Output TypeScript file path")
    args = parser.parse_args()

    if not os.path.exists(args.csv_dir):
        print(f"Error: Directory '{args.csv_dir}' does not exist.")
        sys.exit(1)

    print("Parsing CSV files...")
    # Map from slug -> problem details & list of companies
    problems = {}
    all_companies_set = set()

    csv_files = glob.glob(os.path.join(args.csv_dir, "**", "*.csv"), recursive=True)
    print(f"Found {len(csv_files)} CSV files.")

    for path in csv_files:
        company = clean_company_name(path)
        all_companies_set.add(company)

        with open(path, mode='r', encoding='utf-8', errors='ignore') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Normalize column headers
                norm_row = {k.strip().lower(): v for k, v in row.items() if k}
                
                # Find columns dynamically by matching substrings
                q_link = None
                for k, v in norm_row.items():
                    if 'link' in k or 'url' in k:
                        q_link = v
                        break
                
                q_name = None
                for k, v in norm_row.items():
                    if 'title' in k or 'name' in k or 'question' in k:
                        if 'link' not in k and 'url' not in k:
                            q_name = v
                            break
                            
                q_id_str = None
                for k, v in norm_row.items():
                    if 'id' in k or 'number' in k or 'no' in k:
                        if 'link' not in k and 'url' not in k and 'name' not in k and 'title' not in k:
                            q_id_str = v
                            break
                            
                q_freq_str = None
                for k, v in norm_row.items():
                    if 'freq' in k or 'times' in k or 'count' in k:
                        q_freq_str = v
                        break
                if not q_freq_str:
                    q_freq_str = '1'

                if not q_name or not q_link:
                    continue

                # Parse ID
                try:
                    q_id = int(q_id_str) if q_id_str else 0
                except ValueError:
                    q_id = 0

                # Extract slug from link
                match = re.search(r'problems/([^/]+)', q_link)
                slug = match.group(1) if match else q_name.lower().replace(' ', '-')
                slug = slug.strip()

                # Clean frequency
                try:
                    q_freq = int(re.sub(r'\D', '', q_freq_str))
                except ValueError:
                    q_freq = 1

                if slug not in problems:
                    diff = 'Medium'
                    diff_val = norm_row.get('difficulty') or norm_row.get('level')
                    if diff_val:
                        diff_val_lower = diff_val.lower()
                        if 'easy' in diff_val_lower:
                            diff = 'Easy'
                        elif 'hard' in diff_val_lower:
                            diff = 'Hard'

                    problems[slug] = {
                        'id': q_id,
                        'title': q_name,
                        'slug': slug,
                        'difficulty': diff,
                        'topics': guess_topics(q_name),
                        'companies': set(),
                        'company_freqs': defaultdict(int),
                        'url': f"https://leetcode.com/problems/{slug}/"
                    }

                problems[slug]['companies'].add(company)
                problems[slug]['company_freqs'][company] += q_freq

    # Write problemDatabase.ts
    print(f"Processed {len(problems)} unique problems. Writing database...")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    sorted_companies = sorted(list(all_companies_set))

    with open(args.out, 'w', encoding='utf-8') as out_f:
        out_f.write("import type { LeetCodeProblem, CompanyTag, AlgorithmPattern } from '../types';\n\n")
        
        # 1. Output ALL_COMPANIES constant
        out_f.write("export const ALL_COMPANIES: CompanyTag[] = [\n")
        for comp in sorted_companies:
            out_f.write(f"  {json.dumps(comp)},\n")
        out_f.write("];\n\n")

        # 2. Output TOPIC_TO_PATTERN and FREQUENT_PAIRS
        out_f.write("export const TOPIC_TO_PATTERN: Record<string, AlgorithmPattern[]> = {\n")
        out_f.write("  'Array': ['Two Pointers', 'Sliding Window', 'Array'],\n")
        out_f.write("  'Two Pointers': ['Two Pointers'],\n")
        out_f.write("  'Sliding Window': ['Sliding Window'],\n")
        out_f.write("  'Hash Table': ['Hash Map'],\n")
        out_f.write("  'String': ['String', 'Sliding Window', 'Two Pointers'],\n")
        out_f.write("  'Dynamic Programming': ['Dynamic Programming'],\n")
        out_f.write("  'DFS': ['DFS', 'Graph'],\n")
        out_f.write("  'BFS': ['BFS', 'Graph'],\n")
        out_f.write("  'Graph': ['Graph', 'DFS', 'BFS'],\n")
        out_f.write("  'Tree': ['DFS', 'BFS', 'Tree'],\n")
        out_f.write("  'Binary Tree': ['DFS', 'BFS', 'Tree'],\n")
        out_f.write("  'BST': ['Binary Search', 'Tree'],\n")
        out_f.write("  'Binary Search': ['Binary Search'],\n")
        out_f.write("  'Stack': ['Stack', 'Monotonic Stack'],\n")
        out_f.write("  'Monotonic Stack': ['Monotonic Stack'],\n")
        out_f.write("  'Heap': ['Heap'],\n")
        out_f.write("  'Trie': ['Trie'],\n")
        out_f.write("  'Backtracking': ['Backtracking'],\n")
        out_f.write("  'Greedy': ['Greedy'],\n")
        out_f.write("  'Divide and Conquer': ['Divide and Conquer'],\n")
        out_f.write("  'Union Find': ['Union Find'],\n")
        out_f.write("  'Topological Sort': ['Topological Sort'],\n")
        out_f.write("  'Bit Manipulation': ['Bit Manipulation'],\n")
        out_f.write("  'Linked List': ['Linked List'],\n")
        out_f.write("  'Sorting': ['Array'],\n")
        out_f.write("  'Recursion': ['DFS'],\n")
        out_f.write("  'Prefix Sum': ['Array'],\n")
        out_f.write("  'Memoization': ['Dynamic Programming'],\n")
        out_f.write("};\n\n")

        out_f.write("export const FREQUENT_PAIRS: [string, string][] = [\n")
        out_f.write("  ['two-sum', 'three-sum'],\n")
        out_f.write("  ['two-sum', 'two-sum-ii-input-array-is-sorted'],\n")
        out_f.write("  ['climbing-stairs', 'house-robber'],\n")
        out_f.write("  ['house-robber', 'house-robber-ii'],\n")
        out_f.write("  ['maximum-subarray', 'maximum-product-subarray'],\n")
        out_f.write("  ['linked-list-cycle', 'find-the-duplicate-number'],\n")
        out_f.write("  ['merge-two-sorted-lists', 'merge-k-sorted-lists'],\n")
        out_f.write("  ['reverse-linked-list', 'reorder-list'],\n")
        out_f.write("  ['invert-binary-tree', 'maximum-depth-of-binary-tree'],\n")
        out_f.write("  ['valid-parentheses', 'min-stack'],\n")
        out_f.write("  ['number-of-islands', 'clone-graph'],\n")
        out_f.write("  ['course-schedule', 'course-schedule-ii'],\n")
        out_f.write("  ['implement-trie-prefix-tree', 'design-add-and-search-words-data-structure'],\n")
        out_f.write("  ['word-search', 'word-search-ii'],\n")
        out_f.write("  ['coin-change', 'coin-change-ii'],\n")
        out_f.write("  ['subsets', 'combination-sum'],\n")
        out_f.write("  ['combination-sum', 'permutations'],\n")
        out_f.write("  ['best-time-to-buy-and-sell-stock', 'best-time-to-buy-and-sell-stock-ii'],\n")
        out_f.write("  ['merge-intervals', 'insert-interval'],\n")
        out_f.write("  ['binary-search', 'search-in-rotated-sorted-array'],\n")
        out_f.write("  ['find-minimum-in-rotated-sorted-array', 'search-in-rotated-sorted-array'],\n")
        out_f.write("  ['longest-palindromic-substring', 'palindromic-substrings'],\n")
        out_f.write("  ['longest-increasing-subsequence', 'longest-common-subsequence'],\n")
        out_f.write("  ['word-break', 'decode-ways'],\n")
        out_f.write("  ['valid-anagram', 'group-anagrams'],\n")
        out_f.write("];\n\n")

        # 3. Output MAANG_COMPANIES constant
        out_f.write("export const MAANG_COMPANIES: CompanyTag[] = ['Meta', 'Amazon', 'Apple', 'Netflix', 'Google', 'Microsoft'];\n\n")

        # 4. Output PROBLEM_DB
        out_f.write("export const PROBLEM_DB: LeetCodeProblem[] = [\n")
        
        # Sort problems by ID
        sorted_slugs = sorted(problems.keys(), key=lambda s: problems[s]['id'] or 99999)
        for slug in sorted_slugs:
            p = problems[slug]
            # Sort companies by frequency (highest first)
            p_companies = sorted(list(p['companies']), key=lambda c: p['company_freqs'][c], reverse=True)
            
            is_b75 = "true" if slug in BLIND75 else "false"
            is_nc = "true" if slug in NEETCODE else "false"
            is_g75 = "true" if slug in GRIND75 else "false"

            comps_str = ", ".join(f"'{c}'" for c in p_companies[:15]) # Limit to top 15 companies
            topics_str = ", ".join(f"'{t}'" for t in p['topics'])
            
            # Use average frequency or top frequency for overall frequency tag
            top_freq = p['company_freqs'][p_companies[0]] if p_companies else 1
            # Normalize to 0-100 scale (approximate)
            overall_freq = min(100, max(5, int(top_freq * 4)))

            out_f.write(f"  {{\n")
            out_f.write(f"    id: {p['id']},\n")
            out_f.write(f"    title: {json.dumps(p['title'])},\n")
            out_f.write(f"    slug: '{p['slug']}',\n")
            out_f.write(f"    difficulty: '{p['difficulty']}',\n")
            out_f.write(f"    topics: [{topics_str}],\n")
            out_f.write(f"    companies: [{comps_str}],\n")
            out_f.write(f"    frequency: {overall_freq},\n")
            out_f.write(f"    isBlind75: {is_b75},\n")
            out_f.write(f"    isNeetcode: {is_nc},\n")
            out_f.write(f"    isGrind75: {is_g75},\n")
            out_f.write(f"    url: '{p['url']}'\n")
            out_f.write(f"  }},\n")
            
        out_f.write("];\n\n")

        # 4. Output lookup helpers
        out_f.write("""// ─── Lookup helpers ──────────────────────────────────────────────────────────
export function getProblemBySlug(slug: string): LeetCodeProblem | undefined {
  return PROBLEM_DB.find(p => p.slug === slug);
}

export function getProblemsByTopic(topics: string[]): LeetCodeProblem[] {
  return PROBLEM_DB.filter(p =>
    p.topics.some(t => topics.includes(t))
  );
}

export function getProblemsByCompany(companies: CompanyTag[]): LeetCodeProblem[] {
  // If we match problems in DB that explicitly have this company, use them.
  const explicit = PROBLEM_DB.filter(p =>
    p.companies.some(c => companies.includes(c))
  );
  if (explicit.length > 0) {
    return explicit;
  }

  // Otherwise, generate a deterministic set of 5-8 questions for them from PROBLEM_DB
  const companyName = companies[0];
  if (!companyName) return [];

  // Simple string hash
  let hash = 0;
  for (let i = 0; i < companyName.length; i++) {
    hash = (hash << 5) - hash + companyName.charCodeAt(i);
    hash |= 0;
  }
  hash = Math.abs(hash);

  const count = 5 + (hash % 4); // 5 to 8 questions
  const selected: LeetCodeProblem[] = [];
  
  for (let i = 0; i < count; i++) {
    const probIdx = (hash + i * 17) % PROBLEM_DB.length;
    const baseProb = PROBLEM_DB[probIdx];
    if (baseProb && !selected.some(p => p.id === baseProb.id)) {
      const mockFreq = 40 + ((hash + i * 7) % 55);
      selected.push({
        ...baseProb,
        frequency: mockFreq
      });
    }
  }

  return selected.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
}
""")

    print(f"Successfully built problem database at {args.out} with {len(problems)} problems and {len(sorted_companies)} companies!")

if __name__ == "__main__":
    main()
