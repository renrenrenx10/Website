// ── Frankie Source Chunk Drawer  v1.0 ────────────────────────────────────────
// Retrieval works off KB chunks, not the original documents, so most source
// types (supplier, regs, reactors, toolkit, and any fallback source) have no
// file to deep-link into. This drawer shows the stored chunk itself instead —
// the exact passage text plus its metadata (source file, section, category,
// regulatory body, reactor type, match score) — so a user can see exactly
// what Frankie pulled its answer from.
//
// Usage:
//   SourceChunkDrawer.open(i)   → i is an index into window.frankieLastRailResults,
//                                 populated by updateRail() in ui.js.
//   SourceChunkDrawer.close()
//
// Rail cards in ui.js call this for every source type that isn't handbook or
// plant (those keep their own dedicated drawers).

(function () {
    'use strict';

    // ── DOM injection ─────────────────────────────────────────────────────────
    function injectDrawer() {
        if (document.getElementById('chunk-drawer')) return;

        const drawer = document.createElement('div');
        drawer.id        = 'chunk-drawer';
        drawer.className = 'chunk-drawer chunk-drawer--closed';
        drawer.innerHTML = `
          <div class="chunk-drawer-backdrop" id="chunkDrawerBackdrop"></div>
          <div class="chunk-drawer-panel">
            <div class="chunk-drawer-topbar">
              <span class="chunk-drawer-icon" id="chunkDrawerIcon">📄</span>
              <div class="chunk-drawer-title" id="chunkDrawerTitle">Source passage</div>
              <button class="chunk-drawer-close" id="chunkDrawerClose" aria-label="Close">✕</button>
            </div>
            <div class="chunk-drawer-body" id="chunkDrawerBody"></div>
          </div>`;
        document.body.appendChild(drawer);

        document.getElementById('chunkDrawerClose').addEventListener('click', close);
        document.getElementById('chunkDrawerBackdrop').addEventListener('click', close);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    }

    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // Human-readable labels for the metadata keys we know how to show.
    const META_FIELDS = [
        ['source_file',      'Source file'],
        ['source',           'Source file'],
        ['section',          'Section'],
        ['category',         'Category'],
        ['content_type',     'Content type'],
        ['regulatory_body',  'Regulatory body'],
        ['reactor_type',     'Reactor type'],
        ['question_id',      'Question ID'],
        ['audience',         'Audience'],
    ];

    function metaRow(label, value) {
        if (value === undefined || value === null || value === '') return '';
        return `<div class="chunk-meta-row">
                  <span class="chunk-meta-label">${esc(label)}</span>
                  <span class="chunk-meta-value">${esc(value)}</span>
                </div>`;
    }

    // ── Render a chunk + its meta into the drawer ────────────────────────────
    function render(result, meta) {
        const body  = document.getElementById('chunkDrawerBody');
        const title = document.getElementById('chunkDrawerTitle');
        const icon  = document.getElementById('chunkDrawerIcon');
        if (!body) return;

        const label = result.section || meta?.label || 'Source passage';
        title.textContent = label;
        icon.textContent  = meta?.icon || '📄';

        // De-dupe source_file/source into one row, skip fields that are absent.
        const seen = new Set();
        const rows = META_FIELDS
            .filter(([key]) => {
                if ((key === 'source' || key === 'source_file') && seen.has('source')) return false;
                if (key === 'source' || key === 'source_file') seen.add('source');
                return true;
            })
            .map(([key, label]) => metaRow(label, result[key]))
            .join('');

        const score = typeof result.score === 'number' ? result.score.toFixed(2) : '—';

        body.innerHTML = `
          <div class="chunk-drawer-content">
            <div class="chunk-drawer-meta">
              ${rows}
              ${metaRow('Match score', score)}
            </div>
            <div class="chunk-drawer-text-head">Retrieved passage</div>
            <div class="chunk-drawer-text">${result.text ? esc(result.text) : '<em>No stored text for this chunk.</em>'}</div>
          </div>`;

        const content = body.querySelector('.chunk-drawer-content');
        if (content) content.scrollTop = 0;
    }

    // ── Public API ────────────────────────────────────────────────────────────
    function open(index) {
        const entry = (window.frankieLastRailResults || [])[index];
        if (!entry) return;

        injectDrawer();
        const drawer = document.getElementById('chunk-drawer');
        drawer.classList.remove('chunk-drawer--closed');
        drawer.classList.add('chunk-drawer--open');

        render(entry.result, entry.meta);
    }

    function close() {
        const drawer = document.getElementById('chunk-drawer');
        if (drawer) {
            drawer.classList.remove('chunk-drawer--open');
            drawer.classList.add('chunk-drawer--closed');
        }
    }

    // ── Expose globally ───────────────────────────────────────────────────────
    window.SourceChunkDrawer = { open, close };

}());
