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
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SWEEP_SECONDS = 9; // keep in step with --T in style.css

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
  function component(s) {
    if (s.source === "federal_register") return "Federal Register";
    const a = shortAgency(s.agency);
    return { "Defense Information Systems Agency": "DISA", "Defense Logistics Agency": "DLA", "Washington Headquarters Services": "WHS" }[a] || a;
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
  function aiChip(a, withText) {
    if (!a) return '<span class="conf-text">No AI read</span>';
    const label = a.label === "Split" ? "No agreement" : a.label;
    const cls = a.label === "Split" ? " split" : a.label === "Unclear" ? " unclear" : "";
    const conf = a.label === "Split" ? "the 3 reads all differ" : a.agree + " of 3 reads agree";
    return '<span class="airead' + cls + '" aria-label="AI relevance read: ' + esc(label) + ", " + esc(conf) + '"><span class="tag" aria-hidden="true">AI</span>' + esc(label) + " " + dots(a) + "</span>" +
      (withText === false ? "" : '<span class="conf-text">' + esc(conf) + "</span>");
  }
  function tierBadge(t) { return '<span class="badge t' + t + '">Tier ' + t + "</span>"; }

  // ---------- the radar scope ----------
  const SECTOR_ORDER = ["Federal Register", "Air Force", "Army", "Navy", "DISA", "DLA", "WHS", "USTRANSCOM"];
  const CX = 300, CY = 300, R = 270, R0 = 64;
  function ageDays(s) { return s.date ? Math.max(0, (SNAPSHOT - new Date(s.date + "T12:00:00")) / 864e5) : 0; }
  const MAXDAYS = Math.max(1130, ...SIGNALS.map(ageDays));
  function radiusFor(days) { return R0 + (R - 18 - R0) * Math.sqrt(days / MAXDAYS); }
  function polar(r, deg) { const t = (deg - 90) * Math.PI / 180; return [CX + r * Math.cos(t), CY + r * Math.sin(t)]; }

  function renderScope() {
    const svg = $("#scope");
    if (!svg) return;
    const NS = "http://www.w3.org/2000/svg";
    const groups = {};
    SIGNALS.forEach((s) => { (groups[component(s)] = groups[component(s)] || []).push(s); });
    const keys = SECTOR_ORDER.filter((k) => groups[k]).concat(Object.keys(groups).filter((k) => !SECTOR_ORDER.includes(k)));
    const weight = (k) => Math.max(groups[k].length, 2.6);
    const total = keys.reduce((a, k) => a + weight(k), 0);
    const GAP = 3;
    let h = '<circle class="disc" cx="300" cy="300" r="' + R + '"/>';
    // range rings, labelled by age
    [[91, "3 mo"], [365, "1 yr"], [730, "2 yr"], [1095, "3 yr"]].forEach(([d, lbl], i) => {
      const r = radiusFor(d);
      h += '<circle class="ring ring-draw" style="animation-delay:' + (i * 0.12) + 's" cx="300" cy="300" r="' + r.toFixed(1) + '"/>';
      const [x, y] = polar(r, 4);
      h += '<text class="ring-label" x="' + (x + 4).toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" paint-order="stroke" stroke="#f3f6f4" stroke-width="4">' + lbl + "</text>";
    });
    let start = 0;
    const blipsSvg = [];
    const placed = [];
    keys.forEach((k) => {
      const span = (360 * weight(k)) / total;
      const a0 = start + GAP / 2, a1 = start + span - GAP / 2;
      // sector boundary
      const [bx, by] = polar(R, start);
      h += '<line class="spoke" x1="300" y1="300" x2="' + bx.toFixed(1) + '" y2="' + by.toFixed(1) + '"/>';
      // label inside the rim
      const mid = (a0 + a1) / 2;
      const [lx, ly] = polar(R - 16, mid);
      h += '<text class="sector-label" x="' + lx.toFixed(1) + '" y="' + (ly + 5).toFixed(1) + '" text-anchor="middle" paint-order="stroke" stroke="#f3f6f4" stroke-width="5">' + esc(k) + "</text>";
      // blips: newest nearest the center
      const list = groups[k].slice().sort((p, q) => (q.date || "").localeCompare(p.date || ""));
      const n = list.length;
      list.forEach((s, i) => {
        const ang = n === 1 ? mid : a0 + 6 + ((a1 - a0 - 12) * i) / (n - 1);
        const r = Math.min(radiusFor(ageDays(s)), R - 34);
        const size = s.source === "usaspending" && s.amount ? Math.max(4.5, Math.min(13, 4 + 9 * Math.sqrt(s.amount / 25e6))) : 6;
        placed.push({ s, ang, r, r0: r, size, lo: a0 + 3, hi: a1 - 3, k });
      });
      start += span;
    });
    // nudge marks in the same sector apart so none hides another (angle first, then a little radius)
    for (let it = 0; it < 300; it++) {
      let moved = false;
      for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
        const p = placed[i], q = placed[j];
        if (p.k !== q.k) continue;
        const [px, py] = polar(p.r, p.ang), [qx, qy] = polar(q.r, q.ang);
        const need = p.size + q.size + 10, d = Math.hypot(px - qx, py - qy);
        if (d >= need) continue;
        moved = true;
        const push = (need - d) / 2 + 0.5;
        const dir = p.ang <= q.ang ? -1 : 1;
        const degP = (push / Math.max(p.r, 1)) * 57.3, degQ = (push / Math.max(q.r, 1)) * 57.3;
        const np = Math.min(p.hi, Math.max(p.lo, p.ang + dir * degP)), nq = Math.min(q.hi, Math.max(q.lo, q.ang - dir * degQ));
        const stuck = Math.abs(np - p.ang) + Math.abs(nq - q.ang) < 0.05;
        p.ang = np; q.ang = nq;
        if (stuck) {
          const rdir = p.r <= q.r ? -1 : 1;
          p.r = Math.min(p.r0 + 22, Math.max(p.r0 - 22, p.r + rdir * push));
          q.r = Math.min(q.r0 + 22, Math.max(q.r0 - 22, q.r - rdir * push));
        }
      }
      if (!moved) break;
    }
    placed.forEach(({ s, ang, r, size }) => {
      {
        const [x, y] = polar(r, ang);
        const delay = ((ang / 360) * SWEEP_SECONDS).toFixed(2);
        const a = s.ai;
        const review = needsLook(s);
        let g = '<g class="blip' + (review ? " review" : "") + '" data-n="' + s.n + '" style="animation-delay:' + delay + 's">';
        g += '<circle class="halo" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (size + 2).toFixed(1) + '" style="animation-delay:' + delay + 's"/>';
        if (a && (a.label === "High" || a.label === "Medium")) g += '<circle class="ai-ring' + (a.label === "Medium" ? " med" : "") + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (size + 4).toFixed(1) + '"/>';
        if (s.source === "federal_register") g += '<rect class="mark t' + s.tier + '" x="' + (x - 6).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" width="12" height="12"/>';
        else g += '<circle class="mark t' + s.tier + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + size.toFixed(1) + '"/>';
        if (review) g += '<circle class="rv" cx="' + (x + size + 2).toFixed(1) + '" cy="' + (y - size - 2).toFixed(1) + '" r="4"/>';
        g += "</g>";
        blipsSvg.push(g);
      }
    });
    h += '<circle class="ring" cx="300" cy="300" r="' + R0 + '" style="stroke-dasharray:none"/><circle cx="300" cy="300" r="3" fill="#1f3a5f"/>';
    svg.insertAdjacentHTML("beforeend", h + blipsSvg.join(""));

    const box = $(".scope-box"), tip = $("#tip");
    svg.addEventListener("mouseover", (e) => {
      const g = e.target.closest(".blip"); if (!g) return;
      const s = SIGNALS.find((x) => x.n === Number(g.dataset.n));
      const a = s.ai;
      tip.innerHTML = "<b>" + esc(s.title) + "</b>" + esc(component(s)) + ", " + esc(fmtDate(s.date)) + (s.amount != null ? ", " + esc(fmtMoney(s.amount)) : "") +
        "<br>Tier " + s.tier + ', <span class="ai">AI read ' + esc(a ? (a.label === "Split" ? "split" : a.label) : "none") + "</span>" + (needsLook(s) ? "<br>Needs a human look" : "");
      const bb = box.getBoundingClientRect(), gb = g.getBoundingClientRect();
      let left = gb.left - bb.left + gb.width / 2 + 12, top = gb.top - bb.top - 8;
      if (left > bb.width - 290) left = gb.left - bb.left - 292;
      tip.style.left = Math.max(0, left) + "px"; tip.style.top = Math.max(0, top) + "px";
      tip.classList.add("show");
    });
    svg.addEventListener("mouseout", (e) => { if (e.target.closest(".blip")) tip.classList.remove("show"); });
    svg.addEventListener("click", (e) => { const g = e.target.closest(".blip"); if (g) { tip.classList.remove("show"); openDetail(g.dataset.n); } });

    const tog = $("#sweep-toggle");
    if (REDUCED) { tog.hidden = true; return; }
    tog.addEventListener("click", () => {
      const paused = box.classList.toggle("paused");
      tog.textContent = paused ? "Resume sweep" : "Pause sweep";
      tog.setAttribute("aria-pressed", String(paused));
    });
  }

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
  let firstRender = true;
  function render() {
    const rows = SIGNALS.filter(matches).sort(sorter);
    $("#count").textContent = "Showing " + rows.length + " of " + SIGNALS.length + " signals";
    renderActiveChips();
    if (!rows.length) {
      $("#feed").innerHTML = '<div class="empty">No signals match these filters. <button class="linkbtn" type="button" data-reset>Clear the filters</button></div>';
      return;
    }
    $("#feed").innerHTML = rows.map((s, i) => {
      const nl = needsLook(s);
      const anim = !firstRender && !REDUCED && i < 14 ? ' enter" style="animation-delay:' + (i * 22) + 'ms' : "";
      return '<div class="row' + (nl ? " needs" : "") + anim + '" role="row" tabindex="0" data-n="' + s.n + '" aria-label="' + esc(s.title) + '">' +
        '<div role="cell"><span class="mlabel">Evidence</span>' + tierBadge(s.tier) + "</div>" +
        '<div role="cell" class="c-title"><div class="title">' + esc(s.title) + '</div><div class="desc" title="Record text as published">' + esc(s.text) + "</div>" +
          '<div class="rowfoot">' + (nl ? '<span class="flag">Check this one</span>' : "") +
          '<button class="rowbtn" type="button" data-open="' + s.n + '">Open the record</button></div></div>' +
        '<div role="cell" class="aicell"><span class="mlabel">AI read</span>' + aiChip(s.ai) + "</div>" +
        '<div role="cell" class="meta"><span class="mlabel">Agency</span>' + esc(shortAgency(s.agency)) + '<div class="src">' + esc(srcName(s.source)) + ", " + esc((s.doc_type || "").toLowerCase()) + "</div></div>" +
        '<div role="cell" class="meta"><span class="mlabel">Date</span>' + esc(fmtDate(s.date)) + "</div>" +
        '<div role="cell" class="meta num"><span class="mlabel">Amount</span>' + (s.amount != null ? esc(fmtMoney(s.amount)) : '<span class="src">n/a</span>') + "</div>" +
        "</div>";
    }).join("");
    firstRender = false;
  }

  function renderActiveChips() {
    const chips = [];
    if (state.agency) chips.push(["agency", "Agency: " + state.agency]);
    if (state.minAmt != null) chips.push(["minAmt", "Amount over " + fmtMoney(state.minAmt)]);
    if (state.since) chips.push(["since", "Since " + fmtDate(state.since)]);
    if (state.keyword) chips.push(["keyword", "Mentions: " + state.keyword.split("|").join(" or ")]);
    if (state.needs) chips.push(["needs", "Needs a human look"]);
    $("#active-chips").innerHTML = chips.map(([k, t]) => '<span class="chip">' + esc(t) + '<button type="button" aria-label="Remove ' + esc(t) + '" data-clear="' + k + '">×</button></span>').join("");
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
        return '<li class="' + (diff ? "diff" : "") + '"><span class="rl">Read ' + (i + 1) + ": " + esc(r.relevance) + "</span>" + esc(r.reason) + (diff ? " <em>(differs from the majority)</em>" : "") + "</li>";
      }).join("") + "</ul>";
    }
    const human = s.human ? (
      a && s.human === a.label
        ? '<div class="callout good"><b>Accuracy check:</b> the analyst labeled this one ' + esc(s.human) + ". They match.</div>"
        : '<div class="callout bad"><b>Accuracy check:</b> the analyst labeled this one ' + esc(s.human) + ". The AI said " + esc(a ? (a.label === "Split" ? "nothing consistent" : a.label) : "nothing") + ".</div>"
    ) : "";
    const flags = loadFlags().filter((f) => f.id === s.id);

    $("#dlg-title").textContent = s.title;
    $("#dlg-body").innerHTML =
      '<div class="dlg-tags">' + tierBadge(s.tier) + aiChip(a) + (look ? '<span class="flag">Check this one</span>' : "") + "</div>" +
      '<section class="sec"><h4>What the record says</h4><blockquote class="quote">' + esc(s.text) + "</blockquote>" +
        '<dl class="kv"><dt>Agency</dt><dd>' + esc(s.agency) + "</dd><dt>Source</dt><dd>" + esc(srcName(s.source)) + ", " + esc((s.doc_type || "").toLowerCase()) + "</dd><dt>Date</dt><dd>" + esc(fmtDate(s.date)) + "</dd>" +
        (s.amount != null ? "<dt>Amount</dt><dd>" + esc(fmtMoney(s.amount)) + " (award amount, per USAspending)</dd>" : "") +
        "<dt>Record ID</dt><dd>" + esc(s.id) + "</dd></dl>" +
        '<p style="margin:12px 0 0"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">Open the source record (new tab)</a></p></section>' +
      '<section class="sec ai-sec"><h4>AI relevance read</h4>' +
        (a ? "<div>" + aiChip(a) + "</div>" + runs +
          (look ? '<div class="callout warn"><b>Why to check it:</b> ' + esc(look) + "</div>" : '<div class="callout info">All three reads agree. Agreement is not proof, so check the record text before acting.</div>') : "<p>No AI read.</p>") +
        human + '<p class="conf-text" style="margin:12px 0 0">Generated by Claude (Anthropic) on ' + esc(fmtDate(META.ai_read_date)) + ", in three independent runs, from this record's text only.</p></section>" +
      '<section class="sec rule-sec"><h4>Why it is Tier ' + s.tier + '</h4><p style="margin:0">' + esc(s.tier_reason) + '</p><p class="conf-text" style="margin:8px 0 0">Set by a plain rule (' + esc(s.tier_rule) + "), not by the AI. A tier says what kind of evidence this is, not whether it matters to zero trust work.</p></section>" +
      '<section class="sec you-sec"><h4>Disagree?</h4><form id="flag-form"><fieldset><legend class="sr-only">Pick one reason</legend>' +
        ["Evidence tier is wrong", "AI relevance read is wrong", "Wrong agency or component", "Duplicate of another signal", "Not relevant to zero trust work", "Other"].map((r) =>
          '<label><input type="radio" name="reason" value="' + esc(r) + '"> ' + esc(r) + "</label>").join("") +
        '</fieldset><label class="sr-only" for="flag-note">Note</label><textarea id="flag-note" rows="2" maxlength="200" placeholder="One line on why (optional)"></textarea>' +
        '<button class="btn small" type="submit" style="margin-top:10px">Log my flag</button></form>' +
        '<p class="conf-text" style="margin:10px 0 0">Flags are held for review. Nothing changes the tier or the AI read on its own. In this prototype, flags stay in your browser.</p>' +
        (flags.length ? '<div class="callout info">You flagged this signal ' + flags.length + " time" + (flags.length > 1 ? "s" : "") + ": " + esc(flags.map((f) => f.reason).join("; ")) + ".</div>" : "") +
      "</section>";
    $("#flag-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const picked = $("input[name=reason]:checked", e.target);
      if (!picked) { toast("Pick one reason first, so the flag can be counted."); return; }
      const note = $("#flag-note").value.trim();
      const all = loadFlags();
      all.push({ id: s.id, n: s.n, title: s.title, tier: s.tier, tier_rule: s.tier_rule, ai_read: a ? a.label : "", reason: picked.value, note, at: new Date().toISOString() });
      saveFlags(all);
      toast("Flag logged for review. Nothing changed automatically.");
      openDetail(s.n);
      renderFlagsLine();
    });
    const dlg = $("#detail");
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
    $(".dlg-body").scrollTop = 0;
    $("#dlg-close").focus();
  }

  // ---------- disagree flags (browser only) ----------
  let memFlags = [];
  function loadFlags() { try { return JSON.parse(localStorage.getItem(FLAG_KEY) || "[]"); } catch (e) { return memFlags; } }
  function saveFlags(f) { memFlags = f; try { localStorage.setItem(FLAG_KEY, JSON.stringify(f)); } catch (e) { /* private mode: keep in memory */ } }
  function renderFlagsLine() {
    const f = loadFlags();
    let el = $("#flagsline");
    if (!el) { el = document.createElement("span"); el.id = "flagsline"; $("#status").appendChild(el); }
    el.innerHTML = f.length ? "<b>Your flags</b> " + f.length + ' <button class="linkbtn" type="button" id="dl-flags">Download as CSV</button>' : "";
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
    const f = {}; const leaps = [];
    let m = t.match(/tier\s*(1|2|3|one|two|three)\b/);
    if (m) { f.tier = { one: "1", two: "2", three: "3" }[m[1]] || m[1]; }
    else if (/\b(strongest evidence|rules? and proposed rules?|proposed rules?|final rules?)\b/.test(t)) { f.tier = "1"; leaps.push('"' + RegExp.lastMatch.trim() + '" read as Tier 1'); }
    if (/\b(awards?|contracts?|usaspending|task orders?|delivery orders?)\b/.test(t)) { f.src = "usaspending"; }
    else if (/\b(federal register|rules?|notices?|regulations?)\b/.test(t)) { f.src = "federal_register"; }
    else if (/\b(sam\.?gov|solicitations?|opportunit(y|ies))\b/.test(t)) { f.src = "sam"; }
    if (/\b(unsure|not sure|uncertain|disagree|check first|check|review|human look|shaky)\b/.test(t)) { f.needs = true; leaps.push('"' + RegExp.lastMatch.trim() + '" read as "needs a human look"'); }
    if (/\b(high(ly)? relevan\w*|most relevant|very relevant)\b/.test(t)) f.ai = "High";
    else if (/\b(medium|moderate(ly)?) relevan\w*/.test(t)) f.ai = "Medium";
    else if (/\b(low relevan\w*|irrelevant|not relevant|off.topic)\b/.test(t)) f.ai = "Low";
    if (/\b(confident|sure|unanimous|all agree)\b/.test(t) && !f.needs) { f.conf = "High"; leaps.push('"' + RegExp.lastMatch.trim() + '" read as "3 of 3 AI reads agree"'); }
    for (const [k, v] of AGENCIES) if (t.includes(" " + k + " ") || t.includes(" " + k + "'")) { f.agency = v; break; }
    m = t.match(/(over|above|more than|at least|>)\s*\$?\s*([\d.,]+)\s*(billion|million|thousand|[bmk])?\b/);
    if (m) f.minAmt = parseMoney(m[2], m[3]);
    else if (/\b(big|large|biggest|largest)\b/.test(t)) { f.minAmt = 1e6; leaps.push('"' + RegExp.lastMatch + '" read as "over $1M"'); }
    m = t.match(/(last|past)\s+(\d+)\s+(day|week|month|year)s?/);
    if (m) { const mult = { day: 1, week: 7, month: 30, year: 365 }[m[3]]; f.since = isoDaysBefore(Number(m[2]) * mult); leaps.push('"' + m[0] + '" counted back from the Oct 11, 2026 snapshot'); }
    else if ((m = t.match(/(since|after|from)\s+(20\d\d)/))) f.since = m[2] + "-01-01";
    else if (/\bthis year\b/.test(t)) { f.since = SNAPSHOT.getFullYear() + "-01-01"; }
    else if (/\b(recent|new|latest|newest)\b/.test(t)) { f.since = isoDaysBefore(180); leaps.push('"' + RegExp.lastMatch + '" read as the last 180 days'); }
    const kws = [];
    for (const [k, v] of KEYWORDS) if (t.includes(k) && !kws.includes(v)) kws.push(v);
    if (kws.length) f.keyword = kws.slice(0, 3).join("|");
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
    $("#interp").classList.add("show");
    if (!chips.length) {
      $("#interp-chips").innerHTML = "";
      $("#ask-run").hidden = true;
      $("#ask-did").innerHTML = '<span class="miss">I could not turn that into a filter, so I did not guess.</span> Try naming a tier, an agency (Army, Navy, Air Force, DISA), an amount ("over $1M"), a time window ("since 2025"), or a topic like identity or cloud. The filters below do the same job by hand.';
      return;
    }
    $("#ask-run").hidden = false;
    renderPendingChips();
    $("#ask-did").innerHTML = "<b>What I did:</b> read your words into the filters above. I have not searched anything yet, and I cannot invent a signal or change a score." +
      (leaps.length ? "<br><b>Leaps I made:</b> " + esc(leaps.join("; ")) + "." : "");
  }
  function renderPendingChips() {
    $("#interp-chips").innerHTML = describe(pending).map(([k, t]) => '<span class="chip">' + esc(t) + '<button type="button" aria-label="Remove ' + esc(t) + '" data-unpend="' + k + '">×</button></span>').join("");
    if (!describe(pending).length) $("#ask-run").hidden = true;
  }
  function runPending() {
    if (!pending) return;
    Object.assign(state, { tier: "", ai: "", conf: "", src: "", agency: "", minAmt: null, since: null, keyword: "", needs: false, q: "", sort: pending.sort || "relevance" }, pending);
    syncControls(); render();
    $("#interp").classList.remove("show");
    const n = SIGNALS.filter(matches).length;
    toast(n + " signal" + (n === 1 ? "" : "s") + " match. The filters stay visible above the list.");
    $(".filters").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  }

  // ---------- accuracy ----------
  function renderAccuracy() {
    const el = $("#acc-body");
    const withAi = SIGNALS.filter((s) => s.ai);
    const ag = { 3: 0, 2: 0, split: 0 };
    withAi.forEach((s) => { if (s.ai.label === "Split") ag.split++; else ag[s.ai.agree]++; });
    const N = withAi.length;
    const stack = '<div class="stack" role="img" aria-label="' + ag[3] + " signals with 3 of 3 reads agreeing, " + ag[2] + " with 2 of 3, " + ag.split + ' with no two agreeing">' +
      '<span class="s3" style="flex:' + ag[3] + '">' + ag[3] + '</span><span class="s2" style="flex:' + ag[2] + '">' + ag[2] + '</span><span class="s1" style="flex:' + Math.max(ag.split, 0.0001) + '">' + ag.split + "</span></div>" +
      '<div class="stack-key"><span>' + ag[3] + " of " + N + " with all three reads agreeing</span><span>" + ag[2] + " with two of three</span><span>" + ag.split + " with no two agreeing</span></div>";
    const labeled = SIGNALS.filter((s) => s.human && s.ai);
    if (!labeled.length) {
      el.innerHTML = '<p class="acc-lead">Accuracy is not measured yet.</p><div class="acc-grid"><div><h3>How often the AI agreed with itself</h3>' + stack + '</div><div class="pending">Treat the AI read as a sorting aid, not a verdict, until a person has checked it.</div></div>';
      return;
    }
    const hits = labeled.filter((s) => s.human === s.ai.label);
    const counts = {}; labeled.forEach((s) => { counts[s.human] = (counts[s.human] || 0) + 1; });
    const top = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];
    const rest = labeled.filter((s) => s.human !== top);
    const restHits = rest.filter((s) => s.human === s.ai.label).length;
    const L = labeled.length;
    const pct = (x) => Math.round((100 * x) / L);
    const byConf = ["High", "Medium", "Low"].map((c) => {
      const g = labeled.filter((s) => s.ai.confidence === c);
      return { c, n: g.length, h: g.filter((s) => s.human === s.ai.label).length };
    });
    const confName = { High: "3 of 3 agree", Medium: "2 of 3 agree", Low: "no two agree" };
    const LBL = ["High", "Medium", "Low", "Unclear"];
    const aiCols = LBL.concat(labeled.some((s) => s.ai.label === "Split") ? ["Split"] : []);
    let cm = '<table class="plain cm"><caption class="sr-only">Analyst label by AI read</caption><tr><th>Analyst, then AI</th>' + aiCols.map((c) => '<th class="num">' + (c === "Split" ? "No agreement" : c) + "</th>").join("") + "</tr>";
    LBL.forEach((h) => {
      if (!labeled.some((s) => s.human === h)) return;
      cm += "<tr><th>" + h + "</th>" + aiCols.map((c) => {
        const n = labeled.filter((s) => s.human === h && s.ai.label === c).length;
        return '<td class="num ' + (h === c && n ? "hit" : n ? "" : "zero") + '">' + n + "</td>";
      }).join("") + "</tr>";
    });
    cm += "</table>";
    const misses = labeled.filter((s) => s.human !== s.ai.label);
    el.innerHTML =
      '<p class="acc-lead">The AI read matched the analyst on <b>' + hits.length + " of " + L + "</b> records. A lazy rule that calls everything " + esc(top) + " matches " + counts[top] + ".</p>" +
      '<div class="vs"><span class="lbl">AI relevance read</span><div class="track"><span class="fill ai" data-w="' + pct(hits.length) + '"></span></div><span class="val">' + hits.length + " of " + L + "</span>" +
      '<span class="lbl">Lazy rule: everything ' + esc(top) + '</span><div class="track"><span class="fill lazy" data-w="' + pct(counts[top]) + '"></span></div><span class="val">' + counts[top] + " of " + L + "</span></div>" +
      '<p class="acc-note">The AI read earns its place on the ' + rest.length + " records the analyst rated something other than " + esc(top) + ". It matched " + restHits + " of them; the lazy rule matches none.</p>" +
      '<div class="acc-grid"><div><h3>Does agreement earn trust?</h3>' + stack +
        '<table class="plain"><tr><th>AI reads</th><th class="num">Signals</th><th class="num">Matched analyst</th><th></th></tr>' +
        byConf.map((r) => "<tr><td>" + confName[r.c] + '</td><td class="num">' + r.n + '</td><td class="num">' + (r.n ? r.h + " (" + Math.round((100 * r.h) / r.n) + "%)" : "n/a") + '</td><td><div class="minibar"><span style="width:' + (r.n ? (100 * r.h) / r.n : 0) + '%"></span></div></td></tr>').join("") +
        '</table><p class="conf-text" style="margin:10px 0 0">If unanimous reads match the analyst more often than split ones, the dots are telling you something real. With ' + L + " records this is a first look, not a measured rate.</p></div>" +
      "<div><h3>Where they agreed and where they did not</h3>" + cm + "</div></div>" +
      '<div class="misses"><h3>Every miss (' + misses.length + ")</h3>" +
        (misses.length ? '<ul class="misslist">' + misses.map((s) => '<li><button type="button" data-open="' + s.n + '">' + esc(s.title) + "</button><br>Analyst: <b>" + esc(s.human) + "</b>. AI: <b>" + esc(s.ai.label === "Split" ? "no agreement" : s.ai.label) + "</b> (" + esc(confName[s.ai.confidence]) + ").</li>").join("") + "</ul>" : "<p>None.</p>") + "</div>" +
      '<p class="method">Method: one analyst (the product owner) labeled ' + (L === SIGNALS.length ? "all " + L : L + " of the " + SIGNALS.length) + " records High, Medium, Low, or Unclear. The check is not fully blind: the AI reads for four records (1, 7, 8, and 15) had already appeared in design screenshots, and the labeling guide was written after the AI runs. The analyst also saw fuller public record details (contracting office, industry and product codes, period of performance) that the AI read did not. Treat the match rate as a first look." + (L < SIGNALS.length ? " Unlabeled records are left out of every number in this section." : "") + "</p>";
    // grow the two comparison bars when the section comes into view
    const fills = $$(".vs .fill", el);
    const grow = () => fills.forEach((f) => { f.style.width = f.dataset.w + "%"; });
    if (REDUCED || !("IntersectionObserver" in window)) { grow(); return; }
    const io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) { grow(); io.disconnect(); } }, { threshold: 0.4 });
    io.observe($(".vs", el));
  }

  // ---------- story preview: one real signal, explained ----------
  function renderPreview() {
    const s = SIGNALS.find((x) => x.tier === 1 && x.ai && x.ai.label === "Low") || SIGNALS[0];
    if (!s || !s.ai) return;
    $("#preview").innerHTML =
      '<div class="pv-row">' + tierBadge(s.tier) + aiChip(s.ai) + '<span class="flag">Check this one</span></div>' +
      '<div class="pv-title">' + esc(s.title) + "</div>" +
      "<dl><dt>Rule</dt><dd>" + esc(s.tier_reason.replace(/^Tier \d, rule [^:]+: /, "")) + ", the strongest evidence type.</dd>" +
      '<dt>AI read</dt><dd class="ai">' + esc(s.ai.runs[0].reason) + "</dd></dl>" +
      '<p class="pv-foot"><button class="linkbtn" type="button" data-open="' + s.n + '">Open the full record</button></p>';
  }

  // ---------- page chrome ----------
  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200); }
  function chrome() {
    const top = $("#totop"), bar = $("#progress");
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.width = (max > 0 ? (100 * scrollY) / max : 0) + "%";
      top.classList.toggle("show", scrollY > 700);
    };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
    top.addEventListener("click", () => scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" }));
    if (!("IntersectionObserver" in window)) return;
    const links = $$(".nav a");
    const io = new IntersectionObserver((ents) => {
      ents.forEach((e) => { if (e.isIntersecting) links.forEach((l) => l.classList.toggle("on", l.getAttribute("href") === "#" + e.target.id)); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["radar", "accuracy", "test", "about"].forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
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
      if (t.matches("[data-unpend]")) { delete pending[t.getAttribute("data-unpend")]; renderPendingChips(); return; }
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
    $("#dlg-close").addEventListener("click", () => (dlg.close ? dlg.close() : dlg.removeAttribute("open")));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }

  renderScope();
  renderPreview();
  render();
  renderAccuracy();
  renderFlagsLine();
  bind();
  chrome();
})();
