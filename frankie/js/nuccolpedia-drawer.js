// ── NucColpedia Drawer ───────────────────────────────────────────────────
// A searchable/filterable library of nuclear industry research links
// (924 entries), ported from the standalone NucColpedia.html tool. Data
// lives in data/nuccolpedia_data.json (same-origin static asset, same
// pattern as Plant Explorer's plant_tree_v2.json). Triggered via:
// window.NucColpediaDrawer.open()
//
// Second tab, "Reactor Documents": search-and-snippet access to the
// 61k-chunk reactors KB (frankie_reactors_kb.json) via reactors-kb-search.js.
// That KB is real DCD/FSAR/PCSR prose retired from Frankie's default chat
// retrieval (see retrieval.js) — a different interaction model from the
// link library above (search → scored passage results, not filter → link),
// so it's a separate tab within this drawer's shell rather than folded into
// the same filter/results UI.

(function () {
  'use strict';

  const DATA_FILE = 'data/nuccolpedia_data.json';

  let LIB = null;          // { entries, categories, countries, doctypes, topics }
  let loaded = false;
  let loading = false;

  let state = {
    q: '',
    category: '',
    country: '',
    doctype: '',
    topics: new Set(),
  };

  let activeTab = 'library'; // 'library' | 'reactors'

  let rkState = {
    q: '',
    reactorType: '',
    docCategory: '',
    discipline: '',
    results: null,   // null = no search run yet
  };

  // ── Data ──────────────────────────────────────────────────────────────

  async function loadData() {
    if (loaded) return true;
    if (loading) return false;
    loading = true;
    try {
      const res = await fetch(DATA_FILE);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      LIB = await res.json();
      loaded = true;
      return true;
    } catch (e) {
      console.error('[NucColpedia] Failed to load library data:', e);
      document.getElementById('npResults').innerHTML =
        '<div class="np-empty">Couldn\'t load the NucColpedia library. Try again shortly.</div>';
      return false;
    } finally {
      loading = false;
    }
  }

  // ── DOM ───────────────────────────────────────────────────────────────

  function inject() {
    if (document.getElementById('np-drawer')) return;
    const el = document.createElement('div');
    el.id = 'np-drawer';
    el.className = 'assess-drawer assess-drawer--closed';
    el.innerHTML = `
      <div class="assess-backdrop" id="npBackdrop"></div>
      <div class="assess-panel np-panel">
        <div class="assess-topbar">
          <span class="assess-icon">📚</span>
          <div class="assess-title">NucColpedia</div>
          <button class="assess-close" id="npClose" aria-label="Close">✕</button>
        </div>

        <div class="np-tabs" id="npTabs">
          <button class="np-tab np-tab--active" id="npTabLibrary" data-tab="library" type="button">📚 Research Library</button>
          <button class="np-tab" id="npTabReactors" data-tab="reactors" type="button">⚛️ Reactor Documents</button>
        </div>

        <div id="npMain">
          <div class="np-body">
            <div class="np-filters">
              <div class="np-filter-group">
                <div class="np-filter-label">Search</div>
                <input type="search" class="np-search" id="npSearch" placeholder="Title, keyword, author…">
              </div>
              <div class="np-filter-group">
                <div class="np-filter-label">Category</div>
                <select class="np-select" id="npCategory"><option value="">All categories</option></select>
              </div>
              <div class="np-filter-group">
                <div class="np-filter-label">Country</div>
                <select class="np-select" id="npCountry"><option value="">All countries</option></select>
              </div>
              <div class="np-filter-group">
                <div class="np-filter-label">Document type</div>
                <select class="np-select" id="npDoctype"><option value="">All types</option></select>
              </div>
              <div class="np-filter-group">
                <div class="np-filter-label">Topics</div>
                <div class="np-topic-list" id="npTopicList"></div>
              </div>
              <button class="np-reset-btn" id="npReset" type="button">Reset filters</button>
            </div>
            <div class="np-results-wrap">
              <div class="np-toolbar">
                <span id="npCount"></span>
              </div>
              <div id="npResults"></div>
            </div>
          </div>
        </div>

        <div id="npReactorsMain" hidden>
          <div class="np-body">
            <div class="np-filters">
              <div class="np-filter-group">
                <div class="np-filter-label">Search reactor documents</div>
                <input type="search" class="np-search" id="rkSearch" placeholder="e.g. steam generator tube rupture">
                <button class="np-reset-btn np-search-btn" id="rkSearchBtn" type="button">Search</button>
              </div>
              <div class="np-filter-group">
                <div class="np-filter-label">Reactor</div>
                <select class="np-select" id="rkReactor"><option value="">All reactors</option></select>
              </div>
              <div class="np-filter-group">
                <div class="np-filter-label">Document type</div>
                <select class="np-select" id="rkDocType"><option value="">All types</option></select>
              </div>
              <div class="np-filter-group">
                <div class="np-filter-label">Discipline</div>
                <select class="np-select" id="rkDiscipline"><option value="">All disciplines</option></select>
              </div>
              <button class="np-reset-btn" id="rkReset" type="button">Reset filters</button>
            </div>
            <div class="np-results-wrap">
              <div class="np-toolbar">
                <span id="rkCount"></span>
              </div>
              <div id="rkResults"></div>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);

    window.DrawerSplashKit && window.DrawerSplashKit.attach(el, {
      key: 'nuccolpedia',
      icon: '📚',
      eyebrow: 'Reference',
      title: 'NucColpedia',
      description: 'A searchable library of 924 nuclear industry research links, plus full-text search across 61,000+ passages of real reactor design documentation (DCD, FSAR, PCSR, GDA).',
      checklist: ['924 curated research links', 'Filter by category, country, topic', 'Reactor Documents tab: search real DCD/FSAR/PCSR text'],
    });

    document.getElementById('npClose').onclick    = close;
    document.getElementById('npBackdrop').onclick = close;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    document.getElementById('npSearch').addEventListener('input', e => {
      state.q = e.target.value.trim().toLowerCase();
      render();
    });
    document.getElementById('npCategory').addEventListener('change', e => {
      state.category = e.target.value;
      render();
    });
    document.getElementById('npCountry').addEventListener('change', e => {
      state.country = e.target.value;
      render();
    });
    document.getElementById('npDoctype').addEventListener('change', e => {
      state.doctype = e.target.value;
      render();
    });
    document.getElementById('npTopicList').addEventListener('change', e => {
      if (e.target.type !== 'checkbox') return;
      if (e.target.checked) state.topics.add(e.target.value);
      else state.topics.delete(e.target.value);
      render();
    });
    document.getElementById('npReset').onclick = () => {
      state = { q: '', category: '', country: '', doctype: '', topics: new Set() };
      document.getElementById('npSearch').value = '';
      document.getElementById('npCategory').value = '';
      document.getElementById('npCountry').value = '';
      document.getElementById('npDoctype').value = '';
      document.querySelectorAll('#npTopicList input').forEach(cb => cb.checked = false);
      render();
    };

    // ── Reactor Documents tab ────────────────────────────────────────────
    document.getElementById('npTabLibrary').onclick  = () => switchTab('library');
    document.getElementById('npTabReactors').onclick = () => switchTab('reactors');

    document.getElementById('rkSearchBtn').onclick = runReactorSearch;
    document.getElementById('rkSearch').addEventListener('keydown', e => {
      if (e.key === 'Enter') runReactorSearch();
    });
    document.getElementById('rkReactor').addEventListener('change', e => {
      rkState.reactorType = e.target.value;
      if (rkState.results !== null) runReactorSearch();
    });
    document.getElementById('rkDocType').addEventListener('change', e => {
      rkState.docCategory = e.target.value;
      if (rkState.results !== null) runReactorSearch();
    });
    document.getElementById('rkDiscipline').addEventListener('change', e => {
      rkState.discipline = e.target.value;
      if (rkState.results !== null) runReactorSearch();
    });
    document.getElementById('rkReset').onclick = () => {
      rkState = { q: '', reactorType: '', docCategory: '', discipline: '', results: null };
      document.getElementById('rkSearch').value = '';
      document.getElementById('rkReactor').value = '';
      document.getElementById('rkDocType').value = '';
      document.getElementById('rkDiscipline').value = '';
      renderReactorResults();
    };
  }

  // ── Reactor Documents: tab switching ─────────────────────────────────

  function switchTab(tab) {
    activeTab = tab;
    document.getElementById('npTabLibrary').classList.toggle('np-tab--active', tab === 'library');
    document.getElementById('npTabReactors').classList.toggle('np-tab--active', tab === 'reactors');
    document.getElementById('npMain').hidden = tab !== 'library';
    document.getElementById('npReactorsMain').hidden = tab !== 'reactors';

    if (tab === 'reactors' && !window.ReactorsKbSearch?.isLoaded()) {
      loadReactorsKb();
    }
  }

  // ── Reactor Documents: KB load + facets ──────────────────────────────

  async function loadReactorsKb() {
    const resultsEl = document.getElementById('rkResults');
    const countEl   = document.getElementById('rkCount');
    if (!window.ReactorsKbSearch) {
      resultsEl.innerHTML = '<div class="np-empty">Reactor documents search isn\'t available right now.</div>';
      return;
    }

    countEl.textContent = '';
    resultsEl.innerHTML = '<div class="assess-loading">Loading the reactor document library (61,000+ passages, real DCD/FSAR/PCSR text) — this only happens once per session…</div>';

    try {
      await window.ReactorsKbSearch.ensureLoaded(stage => {
        resultsEl.innerHTML = `<div class="assess-loading">${stage === 'indexing' ? 'Indexing for search…' : 'Fetching reactor document library…'}</div>`;
      });
      populateReactorFacets();
      renderReactorResults();
    } catch (e) {
      console.error('[NucColpedia] Reactor KB load failed:', e);
      resultsEl.innerHTML = '<div class="np-empty">Couldn\'t load the reactor document library. Try again shortly.</div>';
    }
  }

  function populateReactorFacets() {
    const facets = window.ReactorsKbSearch.getFacets();
    const reactorSel = document.getElementById('rkReactor');
    if (reactorSel.options.length > 1) return; // already populated

    facets.reactorTypes.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r; opt.textContent = r.replace(/_/g, ' ');
      reactorSel.appendChild(opt);
    });
    const docSel = document.getElementById('rkDocType');
    facets.docCategories.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d; opt.textContent = d;
      docSel.appendChild(opt);
    });
    const discSel = document.getElementById('rkDiscipline');
    facets.disciplines.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d; opt.textContent = d;
      discSel.appendChild(opt);
    });
  }

  // ── Reactor Documents: search + render ───────────────────────────────

  function runReactorSearch() {
    rkState.q = document.getElementById('rkSearch').value.trim();
    if (!rkState.q) {
      rkState.results = null;
      renderReactorResults();
      return;
    }
    if (!window.ReactorsKbSearch?.isLoaded()) return;

    rkState.results = window.ReactorsKbSearch.search(rkState.q, {
      reactorType: rkState.reactorType,
      docCategory: rkState.docCategory,
      discipline:  rkState.discipline,
    }, 20);
    renderReactorResults();
  }

  // Strip the "[reactor_type] [doc_category] " context prefix build_frankie_reactors_kb.py
  // adds to every chunk's text — it helps retrieval, but reads as noise in a snippet.
  const RK_PREFIX_RE = /^\[[^\]]+\]\s*\[[^\]]+\]\s*/;

  function snippet(text, len = 300) {
    const clean = (text || '').replace(RK_PREFIX_RE, '').trim();
    return clean.length > len ? clean.slice(0, len) + '…' : clean;
  }

  function renderReactorResults() {
    const resultsEl = document.getElementById('rkResults');
    const countEl   = document.getElementById('rkCount');

    if (rkState.results === null) {
      countEl.textContent = '';
      resultsEl.innerHTML = '<div class="np-empty">Search the reactor document library above — real DCD, FSAR, PCSR and GDA text across 19 reactor designs.</div>';
      return;
    }

    const results = rkState.results;
    countEl.innerHTML = `<strong>${results.length}</strong> result${results.length === 1 ? '' : 's'} for "${escH(rkState.q)}"`;

    if (!results.length) {
      resultsEl.innerHTML = '<div class="np-empty">No passages matched. Try fewer or different words, or clear a filter.</div>';
      return;
    }

    // Stash for SourceChunkDrawer, same convention ui.js's updateRail() uses.
    window.frankieLastRailResults = results.map(r => ({
      result: r,
      meta:   { icon: '⚛️', label: `${r.reactor_type} — ${r.doc_category}` },
    }));

    resultsEl.innerHTML = results.map((r, i) => `
      <div class="np-card rk-card">
        <div class="np-meta-row">
          <span class="np-pill cat">${escH(r.reactor_type || '?')}</span>
          <span class="np-pill web">${escH(r.doc_category || '?')}</span>
          ${r.discipline ? `<span class="np-pill">${escH(r.discipline)}</span>` : ''}
          <span>${escH(r.source_file || '')}</span>
          <span>${escH(r.section || '')}</span>
        </div>
        <div class="np-desc">${escH(snippet(r.text))}</div>
        <button class="rk-view-btn" type="button" onclick="window.SourceChunkDrawer && window.SourceChunkDrawer.open(${i})">🔍 View full passage →</button>
      </div>`).join('');
  }

  function populateFilters() {
    const catSel = document.getElementById('npCategory');
    LIB.categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      catSel.appendChild(opt);
    });
    const countrySel = document.getElementById('npCountry');
    LIB.countries.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      countrySel.appendChild(opt);
    });
    const doctypeSel = document.getElementById('npDoctype');
    LIB.doctypes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      doctypeSel.appendChild(opt);
    });
    const topicList = document.getElementById('npTopicList');
    LIB.topics.forEach(t => {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${escH(t)}"><span>${escH(t)}</span>`;
      topicList.appendChild(label);
    });
  }

  function escH(s) {
    return String(s || '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function matches(entry) {
    if (state.category && entry.category !== state.category) return false;
    if (state.country && entry.country !== state.country) return false;
    if (state.doctype && entry.doctype !== state.doctype) return false;
    if (state.topics.size) {
      const entryTopics = entry.topics || [];
      let hit = false;
      for (const t of state.topics) { if (entryTopics.includes(t)) { hit = true; break; } }
      if (!hit) return false;
    }
    if (state.q) {
      const hay = [entry.title, entry.desc, entry.keywords, entry.author]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }

  function render() {
    const results = LIB.entries.filter(matches);
    document.getElementById('npCount').innerHTML =
      `<strong>${results.length}</strong> of ${LIB.entries.length} entries`;

    const resultsEl = document.getElementById('npResults');
    if (!results.length) {
      resultsEl.innerHTML = '<div class="np-empty">No entries match those filters.</div>';
      return;
    }

    // Cap rendered cards for performance; the count above still reflects the full match set.
    const CAP = 200;
    const shown = results.slice(0, CAP);

    resultsEl.innerHTML = shown.map(entry => {
      const pillType = entry.link_type === 'local' ? 'local' : 'web';
      const meta = [
        entry.date,
        entry.country,
        entry.doctype,
        entry.author,
      ].filter(Boolean).map(m => `<span>${escH(m)}</span>`).join('');
      return `
        <div class="np-card">
          <h4><a href="${escH(entry.href || '#')}" target="_blank" rel="noopener">${escH(entry.title || 'Untitled')}</a></h4>
          <div class="np-meta-row">
            ${entry.category ? `<span class="np-pill cat">${escH(entry.category)}</span>` : ''}
            <span class="np-pill ${pillType}">${pillType === 'local' ? 'Local file' : 'Web link'}</span>
            ${meta}
          </div>
          ${entry.desc ? `<div class="np-desc">${escH(entry.desc.slice(0, 320))}${entry.desc.length > 320 ? '…' : ''}</div>` : ''}
          ${entry.keywords ? `<div class="np-keywords">${escH(entry.keywords)}</div>` : ''}
        </div>`;
    }).join('') + (results.length > CAP
      ? `<div class="np-empty">Showing first ${CAP} of ${results.length} — narrow your search to see more.</div>`
      : '');
  }

  // ── Open / Close ─────────────────────────────────────────────────────

  async function open() {
    inject();

    const drawer = document.getElementById('np-drawer');
    drawer.classList.remove('assess-drawer--closed');
    drawer.classList.add('assess-drawer--open');
    document.body.style.overflow = 'hidden';

    document.getElementById('npResults').innerHTML =
      '<div class="assess-loading">Loading NucColpedia…</div>';

    const ok = await loadData();
    if (!ok) return;

    if (document.getElementById('npCategory').options.length === 1) {
      populateFilters();
    }
    render();
  }

  function close() {
    const drawer = document.getElementById('np-drawer');
    if (drawer) { drawer.classList.remove('assess-drawer--open'); drawer.classList.add('assess-drawer--closed'); }
    document.body.style.overflow = '';
  }

  // ── Public API ───────────────────────────────────────────────────────

  window.NucColpediaDrawer = { open, close };

})();
