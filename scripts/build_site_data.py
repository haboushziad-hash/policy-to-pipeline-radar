"""Build docs/assets/data.js for the GitHub Pages site.

Inputs:
  data/processed/signals.csv           ranked, tiered signals from radar.ipynb (Oct 11, 2026 run)
  data/ai_read/run_1.json .. run_3.json three independent AI relevance reads (Prompt 8)
  data/ai_read/human_labels.json       hand labels for the accuracy check (optional)
Output:
  docs/assets/data.js                  one JS object the page reads; no network calls at runtime
"""
import json, math, pathlib
from collections import Counter
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
AI = ROOT / "data" / "ai_read"
LABELS = ["High", "Medium", "Low", "Unclear"]

def clean(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return v

sig = pd.read_csv(ROOT / "data" / "processed" / "signals.csv")
runs = []
for k in (1, 2, 3):
    p = AI / f"run_{k}.json"
    if p.exists():
        runs.append({r["id"]: r for r in json.loads(p.read_text(encoding="utf-8"))})
human_path = AI / "human_labels.json"
human = json.loads(human_path.read_text(encoding="utf-8")) if human_path.exists() else {}

records = []
for i, r in sig.iterrows():
    rec = {k: clean(r[k]) for k in ["source", "id", "title", "agency", "date", "doc_type", "url", "text", "amount", "tier", "tier_rule", "tier_reason"]}
    rec["n"] = i + 1
    rec["tier"] = int(rec["tier"])
    reads = [run[rec["id"]] for run in runs if rec["id"] in run]
    if reads:
        for x in reads:
            assert x["relevance"] in LABELS, x
        votes = Counter(x["relevance"] for x in reads)
        top, cnt = votes.most_common(1)[0]
        if cnt == 1 and len(reads) == 3:
            label, conf = "Split", "Low"
        else:
            label, conf = top, {3: "High", 2: "Medium"}.get(cnt, "Low")
        rec["ai"] = {"label": label, "agree": cnt, "of": len(reads), "confidence": conf,
                     "runs": [{"relevance": x["relevance"], "reason": x["reason"]} for x in reads]}
    else:
        rec["ai"] = None
    h = human.get(str(rec["n"]))
    rec["human"] = h if h in LABELS else None
    records.append(rec)

meta = {
    "snapshot": "2026-10-11",
    "ai_read_date": "2026-10-22",
    "ai_model": "Claude (Anthropic), Opus 5.5",
    "ai_runs": len(runs),
    "sources": {"Federal Register": int((sig.source == "federal_register").sum()),
                "USAspending": int((sig.source == "usaspending").sum()),
                "SAM.gov": 0},
    "human_labeled": sum(1 for r in records if r["human"]),
}
out = ROOT / "docs" / "assets" / "data.js"
out.write_text("window.RADAR = " + json.dumps({"meta": meta, "signals": records}, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
print(f"wrote {out} with {len(records)} signals, {len(runs)} AI runs, {meta['human_labeled']} human labels")
