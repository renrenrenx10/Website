// ── Drawer Splash Kit ────────────────────────────────────────────────────
// Shared "what is this tool" intro overlay, shown once inside each drawer
// (sized to the drawer panel — sidebar stays visible behind it), then
// remembered in localStorage so it doesn't reappear on later opens. A small
// info button in the topbar brings it back on demand.
//
// Usage — one call per drawer, right after document.body.appendChild(el)
// inside that drawer's inject() function:
//
//   window.DrawerSplashKit && window.DrawerSplashKit.attach(el, {
//     key:         'evidenceVault',              // unique, used for the localStorage flag
//     icon:        '📁',                          // same emoji as the sidebar button
//     eyebrow:     'Supplier tool',
//     title:       'Evidence Vault',
//     description: 'One or two sentences on what this does and why it matters.',
//     checklist:   ['Point one', 'Point two', 'Point three'],
//     ctaLabel:    'Open Evidence Vault',          // optional, defaults to "Open <title>"
//     art:         '<svg viewBox="0 0 200 200">...</svg>',
//   });
//
// Looks for `.assess-panel, .wr-panel, .pe-drawer-panel` inside the given
// root element and `.assess-topbar, .wr-topbar, .pe-drawer-topbar` for the
// info button — covers every drawer family in Frankie. Added 2026-08-05.

(function () {
  'use strict';

  function storageKey(key) { return 'frankieSplashSeen_' + key; }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function buildHTML(config) {
    const checklistHTML = (config.checklist || []).map(item =>
      `<div><span class="ds-tick">✓</span>${esc(item)}</div>`
    ).join('');
    const cta = config.ctaLabel || ('Open ' + config.title);
    return `
      <div class="ds-deco"></div>
      <div class="ds-deco2"></div>
      <div class="ds-inner">
        <div class="ds-txt">
          <div class="ds-eyebrow"><span class="ds-eyebrow-ico">${config.icon || ''}</span>${esc(config.eyebrow || '')}</div>
          <h1>${esc(config.title || '')}</h1>
          <p>${esc(config.description || '')}</p>
          <div class="ds-checklist">${checklistHTML}</div>
          <button class="ds-cta" type="button">${esc(cta)} →</button>
        </div>
        <div class="ds-img">
          <div class="ds-art">${config.art || ''}</div>
        </div>
      </div>`;
  }

  function attach(rootEl, config) {
    if (!rootEl || !config || !config.key) return;
    if (rootEl.querySelector('.drawer-splash')) return; // already attached

    const panel  = rootEl.querySelector('.assess-panel, .wr-panel, .pe-drawer-panel');
    const topbar = rootEl.querySelector('.assess-topbar, .wr-topbar, .pe-drawer-topbar');
    if (!panel) return;

    // Plant Explorer has no dedicated topbar wrapper — its close button
    // floats directly in the panel — so fall back to placing the info
    // button next to it there instead (see .pe-drawer-panel > .ds-info-btn
    // in drawer-splash.css for its floating position).
    const infoHost  = topbar || panel;
    const closeBtn  = infoHost.querySelector('.assess-close, .wr-close, .pe-drawer-close');
    if (infoHost && !infoHost.querySelector(':scope > .ds-info-btn')) {
      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'ds-info-btn';
      infoBtn.setAttribute('aria-label', 'About this tool');
      infoBtn.textContent = 'ℹ️';
      if (closeBtn && closeBtn.parentElement === infoHost) infoHost.insertBefore(infoBtn, closeBtn);
      else infoHost.appendChild(infoBtn);
      infoBtn.addEventListener('click', () => { splash.hidden = false; });
    }

    const splash = document.createElement('div');
    splash.className = 'drawer-splash';
    splash.innerHTML = buildHTML(config);
    panel.appendChild(splash);

    function hide() {
      splash.hidden = true;
      try { localStorage.setItem(storageKey(config.key), '1'); } catch (e) {}
    }

    const ctaBtn = splash.querySelector('.ds-cta');
    if (ctaBtn) ctaBtn.addEventListener('click', hide);

    let seen = false;
    try { seen = localStorage.getItem(storageKey(config.key)) === '1'; } catch (e) {}
    splash.hidden = seen;
  }

  window.DrawerSplashKit = { attach };
})();
