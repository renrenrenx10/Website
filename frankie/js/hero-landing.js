// ── Hero landing ─────────────────────────────────────────────────────────
// Shown instead of the chat UI on first load. Mirrors the live brain-check
// status (set by braincheck-ui.js on #statusBtnDot / #statusBtnLabel) into
// the hero's own status pill, and swaps the hero out for the chat UI when
// "Open Frankie Chat" (or the sidebar "Chat with Frankie" link) is used.
// Public API: window.FrankieHero.showChat() / .showHero()

(function () {
  'use strict';

  function els() {
    return {
      hero: document.getElementById('heroLanding'),
      messages: document.getElementById('messages'),
      composer: document.getElementById('composer'),
      rail: document.querySelector('.rail'),
    };
  }

  function showChat() {
    const { hero, messages, composer, rail } = els();
    if (hero) hero.hidden = true;
    if (messages) messages.hidden = false;
    if (composer) composer.hidden = false;
    if (rail) rail.hidden = false;
    const input = document.getElementById('input');
    if (input) input.focus();
  }

  function showHero() {
    const { hero, messages, composer, rail } = els();
    if (hero) hero.hidden = false;
    if (messages) messages.hidden = true;
    if (composer) composer.hidden = true;
    if (rail) rail.hidden = false; // rail has no toggle of its own, leave as-is
  }

  // ── Mirror the live status pill (topbar) into the hero's status pill ──
  function mirrorStatus() {
    const srcDot   = document.getElementById('statusBtnDot');
    const srcLabel = document.getElementById('statusBtnLabel');
    const dstDot   = document.getElementById('heroStatusDot');
    const dstLabel = document.getElementById('heroStatusLabel');
    if (!srcDot || !srcLabel || !dstDot || !dstLabel) return;

    const sync = () => {
      dstDot.textContent   = srcDot.textContent;
      dstDot.className     = srcDot.className.replace('bc-status-dot', 'bc-status-dot').trim() || 'bc-status-dot';
      dstLabel.textContent = srcLabel.textContent;
      dstLabel.className   = srcLabel.className || 'bc-status-label';
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(srcDot,   { attributes: true, attributeFilter: ['class'], characterData: true, childList: true, subtree: true });
    observer.observe(srcLabel, { attributes: true, attributeFilter: ['class'], characterData: true, childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', function () {
    const openBtn = document.getElementById('heroOpenChat');
    if (openBtn) openBtn.onclick = showChat;

    const statusPill = document.getElementById('heroStatusPill');
    const statusBtn  = document.getElementById('statusToggleBtn');
    if (statusPill && statusBtn) statusPill.onclick = () => statusBtn.click();

    mirrorStatus();
  });

  window.FrankieHero = { showChat, showHero };
})();
