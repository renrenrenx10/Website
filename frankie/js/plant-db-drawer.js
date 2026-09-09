// ── Plant Database Drawer ────────────────────────────────────────────────
// Searchable table view of the NucCoL plant taxonomy dictionary — the
// controlling reference Plant Explorer's BOM/DSE classification pipeline
// maps every reactor component onto (Site → Location → System → Component
// → Sub Component → Category, 1,285 rows / 171 valid System-Component
// pairs). Data lives in data/dse_dictionary.json (same-origin static
// asset, same pattern as nuccolpedia_data.json / plant_tree_v2.json).
//
// Reachable from a button inside Plant Explorer's toolbar — see
// plant-explorer-drawer.js's #pe-db-link — rather than its own sidebar
// entry, per the "link FROM Plant Explorer" framing this was scoped to.
//
// Triggered via: window.PlantDbDrawer.open()

(function () {
  'use strict';

  const DATA_FILE = 'data/dse_dictionary.json';

  let DATA = null;   // { meta, facets, rows }
  let loaded = false;
  let loading = false;

  let state = {
    q: '',
    system: '',
    category: '',
  };

  // ── Data ──────────────────────────────────────────────────────────────

  async function loadData() {
    if (loaded) return true;
    if (loading) return false;
    loading = true;
    try {
      const res = await fetch(DATA_FILE);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      DATA = await res.json();
      loaded = true;
      return true;
    } catch (e) {
      console.error('[PlantDbDrawer] Failed to load dictionary:', e);
      const el = document.getElementById('pdbResults');
      if (el) el.innerHTML = '<div class="pdb-empty">Couldn\'t load the plant database. Try again shortly.</div>';
      return false;
    } finally {
      loading = false;
    }
  }

  // ── DOM ───────────────────────────────────────────────────────────────

  function inject() {
    if (document.getElementById('pdb-drawer')) return;
    const el = document.createElement('div');
    el.id = 'pdb-drawer';
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML = `
      <div class="assess-backdrop" id="pdbBackdrop"></div>
      <div class="assess-panel pdb-panel">
        <div class="assess-topbar">
          <span class="assess-icon">🗂️</span>
          <div class="assess-title">Plant Database</div>
          <button class="assess-close" id="pdbClose" aria-label="Close">✕</button>
        </div>

        <div id="pdbMain">
          <div class="pdb-body">
            <div class="pdb-filters">
              <div class="pdb-filter-group">
                <div class="pdb-filter-label">Search</div>
                <input type="search" class="pdb-search" id="pdbSearch" placeholder="Any column — e.g. reactor coolant, valve, forging…">
              </div>
              <div class="pdb-filter-group">
                <div class="pdb-filter-label">Plant System</div>
                <select class="pdb-select" id="pdbSystem"><option value="">All systems</option></select>
              </div>
              <div class="pdb-filter-group">
                <div class="pdb-filter-label">Category</div>
                <select class="pdb-select" id="pdbCategory"><option value="">All categories</option></select>
              </div>
              <button class="pdb-reset-btn" id="pdbReset" type="button">Reset filters</button>
              <div class="pdb-about">
                This is the controlling reference Plant Explorer's component
                classification maps every reactor design onto — not a list
                of components in any one plant. 171 valid (Plant System,
                Plant Component) pairs, shown here down to sub-component and
                category granularity.
              </div>
            </div>
            <div class="pdb-results-wrap">
              <div class="pdb-toolbar">
                <span id="pdbCount"></span>
              </div>
              <div id="pdbResults"></div>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);

    window.DrawerSplashKit && window.DrawerSplashKit.attach(el, {
      key: 'plantDb',
      icon: '🗂️',
      eyebrow: 'Reference',
      title: 'Plant Database',
      description: 'The underlying plant taxonomy dictionary behind Plant Explorer — searchable, filterable, the same reference the BOM classification pipeline itself uses.',
      checklist: ['1,285 rows — Site → Location → System → Component → Sub Component → Category', '171 valid Plant System / Plant Component pairs', 'Search or filter by system and category'],
    });

    document.getElementById('pdbClose').onclick    = close;
    document.getElementById('pdbBackdrop').onclick = close;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    document.getElementById('pdbSearch').addEventListener('input', e => {
      state.q = e.target.value.trim().toLowerCase();
      render();
    });
    document.getElementById('pdbSystem').addEventListener('change', e => {
      state.system = e.target.value;
      render();
    });
    document.getElementById('pdbCategory').addEventListener('change', e => {
      state.category = e.target.value;
      render();
    });
    document.getElementById('pdbReset').onclick = () => {
      state = { q: '', system: '', category: '' };
      document.getElementById('pdbSearch').value = '';
      document.getElementById('pdbSystem').value = '';
      document.getElementById('pdbCategory').value = '';
      render();
    };
  }

  function populateFilters() {
    const sysSel = document.getElementById('pdbSystem');
    DATA.facets.systems.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      sysSel.appendChild(opt);
    });
    const catSel = document.getElementById('pdbCategory');
    DATA.facets.categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      catSel.appendChild(opt);
    });
  }

  function escH(s) {
    return String(s || '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function matches(row) {
    if (state.system && row.system !== state.system) return false;
    if (state.category && row.category !== state.category) return false;
    if (state.q) {
      const hay = [row.site, row.location, row.system, row.component, row.subComponent, row.category]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }

  function render() {
    const results = DATA.rows.filter(matches);
    document.getElementById('pdbCount').innerHTML =
      `<strong>${results.length}</strong> of ${DATA.rows.length} rows`;

    const resultsEl = document.getElementById('pdbResults');
    if (!results.length) {
      resultsEl.innerHTML = '<div class="pdb-empty">No rows match those filters.</div>';
      return;
    }

    // Cap rendered rows for performance; the count above still reflects the full match set.
    const CAP = 400;
    const shown = results.slice(0, CAP);

    const head = `
      <table class="pdb-table">
        <thead><tr>
          <th>Plant Site</th><th>Plant Location</th><th>Plant System</th>
          <th>Plant Component</th><th>Plant Sub Component</th><th>Category</th>
        </tr></thead>
        <tbody>`;
    const body = shown.map(r => `
          <tr>
            <td>${escH(r.site)}</td>
            <td>${escH(r.location)}</td>
            <td>${escH(r.system)}</td>
            <td>${escH(r.component)}</td>
            <td>${escH(r.subComponent)}</td>
            <td>${escH(r.category)}</td>
          </tr>`).join('');
    const tail = '</tbody></table>' + (results.length > CAP
      ? `<div class="pdb-empty">Showing first ${CAP} of ${results.length} — narrow your search to see more.</div>`
      : '');

    resultsEl.innerHTML = head + body + tail;
  }

  // ── Open / Close ─────────────────────────────────────────────────────

  async function open() {
    inject();

    const drawer = document.getElementById('pdb-drawer');
    drawer.classList.remove('assess-drawer--closed');
    drawer.classList.add('assess-drawer--open');
    document.body.style.overflow = 'hidden';

    document.getElementById('pdbResults').innerHTML =
      '<div class="assess-loading">Loading plant database…</div>';

    const ok = await loadData();
    if (!ok) return;

    if (document.getElementById('pdbSystem').options.length === 1) {
      populateFilters();
    }
    render();
  }

  function close() {
    const drawer = document.getElementById('pdb-drawer');
    if (drawer) { drawer.classList.remove('assess-drawer--open'); drawer.classList.add('assess-drawer--closed'); }
    document.body.style.overflow = '';
  }

  // ── Public API ───────────────────────────────────────────────────────

  window.PlantDbDrawer = { open, close };

})();
