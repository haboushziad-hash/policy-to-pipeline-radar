# Policy to Pipeline Radar: course prototype

Prototype for MPIM-6750 Developing and Managing AI Products (Georgetown University, Fall 2026), Module 5 hands-on assignment.

The Radar pulls public federal signals about zero trust work at the Department of Defense, normalizes them into one schema, and places each signal on a three-tier evidence ladder with a written reason. The goal is to let a capture manager see a likely opportunity before the solicitation posts.

**Public sources only:** the Federal Register API, the USAspending API, and the SAM.gov Get Opportunities API. No internal or proprietary data is used.

## What the notebook does

| Section | What it does |
|---|---|
| 0. Setup | One config cell for search terms, agency, time windows, and paths. Reads the SAM.gov key from an environment variable. |
| 1. Ingest | Pulls each source, saves the raw response to `data/raw/` before any change, and prints a status line. A failed source is skipped, not fatal. |
| 2. Normalize and merge | Maps all sources into one schema, keeps missing dates blank, drops duplicates on source plus ID, and runs assert checks. |
| 3. Evidence tiers | Plain rules, no ML and no LLM. Every row gets a tier, a rule ID, and a reason. |
| 4. Mockup | Signal feed (S1) and signal detail (S2) as HTML, built from the ranked table. |
| 5. Ask the Radar | Rule-based stand-in for the planned LLM feature: question to filter chips, chips shown before the filter runs. |
| 6. Disagree | Fixed-reason feedback logged to CSV for human review. Never changes a tier. |
| 7. Save | Writes `data/processed/signals.csv` and a run summary. |

## Quick run (Windows)

Double-click `run_radar.bat`. It uses conda if it finds it and otherwise builds a local Python virtual environment, asks for a SAM.gov key (press Enter to skip), runs the notebook top to bottom, and opens the mockup. The key stays in that window and is never saved.

## Setup (Windows, Anaconda Prompt)

```
conda env create -f environment.yml
conda activate radar
conda env config vars set SAM_API_KEY=YOUR_KEY_HERE
conda deactivate
conda activate radar
jupyter lab
```

The SAM.gov key is stored in the conda environment, not in this folder. Without a key, the notebook skips SAM.gov and runs the other two sources.

Open `radar.ipynb` and choose Run > Run All Cells.

## Outputs

- `data/processed/signals.csv`: the ranked, tiered signals
- `mockup/radar_mockup.html`: feed plus a detail card for every signal
- `mockup/ask_the_radar.html`: the Ask the Radar panel for the last question asked
- `data/raw/` and `data/feedback/` stay local and are not committed

## Known limits

- A tier measures the type of evidence, not relevance. A privacy notice that mentions cybersecurity still lands in Tier 2, which is what the disagree log is for.
- The Federal Register rarely uses the phrase "zero trust", so the policy search also covers cybersecurity and CMMC.
- DoD contract data reaches FPDS and USAspending on a 90-day delay, so the award window is 365 days.
- SAM.gov searches titles only and caps daily requests per key. The notebook reuses the day's pull and does not fetch full notice descriptions.
- The lead-time estimate and the LLM-drafted rationale are labeled placeholders.

## Last run

October 11, 2026, on my own PC: 35 signals (5 Federal Register, 30 USAspending, 0 SAM.gov), zero cell errors. SAM.gov returned 2 "zero trust" title matches government-wide, neither from DoD.

## How it was built

Built in a Jupyter notebook by prompting Claude (Anthropic), Opus 5.5 model. The prompts are in `PROMPTS.md`.
