// ── Evidence Vault Drawer ────────────────────────────────────────────────────
// Lets companies upload evidence documents against each BE question.
// Files go to Supabase Storage: evidence-docs/{userId}/{section-slug}/filename
// Triggered via: window.EvidenceVault.open()
// Optional jump target (added 2026-09-11, used by assessment-drawer.js's
// "Attach evidence for this answer" link): window.EvidenceVault.open(secName, qNum)
// opens straight to that section, scrolled to and briefly highlighting that
// question's card.

(function () {
  'use strict';

  const SUPABASE_URL  = 'https://qkyvmtouwrzrcyagkheo.supabase.co';
  const ANON_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreXZtdG91d3J6cmN5YWdraGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODQzNjMsImV4cCI6MjA5MDk2MDM2M30.gKEgkVA-VjOnS_084W79kpzOdZhFQkhFp63MAe_FTd4';
  const BUCKET        = 'evidence-docs';
  // Updated 2026-08-03: served behind the gated Worker /kb/* route (Azure
  // Blob-backed), not as a static relative path — see ch-proxy-worker.js.
  const KB_WORKER_URL = 'https://ch.rene-dorset.workers.dev';
  const DATA_FILE     = `${KB_WORKER_URL}/kb/be_evidence_map.json`;
  // Added 2026-09-10: shared AI-analysis engine (Features B/F/C — see
  // frankie_blueprint_v13.docx §10). Same rubric source assessment-drawer.js
  // uses, so a suggested score lines up with the self-assessment's own bands.
  const ASSESSMENT_DATA_FILE = `${KB_WORKER_URL}/kb/assessment_data.json`;
  const ANALYSIS_TABLE = 'nr_evidence_analysis';
  const CLAUDE_MODEL   = 'claude-sonnet-4-6';
  // Claude reads PDFs natively as a "document" block and images as an "image"
  // block. Word/Excel/PowerPoint uploads (still accepted for storage) have no
  // equivalent - there's no extraction step anywhere in this codebase for
  // them - so AI review is limited to these two types for now; anything else
  // stays a manual-SCC-review file.
  const ANALYSIS_MEDIA_TYPES = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  };

  function kbAuthHeaders() {
    const token = localStorage.getItem('frankieUserToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  let DATA        = null;
  let assessmentData = null; // assessment_data.json's 'be' key, lazy-loaded (scoring rubric)
  let companyId   = null;    // nr_companies.id for the signed-in member, fetched once per open()
  let sectionIdx  = 0;
  let uploads     = {};   // { 'sec-slug/Q1': [{name, path}] }
  let sectionExtras = {}; // { 'sec-slug': [{name, path}] } - existing files whose
                          // question can't be determined (uploaded before this
                          // file started tagging the question number in the
                          // storage filename) - shown at section level instead
  let analysis    = {};   // { 'sec-slug/Q1': nr_evidence_analysis row } - AI read of that question's evidence
  let analyzing   = {};   // { 'sec-slug/Q1': true } - while a review call is in flight
  let analysisErrors = {}; // { 'sec-slug/Q1': message } - transient, cleared on next attempt; never overwrites a real analysis[key]
  let loadingUploads = false;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getUser() {
    return {
      userId:  localStorage.getItem('frankieUserId'),
      token:   localStorage.getItem('frankieUserToken'),
      company: localStorage.getItem('frankieCompanyName') || 'Your Company',
    };
  }

  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function uploadKey(secName, qNum) {
    return slugify(secName) + '/Q' + qNum;
  }

  function authHeaders(token) {
    return {
      'Authorization': 'Bearer ' + (token || ANON_KEY),
      'apikey': ANON_KEY,
    };
  }

  // ── Supabase Storage ─────────────────────────────────────────────────────

  async function uploadFile(file, secName, qNum) {
    const { userId, token, company } = getUser();
    if (!userId || !token) throw new Error('Not authenticated');

    const safe = file.name.replace(/[^a-zA-Z0-9._\-() ]/g, '_');
    // Tag the question number into the storage filename (Q{n}__{name}) so a
    // later reopen can restore exactly which question this file belongs to
    // - the storage path itself has no other field for that. Files uploaded
    // before this tagging existed have no prefix and fall back to a
    // section-level "existing files" list instead (see loadExistingUploads).
    const path = `${userId}/${slugify(secName)}/Q${qNum}__${safe}`;

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method:  'POST',
      headers: { ...authHeaders(token), 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
      body:    file,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Upload failed (${res.status})`);
    }

    // Write profile so SCC can identify this company
    await writeProfile(userId, token, company);

    return { name: file.name, path };
  }

  async function writeProfile(userId, token, company) {
    const profile = JSON.stringify({ userId, company, updated: new Date().toISOString() });
    const blob    = new Blob([profile], { type: 'application/json' });
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${userId}/_profile.json`, {
      method:  'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body:    blob,
    });
  }

  async function listFiles(secName) {
    const { userId, token } = getUser();
    if (!userId || !token) return [];

    const prefix = `${userId}/${slugify(secName)}/`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method:  'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ prefix, limit: 100, offset: 0 }),
    });

    if (!res.ok) return [];
    const items = await res.json();
    return (items || []).filter(f => f.name && !f.name.endsWith('/'));
  }

  async function deleteFile(path) {
    const { token } = getUser();
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method:  'DELETE',
      headers: authHeaders(token),
    });
  }

  // ── AI evidence analysis (Features B/F/C — one engine, two consumers) ───────
  // A company runs this from the question they just uploaded to; SCC reads
  // the same row (and can override it) from scc.html's Evidence tab. See
  // frankie/sql/nr_evidence_analysis.sql for the shared schema.

  async function getCompanyId(userId, token) {
    if (companyId) return companyId;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/nr_companies?member_user_id=eq.${userId}&select=id`,
        { headers: authHeaders(token) }
      );
      if (!res.ok) return null;
      const rows = await res.json();
      companyId = (rows[0] && rows[0].id) || null;
      return companyId;
    } catch (e) { return null; }
  }

  async function loadAssessmentData() {
    if (assessmentData) return assessmentData;
    try {
      const r = await fetch(ASSESSMENT_DATA_FILE, { headers: kbAuthHeaders() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const all = await r.json();
      assessmentData = all.be || {};
    } catch (e) {
      assessmentData = {};
    }
    return assessmentData;
  }

  // Evidence Vault questions are numbered 1-based per section (q.q); the
  // assessment's own question array is 0-based. The two files are verified
  // 1:1 aligned for BE (same section names/order/count) but that's a
  // convention, not an enforced link - if it ever drifts this returns null
  // rather than silently matching the wrong question.
  function getRubric(secName, qNum) {
    const sec = assessmentData && assessmentData[secName];
    return (sec && sec.questions && sec.questions[qNum - 1]) || null;
  }

  async function loadExistingAnalysis(userId, token) {
    const cid = await getCompanyId(userId, token);
    if (!cid) return;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${ANALYSIS_TABLE}?company_id=eq.${cid}&assessment_type=eq.be&select=*`,
        { headers: authHeaders(token) }
      );
      if (!res.ok) return;
      const rows = await res.json();
      analysis = {};
      rows.forEach(r => { analysis[uploadKey(r.section, r.q)] = r; });
    } catch (e) { /* leave analysis as-is; questions render without a result */ }
  }

  function mediaTypeFor(filename) {
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    return ANALYSIS_MEDIA_TYPES[ext] || null;
  }

  async function getSignedUrl(path, token) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method:  'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ expiresIn: 60 }),
    });
    if (!res.ok) throw new Error('Could not access file (' + res.status + ')');
    const data = await res.json();
    return `${SUPABASE_URL}/storage/v1${data.signedURL}`;
  }

  async function fetchAsBase64(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not download file (' + res.status + ')');
    const buf   = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary  = '';
    const chunk = 0x8000; // avoid a stack-overflow from String.fromCharCode on a huge arg list
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function analyzeQuestion(secName, q, file) {
    const key = uploadKey(secName, q.q);
    const { userId, token } = getUser();

    const mediaType = mediaTypeFor(file.name);
    if (!mediaType) {
      throw new Error('AI review currently only reads PDF, JPG or PNG files — this one needs manual SCC review instead.');
    }

    await loadAssessmentData();
    const rubric = getRubric(secName, q.q);
    if (!rubric || !rubric.options) {
      throw new Error('Could not find the scoring rubric for this question.');
    }

    const signedUrl = await getSignedUrl(file.path, token);
    const b64       = await fetchAsBase64(signedUrl);
    const blockType = mediaType === 'application/pdf' ? 'document' : 'image';
    const bands     = rubric.options.map(o => o.score + ': ' + o.desc).join('\n');

    const prompt =
      'You are assessing supplier evidence for the F4N (Fit for Nuclear) Business Excellence self-assessment.\n' +
      'Question: ' + q.statement + '\n' +
      'Evidence expected: ' + q.evidence_type + ' — examples: ' + q.evidence_examples.join('; ') + '\n' +
      'Scoring bands:\n' + bands + '\n\n' +
      'Read the attached document and decide which of the exact band scores above it actually supports — do not default to the highest band just because a document was provided; a real but weak or partial document should get a lower band. ' +
      'Return ONLY valid JSON, no markdown: {"score": <one exact band number from the list above>, "rationale": "<2-3 sentences, specific to what this document shows or is missing>"}';

    const res = await fetch(`${KB_WORKER_URL}/claude/v1/messages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: blockType, source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error('AI review failed (' + res.status + ')');

    const data = await res.json();
    if (data && data.usage) {
      window.TM && window.TM.log({
        api: 'claude', model: data.model || CLAUDE_MODEL,
        prompt_tokens: data.usage.input_tokens || 0, completion_tokens: data.usage.output_tokens || 0,
        source: 'frankie', note: 'evidence-vault-analysis',
      });
    }
    const text  = (data && data.content && data.content[0] && data.content[0].text) || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = JSON.parse(match ? match[0] : text); }
    catch (e) { throw new Error('AI returned an unexpected format — try again.'); }

    const cid = await getCompanyId(userId, token);
    if (!cid) throw new Error('Could not identify your company record — is your account linked to a company yet?');

    const row = {
      company_id: cid, assessment_type: 'be', section: secName, q: q.q,
      evidence_storage_path: file.path,
      ai_suggested_score: parsed.score, ai_rationale: parsed.rationale,
      ai_model: data.model || CLAUDE_MODEL, status: 'analyzed',
    };

    const saveRes = await fetch(
      `${SUPABASE_URL}/rest/v1/${ANALYSIS_TABLE}?on_conflict=company_id,assessment_type,section,q,evidence_storage_path`,
      {
        method:  'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body:    JSON.stringify(row),
      }
    );
    const saved = saveRes.ok ? await saveRes.json().catch(() => null) : null;
    analysis[key] = (saved && saved[0]) || row;
    return analysis[key];
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  function inject() {
    if (document.getElementById('ev-drawer')) return;
    const el = document.createElement('div');
    el.id = 'ev-drawer';
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML = `
      <div class="assess-backdrop" id="evBackdrop"></div>
      <div class="assess-panel ev-panel">
        <div class="assess-topbar">
          <span class="assess-icon">📁</span>
          <div class="assess-title">Assessment Evidence Vault</div>
          <button class="assess-close" id="evClose" aria-label="Close">✕</button>
        </div>

        <div id="evAuthWarn" class="ev-auth-warn" hidden>
          <p>⚠️ Please access Frankie through the <strong>NucCoL Members Portal</strong> to upload evidence documents.</p>
        </div>

        <div id="evMain" hidden>
          <div class="ev-company-bar" id="evCompanyBar"></div>
          <div class="assess-section-bar" id="evSectionBar"></div>
          <div class="ev-body" id="evBody">
            <div class="assess-loading">Loading evidence guide…</div>
          </div>
          <div class="ev-footer" id="evFooter">
            <button class="assess-nav" id="evPrev" type="button">← Back</button>
            <button class="ev-submit-btn" id="evSubmit" type="button">View Summary</button>
            <button class="assess-nav assess-nav--primary" id="evNext" type="button">Next →</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);

    window.DrawerSplashKit && window.DrawerSplashKit.attach(el, {
      key: 'evidenceVault',
      icon: '📁',
      eyebrow: 'Supplier tool',
      title: 'Evidence Vault',
      description: 'Upload documents against every Business Excellence question and Frankie files them under the right section automatically — no need to work out where each piece of evidence belongs.',
      checklist: ['6 sections, 60 questions covered', 'Auto-matched to the right question', 'Private — only you and your SCC can see it'],
    });

    document.getElementById('evClose').onclick    = close;
    document.getElementById('evBackdrop').onclick = close;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.getElementById('evPrev').onclick   = () => navigate(-1);
    document.getElementById('evNext').onclick   = () => navigate(1);
    document.getElementById('evSubmit').onclick = showSummary;
    document.getElementById('evSectionBar').addEventListener('click', e => {
      const btn = e.target.closest('.assess-sec-pill');
      if (btn) { sectionIdx = +btn.dataset.idx; renderSection(); }
    });
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  async function loadData() {
    if (DATA) return true;
    try {
      const r = await fetch(DATA_FILE, { headers: kbAuthHeaders() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      DATA = await r.json();
      return true;
    } catch (e) {
      document.getElementById('evBody').innerHTML =
        '<p class="ev-error">Could not load evidence guide. Please refresh and try again.</p>';
      return false;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function sections() {
    return DATA ? Object.keys(DATA) : [];
  }

  function renderSectionBar() {
    const bar = document.getElementById('evSectionBar');
    bar.innerHTML = sections().map((name, i) => {
      const count   = uploadCountForSection(name);
      const total   = DATA[name].length;
      const active  = i === sectionIdx;
      return `<button class="assess-sec-pill${active ? ' assess-sec-pill--active' : ''}" data-idx="${i}" type="button">
        <span>${name}</span>
        <span class="ev-sec-count${count === total ? ' ev-sec-count--done' : ''}">${count}/${total}</span>
      </button>`;
    }).join('');
  }

  function uploadCountForSection(secName) {
    return DATA[secName].filter(q => {
      const key = uploadKey(secName, q.q);
      return uploads[key] && uploads[key].length > 0;
    }).length;
  }

  function renderSection() {
    renderSectionBar();
    const secName = sections()[sectionIdx];
    const questions = DATA[secName];

    document.getElementById('evBody').innerHTML = `
      <div class="ev-section-title">${secName}</div>
      ${renderExistingBlock(secName)}
      <div class="ev-questions">
        ${questions.map(q => renderQuestion(secName, q)).join('')}
      </div>`;

    // Bind upload inputs
    questions.forEach(q => {
      const key   = uploadKey(secName, q.q);
      const input = document.getElementById(`ev-input-${key}`);
      if (input) input.addEventListener('change', e => handleUpload(e, secName, q));
    });
    bindAnalyzeButtons(secName, questions);
    bindFileDeleteButtons(secName);
    bindExistingBlock(secName);

    // Nav buttons
    const last = sections().length - 1;
    document.getElementById('evPrev').style.visibility = sectionIdx === 0 ? 'hidden' : 'visible';
    document.getElementById('evNext').textContent = sectionIdx === last ? 'Summary ✓' : 'Next →';
    if (sectionIdx === last) {
      document.getElementById('evNext').onclick = showSummary;
    } else {
      document.getElementById('evNext').onclick = () => navigate(1);
    }
  }

  // Files that exist for this section but can't be matched to a specific
  // question (uploaded before question-tagging existed - see
  // loadExistingUploads). Shown once per section, above the question list.
  function renderExistingBlock(secName) {
    const slug  = slugify(secName);
    const files = sectionExtras[slug] || [];
    if (!files.length) return '';

    const chips = files.map((f, fi) => `
      <span class="ev-file-chip">
        <span class="ev-file-name">📄 ${f.name}</span>
        <button class="ev-file-del" data-extra-fi="${fi}" type="button" title="Remove">✕</button>
      </span>`).join('');

    return `
      <div class="ev-existing-block">
        <div class="ev-existing-label">📂 Already uploaded to this section (${files.length})</div>
        <div class="ev-upload-row">${chips}</div>
      </div>`;
  }

  // Per-file delete buttons inside renderQuestion()'s filesList. Bug fixed
  // 2026-09-11: this used to only ever get bound inside handleUpload()'s and
  // handleDeleteByKey()'s own re-render of a single question, never on the
  // section's initial render - so a file already on file when the drawer
  // opened (the normal case) showed a delete (✕) button that did nothing
  // until the member uploaded or deleted something else first. Scoped to
  // .ev-questions so it never touches the separate "existing, unmatched
  // files" block's own delete buttons (bindExistingBlock handles those).
  function bindFileDeleteButtons(secName) {
    bindQuestionFileDelete(document.querySelector('.ev-questions'), secName);
  }

  // Scoped variant used when only one question's card was just replaced
  // (handleUpload/handleDeleteByKey's own re-render) - binding within just
  // that element, rather than the whole section again, avoids stacking a
  // second listener onto every other question's already-bound delete
  // buttons each time a file is added or removed anywhere in the section.
  function bindQuestionFileDelete(scopeEl, secName) {
    if (!scopeEl) return;
    scopeEl.querySelectorAll('.ev-file-del').forEach(btn => {
      btn.addEventListener('click', () => {
        handleDeleteByKey(btn.dataset.key, +btn.dataset.fi, secName);
      });
    });
  }

  function bindExistingBlock(secName) {
    document.querySelectorAll('.ev-existing-block .ev-file-del').forEach(btn => {
      btn.addEventListener('click', () => handleDeleteExtra(secName, +btn.dataset.extraFi));
    });
  }

  async function handleDeleteExtra(secName, fi) {
    const slug  = slugify(secName);
    const files = sectionExtras[slug] || [];
    const file  = files[fi];
    if (!file) return;
    try { await deleteFile(file.path); } catch (_) {}
    files.splice(fi, 1);
    renderSection();
  }

  function renderQuestion(secName, q) {
    const key     = uploadKey(secName, q.q);
    const files   = uploads[key] || [];
    const hasFile = files.length > 0;

    const examplesList = q.evidence_examples
      .map(e => `<li>${e}</li>`)
      .join('');

    const filesList = files.map((f, fi) => `
      <span class="ev-file-chip">
        <span class="ev-file-name">📄 ${f.name}</span>
        <button class="ev-file-del" data-key="${key}" data-fi="${fi}" type="button" title="Remove">✕</button>
      </span>`).join('');

    return `
      <div class="ev-question${hasFile ? ' ev-question--done' : ''}" id="ev-q-${key}">
        <div class="ev-q-header">
          <span class="ev-q-num">Q${q.q}</span>
          <span class="ev-q-topic">${q.topic}</span>
          ${hasFile ? '<span class="ev-tick">✓</span>' : ''}
        </div>
        <div class="ev-q-statement">${q.statement}</div>
        <div class="ev-evidence-block">
          <div class="ev-evidence-label">Evidence required <span class="ev-evidence-type">${q.evidence_type}</span></div>
          <ul class="ev-evidence-list">${examplesList}</ul>
        </div>
        <div class="ev-upload-row">
          ${filesList}
          <label class="ev-upload-btn" for="ev-input-${key}">
            ${hasFile ? '+ Add another' : '📎 Upload evidence'}
            <input id="ev-input-${key}" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" multiple hidden>
          </label>
          ${hasFile ? `<button class="ev-analyze-btn" data-key="${key}" type="button">🤖 AI review</button>` : ''}
        </div>
        <div class="ev-upload-status" id="ev-status-${key}"></div>
        <div id="ev-analysis-${key}">${renderAnalysis(key)}</div>
      </div>`;
  }

  // Company-facing half of the shared engine (Feature F): show what the AI
  // made of the evidence already on file, so the company can fix gaps before
  // the SCC ever opens the file. SCC's own view of the same row lives in
  // scc.html (Feature B); this is intentionally read-only here — an
  // scc_override_score means SCC has already looked and adjusted it, and a
  // company re-running AI review would just overwrite ai_* fields, not the
  // override, so nothing is lost either way.
  function renderAnalysis(key) {
    if (analyzing[key]) return '<div class="ev-analysis ev-analysis--loading">🤖 Reading your evidence…</div>';
    if (analysisErrors[key]) return `<div class="ev-analysis ev-analysis--error">⚠️ ${analysisErrors[key]}</div>`;

    const a = analysis[key];
    if (!a) return '';

    const scoreShown = (a.scc_override_score !== null && a.scc_override_score !== undefined)
      ? a.scc_override_score : a.ai_suggested_score;
    const overrideNote = (a.scc_override_score !== null && a.scc_override_score !== undefined)
      ? '<div class="ev-analysis-override">Reviewed and scored by your SCC.</div>' : '';

    return `
      <div class="ev-analysis">
        <div class="ev-analysis-head">
          <span class="ev-analysis-badge ev-analysis-badge--${scoreBand(scoreShown)}">AI suggested: ${scoreShown}</span>
        </div>
        <div class="ev-analysis-rationale">${a.ai_rationale || ''}</div>
        ${overrideNote}
      </div>`;
  }

  function scoreBand(score) {
    if (score >= 7) return 'high';
    if (score >= 2) return 'mid';
    return 'low';
  }

  // ── AI review button ──────────────────────────────────────────────────────

  function bindAnalyzeButtons(secName, questions) {
    questions.forEach(q => {
      const key = uploadKey(secName, q.q);
      const btn = document.getElementById('ev-q-' + key) &&
                  document.getElementById('ev-q-' + key).querySelector('.ev-analyze-btn');
      if (btn) btn.addEventListener('click', () => handleAnalyze(secName, q));
    });
  }

  async function handleAnalyze(secName, q) {
    const key   = uploadKey(secName, q.q);
    const files = uploads[key] || [];
    const file  = files[files.length - 1]; // most recently uploaded file for this question
    if (!file || analyzing[key]) return;

    analyzing[key] = true;
    delete analysisErrors[key];
    const box = document.getElementById('ev-analysis-' + key);
    if (box) box.innerHTML = renderAnalysis(key);

    try {
      await analyzeQuestion(secName, q, file); // updates analysis[key] on success
    } catch (err) {
      // Leave any previous successful analysis[key] untouched - a transient
      // failure on re-review shouldn't destroy a good prior result.
      analysisErrors[key] = err.message;
    } finally {
      analyzing[key] = false;
      const box2 = document.getElementById('ev-analysis-' + key);
      if (box2) box2.innerHTML = renderAnalysis(key);
    }
  }

  // ── Upload / Delete ───────────────────────────────────────────────────────

  async function handleUpload(e, secName, q) {
    const files  = Array.from(e.target.files);
    if (!files.length) return;

    const key    = uploadKey(secName, q.q);
    const status = document.getElementById('ev-status-' + key);
    status.textContent = 'Uploading…';
    status.className   = 'ev-upload-status ev-upload-status--loading';

    const results = [];
    const errors  = [];

    for (const file of files) {
      try {
        const result = await uploadFile(file, secName, q.q);
        results.push(result);
      } catch (err) {
        errors.push(file.name + ': ' + err.message);
      }
    }

    if (!uploads[key]) uploads[key] = [];
    uploads[key].push(...results);

    if (errors.length) {
      status.textContent = 'Some files failed: ' + errors.join('; ');
      status.className   = 'ev-upload-status ev-upload-status--error';
    } else {
      status.textContent = '';
      status.className   = 'ev-upload-status';
    }

    // Re-render this question
    const qEl = document.getElementById('ev-q-' + key);
    if (qEl) {
      qEl.outerHTML = renderQuestion(secName, q);
      const newQEl   = document.getElementById('ev-q-' + key);
      const newInput = document.getElementById('ev-input-' + key);
      if (newInput) newInput.addEventListener('change', ev => handleUpload(ev, secName, q));
      bindAnalyzeButtons(secName, [q]);
      bindQuestionFileDelete(newQEl, secName);
    }

    renderSectionBar();
  }

  async function handleDeleteByKey(key, fi, secName) {
    const file = uploads[key] && uploads[key][fi];
    if (!file) return;
    try { await deleteFile(file.path); } catch (_) {}
    uploads[key].splice(fi, 1);

    // Find question and re-render
    const questions = DATA[secName];
    const parts     = key.split('/Q');
    const qNum      = +parts[1];
    const q         = questions.find(x => x.q === qNum);
    if (q) {
      const qEl = document.getElementById('ev-q-' + key);
      if (qEl) {
        qEl.outerHTML = renderQuestion(secName, q);
        const newQEl = document.getElementById('ev-q-' + key);
        const input  = document.getElementById('ev-input-' + key);
        if (input) input.addEventListener('change', ev => handleUpload(ev, secName, q));
        bindAnalyzeButtons(secName, [q]);
        bindQuestionFileDelete(newQEl, secName);
      }
    }
    renderSectionBar();
  }

  // ── Load existing uploads ─────────────────────────────────────────────────

  async function loadExistingUploads() {
    if (loadingUploads || !DATA) return;
    loadingUploads = true;

    const { userId } = getUser();
    const secNames = sections();
    for (const secName of secNames) {
      const slug = slugify(secName);
      try {
        const files = await listFiles(secName);
        files.forEach(f => {
          const path  = `${userId}/${slug}/${f.name}`;
          const match = f.name.match(/^Q(\d+)__(.+)$/);
          if (match) {
            // Tagged with a question number at upload time - restore it exactly.
            const key = uploadKey(secName, +match[1]);
            if (!uploads[key]) uploads[key] = [];
            uploads[key].push({ name: match[2], path });
          } else {
            // Uploaded before question-tagging existed - no way to know which
            // question it belongs to, so surface it at the section level.
            if (!sectionExtras[slug]) sectionExtras[slug] = [];
            sectionExtras[slug].push({ name: f.name, path });
          }
        });
      } catch (_) {}
    }
    loadingUploads = false;
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  function showSummary() {
    const secNames = sections();
    let totalQ     = 0;
    let doneQ      = 0;
    let totalFiles = 0;
    let extraFiles = 0;

    const rows = secNames.map(secName => {
      const qs = DATA[secName];
      const secDone = qs.filter(q => {
        const key = uploadKey(secName, q.q);
        return uploads[key] && uploads[key].length > 0;
      });
      totalQ     += qs.length;
      doneQ      += secDone.length;
      totalFiles += secDone.reduce((n, q) => n + (uploads[uploadKey(secName, q.q)] || []).length, 0);
      extraFiles += (sectionExtras[slugify(secName)] || []).length;

      return `<div class="ev-sum-row">
        <div class="ev-sum-sec">${secName}</div>
        <div class="ev-sum-stat${secDone.length === qs.length ? ' ev-sum-stat--done' : ''}">
          ${secDone.length}/${qs.length} questions evidenced
        </div>
      </div>`;
    }).join('');

    totalFiles += extraFiles;
    const pct = Math.round((doneQ / totalQ) * 100);

    document.getElementById('evBody').innerHTML = `
      <div class="ev-summary">
        <div class="ev-sum-hero">
          <div class="ev-sum-pct">${pct}%</div>
          <div class="ev-sum-label">Evidence uploaded</div>
          <div class="ev-sum-sub">${doneQ} of ${totalQ} questions have documents · ${totalFiles} file${totalFiles !== 1 ? 's' : ''} total${extraFiles ? ` (${extraFiles} not yet linked to a question — see each section)` : ''}</div>
        </div>
        <div class="ev-sum-rows">${rows}</div>
        <p class="ev-sum-note">Your evidence is saved securely. Your SCC can access it when your assessment is scheduled.</p>
        <button class="ev-sum-back" type="button" id="evSumBack">← Back to questions</button>
      </div>`;

    document.getElementById('evSumBack').onclick = () => renderSection();
    document.getElementById('evPrev').style.visibility = 'hidden';
    document.getElementById('evNext').style.visibility = 'hidden';
    document.getElementById('evSubmit').style.display  = 'none';
  }

  // ── Navigate ──────────────────────────────────────────────────────────────

  function navigate(dir) {
    const max = sections().length - 1;
    sectionIdx = Math.max(0, Math.min(max, sectionIdx + dir));
    renderSection();
  }

  // ── Open / Close ──────────────────────────────────────────────────────────

  function scrollToJump(secName, qNum) {
    if (!secName || !qNum) return;
    const el = document.getElementById('ev-q-' + uploadKey(secName, qNum));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ev-question--jump-highlight');
    setTimeout(() => el.classList.remove('ev-question--jump-highlight'), 2000);
  }

  // Set only when opened via a cross-link that wants closing this drawer to
  // hand the member back somewhere specific (currently just
  // assessment-drawer.js's "Attach evidence for this answer" link) rather
  // than just closing to whatever's behind it. Reset on every open() so a
  // plain sidebar-menu open (no opts) never triggers it - see close() below.
  let returnTarget = null;

  async function open(jumpSection, jumpQ, opts) {
    inject();
    returnTarget = (opts && opts.returnTo) ? opts : null;

    const drawer = document.getElementById('ev-drawer');
    drawer.classList.remove('assess-drawer--closed');
    drawer.classList.add('assess-drawer--open');
    document.body.style.overflow = 'hidden';

    const { userId, token, company } = getUser();

    if (!userId || !token) {
      document.getElementById('evAuthWarn').hidden = false;
      document.getElementById('evMain').hidden     = true;
      return;
    }

    document.getElementById('evAuthWarn').hidden = true;
    document.getElementById('evMain').hidden     = false;
    // "Back to assessment" (added 2026-09-11): explicit and visible on every
    // Evidence Vault screen (question view and Summary alike), not just an
    // implicit side-effect of clicking X - members reported not realising
    // closing the drawer would take them anywhere. Only shown when there's
    // actually somewhere to go back to (returnTarget set - i.e. opened via
    // the assessment's own link, not the plain sidebar menu). Reuses close()
    // itself, which already knows how to act on returnTarget.
    document.getElementById('evCompanyBar').innerHTML =
      (returnTarget ? `<button class="ev-back-to-assess" id="evBackToAssess" type="button">← Back to assessment</button>` : '') +
      `<span class="ev-company-name">📂 ${company}</span><span class="ev-company-sub">Your evidence is private and visible only to you and your SCC.</span>`;
    if (returnTarget) {
      const backBtn = document.getElementById('evBackToAssess');
      if (backBtn) backBtn.onclick = close;
    }

    // Reset footer visibility
    document.getElementById('evPrev').style.visibility   = 'visible';
    document.getElementById('evNext').style.visibility   = 'visible';
    document.getElementById('evSubmit').style.display    = '';

    const ok = await loadData();
    if (!ok) return;

    // Rebuild from the server fresh on every open, rather than appending to
    // whatever's left over from a previous open() this page session (uploads/
    // sectionExtras are module-level state, so without this a repeat
    // open→close→open would double up every file already shown).
    uploads = {};
    sectionExtras = {};
    analysis = {};
    analyzing = {};
    analysisErrors = {};
    companyId = null;

    const jumpIdx = jumpSection ? sections().indexOf(jumpSection) : -1;
    sectionIdx = jumpIdx >= 0 ? jumpIdx : 0;
    renderSection();
    scrollToJump(jumpSection, jumpQ);
    loadExistingUploads().then(() => renderSection());
    loadExistingAnalysis(userId, token).then(() => renderSection());
  }

  function close() {
    const drawer = document.getElementById('ev-drawer');
    if (drawer) { drawer.classList.remove('assess-drawer--open'); drawer.classList.add('assess-drawer--closed'); }
    document.body.style.overflow = '';

    // Only fires for an explicit close (X / backdrop / Escape - the three
    // bindings that call this function directly). drawer-manager.js force-
    // closing this drawer because a different tool got opened instead does
    // NOT go through here (it flips the classList directly), so opening
    // something else from the sidebar correctly does not hijack the member
    // back into the assessment.
    if (returnTarget && returnTarget.returnTo === 'assessment' && window.AssessmentDrawer) {
      const rt = returnTarget;
      returnTarget = null;
      window.AssessmentDrawer.open(rt.type, rt.sectionIdx);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.EvidenceVault = { open, close };

})();
