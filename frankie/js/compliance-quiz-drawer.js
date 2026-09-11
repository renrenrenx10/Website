// ── Compliance Training Quiz Drawer (Feature E) ──────────────────────────────
// Scenario-based multiple-choice quizzes, scored, with completions logged for
// the SCC training register (frankie/sql/nr_quiz_completions.sql). Generic
// across topics - content lives in data/compliance_quiz_data.json, keyed by
// topic id, same "one engine, data-driven" shape as assessment-drawer.js.
//
// First topic built: cyber_essentials (2026-09-11), sourced directly from
// NCSC's own "Cyber Essentials: Requirements for IT Infrastructure v3.3"
// (Crown Copyright) rather than any third-party question bank.
//
// Usage: window.ComplianceQuizDrawer.open('cyber_essentials')

(function () {
    'use strict';

    const DATA_FILE = 'data/compliance_quiz_data.json'; // same-origin static file, no auth needed - not member-sensitive content
    const SUPABASE_URL = 'https://qkyvmtouwrzrcyagkheo.supabase.co';
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreXZtdG91d3J6cmN5YWdraGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODQzNjMsImV4cCI6MjA5MDk2MDM2M30.gKEgkVA-VjOnS_084W79kpzOdZhFQkhFp63MAe_FTd4';
    const COMPLETIONS_TABLE = 'nr_quiz_completions';

    function getUser() {
        return {
            userId: localStorage.getItem('frankieUserId'),
            token:  localStorage.getItem('frankieUserToken'),
        };
    }
    function supaHeaders(token) {
        return { 'Authorization': 'Bearer ' + (token || ANON_KEY), 'apikey': ANON_KEY };
    }

    let companyId = null;
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

    // Fire-and-forget, same resilience shape as assessment-drawer.js's
    // saveAnswer() - a failed log never blocks the results screen from
    // showing the member their own score.
    function logCompletion(topic, score, total, passMarkPct, passed) {
        (async () => {
            const { userId, token } = getUser();
            if (!userId || !token) return;
            const cid = await getCompanyId(userId, token);
            if (!cid) return;
            try {
                await fetch(`${SUPABASE_URL}/rest/v1/${COMPLETIONS_TABLE}`, {
                    method: 'POST',
                    headers: { ...supaHeaders(token), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        company_id: cid, quiz_topic: topic,
                        score, total, pass_mark_pct: passMarkPct, passed,
                    }),
                });
            } catch (e) { /* completion stays visible in this session only; not fatal */ }
        })();
    }

    let DATA = null;
    let state = { topic: 'cyber_essentials', qIdx: 0, selected: null, locked: false, answers: [], selectedAnswers: [], logged: false, priorScreen: 'question' };

    function injectDrawer() {
        if (document.getElementById('quiz-drawer')) return;
        const el = document.createElement('div');
        el.id = 'quiz-drawer';
        el.className = 'assess-drawer assess-drawer--closed';
        el.innerHTML = `
          <div class="assess-backdrop" id="quizBackdrop"></div>
          <div class="assess-panel">
            <div class="assess-topbar">
              <span class="assess-icon" id="quizIcon">🛡️</span>
              <div class="assess-title" id="quizTitle">Compliance Training</div>
              <button class="quiz-learn-btn" id="quizLearnBtn" type="button" hidden>📖 Learn</button>
              <button class="assess-close" id="quizClose" aria-label="Close">✕</button>
            </div>

            <div class="assess-body" id="quizBody">
              <div class="assess-loading">Loading quiz…</div>
            </div>

            <div class="assess-footer" id="quizFooter" style="display:none">
              <span class="assess-footer-score" id="quizFooterScore"></span>
              <button class="assess-nav assess-nav--primary" id="quizNext" type="button">Next →</button>
            </div>
          </div>`;
        document.body.appendChild(el);

        window.DrawerSplashKit && window.DrawerSplashKit.attach(el, {
            key: 'complianceQuiz',
            icon: '🛡️',
            eyebrow: 'Compliance training',
            title: 'Compliance Training Quiz',
            description: 'Scenario-based questions on the compliance topics F4N suppliers actually get asked about — sourced from the real regulatory guidance, not generic filler.',
            checklist: ['Real scenarios, not textbook definitions', 'Immediate feedback with the actual requirement quoted', 'Completions logged for your SCC'],
        });

        document.getElementById('quizClose').addEventListener('click', close);
        document.getElementById('quizBackdrop').addEventListener('click', close);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
        document.getElementById('quizNext').addEventListener('click', next);
        document.getElementById('quizLearnBtn').addEventListener('click', openLearn);
    }

    async function loadData() {
        if (DATA) return DATA;
        try {
            const res = await fetch(DATA_FILE);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            DATA = await res.json();
            return DATA;
        } catch (e) {
            console.error('[ComplianceQuizDrawer]', e);
            return null;
        }
    }

    function topicData() {
        return DATA && DATA[state.topic];
    }
    function currentQuestion() {
        const t = topicData();
        return t ? t.questions[state.qIdx] : null;
    }

    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderQuestion() {
        const body = document.getElementById('quizBody');
        const title = document.getElementById('quizTitle');
        const footer = document.getElementById('quizFooter');
        const t = topicData();
        const q = currentQuestion();
        if (!body || !t || !q) return;

        state.priorScreen = 'question'; // so the Learn view's back button knows where to return to

        title.textContent = `${t.icon} ${t.title} — Question ${state.qIdx + 1} of ${t.questions.length}`;
        footer.style.display = 'none';

        let html = `
          <div class="quiz-progress">Question ${state.qIdx + 1} of ${t.questions.length} · ${q.control}</div>
          <div class="quiz-scenario">${esc(q.scenario)}</div>
          <div class="quiz-question">${esc(q.question)}</div>
          <div class="quiz-options">`;

        q.options.forEach((opt, i) => {
            let cls = 'quiz-option';
            if (state.locked) {
                if (i === q.correctIndex) cls += ' quiz-option--correct';
                else if (i === state.selected) cls += ' quiz-option--wrong';
            }
            html += `<button class="${cls}" data-idx="${i}" type="button" ${state.locked ? 'disabled' : ''}>${esc(opt)}</button>`;
        });
        html += `</div>`;

        if (state.locked) {
            const correct = state.selected === q.correctIndex;
            html += `<div class="quiz-explanation ${correct ? 'quiz-explanation--correct' : 'quiz-explanation--wrong'}">
                        <strong>${correct ? '✓ Correct.' : '✗ Not quite.'}</strong> ${esc(q.explanation)}
                        ${q.reference ? `<div class="quiz-reference">📖 ${esc(q.reference)}</div>` : ''}
                      </div>`;
            // The rule on its own is "what" - this is "why", added 2026-09-11
            // per Rene: parroting the requirement is only half the job for
            // something meant to educate, not just gate a pass/fail. Kept as
            // its own visually distinct block (not folded into the
            // explanation above) so it reads as a second, different kind of
            // information, not more of the same paragraph.
            if (q.why) {
                html += `<div class="quiz-why">
                            <div class="quiz-why-label">💡 Why this matters</div>
                            <div class="quiz-why-body">${esc(q.why)}</div>
                          </div>`;
            }
        }

        body.innerHTML = html;

        body.querySelectorAll('.quiz-option').forEach(btn => {
            btn.addEventListener('click', () => selectOption(parseInt(btn.dataset.idx)));
        });

        if (state.locked) {
            footer.style.display = 'flex';
            const isLast = state.qIdx === t.questions.length - 1;
            document.getElementById('quizNext').textContent = isLast ? 'See results →' : 'Next question →';
            document.getElementById('quizFooterScore').textContent =
                `Score so far: ${state.answers.filter(Boolean).length}/${state.answers.length}`;
        }
    }

    function selectOption(idx) {
        if (state.locked) return;
        state.selected = idx;
        state.locked = true;
        const q = currentQuestion();
        state.answers[state.qIdx] = (idx === q.correctIndex);
        state.selectedAnswers[state.qIdx] = idx; // kept per-question, not just the current one, for the results recap
        renderQuestion();
    }

    function next() {
        const t = topicData();
        if (state.qIdx < t.questions.length - 1) {
            state.qIdx += 1;
            state.selected = null;
            state.locked = false;
            renderQuestion();
        } else {
            renderResults();
        }
    }

    function renderResults() {
        const body = document.getElementById('quizBody');
        const title = document.getElementById('quizTitle');
        const footer = document.getElementById('quizFooter');
        const t = topicData();
        if (!body || !t) return;

        state.priorScreen = 'results';
        footer.style.display = 'none';
        const score = state.answers.filter(Boolean).length;
        const total = t.questions.length;
        const pct = Math.round(score / total * 100);
        const passed = pct >= t.passMark;

        title.textContent = `${t.icon} ${t.title} — Results`;

        if (!state.logged) {
            state.logged = true;
            logCompletion(state.topic, score, total, t.passMark, passed);
        }

        // Full per-question recap, same red/green treatment as the options
        // themselves during the quiz - this is the "education, not just a
        // pass/fail gate" piece: a member can see exactly what they got
        // wrong, why, and where in the source requirements it comes from,
        // not just walk away with a percentage.
        const summaryRows = t.questions.map((q, i) => {
            const correct = !!state.answers[i];
            const yourIdx = state.selectedAnswers[i];
            return `
              <div class="quiz-summary-row ${correct ? 'quiz-summary-row--correct' : 'quiz-summary-row--wrong'}">
                <div class="quiz-summary-head">
                  <span class="quiz-summary-icon">${correct ? '✓' : '✗'}</span>
                  <span class="quiz-summary-control">${esc(q.control)}</span>
                </div>
                <div class="quiz-summary-question">${esc(q.question)}</div>
                ${!correct ? `<div class="quiz-summary-answer quiz-summary-answer--wrong">Your answer: ${esc(q.options[yourIdx])}</div>` : ''}
                <div class="quiz-summary-answer quiz-summary-answer--correct">Correct answer: ${esc(q.options[q.correctIndex])}</div>
                <div class="quiz-summary-explanation">${esc(q.explanation)}</div>
                ${q.why ? `<div class="quiz-summary-why"><strong>💡 Why this matters:</strong> ${esc(q.why)}</div>` : ''}
                ${q.reference ? `<div class="quiz-summary-reference">📖 ${esc(q.reference)}</div>` : ''}
              </div>`;
        }).join('');

        body.innerHTML = `
          <div class="quiz-results">
            <div class="quiz-results-hero ${passed ? 'quiz-results-hero--pass' : 'quiz-results-hero--fail'}">
              <div class="quiz-results-pct">${pct}%</div>
              <div class="quiz-results-label">${passed ? 'Passed' : 'Not yet'}</div>
              <div class="quiz-results-sub">${score} of ${total} correct · pass mark ${t.passMark}%</div>
            </div>

            <h4 class="quiz-summary-hd">Question-by-question summary</h4>
            <div class="quiz-summary-rows">${summaryRows}</div>

            <button class="quiz-retake-btn" id="quizRetake" type="button">↻ Retake quiz</button>
          </div>`;

        document.getElementById('quizRetake').addEventListener('click', () => {
            state = { topic: state.topic, qIdx: 0, selected: null, locked: false, answers: [], selectedAnswers: [], logged: false, priorScreen: 'question' };
            renderQuestion();
        });
    }

    async function open(topic) {
        injectDrawer();
        const drawer = document.getElementById('quiz-drawer');
        drawer.classList.remove('assess-drawer--closed');
        drawer.classList.add('assess-drawer--open');

        const body = document.getElementById('quizBody');
        body.innerHTML = '<div class="assess-loading">Loading quiz…</div>';
        document.getElementById('quizFooter').style.display = 'none';

        const data = await loadData();
        if (!data) {
            body.innerHTML = '<div class="assess-loading">⚠ Could not load quiz content.</div>';
            return;
        }

        companyId = null; // rebuild fresh each open, same reasoning as the other drawers
        state = { topic: topic || 'cyber_essentials', qIdx: 0, selected: null, locked: false, answers: [], selectedAnswers: [], logged: false, priorScreen: 'question' };

        // Learn button only shows for topics that actually have reference
        // content - added 2026-09-11 (Cyber Essentials first; other topics
        // get theirs added the same way, same feature, no drawer changes
        // needed). Hidden rather than left visible-but-broken for topics
        // without a "learn" array yet.
        const t = topicData();
        document.getElementById('quizLearnBtn').hidden = !(t && t.learn && t.learn.length);

        renderQuestion();
    }

    // "Learn about" (added 2026-09-11, per Rene): a companion reference view
    // built from the same sourced material as the quiz questions, reached
    // from the topbar at any point - not just before starting. Returns to
    // whichever screen (question or results) was showing when opened,
    // tracked via state.priorScreen so a member reading up mid-quiz lands
    // back on the exact question they were on, not question 1.
    function openLearn() {
        const body = document.getElementById('quizBody');
        const title = document.getElementById('quizTitle');
        const footer = document.getElementById('quizFooter');
        const t = topicData();
        if (!body || !t || !t.learn) return;

        footer.style.display = 'none';
        title.textContent = `${t.icon} ${t.title} — Learn`;

        const sections = t.learn.map(sec => `
          <div class="quiz-learn-section">
            <h4 class="quiz-learn-heading">${esc(sec.heading)}</h4>
            ${sec.body.split('\n\n').map(p => `<p class="quiz-learn-para">${esc(p)}</p>`).join('')}
          </div>`).join('');

        body.innerHTML = `
          <div class="quiz-learn">
            <button class="quiz-learn-back" id="quizLearnBack" type="button">← Back to quiz</button>
            <p class="quiz-learn-intro">${esc(t.intro)}</p>
            ${sections}
          </div>`;

        document.getElementById('quizLearnBack').addEventListener('click', () => {
            if (state.priorScreen === 'results') renderResults();
            else renderQuestion();
        });
    }

    function close() {
        const drawer = document.getElementById('quiz-drawer');
        if (drawer) { drawer.classList.remove('assess-drawer--open'); drawer.classList.add('assess-drawer--closed'); }
    }

    window.ComplianceQuizDrawer = { open, close };

}());
