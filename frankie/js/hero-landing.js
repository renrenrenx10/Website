// ── Hero landing ─────────────────────────────────────────────────────────
// Shown instead of the chat UI on first load. Mirrors the live brain-check
// status (set by braincheck-ui.js on #statusBtnLabel) into the hero's first
// checklist row, and swaps the hero out for the chat UI when "Open Frankie
// Chat" (or the sidebar "Chat with Frankie" link) is used.
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

  // ── Mirror the live status label (topbar) into the hero's status row ──
  function mirrorStatus() {
    const srcLabel = document.getElementById('statusBtnLabel');
    const dstLabel = document.getElementById('heroStatusLabel');
    if (!srcLabel || !dstLabel) return;

    const sync = () => { dstLabel.textContent = srcLabel.textContent; };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(srcLabel, { characterData: true, childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', function () {
    const openBtn = document.getElementById('heroOpenChat');
    if (openBtn) openBtn.onclick = showChat;

    const statusRow = document.getElementById('heroStatusRow');
    const statusBtn = document.getElementById('statusToggleBtn');
    if (statusRow && statusBtn) statusRow.onclick = () => statusBtn.click();

    mirrorStatus();
  });

  window.FrankieHero = { showChat, showHero };
})();
