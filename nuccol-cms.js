/**
 * nuccol-cms.js
 * Fetches page content from Azure Blob Storage and injects it into the live site.
 * Each HTML page includes this script with data-page="<slug>" e.g.:
 *   <script src="nuccol-cms.js" data-page="about"></script>
 *
 * Data is saved from scc.html → site-pages/{slug}.json in the content container.
 */
(function () {
  const BLOB_BASE = 'https://nuccolmedia.blob.core.windows.net/content';
  const BLOB_SAS  = 'sv=2026-02-06&ss=b&srt=o&sp=rwdctfx&se=2032-01-01T20:14:16Z&st=2026-06-16T10:59:16Z&spr=https&sig=JVx5ozHDrnCCcLKtK6npIZrswRrTi9njeifMBXgRHg4%3D';

  async function loadBlob(slug) {
    try {
      const r = await fetch(`${BLOB_BASE}/site-pages/${slug}.json?${BLOB_SAS}&t=${Date.now()}`);
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[nuccol-cms] Could not load', slug, e);
      return [];
    }
  }

  // Set text content if element exists and value is non-empty
  function setText(id, val) {
    if (!val) return;
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // Set innerHTML (for rich text / tags inside elements)
  function setHtml(id, val) {
    if (!val) return;
    const el = document.getElementById(id);
    if (el) el.innerHTML = val;
  }

  // Set hero background image on page-header
  function setPageHeaderBg(imageUrl) {
    if (!imageUrl) return;
    const ph = document.querySelector('.page-header');
    if (ph) {
      ph.style.backgroundImage = `url('${imageUrl}')`;
      ph.style.backgroundSize = 'cover';
      ph.style.backgroundPosition = 'center';
    }
  }

  // ─── PAGE HANDLERS ────────────────────────────────────────────────────────

  const handlers = {

    // ── INDEX ──────────────────────────────────────────────────────────────
    index: async () => {
      const rows = await loadBlob('index');
      if (!rows.length) return;

      const slides = rows.filter(r => r.section === 'Hero Slide').sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const cards  = rows.filter(r => r.section === 'Market Card').sort((a, b) => (a.sort || 0) - (b.sort || 0));

      // Replace gallery slides (duplicated for infinite scroll)
      if (slides.length) {
        const track = document.getElementById('galleryTrack');
        if (track) {
          const slideHtml = slides.map(s =>
            `<div class="gallery-slide" style="background-image:url('${escAttr(s.imageUrl)}')" data-alt="${escAttr(s.alt || '')}"></div>`
          ).join('');
          track.innerHTML = slideHtml + slideHtml; // duplicate for infinite scroll

          // Rebuild dots
          const dots = document.getElementById('galleryDots');
          if (dots) {
            dots.innerHTML = slides.map((_, i) =>
              `<span${i === 0 ? ' class="active"' : ''}></span>`
            ).join('');
          }

          // Update caption
          const cap = document.getElementById('galleryCaption');
          if (cap && slides[0] && slides[0].alt) cap.textContent = slides[0].alt;
        }
      }

      // Replace market/sector cards
      if (cards.length) {
        const grid = document.getElementById('we-sectors-grid');
        if (grid) {
          grid.innerHTML = cards.map(c => `
            <a href="${escAttr(c.linkUrl || 'markets.html')}" style="text-decoration:none;display:block;">
              <div class="sector-card">
                <img src="${escAttr(c.imageUrl)}" alt="${escAttr(c.label || '')}">
                <div class="sector-label">${escHtml(c.label || '')}</div>
              </div>
            </a>`).join('') +
            `<div class="sector-card" style="background:var(--navy2);display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;padding:28px;">
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:3rem;font-weight:800;color:var(--cyan);opacity:.4;line-height:1;">+</div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:.88rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--grey);text-align:center;">More Sectors</div>
              <a href="services.html" style="font-size:.78rem;color:var(--cyan);text-decoration:none;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">View All →</a>
            </div>`;
        }
      }
    },

    // ── ABOUT ──────────────────────────────────────────────────────────────
    about: async () => {
      const [rows, teamRows] = await Promise.all([loadBlob('about'), loadBlob('about-team')]);

      // Hero
      const hero = rows.find(r => r.section === 'Hero');
      if (hero) {
        setText('we-hero_title', hero.title);
        setText('we-hero_sub', hero.body);
        setPageHeaderBg(hero.imageUrl);
      }

      // Our Story paragraphs (in sort order)
      const story = rows.filter(r => r.section === 'Our Story').sort((a, b) => (a.sort || 0) - (b.sort || 0));
      story.forEach((r, i) => {
        if (r.body) setText(`we-story_p${i + 1}`, r.body);
      });

      // Team intro
      const teamSection = rows.find(r => r.section === 'Team');
      if (teamSection && teamSection.body) setText('we-team_intro', teamSection.body);

      // Team grid
      if (teamRows.length) {
        const grid = document.getElementById('we-team-grid');
        if (grid) {
          const sorted = teamRows.sort((a, b) => (a.sort || 0) - (b.sort || 0));
          grid.innerHTML = sorted.map(p => {
            const tags = (p.tags || '').split(',').map(t => t.trim()).filter(Boolean);
            const initials = (p.title || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
            const photoHtml = p.imageUrl
              ? `<img class="toc-img" src="${escAttr(p.imageUrl)}" alt="${escAttr(p.title || '')}" loading="lazy">`
              : `<div class="toc-initials">${escHtml(initials)}</div>`;
            const personId = (p.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            return `<div class="team-card" data-person="${escAttr(personId)}" onclick="openModal('${escAttr(personId)}')">
              <div class="toc-photo">${photoHtml}</div>
              <div class="toc-name">${escHtml(p.title || '')}</div>
              <div class="toc-role">${escHtml(p.role || '')}</div>
            </div>`;
          }).join('');

          // Rebuild PEOPLE lookup so modals still work
          window.PEOPLE = {};
          sorted.forEach(p => {
            const id = (p.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const tags = (p.tags || '').split(',').map(t => t.trim()).filter(Boolean)
              .map(t => `<span class="modal-tag">${escHtml(t)}</span>`).join('');
            window.PEOPLE[id] = {
              name: p.title || '',
              role: p.role || '',
              bio: p.body || '',
              tags,
              linkedin: p.linkUrl || '#'
            };
          });
        }
      }
    },

    // ── EVENTS ─────────────────────────────────────────────────────────────
    events: async () => {
      const rows = await loadBlob('events');

      const summit = rows.filter(r => r.section === 'Summit 2026').sort((a, b) => (a.sort || 0) - (b.sort || 0));
      if (summit[0]) {
        setText('we-summit_title', summit[0].title);
        setText('we-summit_body', summit[0].body);
        if (summit[0].imageUrl) {
          const img = document.getElementById('we-summit_img');
          if (img) img.src = summit[0].imageUrl;
        }
      }
      if (summit[1]) setText('we-summit_date', summit[1].title);

      const webinar = rows.filter(r => r.section === 'Webinars').sort((a, b) => (a.sort || 0) - (b.sort || 0));
      if (webinar[0]) {
        setText('we-webinar_title', webinar[0].title);
        setText('we-webinar_body', webinar[0].body);
        if (webinar[0].imageUrl) {
          const img = document.getElementById('we-webinar_img');
          if (img) img.src = webinar[0].imageUrl;
        }
      }
      if (webinar[1]) setText('we-webinar_date', webinar[1].title);
    },

    // ── F4N ────────────────────────────────────────────────────────────────
    f4n: async () => {
      const rows = await loadBlob('f4n');

      const hero = rows.find(r => r.section === 'Hero');
      if (hero) {
        setText('we-hero_title', hero.title);
        setText('we-hero_sub', hero.body);
        setPageHeaderBg(hero.imageUrl);
      }

      const howIt = rows.filter(r => r.section === 'How It Works').sort((a, b) => (a.sort || 0) - (b.sort || 0));
      howIt.forEach((r, i) => {
        if (r.body) setText(`we-f4n_how_p${i + 1}`, r.body);
        if (r.title && i === 0) setText('we-f4n_how_title', r.title);
      });

      const benefits = rows.find(r => r.section === 'Benefits');
      if (benefits) {
        setText('we-f4n_benefits_title', benefits.title);
        setText('we-f4n_benefits_body', benefits.body);
      }

      const companies = rows.find(r => r.section === 'Companies');
      if (companies) setText('we-f4n_community_body', companies.body);
    },

    // ── F4N COMPANIES ──────────────────────────────────────────────────────
    'f4n-companies': async () => {
      const rows = await loadBlob('f4n-companies');
      if (!rows.length) return;

      const granted = rows.filter(r => r.section === 'Granted').sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const journey = rows.filter(r => r.section === 'Journey').sort((a, b) => (a.sort || 0) - (b.sort || 0));

      const renderCards = (items) => items.map(c => `
        <a href="${escAttr(c.linkUrl || '#')}" target="${c.linkUrl && c.linkUrl !== '#' ? '_blank' : '_self'}" rel="noopener" class="f4n-company-card" style="text-decoration:none;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;border:1px solid #dde4ee;border-radius:6px;background:#fff;transition:box-shadow .2s" onmouseover="this.style.boxShadow='0 4px 18px rgba(41,182,232,0.12)'" onmouseout="this.style.boxShadow='none'">
          ${c.imageUrl ? `<img src="${escAttr(c.imageUrl)}" alt="${escAttr(c.title || '')}" loading="lazy" style="max-height:60px;max-width:160px;object-fit:contain;margin-bottom:10px">` : ''}
          <div style="font-weight:600;font-size:.85rem;text-align:center;color:var(--navy)">${escHtml(c.title || '')}</div>
          ${c.body ? `<div style="font-size:.75rem;color:#6a7a90;text-align:center;margin-top:4px;line-height:1.4">${escHtml(c.body)}</div>` : ''}
        </a>`).join('');

      const grantedEl = document.getElementById('f4n-granted-grid');
      if (grantedEl && granted.length) grantedEl.innerHTML = renderCards(granted);

      const journeyEl = document.getElementById('f4n-journey-grid');
      if (journeyEl && journey.length) journeyEl.innerHTML = renderCards(journey);
    },

    // ── MEMBERS ────────────────────────────────────────────────────────────
    members: async () => {
      const rows = await loadBlob('members');

      const hero = rows.find(r => r.section === 'Hero');
      if (hero) {
        setText('we-hero_title', hero.title);
        setText('we-hero_sub', hero.body);
      }

      const welcome = rows.find(r => r.section === 'Welcome');
      if (welcome) {
        setText('we-welcome_title', welcome.title);
        setText('we-welcome_body', welcome.body);
      }
    },

    // ── WHAT WE DO (services.html) ─────────────────────────────────────────
    'what-we-do': async () => {
      const rows = await loadBlob('what-we-do');

      const hero = rows.find(r => r.section === 'Hero');
      if (hero) {
        setText('we-hero_title', hero.title);
        setText('we-hero_sub', hero.body);
        setPageHeaderBg(hero.imageUrl);
      }

      const services = rows.filter(r => r.section === 'Services').sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const serviceEls = document.querySelectorAll('.we-service-card');
      services.forEach((s, i) => {
        if (serviceEls[i]) {
          const h = serviceEls[i].querySelector('.we-service-title');
          const p = serviceEls[i].querySelector('.we-service-body');
          if (h && s.title) h.textContent = s.title;
          if (p && s.body)  p.textContent = s.body;
        }
      });
    },
  };

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(str) {
    return String(str || '').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
  }

  // ─── BOOT ─────────────────────────────────────────────────────────────────
  const script = document.currentScript;
  const page = script ? script.getAttribute('data-page') : null;
  if (!page || !handlers[page]) return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handlers[page]);
  } else {
    handlers[page]();
  }
})();
