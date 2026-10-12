# Prompts used to build the prototype

Sent in order to Claude (Anthropic), Opus 5.5 model. Each prompt produced or extended one part of `radar.ipynb`.

## Prompt 1: plan before code

> I'm building a quick prototype of Policy to Pipeline Radar, a tool that pulls public federal signals and scores them on a three-tier evidence ladder so capture managers see likely opportunities before the solicitation posts. Before writing any code, propose a Jupyter notebook outline: sections, a common data schema, and which public APIs to use. I have a SAM.gov API key; everything else should work without one. Python, pandas, requests, set up with conda.

## Prompt 2: ingest

> Go with that outline. Build the ingest section first. Pull the last 90 days from the Federal Register and USAspending for zero trust work at the Department of Defense, plus SAM.gov opportunities. Read my SAM.gov key from an environment variable called SAM_API_KEY so it never lands in the notebook or on GitHub. Save the raw JSON to data/raw before changing anything, and if a source fails, print a status line and keep going instead of crashing.

## Prompt 3: normalize and test

> Now normalize all three sources into the common schema and merge them. If a record has no date, leave it blank. Don't fill in today's date, because that makes an old signal look new. Drop duplicates on source plus ID, then add assert checks after the merge: no missing IDs, no duplicate keys, every URL starts with https.

## Prompt 4: evidence tiers

> Add the evidence tiers as plain rules, no ML and no LLM. Tier 1: final rules, proposed rules, and presidential documents. Tier 2: Federal Register notices, contract awards, and SAM.gov notices. Tier 3: everything else. Every row gets a short reason string naming the rule that placed it, so a capture manager can see why without asking me.

## Prompt 5: mockup from the Module 4 wireframes

> Attached are my Module 4 wireframes: S1 is the signal feed and S2 is the signal detail page. Build a mockup of both from the ranked table in section 3, rendered as HTML inside the notebook. Each feed row should show tier, agency, title, date, and the tier reason. The detail view should quote the record's text, show the rule that placed it, and link back to the source. Skip the lead-time estimate and the LLM rationale for now, but leave a labeled placeholder where each one goes. Also save the mockup as an HTML file I can open in a browser.

## Prompt 6: Ask the Radar stand-in

> Now add Ask the Radar from S3, attached, without an LLM. Write a rule-based parser that turns a plain question like "Tier 1 signals from the last 30 days" into filter chips for tier, source, agency, date range, and keyword. Show the chips before running anything so I can see how the question was read, then list the matching signals. Label it as a stand-in for the LLM version.

## Prompt 7: disagree control

> Last piece is Flow B from S5, attached: the disagree control. Let a capture manager flag a signal by picking one reason from a fixed list: wrong tier, wrong agency or component, duplicate of another signal, not relevant to zero trust work, or other with a one-line note. Append each flag to data/feedback/disagree_log.csv with the signal ID, its current tier and rule, the reason, the note, and a timestamp. Never change a tier automatically. The log is for me to review.
