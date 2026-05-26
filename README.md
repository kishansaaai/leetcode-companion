# LeetCode Companion Chrome Extension

An intelligent, high-aesthetic interview companion for LeetCode. It injects a responsive, glassmorphic sidebar directly into LeetCode problems pages to display similar problems, detailed company frequency metrics, algorithmic patterns, recommendations, and contest history.

It features a dynamically compiled database of **1,446 high-frequency interview questions** asked across **197 companies**, with full autocomplete search support in both the popup and the in-page sidebar.

---

## Key Features

* **Glassmorphic UI & Styling**: Premium, dark-themed responsive sidebar injected via isolated Shadow DOM to avoid styling clashes with LeetCode.
* **Dynamic Autocomplete Search**: Interactive search input inside both the sidebar and the options popup with keyboard arrow navigation to search through 197 companies.
* **Comprehensive Company Insights**: Displays deterministic mock company frequencies, interview stages (Online Assessment, Onsite, Technical), and recency metrics.
* **Similar Problems Matcher**: Heuristic match scoring based on topic overlap, difficulty progression, and common company interview pairings.
* **Next progressive step predictions**: Dynamic recommendations of which problem to solve next to consolidate your knowledge or step up the difficulty ladder.
* **Saved Bookmarks**: Easily star/bookmark any problem and access it directly from the Chrome extension popup.

---

## Technical Stack

* **Core**: HTML5, TypeScript, Vanilla CSS
* **Build System**: Vite, Rollup, programmatic build script (sequential packing of content, background, and popup modules to prevent code-splitting and runtime import issues)
* **API Level**: Chrome Extension Manifest V3

---

## File Structure

```
leetcode-companion/
├── public/
│   ├── manifest.json       # Chrome Extension Manifest V3
│   ├── content.css         # Sidebar injected styling (glassmorphism)
│   └── icons/              # Programmatically generated PNG icons
├── src/
│   ├── types.ts            # Core TypeScript schemas
│   ├── background.ts       # Background service worker (processing requests)
│   ├── content.ts          # Content script injected into leetcode.com/problems/*
│   ├── popup.ts            # Extension settings panel logic
│   └── data/
│       └── problemDatabase.ts # Packaged database (1446 questions, 197 companies)
├── scripts/
│   ├── build-db.py         # Dynamic CSV compiler
│   ├── build.js            # Sequential Vite bundler
│   └── generate-icons.py   # Programmatic icon generator using Pillow
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Installation & Setup

### 1. Build the Extension
Ensure you have [Node.js](https://nodejs.org/) installed, then run:
```bash
# Install development dependencies
npm install

# Compile TypeScript and bundle scripts
npm run build
```
This output compiles all scripts and copies static assets into the `dist/` folder.

### 2. Load the Extension in Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the **`dist`** directory inside the project folder:
   `leetcode-companion/dist`

---

## How to use LeetCode Companion

1. Open any LeetCode problem page, e.g., [Two Sum](https://leetcode.com/problems/two-sum/).
2. You will see a glowing purple circular floating button in the bottom right corner.
3. Click the button (or press `Alt + L`) to slide in the companion drawer.
4. Navigate tabs:
   * **Similar**: Check related problems with matching scores and explanations.
   * **Companies**: Review company metrics. Type any company name (e.g. *Citadel*, *Google*, *Stripe*) in the search input to see all questions for that company in the database.
   * **Patterns**: View next progressive step recommendations, frequently paired questions, and Weekly Contest history.
5. Click the extension icon in your Chrome toolbar to configure sidebar alignment (Left/Right) or browse bookmarks.

---

## Re-compiling the Database from Scratch
If you wish to re-aggregate the raw CSV files or update question frequencies:
1. Clone the reference company questions repository:
   ```bash
   git clone https://github.com/krishnadey30/LeetCode-Questions-CompanyWise.git
   ```
2. Re-compile the `problemDatabase.ts`:
   ```bash
   python scripts/build-db.py --csv-dir ./LeetCode-Questions-CompanyWise --out src/data/problemDatabase.ts
   ```
3. Re-build the extension:
   ```bash
   npm run build
   ```
