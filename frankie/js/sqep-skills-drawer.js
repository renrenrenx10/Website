// ── SQEP & Skills Matrix Drawer ──────────────────────────────────────────
// Lets a member company build up its own staff roster and track SQEP
// (Suitably Qualified and Experienced Personnel) authorisations and general
// skills against it — guided, starting from zero data, rather than a
// compliance audit against data nobody has. Reframe of the blocked
// "Feature D — SQEP Gap Diagnostic" (see frankie_blueprint_v21.md,
// "Where to look next"): a matrix is the expected/audited format (confirmed
// against the toolbox's NSS-05e Authorisation Register and PEOP-02 Skills
// Matrix templates), so this mirrors those templates' fields directly
// rather than inventing a new shape.
//
// Usage: window.SqepSkillsDrawer.open()
//
// Follows the same shell/persistence pattern as every other Frankie tool —
// see assessment-drawer.js (Supabase REST, no client lib) and
// plant-db-drawer.js (filter/table rendering).

(function () {
    'use strict';

    const WORKER_URL = 'https://ch.rene-dorset.workers.dev';
    const SEED_FILE   = `${WORKER_URL}/kb/sqep-skills-seed.json`;

    const SUPABASE_URL = 'https://qkyvmtouwrzrcyagkheo.supabase.co';
    const ANON_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreXZtdG91d3J6cmN5YWdraGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODQzNjMsImV4cCI6MjA5MDk2MDM2M30.gKEgkVA-VjOnS_084W79kpzOdZhFQkhFp63MAe_FTd4';

    const PERSONNEL_TABLE = 'nr_personnel';
    const SQEP_TABLE       = 'nr_sqep_entries';
    const SKILLS_TABLE     = 'nr_skills_entries';

    const EXPIRING_SOON_DAYS = 90; // "within 3 months" — same threshold NSS-05e's own dashboard uses

    const RATING_LABELS = ['0 – No knowledge', '1 – Awareness', '2 – Trained (supervised)', '3 – Competent (independent)', '4 – Expert (can train others)'];

    function getUser() {
        return {
            userId: localStorage.getItem('frankieUserId'),
            token:  localStorage.getItem('frankieUserToken'),
        };
    }

    function supaHeaders(token, extra) {
        return Object.assign({
            'Authorization': 'Bearer ' + (token || ANON_KEY),
            'apikey': ANON_KEY,
            'Content-Type': 'application/json',
        }, extra || {});
    }

    function kbAuthHeaders() {
        const token = localStorage.getItem('frankieUserToken');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
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

    // ── State ─────────────────────────────────────────────────────────────

    let state = {
        tab: 'staff',       // staff | sqep | skills
        loading: true,
        noCompany: false,
        personnel: [],
        sqepEntries: [],
        skillsEntries: [],
        seed: null,
        seedLoaded: false,
        banner: null,        // { type: 'success'|'info'|'error', text }
    };

    // Inline banner replaces native alert() for informational feedback --
    // a blocking browser popup read as "broken" to a user who wasn't
    // expecting it. Native confirm() is kept for the one genuinely
    // destructive action (removing a person) since a blocking confirmation
    // is the right pattern there.
    let bannerTimer = null;
    function showBanner(type, text) {
        state.banner = { type, text };
        render();
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => { state.banner = null; render(); }, 5000);
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function findSeedRole(jobTitle) {
        if (!state.seed || !jobTitle) return null;
        const jt = jobTitle.trim().toLowerCase();
        return (state.seed.roles || []).find(r => r.jobTitle.toLowerCase() === jt) || null;
    }

    // ── Status computation ───────────────────────────────────────────────

    function daysUntil(dateStr) {
        if (!dateStr) return null;
        const ms = new Date(dateStr + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime();
        return Math.round(ms / 86400000);
    }

    function computeStatus(entry) {
        if (entry.stage3_granted && entry.expiry_date) {
            const d = daysUntil(entry.expiry_date);
            if (d !== null) {
                if (d < 0) return 'expired';
                if (d <= EXPIRING_SOON_DAYS) return 'expiring_soon';
                return 'current';
            }
        }
        if (entry.stage1_complete || entry.stage2_complete || entry.stage3_granted) return 'in_progress';
        return 'not_started';
    }

    const STATUS_LABEL = {
        not_started:   { label: 'Not started',   cls: 'sqs-status-none' },
        in_progress:   { label: 'In progress',   cls: 'sqs-status-progress' },
        current:       { label: 'Current',       cls: 'sqs-status-ok' },
        expiring_soon: { label: 'Expiring soon', cls: 'sqs-status-warn' },
        expired:       { label: 'Expired',       cls: 'sqs-status-bad' },
    };

    // ── Data loading ─────────────────────────────────────────────────────

    async function loadSeed() {
        if (state.seedLoaded) return;
        try {
            const r = await fetch(SEED_FILE, { headers: kbAuthHeaders() });
            if (r.ok) state.seed = await r.json();
        } catch (e) { /* guided prefill just won't be offered */ }
        state.seedLoaded = true;
    }

    async function loadAll() {
        state.loading = true;
        render();
        const { userId, token } = getUser();
        if (!userId || !token) { state.loading = false; state.noCompany = true; render(); return; }
        const cid = await getCompanyId(userId, token);
        if (!cid) { state.loading = false; state.noCompany = true; render(); return; }
        try {
            const [pRes, sRes, kRes] = await Promise.all([
                fetch(`${SUPABASE_URL}/rest/v1/${PERSONNEL_TABLE}?company_id=eq.${cid}&active=eq.true&order=name.asc&select=*`, { headers: supaHeaders(token) }),
                fetch(`${SUPABASE_URL}/rest/v1/${SQEP_TABLE}?company_id=eq.${cid}&select=*`, { headers: supaHeaders(token) }),
                fetch(`${SUPABASE_URL}/rest/v1/${SKILLS_TABLE}?company_id=eq.${cid}&select=*`, { headers: supaHeaders(token) }),
            ]);
            state.personnel     = pRes.ok ? await pRes.json() : [];
            state.sqepEntries   = sRes.ok ? await sRes.json() : [];
            state.skillsEntries = kRes.ok ? await kRes.json() : [];
            await dedupeEntries();
        } catch (e) { /* leave whatever loaded */ }
        state.loading = false;
        render();
    }

    // Self-healing cleanup: earlier versions of the "+ Suggested SQEP" / "+
    // Suggested skills" buttons had no dedupe check, so repeat clicks kept
    // inserting the same activity/skill again for the same person. Runs
    // once per drawer open, after loading, using the member's own
    // read/write access (the delete RLS policy already scopes this to
    // their own company) -- so it quietly cleans up any pile-up from
    // before the fix without needing a manual database cleanup.
    async function dedupeEntries() {
        const sqepGroups = {};
        state.sqepEntries.forEach(e => {
            const key = e.personnel_id + '|' + e.activity;
            (sqepGroups[key] = sqepGroups[key] || []).push(e);
        });
        const sqepToDelete = [];
        Object.values(sqepGroups).forEach(group => {
            if (group.length > 1) {
                group.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                sqepToDelete.push(...group.slice(1));
            }
        });

        const skillGroups = {};
        state.skillsEntries.forEach(e => {
            const key = e.personnel_id + '|' + e.skill_area;
            (skillGroups[key] = skillGroups[key] || []).push(e);
        });
        const skillsToDelete = [];
        Object.values(skillGroups).forEach(group => {
            if (group.length > 1) {
                group.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                skillsToDelete.push(...group.slice(1));
            }
        });

        if (!sqepToDelete.length && !skillsToDelete.length) return;

        await Promise.all([
            ...sqepToDelete.map(e => deleteRow(SQEP_TABLE, e.id).catch(err => console.error('[SqepSkillsDrawer] dedupe delete failed:', err))),
            ...skillsToDelete.map(e => deleteRow(SKILLS_TABLE, e.id).catch(err => console.error('[SqepSkillsDrawer] dedupe delete failed:', err))),
        ]);

        const sqepDeletedIds = new Set(sqepToDelete.map(e => e.id));
        const skillsDeletedIds = new Set(skillsToDelete.map(e => e.id));
        state.sqepEntries = state.sqepEntries.filter(e => !sqepDeletedIds.has(e.id));
        state.skillsEntries = state.skillsEntries.filter(e => !skillsDeletedIds.has(e.id));

        if (sqepToDelete.length || skillsToDelete.length) {
            console.info('[SqepSkillsDrawer] cleaned up', sqepToDelete.length, 'duplicate SQEP entries and', skillsToDelete.length, 'duplicate skills entries.');
        }
    }

    // ── Supabase CRUD helpers ────────────────────────────────────────────

    async function insertRow(table, row) {
        const { token } = getUser();
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: supaHeaders(token, { 'Prefer': 'return=representation' }),
            body: JSON.stringify(row),
        });
        if (!res.ok) {
            // Surface Supabase/PostgREST's own error body (RLS violation, missing
            // column, FK failure, etc.) instead of a bare status code -- this is
            // what actually shows up in console.error / the alert() the caller
            // shows, so a failed insert is diagnosable instead of looking like
            // the button "did nothing".
            let detail = '';
            try { const body = await res.json(); detail = body.message || body.hint || JSON.stringify(body); } catch (e) { /* body wasn't JSON */ }
            throw new Error('insert into ' + table + ' failed: ' + res.status + (detail ? ' — ' + detail : ''));
        }
        const rows = await res.json();
        return rows[0];
    }

    async function updateRow(table, id, patch) {
        const { token } = getUser();
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
            method: 'PATCH',
            headers: supaHeaders(token, { 'Prefer': 'return=representation' }),
            body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error('update failed: ' + res.status);
        const rows = await res.json();
        return rows[0];
    }

    async function deleteRow(table, id) {
        const { token } = getUser();
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
            method: 'DELETE',
            headers: supaHeaders(token),
        });
        return res.ok;
    }

    // ── Actions ──────────────────────────────────────────────────────────

    async function addPerson(name, jobTitle, department) {
        if (!name || !name.trim()) return;
        try {
            const row = await insertRow(PERSONNEL_TABLE, {
                company_id: companyId, name: name.trim(),
                job_title: (jobTitle || '').trim(), department: (department || '').trim(),
            });
            state.personnel.push(row);
            state.personnel.sort((a, b) => a.name.localeCompare(b.name));
            render();
        } catch (e) { showBanner('error', 'Could not add staff member — try again.'); }
    }

    async function removePerson(id) {
        if (!confirm('Remove this person? Their SQEP and skills entries will be removed too.')) return;
        const ok = await deleteRow(PERSONNEL_TABLE, id);
        if (ok) {
            state.personnel = state.personnel.filter(p => p.id !== id);
            state.sqepEntries = state.sqepEntries.filter(e => e.personnel_id !== id);
            state.skillsEntries = state.skillsEntries.filter(e => e.personnel_id !== id);
            render();
        }
    }

    // Added after live testing found these gave no feedback at all when
    // they worked (silent DB insert, tiny count-text change on the staff
    // card, no navigation) and no feedback either when they failed (the
    // catch swallowed the error completely) -- both looked identical to
    // "does nothing" from the button. Now: dedupes against what's already
    // on the person's record, surfaces failures with a visible alert and a
    // console.error for diagnosis, and jumps to the relevant tab on any
    // success so the new rows are immediately visible.
    async function addSqepFromSeed(personnelId, jobTitle) {
        const role = findSeedRole(jobTitle);
        if (!role) { console.warn('[SqepSkillsDrawer] no seed role for job title:', jobTitle); return; }
        const existing = new Set(state.sqepEntries.filter(e => e.personnel_id === personnelId).map(e => e.activity));
        let added = 0, failed = 0, lastErr = null;
        for (const a of role.sqepActivities) {
            if (existing.has(a.activity)) continue; // already added for this person
            try {
                const row = await insertRow(SQEP_TABLE, {
                    company_id: companyId, personnel_id: personnelId,
                    activity: a.activity, qualification_required: a.qualificationRequired,
                    notes: a.whyItMatters ? ('Why it matters: ' + a.whyItMatters) : null,
                });
                row.status = computeStatus(row);
                state.sqepEntries.push(row);
                added++;
            } catch (e) { failed++; lastErr = e; console.error('[SqepSkillsDrawer] addSqepFromSeed insert failed:', e); }
        }
        const who = personName(personnelId);
        if (added > 0) state.tab = 'sqep';
        render();
        if (added > 0) {
            showBanner('success', 'Added ' + added + ' suggested SQEP ' + (added === 1 ? 'activity' : 'activities') + ' for ' + who + '.' + (failed ? ' (' + failed + ' failed to save.)' : ''));
        } else if (failed > 0) {
            showBanner('error', 'Could not add the suggested SQEP activities for ' + who + (lastErr && lastErr.message ? ' — ' + lastErr.message : '') + '.');
        } else {
            showBanner('info', 'Those suggested SQEP activities are already on ' + who + '\'s record.');
        }
    }

    async function addSkillsFromSeed(personnelId, jobTitle) {
        const role = findSeedRole(jobTitle);
        if (!role) { console.warn('[SqepSkillsDrawer] no seed role for job title:', jobTitle); return; }
        const existing = new Set(state.skillsEntries.filter(e => e.personnel_id === personnelId).map(e => e.skill_area));
        let added = 0, failed = 0, lastErr = null;
        for (const s of role.skillAreas) {
            if (existing.has(s.skillArea)) continue; // already added for this person
            try {
                const row = await insertRow(SKILLS_TABLE, {
                    company_id: companyId, personnel_id: personnelId,
                    skill_area: s.skillArea, mandatory: !!s.mandatory, rating: 0,
                });
                state.skillsEntries.push(row);
                added++;
            } catch (e) { failed++; lastErr = e; console.error('[SqepSkillsDrawer] addSkillsFromSeed insert failed:', e); }
        }
        const whoSkills = personName(personnelId);
        if (added > 0) state.tab = 'skills';
        render();
        if (added > 0) {
            showBanner('success', 'Added ' + added + ' suggested ' + (added === 1 ? 'skill' : 'skills') + ' for ' + whoSkills + '.' + (failed ? ' (' + failed + ' failed to save.)' : ''));
        } else if (failed > 0) {
            showBanner('error', 'Could not add the suggested skills for ' + whoSkills + (lastErr && lastErr.message ? ' — ' + lastErr.message : '') + '.');
        } else {
            showBanner('info', 'Those suggested skills are already on ' + whoSkills + '\'s record.');
        }
    }

    async function addBlankSqep(personnelId) {
        const activity = prompt('SQEP activity / scope (e.g. "Weld to approved WPS on nuclear contracts"):');
        if (!activity || !activity.trim()) return;
        try {
            const row = await insertRow(SQEP_TABLE, { company_id: companyId, personnel_id: personnelId, activity: activity.trim() });
            row.status = computeStatus(row);
            state.sqepEntries.push(row);
            render();
        } catch (e) { showBanner('error', 'Could not add activity — try again.'); }
    }

    async function addBlankSkill(personnelId) {
        const skillArea = prompt('Skill area (e.g. "Root cause analysis"):');
        if (!skillArea || !skillArea.trim()) return;
        try {
            const row = await insertRow(SKILLS_TABLE, { company_id: companyId, personnel_id: personnelId, skill_area: skillArea.trim(), rating: 0 });
            state.skillsEntries.push(row);
            render();
        } catch (e) { showBanner('error', 'Could not add skill — try again.'); }
    }

    async function patchSqepField(id, field, value) {
        const entry = state.sqepEntries.find(e => e.id === id);
        if (!entry) return;
        entry[field] = value;
        entry.status = computeStatus(entry);
        try {
            await updateRow(SQEP_TABLE, id, { [field]: value, status: entry.status });
        } catch (e) { /* keep optimistic local update even if the write failed */ }
        render();
    }

    async function patchSkillField(id, field, value) {
        const entry = state.skillsEntries.find(e => e.id === id);
        if (!entry) return;
        entry[field] = value;
        try { await updateRow(SKILLS_TABLE, id, { [field]: value }); } catch (e) { /* optimistic */ }
        render();
    }

    async function removeSqep(id) {
        const ok = await deleteRow(SQEP_TABLE, id);
        if (ok) { state.sqepEntries = state.sqepEntries.filter(e => e.id !== id); render(); }
    }

    async function removeSkill(id) {
        const ok = await deleteRow(SKILLS_TABLE, id);
        if (ok) { state.skillsEntries = state.skillsEntries.filter(e => e.id !== id); render(); }
    }

    // ── CSV export ──────────────────────────────────────────────────────

    function csvEscape(v) {
        const s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function downloadCsv(filename, rows) {
        const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM so Excel reads UTF-8 correctly
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function todayStamp() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function downloadSqepCsv() {
        const header = ['Person', 'Job Title', 'Activity / Scope', 'Qualification Required', 'Qualification Held', 'Cert Ref', 'Issue Date', 'Expiry Date', 'Stage 1 Complete', 'Stage 2 Complete', 'Stage 3 Granted', 'Status', 'Notes'];
        const rows = [header, ...state.sqepEntries.map(e => {
            const p = state.personnel.find(pp => pp.id === e.personnel_id);
            return [
                p ? p.name : '', p ? p.job_title : '', e.activity, e.qualification_required, e.qualification_held,
                e.cert_ref, e.issue_date, e.expiry_date,
                e.stage1_complete ? 'Yes' : 'No', e.stage2_complete ? 'Yes' : 'No', e.stage3_granted ? 'Yes' : 'No',
                STATUS_LABEL[computeStatus(e)].label, e.notes,
            ];
        })];
        downloadCsv('sqep-register-' + todayStamp() + '.csv', rows);
    }

    function downloadSkillsCsv() {
        const header = ['Person', 'Job Title', 'Skill Area', 'Rating', 'Rating Label', 'Mandatory', 'Notes'];
        const rows = [header, ...state.skillsEntries.map(e => {
            const p = state.personnel.find(pp => pp.id === e.personnel_id);
            return [p ? p.name : '', p ? p.job_title : '', e.skill_area, e.rating, RATING_LABELS[e.rating] || '', e.mandatory ? 'Yes' : 'No', e.notes];
        })];
        downloadCsv('skills-matrix-' + todayStamp() + '.csv', rows);
    }

    // ── Rendering ────────────────────────────────────────────────────────

    function personName(id) {
        const p = state.personnel.find(p => p.id === id);
        return p ? p.name : '—';
    }

    function renderDashboard() {
        const totalStaff = state.personnel.length;
        const sqepNone = state.sqepEntries.filter(e => computeStatus(e) === 'not_started').length;
        const sqepExpiring = state.sqepEntries.filter(e => computeStatus(e) === 'expiring_soon').length;
        const sqepExpired = state.sqepEntries.filter(e => computeStatus(e) === 'expired').length;
        const skillsNoRating = state.skillsEntries.filter(e => e.mandatory && e.rating < 2).length;
        return `
        <div class="sqs-dashboard">
          <div class="sqs-metric"><div class="sqs-metric-val">${totalStaff}</div><div class="sqs-metric-lbl">Staff tracked</div></div>
          <div class="sqs-metric"><div class="sqs-metric-val">${sqepNone}</div><div class="sqs-metric-lbl">SQEP activities not started</div></div>
          <div class="sqs-metric ${sqepExpiring ? 'sqs-metric--warn' : ''}"><div class="sqs-metric-val">${sqepExpiring}</div><div class="sqs-metric-lbl">Expiring within 3 months</div></div>
          <div class="sqs-metric ${sqepExpired ? 'sqs-metric--bad' : ''}"><div class="sqs-metric-val">${sqepExpired}</div><div class="sqs-metric-lbl">Expired</div></div>
          <div class="sqs-metric ${skillsNoRating ? 'sqs-metric--warn' : ''}"><div class="sqs-metric-val">${skillsNoRating}</div><div class="sqs-metric-lbl">Mandatory skills below "trained"</div></div>
        </div>`;
    }

    function jobTitleOptions() {
        if (!state.seed) return '';
        return state.seed.roles.map(r => `<option value="${esc(r.jobTitle)}">`).join('');
    }

    // Shared "quick add from role" shortcuts, shown directly on the SQEP
    // Register / Skills Matrix tabs themselves -- added after live testing
    // showed the "+ Suggested SQEP" text in those tabs' empty-state message
    // reads like a button but was just plain text (the real buttons only
    // ever lived on the Staff Roster tab, one tab away). Reuses the same
    // seed-sqep/seed-skills data-action buttons and handlers as the Staff
    // Roster tab.
    function renderSeedShortcuts(kind) {
        const withRole = state.personnel.filter(p => findSeedRole(p.job_title));
        if (!withRole.length) return '';
        const action = kind === 'sqep' ? 'seed-sqep' : 'seed-skills';
        const label  = kind === 'sqep' ? '+ Suggested SQEP for' : '+ Suggested skills for';
        const chips = withRole.map(p =>
            `<button class="sqs-btn sqs-btn-sm" data-action="${action}" data-person="${p.id}" data-role="${esc(p.job_title)}">${label} ${esc(p.name)}</button>`
        ).join('');
        return `<div class="sqs-shortcuts"><span class="sqs-shortcuts-lbl">Quick add from role:</span>${chips}</div>`;
    }

    function renderStaffTab() {
        const rows = state.personnel.map(p => {
            const role = findSeedRole(p.job_title);
            const sqepCount = state.sqepEntries.filter(e => e.personnel_id === p.id).length;
            const skillCount = state.skillsEntries.filter(e => e.personnel_id === p.id).length;
            return `
            <div class="sqs-staff-card" data-person="${p.id}">
              <div class="sqs-staff-main">
                <div class="sqs-staff-name">${esc(p.name)}</div>
                <div class="sqs-staff-role">${esc(p.job_title || 'No job title set')}${p.department ? ' · ' + esc(p.department) : ''}</div>
                <div class="sqs-staff-counts">${sqepCount} SQEP ${sqepCount === 1 ? 'activity' : 'activities'} · ${skillCount} ${skillCount === 1 ? 'skill' : 'skills'} tracked</div>
              </div>
              <div class="sqs-staff-actions">
                ${role ? `<button class="sqs-btn sqs-btn-sm" data-action="seed-sqep" data-person="${p.id}" data-role="${esc(p.job_title)}">+ Suggested SQEP</button>` : ''}
                ${role ? `<button class="sqs-btn sqs-btn-sm" data-action="seed-skills" data-person="${p.id}" data-role="${esc(p.job_title)}">+ Suggested skills</button>` : ''}
                <button class="sqs-btn sqs-btn-sm sqs-btn-danger" data-action="remove-person" data-person="${p.id}">Remove</button>
              </div>
            </div>`;
        }).join('') || `<div class="sqs-empty">No staff added yet. Add your first person below — if their job title matches one we recognise (e.g. Welder, NDE Inspector, QC Inspector), we'll suggest the SQEP activities and skills typically expected for that role.</div>`;

        return `
        <div class="sqs-staff-add">
          <input type="text" id="sqsNewName" class="sqs-input" placeholder="Full name">
          <input type="text" id="sqsNewTitle" class="sqs-input" placeholder="Job title" list="sqsJobTitles">
          <datalist id="sqsJobTitles">${jobTitleOptions()}</datalist>
          <input type="text" id="sqsNewDept" class="sqs-input" placeholder="Department (optional)">
          <button class="sqs-btn sqs-btn-primary" id="sqsAddPerson" type="button">+ Add staff member</button>
        </div>
        <div class="sqs-staff-list">${rows}</div>`;
    }

    function renderSqepTab() {
        if (!state.personnel.length) {
            return `<div class="sqs-empty">Add staff on the Staff Roster tab first, then track their SQEP authorisations here.</div>`;
        }
        const rows = state.sqepEntries.map(e => {
            const st = computeStatus(e);
            const info = STATUS_LABEL[st];
            return `
            <tr data-id="${e.id}">
              <td>${esc(personName(e.personnel_id))}</td>
              <td><input class="sqs-cell-input" data-field="activity" value="${esc(e.activity)}"></td>
              <td><input class="sqs-cell-input" data-field="qualification_required" value="${esc(e.qualification_required)}" placeholder="Required"></td>
              <td><input class="sqs-cell-input" data-field="qualification_held" value="${esc(e.qualification_held)}" placeholder="Held"></td>
              <td><input class="sqs-cell-input sqs-cell-narrow" data-field="cert_ref" value="${esc(e.cert_ref)}"></td>
              <td><input type="date" class="sqs-cell-input sqs-cell-narrow" data-field="expiry_date" value="${esc(e.expiry_date || '')}"></td>
              <td class="sqs-stage-cell">
                <label><input type="checkbox" data-field="stage1_complete" ${e.stage1_complete ? 'checked' : ''}> 1</label>
                <label><input type="checkbox" data-field="stage2_complete" ${e.stage2_complete ? 'checked' : ''}> 2</label>
                <label><input type="checkbox" data-field="stage3_granted" ${e.stage3_granted ? 'checked' : ''}> 3</label>
              </td>
              <td><span class="sqs-status ${info.cls}">${info.label}</span></td>
              <td><button class="sqs-icon-btn" data-action="remove-sqep" title="Remove">✕</button></td>
            </tr>`;
        }).join('');

        return `
        ${renderSeedShortcuts('sqep')}
        <div class="sqs-table-wrap">
          <table class="sqs-table">
            <thead><tr>
              <th>Person</th><th>Activity / scope</th><th>Qualification required</th><th>Qualification held</th>
              <th>Cert ref</th><th>Expiry</th><th>Stages</th><th>Status</th><th></th>
            </tr></thead>
            <tbody id="sqsSqepBody">${rows || `<tr><td colspan="9" class="sqs-empty-cell">No SQEP activities yet — use a "Quick add from role" button above, or add one below.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="sqs-add-row">
          <select id="sqsSqepPersonPick" class="sqs-input">${state.personnel.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
          <button class="sqs-btn" id="sqsAddSqep" type="button">+ Add activity</button>
          <button class="sqs-btn sqs-btn-download" id="sqsDownloadSqep" type="button">⬇ Download CSV</button>
        </div>`;
    }

    function renderSkillsTab() {
        if (!state.personnel.length) {
            return `<div class="sqs-empty">Add staff on the Staff Roster tab first, then track their skills here.</div>`;
        }
        const rows = state.skillsEntries.map(e => `
            <tr data-id="${e.id}">
              <td>${esc(personName(e.personnel_id))}</td>
              <td><input class="sqs-cell-input" data-field="skill_area" value="${esc(e.skill_area)}"></td>
              <td>
                <select class="sqs-cell-input" data-field="rating">
                  ${RATING_LABELS.map((lbl, i) => `<option value="${i}" ${e.rating === i ? 'selected' : ''}>${lbl}</option>`).join('')}
                </select>
              </td>
              <td class="sqs-center"><input type="checkbox" data-field="mandatory" ${e.mandatory ? 'checked' : ''}></td>
              <td><button class="sqs-icon-btn" data-action="remove-skill" title="Remove">✕</button></td>
            </tr>`).join('');

        // Capability gap: per skill area, average rating vs. "3 = Competent" expected level, count below it among those marked mandatory.
        const bySkill = {};
        state.skillsEntries.forEach(e => {
            if (!bySkill[e.skill_area]) bySkill[e.skill_area] = { total: 0, count: 0, belowMandatory: 0, mandatoryCount: 0 };
            const g = bySkill[e.skill_area];
            g.total += e.rating; g.count += 1;
            if (e.mandatory) { g.mandatoryCount += 1; if (e.rating < 3) g.belowMandatory += 1; }
        });
        const gapRows = Object.keys(bySkill).map(skill => {
            const g = bySkill[skill];
            const avg = (g.total / g.count).toFixed(1);
            const gap = g.mandatoryCount > 0 && g.belowMandatory > 0;
            return `<tr class="${gap ? 'sqs-gap-row' : ''}">
              <td>${esc(skill)}</td><td>${avg}</td><td>3 (Competent)</td>
              <td>${gap ? `${g.belowMandatory} of ${g.mandatoryCount}` : '—'}</td>
              <td>${gap ? '<span class="sqs-status sqs-status-warn">Gap</span>' : '<span class="sqs-status sqs-status-ok">OK</span>'}</td>
            </tr>`;
        }).join('');

        return `
        ${renderSeedShortcuts('skills')}
        <div class="sqs-table-wrap">
          <table class="sqs-table">
            <thead><tr><th>Person</th><th>Skill area</th><th>Rating</th><th>Mandatory?</th><th></th></tr></thead>
            <tbody id="sqsSkillsBody">${rows || `<tr><td colspan="5" class="sqs-empty-cell">No skills tracked yet — use a "Quick add from role" button above, or add one below.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="sqs-add-row">
          <select id="sqsSkillPersonPick" class="sqs-input">${state.personnel.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
          <button class="sqs-btn" id="sqsAddSkill" type="button">+ Add skill</button>
          <button class="sqs-btn sqs-btn-download" id="sqsDownloadSkills" type="button">⬇ Download CSV</button>
        </div>
        ${gapRows ? `
        <div class="sqs-gap-section">
          <div class="sqs-gap-title">Capability gap analysis</div>
          <table class="sqs-table sqs-gap-table">
            <thead><tr><th>Skill area</th><th>Current avg. rating</th><th>Required level</th><th>People below required (of mandatory)</th><th></th></tr></thead>
            <tbody>${gapRows}</tbody>
          </table>
        </div>` : ''}`;
    }

    function renderBanner() {
        if (!state.banner) return '';
        const cls = state.banner.type === 'error' ? 'sqs-banner-error' : state.banner.type === 'success' ? 'sqs-banner-success' : 'sqs-banner-info';
        return `<div class="sqs-banner ${cls}"><span>${esc(state.banner.text)}</span><button class="sqs-banner-close" id="sqsBannerClose" type="button" aria-label="Dismiss">✕</button></div>`;
    }

    function renderMain() {
        if (state.loading) return `<div class="sqs-loading">Loading…</div>`;
        if (state.noCompany) return `<div class="sqs-empty">Sign in with a linked company account to use the SQEP &amp; Skills Matrix.</div>`;
        const body = state.tab === 'staff' ? renderStaffTab() : state.tab === 'sqep' ? renderSqepTab() : renderSkillsTab();
        return `${renderBanner()}${renderDashboard()}
        <div class="sqs-tabs">
          <button class="sqs-tab ${state.tab === 'staff' ? 'sqs-tab--active' : ''}" data-tab="staff">Staff Roster</button>
          <button class="sqs-tab ${state.tab === 'sqep' ? 'sqs-tab--active' : ''}" data-tab="sqep">SQEP Register</button>
          <button class="sqs-tab ${state.tab === 'skills' ? 'sqs-tab--active' : ''}" data-tab="skills">Skills Matrix</button>
        </div>
        <div class="sqs-tab-body">${body}</div>`;
    }

    function render() {
        const main = document.getElementById('sqsMain');
        if (!main) return;
        main.innerHTML = renderMain();
        wireBody();
    }

    // ── Event wiring (re-attached after every render) ───────────────────

    function wireBody() {
        const main = document.getElementById('sqsMain');
        if (!main) return;

        const bannerClose = document.getElementById('sqsBannerClose');
        if (bannerClose) bannerClose.addEventListener('click', () => { clearTimeout(bannerTimer); state.banner = null; render(); });

        main.querySelectorAll('.sqs-tab').forEach(btn => {
            btn.addEventListener('click', () => { state.tab = btn.dataset.tab; render(); });
        });

        const addPersonBtn = document.getElementById('sqsAddPerson');
        if (addPersonBtn) addPersonBtn.addEventListener('click', () => {
            const name = document.getElementById('sqsNewName').value;
            const title = document.getElementById('sqsNewTitle').value;
            const dept = document.getElementById('sqsNewDept').value;
            addPerson(name, title, dept);
        });

        const addSqepBtn = document.getElementById('sqsAddSqep');
        if (addSqepBtn) addSqepBtn.addEventListener('click', () => {
            const pid = document.getElementById('sqsSqepPersonPick').value;
            if (pid) addBlankSqep(pid);
        });

        const addSkillBtn = document.getElementById('sqsAddSkill');
        if (addSkillBtn) addSkillBtn.addEventListener('click', () => {
            const pid = document.getElementById('sqsSkillPersonPick').value;
            if (pid) addBlankSkill(pid);
        });

        const dlSqepBtn = document.getElementById('sqsDownloadSqep');
        if (dlSqepBtn) dlSqepBtn.addEventListener('click', downloadSqepCsv);

        const dlSkillsBtn = document.getElementById('sqsDownloadSkills');
        if (dlSkillsBtn) dlSkillsBtn.addEventListener('click', downloadSkillsCsv);

        main.querySelectorAll('[data-action="seed-sqep"]').forEach(btn => {
            btn.addEventListener('click', () => addSqepFromSeed(btn.dataset.person, btn.dataset.role));
        });
        main.querySelectorAll('[data-action="seed-skills"]').forEach(btn => {
            btn.addEventListener('click', () => addSkillsFromSeed(btn.dataset.person, btn.dataset.role));
        });
        main.querySelectorAll('[data-action="remove-person"]').forEach(btn => {
            btn.addEventListener('click', () => removePerson(btn.dataset.person));
        });

        const sqepBody = document.getElementById('sqsSqepBody');
        if (sqepBody) {
            sqepBody.querySelectorAll('tr[data-id]').forEach(tr => {
                const id = tr.dataset.id;
                tr.querySelectorAll('[data-field]').forEach(inp => {
                    const evt = inp.type === 'checkbox' ? 'change' : (inp.tagName === 'SELECT' || inp.type === 'date' ? 'change' : 'blur');
                    inp.addEventListener(evt, () => {
                        const val = inp.type === 'checkbox' ? inp.checked : inp.value;
                        patchSqepField(id, inp.dataset.field, val);
                    });
                });
            });
            sqepBody.querySelectorAll('[data-action="remove-sqep"]').forEach(btn => {
                btn.addEventListener('click', () => removeSqep(btn.closest('tr').dataset.id));
            });
        }

        const skillsBody = document.getElementById('sqsSkillsBody');
        if (skillsBody) {
            skillsBody.querySelectorAll('tr[data-id]').forEach(tr => {
                const id = tr.dataset.id;
                tr.querySelectorAll('[data-field]').forEach(inp => {
                    const evt = inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'blur';
                    inp.addEventListener(evt, () => {
                        let val = inp.type === 'checkbox' ? inp.checked : inp.value;
                        if (inp.dataset.field === 'rating') val = parseInt(val, 10);
                        patchSkillField(id, inp.dataset.field, val);
                    });
                });
            });
            skillsBody.querySelectorAll('[data-action="remove-skill"]').forEach(btn => {
                btn.addEventListener('click', () => removeSkill(btn.closest('tr').dataset.id));
            });
        }
    }

    // ── DOM shell / open / close ─────────────────────────────────────────

    function inject() {
        if (document.getElementById('sqs-drawer')) return;
        const el = document.createElement('div');
        el.id = 'sqs-drawer';
        el.className = 'assess-drawer assess-drawer--closed';
        el.innerHTML = `
          <div class="assess-backdrop" id="sqsBackdrop"></div>
          <div class="assess-panel sqs-panel">
            <div class="assess-topbar">
              <span class="assess-icon">👷</span>
              <div class="assess-title">SQEP &amp; Skills Matrix</div>
              <button class="assess-close" id="sqsClose" aria-label="Close">✕</button>
            </div>
            <div id="sqsMain" class="sqs-main"></div>
          </div>`;
        document.body.appendChild(el);

        window.DrawerSplashKit && window.DrawerSplashKit.attach(el, {
            key: 'sqepSkills',
            icon: '👷',
            eyebrow: 'Tool',
            title: 'SQEP & Skills Matrix',
            description: 'Build up your own staff roster and track SQEP authorisations and skills against it — guided from a blank sheet, not a scored audit.',
            checklist: [
                'Add staff once, track both SQEP and skills against them',
                'Pick a recognised job title for suggested activities and required qualifications',
                'Automatic expiry and gap flags, same thresholds as the toolbox templates',
            ],
        });

        document.getElementById('sqsClose').onclick = close;
        document.getElementById('sqsBackdrop').onclick = close;
    }

    function open() {
        inject();
        document.getElementById('sqs-drawer').classList.remove('assess-drawer--closed');
        document.getElementById('sqs-drawer').classList.add('assess-drawer--open');
        Promise.all([loadSeed(), loadAll()]);
    }

    function close() {
        const el = document.getElementById('sqs-drawer');
        if (!el) return;
        el.classList.remove('assess-drawer--open');
        el.classList.add('assess-drawer--closed');
    }

    window.SqepSkillsDrawer = { open, close };
})();
