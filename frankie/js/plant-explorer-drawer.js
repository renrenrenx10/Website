// ── Frankie Plant Explorer Drawer  v1.0 ───────────────────────────────────────
// Full Tool Kit version of NuCCoL's Plant Explorer: interactive zone map,
// capability/commodity search, and a component drill-down tree, filterable
// by reactor design. Ported 2026-08-03 from the standalone
// NuCCoL_Plant_Explorer_v2_images.html.
//
// What's different from the standalone file:
//  - The supplier/company map feature (COMPANY_DICT, COMPANIES, Leaflet,
//    "view on map" buttons/chips) has been removed entirely, per request.
//  - Tree data is fetched live from the SAME gated Worker endpoint the
//    chat-triggered PlantDrawer already uses (${WORKER_URL}/kb/plant_tree_data.json)
//    instead of being baked into this file — one source of truth, no risk
//    of this copy drifting from what the rest of Frankie shows.
//  - All inline style="..." attributes and .style.cssText assignments were
//    converted to CSS classes / per-property JS style sets, since Frankie's
//    CSP (style-src) has no 'unsafe-inline' — see css/plant-explorer.css.
//  - Layer 2 of the original tool (per-reactor cutaway diagrams with
//    building callouts — PLANT_VIEWS/PLANT_INFO/PV_IMG) was deliberately
//    left out of this pass. The 35 diagram images are still extracted and
//    sitting in images/plant-explorer/pv/ (see manifest.json) for a future
//    follow-up; nothing in this file references them yet.
//
// Usage:
//   PlantExplorerDrawer.open()
//   PlantExplorerDrawer.close()

