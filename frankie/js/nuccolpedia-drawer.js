// ── NucColpedia Drawer ───────────────────────────────────────────────────
// A searchable/filterable library of nuclear industry research links
// (924 entries), ported from the standalone NucColpedia.html tool. Data
// lives in data/nuccolpedia_data.json (same-origin static asset, same
// pattern as Plant Explorer's plant_tree_v2.json). Triggered via:
// window.NucColpediaDrawer.open()

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
      </div>`;
    document.body.appendChild(el);

    window.DrawerSplashKit && window.DrawerSplashKit.attach(el, {
      key: 'nuccolpedia',
      icon: '📚',
      eyebrow: 'Reference',
      title: 'NucColpedia',
      description: 'A searchable library of 924 nuclear industry research links — policy, technology, market intelligence and more — filterable by category, country and topic.',
      checklist: ['924 curated research links', 'Filter by category, country, topic', 'Search across titles and summaries'],
      art: '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="45" y="35" width="35" height="120" rx="4" fill="#10243a"/>' +
        '<rect x="82" y="45" width="35" height="110" rx="4" fill="#26a9d8"/>' +
        '<rect x="119" y="30" width="35" height="125" rx="4" fill="#f7fbff" stroke="#26a9d8" stroke-width="3"/>' +
        '<rect x="129" y="50" width="15" height="7" rx="3" fill="#d8e2ec"/><rect x="129" y="65" width="15" height="7" rx="3" fill="#d8e2ec"/>' +
        '<circle cx="150" cy="165" r="18" fill="#26a9d8"/>' +
        '<path d="M143 165l4.5 4.5 9-9" stroke="#10243a" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>',
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
