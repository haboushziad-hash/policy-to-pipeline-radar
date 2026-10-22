/* Policy to Pipeline Radar: front end for the course prototype.
   Reads window.RADAR (built by scripts/build_site_data.py). No network calls,
   no tracking. Disagree flags are kept in this browser only. */
(function () {
  "use strict";

  const DATA = window.RADAR || { meta: {}, signals: [] };
  const SIGNALS = DATA.signals;
  const META = DATA.meta;
  const SNAPSHOT = new Date((META.snapshot || "2026-10-11") + "T12:00:00");
  const REL_RANK = { High: 3, Medium: 2, Low: 1, Unclear: 0, Split: 0 };
  const CONF_RANK = { High: 3, Medium: 2, Low: 1 };
  const FLAG_KEY = "radar-disagree-flags-v1";

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- formatting ----------
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(iso) {
    if (!iso) return "No date";
    const [y, m, d] = iso.split("-").map(Number);
    return MONTHS[m - 1] + " " + d + ", " + y;
  }
  function fmtMoney(v) {
    if (v == null) return "";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
    if (v >= 1e3) return "$" + Math.round(v / 1e3) + "K";
    return "$" + Math.round(v);
  }
  function srcName(s) { return { federal_register: "Federal Register", usaspending: "USAspending", sam: "SAM.gov" }[s] || s; }
  function shortAgency(a) {
    if (!a) return "";
    const m = a.match(/^Department of Defense \((.+)\)$/);
    if (m) return m[1].replace("Department of the ", "");
    const parts = a.split(";").map((x) => x.trim());
    const uniq = parts.filter((x, i) => parts.indexOf(x) === i);
    if (uniq.length > 2) return uniq.slice(0, 2).join("; ") + " +" + (uniq.length - 2);
    return uniq.join("; ");
  }
  // Award descriptions arrive in all caps. The feed shows them in sentence case with
  // acronyms restored; the detail view always quotes the record exactly as published.
  const ACRONYMS = ["ESTCP", "EW", "AI", "SBIR", "HPCMP", "CAGE", "NSWC", "PHD", "CSO", "USTRANSCOM", "J6", "C3OD2", "HW", "SW", "EL",
    "CISO", "C2C", "DAF", "ZT", "FMO", "PKI", "OCONUS", "ONE-NET", "ZTA", "ZTTT", "HQ", "CCC", "TZT", "UCIC-MCX", "P2", "IBM", "DLA",
    "II", "III", "ACBN", "V2SHIELD", "AFSTS", "PKS", "DOD", "DODS", "AOIS", "HDB", "DOW", "OT", "IT", "AWS", "DISA", "US", "USA"];
  const SPECIAL = { DOD: "DoD", DODS: "DoD's", AOIS: "AOIs", V2SHIELD: "V2Shield", "ONE-NET": "ONE-Net" };
  function tidyText(t) {
    if (!t) return "";
    const letters = t.replace(/[^A-Za-z]/g, "");
    if (!letters || letters !== letters.toUpperCase()) return t;
    t = t.toLowerCase().replace(/(^\s*\w|[.!?:]\s+\w)/g, (c) => c.toUpperCase());
    ACRONYMS.forEach((a) => {
      const re = new RegExp("(^|[^A-Za-z0-9-])(" + a.replace(/-/g, "\\-") + ")(?=$|[^A-Za-z0-9])", "gi");
      t = t.replace(re, (m, pre) => pre + (SPECIAL[a] || a));
    });
    t = t.replace(/\bzero trust\b/gi, (m, off) => (off === 0 ? "Zero trust" : "zero trust"));
    return t;
  }

  // ---------- AI read helpers ----------
  function needsLook(s) {
    const a = s.ai;
    if (!a) return true;
    if (a.confidence !== "High") return true;
    if (a.label === "Unclear" || a.label === "Split") return true;
    if (s.tier === 1 && (a.label === "Low" || a.label === "Unclear")) return true;
    return false;
  }
  function lookReason(s) {
    const a = s.ai;
    if (!a) return "No AI read for this record.";
    if (a.label === "Split") return "The three AI reads all disagreed.";
    if (s.tier === 1 && a.label === "Low") return "Strongest evidence tier, but the AI reads it as low relevance. The rule and the AI point in opposite directions.";
    if (a.label === "Unclear") return "The AI could not judge relevance from this record.";
    if (a.confidence !== "High") return "Only " + a.agree + " of 3 AI reads agreed.";
    return "";
  }
  function dots(a) {
    const n = a ? (a.label === "Split" ? 1 : a.agree) : 0;
    let h = '<span class="dots" aria-hidden="true">';
    for (let i = 0; i < 3; i++) h += '<span class="' + (i < n ? "on" : "") + '"></span>';
    return h + "</span>";
  }
  function aiChip(a) {
    if (!a) return '<span class="conf-text">No AI read</span>';
    const label = a.label === "Split" ? "No agreement" : a.label;
    const cls = a.label === "Split" ? " split" : a.label === "Unclear" ? " unclear" : "";
    const conf = a.label === "Split" ? "the 3 reads all differ" : a.agree + " of 3 reads agree";
    return '<span class="airead' + cls + '" aria-label="AI relevance read: ' + esc(label) + ", " + esc(conf) + '"><span class="tag" aria-hidden="true">AI</span>' + esc(label) + " " + dots(a) + "</span>" +
      '<span class="conf-text">' + esc(conf) + "</span>";
  }
  function tierBadge(t) { return '<span class="badge t' + t + '">Tier ' + t + "</span>"; }

  // ---------- state ----------
  const state = { q: "", tier: "", ai: "", conf: "", src: "", sort: "relevance", agency: "", minAmt: null, since: null, keyword: "", needs: false };

  function matches(s) {
    if (state.tier && String(s.tier) !== state.tier) return false;
    if (state.ai && (!s.ai || s.ai.label !== state.ai)) return false;
    if (state.conf && (!s.ai || s.ai.confidence !== state.conf)) return false;
    if (state.src && s.source !== state.src) return false;
    if (state.agency && !(s.agency || "").toLowerCase().includes(state.agency.toLowerCase())) return false;
    if (state.minAmt != null && !(s.amount >= state.minAmt)) return false;
    if (state.since && !(s.date && s.date >= state.since)) return false;
    if (state.needs && !needsLook(s)) return false;
    const hay = (s.title + " " + s.agency + " " + s.text).toLowerCase();
    if (state.keyword && !state.keyword.split("|").some((k) => hay.includes(k))) return false;
    if (state.q && !hay.includes(state.q.toLowerCase())) return false;
    return true;
  }
  function sorter(a, b) {
    const d = (x) => x.date || "0000";
    const rel = (x) => (x.ai ? REL_RANK[x.ai.label] : -1);
    const conf = (x) => (x.ai ? CONF_RANK[x.ai.confidence] : 0);
    switch (state.sort) {
      case "tier": return a.tier - b.tier || d(b).localeCompare(d(a));
      case "date": return d(b).localeCompare(d(a));
      case "amount": return (b.amount || -1) - (a.amount || -1);
      case "review": return (needsLook(b) - needsLook(a)) || a.tier - b.tier || d(b).localeCompare(d(a));
      default: return rel(b) - rel(a) || conf(b) - conf(a) || a.tier - b.tier || d(b).localeCompare(d(a));
    }
  }

  // ---------- render feed ----------
  function render() {
    const rows = SIGNALS.filter(matches).sort(sorter);
    $("#count").textContent = "Showing " + rows.length + " of " + SIGNALS.length + " signals";
    renderActiveChips();
    if (!rows.length) {
      $("#feed").innerHTML = '<div class="empty">No signals match these filters. <button class="btn link small" type="button" data-reset>Clear filters</button></div>';
      return;
    }
    $("#feed").innerHTML = rows.map((s) => {
      const nl = needsLook(s);
      return '<div class="row' + (nl ? " needs" : "") + '" role="row" tabindex="0" data-n="' + s.n + '" aria-label="' + esc(s.title) + '">' +
        '<div role="cell"><span class="mlabel">Evidence</span>' + tierBadge(s.tier) + "</div>" +
        '<div role="cell" class="c-title"><div class="title">' + esc(s.title) + '</div><div class="desc" title="Record text as published">' + esc(s.text) + "</div>" +
          '<div style="margin-top:6px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' + (nl ? '<span class="flag">Check this one</span>' : "") +
          '<button class="rowbtn" type="button" data-open="' + s.n + '">Why? Open details ›</button></div></div>' +
        '<div role="cell" class="aicell"><span class="mlabel">AI read</span>' + aiChip(s.ai) + "</div>" +
        '<div role="cell" class="meta"><span class="mlabel">Agency</span>' + esc(shortAgency(s.agency)) + '<div class="src">' + esc(srcName(s.source)) + " · " + esc(s.doc_type || "") + "</div></div>" +
        '<div role="cell" class="meta"><span class="mlabel">Date</span>' + esc(fmtDate(s.date)) + "</div>" +
        '<div role="cell" class="meta"><span class="mlabel">Amount</span>' + (s.amount != null ? esc(fmtMoney(s.amount)) : '<span class="src">n/a</span>') + "</div>" +
        "</div>";
    }).join("");
  }

  function renderActiveChips() {
    const chips = [];
    if (state.agency) chips.push(["agency", "Agency: " + state.agency]);
    if (state.minAmt != null) chips.push(["minAmt", "Amount over " + fmtMoney(state.minAmt)]);
    if (state.since) chips.push(["since", "Since " + fmtDate(state.since)]);
    if (state.keyword) chips.push(["keyword", "Mentions: " + state.keyword.split("|").join(" or ")]);
    if (state.needs) chips.push(["needs", "Needs a human look"]);
    $("#active-chips").innerHTML = chips.map(([k, t]) => '<span class="chip ai">' + esc(t) + '<button type="button" aria-label="Remove ' + esc(t) + '" data-clear="' + k + '">×</button></span>').join("");
  }

  function syncControls() {
    $("#f-q").value = state.q; $("#f-tier").value = state.tier; $("#f-ai").value = state.ai;
    $("#f-conf").value = state.conf; $("#f-src").value = state.src; $("#f-sort").value = state.sort;
  }
  function resetAll() {
    Object.assign(state, { q: "", tier: "", ai: "", conf: "", src: "", sort: "relevance", agency: "", minAmt: null, since: null, keyword: "", needs: false });
    syncControls(); render();
  }

  // ---------- detail ----------
  function openDetail(n) {
    const s = SIGNALS.find((x) => x.n === Number(n));
    if (!s) return;
    const a = s.ai;
    const look = lookReason(s);
    let runs = "";
    if (a) {
      runs = '<ul class="runs">' + a.runs.map((r, i) => {
        const diff = a.label !== "Split" && r.relevance !== a.label;
        return '<li class="' + (diff ? "diff" : "") + '"><span class="rl">Read ' + (i + 1) + ": " + esc(r.relevance) + "</span>" + esc(r.reason) + (diff ? ' <em>(differs from the majority)</em>' : "") + "</li>";
      }).join("") + "</ul>";
    }
    const human = s.human ? (
      a && s.human === a.label
        ? '<div class="callout good"><b>Accuracy check:</b> an analyst labeled this one ' + esc(s.human) + ' without seeing the AI read. They match.</div>'
        : '<div class="callout bad"><b>Accuracy check:</b> an analyst labeled this one ' + esc(s.human) + " without seeing the AI read. The AI said " + esc(a ? (a.label === "Split" ? "nothing consistent" : a.label) : "nothing") + ".</div>"
    ) : "";
    const flags = loadFlags().filter((f) => f.id === s.id);

    $("#dlg-title").textContent = s.title;
    $("#dlg-body").innerHTML =
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">' + tierBadge(s.tier) + aiChip(a) + (look ? '<span class="flag">Check this one</span>' : "") + "</div>" +
      '<div class="dlg-grid"><div>' +
        '<div class="card"><h4>What the record says</h4><div class="quote">' + esc(s.text) + "</div>" +
          '<dl class="kv"><dt>Agency</dt><dd>' + esc(s.agency) + "</dd><dt>Source</dt><dd>" + esc(srcName(s.source)) + " · " + esc(s.doc_type || "") + "</dd><dt>Date</dt><dd>" + esc(fmtDate(s.date)) + "</dd>" +
          (s.amount != null ? "<dt>Amount</dt><dd>" + esc(fmtMoney(s.amount)) + " (award amount, per USAspending)</dd>" : "") +
          '<dt>Record ID</dt><dd>' + esc(s.id) + "</dd></dl>" +
          '<p style="margin:10px 0 0"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">Open the source record ↗</a></p></div>' +
        '<div class="card aicard"><h4>AI relevance read</h4>' +
          (a ? "<div>" + aiChip(a) + "</div>" + runs +
            (look ? '<div class="callout warn"><b>Why to check it:</b> ' + esc(look) + "</div>" : '<div class="callout info">All three reads agree. Agreement is not proof: check the record text before acting.</div>') : "<p>No AI read.</p>") +
          human + '<p class="conf-text" style="margin:10px 0 0">Generated by Claude (Anthropic) on ' + esc(fmtDate(META.ai_read_date)) + ", three independent runs, from this record's text only.</p></div>" +
      "</div><div>" +
        '<div class="card rulecard"><h4>Why it is Tier ' + s.tier + "</h4><p style=\"margin:0;font-size:14px\">" + esc(s.tier_reason) + '</p><p class="conf-text" style="margin:8px 0 0">Set by a plain rule (' + esc(s.tier_rule) + "), not by the AI. A tier says what kind of evidence this is, not whether it matters to zero trust work.</p></div>" +
        '<div class="card you"><h4>Disagree?</h4><form id="flag-form"><fieldset><legend class="sr-only">Pick one reason</legend>' +
          ["Evidence tier is wrong", "AI relevance read is wrong", "Wrong agency or component", "Duplicate of another signal", "Not relevant to zero trust work", "Other"].map((r, i) =>
            '<label><input type="radio" name="reason" value="' + esc(r) + '"' + "" + "> " + esc(r) + "</label>").join("") +
          '</fieldset><label class="sr-only" for="flag-note">Note</label><textarea id="flag-note" rows="2" maxlength="200" placeholder="One line on why (optional)"></textarea>' +
          '<button class="btn small" type="submit" style="margin-top:8px">Log my flag</button></form>' +
          '<p class="conf-text" style="margin:8px 0 0">Flags are held for review. Nothing changes the tier or the AI read on its own. In this prototype, flags stay in your browser.</p>' +
          (flags.length ? '<div class="callout info">You flagged this signal ' + flags.length + " time" + (flags.length > 1 ? "s" : "") + ": " + esc(flags.map((f) => f.reason).join("; ")) + ".</div>" : "") +
        "</div>" +
      "</div></div>";
    $("#flag-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const picked = $("input[name=reason]:checked", e.target);
      if (!picked) { toast("Pick one reason first, so the flag can be counted."); return; }
      const reason = picked.value;
      const note = $("#flag-note").value.trim();
      const all = loadFlags();
      all.push({ id: s.id, n: s.n, title: s.title, tier: s.tier, tier_rule: s.tier_rule, ai_read: a ? a.label : "", reason, note, at: new Date().toISOString() });
      saveFlags(all);
      toast("Logged for review. Nothing changed automatically.");
      openDetail(s.n);
      renderFlagsLine();
    });
    const dlg = $("#detail");
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
    $("#dlg-close").focus();
  }

  // ---------- disagree flags (browser only) ----------
  function loadFlags() { try { return JSON.parse(localStorage.getItem(FLAG_KEY) || "[]"); } catch (e) { return memFlags; } }
  let memFlags = [];
  function saveFlags(f) { memFlags = f; try { localStorage.setItem(FLAG_KEY, JSON.stringify(f)); } catch (e) { /* private mode: keep in memory */ } }
  function renderFlagsLine() {
    const f = loadFlags();
    let el = $("#flagsline");
    if (!el) { el = document.createElement("span"); el.id = "flagsline"; $("#status").appendChild(el); }
    el.innerHTML = f.length ? "<b>Your flags:</b> " + f.length + ' <button class="btn link small" type="button" id="dl-flags">Download CSV</button>' : "";
  }
  function downloadFlags() {
    const f = loadFlags();
    const cols = ["at", "n", "id", "title", "tier", "tier_rule", "ai_read", "reason", "note"];
    const csv = [cols.join(",")].concat(f.map((r) => cols.map((c) => '"' + String(r[c] == null ? "" : r[c]).replace(/"/g, '""') + '"').join(","))).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = "radar_disagree_flags.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Ask the Radar (rule-based stand-in) ----------
  const AGENCIES = [
    ["air force", "Air Force"], ["usaf", "Air Force"], ["army", "Army"], ["navy", "Navy"], ["disa", "Defense Information Systems Agency"],
    ["defense information systems", "Defense Information Systems Agency"], ["dla", "Defense Logistics Agency"], ["logistics agency", "Defense Logistics Agency"],
    ["transcom", "USTRANSCOM"], ["whs", "Washington Headquarters Services"], ["washington headquarters", "Washington Headquarters Services"],
  ];
  const KEYWORDS = [
    ["identity", "identity"], ["authentication", "authentication"], ["sbir", "sbir"], ["cloud", "cloud"], ["license", "license"], ["licenses", "license"],
    ["drone", "drone"], ["endpoint", "endpoint"], ["pki", "pki"], ["operational technolog", "operational technolog"], ["energy", "energy"],
    ["tactical", "tactical"], ["data", "data"], ["network", "network"], ["comply-to-connect", "comply"], ["comply to connect", "comply"], ["forescout", "forescout"],
  ];
  function parseMoney(num, unit) {
    let v = parseFloat(num.replace(/,/g, ""));
    unit = (unit || "").toLowerCase();
    if (unit.startsWith("b")) v *= 1e9; else if (unit.startsWith("m")) v *= 1e6; else if (unit.startsWith("k") || unit.startsWith("t")) v *= 1e3;
    return v;
  }
  function isoDaysBefore(days) { const d = new Date(SNAPSHOT.getTime() - days * 864e5); return d.toISOString().slice(0, 10); }

  function parseQuestion(q) {
    const t = " " + q.toLowerCase().replace(/[?.!]/g, " ") + " ";
    const f = {}; const leaps = []; const used = [];
    // tier
    let m = t.match(/tier\s*(1|2|3|one|two|three)\b/);
    if (m) { f.tier = { one: "1", two: "2", three: "3" }[m[1]] || m[1]; used.push(m[0]); }
    else if (/\b(strongest evidence|rules? and proposed rules?|proposed rules?|final rules?)\b/.test(t)) { f.tier = "1"; leaps.push('"' + RegExp.lastMatch.trim() + '" read as Tier 1'); }
    // source
    if (/\b(awards?|contracts?|usaspending|task orders?|delivery orders?)\b/.test(t)) { f.src = "usaspending"; used.push(RegExp.lastMatch); }
    else if (/\b(federal register|rules?|notices?|regulations?)\b/.test(t)) { f.src = "federal_register"; used.push(RegExp.lastMatch); }
    else if (/\b(sam\.?gov|solicitations?|opportunit(y|ies))\b/.test(t)) { f.src = "sam"; used.push(RegExp.lastMatch); }
    // AI relevance and confidence
    if (/\b(unsure|not sure|uncertain|disagree|check first|check|review|human look|shaky)\b/.test(t)) { f.needs = true; leaps.push('"' + RegExp.lastMatch.trim() + '" read as "needs a human look"'); }
    if (/\b(high(ly)? relevan\w*|most relevant|very relevant)\b/.test(t)) f.ai = "High";
    else if (/\b(medium|moderate(ly)?) relevan\w*/.test(t)) f.ai = "Medium";
    else if (/\b(low relevan\w*|irrelevant|not relevant|off.topic)\b/.test(t)) f.ai = "Low";
    if (/\b(confident|sure|unanimous|all agree)\b/.test(t) && !f.needs) { f.conf = "High"; leaps.push('"' + RegExp.lastMatch.trim() + '" read as "3 of 3 AI reads agree"'); }
    // agency
    for (const [k, v] of AGENCIES) if (t.includes(" " + k + " ") || t.includes(" " + k + "'")) { f.agency = v; break; }
    // money
    m = t.match(/(over|above|more than|at least|>)\s*\$?\s*([\d.,]+)\s*(billion|million|thousand|[bmk])?\b/);
    if (m) f.minAmt = parseMoney(m[2], m[3]);
    else if (/\b(big|large|biggest|largest)\b/.test(t)) { f.minAmt = 1e6; leaps.push('"' + RegExp.lastMatch + '" read as "over $1M"'); }
    // dates, relative to the data snapshot
    m = t.match(/(last|past)\s+(\d+)\s+(day|week|month|year)s?/);
    if (m) { const mult = { day: 1, week: 7, month: 30, year: 365 }[m[3]]; f.since = isoDaysBefore(Number(m[2]) * mult); leaps.push('"' + m[0] + '" counted back from the Oct 11, 2026 snapshot'); }
    else if ((m = t.match(/(since|after|from)\s+(20\d\d)/))) f.since = m[2] + "-01-01";
    else if (/\bthis year\b/.test(t)) { f.since = SNAPSHOT.getFullYear() + "-01-01"; }
    else if (/\b(recent|new|latest|newest)\b/.test(t)) { f.since = isoDaysBefore(180); leaps.push('"' + RegExp.lastMatch + '" read as the last 180 days'); }
    // keyword
    const kws = [];
    for (const [k, v] of KEYWORDS) if (t.includes(k) && !kws.includes(v)) kws.push(v);
    if (kws.length) f.keyword = kws.slice(0, 3).join("|");
    // what to check first: show review items first
    if (/check first|start with|look at first|priorit/.test(t)) f.sort = "review";
    return { f, leaps };
  }
  function describe(f) {
    const out = [];
    if (f.tier) out.push(["tier", "Evidence: Tier " + f.tier]);
    if (f.src) out.push(["src", "Source: " + srcName(f.src)]);
    if (f.ai) out.push(["ai", "AI read: " + f.ai]);
    if (f.conf) out.push(["conf", "AI reads: 3 of 3 agree"]);
    if (f.needs) out.push(["needs", "Needs a human look"]);
    if (f.agency) out.push(["agency", "Agency: " + f.agency]);
    if (f.minAmt != null) out.push(["minAmt", "Amount over " + fmtMoney(f.minAmt)]);
    if (f.since) out.push(["since", "Since " + fmtDate(f.since)]);
    if (f.keyword) out.push(["keyword", "Mentions: " + f.keyword.split("|").join(" or ")]);
    if (f.sort === "review") out.push(["sort", "Sort: needs a human look first"]);
    return out;
  }
  let pending = null;
  function showInterpretation(q) {
    const { f, leaps } = parseQuestion(q);
    pending = f;
    const chips = describe(f);
    const box = $("#interp");
    box.classList.add("show");
    if (!chips.length) {
      $("#interp-chips").innerHTML = "";
      $("#ask-run").hidden = true;
      $("#ask-did").innerHTML = '<span class="miss">I could not turn that into a filter, so I did not guess.</span> Try naming a tier, an agency (Army, Navy, Air Force, DISA), an amount ("over $1M"), a time window ("since 2025"), or a topic like identity or cloud. The filters below the box do the same job by hand.';
      return;
    }
    $("#ask-run").hidden = false;
    renderPendingChips();
    $("#ask-did").innerHTML = "<b>What I did:</b> read your words into the filters above. I have not searched anything yet, and I cannot invent a signal or change a score." +
      (leaps.length ? "<br><b>Leaps I made:</b> " + esc(leaps.join("; ")) + "." : "");
  }
  function renderPendingChips() {
    $("#interp-chips").innerHTML = describe(pending).map(([k, t]) => '<span class="chip ai">' + esc(t) + '<button type="button" aria-label="Remove ' + esc(t) + '" data-unpend="' + k + '">×</button></span>').join("");
    if (!describe(pending).length) $("#ask-run").hidden = true;
  }
  function runPending() {
    if (!pending) return;
    const keep = { q: "", sort: pending.sort || "relevance" };
    Object.assign(state, { tier: "", ai: "", conf: "", src: "", agency: "", minAmt: null, since: null, keyword: "", needs: false }, keep, pending);
    delete state.undefined;
    syncControls(); render();
    $("#interp").classList.remove("show");
    const n = SIGNALS.filter(matches).length;
    toast(n + " signal" + (n === 1 ? "" : "s") + " match. The filters stay visible above the list.");
    document.querySelector(".filters").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- accuracy ----------
  function renderAccuracy() {
    const el = $("#acc-body");
    const withAi = SIGNALS.filter((s) => s.ai);
    const agreeCounts = { 3: 0, 2: 0, split: 0 };
    withAi.forEach((s) => { if (s.ai.label === "Split") agreeCounts.split++; else agreeCounts[s.ai.agree]++; });
    const labeled = SIGNALS.filter((s) => s.human && s.ai);
    const confBlock =
      '<div class="metric ai"><div class="big">' + agreeCounts[3] + " <small>of " + withAi.length + '</small></div><div class="lbl">signals where all 3 AI reads agree (high confidence)</div></div>' +
      '<div class="metric ai"><div class="big">' + agreeCounts[2] + " <small>of " + withAi.length + '</small></div><div class="lbl">where 2 of 3 agree (medium)</div></div>' +
      '<div class="metric ai"><div class="big">' + agreeCounts.split + " <small>of " + withAi.length + '</small></div><div class="lbl">where no two agree (low)</div></div>';
    if (!labeled.length) {
      el.innerHTML = '<div class="acc-top">' + confBlock + '<div class="metric"><div class="big">n/a</div><div class="lbl">accuracy against a human analyst</div></div></div>' +
        '<div class="pending"><b>Accuracy is not measured yet.</b> The hand-labeled check is still being prepared. Until then, treat the AI read as a sorting aid, not a verdict.</div>';
      return;
    }
    const hits = labeled.filter((s) => s.human === s.ai.label);
    const pct = Math.round((100 * hits.length) / labeled.length);
    const byConf = ["High", "Medium", "Low"].map((c) => {
      const g = labeled.filter((s) => s.ai.confidence === c);
      const h = g.filter((s) => s.human === s.ai.label).length;
      return { c, n: g.length, h };
    });
    const confName = { High: "3 of 3 agree", Medium: "2 of 3 agree", Low: "no two agree" };
    const L = ["High", "Medium", "Low", "Unclear"];
    const aiCols = L.concat(labeled.some((s) => s.ai.label === "Split") ? ["Split"] : []);
    let cm = '<table class="plain cm"><caption class="sr-only">Analyst label by AI read</caption><tr><th>Analyst ↓ / AI →</th>' + aiCols.map((c) => '<th class="num">' + (c === "Split" ? "No agreement" : c) + "</th>").join("") + "</tr>";
    L.forEach((h) => {
      if (!labeled.some((s) => s.human === h) ) return;
      cm += "<tr><th>" + h + "</th>" + aiCols.map((c) => {
        const n = labeled.filter((s) => s.human === h && s.ai.label === c).length;
        return '<td class="num ' + (h === c && n ? "hit" : n ? "" : "zero") + '">' + n + "</td>";
      }).join("") + "</tr>";
    });
    cm += "</table>";
    const misses = labeled.filter((s) => s.human !== s.ai.label);
    el.innerHTML =
      '<div class="acc-top">' + confBlock + '<div class="metric"><div class="big">' + hits.length + " <small>of " + labeled.length + '</small></div><div class="lbl">AI read matched the analyst (' + pct + "%)</div></div></div>" +
      '<div class="acc-grid"><div class="card"><h4>Does confidence earn trust?</h4><table class="plain"><tr><th>AI confidence</th><th class="num">Signals</th><th class="num">Matched analyst</th><th></th></tr>' +
        byConf.map((r) => "<tr><td>" + confName[r.c] + '</td><td class="num">' + r.n + '</td><td class="num">' + (r.n ? r.h + " (" + Math.round((100 * r.h) / r.n) + "%)" : "n/a") + '</td><td><div class="bar"><span style="width:' + (r.n ? (100 * r.h) / r.n : 0) + '%"></span></div></td></tr>').join("") +
        '</table><p class="conf-text" style="margin:10px 0 0">If high-confidence reads match the analyst more often than the rest, the dots are telling you something real. With ' + labeled.length + " records this is a first look, not a measured rate.</p></div>" +
      '<div class="card"><h4>Where they agreed and where they did not</h4>' + cm + "</div></div>" +
      '<div class="card" style="margin-top:4px"><h4>Every miss (' + misses.length + ")</h4>" +
        (misses.length ? '<ul class="misslist">' + misses.map((s) => '<li><button type="button" data-open="' + s.n + '">' + esc(s.title) + "</button><br>Analyst: <b>" + esc(s.human) + "</b> · AI: <b>" + esc(s.ai.label === "Split" ? "no agreement" : s.ai.label) + "</b> (" + esc(confName[s.ai.confidence]) + ")</li>").join("") + "</ul>" : "<p>None.</p>") +
        '<p class="conf-text" style="margin:8px 0 0">Method: one analyst (the product owner) labeled all ' + labeled.length + " records High, Medium, Low, or Unclear from the same record text, before seeing any AI read.</p></div>";
  }

  // ---------- landing preview: one real signal, explained ----------
  function renderPreview() {
    const s = SIGNALS.find((x) => x.tier === 1 && x.ai && x.ai.label === "Low") || SIGNALS[0];
    if (!s || !s.ai) return;
    $("#preview").innerHTML =
      '<div class="pv-k">One real signal, explained</div>' +
      '<div class="pv-row">' + tierBadge(s.tier) + aiChip(s.ai) + "</div>" +
      '<div class="pv-title">' + esc(s.title) + "</div>" +
      '<div class="pv-line"><b>Rule</b><span>' + esc(s.tier_reason.replace(/^Tier \d, rule [^:]+: /, "")) + ": the strongest evidence type.</span></div>" +
      '<div class="pv-line"><b>AI read</b><span>' + esc(s.ai.runs[0].reason) + "</span></div>" +
      '<div class="pv-foot">Strong evidence, low relevance. The rule and the AI disagree, so the Radar asks a person to look instead of ranking it at the top.</div>' +
      '<p style="margin:10px 0 0"><button class="btn link small" type="button" data-open="' + s.n + '">See the full record ›</button></p>';
  }

  // ---------- misc ----------
  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200); }
  function renderStats() {
    const n = SIGNALS.length;
    const high = SIGNALS.filter((s) => s.ai && s.ai.label === "High").length;
    const look = SIGNALS.filter(needsLook).length;
    const labeled = SIGNALS.filter((s) => s.human && s.ai);
    const acc = labeled.length ? labeled.filter((s) => s.human === s.ai.label).length + " of " + labeled.length : "pending";
    $("#stats").innerHTML = "<span><b>" + n + "</b>public signals</span><span><b>" + high + "</b>read as high relevance</span><span><b>" + look + "</b>flagged for a human look</span><span><b>" + esc(acc) + "</b>AI reads matched an analyst</span>";
  }

  // ---------- wire up ----------
  function bind() {
    $("#f-q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
    [["#f-tier", "tier"], ["#f-ai", "ai"], ["#f-conf", "conf"], ["#f-src", "src"], ["#f-sort", "sort"]].forEach(([id, k]) =>
      $(id).addEventListener("change", (e) => { state[k] = e.target.value; render(); }));
    $("#f-reset").addEventListener("click", resetAll);
    document.addEventListener("click", (e) => {
      const t = e.target;
      const open = t.closest("[data-open]");
      if (open) { e.stopPropagation(); openDetail(open.getAttribute("data-open")); return; }
      const row = t.closest(".row");
      if (row && !t.closest("a,button")) { openDetail(row.getAttribute("data-n")); return; }
      if (t.matches("[data-clear]")) { const k = t.getAttribute("data-clear"); state[k] = k === "minAmt" || k === "since" ? null : k === "needs" ? false : ""; render(); return; }
      if (t.matches("[data-unpend]")) { const k = t.getAttribute("data-unpend"); delete pending[k]; renderPendingChips(); return; }
      if (t.matches("[data-reset]")) { resetAll(); return; }
      if (t.id === "dl-flags") { downloadFlags(); return; }
      if (t.matches(".examples button")) { $("#ask-input").value = t.getAttribute("data-q"); showInterpretation(t.getAttribute("data-q")); return; }
    });
    $("#feed").addEventListener("keydown", (e) => {
      const row = e.target.closest(".row");
      if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDetail(row.getAttribute("data-n")); }
    });
    $("#ask-form").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#ask-input").value.trim(); if (q) showInterpretation(q); });
    $("#ask-run").addEventListener("click", runPending);
    $("#ask-cancel").addEventListener("click", () => { pending = null; $("#interp").classList.remove("show"); });
    const dlg = $("#detail");
    $("#dlg-close").addEventListener("click", () => dlg.close ? dlg.close() : dlg.removeAttribute("open"));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    const top = $("#totop");
    window.addEventListener("scroll", () => top.classList.toggle("show", window.scrollY > 700), { passive: true });
    top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  renderStats();
  renderPreview();
  render();
  renderAccuracy();
  renderFlagsLine();
  bind();
})();