(function () {
  'use strict';

  const WORKER_URL = 'https://ch.rene-dorset.workers.dev';
  const DATA_FILE = `${WORKER_URL}/kb/plant_tree_data.json`;

  function authHeaders() {
    const token = localStorage.getItem('frankieUserToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  let dataLoaded = false;

  const BODY_HTML = `

<div id="loading"><div class="loading-ring"></div><div class="loading-text">Loading NuCCoL Plant Explorer…</div></div>
<div id="tooltip">
  <div id="tt-zone"></div>
  <div id="tt-title"></div>
  <div id="tt-sub"></div>
  <div id="tt-hint">Click to explore →</div>
</div>

<div id="app">
  <div id="topbar">
    <div class="logo-wrap">
      <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></div>
      <span class="logo-name">NuCCoL</span>
      <div class="logo-pipe"></div>
      <span class="logo-sub">Nuclear Plant Explorer</span>
    </div>
    <div class="topbar-spacer"></div>
    <div class="view-tabs">
      <button class="view-tab active" data-view="schematic" id="pe-schematic-tab">⚛ Plant Schematic</button>
      </div>
    <div class="pe-toolbar-divider"></div>
    <div id="reactor-select-wrap">
      <span id="reactor-select-icon" title="Reactor design">⚛</span>
      <select id="reactor-select">
      <option value="ALL">All 18 designs — composite</option>
      <option value="GW">Generic — Gigawatt (GW)</option>
      <option value="SMR">Generic — SMR</option>
      <option value="ABWR">ABWR</option>
      <option value="AP1000">AP1000</option>
      <option value="AP300">AP300</option>
      <option value="AP600">AP600</option>
      <option value="APR1400">APR1400</option>
      <option value="BWRX300">BWRX300</option>
      <option value="Candu">Candu</option>
      <option value="ESBWR">ESBWR</option>
      <option value="HPR1000">HPR1000</option>
      <option value="Holtec International SMR-300">Holtec International SMR-300</option>
      <option value="NuScale_US460">NuScale_US460</option>
      <option value="NuScale_VOYGR">NuScale_VOYGR</option>
      <option value="RR_SMR">RR_SMR</option>
      <option value="Terrapower Natrium">Terrapower Natrium</option>
      <option value="UK_EPR">UK_EPR</option>
      <option value="US_APWR">US_APWR</option>
      <option value="US_EPR">US_EPR</option>
      <option value="X Energy">X Energy</option>
      </select>
    </div>
    <div class="pe-toolbar-divider"></div>
    <div id="cap-search-wrap">
      <input id="cap-search-input" type="text" placeholder="Search what you make…" autocomplete="off">
      <button id="cap-search-clear" title="Clear">✕</button>
      <button id="cap-search-btn">Find in Plant</button>
      <div id="cap-dropdown"></div>
    </div>
  </div>

  <div id="main">
    <!-- SCHEMATIC -->
    <div id="schematic-view">
      <div id="schematic-canvas">
        <div id="hint">👆 Hover over a building zone to explore systems</div>

        <div id="plant-wrapper">
          <!-- Plant image — 1408×736px -->
          <img id="plant-img" src="images/plant-explorer/zone-map.jpeg" alt="Nuclear Plant Isometric View">

          <!-- SVG overlay — viewBox matches image pixel dimensions exactly -->
          <svg id="zone-svg" viewBox="0 0 1408 736" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">

            <!-- Zone 01: Reactor Building (green dome complex) -->
            <polygon data-zone="01"
              points="214,522 178,517 168,513 169,485 170,451 322,369 322,353 337,334 366,320 397,314 419,314 442,327 458,343 461,363 496,384 500,476 278,600 216,564"/>

            <!-- Zone 02: Fuel & Waste Buildings (orange/brown, far left) -->
            <polygon data-zone="02"
              points="281,352 285,390 169,448 167,482 165,513 134,493 123,471 82,491 64,489 55,480 55,359 73,343 73,317 85,317 87,334 169,288"/>

            <!-- Zone 03: Safeguard & Auxiliary Buildings (small blue, centre) -->
            <polygon data-zone="03"
              points="497,397 558,363 594,392 596,424 502,475"/>

            <!-- Zone 04: Diesel Building (yellow, centre-front) -->
            <polygon data-zone="04"
              points="513,497 618,439 667,469 667,493 679,504 679,520 627,547 602,536 571,558 526,536 531,509"/>

            <!-- Zone 05: Turbine Building (large blue, top-right) -->
            <polygon data-zone="05"
              points="535,328 533,247 569,230 562,221 603,198 609,210 781,109 779,71 799,53 821,64 824,87 951,162 949,247 746,361 797,395 799,408 730,444"/>
          </svg>

          <!-- Numbered badges — top/left as % of wrapper, using centroid positions -->
          <!-- Centroid in 1408x736 px space → convert to % -->
          <!-- Zone 01 centroid: (328,419) → 23.3%, 57.0% -->
          <div class="z-badge" data-zone="01">01</div>
          <!-- Zone 02 centroid: (129,410) → 9.2%, 55.7% -->
          <div class="z-badge" data-zone="02">02</div>
          <!-- Zone 03 centroid: (549,410) → 39%, 55.7% -->
          <div class="z-badge" data-zone="03">03</div>
          <!-- Zone 04 centroid: (607,509) → 43.1%, 69.2% -->
          <div class="z-badge" data-zone="04">04</div>
          <!-- Zone 05 centroid: (728,225) → 51.7%, 30.6% -->
          <div class="z-badge" data-zone="05">05</div>
        </div>


      </div>

      <!-- SLIDE-OUT PANEL -->
      <div id="drill-panel">
        <div id="drill-panel-inner">
          <div id="drill-header">
            <div class="drill-stripe" id="drill-stripe"></div>
            <div id="drill-title">
              <div id="drill-title-main">Plant Hierarchy</div>
              <div id="drill-title-sub">Click a building to begin</div>
            </div>
            <button id="drill-close">✕</button>
          </div>
          <div id="breadcrumb"></div>
          <div id="drill-content"></div>
        </div>
      </div>
    </div>

    <!-- MAP VIEW -->
    
  </div>
</div>

`;

  // ── DOM injection ──────────────────────────────────────────────────────────
  function injectDrawer() {
    if (document.getElementById('plant-explorer-drawer')) return;
    const el = document.createElement('div');
    el.id = 'plant-explorer-drawer';
    el.className = 'pe-drawer pe-drawer--closed';
    el.innerHTML = `
      <div class="pe-drawer-backdrop" id="peDrawerBackdrop"></div>
      <div class="pe-drawer-panel">
        <button class="pe-drawer-close" id="peDrawerClose" aria-label="Close plant explorer">✕</button>
        ${BODY_HTML}
      </div>`;
    document.body.appendChild(el);

    document.getElementById('peDrawerClose').addEventListener('click', close);
    document.getElementById('peDrawerBackdrop').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('pe-drawer--open')) close(); });

    // Former inline onclick="" attributes, now wired here
    document.getElementById('pe-schematic-tab')?.addEventListener('click', () => switchView('schematic'));
    document.getElementById('drill-close')?.addEventListener('click', closeDrillPanel);

    initZones();
    initCapSearch();
    const reactorSelect = document.getElementById('reactor-select');
    if (reactorSelect) reactorSelect.addEventListener('change', e => setReactorFilter(e.target.value));
  }

  // ── Ported Plant Explorer logic (zone map, drill panel, capability search) ──

let PLANT_TREE = null;


// ── Reactor filter (v2) ──
const REACTOR_NAMES = ["ABWR", "AP1000", "AP300", "AP600", "APR1400", "BWRX300", "Candu", "ESBWR", "HPR1000", "Holtec International SMR-300", "NuScale_US460", "NuScale_VOYGR", "RR_SMR", "Terrapower Natrium", "UK_EPR", "US_APWR", "US_EPR", "X Energy"];
let selectedReactor = 'ALL';
let ACTIVE_TREE = PLANT_TREE;

function filterTreeForReactor(reactor) {
  if (!PLANT_TREE) return [];
  if (reactor === 'ALL') return PLANT_TREE;
  const out = [];
  PLANT_TREE.forEach(site => {
    const locs = [];
    site.locations.forEach(loc => {
      const syss = [];
      loc.systems.forEach(sys => {
        const comps = [];
        sys.components.forEach(comp => {
          const subs = comp.subcomponents.filter(sub => sub.reactors && sub.reactors.indexOf(reactor) !== -1);
          if (subs.length) comps.push(Object.assign({}, comp, {subcomponents: subs}));
        });
        if (comps.length) syss.push(Object.assign({}, sys, {components: comps}));
      });
      if (syss.length) locs.push(Object.assign({}, loc, {systems: syss}));
    });
    if (locs.length) out.push(Object.assign({}, site, {locations: locs}));
  });
  return out;
}

function setReactorFilter(reactor) {
  selectedReactor = reactor;
  ACTIVE_TREE = filterTreeForReactor(reactor);
  buildSearchIndex();
  closeDrillPanel();
  const lbl = document.getElementById('reactor-active-label');
  if (lbl) lbl.textContent = reactor === 'ALL' ? 'All 18 reactor designs (generic)' : reactor;
}

// Zone definitions — maps zone number to plant tree site + display info
const ZONE_INFO = {
  '01':{ site:'Nuclear Island', label:'Reactor Building', color:'#28b44a', stripeColor:'#28b44a',
    intro:'There are very limited UK manufacturing opportunities within this building. Classification requirements, relating to high-risk components could make supplying into this area prohibitive to UK companies. The majority of the equipment will come from overseas and pre-existing Reactor Vendor qualified Supply Chains, certainly for early plant construction programmes.',
    bullets:['Shielding and Shielded Structures','Pipework Systems and Penetrations, other than Main Steam','Support Structures and Fabrications','Detection Systems (Leaks)','Insulation & Lagging Systems','Pipe Support Systems'],
  },
  '02':{ site:'Nuclear Island', label:'Fuel Building & Waste Buildings', color:'#c07830', stripeColor:'#c07830',
    intro:'The above consist of very complex and safety critical fabrications, assemblies and components. Typical components could include Tanks, Heat Exchangers, Separators, Filters and Filtration Equipment along with various Pipework Systems.',
    bullets:['Controls and Electrics relating to Instrumentation & Control','Fuel Handling Components, including Cranes and Mechanical Equipment','Sensors and Monitoring Equipment','Fuel Storage Pond and Fuel Pool Cooling Systems','Borating, Chemical & Volume Control Systems','Core Component Handling Equipment','Fuel Transfer Systems and Transportation Systems','Fuel Storage Racks and other Pond Furniture Components','Refuelling and Spent Cask Transfer Systems & Machines','Storage Containers and Drums','Radiological Control Systems','Ventilation, Filtration & Cooling Systems','Access Structures & Fabrications','Waste Collection Systems (Various, Solid through to Gaseous)','Pipe Support Systems'],
  },
  '03':{ site:'Nuclear Island', label:'Safeguard & Auxiliary Buildings', color:'#1a9edd', stripeColor:'#1a9edd',
    intro:'There are numerous systems across the 3 designs, for the UK. Within the buildings are a range of varying classifications of components. Typical components being Pressure Vessels, Accumulators, Tanks, Heat Exchangers, Valves, Pumps, Modules, Supports, Pipe Systems, Fans & Filtration equipment.',
    bullets:['Chemical and Volume Control Systems','Safety Injection / Residual Heat Removal Systems','Emergency Feedwater Systems','Condensate and Emergency Core Cooling Systems','Spent Fuel Cooling Systems','Cooling Water Systems, including Pipework Systems and Support Structures','Pipe Support Systems & Cabling'],
  },
  '04':{ site:'Balance of Plant', label:'Diesel Building', color:'#d4a800', stripeColor:'#d4a800',
    intro:'Opportunities will be in the areas of fabrications and assemblies. Diesel Generators are expected to be from overseas suppliers.',
    bullets:['Emergency Diesel Engines & Sets','Back-up & Redundant Diesel Systems','Cooling Systems and Ventilation & Ducting for the Diesel Engines','Pipework Systems (Various)','Maintenance Systems (Various)','Electrical and Electronics, including Cabling & Support Systems','Ancillary Pipe Support Systems & Cabling'],
  },
  '05':{ site:'Turbine Island', label:'Turbine Building', color:'#1a6ab4', stripeColor:'#1a6ab4',
    intro:'Typical components within the building are: Welded Structures, Pressure Vessels, Tanks, Condensers, Heat Exchangers, Pumps, Compressors, Piping Structures, Modules and Fabrications. Main Steam Turbines are likely to be overseas supplied into the UK.',
    bullets:['Cranes and Handling Equipment','Fire Prevention Systems','Heating, Ventilation and Air Conditioning (HVAC)','Lube Oil, Purification and various other Systems','Electronic Control Systems related to electricity generation','Compressors & Dryers','Pumps and Water Management Systems with Valves','Steam Return Systems to Heat Exchangers','Power Distribution Systems','Pipework and Pipework Systems','Building Support Fabrication and Metalwork','Pipe Support Systems & Cabling'],
  },
};

// ── Zone interactions ──
let activeZone = null;
let drillStack  = [];

function initZones() {
  document.querySelectorAll('#zone-svg polygon').forEach(poly => {
    poly.addEventListener('mouseenter', e => onZoneHover(e, poly.dataset.zone, true));
    poly.addEventListener('mouseleave', e => onZoneHover(e, poly.dataset.zone, false));
    poly.addEventListener('mousemove',  moveTooltip);
    poly.addEventListener('click', () => openZone(poly.dataset.zone));
  });
  document.querySelectorAll('.z-badge').forEach(badge => {
    badge.addEventListener('mouseenter', e => onZoneHover(e, badge.dataset.zone, true));
    badge.addEventListener('mouseleave', e => onZoneHover(e, badge.dataset.zone, false));
    badge.addEventListener('click', () => openZone(badge.dataset.zone));
  });
}

function onZoneHover(e, zoneId, entering) {
  if (entering) {
    highlightZone(zoneId, true);
    showTooltip(e, zoneId);
  } else {
    if (zoneId !== activeZone) highlightZone(zoneId, false);
    hideTooltip();
  }
}

function highlightZone(zoneId, on) {
  const poly = document.querySelector(`#zone-svg polygon[data-zone="${zoneId}"]`);
  if (poly) poly.classList.toggle('active', on);
  document.querySelectorAll(`.z-badge[data-zone="${zoneId}"]`).forEach(b => b.classList.toggle('active', on));
}

function openZone(zoneId) {
  if (!ACTIVE_TREE) {
    openDrillPanel();
    document.getElementById('drill-title-main').textContent = 'Loading…';
    document.getElementById('drill-title-sub').textContent = '';
    document.getElementById('drill-content').innerHTML = '<div class="zone-empty-state">Still loading plant data — try again in a moment.</div>';
    return;
  }
  // Deactivate previous
  if (activeZone && activeZone !== zoneId) {
    highlightZone(activeZone, false);
    document.querySelector(`#zone-svg polygon[data-zone="${activeZone}"]`)?.classList.remove('active');
  }
  activeZone = zoneId;
  highlightZone(zoneId, true);

  const info = ZONE_INFO[zoneId];
  if (!info) return;
  const site = ACTIVE_TREE.find(s => s.name === info.site);
  document.getElementById('drill-stripe').style.background = info.stripeColor;
  if (!site) {
    openDrillPanel();
    document.getElementById('breadcrumb').innerHTML = '';
    document.getElementById('drill-title-main').textContent = info.label;
    document.getElementById('drill-title-sub').textContent = `No mapped components for ${selectedReactor}`;
    document.getElementById('drill-content').innerHTML = `<div class="zone-empty-state">No components from <b>${esc(selectedReactor)}</b> map to this zone yet. Try "All 18 reactor designs" or a different reactor.</div>`;
    drillStack = [];
    document.getElementById('hint').classList.add('hidden');
    return;
  }

  drillStack = [{ level:'site', name:`Zone ${zoneId} — ${info.label}`, data:site, zoneId }];
  openDrillPanel();
  renderDrillContent();
  renderBreadcrumb();
  document.getElementById('hint').classList.add('hidden');
}

function showTooltip(e, zoneId) {
  const info = ZONE_INFO[zoneId];
  if (!info) return;
  const site = ACTIVE_TREE.find(s => s.name === info.site);
  const locs  = site ? site.locations.length : 0;
  const comps = site ? site.locations.reduce((a,l)=>a+l.systems.reduce((b,s)=>b+s.components.length,0),0) : 0;
  document.getElementById('tt-zone').textContent  = `Zone ${zoneId}`;
  document.getElementById('tt-zone').style.color  = info.color;
  document.getElementById('tt-title').textContent = info.label;
  document.getElementById('tt-sub').textContent   = `${locs} locations · ${comps} components`;
  document.getElementById('tooltip').style.display = 'block';
  moveTooltip(e);
}
function hideTooltip() { document.getElementById('tooltip').style.display = 'none'; }
function moveTooltip(e) {
  const tt = document.getElementById('tooltip');
  const x = e.clientX + 14, y = e.clientY - 10;
  tt.style.left = (x + 220 > window.innerWidth ? x - 240 : x) + 'px';
  tt.style.top  = (y + 100 > window.innerHeight ? y - 110 : y) + 'px';
}
document.addEventListener('mousemove', e => {
  // Guarded: this listener is registered as soon as the script loads (every
  // Frankie page view), but #tooltip only exists once the drawer has been
  // opened at least once — see injectDrawer().
  const ttEl = document.getElementById('tooltip');
  if (ttEl && ttEl.style.display === 'block') moveTooltip(e);
});

// ── Drill panel ──
function openDrillPanel()  { document.getElementById('drill-panel').classList.add('open'); }
function closeDrillPanel() {
  document.getElementById('drill-panel').classList.remove('open');
  drillStack = [];
  if (activeZone) { highlightZone(activeZone, false); activeZone = null; }
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = '';
  drillStack.forEach((item, i) => {
    if (i > 0) { const s=document.createElement('span'); s.className='bc-sep'; s.textContent=' › '; bc.appendChild(s); }
    const el = document.createElement('span');
    if (i === drillStack.length - 1) { el.className='bc-current'; el.textContent=item.name; }
    else { el.className='bc-item'; el.textContent=item.name; el.onclick=()=>{ drillStack=drillStack.slice(0,i+1); renderDrillContent(); renderBreadcrumb(); }; }
    bc.appendChild(el);
  });
}

function renderDrillContent() {
  const content = document.getElementById('drill-content');
  const tMain   = document.getElementById('drill-title-main');
  const tSub    = document.getElementById('drill-title-sub');
  content.innerHTML = '';
  const top = drillStack[drillStack.length - 1];
  if (!top) return;
  tMain.textContent = top.name;

  if (top.level === 'home') { pvRenderHome(top.sel); return; }
  if (top.level === 'building') { pvRenderBuildingLevel(top); return; }

  if (top.level === 'site') {
    tSub.textContent = `${top.data.locations.length} locations`;
    // Render zone intro card if we have info for this zone
    if (top.zoneId && ZONE_INFO[top.zoneId]) {
      const info = ZONE_INFO[top.zoneId];
      const card = document.createElement('div');
      card.className = 'zone-intro-card';

      const header = document.createElement('div'); header.className = 'zone-intro-header';
      header.style.background = info.color + '18';
      header.style.borderBottom = '1px solid ' + info.color + '30';
      const badge = document.createElement('div'); badge.className = 'zone-intro-badge';
      badge.style.background = info.stripeColor; badge.textContent = top.zoneId;
      const titleEl = document.createElement('div'); titleEl.className = 'zone-intro-title';
      titleEl.style.color = info.color; titleEl.textContent = info.label;
      header.appendChild(badge); header.appendChild(titleEl);

      const body = document.createElement('div'); body.className = 'zone-intro-body';
      const introP = document.createElement('p'); introP.className = 'zone-intro-text'; introP.textContent = info.intro;
      const bulletsWrap = document.createElement('div'); bulletsWrap.className = 'zone-intro-bullets';
      info.bullets.forEach(b => {
        const row = document.createElement('div'); row.className = 'zone-intro-bullet';
        const dot = document.createElement('div'); dot.className = 'zone-bullet-dot'; dot.style.background = info.color;
        const span = document.createElement('span'); span.textContent = b;
        row.appendChild(dot); row.appendChild(span);
        bulletsWrap.appendChild(row);
      });
      body.appendChild(introP); body.appendChild(bulletsWrap);

      card.appendChild(header); card.appendChild(body);
      content.appendChild(card);
      const divider = document.createElement('div'); divider.className='zone-intro-divider'; content.appendChild(divider);
      const browseLabel = document.createElement('div'); browseLabel.className='zone-browse-label'; browseLabel.textContent='Explore Systems'; content.appendChild(browseLabel);
    }
    top.data.locations.forEach(loc => {
      const el = drillItem('🏛','di-loc', loc.name, `${loc.systems.length} systems`, loc.systems.length);
      el.onclick = () => { drillStack.push({level:'location',name:loc.name,data:loc}); renderDrillContent(); renderBreadcrumb(); };
      content.appendChild(el);
    });
  } else if (top.level === 'location') {
    tSub.textContent = `${top.data.systems.length} systems`;
    top.data.systems.forEach(sys => {
      const el = drillItem('⚙','di-sys', sys.name, `${sys.components.length} components`, sys.components.length);
      el.onclick = () => { drillStack.push({level:'system',name:sys.name,data:sys}); renderDrillContent(); renderBreadcrumb(); };
      content.appendChild(el);
    });
  } else if (top.level === 'system') {
    tSub.textContent = `${top.data.components.length} components`;
    top.data.components.forEach(comp => {
      const reactorCoverage = new Set(comp.subcomponents.flatMap(s=>s.reactors||[])).size;
      const el = drillItem('🔧','di-comp', comp.name, `${comp.subcomponents.length} sub-components · ${reactorCoverage} reactor design${reactorCoverage!==1?'s':''}`, comp.subcomponents.length);
      el.onclick = () => { drillStack.push({level:'component',name:comp.name,data:comp}); renderDrillContent(); renderBreadcrumb(); };
      content.appendChild(el);
    });
  } else if (top.level === 'component') {
    tSub.textContent = `${top.data.subcomponents.length} sub-components`;
    top.data.subcomponents.forEach(sub => {
      const el = document.createElement('div'); el.className='sub-item';
      const subNameEl = document.createElement('div'); subNameEl.className='sub-name'; subNameEl.textContent=sub.name;
      el.appendChild(subNameEl);
      if (sub.resolvedCap||sub.commodityGroup||sub.category) {
        const catEl = document.createElement('span'); catEl.className='sub-cat';
        catEl.textContent = sub.resolvedCap||sub.commodityGroup||sub.category;
        el.appendChild(catEl);
      }
      if (sub.reactors && sub.reactors.length) {
        const usageDiv = document.createElement('div'); usageDiv.className='sub-reactor-usage';
        if (selectedReactor === 'ALL') {
          const head = document.createElement('div'); head.className='sub-reactor-usage-head';
          head.textContent = `Used in ${sub.reactors.length} reactor design${sub.reactors.length>1?'s':''}`;
          usageDiv.appendChild(head);
          sub.reactors.forEach(r => {
            const chip = document.createElement('span'); chip.className='reactor-chip'; chip.textContent=r;
            usageDiv.appendChild(chip);
          });
        } else {
          const insts = (sub.instances||[]).filter(i=>i.reactor===selectedReactor);
          const qty = insts.reduce((a,i)=>a+(i.qtyBom||0),0);
          const activeChip = document.createElement('span'); activeChip.className='reactor-chip active';
          activeChip.textContent = selectedReactor + (qty ? ' · Qty '+qty : '');
          usageDiv.appendChild(activeChip);
          insts.slice(0,8).forEach(i => {
            const row = document.createElement('div'); row.className='bom-instance';
            const b = document.createElement('b'); b.textContent = i.component||sub.name;
            row.appendChild(b);
            let extra = '';
            if (i.qtyBom) extra += ' × '+i.qtyBom+(i.unitBom?(' '+i.unitBom):'');
            if (i.section) extra += ' · §'+i.section;
            if (extra) row.appendChild(document.createTextNode(extra));
            usageDiv.appendChild(row);
          });
          if (insts.length > 8) {
            const more = document.createElement('div'); more.className='bom-instance-more';
            more.textContent = `+${insts.length-8} more instances`;
            usageDiv.appendChild(more);
          }
        }
        el.appendChild(usageDiv);
      }
      content.appendChild(el);
    });
  }
}

function drillItem(icon, cls, name, meta, count) {
  const el=document.createElement('div'); el.className='drill-item';
  el.innerHTML=`<div class="drill-icon ${cls}">${icon}</div><div class="drill-text"><div class="drill-name">${esc(name)}</div><div class="drill-meta">${esc(meta)}</div></div><span class="drill-count">${count}</span><span class="drill-arrow">›</span>`;
  return el;
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ── View switching ──
function switchView(v) {
  document.querySelectorAll('.view-tab').forEach(t=>t.classList.toggle('active',t.dataset.view===v));
  document.getElementById('schematic-view').style.display = v==='schematic'?'flex':'none';
  const mv=document.getElementById('map-view');
  if(v==='map'){mv.style.display='flex';if(!mapInitialised)initMap();}else mv.style.display='none';
}

// ── Map ──
let pendingMapFilter=null, mapFilters={search:'',customIds:null};
let mapMarkers={}, markerCluster, leafletMap, mapInitialised=false;

function openMapWithCompanies(ids, label) {
  pendingMapFilter={ids,label}; switchView('map'); setTimeout(applyPendingFilter,150);
}
function applyPendingFilter(){
  if(!pendingMapFilter||!mapInitialised)return;
  const{ids,label}=pendingMapFilter; pendingMapFilter=null;
  // Build a set of uppercase names from COMPANY_DICT for these IDs
  const dictNames = new Set(ids.map(id=>{const co=COMPANY_DICT[id];return co?co.name.toUpperCase().trim():null;}).filter(Boolean));
  // Also build postcode set for fallback matching
  const dictPosts = new Set(ids.map(id=>{const co=COMPANY_DICT[id];return co&&co.postcode?co.postcode.toUpperCase().trim():null;}).filter(Boolean));
  // Match against COMPANIES array — try name first, then postcode
  const matchedNames = new Set(COMPANIES.filter(co=>{
    const n = co.name.toUpperCase().trim();
    const p = (co.postcode||'').toUpperCase().trim();
    return dictNames.has(n) || (p && dictPosts.has(p));
  }).map(co=>co.name));
  mapFilters.customIds = matchedNames.size > 0 ? matchedNames : dictNames;
  applyMapFilters();
  const el=document.getElementById('map-active-filter'),txt=document.getElementById('map-active-filter-text');
  el.classList.add('visible'); txt.textContent=`Filtered: ${label}`;
}
function clearMapCapFilter(){
  mapFilters.customIds=null; applyMapFilters();
  document.getElementById('map-active-filter').classList.remove('visible');
}
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
function loadCSS(href){const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.appendChild(l);}

async function initMap(){
  if(mapInitialised)return;
  loadCSS('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
  loadCSS('https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css');
  loadCSS('https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css');
  await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
  await loadScript('https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js');
  leafletMap=L.map('map',{center:[54.5,-2.5],zoom:6,zoomControl:true,attributionControl:false});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(leafletMap);
  L.control.attribution({prefix:'© NuCCoL | © OpenStreetMap'}).addTo(leafletMap);
  markerCluster=L.markerClusterGroup({maxClusterRadius:50,spiderfyOnMaxZoom:true,showCoverageOnHover:false,
    iconCreateFunction(c){const n=c.getChildCount(),sz=n>100?44:n>30?38:32;
      return L.divIcon({html:`<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:#1a6ab4;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${sz>36?13:11}px;font-family:DM Sans,sans-serif;box-shadow:0 2px 8px rgba(26,106,180,.4)">${n}</div>`,className:'',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]});}
  });
  leafletMap.addLayer(markerCluster);
  const icon=L.divIcon({html:`<div style="width:10px;height:10px;border-radius:50%;background:#1a6ab4;border:2px solid #fff;box-shadow:0 1px 4px rgba(26,106,180,.5)"></div>`,className:'',iconSize:[10,10],iconAnchor:[5,5]});
  COMPANIES.forEach(co=>{if(!co.lat||!co.lng)return;const m=L.marker([co.lat,co.lng],{icon});m.bindPopup(makePopup(co),{maxWidth:300});mapMarkers[co.name]=m;});
  markerCluster.addLayers(Object.values(mapMarkers));
  const n=COMPANIES.length.toLocaleString();
  ['stat-total','stat-visible','map-badge-num'].forEach(id=>document.getElementById(id).textContent=n);
  buildResults(COMPANIES.slice(0,200));
  document.getElementById('map-search').addEventListener('input',e=>{mapFilters.search=e.target.value.trim().toLowerCase();applyMapFilters();});
  mapInitialised=true;
  if(pendingMapFilter)applyPendingFilter();
}
function makePopup(co){
  const st=co.sectors.map(s=>`<span class="popup-tag sector">${s}</span>`).join('');
  const f4=co.f4n?'<span class="popup-tag f4n">F4N</span>':'';
  const ct=co.certs.slice(0,4).map(c=>`<span class="popup-tag cert">${c}</span>`).join('');
  const url=co.url?`<a class="popup-url" href="${co.url.startsWith('http')?co.url:'https://'+co.url}" target="_blank">↗ ${co.url}</a>`:'';
  return `<div class="amrc-popup"><div class="popup-name">${co.name}</div><div class="popup-region">${co.region||''} · ${co.postcode}</div>${co.address?`<div class="popup-address">${co.address}</div>`:''}<div class="popup-tags">${f4}${st}</div><div class="popup-tags">${ct}</div>${url}${co.caps.length?`<div class="popup-caps-toggle" onclick="this.nextSibling.style.display=this.nextSibling.style.display==='none'?'block':'none'">▸ ${co.caps.length} capabilities</div><div class="popup-caps" style="display:none">${co.caps.join(' · ')}</div>`:''}</div>`;
}
function mapMatch(co){
  if(mapFilters.customIds&&!mapFilters.customIds.has(co.name))return false;
  if(mapFilters.search){const s=mapFilters.search;if(!co.name.toLowerCase().includes(s)&&!co.postcode.toLowerCase().includes(s)&&!(co.region||'').toLowerCase().includes(s))return false;}
  return true;
}
function applyMapFilters(){
  const vis=COMPANIES.filter(mapMatch);
  markerCluster.clearLayers();
  markerCluster.addLayers(vis.map(co=>mapMarkers[co.name]).filter(Boolean));
  document.getElementById('stat-visible').textContent=vis.length.toLocaleString();
  document.getElementById('map-badge-num').textContent=vis.length.toLocaleString();
  document.getElementById('map-filter-badge').classList.toggle('visible',vis.length<COMPANIES.length);
  buildResults(vis.slice(0,200));
  if(vis.length>0&&mapFilters.customIds){const first=vis.find(c=>mapMarkers[c.name]);if(first)setTimeout(()=>markerCluster.zoomToShowLayer(mapMarkers[first.name]),300);}
}
function buildResults(list){
  const el=document.getElementById('map-results'); el.innerHTML='';
  list.forEach(co=>{
    const c=document.createElement('div'); c.className='map-result-card';
    c.innerHTML=`<div class="map-rc-name">${co.name}</div><div class="map-rc-region">${co.region||'—'} · ${co.postcode}</div><div class="map-rc-tags">${co.f4n?'<span class="map-rc-tag f4n">F4N</span>':''}${co.sectors.slice(0,2).map(s=>`<span class="map-rc-tag sector">${s}</span>`).join('')}</div>`;
    c.addEventListener('click',()=>{document.querySelectorAll('.map-result-card').forEach(r=>r.classList.remove('selected'));c.classList.add('selected');const m=mapMarkers[co.name];if(m)markerCluster.zoomToShowLayer(m,()=>m.openPopup());});
    el.appendChild(c);
  });
  if(list.length===200){const n=document.createElement('div');n.style.cssText='padding:8px;text-align:center;font-size:10px;color:#92a8bc';n.textContent='Showing first 200 — refine search to see more';el.appendChild(n);}
}


// ══════════════════════════════════════════════════════
// CAPABILITY / COMMODITY SEARCH
// ══════════════════════════════════════════════════════

// Build flat searchable index from the tree
// Each entry: { label, type:'cap'|'comm', resolvedCap, matches:[{zoneId, zoneName, site, comp, sub}] }
let SEARCH_INDEX = [];
let activeSearch = null;

function buildSearchIndex() {
  // Collect all unique resolvedCap and commodityGroup values, map them to tree locations
  const capMap  = {};  // resolvedCap  → [{zoneId, site, comp, subName, commodityGroup}]
  const commMap = {};  // commodityGroup → same

  (ACTIVE_TREE || []).forEach(site => {
    // Find which zone this site belongs to
    const zoneId = Object.keys(ZONE_INFO).find(z => ZONE_INFO[z].site === site.name) || null;
    const zoneName = zoneId ? ZONE_INFO[zoneId].label : site.name;

    site.locations.forEach(loc => {
      loc.systems.forEach(sys => {
        sys.components.forEach(comp => {
          comp.subcomponents.forEach(sub => {
            const entry = { zoneId, zoneName, site:site.name, location:loc.name, system:sys.name, comp:comp.name, sub:sub.name, resolvedCap:sub.resolvedCap||'', commodityGroup:sub.commodityGroup||'' };

            if (sub.resolvedCap) {
              if (!capMap[sub.resolvedCap]) capMap[sub.resolvedCap] = [];
              capMap[sub.resolvedCap].push(entry);
            }
            if (sub.commodityGroup) {
              if (!commMap[sub.commodityGroup]) commMap[sub.commodityGroup] = [];
              commMap[sub.commodityGroup].push(entry);
            }
          });
        });
      });
    });
  });

  // Build index entries
  const index = [];
  Object.entries(capMap).forEach(([label, matches]) => {
    index.push({ label, type:'cap', matches });
  });
  Object.entries(commMap).forEach(([label, matches]) => {
    // Only add if not already a capability
    if (!capMap[label]) index.push({ label, type:'comm', matches });
  });

  // Sort alphabetically
  index.sort((a,b) => a.label.localeCompare(b.label));
  SEARCH_INDEX = index;
}

function initCapSearch() {
  buildSearchIndex();

  const input   = document.getElementById('cap-search-input');
  const dropdown= document.getElementById('cap-dropdown');
  const clearBtn= document.getElementById('cap-search-clear');
  const findBtn = document.getElementById('cap-search-btn');
  let focusedIdx = -1;
  let ddItems    = [];
  let currentMatches = [];

  function showDropdown(query) {
    const q = query.trim().toLowerCase();
    dropdown.innerHTML = '';
    ddItems = [];
    focusedIdx = -1;
    if (!q) { dropdown.classList.remove('visible'); return; }

    const caps  = SEARCH_INDEX.filter(e => e.type==='cap'  && e.label.toLowerCase().includes(q));
    const comms = SEARCH_INDEX.filter(e => e.type==='comm' && e.label.toLowerCase().includes(q));

    if (!caps.length && !comms.length) {
      dropdown.innerHTML = '<div class="cap-dd-none">No matches found</div>';
      dropdown.classList.add('visible');
      return;
    }

    const addSection = (items, typeLabel) => {
      if (!items.length) return;
      const sec = document.createElement('div'); sec.className='cap-dd-section';
      const lbl = document.createElement('div'); lbl.className='cap-dd-section-label';
      lbl.textContent = typeLabel; sec.appendChild(lbl);
      items.slice(0,12).forEach(item => {
        const el = document.createElement('div'); el.className='cap-dd-item';
        el.innerHTML=`<span class="cap-dd-type ${item.type}">${item.type==='cap'?'Capability':'Commodity'}</span><span>${esc(item.label)}</span>`;
        el.addEventListener('click', () => { input.value=item.label; dropdown.classList.remove('visible'); clearBtn.classList.add('visible'); runSearch(item.label); });
        sec.appendChild(el);
        ddItems.push(el);
      });
      dropdown.appendChild(sec);
    };

    addSection(caps,  'Capabilities');
    addSection(comms, 'Commodity Groups');
    dropdown.classList.add('visible');
  }

  function runSearch(query) {
    const q = query.trim().toLowerCase();
    if (!q) { clearSearch(); return; }

    // Find all matching index entries
    const matched = SEARCH_INDEX.filter(e => e.label.toLowerCase().includes(q));
    if (!matched.length) { clearSearch(); return; }

    // Flatten all match entries, deduplicated by zone+comp+sub
    const seen = new Set();
    const allEntries = [];
    matched.forEach(m => {
      m.matches.forEach(entry => {
        const key = `${entry.zoneId}|${entry.comp}|${entry.sub}`;
        if (!seen.has(key)) { seen.add(key); allEntries.push({...entry, matchLabel:m.label, matchType:m.type}); }
      });
    });

    activeSearch = { query, entries: allEntries };
    showSearchResults(allEntries);
    highlightMatchingZones(allEntries);
    dropdown.classList.remove('visible');
  }

  function showSearchResults(entries) {
    // Group by zone
    const byZone = {};
    entries.forEach(e => {
      const key = e.zoneId || e.site;
      if (!byZone[key]) byZone[key] = { zoneId:e.zoneId, zoneName:e.zoneName, entries:[] };
      byZone[key].entries.push(e);
    });

    // Open drill panel with search results
    openDrillPanel();
    document.getElementById('hint').classList.add('hidden');
    document.getElementById('drill-title-main').textContent = 'Search Results';
    document.getElementById('drill-title-sub').textContent  = `${entries.length} matches across ${Object.keys(byZone).length} zone${Object.keys(byZone).length>1?'s':''}`;
    document.getElementById('drill-stripe').style.background = 'var(--accent)';

    // Breadcrumb
    const bc = document.getElementById('breadcrumb');
    bc.innerHTML = '';
    const label = document.createElement('span'); label.className='bc-current';
    label.textContent = `🔍 "${activeSearch.query}"`; bc.appendChild(label);

    const content = document.getElementById('drill-content');
    content.innerHTML = '';

    // Intro
    const intro = document.createElement('div'); intro.className='search-results-intro';
    intro.textContent = `Found ${entries.length} component${entries.length>1?'s':''} where you could supply — click a zone to explore, or click a component to drill in.`;
    content.appendChild(intro);

    // Zone with most matches opens by default
    const topZoneKey = Object.keys(byZone).sort((a,b) => byZone[b].entries.length - byZone[a].entries.length)[0];

    Object.entries(byZone).sort((a,b) => b[1].entries.length - a[1].entries.length).forEach(([key, zone]) => {
      const info = zone.zoneId ? ZONE_INFO[zone.zoneId] : null;
      const color = info ? info.stripeColor : 'var(--accent)';
      const isTop = key === topZoneKey;

      const group = document.createElement('div'); group.className='search-zone-group';

      const header = document.createElement('div'); header.className='search-zone-header';
      const hBadge = document.createElement('div'); hBadge.className='search-zone-badge';
      hBadge.style.background = color; hBadge.textContent = zone.zoneId || '?';
      const hName = document.createElement('div'); hName.className='search-zone-name'; hName.textContent = zone.zoneName;
      const hCount = document.createElement('div'); hCount.className='search-zone-count';
      hCount.textContent = `${zone.entries.length} match${zone.entries.length>1?'es':''}`;
      const hChevron = document.createElement('div'); hChevron.className='search-zone-chevron' + (isTop?' open':'');
      hChevron.textContent = '›';
      header.appendChild(hBadge); header.appendChild(hName); header.appendChild(hCount); header.appendChild(hChevron);

      const items = document.createElement('div'); items.className='search-zone-items' + (isTop?' open':'');

      // Group items by component
      const byComp = {};
      zone.entries.forEach(e => {
        if (!byComp[e.comp]) byComp[e.comp] = [];
        byComp[e.comp].push(e);
      });

      Object.entries(byComp).forEach(([compName, compEntries]) => {
        const item = document.createElement('div'); item.className='search-result-item';
        const subNames = [...new Set(compEntries.map(e=>e.sub))].slice(0,3);
        const moreSubs = compEntries.length > 3 ? ` +${compEntries.length-3} more` : '';
        const caps = [...new Set(compEntries.map(e=>e.matchLabel))].slice(0,2);
        item.innerHTML=`<div class="search-result-comp">${esc(compName)}</div>
          <div class="search-result-sub">${esc(subNames.join(', '))}${moreSubs}</div>
          ${caps.map(c=>`<span class="search-result-cap">${esc(c)}</span>`).join(' ')}`;
        item.addEventListener('click', () => {
          // Navigate into the tree at this zone > system > component
          const e0 = compEntries[0];
          const site = ACTIVE_TREE.find(s=>s.name===e0.site);
          if (!site) return;
          clearZoneHighlights();
          if (zone.zoneId) { highlightZone(zone.zoneId, true); activeZone=zone.zoneId; }
          const loc = site.locations.find(l=>l.name===e0.location);
          const sys = loc?.systems.find(s=>s.name===e0.system);
          const comp = sys?.components.find(c=>c.name===e0.comp);
          if (!comp) return;
          drillStack = [
            {level:'site',     name:`Zone ${zone.zoneId} — ${zone.zoneName}`, data:site, zoneId:zone.zoneId},
            {level:'location', name:e0.location, data:loc},
            {level:'system',   name:e0.system,   data:sys},
            {level:'component',name:compName,     data:comp},
          ];
          document.getElementById('drill-stripe').style.background = color;
          renderDrillContent(); renderBreadcrumb();
        });
        items.appendChild(item);
      });

      header.addEventListener('click', () => {
        const isOpen = items.classList.contains('open');
        items.classList.toggle('open', !isOpen);
        header.querySelector('.search-zone-chevron').classList.toggle('open', !isOpen);
        if (!isOpen && zone.zoneId) {
          clearZoneHighlights();
          highlightMatchingZones(zone.entries);
        }
      });

      group.appendChild(header); group.appendChild(items);
      content.appendChild(group);
    });

    // Clear search button
    const clearBtn2 = document.createElement('button'); clearBtn2.className='search-clear-btn';
    clearBtn2.textContent = '✕ Clear search'; clearBtn2.onclick = clearSearch;
    content.appendChild(clearBtn2);
  }

  function highlightMatchingZones(entries) {
    clearZoneHighlights();
    // Count matches per zone
    const counts = {};
    entries.forEach(e => { if(e.zoneId) counts[e.zoneId] = (counts[e.zoneId]||0) + 1; });

    Object.entries(counts).forEach(([zoneId, count]) => {
      // Glow the polygon
      const poly = document.querySelector(`#zone-svg polygon[data-zone="${zoneId}"]`);
      if (poly) poly.classList.add('active');

      // Add pulsing badge + count
      const badge = document.querySelector(`.z-badge[data-zone="${zoneId}"]`);
      if (badge) {
        badge.classList.add('match-glow');
        // Add count bubble if >1
        let countEl = badge.querySelector('.match-count');
        if (!countEl) { countEl = document.createElement('div'); countEl.className='match-count'; badge.appendChild(countEl); }
        countEl.textContent = count;
      }
    });

    // Auto-open panel for top zone
    const topZone = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    if (topZone) {
      if (activeZone !== topZone[0]) {
        const poly = document.querySelector(`#zone-svg polygon[data-zone="${topZone[0]}"]`);
        if (poly) poly.classList.add('active');
      }
    }
  }

  function clearZoneHighlights() {
    document.querySelectorAll('#zone-svg polygon').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.z-badge').forEach(b => {
      b.classList.remove('match-glow');
      const c = b.querySelector('.match-count'); if (c) c.remove();
    });
  }

  function clearSearch() {
    input.value = '';
    clearBtn.classList.remove('visible');
    dropdown.classList.remove('visible');
    activeSearch = null;
    clearZoneHighlights();
    closeDrillPanel();
  }

  // Wire up events
  input.addEventListener('input', e => {
    clearBtn.classList.toggle('visible', e.target.value.length > 0);
    showDropdown(e.target.value);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { focusedIdx=Math.min(focusedIdx+1,ddItems.length-1); ddItems.forEach((el,i)=>el.classList.toggle('focused',i===focusedIdx)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { focusedIdx=Math.max(focusedIdx-1,0); ddItems.forEach((el,i)=>el.classList.toggle('focused',i===focusedIdx)); e.preventDefault(); }
    else if (e.key === 'Enter') { if(focusedIdx>=0&&ddItems[focusedIdx]){ddItems[focusedIdx].click();}else{runSearch(input.value);} dropdown.classList.remove('visible'); }
    else if (e.key === 'Escape') { dropdown.classList.remove('visible'); input.blur(); }
  });

  findBtn.addEventListener('click', () => { runSearch(input.value); });
  clearBtn.addEventListener('click', clearSearch);

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    if (!document.getElementById('cap-search-wrap').contains(e.target)) dropdown.classList.remove('visible');
  });
}

  // NOTE: the original standalone file wired init here via
  // window.addEventListener('load', ...). That doesn't apply in a lazily-
  // injected drawer (this DOM doesn't exist at page-load time) — the
  // equivalent wiring (initZones/initCapSearch/reactor-select) happens in
  // injectDrawer() above instead, and 'loading' is hidden in open() below.

  // ── Public API ────────────────────────────────────────────────────────────
  async function open() {
    injectDrawer();

    const drawer = document.getElementById('plant-explorer-drawer');
    drawer.classList.remove('pe-drawer--closed');
    drawer.classList.add('pe-drawer--open');

    if (!dataLoaded) {
      const loadingEl = document.getElementById('loading');
      try {
        const res = await fetch(DATA_FILE, { headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const data = await res.json();
        PLANT_TREE = data.plant_tree || data;
        ACTIVE_TREE = PLANT_TREE;
        dataLoaded = true;
        buildSearchIndex();
      } catch (e) {
        console.error('[PlantExplorerDrawer] Failed to load plant data:', e);
        const hintEl = document.getElementById('hint');
        if (hintEl) hintEl.textContent = '⚠ Could not load plant data — ' + e.message;
      }
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  function close() {
    const drawer = document.getElementById('plant-explorer-drawer');
    if (drawer) {
      drawer.classList.remove('pe-drawer--open');
      drawer.classList.add('pe-drawer--closed');
    }
  }

  window.PlantExplorerDrawer = { open, close };

}());
