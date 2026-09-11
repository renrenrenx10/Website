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
        loadAnswers(type).then(renderAll);
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

            // Cross-link into Evidence Vault at this exact question - the two
            // tools share the same (section, q) keying (see
            // frankie/sql/nr_evidence_analysis.sql). BE-only for now: Evidence
            // Vault's data (be_evidence_map.json) has no f4n counterpart yet.
            if (state.type === 'be') {
                html += `<button class="assess-evidence-link" data-qidx="${qIdx}" type="button">📎 Attach evidence for this answer →</button>`;
            }

            // Show feedback for selected option
            if (selected !== undefined) {
                const opt = q.options[selected];
                const maxScore = Math.max(...q.options.map(o => o.score));
                const p = pct(opt.score, maxScore);
                html += `<div class="assess-feedback" style="border-left-color:${scoreColour(p)}">
                           ${opt.feedback ? esc(opt.feedback) : ''}
                           ${q.handbookUrl ? `<a class="assess-hb-link" href="${esc(q.handbookUrl)}" target="_blank" rel="noopener">📖 View in handbook →</a>` : ''}
                         </div>`;
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

        // Evidence Vault cross-link
        body.querySelectorAll('.assess-evidence-link').forEach(btn => {
            btn.addEventListener('click', () => {
                const qIdx = parseInt(btn.dataset.qidx);
                if (window.EvidenceVault) window.EvidenceVault.open(sectionName, qIdx + 1);
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

        // Section breakdown
        const sectionRows = sections().map(([name], i) => {
            const s = sectionScore(i);
            const sp = pct(s.score, s.max);
            const sc = scoreColour(sp);
            return { name, ...s, pct: sp, col: sc };
        }).sort((a,b) => a.pct - b.pct);

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

            <h4 class="assess-results-section-hd">Section breakdown</h4>
            ${sectionRows.map(r => `
              <div class="assess-results-row">
                <div class="assess-results-row-name">${esc(r.name)}</div>
                <div class="assess-results-bar-wrap">
                  <div class="assess-results-bar" style="width:${r.pct}%;background:${r.col}"></div>
                </div>
                <div class="assess-results-row-score" style="color:${r.col}">${r.pct}%</div>
              </div>`).join('')}

            <h4 class="assess-results-section-hd">Priority improvements</h4>
            ${sectionRows.slice(0,3).map(r => `
              <div class="assess-priority-card" style="border-left-color:${r.col}">
                <div class="assess-priority-name">${esc(r.name)}</div>
                <div class="assess-priority-score">${r.score}/${r.max} (${r.pct}%) — ${scoreLabel(r.pct)}</div>
              </div>`).join('')}

            <button class="assess-restart-btn" id="assessRestart" type="button">Start again</button>
          </div>`;

        body.innerHTML = html;

        document.getElementById('assessRestart').addEventListener('click', () => {
            state = { type: state.type, sectionIdx: 0, answers: {} };
            renderAll();
            document.getElementById('assessFooter').style.display = 'flex';
        });
    }

    // ── Utils ──────────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    async function open(type) {
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

        state = { type: type || 'be', sectionIdx: 0, answers: {} };
        companyId = null; // rebuild fresh each open, same reasoning as evidence-vault-drawer.js
        renderAll();
        document.getElementById('assessFooter').style.display = 'flex';
        loadAnswers(state.type).then(renderAll);
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
