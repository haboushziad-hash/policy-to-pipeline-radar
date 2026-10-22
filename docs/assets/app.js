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
  function dateLabel(s) { return s.source === "usaspending" ? "Start date" : s.source === "federal_register" ? "Published" : "Posted"; }
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

  // ---------- shared glyph: same mark on the radar and in the list ----------
  function fillClass(a) { if (!a) return "f-unc"; return { High: "f-high", Medium: "f-med", Low: "f-low" }[a.label] || "f-unc"; }
  function glyph(s) {
    const fc = fillClass(s.ai);
    let g = '<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">';
    if (needsLook(s)) g += '<circle class="lookring" cx="12" cy="12" r="10.4"/>';
    g += s.source === "federal_register" ? '<rect class="mk ' + fc + '" x="6.5" y="6.5" width="11" height="11"/>' : '<circle class="mk ' + fc + '" cx="12" cy="12" r="6"/>';
    return g + "</svg>";
  }

  // ---------- the radar scope ----------
  const SECTOR_ORDER = ["Federal Register", "Air Force", "Army", "Navy", "DISA", "DLA", "WHS", "USTRANSCOM"];
  const CX = 300, CY = 300, R = 240, R0 = 46, MAXDAYS = 1140;
  function ageDays(s) { return s.date ? Math.max(0, (SNAPSHOT - new Date(s.date + "T12:00:00")) / 864e5) : MAXDAYS; }
  function radiusFor(days) { return R0 + (R - 12 - R0) * Math.sqrt(Math.min(days, MAXDAYS) / MAXDAYS); }
  function polar(r, deg) { const t = (deg - 90) * Math.PI / 180; return [CX + r * Math.cos(t), CY + r * Math.sin(t)]; }
  function arcPath(r, a0, a1, reverse) {
    const [x0, y0] = polar(r, reverse ? a1 : a0), [x1, y1] = polar(r, reverse ? a0 : a1);
    return "M" + x0.toFixed(1) + " " + y0.toFixed(1) + " A" + r + " " + r + " 0 " + (a1 - a0 > 180 ? 1 : 0) + " " + (reverse ? 0 : 1) + " " + x1.toFixed(1) + " " + y1.toFixed(1);
  }
  function jitter(n) { const v = Math.sin(n * 12.9898 + 4.1) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; }
  const SECTORS = [];

  function renderScope() {
    const svg = $("#scope");
    if (!svg) return;
    const groups = {};
    SIGNALS.forEach((s) => { (groups[component(s)] = groups[component(s)] || []).push(s); });
    const keys = SECTOR_ORDER.filter((k) => groups[k]).concat(Object.keys(groups).filter((k) => !SECTOR_ORDER.includes(k)));
    const weight = (k) => (k === "Federal Register" ? 10 : Math.max(groups[k].length, 3));
    const total = keys.reduce((a, k) => a + weight(k), 0);
    let wedges = "", labels = "", defs = "";
    let start = 0;
    const placed = [];
    keys.forEach((k, idx) => {
      const span = (360 * weight(k)) / total, a0 = start, a1 = start + span, mid = (a0 + a1) / 2;
      SECTORS.push({ k, a0, a1 });
      const [x0, y0] = polar(R, a0), [x1, y1] = polar(R, a1);
      wedges += '<path class="wedge' + (idx % 2 ? " alt" : "") + '" data-comp="' + esc(k) + '" d="M300 300 L' + x0.toFixed(1) + " " + y0.toFixed(1) + " A" + R + " " + R + " 0 " + (span > 180 ? 1 : 0) + " 1 " + x1.toFixed(1) + " " + y1.toFixed(1) + ' Z"><title>' + esc(k) + ": " + groups[k].length + " signal" + (groups[k].length > 1 ? "s" : "") + ". Click to filter the list.</title></path>";
      // label on a curved path just outside the rim; flipped on the lower half so it reads left to right
      const lower = mid > 90 && mid < 270;
      defs += '<path id="lab-' + idx + '" d="' + arcPath(lower ? R + 20 : R + 9, a0, a1, lower) + '"/>';
      labels += '<text class="sector-label" data-comp="' + esc(k) + '"><textPath href="#lab-' + idx + '" startOffset="50%" text-anchor="middle">' + esc(k) + '<tspan class="sector-count"> ' + groups[k].length + "</tspan></textPath></text>";
      // place marks at their true age; spread them across the wedge so none hides another
      groups[k].slice().sort((p, q) => ageDays(p) - ageDays(q)).forEach((s) => {
        const r0 = radiusFor(ageDays(s));
        let best = null;
        const r90 = radiusFor(90), young = ageDays(s) < 90;
        for (const dr of [0, 8, -8, 14, -14, 20, -20]) {
          const r = r0 + dr;
          if (young ? r > r90 - 9 : r < r90 + 9) continue;
          if (r < R0 + 6) continue;
          const pad = (13 / r) * 57.3;
          const lo = a0 + pad, hi = a1 - pad;
          if (lo > hi) continue;
          const pref = Math.min(hi, Math.max(lo, mid + jitter(s.n) * (hi - lo) * 0.42));
          const cands = [];
          for (let a = lo; a <= hi + 1e-9; a += 0.5) cands.push(a);
          cands.sort((p, q) => Math.abs(p - pref) - Math.abs(q - pref));
          for (const ang of cands) {
            const [x, y] = polar(r, ang);
            if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= 25)) { best = { ang, r, x, y }; break; }
          }
          if (best) break;
        }
        if (!best) { const [x, y] = polar(r0, mid); best = { ang: mid, r: r0, x, y }; }
        placed.push(Object.assign(best, { s }));
      });
      start += span;
    });

    let rings = "";
    // ring labels go where no mark sits: try angles around the rim and keep the clearest one per ring
    [[90, "90 days"], [365, "1 yr"], [730, "2 yr"], [1095, "3 yr"]].forEach(([d, lbl], i) => {
      const r = radiusFor(d);
      rings += '<circle class="ring ring-draw' + (d === 90 ? " r90" : "") + '" style="animation-delay:' + (i * 0.1) + 's" cx="300" cy="300" r="' + r.toFixed(1) + '"/>';
      let bestA = 0, bestD = -1;
      for (let a = 0; a < 360; a += 2) {
        const [x, y] = polar(r, a);
        const dmin = Math.min(...placed.map((p) => Math.hypot((p.x - x) / 1.8, p.y - y)));
        const bias = -Math.abs(((a + 180) % 360) - 180) * 0.02; // prefer the top of the scope when it is just as clear
        if (dmin + bias > bestD) { bestD = dmin + bias; bestA = a; }
      }
      const [lx, ly] = polar(r, bestA);
      rings += '<text class="ring-label" x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" text-anchor="middle">' + lbl + "</text>";
    });

    const blips = placed.map(({ s, ang, x, y }) => {
      const delay = ((ang / 360) * SWEEP_SECONDS).toFixed(2);
      const fc = fillClass(s.ai), look = needsLook(s);
      let g = '<g class="blip" data-n="' + s.n + '">';
      g += '<circle class="hit" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="12"/>';
      g += '<circle class="ping' + (look ? " amber" : "") + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="7" style="animation-delay:' + delay + 's"/>';
      g += '<circle class="flash" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="9" style="animation-delay:' + delay + 's"/>';
      if (look) g += '<circle class="lookring" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="10.4"/>';
      g += s.source === "federal_register"
        ? '<rect class="mk ' + fc + '" x="' + (x - 5.5).toFixed(1) + '" y="' + (y - 5.5).toFixed(1) + '" width="11" height="11"/>'
        : '<circle class="mk ' + fc + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="6"/>';
      return g + "</g>";
    }).join("");

    svg.insertAdjacentHTML("beforeend",
      "<defs>" + defs + "</defs>" +
      '<g class="wedges">' + wedges + "</g>" +
      '<circle class="rim" cx="300" cy="300" r="' + R + '"/>' +
      '<g class="rings">' + rings + "</g>" +
      '<circle class="core" cx="300" cy="300" r="' + (R0 - 8) + '"/>' +
      '<text class="core-label" x="300" y="297" text-anchor="middle">Oct 11</text><text class="core-sub" x="300" y="311" text-anchor="middle">2026</text>' +
      labels + '<g class="blips">' + blips + "</g>");

    const box = $(".scope-box"), tip = $("#tip");
    function showTip(g) {
      const s = SIGNALS.find((x) => x.n === Number(g.dataset.n));
      const a = s.ai;
      tip.innerHTML = "<b>" + esc(s.title) + "</b>" + esc(component(s)) + ", " + (s.source === "usaspending" ? "starts " : "published ") + esc(fmtDate(s.date)) + (s.amount != null ? ", " + esc(fmtMoney(s.amount)) : "") +
        "<br>Tier " + s.tier + ', <span class="ai">AI read ' + esc(a ? (a.label === "Split" ? "split" : a.label) : "none") + "</span>" + (needsLook(s) ? '<br><span class="lk">Needs a human look</span>' : "") + '<span class="hint">Click to open</span>';
      const bb = box.getBoundingClientRect(), gb = g.getBoundingClientRect();
      let left = gb.left - bb.left + gb.width / 2 + 14, top = gb.top - bb.top - 6;
      if (left > bb.width - 270) left = gb.left - bb.left - 274;
      tip.style.left = Math.max(0, left) + "px"; tip.style.top = Math.max(0, Math.min(top, bb.height - 120)) + "px";
      tip.classList.add("show");
    }
    svg.addEventListener("mouseover", (e) => {
      const g = e.target.closest(".blip");
      if (g) { showTip(g); hotlight(g.dataset.n, true); return; }
      const w = e.target.closest(".wedge"); $$(".sector-label", svg).forEach((t) => t.classList.toggle("hov", !!w && t.dataset.comp === w.dataset.comp));
    });
    svg.addEventListener("mouseout", (e) => { const g = e.target.closest(".blip"); if (g) { tip.classList.remove("show"); hotlight(g.dataset.n, false); } });
    svg.addEventListener("click", (e) => {
      const g = e.target.closest(".blip");
      if (g) { tip.classList.remove("show"); openDetail(g.dataset.n); return; }
      const w = e.target.closest(".wedge");
      if (w) {
        state.comp = state.comp === w.dataset.comp ? "" : w.dataset.comp; render();
        if (state.comp) { $("#radar").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" }); toast("Showing the " + (state.comp === "Federal Register" ? "Federal Register documents" : state.comp + " signals") + ". Remove the wedge chip to see all."); }
      }
    });

    const sweep = $("#sweep");
    sweep.style.animation = "none"; void sweep.offsetWidth; sweep.style.animation = "";
    $$(".blip .ping", svg).forEach((c) => { c.style.animationName = "none"; void c.getBoundingClientRect(); c.style.animationName = ""; });
    const tog = $("#sweep-toggle");
    if (REDUCED) { tog.textContent = "Play sweep"; tog.setAttribute("aria-pressed", "true"); }
    tog.addEventListener("click", () => {
      if (REDUCED && !box.classList.contains("motion")) {
        box.classList.add("motion");
        sweep.style.animation = "none"; void sweep.offsetWidth; sweep.style.animation = "";
        tog.textContent = "Pause sweep"; tog.setAttribute("aria-pressed", "false");
        return;
      }
      const paused = box.classList.toggle("paused");
      tog.textContent = paused ? "Resume sweep" : "Pause sweep";
      tog.setAttribute("aria-pressed", String(paused));
    });
  }

  // highlight one record on the radar and in the list together
  function hotlight(n, on) {
    const svg = $("#scope");
    const g = svg && $('.blip[data-n="' + n + '"]', svg);
    if (g) g.classList.toggle("hot", on);
    if (svg) svg.classList.toggle("focus", on && !!g);
    const row = $('.row[data-n="' + n + '"]');
    if (row) row.classList.toggle("hot", on);
  }
  function syncScope(rows) {
    const svg = $("#scope");
    if (!svg) return;
    const keep = new Set(rows.map((s) => s.n));
    $$(".blip", svg).forEach((g) => g.classList.toggle("off", !keep.has(Number(g.dataset.n))));
    $$(".wedge", svg).forEach((w) => w.classList.toggle("on", w.dataset.comp === state.comp));
    $$(".sector-label", svg).forEach((t) => t.classList.toggle("on", t.dataset.comp === state.comp));
    const sc = $("#scope-count");
    if (sc) sc.textContent = rows.length === SIGNALS.length ? "All " + SIGNALS.length + " signals on the radar" : rows.length + " of " + SIGNALS.length + " signals match the filters";
  }

  // ---------- state ----------
  const state = { q: "", tier: "", ai: "", conf: "", src: "", sort: "relevance", agency: "", minAmt: null, since: null, keyword: "", needs: false, comp: "" };

  function matches(s) {
    if (state.tier && String(s.tier) !== state.tier) return false;
    if (state.ai && (!s.ai || s.ai.label !== state.ai)) return false;
    if (state.conf && (!s.ai || s.ai.confidence !== state.conf)) return false;
    if (state.src && s.source !== state.src) return false;
    if (state.comp && component(s) !== state.comp) return false;
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
    syncScope(rows);
    if (!rows.length) {
      $("#feed").innerHTML = '<div class="empty">No signals match these filters. <button class="linkbtn" type="button" data-reset>Clear the filters</button></div>';
      return;
    }
    $("#feed").innerHTML = rows.map((s, i) => {
      const nl = needsLook(s);
      const anim = !firstRender && !REDUCED && i < 14 ? ' enter" style="animation-delay:' + (i * 22) + 'ms' : "";
      return '<div class="row' + (nl ? " needs" : "") + anim + '" role="row" tabindex="0" data-n="' + s.n + '" aria-label="' + esc(s.title) + '">' +
        '<div role="cell"><span class="mlabel">Evidence</span>' + tierBadge(s.tier) + "</div>" +
        '<div role="cell" class="c-title"><div class="t-line">' + glyph(s) + '<div class="title">' + esc(s.title) + '</div></div><div class="desc" title="Record text as published">' + esc(s.text) + "</div>" +
          '<div class="rowfoot">' + (nl ? '<span class="flag">Check this one</span>' : "") +
          '<button class="rowbtn" type="button" data-open="' + s.n + '">Open the record</button></div></div>' +
        '<div role="cell" class="aicell"><span class="mlabel">AI read</span>' + aiChip(s.ai) + "</div>" +
        '<div role="cell" class="meta"><span class="mlabel">Agency</span>' + esc(shortAgency(s.agency)) + '<div class="src">' + esc(srcName(s.source)) + ", " + esc((s.doc_type || "").toLowerCase()) + "</div></div>" +
        '<div role="cell" class="meta"><span class="mlabel">Date</span>' + esc(fmtDate(s.date)) + '<div class="src">' + (s.source === "usaspending" ? "start date" : "published") + "</div></div>" +
        '<div role="cell" class="meta num"><span class="mlabel">Amount</span>' + (s.amount != null ? esc(fmtMoney(s.amount)) : '<span class="src">n/a</span>') + "</div>" +
        "</div>";
    }).join("");
    firstRender = false;
  }

  function renderActiveChips() {
    const chips = [];
    if (state.comp) chips.push(["comp", state.comp === "Federal Register" ? "Wedge: Federal Register documents" : "Wedge: " + state.comp]);
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
    Object.assign(state, { q: "", tier: "", ai: "", conf: "", src: "", sort: "relevance", agency: "", minAmt: null, since: null, keyword: "", needs: false, comp: "" });
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
        return '<li class="' + (diff ? "diff" : "") + '"><span class="rl">Read ' + (i + 1) + ": " + esc(r.relevance) + '</span><span class="rr">' + esc(r.reason) + "</span>" + (diff ? " <em>(differs from the majority)</em>" : "") + "</li>";
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
        '<dl class="kv"><dt>Agency</dt><dd>' + esc(s.agency) + "</dd><dt>Source</dt><dd>" + esc(srcName(s.source)) + ", " + esc((s.doc_type || "").toLowerCase()) + "</dd><dt>" + dateLabel(s) + "</dt><dd>" + esc(fmtDate(s.date)) + "</dd>" +
        (s.amount != null ? "<dt>Amount</dt><dd>" + esc(fmtMoney(s.amount)) + " (award amount, per USAspending)</dd>" : "") +
        "<dt>Record ID</dt><dd>" + esc(s.id) + "</dd></dl>" +
        '<p style="margin:12px 0 0"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">Open the source record (new tab)</a></p></section>' +
      '<section class="sec ai-sec"><h4>AI relevance read</h4>' +
        (a ? "<div>" + aiChip(a) + "</div>" + runs +
          (look ? '<div class="callout warn"><b>Why to check it:</b> ' + esc(look) + "</div>" : '<div class="callout info">All three reads agree. Agreement is not proof, so check the record text before acting.</div>') : "<p>No AI read.</p>") +
        human + '<p class="conf-text" style="margin:12px 0 0">Generated by Claude (Anthropic) on ' + esc(fmtDate(META.ai_read_date)) + ", in three separate runs, from this record's title, agency, and text only.</p></section>" +
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
    const t = " " + q.toLowerCase().replace(/[?!,;]|\.(?!\d)/g, " ").replace(/\s+/g, " ") + " ";
    const f = {}; const leaps = [];
    let m = t.match(/tier\s*(1|2|3|one|two|three)\b/);
    if (m) { f.tier = { one: "1", two: "2", three: "3" }[m[1]] || m[1]; }
    else if (/\b(strongest evidence|rules? and proposed rules?|proposed rules?|final rules?)\b/.test(t)) { f.tier = "1"; leaps.push('"' + RegExp.lastMatch.trim() + '" read as Tier 1'); }
    if (/\b(awards?|contracts?|usaspending|task orders?|delivery orders?)\b/.test(t)) { f.src = "usaspending"; }
    else if (/\b(samgov|sam gov|sam|solicitations?|opportunit(y|ies))\b/.test(t)) { f.src = "sam"; }
    else if (/\b(federal register|rules?|notices?|regulations?)\b/.test(t)) { f.src = "federal_register"; }
    if (/\b(unsure|not sure|uncertain|disagree|check first|check|review|human look|shaky)\b/.test(t)) { f.needs = true; if (RegExp.lastMatch.trim() !== "human look") leaps.push('"' + RegExp.lastMatch.trim() + '" read as "needs a human look"'); }
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
    // say plainly which words were not used, so nothing is dropped silently
    const KNOWN = /^(tier|one|two|three|[123]|strongest|evidence|rules?|proposed|final|awards?|contracts?|usaspending|task|delivery|orders?|federal|register|notices?|regulations?|samgov|sam|gov|solicitations?|opportunit(y|ies)|unsure|not|sure|uncertain|disagree|check|first|review|human|look|shaky|high(ly)?|medium|moderate(ly)?|low|relevan\w*|most|very|irrelevant|off|topic|confident|unanimous|all|agree|over|above|more|than|at|least|big|large|biggest|largest|last|past|days?|weeks?|months?|years?|since|after|from|this|year|recent|new|latest|newest|start|with|priorit\w*|need|needs|zero|trust|signals?|records?|the|a|an|and|or|of|for|to|in|on|about|is|are|was|be|that|which|what|show|me|find|list|give|i|should|do|any|get|there|ones?|by|has|have|ai|dod|\$?[\d.,]+[bmk]?|million|billion|thousand|[bmk])$/;
    const agencyWords = AGENCIES.reduce((acc, [k]) => acc.concat(k.split(" ")), []);
    const kwWords = KEYWORDS.map(([k]) => k);
    const unused = t.trim().split(" ").filter((w) => w && !KNOWN.test(w.replace(/^\$/, "")) && !agencyWords.includes(w) && !kwWords.some((k) => w.startsWith(k.split(" ")[0])));
    return { f, leaps, unused: unused.filter((w, i) => unused.indexOf(w) === i) };
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
    const { f, leaps, unused } = parseQuestion(q);
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
      (leaps.length ? "<br><b>Leaps I made:</b> " + esc(leaps.join("; ")) + "." : "") +
      (unused.length ? '<br><span class="miss">Words I did not use:</span> ' + esc(unused.join(", ")) + ". Results may be broader than you meant." : "");
  }
  function renderPendingChips() {
    $("#interp-chips").innerHTML = describe(pending).map(([k, t]) => '<span class="chip">' + esc(t) + '<button type="button" aria-label="Remove ' + esc(t) + '" data-unpend="' + k + '">×</button></span>').join("");
    if (!describe(pending).length) $("#ask-run").hidden = true;
  }
  function runPending() {
    if (!pending) return;
    Object.assign(state, { tier: "", ai: "", conf: "", src: "", agency: "", minAmt: null, since: null, keyword: "", needs: false, q: "", comp: "", sort: pending.sort || "relevance" }, pending);
    syncControls(); render();
    $("#interp").classList.remove("show");
    const n = SIGNALS.filter(matches).length;
    toast(n + (n === 1 ? " signal matches." : " signals match.") + " The filters stay visible above the list.");
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
    // one square per record, grouped by the analyst's label: top row is the AI read, bottom row is the lazy rule
    const groupsOrder = LBL.filter((h) => labeled.some((s) => s.human === h));
    const cell = (s, hit, who) => '<span class="u ' + (hit ? "hit" : "miss") + '" data-open="' + s.n + '" title="' + esc(s.title) + ". Analyst: " + esc(s.human) + ". " + (who === "ai" ? "AI: " + esc(s.ai.label === "Split" ? "no agreement" : s.ai.label) : "Lazy rule: " + esc(top)) + '."></span>';
    const units = '<div class="units" role="img" aria-label="' + hits.length + " of " + L + " records where the AI read matched the analyst, against " + counts[top] + " for a rule that calls everything " + esc(top) + '">' +
      '<div class="u-labels"><span><b>AI relevance read</b> ' + hits.length + " of " + L + "</span><span><b>Lazy rule: everything " + esc(top) + "</b> " + counts[top] + " of " + L + '</span><span class="u-al">Analyst said</span></div>' +
      '<div class="u-groups">' + groupsOrder.map((h, gi) => {
        const g = labeled.filter((s) => s.human === h).sort((p, q) => ((p.human === p.ai.label ? 0 : 1) - (q.human === q.ai.label ? 0 : 1)) || p.n - q.n);
        return '<div class="u-group" style="--n:' + g.length + '">' +
          '<span class="u-rl">AI read</span><div class="u-cells ai">' + g.map((s, k) => cell(s, s.human === s.ai.label, "ai")).join("") + "</div>" +
          '<span class="u-rl">Lazy rule</span><div class="u-cells lazy">' + g.map((s) => cell(s, h === top, "lazy")).join("") + "</div>" +
          '<div class="u-cap"><span class="u-m">Analyst said </span>' + h + " <span>(" + g.length + ")</span></div></div>";
      }).join("") + "</div></div>" +
      '<p class="u-key"><i class="u hit"></i>AI read matched the analyst <i class="u lazyhit"></i>Lazy rule matched <i class="u miss"></i>Did not match <span>Hover a square for the record, click to open it.</span></p>';
    el.innerHTML =
      '<p class="acc-lead">The AI read matched the analyst on <b>' + hits.length + " of " + L + "</b> records. A lazy rule that calls everything " + esc(top) + " matches " + counts[top] + ".</p>" +
      units +
      '<p class="acc-note">The AI read earns its place on the ' + rest.length + " records the analyst rated something other than " + esc(top) + ". It matched " + restHits + " of them; the lazy rule matches none.</p>" +
      '<div class="acc-grid"><div><h3>Does agreement earn trust?</h3>' + stack +
        '<table class="plain"><tr><th>AI reads</th><th class="num">Signals</th><th class="num">Matched analyst</th><th></th></tr>' +
        byConf.map((r) => "<tr><td>" + confName[r.c] + '</td><td class="num">' + r.n + '</td><td class="num">' + (r.n ? r.h + " (" + Math.round((100 * r.h) / r.n) + "%)" : "n/a") + '</td><td><div class="minibar"><span style="width:' + (r.n ? (100 * r.h) / r.n : 0) + '%"></span></div></td></tr>').join("") +
        '</table><p class="conf-text" style="margin:10px 0 0">If unanimous reads match the analyst more often than split ones, the dots are telling you something real. With ' + L + " records this is a first look, not a measured rate.</p></div>" +
      "<div><h3>Where they agreed and where they did not</h3>" + cm + "</div></div>" +
      '<div class="misses"><h3>Every miss (' + misses.length + ")</h3>" +
        (misses.length ? '<ul class="misslist">' + misses.map((s) => '<li><button type="button" data-open="' + s.n + '">' + esc(s.title) + "</button><br>Analyst: <b>" + esc(s.human) + "</b>. <span class=\"aitxt\">AI: <b>" + esc(s.ai.label === "Split" ? "no agreement" : s.ai.label) + "</b></span> (" + esc(confName[s.ai.confidence]) + ").</li>").join("") + "</ul>" : "<p>None.</p>") + "</div>" +
      '<p class="method">Method: one analyst (the product owner) labeled ' + (L === SIGNALS.length ? "all " + L : L + " of the " + SIGNALS.length) + " records High, Medium, Low, or Unclear. The check is not fully blind: the AI reads for four records (1, 7, 8, and 15) had already appeared in design screenshots, and the labeling guide was written after the AI runs. The analyst also saw fuller public record details that the AI read did not (contracting and funding office, industry and product codes, period of performance, obligated amount, contract vehicle, and competition type, and for the five Federal Register records the document type, topics, CFR parts, docket, and comment dates), while the analyst's list left out the recipient names the AI saw in award titles and two record texts. Treat the match rate as a first look." + (L < SIGNALS.length ? " Unlabeled records are left out of every number in this section." : "") + "</p>";
    // one reveal: the squares fill in left to right when the section comes into view
    const u = $(".units", el);
    $$(".u", u).forEach((c, k) => c.style.setProperty("--i", k % 40));
    if (REDUCED || !("IntersectionObserver" in window)) { u.classList.add("in"); return; }
    const io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) { u.classList.add("in"); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(u);
  }

  // ---------- story preview: one real signal, explained ----------
  function renderPreview() {
    const s = SIGNALS.find((x) => x.tier === 1 && x.ai && x.ai.label === "Low") || SIGNALS[0];
    if (!s || !s.ai || !$("#preview")) return;
    $("#preview").innerHTML =
      '<div class="pv-row">' + glyph(s) + tierBadge(s.tier) + aiChip(s.ai) + '<span class="flag">Check this one</span></div>' +
      '<div class="pv-title">' + esc(s.title) + "</div>" +
      "<dl><dt>Rule</dt><dd>" + esc(s.tier_reason.replace(/^Tier \d, rule [^:]+: /, "")) + ", the strongest evidence type.</dd>" +
      '<dt>AI read</dt><dd class="ai">' + esc(s.ai.runs[0].reason) + "</dd></dl>" +
      '<p class="pv-foot"><button class="linkbtn" type="button" data-open="' + s.n + '">Open the full record</button></p>';
  }

  // ---------- page chrome ----------
  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200); }
  function chrome() {
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
      if (t.id === "show-far") { resetAll(); state.tier = "1"; syncControls(); render(); $$(".row").forEach((r) => hotlight(r.dataset.n, false)); $("#radar").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" }); toast("Showing the Tier 1 signals. Both are flagged for a human look."); return; }
      if (t.matches("[data-unpend]")) { delete pending[t.getAttribute("data-unpend")]; renderPendingChips(); return; }
      if (t.matches("[data-reset]")) { resetAll(); return; }
      if (t.id === "dl-flags") { downloadFlags(); return; }
      if (t.matches(".examples button")) { $("#ask-input").value = t.getAttribute("data-q"); showInterpretation(t.getAttribute("data-q")); return; }
    });
    const feed = $("#feed");
    feed.addEventListener("mouseover", (e) => { const r = e.target.closest(".row"); if (r && !r.contains(e.relatedTarget)) hotlight(r.dataset.n, true); });
    feed.addEventListener("mouseout", (e) => { const r = e.target.closest(".row"); if (r && !r.contains(e.relatedTarget)) hotlight(r.dataset.n, false); });
    feed.addEventListener("focusin", (e) => { const r = e.target.closest(".row"); if (r) hotlight(r.dataset.n, true); });
    feed.addEventListener("focusout", (e) => { const r = e.target.closest(".row"); if (r && !r.contains(e.relatedTarget)) hotlight(r.dataset.n, false); });
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
