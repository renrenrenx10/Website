// ── Drawer Manager ───────────────────────────────────────────────────────
// Enforces "only one drawer open at a time". Without this, opening a second
// tool (e.g. NucColpedia) while a first (e.g. Evidence Vault) was still open
// just stacked a new overlay on top — the first drawer stayed alive behind
// it, invisible, and looked "stuck" when you tried to close things (its
// backdrop/close button never got a click because the new drawer's backdrop
// was on top). Added 2026-08-04.
//
// Generic by design: every tool drawer's root element is a direct child of
// <body> with a class ending in "-drawer" plus a "--open"/"--closed" state
// class (e.g. "assess-drawer assess-drawer--open", "wr-drawer wr-drawer--open",
// "pe-drawer pe-drawer--open"). This watches for any drawer root gaining an
// "--open" class and force-closes every other drawer root that's open, by
// flipping its state class the same way each drawer's own close() does —
// no changes needed in the individual drawer scripts.

(function () {
  'use strict';

  function isDrawerRoot(el) {
    if (!el || !el.classList) return false;
    for (const c of el.classList) {
      if (c.endsWith('-drawer') && !c.includes('--')) return true;
    }
    return false;
  }

  function isOpen(el) {
    for (const c of el.classList) { if (c.endsWith('--open')) return true; }
    return false;
  }

  function forceClose(el) {
    const toRemove = [];
    const toAdd = [];
    el.classList.forEach(c => {
      if (c.endsWith('--open')) {
        toRemove.push(c);
        toAdd.push(c.slice(0, -('--open'.length)) + '--closed');
      }
    });
    toRemove.forEach(c => el.classList.remove(c));
    toAdd.forEach(c => el.classList.add(c));
  }

  let syncing = false;

  const observer = new MutationObserver(mutations => {
    if (syncing) return;
    for (const m of mutations) {
      if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
      const el = m.target;
      if (!isDrawerRoot(el) || !isOpen(el)) continue;

      syncing = true;
      try {
        document.body.querySelectorAll(':scope > div').forEach(other => {
          if (other === el || !isDrawerRoot(other) || !isOpen(other)) return;
          forceClose(other);
        });
      } finally {
        syncing = false;
      }
      break; // one open event is enough to trigger a sync pass
    }
  });

  observer.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
})();
