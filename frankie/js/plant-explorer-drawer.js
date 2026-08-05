// ── Frankie Plant Explorer Drawer  v1.0 ───────────────────────────────────────
// Full Tool Kit version of NuCCoL's Plant Explorer: interactive zone map,
// capability/commodity search, and a component drill-down tree, filterable
// by reactor design. Ported 2026-08-03 from the standalone
// NuCCoL_Plant_Explorer_v2_images.html.
//
// What's different from the standalone file:
//  - The supplier/company map feature (COMPANY_DICT, COMPANIES, Leaflet,
//    "view on map" buttons/chips) has been removed entirely, per request.
//  - Tree data (2026-08-04 update): originally fetched from the SAME gated
//    Worker endpoint the chat-triggered PlantDrawer uses
//    (kb/plant_tree_data.json), on the theory of "one source of truth". That
//    endpoint turned out to be the OLDER generic DSE taxonomy with no
//    per-reactor BOM mapping at all (0 of 4466 subcomponents had a reactors[]
//    field — confirmed via PlantExplorerDrawer.debug()), so every specific-
//    reactor selection silently showed zero components. Switched to a static
//    JSON export of the standalone tool's own baked-in PLANT_TREE
//    (images/plant-explorer/plant_tree_v2.json, ~12MB, 8361 subcomponents,
//    100% with real reactors[]/instances[] data across all 18 designs) so
//    Plant Explorer matches the standalone "sliced version" tool exactly.
//    This does mean Plant Explorer's tree can drift from the chat's
//    PlantDrawer tree (kb/plant_tree_data.json) until the live KB is
//    rebuilt with the v2 schema — see project_frankie_plant_explorer_v2
//    memory. No auth token needed for this fetch (same-origin static file,
//    already behind Frankie's page-level auth gate).
//  - All inline style="..." attributes and .style.cssText assignments were
//    converted to CSS classes / per-property JS style sets, since Frankie's
//    CSP (style-src) has no 'unsafe-inline' — see css/plant-explorer.css.
//  - Layer 2 (per-reactor cutaway diagrams with building callouts —
//    PLANT_VIEWS/PLANT_INFO/PV_IMG/PV_CALLOUTS) was added 2026-08-04, using
//    the pv/*.jpeg images extracted alongside plant_tree_v2.json.
//
// Usage:
//   PlantExplorerDrawer.open()
//   PlantExplorerDrawer.close()

(function () {
  'use strict';

  // Static asset, same-origin, resolved against <base href="/frankie/">.
  // No Bearer token needed — see header comment above for why this no
  // longer goes through the gated Worker endpoint.
  const DATA_FILE = 'images/plant-explorer/plant_tree_v2.json';

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
        <button id="pv-fullbtn">↺ Full plant view</button>
        <button id="pv-reopen">ℹ Plant panel</button>
        <div id="pv-callout-legend"></div>

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

    window.DrawerSplashKit && window.DrawerSplashKit.attach(el, {
      key: 'plantExplorer',
      icon: '🏭',
      eyebrow: 'Reference',
      title: 'Plant Explorer',
      description: 'Explore any of 18 nuclear reactor designs building by building, right down to individual components — 8,000+ mapped subcomponents, cutaway diagrams included.',
      checklist: ['18 reactor designs, fully mapped', 'Zone map and per-reactor cutaways', 'Drill from building to component'],
      art: '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="35" y="90" width="130" height="80" rx="4" fill="#f7fbff" stroke="#26a9d8" stroke-width="3"/>' +
        '<rect x="55" y="105" width="24" height="24" fill="#d8e2ec"/><rect x="88" y="105" width="24" height="24" fill="#d8e2ec"/><rect x="121" y="105" width="24" height="24" fill="#d8e2ec"/>' +
        '<path d="M85 90V55a15 15 0 0 1 30 0v35" fill="none" stroke="#10243a" stroke-width="6"/>' +
        '<rect x="55" y="168" width="90" height="20" rx="10" fill="#10243a"/>' +
        '<circle cx="72" cy="178" r="5" fill="#26a9d8"/><rect x="85" y="174" width="50" height="7" rx="3" fill="rgba(255,255,255,.3)"/>' +
        '</svg>',
    });

    document.getElementById('peDrawerClose').addEventListener('click', close);
    document.getElementById('peDrawerBackdrop').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('pe-drawer--open')) close(); });

    // Former inline onclick="" attributes, now wired here
    document.getElementById('pe-schematic-tab')?.addEventListener('click', () => switchView('schematic'));
    document.getElementById('drill-close')?.addEventListener('click', closeDrillPanel);
    // Layer 2 controls (former inline onclick="" in the standalone source)
    document.getElementById('pv-fullbtn')?.addEventListener('click', () => pvRestoreFull());
    document.getElementById('pv-reopen')?.addEventListener('click', () => pvShowHome(pvSel));

    // Capture the pristine layer-1 zone-map DOM (image src, SVG polygons, badges) so
    // pvApplyView()/pvRestoreOriginal() can restore it when the reactor filter is set
    // back to "All 18 designs" after viewing a specific reactor's cutaway diagrams.
    const origWrapper = document.getElementById('plant-wrapper');
    const origSvg = document.getElementById('zone-svg');
    PV_ORIG = {
      img: document.getElementById('plant-img').src,
      vb: origSvg.getAttribute('viewBox'),
      svg: origSvg.innerHTML,
      badges: Array.from(origWrapper.querySelectorAll('.z-badge')).map(b => b.outerHTML).join('')
    };

    initZones();
    initCapSearch();
    const reactorSelect = document.getElementById('reactor-select');
    if (reactorSelect) reactorSelect.addEventListener('change', e => setReactorFilter(e.target.value));
  }

  // ── Ported Plant Explorer logic (zone map, drill panel, capability search) ──

let PLANT_TREE = null;

