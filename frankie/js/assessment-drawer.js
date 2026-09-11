// ── Frankie Self-Assessment Drawer  v1.0 ─────────────────────────────────────
// Loads assessment_data.json, walks user through scored BE or F4N questions
// section by section, then shows a results summary with per-section scores.
//
// Usage:
//   AssessmentDrawer.open('be')   → Business Excellence assessment
//   AssessmentDrawer.open('f4n')  → Fit for Nuclear assessment
//   AssessmentDrawer.close()

(function () {
    'use strict';

    // Updated 2026-08-03: served behind the gated Worker /kb/* route (Azure
    // Blob-backed), not as a static relative path — see ch-proxy-worker.js.
    const WORKER_URL = 'https://ch.rene-dorset.workers.dev';
    const DATA_FILE = `${WORKER_URL}/kb/assessment_data.json`;

    function authHeaders() {
        const token = localStorage.getItem('frankieUserToken');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }

    // ── Supabase persistence (added 2026-09-11) ──────────────────────────────
    // Self-declared answers now persist per (company, assessment_type, section,
    // q) so reopening the drawer restores prior progress instead of starting
    // over, and so SCC's Pre-OSV Pack can compare a self-declared score
    // against the AI's read of the evidence for the same question (see
    // frankie/sql/nr_self_assessment_answers.sql). Same Supabase project/keys
    // as evidence-vault-drawer.js. q is 1-based here to match
    // nr_evidence_analysis's convention (qIdx + 1) — NOT the 0-based question
    // array index answerKey() below uses internally.
    const SUPABASE_URL  = 'https://qkyvmtouwrzrcyagkheo.supabase.co';
    const ANON_KEY       = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreXZtdG91d3J6cmN5YWdraGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODQzNjMsImV4cCI6MjA5MDk2MDM2M30.gKEgkVA-VjOnS_084W79kpzOdZhFQkhFp63MAe_FTd4';
    const ANSWERS_TABLE = 'nr_self_assessment_answers';

    function getUser() {
        return {
            userId: localStorage.getItem('frankieUserId'),
            token:  localStorage.getItem('frankieUserToken'),
        };
    }

    function supaHeaders(token) {
        return { 'Authorization': 'Bearer ' + (token || ANON_KEY), 'apikey': ANON_KEY };
    }

    let companyId = null; // nr_companies.id for the signed-in member, cached per open()

    async function getCompanyId(userId, token) {
        if (companyId) return companyId;
        try {
            const res = await fetch(
                `${SUPABASE_URL}/rest/v1/nr_companies?member_user_id=eq.${userId}&select=id`,
                { headers: supaHeaders(token) }
            );
            if (!res.ok) return null;
            const rows = await res.json();
            companyId = (rows[0] && rows[0].id) || null;
            return companyId;
        } catch (e) { return null; }
    }

    // Restores state.answers from Supabase. Silently leaves things
    // in-memory-only if the member has no linked company yet - same
    // graceful-degrade shape evidence-vault-drawer.js uses.
    async function loadAnswers(type) {
        const { userId, token } = getUser();
        if (!userId || !token) return;
        const cid = await getCompanyId(userId, token);
        if (!cid) return;
        try {
            const res = await fetch(
                `${SUPABASE_URL}/rest/v1/${ANSWERS_TABLE}?company_id=eq.${cid}&assessment_type=eq.${type}&select=section,q,option_idx`,
                { headers: supaHeaders(token) }
            );
            if (!res.ok) return;
            const rows = await res.json();
            const secNames = sections().map(([name]) => name);
            rows.forEach(r => {
                const sIdx = secNames.indexOf(r.section);
                if (sIdx === -1) return; // section renamed/removed since this row was written
                state.answers[answerKey(sIdx, r.q - 1)] = r.option_idx;
            });
        } catch (e) { /* leave state.answers as-is; questions render unanswered */ }
    }

    // Fire-and-forget: never blocks the click that triggered it, never throws
    // out to the caller. A failed save just means the answer stays
    // session-only.
    function saveAnswer(sIdx, qIdx, oIdx) {
        const entry = sections()[sIdx];
        if (!entry) return;
        const [secName, sec] = entry;
        const opt = sec.questions[qIdx] && sec.questions[qIdx].options[oIdx];
        if (!opt) return;

        (async () => {
            const { userId, token } = getUser();
            if (!userId || !token) return;
            const cid = await getCompanyId(userId, token);
            if (!cid) return;
            try {
                await fetch(
                    `${SUPABASE_URL}/rest/v1/${ANSWERS_TABLE}?on_conflict=company_id,assessment_type,section,q`,
                    {
                        method:  'POST',
                        headers: { ...supaHeaders(token), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
                        body:    JSON.stringify({
                            company_id: cid, assessment_type: state.type,
                            section: secName, q: qIdx + 1,
                            option_idx: oIdx, score: opt.score,
                        }),
                    }
                );
            } catch (e) { /* answer stays in local state; not fatal */ }
        })();
    }

    // ── Evidence awareness (added 2026-09-11) ────────────────────────────────
    // BE-only, same reason the "Attach evidence" link is BE-only: Evidence
    // Vault has no f4n data yet. Two independent reads, both keyed the same
    // (section, 1-based q) way as everything else here:
    //   uploads   - which files exist per question (Storage listing, same
    //               source of truth evidence-vault-drawer.js itself uses -
    //               a member reported files uploaded there weren't visible
    //               back here, which was true, this is the fix)
    //   aiScores  - the AI's (or SCC's override of the AI's) suggested score
    //               per question, from nr_evidence_analysis, used to build
    //               the section-level self-declared-vs-AI comparison on the
    //               results screen
    const BUCKET = 'evidence-docs';
    const ANALYSIS_TABLE = 'nr_evidence_analysis';

    function slugify(str) {
        return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    function uploadKey(secName, qNum) {
        return slugify(secName) + '/Q' + qNum;
    }

    let uploads  = {}; // { 'sec-slug/Q1': [{name}] }
    let aiScores = {}; // { 'sec-slug/Q1': score }

    async function loadUploads() {
        uploads = {};
        if (state.type !== 'be') return;
        const { userId, token } = getUser();
        if (!userId || !token) return;
        for (const [secName] of sections()) {
            const slug = slugify(secName);
            try {
                const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
                    method:  'POST',
                    headers: { ...supaHeaders(token), 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ prefix: `${userId}/${slug}/`, limit: 100, offset: 0 }),
                });
                if (!res.ok) continue;
                const items = await res.json();
                (items || []).forEach(f => {
                    if (!f.name || f.name.endsWith('/')) return;
                    const match = f.name.match(/^Q(\d+)__(.+)$/);
                    if (!match) return; // untagged legacy file - same limitation Evidence Vault itself has
                    const key = uploadKey(secName, +match[1]);
                    if (!uploads[key]) uploads[key] = [];
                    uploads[key].push({ name: match[2] });
                });
            } catch (e) { /* leave this section's uploads empty rather than fail the whole load */ }
        }
    }

    async function loadAiScores() {
        aiScores = {};
        if (state.type !== 'be') return;
        const { userId, token } = getUser();
        if (!userId || !token) return;
        const cid = await getCompanyId(userId, token);
        if (!cid) return;
        try {
            const res = await fetch(
                `${SUPABASE_URL}/rest/v1/${ANALYSIS_TABLE}?company_id=eq.${cid}&assessment_type=eq.be&select=section,q,ai_suggested_score,scc_override_score`,
                { headers: supaHeaders(token) }
            );
            if (!res.ok) return;
            const rows = await res.json();
            rows.forEach(r => {
                const score = (r.scc_override_score !== null && r.scc_override_score !== undefined)
                    ? r.scc_override_score : r.ai_suggested_score;
                if (score === null || score === undefined) return;
                const key = uploadKey(r.section, r.q);
                // A question can carry more than one analyzed file - keep the
                // strongest evidence seen for it rather than the last one read.
                if (aiScores[key] === undefined || score > aiScores[key]) aiScores[key] = score;
            });
        } catch (e) { /* leave aiScores as-is */ }
    }

    const TYPE_LABELS = {
        be:  'Business Excellence',
        f4n: 'Fit for Nuclear',
    };
    // Matches the sidebar's icons (index.html data-tool="assessBE"/"assessF4N")
    // so the topbar icon stays consistent with whichever mode is active.
    const TYPE_ICONS = {
        be:  '📊',
        f4n: '⚛️',
    };

    const SCORE_COLOURS = [
        { min: 0,  max: 39,  col: '#e05252', label: 'Needs attention' },
        { min: 40, max: 59,  col: '#e09a3a', label: 'Developing'      },
        { min: 60, max: 79,  col: '#d4c124', label: 'Progressing'     },
        { min: 80, max: 100, col: '#4caf7d', label: 'Strong'          },
    ];

    let DATA      = null;
    let loading   = false;
    let state     = { type: 'be', sectionIdx: 0, answers: {} };
    let onResults = false; // which screen loadUploads()/loadAiScores() should refresh into once they resolve

    function refreshCurrentView() {
        if (onResults) renderResults(); else renderAll();
    }

    // ── DOM injection ──────────────────────────────────────────────────────────
    function injectDrawer() {
        if (document.getElementById('assessment-drawer')) return;
        const el = document.createElement('div');
        el.id        = 'assessment-drawer';
        el.className = 'assess-drawer assess-drawer--closed';
        el.innerHTML = `
          <div class="assess-backdrop" id="assessBackdrop"></div>
          <div class="assess-panel">
            <div class="assess-topbar">
              <span class="assess-icon" id="assessIcon">📊</span>
              <div class="assess-title" id="assessTitle">Self Assessment</div>
              <button class="assess-close" id="assessClose" aria-label="Close">✕</button>
            </div>

            <div class="assess-type-bar" id="assessTypeBar">
              <button class="assess-type-btn" data-type="be"  type="button">Business Excellence</button>
              <button class="assess-type-btn" data-type="f4n" type="button">Fit for Nuclear</button>
            </div>

            <div class="assess-section-bar" id="assessSectionBar"></div>

            <div class="assess-body" id="assessBody">
              <div class="assess-loading">Loading assessment…</div>
            </div>

            <div class="assess-footer" id="assessFooter">
              <button class="assess-nav" id="assessPrev" type="button">← Back</button>
              <span class="assess-footer-score" id="assessFooterScore"></span>
              <button class="assess-nav assess-nav--primary" id="assessNext" type="button">Next →</button>
            </div>
          </div>`;
        document.body.appendChild(el);

        window.DrawerSplashKit && window.DrawerSplashKit.attach(el, {
          key: 'selfAssessment',
          icon: '📊',
          eyebrow: 'Self assessment',
          title: 'Self Assessment',
          description: 'Score yourself against Business Excellence and Fit for Nuclear criteria — the same framework NucCol and F4N assessors use — so you know where you stand before anyone else looks.',
          checklist: ['Business Excellence and Fit for Nuclear, one place', 'Switch between them any time', 'Section-by-section scoring, not just a total'],
        });

        document.getElementById('assessClose').addEventListener('click', close);
        document.getElementById('assessBackdrop').addEventListener('click', close);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

        document.getElementById('assessTypeBar').addEventListener('click', e => {
            const btn = e.target.closest('.assess-type-btn');
            if (!btn || !DATA) return;
            switchType(btn.dataset.type);
        });

        document.getElementById('assessPrev').addEventListener('click', () => navigate(-1));
        document.getElementById('assessNext').addEventListener('click', () => navigate(1));
    }

    // ── Data ───────────────────────────────────────────────────────────────────
    async function loadData() {
        if (DATA) return DATA;
        if (loading) return null;
        loading = true;
        try {
            const res = await fetch(DATA_FILE, { headers: authHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            DATA    = await res.json();
            loading = false;
            return DATA;
        } catch (e) {
            loading = false;
            console.error('[AssessmentDrawer]', e);
            return null;
        }
    }

    // ── State helpers ──────────────────────────────────────────────────────────
    function sections() {
        return DATA ? Object.entries(DATA[state.type] || {}) : [];
    }

    function currentSection() {
        return sections()[state.sectionIdx] || null;
    }

    function answerKey(sIdx, qIdx) { return `${state.type}:${sIdx}:${qIdx}`; }

    function sectionScore(sIdx) {
        const [, sec] = sections()[sIdx] || [];
        if (!sec) return { score: 0, max: 0 };
        let score = 0, max = 0;
        sec.questions.forEach((q, qIdx) => {
            const sel = state.answers[answerKey(sIdx, qIdx)];
            const maxOpt = Math.max(...q.options.map(o => o.score));
            max += maxOpt;
            if (sel !== undefined) score += q.options[sel]?.score || 0;
        });
        return { score, max };
    }

    // AI-evidence read for a section, for the results screen's self-vs-AI
    // comparison (added 2026-09-11 - the "left out" piece from the
    // persistence/cross-link work earlier today). Section-level only, not
    // per-question - only counts questions that actually have an analyzed
    // file; max scales to however many of the section's questions were
    // analyzed, not the full section, so a section with only 2 of 10
    // questions evidenced isn't scored as if the other 8 were zero.
    function aiSectionScore(sIdx) {
        const entry = sections()[sIdx];
        if (!entry) return { score: 0, max: 0, count: 0 };
        const [secName, sec] = entry;
        let score = 0, count = 0;
        sec.questions.forEach((q, qIdx) => {
            const s = aiScores[uploadKey(secName, qIdx + 1)];
            if (s !== undefined) { score += s; count++; }
        });
        return { score, count, max: count * 10 }; // 10 = top band across every BE rubric
    }

    function totalScore() {
        let score = 0, max = 0;
        sections().forEach((_, i) => {
            const s = sectionScore(i);
            score += s.score; max += s.max;
        });
        return { score, max };
    }

    function pct(score, max) {
        return max ? Math.round(score / max * 100) : 0;
    }

    function scoreColour(p) {
        return (SCORE_COLOURS.find(c => p >= c.min && p <= c.max) || SCORE_COLOURS[3]).col;
    }

    function scoreLabel(p) {
        return (SCORE_COLOURS.find(c => p >= c.min && p <= c.max) || SCORE_COLOURS[3]).label;
    }

    // ── Switch type ────────────────────────────────────────────────────────────
    function switchType(type) {
        state = { type, sectionIdx: 0, answers: {} };
        renderAll();
        loadAnswers(type).then(refreshCurrentView);
        loadUploads().then(refreshCurrentView);
        loadAiScores().then(refreshCurrentView);
    }

    function navigate(dir) {
        const secs = sections();
        const next = state.sectionIdx + dir;
        if (next >= secs.length) {
            renderResults();
            return;
        }
        if (next < 0) return;
        state.sectionIdx = next;
        renderSection();
    }

    // ── Render ─────────────────────────────────────────────────────────────────
    function renderAll() {
        onResults = false;
        updateTypeBar();
        renderSectionBar();
        renderSection();
    }

    function updateTypeBar() {
        document.querySelectorAll('.assess-type-btn').forEach(b => {
            b.classList.toggle('assess-type-btn--active', b.dataset.type === state.type);
        });
    }

    function renderSectionBar() {
        const bar = document.getElementById('assessSectionBar');
        if (!bar) return;
        bar.innerHTML = sections().map(([name], i) => {
            const { score, max } = sectionScore(i);
            const p = pct(score, max);
            const active = i === state.sectionIdx;
            return `<button class="assess-sec-pill${active ? ' assess-sec-pill--active' : ''}"
                      data-idx="${i}" type="button" title="${esc(name)}">
                      <span>${esc(shortName(name))}</span>
                      ${max ? `<span class="assess-sec-pct" style="color:${scoreColour(p)}">${p}%</span>` : ''}
                    </button>`;
        }).join('');
        bar.querySelectorAll('.assess-sec-pill').forEach(b => {
            b.addEventListener('click', () => {
                state.sectionIdx = parseInt(b.dataset.idx);
                renderSectionBar();
                renderSection();
            });
        });
    }

    function shortName(name) {
        // Abbreviate long section names for the pill bar
        const map = {
            'Strategy & Leadership': 'Strategy',
            'Design & Project Management': 'Design',
            'People Excellence': 'People',
            'Process Excellence': 'Process',
            'Supply Chain and Social Values': 'Supply Chain',
            'Nuclear Industry Fundamentals': 'Fundamentals',
            'Nuclear Safety Culture': 'Safety Culture',
            'Quality and Compliance': 'Quality',
            'Leadership and Governance': 'Leadership',
            'Human Performance': 'Human Perf.',
            'Supply Chain Readiness': 'Supply Chain',
            'Security of Information': 'Security',
        };
        return map[name] || name.split(' ').slice(0,2).join(' ');
    }

    function renderSection() {
        const body = document.getElementById('assessBody');
        const title = document.getElementById('assessTitle');
        const footer = document.getElementById('assessFooter');
        if (!body) return;

        const entry = currentSection();
        if (!entry) return;
        const [sectionName, sec] = entry;
        const secs = sections();

        title.textContent = `${TYPE_LABELS[state.type]} — ${sectionName}`;
        const iconEl = document.getElementById('assessIcon');
        if (iconEl) iconEl.textContent = TYPE_ICONS[state.type] || '📊';
        footer.style.display = 'flex';

        const prev = document.getElementById('assessPrev');
        const next = document.getElementById('assessNext');
        prev.style.visibility = state.sectionIdx === 0 ? 'hidden' : 'visible';
        const isLast = state.sectionIdx === secs.length - 1;
        next.textContent = isLast ? 'See results →' : 'Next →';

        let html = `<div class="assess-section-intro">
            <h3 class="assess-section-name">${esc(sectionName)}</h3>
            <p class="assess-section-count">${sec.questions.length} questions · select the option that best describes your organisation</p>
          </div>`;

        sec.questions.forEach((q, qIdx) => {
            const key = answerKey(state.sectionIdx, qIdx);
            const selected = state.answers[key];
            html += `<div class="assess-question" data-qidx="${qIdx}">
              <div class="assess-q-text">${esc(q.statement)}</div>
              ${q.topic ? `<div class="assess-q-topic">${esc(q.topic)}</div>` : ''}
              <div class="assess-options">`;

            q.options.forEach((opt, oIdx) => {
                const isSelected = selected === oIdx;
                html += `<button class="assess-option${isSelected ? ' assess-option--selected' : ''}"
                           data-qidx="${qIdx}" data-oidx="${oIdx}" type="button">
                           <span class="assess-opt-score">${opt.score}</span>
                           <span class="assess-opt-desc">${esc(opt.desc)}</span>
                         </button>`;
            });

            html += `</div>`;

            // 2026-09-11: per-answer feedback text and the handbook link
            // both removed (Rene) - the feedback text just restated the
            // selected option's own desc back at the user, and the handbook
            // link went too along with it.

            // Uploaded evidence (added 2026-09-11) - a member reported files
            // uploaded in Evidence Vault weren't visible from here, which was
            // true (this screen had no awareness of uploads at all). Same
            // source of truth Evidence Vault itself reads (Storage listing),
            // fetched by loadUploads() - see its comment above.
            const files = state.type === 'be' ? (uploads[uploadKey(sectionName, qIdx + 1)] || []) : [];
            if (files.length) {
                html += `<div class="assess-evidence-files">📎 ${files.map(f => esc(f.name)).join(', ')}</div>`;
            }

            // Cross-link into Evidence Vault at this exact question - the two
            // tools share the same (section, q) keying (see
            // frankie/sql/nr_evidence_analysis.sql). BE-only for now: Evidence
            // Vault's data (be_evidence_map.json) has no f4n counterpart yet.
            if (state.type === 'be') {
                html += `<button class="assess-evidence-link" data-qidx="${qIdx}" type="button">${files.length ? '📎 Manage evidence →' : '📎 Attach evidence for this answer →'}</button>`;
            }

            html += `</div>`; // close assess-question
        });

        body.innerHTML = html;
        updateFooterScore();

        // Option click handler
        body.querySelectorAll('.assess-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const qIdx = parseInt(btn.dataset.qidx);
                const oIdx = parseInt(btn.dataset.oidx);
                const key  = answerKey(state.sectionIdx, qIdx);
                state.answers[key] = oIdx;
                saveAnswer(state.sectionIdx, qIdx, oIdx);
                renderSection();
                renderSectionBar();
            });
        });

        // Evidence Vault cross-link. Passes a returnTarget so that closing
        // Evidence Vault (its own X/backdrop/Escape - not drawer-manager.js
        // force-closing it because some other tool got opened instead) comes
        // straight back to this same section, rather than dropping the
        // member back at the main chat with no way back in.
        body.querySelectorAll('.assess-evidence-link').forEach(btn => {
            btn.addEventListener('click', () => {
                const qIdx = parseInt(btn.dataset.qidx);
                if (window.EvidenceVault) {
                    window.EvidenceVault.open(sectionName, qIdx + 1, {
                        returnTo: 'assessment', type: state.type, sectionIdx: state.sectionIdx,
                    });
                }
            });
        });
    }

    function updateFooterScore() {
        const el = document.getElementById('assessFooterScore');
        if (!el) return;
        const { score, max } = sectionScore(state.sectionIdx);
        const answered = sections()[state.sectionIdx]?.[1].questions.filter((_, i) =>
            state.answers[answerKey(state.sectionIdx, i)] !== undefined
        ).length || 0;
        const total = sections()[state.sectionIdx]?.[1].questions.length || 0;
        const p = pct(score, max);
        el.innerHTML = max
            ? `<span style="color:${scoreColour(p)}">${score}/${max}</span> &nbsp;·&nbsp; ${answered}/${total} answered`
            : `${answered}/${total} answered`;
    }

    // ── Results ────────────────────────────────────────────────────────────────
    function renderResults() {
        onResults = true;
        const body  = document.getElementById('assessBody');
        const title = document.getElementById('assessTitle');
        const footer = document.getElementById('assessFooter');
        if (!body) return;

        title.textContent = `${TYPE_LABELS[state.type]} — Results`;
        const iconEl = document.getElementById('assessIcon');
        if (iconEl) iconEl.textContent = TYPE_ICONS[state.type] || '📊';
        footer.style.display = 'none';

        const { score, max } = totalScore();
        const p = pct(score, max);
        const col = scoreColour(p);
        const lbl = scoreLabel(p);

        // Section breakdown, plus the AI's evidence-based read per section
        // where any evidence has been analyzed (BE only - see
        // aiSectionScore()). This is the self-declared-vs-AI comparison
        // flagged as not built when the underlying persistence/cross-link
        // work landed earlier today - section-level, not per-question, per
        // Rene: "it doesn't need every question, just the sections."
        // rows keeps the assessment's own canonical section order (used by
        // the score guide below); sectionRows is a worst-first sorted copy
        // for the breakdown/priority lists - .sort() mutates in place, so
        // it has to run on a copy, not rows itself.
        const rows = sections().map(([name], i) => {
            const s = sectionScore(i);
            const sp = pct(s.score, s.max);
            const sc = scoreColour(sp);
            const ai = state.type === 'be' ? aiSectionScore(i) : { count: 0 };
            const aiPct = ai.count ? pct(ai.score, ai.max) : null;
            return { name, ...s, pct: sp, col: sc, aiPct, aiCount: ai.count, idx: i };
        });
        const sectionRows = [...rows].sort((a,b) => a.pct - b.pct);

        let html = `
          <div class="assess-results">
            <div class="assess-results-hero">
              <div class="assess-results-ring" style="--col:${col}">
                <span class="assess-ring-pct">${p}%</span>
                <span class="assess-ring-lbl">${lbl}</span>
              </div>
              <div class="assess-results-summary">
                <div class="assess-results-total">${score} / ${max}</div>
                <div class="assess-results-sub">Overall score · ${TYPE_LABELS[state.type]}</div>
              </div>
            </div>

            <button class="assess-guide-link" id="assessGuideLink" type="button">📋 View F4N Portal Score Guide →</button>

            <h4 class="assess-results-section-hd">Section breakdown</h4>
            <p class="assess-results-section-note">Click a section to jump back in and edit it. "AI" is the evidence read from Evidence Vault, where any has been reviewed.</p>
            ${sectionRows.map(r => `
              <button class="assess-results-row" data-idx="${r.idx}" type="button">
                <div class="assess-results-row-name">${esc(r.name)}</div>
                <div class="assess-results-bar-wrap">
                  <div class="assess-results-bar" style="width:${r.pct}%;background:${r.col}"></div>
                </div>
                <div class="assess-results-row-score" style="color:${r.col}">${r.pct}%</div>
                <div class="assess-results-ai-score" style="${r.aiPct !== null ? `color:${scoreColour(r.aiPct)}` : ''}">${r.aiPct !== null ? `AI ${r.aiPct}%` : '—'}</div>
              </button>`).join('')}

            <h4 class="assess-results-section-hd">Priority improvements</h4>
            ${sectionRows.slice(0,3).map(r => `
              <div class="assess-priority-card" style="border-left-color:${r.col}">
                <div class="assess-priority-name">${esc(r.name)}</div>
                <div class="assess-priority-score">${r.score}/${r.max} (${r.pct}%) — ${scoreLabel(r.pct)}</div>
              </div>`).join('')}

            <button class="assess-restart-btn" id="assessRestart" type="button">Start again</button>
          </div>`;

        body.innerHTML = html;

        body.querySelectorAll('.assess-results-row').forEach(btn => {
            btn.addEventListener('click', () => {
                state.sectionIdx = parseInt(btn.dataset.idx);
                renderSectionBar();
                renderSection();
            });
        });

        document.getElementById('assessGuideLink').addEventListener('click', () => {
            renderScoreGuide(rows, { score, max, p });
        });

        document.getElementById('assessRestart').addEventListener('click', () => {
            state = { type: state.type, sectionIdx: 0, answers: {} };
            renderAll();
            document.getElementById('assessFooter').style.display = 'flex';
        });
    }

    // Portal Score Guide (added 2026-09-11) - what Rene actually asked for
    // under "the summary": a plain list, in the assessment's own natural
    // section order (not the worst-first order the breakdown above uses),
    // of the self-declared score to type into the real F4N portal - that
    // portal has no API Frankie can push to, so this is a read-it-off-and-
    // type-it-in sheet, not a submission. AI evidence read shown alongside
    // each row as a secondary reference only, since it's not itself what
    // goes on the portal.
    function renderScoreGuide(rows, totals) {
        const body = document.getElementById('assessBody');
        const title = document.getElementById('assessTitle');
        if (!body) return;

        title.textContent = `${TYPE_LABELS[state.type]} — Portal Score Guide`;

        const html = `
          <div class="assess-guide">
            <button class="assess-guide-back" id="assessGuideBack" type="button">← Back to results</button>
            <p class="assess-guide-note">Enter these section scores into the F4N portal's own self-assessment. Listed in the same order as this assessment - not sorted worst-first like the Results breakdown.</p>
            <div class="assess-guide-rows">
              ${rows.map(r => `
                <div class="assess-guide-row">
                  <div class="assess-guide-row-name">${esc(r.name)}</div>
                  <div class="assess-guide-row-score">${r.score}/${r.max} <span class="assess-guide-row-pct">(${r.pct}%)</span></div>
                  <div class="assess-guide-row-ai">${r.aiPct !== null ? `AI read: ${r.aiPct}%` : ''}</div>
                </div>`).join('')}
            </div>
            <div class="assess-guide-total">Overall: ${totals.score}/${totals.max} (${totals.p}%)</div>
          </div>`;

        body.innerHTML = html;
        document.getElementById('assessGuideBack').addEventListener('click', renderResults);
    }

    // ── Utils ──────────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    // startSectionIdx (added 2026-09-11) lets Evidence Vault hand the member
    // back to exactly the section they came from when they close it after
    // attaching evidence via the cross-link below - see EvidenceVault's own
    // returnTarget handling in evidence-vault-drawer.js.
    async function open(type, startSectionIdx) {
        injectDrawer();

        const drawer = document.getElementById('assessment-drawer');
        const body   = document.getElementById('assessBody');

        drawer.classList.remove('assess-drawer--closed');
        drawer.classList.add('assess-drawer--open');
        body.innerHTML = '<div class="assess-loading">Loading questions…</div>';
        document.getElementById('assessFooter').style.display = 'none';

        const data = await loadData();
        if (!data) {
            body.innerHTML = '<div class="assess-loading">⚠ Could not load assessment data.</div>';
            return;
        }

        state = { type: type || 'be', sectionIdx: startSectionIdx || 0, answers: {} };
        companyId = null; // rebuild fresh each open, same reasoning as evidence-vault-drawer.js
        renderAll();
        document.getElementById('assessFooter').style.display = 'flex';
        loadAnswers(state.type).then(refreshCurrentView);
        loadUploads().then(refreshCurrentView);
        loadAiScores().then(refreshCurrentView);
    }

    function close() {
        const drawer = document.getElementById('assessment-drawer');
        if (drawer) {
            drawer.classList.remove('assess-drawer--open');
            drawer.classList.add('assess-drawer--closed');
        }
    }

    window.AssessmentDrawer = { open, close };

}());