// ── Layer 2: per-reactor cutaway diagrams + building callouts ──
// Ported 2026-08-04 from the same standalone NuCCoL_Plant_Explorer_v2_images.html
// source as layer 1. Images referenced via PV_IMG live under images/plant-explorer/pv/
// (already extracted — see manifest.json). Activates automatically whenever a specific
// reactor design is chosen in the reactor-select dropdown (see setReactorFilter wrap
// below); selecting "All 18 designs" keeps the original layer-1 zone map.
const PLANT_VIEWS = {"AP1000": {"fullSlice": "ap1000_full_slice", "w": 1408, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "ap1000_containment", "color": "#3fa46b", "points": "505,588 498,462 505,352 548,208 605,120 656,72 715,104 776,200 810,350 814,462 800,562 700,602 600,602", "badge": [0.465, 0.436]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "ap1000_auxiliary", "color": "#1a9edd", "points": "758,602 756,470 762,350 825,320 825,208 986,214 986,332 930,346 930,588 850,610", "badge": [0.609, 0.589]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "ap1000_turbine_hall", "color": "#1a6ab4", "points": "945,602 945,468 950,360 1015,330 1200,320 1378,346 1378,586 1288,626 1050,626", "badge": [0.824, 0.612]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "ap1000_diesel", "color": "#d4a800", "points": "45,560 45,378 130,338 215,350 292,372 292,556 200,600 115,585", "badge": [0.121, 0.602]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "ap1000_radwaste", "color": "#c0563a", "points": "300,548 300,405 358,368 470,378 498,398 498,538 402,575", "badge": [0.283, 0.605]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "350,360 352,300 470,260 548,285 548,352 452,375", "badge": [0.32, 0.41]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1075,360 1080,175 1140,120 1406,120 1406,360 1250,375", "badge": [0.881, 0.345]}]}, "AP600": {"fullSlice": "fullslice_compact_smr", "w": 1408, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_ap600", "color": "#3fa46b", "points": "515,560 510,420 525,300 565,190 615,110 655,70 700,100 750,180 790,300 800,420 795,560 700,600 600,600", "badge": [0.465, 0.456]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "745,600 745,395 770,345 855,325 900,340 940,390 940,590 850,610", "badge": [0.589, 0.612]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "945,590 945,400 1000,365 1200,345 1355,375 1355,595 1250,635 1050,635", "badge": [0.817, 0.651]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "30,565 30,395 95,350 200,350 300,395 300,565 200,610 90,610", "badge": [0.117, 0.625]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "300,565 300,395 355,335 470,330 520,375 520,580 410,608 310,605", "badge": [0.291, 0.612]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "350,350 350,275 410,258 480,258 520,285 520,350 460,365", "badge": [0.309, 0.404]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1000,330 1010,150 1080,95 1360,95 1360,330 1200,350", "badge": [0.838, 0.286]}]}, "AP300": {"fullSlice": "fullslice_compact_smr", "w": 1408, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_ap600", "color": "#3fa46b", "points": "515,560 510,420 525,300 565,190 615,110 655,70 700,100 750,180 790,300 800,420 795,560 700,600 600,600", "badge": [0.465, 0.456]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "745,600 745,395 770,345 855,325 900,340 940,390 940,590 850,610", "badge": [0.589, 0.612]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "945,590 945,400 1000,365 1200,345 1355,375 1355,595 1250,635 1050,635", "badge": [0.817, 0.651]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "30,565 30,395 95,350 200,350 300,395 300,565 200,610 90,610", "badge": [0.117, 0.625]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "300,565 300,395 355,335 470,330 520,375 520,580 410,608 310,605", "badge": [0.291, 0.612]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "350,350 350,275 410,258 480,258 520,285 520,350 460,365", "badge": [0.309, 0.404]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1000,330 1010,150 1080,95 1360,95 1360,330 1200,350", "badge": [0.838, 0.286]}]}, "Holtec International SMR-300": {"fullSlice": "fullslice_compact_smr", "w": 1408, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_ap600", "color": "#3fa46b", "points": "515,560 510,420 525,300 565,190 615,110 655,70 700,100 750,180 790,300 800,420 795,560 700,600 600,600", "badge": [0.465, 0.456]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "745,600 745,395 770,345 855,325 900,340 940,390 940,590 850,610", "badge": [0.589, 0.612]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "945,590 945,400 1000,365 1200,345 1355,375 1355,595 1250,635 1050,635", "badge": [0.817, 0.651]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "30,565 30,395 95,350 200,350 300,395 300,565 200,610 90,610", "badge": [0.117, 0.625]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "300,565 300,395 355,335 470,330 520,375 520,580 410,608 310,605", "badge": [0.291, 0.612]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "350,350 350,275 410,258 480,258 520,285 520,350 460,365", "badge": [0.309, 0.404]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1000,330 1010,150 1080,95 1360,95 1360,330 1200,350", "badge": [0.838, 0.286]}]}, "RR_SMR": {"fullSlice": "fullslice_compact_smr", "w": 1408, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_rr_smr", "color": "#3fa46b", "points": "515,560 510,420 525,300 565,190 615,110 655,70 700,100 750,180 790,300 800,420 795,560 700,600 600,600", "badge": [0.465, 0.456]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "745,600 745,395 770,345 855,325 900,340 940,390 940,590 850,610", "badge": [0.589, 0.612]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "945,590 945,400 1000,365 1200,345 1355,375 1355,595 1250,635 1050,635", "badge": [0.817, 0.651]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "30,565 30,395 95,350 200,350 300,395 300,565 200,610 90,610", "badge": [0.117, 0.625]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "300,565 300,395 355,335 470,330 520,375 520,580 410,608 310,605", "badge": [0.291, 0.612]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "350,350 350,275 410,258 480,258 520,285 520,350 460,365", "badge": [0.309, 0.404]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1000,330 1010,150 1080,95 1360,95 1360,330 1200,350", "badge": [0.838, 0.286]}]}, "BWRX300": {"fullSlice": "fullslice_compact_smr", "w": 1408, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_bwrx300", "color": "#3fa46b", "points": "515,560 510,420 525,300 565,190 615,110 655,70 700,100 750,180 790,300 800,420 795,560 700,600 600,600", "badge": [0.465, 0.456]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "745,600 745,395 770,345 855,325 900,340 940,390 940,590 850,610", "badge": [0.589, 0.612]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "945,590 945,400 1000,365 1200,345 1355,375 1355,595 1250,635 1050,635", "badge": [0.817, 0.651]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "30,565 30,395 95,350 200,350 300,395 300,565 200,610 90,610", "badge": [0.117, 0.625]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "300,565 300,395 355,335 470,330 520,375 520,580 410,608 310,605", "badge": [0.291, 0.612]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "350,350 350,275 410,258 480,258 520,285 520,350 460,365", "badge": [0.309, 0.404]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1000,330 1010,150 1080,95 1360,95 1360,330 1200,350", "badge": [0.838, 0.286]}]}, "UK_EPR": {"fullSlice": "fullslice_epr", "w": 1314, "h": 800, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_epr", "color": "#3fa46b", "points": "495,555 490,420 505,300 545,190 595,110 655,55 715,95 765,175 805,300 815,420 810,555 715,595 570,595", "badge": [0.499, 0.4]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "155,460 155,290 250,220 350,220 350,75 480,75 480,220 485,240 485,460 400,478 260,470", "badge": [0.244, 0.4]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "870,680 870,410 920,365 1150,340 1290,378 1290,700 1180,740 990,740", "badge": [0.822, 0.663]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "30,680 30,510 90,462 250,462 330,510 330,680 250,720 90,720", "badge": [0.137, 0.738]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "680,690 680,545 720,500 830,500 870,545 870,700 830,730 720,730", "badge": [0.59, 0.769]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "870,290 870,215 910,172 1010,172 1060,215 1060,300 1010,320 910,320", "badge": [0.734, 0.306]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1000,330 1010,150 1080,60 1300,60 1300,330 1150,345", "badge": [0.875, 0.244]}]}, "US_EPR": {"fullSlice": "fullslice_epr", "w": 1314, "h": 800, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_epr", "color": "#3fa46b", "points": "495,555 490,420 505,300 545,190 595,110 655,55 715,95 765,175 805,300 815,420 810,555 715,595 570,595", "badge": [0.499, 0.4]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "155,460 155,290 250,220 350,220 350,75 480,75 480,220 485,240 485,460 400,478 260,470", "badge": [0.244, 0.4]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "870,680 870,410 920,365 1150,340 1290,378 1290,700 1180,740 990,740", "badge": [0.822, 0.663]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "30,680 30,510 90,462 250,462 330,510 330,680 250,720 90,720", "badge": [0.137, 0.738]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "680,690 680,545 720,500 830,500 870,545 870,700 830,730 720,730", "badge": [0.59, 0.769]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "870,290 870,215 910,172 1010,172 1060,215 1060,300 1010,320 910,320", "badge": [0.734, 0.306]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1000,330 1010,150 1080,60 1300,60 1300,330 1150,345", "badge": [0.875, 0.244]}]}, "APR1400": {"fullSlice": "fullslice_twinunit_pwr", "w": 1364, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_largeloop_pwr", "color": "#3fa46b", "points": "100,450 95,330 115,220 160,130 225,70 285,50 345,75 390,130 415,220 425,330 415,450 340,460 220,460", "badge": [0.191, 0.352]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "460,405 460,225 520,200 600,200 660,225 680,250 680,420 600,445 500,440", "badge": [0.418, 0.417]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "345,680 345,455 400,405 600,392 825,420 825,610 720,715 460,715", "badge": [0.429, 0.716]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "60,540 60,405 90,372 230,372 260,405 260,555 230,562 90,562", "badge": [0.117, 0.612]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "855,600 855,565 875,555 915,555 935,565 935,610 915,635 875,635", "badge": [0.656, 0.775]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "990,290 990,255 1030,232 1120,232 1160,255 1160,290 1120,305 1030,305", "badge": [0.788, 0.352]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "0,215 0,60 40,15 200,15 250,55 250,190 140,205", "badge": [0.092, 0.15]}]}, "US_APWR": {"fullSlice": "fullslice_twinunit_pwr", "w": 1364, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_largeloop_pwr", "color": "#3fa46b", "points": "100,450 95,330 115,220 160,130 225,70 285,50 345,75 390,130 415,220 425,330 415,450 340,460 220,460", "badge": [0.191, 0.352]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "460,405 460,225 520,200 600,200 660,225 680,250 680,420 600,445 500,440", "badge": [0.418, 0.417]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "345,680 345,455 400,405 600,392 825,420 825,610 720,715 460,715", "badge": [0.429, 0.716]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "60,540 60,405 90,372 230,372 260,405 260,555 230,562 90,562", "badge": [0.117, 0.612]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "855,600 855,565 875,555 915,555 935,565 935,610 915,635 875,635", "badge": [0.656, 0.775]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "990,290 990,255 1030,232 1120,232 1160,255 1160,290 1120,305 1030,305", "badge": [0.788, 0.352]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "0,215 0,60 40,15 200,15 250,55 250,190 140,205", "badge": [0.092, 0.15]}]}, "HPR1000": {"fullSlice": "fullslice_twinunit_pwr", "w": 1364, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_largeloop_pwr", "color": "#3fa46b", "points": "100,450 95,330 115,220 160,130 225,70 285,50 345,75 390,130 415,220 425,330 415,450 340,460 220,460", "badge": [0.191, 0.352]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "460,405 460,225 520,200 600,200 660,225 680,250 680,420 600,445 500,440", "badge": [0.418, 0.417]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "345,680 345,455 400,405 600,392 825,420 825,610 720,715 460,715", "badge": [0.429, 0.716]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "60,540 60,405 90,372 230,372 260,405 260,555 230,562 90,562", "badge": [0.117, 0.612]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "855,600 855,565 875,555 915,555 935,565 935,610 915,635 875,635", "badge": [0.656, 0.775]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "990,290 990,255 1030,232 1120,232 1160,255 1160,290 1120,305 1030,305", "badge": [0.788, 0.352]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "0,215 0,60 40,15 200,15 250,55 250,190 140,205", "badge": [0.092, 0.15]}]}, "NuScale_US460": {"fullSlice": "fullslice_nuscale", "w": 1358, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_nuscale", "color": "#3fa46b", "points": "280,680 280,350 355,155 620,95 880,115 985,170 985,410 920,440 850,680 450,700", "badge": [0.486, 0.494]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "110,430 110,210 205,150 350,113 480,150 480,300 355,352 280,350 200,395", "badge": [0.21, 0.354]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "1005,325 1005,175 1055,140 1170,130 1235,165 1235,320 1150,335 1060,335", "badge": [0.821, 0.313]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "45,485 45,405 75,388 145,388 160,410 160,485 130,495 70,495", "badge": [0.076, 0.578]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "940,605 940,470 965,458 1105,458 1120,470 1120,600 1090,612 970,612", "badge": [0.759, 0.697]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "1040,455 1040,375 1060,358 1155,358 1170,375 1170,455 1140,462 1065,462", "badge": [0.814, 0.537]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1175,405 1180,150 1225,65 1358,65 1358,405 1280,415", "badge": [0.93, 0.327]}]}, "NuScale_VOYGR": {"fullSlice": "fullslice_nuscale", "w": 1358, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_nuscale", "color": "#3fa46b", "points": "280,680 280,350 355,155 620,95 880,115 985,170 985,410 920,440 850,680 450,700", "badge": [0.486, 0.494]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "110,430 110,210 205,150 350,113 480,150 480,300 355,352 280,350 200,395", "badge": [0.21, 0.354]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "1005,325 1005,175 1055,140 1170,130 1235,165 1235,320 1150,335 1060,335", "badge": [0.821, 0.313]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "45,485 45,405 75,388 145,388 160,410 160,485 130,495 70,495", "badge": [0.076, 0.578]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "940,605 940,470 965,458 1105,458 1120,470 1120,600 1090,612 970,612", "badge": [0.759, 0.697]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "1040,455 1040,375 1060,358 1155,358 1170,375 1170,455 1140,462 1065,462", "badge": [0.814, 0.537]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1175,405 1180,150 1225,65 1358,65 1358,405 1280,415", "badge": [0.93, 0.327]}]}, "ABWR": {"fullSlice": "fullslice_bwr", "w": 1408, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_abwr", "color": "#3fa46b", "points": "210,380 950,380 950,650 850,720 400,720 260,650 210,590", "badge": [0.389, 0.761]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "210,380 210,105 280,70 560,55 1000,65 1200,100 1250,140 1250,380 950,395 600,390", "badge": [0.533, 0.271]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "40,565 40,520 70,478 190,478 230,520 230,580 190,598 70,598", "badge": [0.094, 0.706]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "950,395 1250,380 1250,650 1150,720 950,650", "badge": [0.788, 0.728]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "145,405 145,365 175,350 215,350 235,368 235,400 210,410 165,410", "badge": [0.135, 0.498]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1200,330 1205,120 1250,50 1408,50 1408,330 1300,345", "badge": [0.92, 0.266]}]}, "ESBWR": {"fullSlice": "fullslice_bwr", "w": 1408, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_esbwr", "color": "#3fa46b", "points": "210,380 950,380 950,650 850,720 400,720 260,650 210,590", "badge": [0.389, 0.761]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "210,380 210,105 280,70 560,55 1000,65 1200,100 1250,140 1250,380 950,395 600,390", "badge": [0.533, 0.271]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "40,565 40,520 70,478 190,478 230,520 230,580 190,598 70,598", "badge": [0.094, 0.706]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "950,395 1250,380 1250,650 1150,720 950,650", "badge": [0.788, 0.728]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "145,405 145,365 175,350 215,350 235,368 235,400 210,410 165,410", "badge": [0.135, 0.498]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1200,330 1205,120 1250,50 1408,50 1408,330 1300,345", "badge": [0.92, 0.266]}]}, "Candu": {"fullSlice": "fullslice_candu", "w": 1295, "h": 816, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_candu", "color": "#3fa46b", "points": "355,590 350,460 365,340 405,230 460,145 545,85 630,145 685,230 720,340 705,460 690,590 600,625 450,625", "badge": [0.413, 0.459]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "730,300 730,175 770,120 920,120 1000,165 1000,320 920,335 770,335", "badge": [0.66, 0.286]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "700,620 700,400 760,350 1000,325 1270,360 1270,650 1150,700 850,715", "badge": [0.743, 0.631]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "40,440 40,380 65,352 140,352 155,380 155,450 140,460 65,460", "badge": [0.077, 0.502]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "1080,700 1080,665 1110,655 1200,655 1230,675 1230,745 1195,770 1110,760", "badge": [0.891, 0.862]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "950,255 955,110 1000,65 1295,65 1295,255 1150,270", "badge": [0.855, 0.208]}]}, "X Energy": {"fullSlice": "fullslice_htgr", "w": 1308, "h": 816, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_xenergy", "color": "#3fa46b", "points": "45,620 45,60 90,15 620,15 675,55 675,380 600,420 570,780 70,780", "badge": [0.288, 0.426]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "680,420 680,90 720,45 940,45 965,90 965,300 900,330 800,460", "badge": [0.636, 0.273]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "850,560 850,290 900,235 1080,195 1250,230 1250,570 1150,640 950,660", "badge": [0.791, 0.518]}]}, "Terrapower Natrium": {"fullSlice": "fullslice_natrium", "w": 1264, "h": 842, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_natrium", "color": "#3fa46b", "points": "170,570 170,220 240,178 400,172 460,213 548,255 560,400 565,570 555,650 460,800 250,800 170,650", "badge": [0.3, 0.542]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "680,410 680,110 730,65 880,55 1010,95 1010,400 900,415 780,410", "badge": [0.66, 0.291]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "1000,415 1000,290 1050,270 1180,285 1230,320 1230,430 1150,455 1060,450", "badge": [0.88, 0.433]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "45,540 45,420 65,398 140,398 165,420 165,555 140,565 65,565", "badge": [0.082, 0.573]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "755,660 765,585 820,555 900,565 950,590 1010,635 1005,710 940,760 850,775 780,740", "badge": [0.694, 0.781]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1050,270 1055,110 1100,35 1264,35 1264,270 1150,285", "badge": [0.908, 0.199]}]}, "GW": {"fullSlice": "fullslice_generic_gw", "w": 1408, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_generic_gw", "color": "#3fa46b", "points": "550,500 545,380 560,270 600,175 660,110 730,65 795,100 850,175 890,270 900,380 895,500 800,540 650,540", "badge": [0.515, 0.401]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "235,450 235,225 280,180 500,180 565,225 565,500 450,505 300,470", "badge": [0.278, 0.445]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "855,450 855,290 920,225 1100,205 1260,255 1260,455 1150,470 950,460", "badge": [0.741, 0.457]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "1090,610 1090,510 1120,462 1230,462 1260,510 1260,640 1230,650 1120,650", "badge": [0.835, 0.731]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "620,630 620,560 660,522 900,522 940,560 940,650 900,660 660,660", "badge": [0.554, 0.775]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "145,480 145,420 165,398 215,398 235,420 235,495 215,500 165,500", "badge": [0.135, 0.588]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1140,560 1140,320 1170,280 1160,220 1195,195 1250,215 1250,270 1290,290 1330,340 1330,565 1250,570", "badge": [0.874, 0.625]}]}, "SMR": {"fullSlice": "fullslice_generic_smr", "w": 1408, "h": 768, "buildings": [{"id": "1", "label": "Containment", "dse": "Containment Building", "image": "containment_generic_smr", "color": "#3fa46b", "points": "440,650 435,420 450,300 480,220 520,170 560,140 600,120 640,105 700,110 720,150 745,220 760,300 765,420 755,650 660,665 545,665", "badge": [0.434, 0.432]}, {"id": "2", "label": "Auxiliary", "dse": "Auxiliary Building", "image": "generic_auxiliary", "color": "#1a9edd", "points": "225,410 225,270 280,222 460,195 535,235 535,455 460,465 320,435", "badge": [0.27, 0.437]}, {"id": "3", "label": "Turbine Hall", "dse": "Turbine Hall Building", "image": "_shared/generic_turbine_hall", "color": "#1a6ab4", "points": "890,500 890,395 920,352 1080,345 1145,390 1145,495 1080,550 950,560", "badge": [0.719, 0.584]}, {"id": "4", "label": "Diesel Generator", "dse": "Diesel Generator Building", "image": "generic_diesel", "color": "#d4a800", "points": "55,540 55,485 90,463 195,463 230,478 260,510 260,565 220,590 100,585", "badge": [0.116, 0.677]}, {"id": "5", "label": "Radwaste", "dse": "Radwaste Building", "image": "generic_radwaste", "color": "#c0563a", "points": "740,370 740,240 790,190 950,175 1005,215 1005,400 950,415 830,410", "badge": [0.622, 0.393]}, {"id": "6", "label": "Annex", "dse": "Annex Buildings", "image": "generic_annex", "color": "#9166cc", "points": "10,290 10,250 45,232 155,232 195,255 195,315 155,330 45,325", "badge": [0.072, 0.363]}, {"id": "7", "label": "Site & Infrastructure", "dse": "Site & Infrastucture", "image": null, "color": "#7a8a52", "points": "1080,270 1085,180 1110,155 1170,150 1180,175 1230,180 1260,205 1260,260 1220,280 1140,275", "badge": [0.833, 0.277]}]}};
const PV_IMG = {"ap1000_full_slice": "images/plant-explorer/pv/ap1000_full_slice.jpeg", "ap1000_containment": "images/plant-explorer/pv/ap1000_containment.jpeg", "ap1000_auxiliary": "images/plant-explorer/pv/ap1000_auxiliary.jpeg", "ap1000_turbine_hall": "images/plant-explorer/pv/ap1000_turbine_hall.jpeg", "ap1000_diesel": "images/plant-explorer/pv/ap1000_diesel.jpeg", "ap1000_radwaste": "images/plant-explorer/pv/ap1000_radwaste.jpeg", "generic_annex": "images/plant-explorer/pv/generic_annex.jpeg", "generic_site": "images/plant-explorer/pv/generic_site.jpeg", "_shared/generic_turbine_hall": "images/plant-explorer/pv/_shared_generic_turbine_hall.jpeg", "generic_auxiliary": "images/plant-explorer/pv/generic_auxiliary.jpeg", "generic_diesel": "images/plant-explorer/pv/generic_diesel.jpeg", "generic_radwaste": "images/plant-explorer/pv/generic_radwaste.jpeg", "containment_epr": "images/plant-explorer/pv/containment_epr.jpeg", "containment_largeloop_pwr": "images/plant-explorer/pv/containment_largeloop_pwr.jpeg", "containment_nuscale": "images/plant-explorer/pv/containment_nuscale.jpeg", "containment_abwr": "images/plant-explorer/pv/containment_abwr.jpeg", "containment_esbwr": "images/plant-explorer/pv/containment_esbwr.jpeg", "containment_bwrx300": "images/plant-explorer/pv/containment_bwrx300.jpeg", "containment_candu": "images/plant-explorer/pv/containment_candu.jpeg", "containment_rr_smr": "images/plant-explorer/pv/containment_rr_smr.jpeg", "containment_xenergy": "images/plant-explorer/pv/containment_xenergy.jpeg", "containment_ap600": "images/plant-explorer/pv/containment_ap600.jpeg", "containment_natrium": "images/plant-explorer/pv/containment_natrium.jpeg", "containment_generic_gw": "images/plant-explorer/pv/containment_generic_gw.jpeg", "containment_generic_smr": "images/plant-explorer/pv/containment_generic_smr.jpeg", "fullslice_compact_smr": "images/plant-explorer/pv/fullslice_compact_smr.jpeg", "fullslice_epr": "images/plant-explorer/pv/fullslice_epr.jpeg", "fullslice_twinunit_pwr": "images/plant-explorer/pv/fullslice_twinunit_pwr.jpeg", "fullslice_nuscale": "images/plant-explorer/pv/fullslice_nuscale.jpeg", "fullslice_bwr": "images/plant-explorer/pv/fullslice_bwr.jpeg", "fullslice_candu": "images/plant-explorer/pv/fullslice_candu.jpeg", "fullslice_htgr": "images/plant-explorer/pv/fullslice_htgr.jpeg", "fullslice_natrium": "images/plant-explorer/pv/fullslice_natrium.jpeg", "fullslice_generic_gw": "images/plant-explorer/pv/fullslice_generic_gw.jpeg", "fullslice_generic_smr": "images/plant-explorer/pv/fullslice_generic_smr.jpeg"};


const PLANT_INFO = {"AP1000": {"reactor": "AP1000", "full_name": "AP1000", "vendor": "Westinghouse", "type": "PWR (2-loop, passive)", "gross_mwe": "~1110", "coolant": "Light water", "moderator": "Light water", "containment": "Steel containment inside concrete shield building", "status": "Operating (Vogtle 3&4, Sanmen, Haiyang)", "coverage_pct": "85", "bom_rows": "1336", "summary": "Westinghouse's passive-safety PWR: two steam generators, canned reactor coolant pumps, and a passive containment cooling tank atop the shield building. The reference large PWR of the fleet."}, "AP600": {"reactor": "AP600", "full_name": "AP600", "vendor": "Westinghouse", "type": "PWR (2-loop, passive)", "gross_mwe": "~600", "coolant": "Light water", "moderator": "Light water", "containment": "Steel containment inside concrete shield building", "status": "Design certified (not built)", "coverage_pct": "85", "bom_rows": "1053", "summary": "The smaller forerunner of the AP1000 — same passive design language at reduced output. NRC-certified in 1999 but never constructed."}, "AP300": {"reactor": "AP300", "full_name": "AP300 SMR", "vendor": "Westinghouse", "type": "PWR SMR (single-loop)", "gross_mwe": "~300", "coolant": "Light water", "moderator": "Light water", "containment": "Steel containment inside concrete shield building", "status": "Under development", "coverage_pct": "76", "bom_rows": "51", "summary": "A single-loop small modular scaling of the AP1000, reusing its passive systems and components in a compact single-unit footprint."}, "UK_EPR": {"reactor": "UK_EPR", "full_name": "UK EPR", "vendor": "Framatome / EDF", "type": "PWR (4-loop)", "gross_mwe": "~1630", "coolant": "Light water", "moderator": "Light water", "containment": "Double-wall pre-stressed concrete containment", "status": "Under construction (Hinkley Point C)", "coverage_pct": "79", "bom_rows": "979", "summary": "The UK variant of the EPR: four steam generators, four reactor coolant pumps, a double-wall containment and four independent safeguard trains. Among the largest reactors in the fleet."}, "US_EPR": {"reactor": "US_EPR", "full_name": "US EPR (Evolutionary Power Reactor)", "vendor": "Framatome / Areva", "type": "PWR (4-loop)", "gross_mwe": "~1600", "coolant": "Light water", "moderator": "Light water", "containment": "Double-wall concrete containment", "status": "Design certification (not built)", "coverage_pct": "80", "bom_rows": "1171", "summary": "The US-licensed EPR — same four-loop double-wall design as the UK EPR, adapted to NRC requirements."}, "APR1400": {"reactor": "APR1400", "full_name": "APR1400", "vendor": "KHNP / Doosan", "type": "PWR (2-loop)", "gross_mwe": "~1400", "coolant": "Light water", "moderator": "Light water", "containment": "Pre-stressed concrete containment", "status": "Operating (Shin-Kori, Barakah UAE)", "coverage_pct": "87", "bom_rows": "1771", "summary": "Korea's flagship export PWR: two large steam generators, four reactor coolant pumps, typically built as twin units. Deployed at Barakah in the UAE."}, "US_APWR": {"reactor": "US_APWR", "full_name": "US-APWR", "vendor": "Mitsubishi", "type": "PWR (4-loop)", "gross_mwe": "~1700", "coolant": "Light water", "moderator": "Light water", "containment": "Pre-stressed concrete containment", "status": "Design (not built)", "coverage_pct": "86", "bom_rows": "1527", "summary": "Mitsubishi's Advanced PWR — a very large four-loop design with a neutron reflector and fully digital I&C. One of the highest-output units in the set."}, "HPR1000": {"reactor": "HPR1000", "full_name": "HPR1000 (Hualong One)", "vendor": "CGN / CNNC", "type": "PWR (3-loop)", "gross_mwe": "~1170", "coolant": "Light water", "moderator": "Light water", "containment": "Double-shell containment", "status": "Operating (Fuqing, Karachi)", "coverage_pct": "80", "bom_rows": "492", "summary": "China's export PWR: three steam generators, an active+passive hybrid safety approach and a double-shell containment. Operating in China and Pakistan."}, "ABWR": {"reactor": "ABWR", "full_name": "ABWR (Advanced Boiling Water Reactor)", "vendor": "GE-Hitachi / Toshiba", "type": "BWR", "gross_mwe": "~1350", "coolant": "Light water", "moderator": "Light water", "containment": "Reinforced-concrete containment (RCCV)", "status": "Operating (Kashiwazaki-Kariwa, Taiwan)", "coverage_pct": "89", "bom_rows": "1323", "summary": "The first Gen-III reactor to operate: reactor internal pumps, a monolithic reinforced-concrete containment, and no external dome. Built in Japan and Taiwan."}, "ESBWR": {"reactor": "ESBWR", "full_name": "ESBWR (Economic Simplified BWR)", "vendor": "GE-Hitachi", "type": "BWR (passive)", "gross_mwe": "~1520", "coolant": "Light water", "moderator": "Light water", "containment": "Reinforced-concrete containment", "status": "Design certified (not built)", "coverage_pct": "88", "bom_rows": "1329", "summary": "A fully passive BWR with natural-circulation core (no recirculation pumps) and gravity-driven cooling pools high in a very tall reactor building. NRC-certified."}, "BWRX300": {"reactor": "BWRX300", "full_name": "BWRX-300", "vendor": "GE-Hitachi", "type": "BWR SMR", "gross_mwe": "~300", "coolant": "Light water", "moderator": "Light water", "containment": "Deep below-grade steel containment", "status": "Under construction (Darlington, Canada)", "coverage_pct": "78", "bom_rows": "1423", "summary": "A radically simplified SMR derived from the ESBWR, with the reactor set deep below grade and passive isolation condensers. First unit under construction at Darlington."}, "NuScale_US460": {"reactor": "NuScale_US460", "full_name": "NuScale US460 (VOYGR-6)", "vendor": "NuScale", "type": "Integral PWR SMR", "gross_mwe": "~462", "coolant": "Light water", "moderator": "Light water", "containment": "Individual steel containment per module, in a shared pool", "status": "Under development", "coverage_pct": "90", "bom_rows": "953", "summary": "Six 77 MWe integral PWR modules, each with its steam generator inside the vessel, submerged in a common below-grade water pool. An uprated version of NuScale's certified design."}, "NuScale_VOYGR": {"reactor": "NuScale_VOYGR", "full_name": "NuScale VOYGR", "vendor": "NuScale", "type": "Integral PWR SMR", "gross_mwe": "~77 per module", "coolant": "Light water", "moderator": "Light water", "containment": "Individual steel containment per module, in a shared pool", "status": "Under development", "coverage_pct": "91", "bom_rows": "1353", "summary": "NuScale's modular power-plant product line (VOYGR-4/6/12), built from repeated 77 MWe integral modules in a shared reactor pool."}, "RR_SMR": {"reactor": "RR_SMR", "full_name": "Rolls-Royce SMR", "vendor": "Rolls-Royce", "type": "PWR (3-loop, compact)", "gross_mwe": "~470", "coolant": "Light water", "moderator": "Light water", "containment": "Compact steel-lined containment", "status": "UK GDA in progress", "coverage_pct": "72", "bom_rows": "975", "summary": "A compact, factory-built close-coupled PWR sized for modular delivery to site. Three steam generators in a small containment; progressing through UK generic design assessment."}, "Holtec International SMR-300": {"reactor": "Holtec International SMR-300", "full_name": "Holtec SMR-300", "vendor": "Holtec", "type": "PWR SMR", "gross_mwe": "~300", "coolant": "Light water", "moderator": "Light water", "containment": "Below-grade containment", "status": "Under development", "coverage_pct": "61", "bom_rows": "148", "summary": "A largely below-grade small PWR with a compact above-ground footprint and passive cooling. (Lowest data coverage in the set — still being populated.)"}, "Candu": {"reactor": "Candu", "full_name": "CANDU", "vendor": "AECL / Candu Energy", "type": "PHWR (pressure-tube)", "gross_mwe": "~700", "coolant": "Heavy water", "moderator": "Heavy water", "containment": "Concrete containment + standalone vacuum building", "status": "Operating (Canada and export)", "coverage_pct": "78", "bom_rows": "610", "summary": "A pressurised heavy-water reactor using a horizontal calandria, on-power refuelling via fuelling machines at both ends, and — at multi-unit sites — a distinctive standalone vacuum building. Runs on natural uranium."}, "X Energy": {"reactor": "X Energy", "full_name": "X-energy Xe-100", "vendor": "X-energy", "type": "HTGR (pebble-bed)", "gross_mwe": "~80 per module", "coolant": "Helium", "moderator": "Graphite", "containment": "Reactor building (no classic containment)", "status": "Under development (Seadrift, TX)", "coverage_pct": "100", "bom_rows": "23", "summary": "A high-temperature gas-cooled pebble-bed reactor: TRISO fuel pebbles, helium coolant and a graphite moderator, deployed as a four-pack of slim reactor towers. (Only 23 BOM rows so far — sparse.)"}, "Terrapower Natrium": {"reactor": "Terrapower Natrium", "full_name": "TerraPower Natrium", "vendor": "TerraPower / GE-Hitachi", "type": "Sodium fast reactor + molten-salt storage", "gross_mwe": "~345 (500 peak)", "coolant": "Liquid sodium", "moderator": "None (fast spectrum)", "containment": "Reactor building (pool-type)", "status": "Under construction (Kemmerer, WY)", "coverage_pct": "64", "bom_rows": "258", "summary": "A sodium-cooled fast reactor decoupled from the turbine by a molten-salt thermal store, letting output ramp to ~500 MWe on demand. Distinct reactor building plus a separate energy island with twin salt tanks."}, "Generic_GW_v2": {"reactor": "Generic_GW_v2", "full_name": "Generic Gigawatt Plant (v2)", "vendor": "NuCCoL composite", "type": "Composite large reactor", "gross_mwe": "~1000-1700", "coolant": "—", "moderator": "—", "containment": "Representative large containment + turbine island", "status": "Reference model", "coverage_pct": "100", "bom_rows": "8326", "summary": "A composite gigawatt-class plant built from all 10 large designs. Make-up by component share: APR1400 21%, US_APWR 18%, ESBWR 16%, ABWR 15%, AP1000 15%, US_EPR 13%, AP600 12%, UK_EPR 11%, Candu 7%, HPR1000 5%. PWR-led with strong BWR content.", "mix": [["APR1400", 21], ["US_APWR", 18], ["ESBWR", 16], ["ABWR", 15], ["AP1000", 15], ["US_EPR", 13], ["AP600", 12], ["UK_EPR", 11], ["Candu", 7], ["HPR1000", 5]]}, "Generic_SMR_v2": {"reactor": "Generic_SMR_v2", "full_name": "Generic SMR Plant (v2)", "vendor": "NuCCoL composite", "type": "Composite small modular reactor", "gross_mwe": "~300-500", "coolant": "—", "moderator": "—", "containment": "Representative modular containment", "status": "Reference model", "coverage_pct": "100", "bom_rows": "4267", "summary": "A composite small-modular plant built from all 8 SMR/advanced designs. Make-up by component share: BWRX300 32%, NuScale_VOYGR 30%, NuScale_US460 21%, RR_SMR 20%, Terrapower 6%, Holtec 2%, AP300 1%, X-energy 0%. Dominated by the BWRX-300 and NuScale modules.", "mix": [["BWRX300", 32], ["NuScale_VOYGR", 30], ["NuScale_US460", 21], ["RR_SMR", 20], ["Terrapower", 6], ["Holtec", 2], ["AP300", 1], ["X-energy", 0]]}};
const PV_GW_SET = ["APR1400", "US_APWR", "ESBWR", "ABWR", "AP1000", "US_EPR", "AP600", "UK_EPR", "Candu", "HPR1000"];
const PV_SMR_SET = ["BWRX300", "NuScale_VOYGR", "NuScale_US460", "RR_SMR", "Terrapower Natrium", "Holtec International SMR-300", "AP300", "X Energy"];
const PV_CALLOUTS = {"ap1000_containment": {"w": 1408, "h": 768, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor pressure vessel", "ax": 700, "ay": 560, "lx": 590, "ly": 716, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Steam generator (1 of 2)", "ax": 662, "ay": 385, "lx": 150, "ly": 360, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 3, "label": "Steam generator (2 of 2)", "ax": 835, "ay": 415, "lx": 1215, "ly": 470, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 4, "label": "Pressuriser", "ax": 775, "ay": 430, "lx": 1230, "ly": 350, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 5, "label": "Reactor coolant pumps", "ax": 740, "ay": 505, "lx": 1200, "ly": 610, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}, {"n": 6, "label": "Polar crane", "ax": 645, "ay": 175, "lx": 205, "ly": 150, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 7, "label": "Primary loop piping", "ax": 700, "ay": 282, "lx": 150, "ly": 252, "sys": "Reactor Coolant Systems"}, {"n": 8, "label": "In-containment water tank (IRWST)", "ax": 808, "ay": 182, "lx": 1230, "ly": 232, "sys": "Mechanical Equipment", "comp": "Storage and Holding Tanks"}, {"n": 9, "label": "Refuelling cavity / pool", "ax": 520, "ay": 565, "lx": 430, "ly": 716, "sys": "Primary Containment", "comp": "Refuelling Equipment"}]}, "ap1000_turbine_hall": {"w": 1408, "h": 768, "title": "Turbine Hall \u2014 key equipment", "items": [{"n": 1, "label": "Main turbine", "ax": 662, "ay": 323, "lx": 140, "ly": 250, "sys": "Secondary Steam Cycle", "comp": "Main Turbine"}, {"n": 2, "label": "Main generator", "ax": 930, "ay": 338, "lx": 1290, "ly": 300, "sys": "Secondary Steam Cycle", "comp": "Main Generator"}, {"n": 3, "label": "Main condenser", "ax": 732, "ay": 422, "lx": 700, "ly": 730, "sys": "Secondary Steam Cycle", "comp": "Main Condenser"}, {"n": 4, "label": "Moisture separator-reheater", "ax": 563, "ay": 269, "lx": 140, "ly": 150, "sys": "Secondary Steam Cycle", "comp": "Moisture Separator-Reheater"}, {"n": 5, "label": "Feed pumps", "ax": 591, "ay": 522, "lx": 480, "ly": 730, "sys": "Secondary Steam Cycle", "comp": "Feed Pumps"}, {"n": 6, "label": "Condensate pumps", "ax": 774, "ay": 553, "lx": 900, "ly": 730, "sys": "Mechanical Equipment", "comp": "Pumps"}, {"n": 7, "label": "Feedwater heaters (vertical)", "ax": 300, "ay": 400, "lx": 150, "ly": 380, "sys": "Mechanical Equipment", "comp": "Vertical Heat Exchangers"}, {"n": 8, "label": "Control panels", "ax": 1185, "ay": 363, "lx": 1300, "ly": 420, "sys": "BOP Support Systems", "comp": "Control Panels"}]}, "ap1000_auxiliary": {"w": 1408, "h": 768, "title": "Auxiliary Building \u2014 key equipment", "items": [{"n": 1, "label": "Battery racks", "ax": 390, "ay": 175, "lx": 150, "ly": 150, "sys": "Electrical Equipment", "comp": "Batteries"}, {"n": 2, "label": "HVAC ductwork", "ax": 950, "ay": 190, "lx": 1300, "ly": 150, "sys": "BOP Support Systems", "comp": "Heating and Ventilation"}, {"n": 3, "label": "Control panels / switchgear", "ax": 820, "ay": 305, "lx": 1300, "ly": 280, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 4, "label": "Switchgear cabinet", "ax": 1195, "ay": 330, "lx": 1300, "ly": 400, "sys": "Electrical Equipment", "comp": "Switchgear"}, {"n": 5, "label": "Vertical heat exchangers", "ax": 290, "ay": 412, "lx": 150, "ly": 250, "sys": "Mechanical Equipment", "comp": "Vertical Heat Exchangers"}, {"n": 6, "label": "Horizontal heat exchangers", "ax": 780, "ay": 432, "lx": 700, "ly": 730, "sys": "Mechanical Equipment", "comp": "Horizontal Heat Exchangers"}, {"n": 7, "label": "Storage tank", "ax": 870, "ay": 600, "lx": 900, "ly": 730, "sys": "Mechanical Equipment", "comp": "Storage and Holding Tanks"}, {"n": 8, "label": "Pumps", "ax": 650, "ay": 520, "lx": 480, "ly": 730, "sys": "Mechanical Equipment", "comp": "Pumps"}]}, "ap1000_diesel": {"w": 1408, "h": 768, "title": "Diesel Generator Building \u2014 key equipment", "items": [{"n": 1, "label": "Emergency diesel generator (train A)", "ax": 550, "ay": 400, "lx": 140, "ly": 270, "sys": "BOP Island Structural", "comp": "Emergency Diesel Generator Structure"}, {"n": 2, "label": "Emergency diesel generator (train B)", "ax": 870, "ay": 415, "lx": 1300, "ly": 300, "sys": "BOP Island Structural", "comp": "Emergency Diesel Generator Structure"}, {"n": 3, "label": "Exhaust silencer", "ax": 635, "ay": 225, "lx": 140, "ly": 150, "sys": "BOP Island Structural", "comp": "Emergency Diesel Generator Structure"}, {"n": 4, "label": "Exhaust stack", "ax": 723, "ay": 90, "lx": 1300, "ly": 150, "sys": "BOP Island Structural", "comp": "Emergency Diesel Generator Structure"}, {"n": 5, "label": "Fuel oil day tank", "ax": 335, "ay": 285, "lx": 480, "ly": 735, "sys": "Circulating Water Cycle", "comp": "Tanks"}, {"n": 6, "label": "HVAC louvre", "ax": 380, "ay": 205, "lx": 140, "ly": 370, "sys": "BOP Support Systems", "comp": "Heating and Ventilation"}, {"n": 7, "label": "Control panel", "ax": 785, "ay": 385, "lx": 1300, "ly": 450, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 8, "label": "Cooling water pump skid", "ax": 1040, "ay": 600, "lx": 900, "ly": 735, "sys": "Mechanical Equipment", "comp": "Containment Cooling Systems"}]}, "ap1000_radwaste": {"w": 1408, "h": 768, "title": "Radwaste Building \u2014 key equipment", "items": [{"n": 1, "label": "Waste drum storage", "ax": 953, "ay": 380, "lx": 1300, "ly": 390, "sys": "Unclassified System"}, {"n": 2, "label": "Vertical process vessels", "ax": 650, "ay": 210, "lx": 150, "ly": 150, "sys": "Mechanical Equipment", "comp": "Vertical Heat Exchangers"}, {"n": 3, "label": "Air-cooled heat exchanger", "ax": 763, "ay": 230, "lx": 1300, "ly": 270, "sys": "Mechanical Equipment", "comp": "Horizontal Heat Exchangers"}, {"n": 4, "label": "Effluent vent stack", "ax": 1155, "ay": 150, "lx": 1300, "ly": 150, "sys": "Circulating Water Cycle", "comp": "Environmental Monitoring"}, {"n": 5, "label": "Process tank", "ax": 670, "ay": 535, "lx": 480, "ly": 735, "sys": "Circulating Water Cycle", "comp": "Tanks"}, {"n": 6, "label": "Storage tank", "ax": 800, "ay": 550, "lx": 660, "ly": 735, "sys": "Mechanical Equipment", "comp": "Storage and Holding Tanks"}, {"n": 7, "label": "Valve manifold", "ax": 735, "ay": 575, "lx": 840, "ly": 735, "sys": "Mechanical Equipment", "comp": "Valves"}, {"n": 8, "label": "Transfer pumps", "ax": 970, "ay": 635, "lx": 1020, "ly": 735, "sys": "Mechanical Equipment", "comp": "Pumps"}]}, "generic_annex": {"w": 1408, "h": 768, "title": "Annex Building \u2014 key spaces", "items": [{"n": 1, "label": "Main control room console", "ax": 550, "ay": 450, "lx": 550, "ly": 745, "sys": "Instrumentation & Controls Equipment", "comp": "Simulator"}, {"n": 2, "label": "Switchgear cabinets", "ax": 1000, "ay": 430, "lx": 1370, "ly": 430, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 3, "label": "Relay / control cabinets", "ax": 1050, "ay": 300, "lx": 1370, "ly": 270, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 4, "label": "Battery / server racks", "ax": 270, "ay": 610, "lx": 1370, "ly": 610, "sys": "Unclassified System"}, {"n": 5, "label": "Cable tray runs", "ax": 350, "ay": 300, "lx": 40, "ly": 300, "sys": "Unclassified System"}, {"n": 6, "label": "HVAC ductwork", "ax": 1000, "ay": 190, "lx": 1370, "ly": 150, "sys": "Unclassified System"}, {"n": 7, "label": "Office workstations", "ax": 250, "ay": 190, "lx": 40, "ly": 150, "sys": "Unclassified System"}]}, "_shared/generic_turbine_hall": {"w": 1408, "h": 768, "title": "Turbine Hall \u2014 key equipment", "items": [{"n": 1, "label": "Main turbine", "ax": 680, "ay": 325, "lx": 140, "ly": 250, "sys": "Secondary Steam Cycle", "comp": "Main Turbine"}, {"n": 2, "label": "Main generator", "ax": 960, "ay": 350, "lx": 1290, "ly": 300, "sys": "Secondary Steam Cycle", "comp": "Main Generator"}, {"n": 3, "label": "Main condenser", "ax": 750, "ay": 425, "lx": 700, "ly": 730, "sys": "Secondary Steam Cycle", "comp": "Main Condenser"}, {"n": 4, "label": "Moisture separator-reheater", "ax": 560, "ay": 270, "lx": 140, "ly": 150, "sys": "Secondary Steam Cycle", "comp": "Moisture Separator-Reheater"}, {"n": 5, "label": "Feed pumps", "ax": 600, "ay": 535, "lx": 480, "ly": 730, "sys": "Secondary Steam Cycle", "comp": "Feed Pumps"}, {"n": 6, "label": "Condensate pumps", "ax": 790, "ay": 565, "lx": 900, "ly": 730, "sys": "Mechanical Equipment", "comp": "Pumps"}, {"n": 7, "label": "Feedwater heaters (vertical)", "ax": 305, "ay": 400, "lx": 150, "ly": 380, "sys": "Mechanical Equipment", "comp": "Vertical Heat Exchangers"}, {"n": 8, "label": "Valve manifold", "ax": 600, "ay": 465, "lx": 1300, "ly": 420, "sys": "Mechanical Equipment", "comp": "Valves"}]}, "generic_auxiliary": {"w": 1408, "h": 768, "title": "Auxiliary Building \u2014 key equipment", "items": [{"n": 1, "label": "Battery / DC power racks", "ax": 390, "ay": 175, "lx": 150, "ly": 150, "sys": "Electrical Equipment", "comp": "DC Power"}, {"n": 2, "label": "HVAC ductwork", "ax": 950, "ay": 190, "lx": 1300, "ly": 150, "sys": "BOP Support Systems", "comp": "Heating and Ventilation"}, {"n": 3, "label": "Control panels", "ax": 820, "ay": 305, "lx": 1300, "ly": 280, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 4, "label": "Switchgear cabinet", "ax": 1195, "ay": 330, "lx": 1300, "ly": 400, "sys": "Electrical Equipment", "comp": "Switchgear"}, {"n": 5, "label": "Vertical heat exchangers", "ax": 290, "ay": 412, "lx": 150, "ly": 250, "sys": "Mechanical Equipment", "comp": "Vertical Heat Exchangers"}, {"n": 6, "label": "Horizontal heat exchangers", "ax": 780, "ay": 432, "lx": 700, "ly": 730, "sys": "Mechanical Equipment", "comp": "Horizontal Heat Exchangers"}, {"n": 7, "label": "Storage tank", "ax": 870, "ay": 600, "lx": 900, "ly": 730, "sys": "Mechanical Equipment", "comp": "Storage and Holding Tanks"}, {"n": 8, "label": "Pumps", "ax": 650, "ay": 520, "lx": 480, "ly": 730, "sys": "Mechanical Equipment", "comp": "Pumps"}]}, "generic_diesel": {"w": 1408, "h": 768, "title": "Diesel Generator Building \u2014 key equipment", "items": [{"n": 1, "label": "Emergency diesel generator (train A)", "ax": 550, "ay": 400, "lx": 140, "ly": 270, "sys": "BOP Island Structural", "comp": "Emergency Diesel Generator Structure"}, {"n": 2, "label": "Emergency diesel generator (train B)", "ax": 870, "ay": 415, "lx": 1300, "ly": 300, "sys": "BOP Island Structural", "comp": "Emergency Diesel Generator Structure"}, {"n": 3, "label": "Exhaust silencer", "ax": 635, "ay": 225, "lx": 140, "ly": 150, "sys": "BOP Island Structural", "comp": "Emergency Diesel Generator Structure"}, {"n": 4, "label": "Exhaust stack", "ax": 723, "ay": 90, "lx": 1300, "ly": 150, "sys": "BOP Island Structural", "comp": "Emergency Diesel Generator Structure"}, {"n": 5, "label": "Fuel oil day tank", "ax": 335, "ay": 285, "lx": 480, "ly": 735, "sys": "Circulating Water Cycle", "comp": "Tanks"}, {"n": 6, "label": "HVAC louvre", "ax": 380, "ay": 205, "lx": 140, "ly": 370, "sys": "BOP Support Systems", "comp": "Heating and Ventilation"}, {"n": 7, "label": "Control panel", "ax": 785, "ay": 385, "lx": 1300, "ly": 450, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 8, "label": "Cooling water pump skid", "ax": 1040, "ay": 600, "lx": 900, "ly": 735, "sys": "Mechanical Equipment", "comp": "Containment Cooling Systems"}]}, "generic_radwaste": {"w": 1408, "h": 768, "title": "Radwaste Building \u2014 key equipment", "items": [{"n": 1, "label": "Waste drum storage", "ax": 953, "ay": 380, "lx": 1300, "ly": 390, "sys": "Unclassified System"}, {"n": 2, "label": "Vertical process vessels", "ax": 650, "ay": 210, "lx": 150, "ly": 150, "sys": "Mechanical Equipment", "comp": "Vertical Heat Exchangers"}, {"n": 3, "label": "Air-cooled heat exchanger", "ax": 763, "ay": 230, "lx": 1300, "ly": 270, "sys": "Mechanical Equipment", "comp": "Horizontal Heat Exchangers"}, {"n": 4, "label": "Effluent vent stack", "ax": 1155, "ay": 150, "lx": 1300, "ly": 150, "sys": "Circulating Water Cycle", "comp": "Environmental Monitoring"}, {"n": 5, "label": "Process tank", "ax": 670, "ay": 535, "lx": 480, "ly": 735, "sys": "Circulating Water Cycle", "comp": "Tanks"}, {"n": 6, "label": "Storage tank", "ax": 800, "ay": 550, "lx": 660, "ly": 735, "sys": "Mechanical Equipment", "comp": "Storage and Holding Tanks"}, {"n": 7, "label": "Valve manifold", "ax": 735, "ay": 575, "lx": 840, "ly": 735, "sys": "Mechanical Equipment", "comp": "Valves"}, {"n": 8, "label": "Transfer pumps", "ax": 970, "ay": 635, "lx": 1020, "ly": 735, "sys": "Mechanical Equipment", "comp": "Pumps"}]}, "containment_epr": {"w": 1314, "h": 800, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor pressure vessel", "ax": 690, "ay": 580, "lx": 650, "ly": 760, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Steam generator (1)", "ax": 555, "ay": 400, "lx": 140, "ly": 350, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 3, "label": "Steam generator (2)", "ax": 650, "ay": 350, "lx": 140, "ly": 200, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 4, "label": "Steam generator (3)", "ax": 835, "ay": 420, "lx": 1180, "ly": 350, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 5, "label": "Pressuriser", "ax": 735, "ay": 360, "lx": 1180, "ly": 200, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 6, "label": "Polar crane", "ax": 650, "ay": 160, "lx": 650, "ly": 50, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 7, "label": "Refuelling pool", "ax": 690, "ay": 650, "lx": 850, "ly": 760, "sys": "Primary Containment"}, {"n": 8, "label": "Control panels", "ax": 900, "ay": 350, "lx": 1180, "ly": 500, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 9, "label": "Storage tanks", "ax": 965, "ay": 615, "lx": 450, "ly": 760, "sys": "Mechanical Equipment", "comp": "Storage and Holding Tanks"}]}, "containment_largeloop_pwr": {"w": 1314, "h": 800, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor pressure vessel", "ax": 700, "ay": 560, "lx": 650, "ly": 770, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Steam generator (1)", "ax": 615, "ay": 390, "lx": 140, "ly": 300, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 3, "label": "Steam generator (2)", "ax": 790, "ay": 370, "lx": 1180, "ly": 280, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 4, "label": "Steam generator (3)", "ax": 875, "ay": 410, "lx": 1180, "ly": 400, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 5, "label": "Pressuriser", "ax": 945, "ay": 345, "lx": 1180, "ly": 520, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 6, "label": "Reactor coolant pump", "ax": 530, "ay": 520, "lx": 140, "ly": 460, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}, {"n": 7, "label": "Polar crane", "ax": 680, "ay": 170, "lx": 680, "ly": 50, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 8, "label": "Refuelling pool", "ax": 390, "ay": 625, "lx": 380, "ly": 770, "sys": "Primary Containment", "comp": "Containment Interior"}, {"n": 9, "label": "Control panels", "ax": 695, "ay": 290, "lx": 900, "ly": 770, "sys": "BOP Support Systems", "comp": "Control Panels"}]}, "containment_nuscale": {"w": 1408, "h": 768, "title": "Reactor Bay \u2014 key equipment", "items": [{"n": 1, "label": "NuScale Power Module (1)", "ax": 520, "ay": 480, "lx": 140, "ly": 340, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "NuScale Power Module (2)", "ax": 650, "ay": 480, "lx": 550, "ly": 730, "sys": "Reactor Coolant Systems", "comp": "Fuel"}, {"n": 3, "label": "NuScale Power Module (3)", "ax": 780, "ay": 500, "lx": 750, "ly": 730, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 4, "label": "Reactor pool", "ax": 550, "ay": 610, "lx": 400, "ly": 730, "sys": "Primary Containment", "comp": "Containment Interior"}, {"n": 5, "label": "Bay crane", "ax": 850, "ay": 270, "lx": 1300, "ly": 250, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 6, "label": "HVAC ductwork", "ax": 950, "ay": 175, "lx": 1300, "ly": 130, "sys": "BOP Support Systems", "comp": "Heating and Ventilation"}, {"n": 7, "label": "Control cabinets", "ax": 230, "ay": 310, "lx": 140, "ly": 250, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 8, "label": "Valve room", "ax": 1000, "ay": 430, "lx": 1300, "ly": 430, "sys": "Mechanical Equipment", "comp": "Valves"}]}, "containment_abwr": {"w": 1313, "h": 800, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor pressure vessel", "ax": 675, "ay": 450, "lx": 675, "ly": 770, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Steam dryer / separator assembly", "ax": 670, "ay": 300, "lx": 140, "ly": 250, "sys": "Mechanical Equipment", "comp": "Integrated Head"}, {"n": 3, "label": "Reactor building crane", "ax": 500, "ay": 95, "lx": 1150, "ly": 100, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 4, "label": "Recirculation pump (1)", "ax": 910, "ay": 555, "lx": 1150, "ly": 550, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}, {"n": 5, "label": "Recirculation pump (2)", "ax": 455, "ay": 585, "lx": 1150, "ly": 650, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}, {"n": 6, "label": "Control panels", "ax": 870, "ay": 270, "lx": 1150, "ly": 280, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 7, "label": "Storage tank", "ax": 440, "ay": 350, "lx": 140, "ly": 380, "sys": "Mechanical Equipment", "comp": "Storage and Holding Tanks"}, {"n": 8, "label": "Valve manifold", "ax": 790, "ay": 400, "lx": 850, "ly": 770, "sys": "Mechanical Equipment", "comp": "Valves"}]}, "containment_esbwr": {"w": 1334, "h": 800, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor pressure vessel", "ax": 670, "ay": 470, "lx": 670, "ly": 770, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Refuelling pool", "ax": 600, "ay": 225, "lx": 140, "ly": 200, "sys": "Primary Containment", "comp": "Containment Structure"}, {"n": 3, "label": "Storage tanks", "ax": 555, "ay": 380, "lx": 140, "ly": 350, "sys": "Mechanical Equipment", "comp": "Storage and Holding Tanks"}, {"n": 4, "label": "Reactor building crane", "ax": 650, "ay": 110, "lx": 650, "ly": 45, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 5, "label": "Suppression pool", "ax": 580, "ay": 600, "lx": 450, "ly": 770, "sys": "Mechanical Equipment", "comp": "Containment Cooling Systems"}, {"n": 6, "label": "Heat exchanger skid", "ax": 810, "ay": 395, "lx": 1150, "ly": 380, "sys": "Mechanical Equipment", "comp": "Vertical Heat Exchangers"}, {"n": 7, "label": "Pump", "ax": 890, "ay": 505, "lx": 1150, "ly": 500, "sys": "Mechanical Equipment", "comp": "Pumps"}, {"n": 8, "label": "Valve cluster", "ax": 760, "ay": 350, "lx": 1150, "ly": 250, "sys": "Mechanical Equipment", "comp": "Valves"}]}, "containment_bwrx300": {"w": 1411, "h": 736, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor pressure vessel", "ax": 705, "ay": 430, "lx": 705, "ly": 715, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Refuelling pool", "ax": 615, "ay": 205, "lx": 140, "ly": 200, "sys": "Primary Containment", "comp": "Containment Interior"}, {"n": 3, "label": "Storage tanks", "ax": 590, "ay": 335, "lx": 140, "ly": 340, "sys": "Mechanical Equipment", "comp": "Storage and Holding Tanks"}, {"n": 4, "label": "Reactor building crane", "ax": 650, "ay": 110, "lx": 650, "ly": 45, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 5, "label": "Suppression pool", "ax": 620, "ay": 520, "lx": 480, "ly": 715, "sys": "Mechanical Equipment", "comp": "Containment Cooling Systems"}, {"n": 6, "label": "Heat exchanger skid", "ax": 815, "ay": 370, "lx": 1150, "ly": 350, "sys": "Mechanical Equipment", "comp": "Vertical Heat Exchangers"}, {"n": 7, "label": "Pump", "ax": 905, "ay": 460, "lx": 1150, "ly": 460, "sys": "Mechanical Equipment", "comp": "Pumps"}, {"n": 8, "label": "Valve cluster", "ax": 790, "ay": 310, "lx": 1150, "ly": 250, "sys": "Mechanical Equipment", "comp": "Valves"}]}, "containment_candu": {"w": 1411, "h": 736, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Calandria (reactor core)", "ax": 750, "ay": 420, "lx": 750, "ly": 710, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Steam generator (1)", "ax": 575, "ay": 280, "lx": 140, "ly": 250, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 3, "label": "Steam generator (2)", "ax": 665, "ay": 260, "lx": 140, "ly": 380, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 4, "label": "Pressuriser", "ax": 895, "ay": 265, "lx": 1150, "ly": 230, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 5, "label": "Reactor coolant pump", "ax": 555, "ay": 320, "lx": 1150, "ly": 500, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}, {"n": 6, "label": "Reactor building crane", "ax": 700, "ay": 125, "lx": 700, "ly": 45, "sys": "Primary Containment"}, {"n": 7, "label": "Fuelling machine", "ax": 610, "ay": 540, "lx": 450, "ly": 710, "sys": "Primary Containment"}, {"n": 8, "label": "Feeder pipes / heat exchange", "ax": 910, "ay": 370, "lx": 1150, "ly": 370, "sys": "Mechanical Equipment", "comp": "Vertical Heat Exchangers"}]}, "containment_rr_smr": {"w": 1408, "h": 768, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor pressure vessel", "ax": 740, "ay": 500, "lx": 740, "ly": 730, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Steam generator", "ax": 775, "ay": 400, "lx": 1250, "ly": 300, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 3, "label": "Pressuriser", "ax": 847, "ay": 440, "lx": 1250, "ly": 420, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 4, "label": "Heat exchanger", "ax": 880, "ay": 400, "lx": 1250, "ly": 540, "sys": "Mechanical Equipment", "comp": "Vertical Heat Exchangers"}, {"n": 5, "label": "Reactor coolant pump (1)", "ax": 535, "ay": 530, "lx": 500, "ly": 730, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}, {"n": 6, "label": "Reactor coolant pump (2)", "ax": 930, "ay": 420, "lx": 950, "ly": 730, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}, {"n": 7, "label": "Polar crane", "ax": 750, "ay": 150, "lx": 750, "ly": 50, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 8, "label": "Spent fuel pool", "ax": 690, "ay": 310, "lx": 140, "ly": 250, "sys": "Primary Containment", "comp": "Containment Interior"}, {"n": 9, "label": "Control panels", "ax": 320, "ay": 310, "lx": 140, "ly": 380, "sys": "BOP Support Systems", "comp": "Control Panels"}]}, "containment_xenergy": {"w": 1234, "h": 848, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor vessel (pebble bed core)", "ax": 670, "ay": 550, "lx": 670, "ly": 820, "sys": "Reactor Coolant Systems"}, {"n": 2, "label": "Hot gas connector / pressuriser", "ax": 745, "ay": 320, "lx": 1150, "ly": 300, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 3, "label": "Steam generator (heat exchanger)", "ax": 840, "ay": 420, "lx": 1150, "ly": 420, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 4, "label": "Reactor building crane", "ax": 560, "ay": 115, "lx": 560, "ly": 45, "sys": "Unclassified System"}]}, "containment_ap600": {"w": 1477, "h": 704, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor pressure vessel", "ax": 785, "ay": 470, "lx": 785, "ly": 660, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Steam generator (1)", "ax": 715, "ay": 340, "lx": 140, "ly": 280, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 3, "label": "Steam generator (2)", "ax": 875, "ay": 370, "lx": 1200, "ly": 330, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 4, "label": "Pressuriser", "ax": 850, "ay": 260, "lx": 1200, "ly": 200, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 5, "label": "Storage tank", "ax": 500, "ay": 270, "lx": 1200, "ly": 450, "sys": "Mechanical Equipment", "comp": "Storage and Holding Tanks"}, {"n": 6, "label": "Control panels", "ax": 520, "ay": 400, "lx": 500, "ly": 660, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 7, "label": "Polar crane", "ax": 790, "ay": 115, "lx": 790, "ly": 45, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 8, "label": "Reactor coolant pump", "ax": 720, "ay": 505, "lx": 1000, "ly": 660, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}]}, "containment_natrium": {"w": 1314, "h": 800, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor vessel (sodium pool)", "ax": 665, "ay": 600, "lx": 665, "ly": 780, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Intermediate heat exchanger", "ax": 490, "ay": 390, "lx": 140, "ly": 350, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 3, "label": "Primary sodium pump", "ax": 760, "ay": 375, "lx": 1150, "ly": 350, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}, {"n": 4, "label": "Control rod drives", "ax": 650, "ay": 350, "lx": 650, "ly": 45, "sys": "Reactor Coolant Systems", "comp": "Reactor Core Assemblies"}, {"n": 5, "label": "Fuel handling machine", "ax": 670, "ay": 150, "lx": 1150, "ly": 150, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 6, "label": "Cover gas / pressuriser", "ax": 855, "ay": 400, "lx": 1150, "ly": 480, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 7, "label": "Control panels", "ax": 320, "ay": 270, "lx": 140, "ly": 270, "sys": "BOP Support Systems", "comp": "Control Panels"}, {"n": 8, "label": "Valve cluster", "ax": 550, "ay": 320, "lx": 450, "ly": 780, "sys": "Mechanical Equipment", "comp": "Valves"}]}, "containment_generic_gw": {"w": 1314, "h": 800, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor pressure vessel", "ax": 500, "ay": 440, "lx": 500, "ly": 770, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Steam generator (1)", "ax": 420, "ay": 350, "lx": 140, "ly": 300, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 3, "label": "Steam generator (2)", "ax": 585, "ay": 350, "lx": 140, "ly": 420, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 4, "label": "Pressuriser", "ax": 478, "ay": 300, "lx": 140, "ly": 180, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 5, "label": "Polar crane", "ax": 480, "ay": 165, "lx": 480, "ly": 50, "sys": "Primary Containment", "comp": "Cranes and Hoists"}, {"n": 6, "label": "Reactor coolant pump", "ax": 420, "ay": 460, "lx": 300, "ly": 770, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}]}, "containment_generic_smr": {"w": 1408, "h": 768, "title": "Containment \u2014 key equipment", "items": [{"n": 1, "label": "Reactor core / vessel", "ax": 650, "ay": 470, "lx": 650, "ly": 740, "sys": "Reactor Coolant Systems", "comp": "Reactor Vessel and Internals"}, {"n": 2, "label": "Heat exchanger (1)", "ax": 580, "ay": 400, "lx": 350, "ly": 740, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 3, "label": "Heat exchanger (2)", "ax": 720, "ay": 400, "lx": 950, "ly": 740, "sys": "Reactor Coolant Systems", "comp": "Steam Generator***"}, {"n": 4, "label": "Pressuriser", "ax": 642, "ay": 380, "lx": 550, "ly": 50, "sys": "Reactor Coolant Systems", "comp": "Pressuriser"}, {"n": 5, "label": "Containment vessel", "ax": 650, "ay": 300, "lx": 750, "ly": 50, "sys": "Primary Containment", "comp": "Containment Structure"}, {"n": 6, "label": "Reactor coolant pump", "ax": 610, "ay": 490, "lx": 500, "ly": 740, "sys": "Reactor Coolant Systems", "comp": "Reactor Coolant Pump"}]}};
const PV_SVGNS = 'http://www.w3.org/2000/svg';

/* canonical DSE buildings — used for the drawer nav on every reactor.
   `zone` reuses the old ZONE_INFO story text where it aligns. */
const DSE_BUILDINGS = [
 {id:"1",label:"Containment",       dse:"Containment Building",     color:"#3fa46b", icon:"⚛", zone:"01"},
 {id:"2",label:"Auxiliary",         dse:"Auxiliary Building",       color:"#1a9edd", icon:"⚙", zone:"03"},
 {id:"3",label:"Turbine Hall",      dse:"Turbine Hall Building",    color:"#1a6ab4", icon:"🌀", zone:"05"},
 {id:"4",label:"Diesel Generator",  dse:"Diesel Generator Building",color:"#d4a800", icon:"🔌", zone:"04"},
 {id:"5",label:"Radwaste",          dse:"Radwaste Building",        color:"#c0563a", icon:"♻", zone:"02"},
 {id:"6",label:"Annex",             dse:"Annex Buildings",          color:"#9166cc", icon:"🏢", zone:null},
 {id:"7",label:"Site & Infrastructure", dse:"Site & Infrastucture", color:"#7a8a52", icon:"🏗", zone:null},
 {id:"8",label:"Misc / Unmapped",   dse:"Plant Areas & Buildings",  color:"#8a8f99", icon:"📦", zone:null},
];
const PV_STORY_CUSTOM = {
 "Annex":{intro:"Support and annex structures that serve the main plant — control, electrical, HVAC and workshop spaces. Generally accessible fabrication and fit-out scope for UK suppliers.",
   bullets:["Control & relay rooms","Electrical switchgear & MCCs","Battery rooms","HVAC air-handling & ducting","Cable containment & trays","Offices, stores & workshops"]},
 "Site & Infrastructure":{intro:"Site-wide infrastructure outside the main buildings — the switchyard, cooling-water and heat-sink systems, and site services. Significant civil and balance-of-plant opportunity.",
   bullets:["Switchyard & transformers","Transmission connection","Cooling-water intake & pumphouse","Ultimate heat sink / service water","Site roads & drainage","Security & perimeter"]},
 "Misc / Unmapped":{intro:"Components not yet assigned to a specific building — a work-in-progress bucket used to track mapping coverage. Expect this to shrink as the BOM is refined.",
   bullets:["Awaiting location mapping","Cross-building or site-wide items","Under review"]},
};

let pvSel = 'AP1000';
let pvActiveId = null;
let pvDetail = null;
let PV_ORIG = null;

function pvHexa(hex,a){const n=parseInt(hex.slice(1),16);return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';}
function pvViewKey(sel){return sel;}
function pvInfoKey(sel){return sel==='GW'?'Generic_GW_v2':sel==='SMR'?'Generic_SMR_v2':sel;}
function pvSelLabel(){return pvSel==='GW'?'Generic GW':pvSel==='SMR'?'Generic SMR':pvSel==='ALL'?'All designs':pvSel;}
function pvHomeTitle(sel){const i=PLANT_INFO[pvInfoKey(sel)];return (i&&i.full_name)||pvSelLabel();}
function pvStoryFor(b){ if(b.zone&&typeof ZONE_INFO!=='undefined'&&ZONE_INFO[b.zone])
    return {intro:ZONE_INFO[b.zone].intro,bullets:ZONE_INFO[b.zone].bullets};
  return PV_STORY_CUSTOM[b.label]||null; }

function pvCount(building){let n=0;ACTIVE_TREE.forEach(s=>s.locations.forEach(loc=>{if(loc.name!==building)return;
  loc.systems.forEach(sy=>sy.components.forEach(c=>{n+=c.subcomponents.length;}));}));return n;}
function pvMergeBuilding(building){const merged={name:building,systems:[]},sIdx={};
  ACTIVE_TREE.forEach(s=>s.locations.forEach(loc=>{if(loc.name!==building)return;
    loc.systems.forEach(sy=>{let ts=sIdx[sy.name];if(!ts){ts={name:sy.name,components:[],_ci:{}};sIdx[sy.name]=ts;merged.systems.push(ts);}
      sy.components.forEach(comp=>{let tc=ts._ci[comp.name];if(!tc){tc={name:comp.name,subcomponents:[]};ts._ci[comp.name]=tc;ts.components.push(tc);}
        tc.subcomponents=tc.subcomponents.concat(comp.subcomponents);});});}));
  merged.systems.forEach(s=>delete s._ci);return merged;}

function pvSetOverlay(show){const svg=document.getElementById('zone-svg');if(svg)svg.style.display=show?'':'none';
  document.getElementById('plant-wrapper').querySelectorAll('.z-badge,.pv-chip').forEach(x=>x.style.display=show?'':'none');hideTooltip();}
function pvClearActive(){if(pvActiveId!=null){const p=document.querySelector('#zone-svg polygon[data-pv="'+pvActiveId+'"]');
    if(p){p.style.fill='transparent';p.style.stroke='transparent';}
    document.querySelectorAll('[data-pv="'+pvActiveId+'"]').forEach(x=>x.classList.remove('active'));}pvActiveId=null;}

function pvHover(b,on){const p=document.querySelector('#zone-svg polygon[data-pv="'+b.id+'"]');const act=(pvActiveId===b.id);
  if(p&&!act){p.style.fill=on?pvHexa(b.color,.26):'transparent';p.style.stroke=on?pvHexa(b.color,.9):'transparent';}
  document.querySelectorAll('.z-badge[data-pv="'+b.id+'"]').forEach(x=>x.classList.toggle('active',on||act));
  if(on){const c=pvCount(b.dse);const tz=document.getElementById('tt-zone');tz.textContent='Building '+b.id;tz.style.color=b.color;
    document.getElementById('tt-title').textContent=b.label;document.getElementById('tt-sub').textContent=c+' components · '+b.dse;
    document.getElementById('tooltip').style.display='block';}else{hideTooltip();}}

/* ---- wallchart callout overlay on a detail cutaway ---- */
function pvHideCallouts(){
  const s=document.getElementById('pv-callout-svg');if(s)s.remove();
  const lg=document.getElementById('pv-callout-legend');if(lg){lg.style.display='none';lg.innerHTML='';}
}
function pvCoHot(n,on){
  const svg=document.getElementById('pv-callout-svg');if(!svg)return;
  svg.querySelectorAll('[data-co="'+n+'"]').forEach(el=>el.classList.toggle('hot',on));
  const row=document.querySelector('#pv-callout-legend .pv-co-row[data-co="'+n+'"]');if(row)row.classList.toggle('hot',on);
}
function pvShowCallouts(imgId){
  pvHideCallouts();
  const co=PV_CALLOUTS[imgId];if(!co)return;
  const wrapper=document.getElementById('plant-wrapper');
  const svg=document.createElementNS(PV_SVGNS,'svg');
  svg.id='pv-callout-svg';svg.setAttribute('data-img',imgId);svg.setAttribute('viewBox','0 0 '+co.w+' '+co.h);svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  co.items.forEach(it=>{
    const line=document.createElementNS(PV_SVGNS,'line');
    line.setAttribute('x1',it.ax);line.setAttribute('y1',it.ay);line.setAttribute('x2',it.lx);line.setAttribute('y2',it.ly);
    line.setAttribute('class','pv-co-line');line.setAttribute('data-co',it.n);svg.appendChild(line);
    const dot=document.createElementNS(PV_SVGNS,'circle');
    dot.setAttribute('cx',it.ax);dot.setAttribute('cy',it.ay);dot.setAttribute('r',5);dot.setAttribute('class','pv-co-dot');dot.setAttribute('data-co',it.n);svg.appendChild(dot);
    const g=document.createElementNS(PV_SVGNS,'g');g.setAttribute('class','pv-co-badge');g.setAttribute('data-co',it.n);
    const c=document.createElementNS(PV_SVGNS,'circle');c.setAttribute('cx',it.lx);c.setAttribute('cy',it.ly);c.setAttribute('r',14);
    const t=document.createElementNS(PV_SVGNS,'text');t.setAttribute('x',it.lx);t.setAttribute('y',it.ly);t.textContent=it.n;
    g.appendChild(c);g.appendChild(t);
    g.addEventListener('mouseenter',()=>pvCoHot(it.n,true));g.addEventListener('mouseleave',()=>pvCoHot(it.n,false));
    g.addEventListener('click',()=>pvCalloutClick(it.n));
    svg.appendChild(g);
  });
  wrapper.appendChild(svg);
  const lg=document.getElementById('pv-callout-legend');
  lg.innerHTML='<div class="pv-co-h">'+esc(co.title||'Key')+'</div>'+
    co.items.map(it=>'<div class="pv-co-row" data-co="'+it.n+'"><span class="pv-co-num">'+it.n+'</span><span>'+esc(it.label)+'</span></div>').join('');
  lg.style.display='block';
  lg.querySelectorAll('.pv-co-row').forEach(row=>{const n=row.dataset.co;
    row.addEventListener('mouseenter',()=>pvCoHot(n,true));row.addEventListener('mouseleave',()=>pvCoHot(n,false));
    row.addEventListener('click',()=>pvCalloutClick(n));});
}
let pvCoSel=null;
function pvCoActive(n){
  document.querySelectorAll('#pv-callout-svg [data-co].sel, #pv-callout-legend .pv-co-row.sel').forEach(el=>el.classList.remove('sel'));
  pvCoSel=n;
  document.querySelectorAll('#pv-callout-svg [data-co="'+n+'"], #pv-callout-legend .pv-co-row[data-co="'+n+'"]').forEach(el=>el.classList.add('sel'));
}
/* click a callout pin/legend row -> drill the drawer to that system/component */
function pvCalloutClick(n){
  const svg=document.getElementById('pv-callout-svg');if(!svg)return;
  const co=PV_CALLOUTS[svg.getAttribute('data-img')];if(!co)return;
  const it=co.items.find(x=>String(x.n)===String(n));if(!it||!it.sys)return;
  const bIdx=drillStack.findIndex(d=>d.level==='building');if(bIdx<0)return;
  const bdata=drillStack[bIdx].data;
  const sys=(bdata.systems||[]).find(s=>s.name===it.sys);if(!sys)return;
  const stack=drillStack.slice(0,bIdx+1).concat([{level:'system',name:sys.name,data:sys}]);
  if(it.comp){const comp=(sys.components||[]).find(c=>c.name===it.comp);if(comp)stack.push({level:'component',name:comp.name,data:comp});}
  drillStack=stack;openDrillPanel();renderDrillContent();renderBreadcrumb();
  pvCoActive(n);
}

/* ---- open a building: image swap + drill with story intro ---- */
function pvOpenBuilding(b){
  const merged=pvMergeBuilding(b.dse);
  const view=PLANT_VIEWS[pvViewKey(pvSel)];
  const vb=view?view.buildings.find(x=>x.dse===b.dse):null;
  const img=(vb&&vb.image)||b.image||null;
  const id=(vb&&vb.id)||b.id;
  if(img&&PV_IMG[img]){document.getElementById('plant-img').src=PV_IMG[img];pvDetail=id;
    document.getElementById('pv-fullbtn').style.display='flex';pvSetOverlay(false);pvShowCallouts(img);}
  else{if(pvDetail){const v=PLANT_VIEWS[pvViewKey(pvSel)];if(v)document.getElementById('plant-img').src=PV_IMG[v.fullSlice];}
    pvDetail=null;pvSetOverlay(true);pvHideCallouts();document.getElementById('pv-fullbtn').style.display='none';}
  pvClearActive();
  if(id){pvActiveId=id;const p=document.querySelector('#zone-svg polygon[data-pv="'+id+'"]');
    if(p){p.style.fill=pvHexa(b.color,.30);p.style.stroke=pvHexa(b.color,.95);}
    document.querySelectorAll('[data-pv="'+id+'"]').forEach(x=>x.classList.add('active'));}
  const cnt=merged.systems.reduce((a,s)=>a+s.components.reduce((y,c)=>y+c.subcomponents.length,0),0);
  drillStack=[{level:'home',sel:pvSel,name:pvHomeTitle(pvSel)},
              {level:'building',name:b.label,data:merged,story:pvStoryFor(b),color:b.color,zoneId:id,compCount:cnt}];
  openDrillPanel();renderDrillContent();renderBreadcrumb();
  document.getElementById('hint').classList.add('hidden');
}

/* ---- drawer: plant overview (home) ---- */
function pvKV(k,v){return v?('<div class="pv-di-kv"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v)+'</span></div>'):'';}
function pvRenderHome(sel){
  const info=PLANT_INFO[pvInfoKey(sel)]||{};
  const content=document.getElementById('drill-content');
  document.getElementById('drill-title-main').textContent=info.full_name||pvSelLabel();
  document.getElementById('drill-title-sub').textContent=(info.vendor||'')+(info.status?(' · '+info.status):'');
  document.getElementById('drill-stripe').style.background='var(--accent)';
  let h='';
  if(info.full_name){const cov=parseInt(info.coverage_pct||'0',10)||0;
    h+='<div class="pv-drawer-info">'+pvKV('Type',info.type)+pvKV('Gross output (MWe)',info.gross_mwe)+
       pvKV('Coolant',info.coolant)+pvKV('Moderator',info.moderator)+pvKV('Containment',info.containment)+pvKV('BOM rows',info.bom_rows)+
       '<div class="pv-di-cov"><div class="pv-di-cov-lbl"><span>Data completeness</span><span>'+cov+'%</span></div>'+
       '<div class="pv-di-cov-bar"><div class="pv-di-cov-fill" data-w="'+cov+'"></div></div></div>'+
       (info.summary?'<div class="pv-di-sum">'+esc(info.summary)+'</div>':'');
    if(info.mix&&info.mix.length){h+='<div class="pv-di-mix"><div class="pv-di-mix-h">Composite make-up (component share)</div>';
      const mx=info.mix[0][1]||1;info.mix.forEach(m=>{h+='<div class="pv-di-mix-row"><span class="pv-di-mix-name">'+esc(m[0])+
        '</span><span class="pv-di-mix-track"><span class="pv-di-mix-fill" data-w="'+Math.round(m[1]/mx*100)+'"></span></span><span class="pv-di-mix-pct">'+m[1]+'%</span></div>';});h+='</div>';}
    h+='</div>';}
  content.innerHTML=h;
  // CSP: no inline style="" allowed — set dynamic widths via JS instead (see plant_frankie_plant_explorer_v2 memory).
  content.querySelectorAll('[data-w]').forEach(elw=>{ elw.style.width = elw.getAttribute('data-w') + '%'; elw.removeAttribute('data-w'); });
  const nav=document.createElement('div');nav.className='pv-bnav-label';nav.textContent='Explore buildings';content.appendChild(nav);
  DSE_BUILDINGS.forEach(b=>{if(b.dse==='Plant Areas & Buildings')return;const c=pvCount(b.dse);if(!c)return;
    const el=drillItem(b.icon,'di-loc',b.label,b.dse,c);el.onclick=()=>pvOpenBuilding(b);content.appendChild(el);});
  // Misc / Unmapped — collapsible, default closed, kept off the plant image
  const misc=DSE_BUILDINGS.find(b=>b.dse==='Plant Areas & Buildings');
  const mc=misc?pvCount(misc.dse):0;
  if(mc){
    const wrap=document.createElement('div');wrap.className='pv-collapse';
    wrap.innerHTML='<div class="pv-collapse-head"><span class="pv-collapse-caret">▶</span><span>'+esc(misc.label)+'</span><span class="pv-collapse-count">'+mc+'</span></div><div class="pv-collapse-body"></div>';
    wrap.querySelector('.pv-collapse-head').onclick=()=>wrap.classList.toggle('open');
    const item=drillItem(misc.icon,'di-loc','View '+misc.label+' components',misc.dse,mc);
    item.onclick=()=>pvOpenBuilding(misc);
    wrap.querySelector('.pv-collapse-body').appendChild(item);
    content.appendChild(wrap);
  }
}

/* ---- drawer: building level (story intro + systems) ---- */
function pvRenderBuildingLevel(top){
  const content=document.getElementById('drill-content');
  document.getElementById('drill-title-main').textContent=top.name;
  document.getElementById('drill-title-sub').textContent=top.data.systems.length+' systems · '+(top.compCount||0)+' components';
  document.getElementById('drill-stripe').style.background=top.color||'var(--accent)';
  content.innerHTML='';
  if(top.story){
    // CSP: no inline style="" — build with DOM + per-property style, same pattern as the
    // existing site-level zone-intro-card in renderDrillContent().
    const col=top.color||'#1a6ab4';
    const card=document.createElement('div');card.className='zone-intro-card';
    const header=document.createElement('div');header.className='zone-intro-header';
    header.style.background=col+'18';header.style.borderBottom='1px solid '+col+'30';
    const badge=document.createElement('div');badge.className='zone-intro-badge';
    badge.style.background=col;badge.textContent=top.zoneId||'•';
    const titleEl=document.createElement('div');titleEl.className='zone-intro-title';
    titleEl.style.color=col;titleEl.textContent=top.name;
    header.appendChild(badge);header.appendChild(titleEl);
    const body=document.createElement('div');body.className='zone-intro-body';
    const introP=document.createElement('p');introP.className='zone-intro-text';introP.textContent=top.story.intro;
    const bulletsWrap=document.createElement('div');bulletsWrap.className='zone-intro-bullets';
    top.story.bullets.forEach(x=>{
      const row=document.createElement('div');row.className='zone-intro-bullet';
      const dot=document.createElement('div');dot.className='zone-bullet-dot';dot.style.background=col;
      const span=document.createElement('span');span.textContent=x;
      row.appendChild(dot);row.appendChild(span);
      bulletsWrap.appendChild(row);
    });
    body.appendChild(introP);body.appendChild(bulletsWrap);
    card.appendChild(header);card.appendChild(body);
    content.appendChild(card);
    const dv=document.createElement('div');dv.className='zone-intro-divider';content.appendChild(dv);
    const bl=document.createElement('div');bl.className='zone-browse-label';bl.textContent='Explore Systems & Firms';content.appendChild(bl);}
  if(!top.data.systems.length){const e=document.createElement('div');e.className='zone-empty-state';e.textContent='No components mapped to this building yet.';content.appendChild(e);return;}
  top.data.systems.forEach(sys=>{const el=drillItem('⚙','di-sys',sys.name,sys.components.length+' components',sys.components.length);
    el.onclick=()=>{drillStack.push({level:'system',name:sys.name,data:sys});renderDrillContent();renderBreadcrumb();};content.appendChild(el);});
}

function pvShowHome(sel){drillStack=[{level:'home',sel:sel,name:pvHomeTitle(sel)}];openDrillPanel();renderDrillContent();renderBreadcrumb();}

/* ---- build the on-image view (badges for regioned buildings, chips otherwise) ---- */
function pvApplyView(sel){
  const wrapper=document.getElementById('plant-wrapper'),svg=document.getElementById('zone-svg');
  pvDetail=null;pvActiveId=null;svg.style.display='';
  pvHideCallouts();
  document.getElementById('pv-fullbtn').style.display='none';
  wrapper.querySelectorAll('.z-badge,.pv-chip').forEach(b=>b.remove());
  const view=PLANT_VIEWS[pvViewKey(sel)];
  if(!view){pvRestoreOriginal();pvShowHome(sel);return;}
  document.getElementById('plant-img').src=PV_IMG[view.fullSlice];
  svg.setAttribute('viewBox','0 0 '+view.w+' '+view.h);svg.innerHTML='';
  view.buildings.forEach(b=>{const c=pvCount(b.dse);
    // Always wire click-through to pvOpenBuilding(), even when c is 0 — pvRenderBuildingLevel
    // already shows a graceful "No components mapped to this building yet" empty state, so
    // gating the listener behind a truthy count just made the badge look clickable but do
    // nothing (the bug reported 2026-08-04: numbers on the cutaway image didn't respond).
    if(b.points){
      const poly=document.createElementNS('http://www.w3.org/2000/svg','polygon');
      poly.setAttribute('points',b.points);poly.setAttribute('class','pv-zone'+(c?'':' empty'));poly.setAttribute('data-pv',b.id);
      poly.addEventListener('mouseenter',()=>pvHover(b,true));poly.addEventListener('mouseleave',()=>pvHover(b,false));
      poly.addEventListener('mousemove',moveTooltip);poly.addEventListener('click',()=>pvOpenBuilding(b));
      svg.appendChild(poly);
      const bd=document.createElement('div');bd.className='z-badge pv-badge'+(c?'':' empty');bd.setAttribute('data-pv',b.id);
      bd.textContent=b.id;bd.style.background=b.color;bd.style.left=(b.badge[0]*100)+'%';bd.style.top=(b.badge[1]*100)+'%';
      bd.addEventListener('mouseenter',()=>pvHover(b,true));bd.addEventListener('mouseleave',()=>pvHover(b,false));bd.addEventListener('click',()=>pvOpenBuilding(b));
      wrapper.appendChild(bd);
    } else if(b.badge){
      const chip=document.createElement('div');chip.className='pv-chip'+(c?'':' empty');chip.setAttribute('data-pv',b.id);
      chip.style.left=(b.badge[0]*100)+'%';chip.style.top=(b.badge[1]*100)+'%';
      const chipDot=document.createElement('span');chipDot.className='pv-chip-dot';chipDot.style.background=b.color;chipDot.textContent=b.id;
      const chipLbl=document.createElement('span');chipLbl.textContent=b.label;
      chip.appendChild(chipDot);chip.appendChild(chipLbl);
      chip.addEventListener('click',()=>pvOpenBuilding(b));
      wrapper.appendChild(chip);
    }
  });
  pvShowHome(sel);
}
function pvRestoreOriginal(){if(!PV_ORIG)return;
  document.getElementById('plant-img').src=PV_ORIG.img;const svg=document.getElementById('zone-svg');
  svg.setAttribute('viewBox',PV_ORIG.vb);svg.innerHTML=PV_ORIG.svg;
  const wrapper=document.getElementById('plant-wrapper');wrapper.querySelectorAll('.z-badge,.pv-chip').forEach(b=>b.remove());
  const tmp=document.createElement('div');tmp.innerHTML=PV_ORIG.badges;Array.from(tmp.children).forEach(c=>wrapper.appendChild(c));initZones();}
function pvRestoreFull(){pvApplyView(pvSel);}

/* ---- generic composite tree filter (GW / SMR) ---- */
function pvFilterSet(setArr){
  if (!dataHasReactorMapping()) return PLANT_TREE || []; // see dataHasReactorMapping() note above
  const S=new Set(setArr),out=[];
  PLANT_TREE.forEach(site=>{const locs=[];site.locations.forEach(loc=>{const syss=[];
    loc.systems.forEach(sys=>{const comps=[];sys.components.forEach(comp=>{const subs=comp.subcomponents.filter(sub=>(sub.reactors||[]).some(r=>S.has(r)));
      if(subs.length)comps.push(Object.assign({},comp,{subcomponents:subs}));});
      if(comps.length)syss.push(Object.assign({},sys,{components:comps}));});
    if(syss.length)locs.push(Object.assign({},loc,{systems:syss}));});
    if(locs.length)out.push(Object.assign({},site,{locations:locs}));});return out;}



// ── Reactor filter (v2) ──
const REACTOR_NAMES = ["ABWR", "AP1000", "AP300", "AP600", "APR1400", "BWRX300", "Candu", "ESBWR", "HPR1000", "Holtec International SMR-300", "NuScale_US460", "NuScale_VOYGR", "RR_SMR", "Terrapower Natrium", "UK_EPR", "US_APWR", "US_EPR", "X Energy"];
let selectedReactor = 'ALL';
let ACTIVE_TREE = PLANT_TREE;

// Confirmed 2026-08-04 via PlantExplorerDrawer.debug(): the live
// kb/plant_tree_data.json has 0 of 4466 subcomponents with a non-empty
// `reactors` field — it's the older generic DSE taxonomy, not the
// reactor-mapped v2 schema the reactor-select dropdown was designed for
// (that schema only exists baked into the standalone
// NuCCoL_Plant_Explorer_v2_images.html file, not in the live KB yet).
// Filtering on a field that's never populated silently returns an empty
// tree, breaking building browsing, search and drill-down for any specific
// reactor pick. Until the KB is updated with real per-reactor BOM mapping,
// fall back to the full/generic tree rather than showing nothing.
let _hasReactorMappingCache = null;
function dataHasReactorMapping() {
  if (_hasReactorMappingCache !== null) return _hasReactorMappingCache;
  if (!PLANT_TREE) return false;
  for (const site of PLANT_TREE) for (const loc of site.locations || [])
    for (const sys of loc.systems || []) for (const comp of sys.components || [])
      for (const sub of comp.subcomponents || [])
        if (sub.reactors && sub.reactors.length) { _hasReactorMappingCache = true; return true; }
  _hasReactorMappingCache = false;
  return false;
}

function filterTreeForReactor(reactor) {
  if (!PLANT_TREE) return [];
  if (reactor === 'ALL') return PLANT_TREE;
  if (!dataHasReactorMapping()) return PLANT_TREE; // no per-reactor data available — show the generic tree
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

// ── Layer 2 wiring: reopen tab + reactor-change hook now also drives the cutaway view ──
/* ---- wrap open/close of the drawer so a re-open tab appears ---- */
const _pvOpenDP=openDrillPanel,_pvCloseDP=closeDrillPanel;
openDrillPanel=function(){_pvOpenDP();const r=document.getElementById('pv-reopen');if(r)r.style.display='none';};
closeDrillPanel=function(){_pvCloseDP();const r=document.getElementById('pv-reopen');if(r)r.style.display='flex';};

/* ---- wrap the reactor-change hook ---- */
const _pvOrigSetReactorFilter=setReactorFilter;
setReactorFilter=function(sel){pvSel=sel;
  if(sel==='GW'||sel==='SMR'){selectedReactor='ALL';ACTIVE_TREE=pvFilterSet(sel==='GW'?PV_GW_SET:PV_SMR_SET);
    buildSearchIndex();closeDrillPanel();
    const lbl=document.getElementById('reactor-active-label');if(lbl)lbl.textContent=(sel==='GW'?'Generic — Gigawatt composite':'Generic — SMR composite');
  } else {_pvOrigSetReactorFilter(sel);}
  pvApplyView(sel);
};

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
        const res = await fetch(DATA_FILE);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const data = await res.json();
        PLANT_TREE = data.plant_tree || data;
        ACTIVE_TREE = PLANT_TREE;
        dataLoaded = true;
        buildSearchIndex();
        // Default to a sliced cutaway view on first open (matches the standalone tool's
        // original auto-select-AP1000-on-load behaviour) instead of leaving the flat
        // "All 18 designs" zone map as the first thing people see.
        const reactorSelectEl = document.getElementById('reactor-select');
        if (reactorSelectEl) reactorSelectEl.value = 'AP1000';
        setReactorFilter('AP1000');
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

  // Temporary diagnostic helper (2026-08-04) — call PlantExplorerDrawer.debug()
  // in the browser console after opening the drawer once (so data has loaded)
  // to see the real shape of the fetched plant tree: how many locations exist
  // per DSE building name, and what reactor-name strings actually appear in
  // sub.reactors, so we can see why per-reactor filtering shows 0 components
  // mapped. Safe to remove once the mismatch is found — read-only, no writes.
  function debug() {
    // v2 (2026-08-04): inspect the RAW unfiltered PLANT_TREE, not ACTIVE_TREE —
    // v1 iterated ACTIVE_TREE, which is already the (empty) filtered result,
    // so it couldn't show why the filter was producing nothing.
    const raw = PLANT_TREE || [];
    const locCounts = {};
    const reactorNames = new Set();
    let subWithReactorsField = 0, subMissingReactorsField = 0, totalSubs = 0;
    let sampleSub = null, sampleLoc = null, sampleSite = null;
    raw.forEach(site => {
      if (!sampleSite) sampleSite = { name: site.name, keys: Object.keys(site) };
      (site.locations || []).forEach(loc => {
        if (!sampleLoc) sampleLoc = { name: loc.name, keys: Object.keys(loc) };
        locCounts[loc.name] = (locCounts[loc.name] || 0) + 1;
        (loc.systems || []).forEach(sys => (sys.components || []).forEach(comp =>
          (comp.subcomponents || []).forEach(sub => {
            totalSubs++;
            if (!sampleSub) sampleSub = sub;
            if (sub.reactors && sub.reactors.length) { subWithReactorsField++; sub.reactors.forEach(r => reactorNames.add(r)); }
            else subMissingReactorsField++;
          })));
      });
    });
    const out = {
      dataLoaded, plantTreeSiteCount: raw.length,
      locationNamesInRawTree: locCounts,
      dseBuildingNamesExpected: DSE_BUILDINGS.map(b => b.dse),
      totalSubcomponents: totalSubs,
      subcomponentsWithNonEmptyReactorsField: subWithReactorsField,
      subcomponentsMissingOrEmptyReactorsField: subMissingReactorsField,
      reactorNameStringsFoundInRawData: Array.from(reactorNames).sort(),
      sampleSite, sampleLocation: sampleLoc, sampleSubcomponent: sampleSub,
      currentPvSel: pvSel, currentSelectedReactor: selectedReactor,
      activeTreeSiteCountAfterFilter: (ACTIVE_TREE || []).length
    };
    console.log('[PlantExplorerDrawer.debug v2]', out);
    return out;
  }

  window.PlantExplorerDrawer = { open, close, debug };

}());
