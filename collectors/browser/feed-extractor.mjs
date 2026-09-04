// Builds an in-page expression that switches the x.com/home timeline between its
// "For you" and "Following" tabs. Switching a feed tab is read-only navigation —
// it likes/follows/posts nothing — and it unlocks the highest-signal X source:
// the accounts Swapnil actually chose to follow. Returns which tab ended up
// selected so the caller can label `via` truthfully (and note a gap if the click
// didn't take). `want` is "following" or "for-you".
export function selectFeedExpression(want = "following") {
  return `(async () => {
    const WANT = ${JSON.stringify(want)};
    const norm = s => (s || "").trim().toLowerCase().replace(/\\s+/g, " ");
    const target = WANT === "for-you" ? "for you" : "following";
    const tabsOf = () => [...document.querySelectorAll('[role="tab"]')]
      .map(el => ({ el, text: norm(el.innerText), selected: el.getAttribute("aria-selected") === "true" }))
      .filter(t => t.text === "for you" || t.text === "following");
    let tabs = tabsOf();
    const found = tabs.find(t => t.text === target);
    if (!found) return JSON.stringify({ ok: false, requested: WANT, selected: null, tabs: tabs.map(t => t.text), reason: "tab not found" });
    if (!found.selected) {
      found.el.click();
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 250));
        if (tabsOf().find(t => t.text === target)?.selected) break;
      }
    }
    const now = tabsOf().find(t => t.selected);
    const selected = now ? now.text.replace("for you", "for-you") : null;
    return JSON.stringify({ ok: selected === WANT, requested: WANT, selected, tabs: tabsOf().map(t => t.text) });
  })()`;
}

// Builds an in-page, read-only extractor. It accumulates posts while scrolling so
// virtualized feeds can be sampled in one CDP round trip.
export function harvestExpression(rounds, step = 900, settle = 1200) {
  return `(async () => {
    const ROUNDS = ${rounds}, STEP = ${step}, SETTLE = ${settle};
    const seen = new Map();
    const extractX = () => {
      for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
        try {
          const permalink = [...a.querySelectorAll('a[href*="/status/"]')]
            .map(x => x.getAttribute('href')).find(h => /\\/status\\/\\d+$/.test(h));
          if (!permalink) continue;
          const idm = permalink.match(/status\\/(\\d+)/);
          const sid = idm ? idm[1] : permalink;
          if (seen.has(sid)) continue;
          const timeEl = a.querySelector('time');
          const postedAt = timeEl ? timeEl.getAttribute('datetime') : null;
          const textEl = a.querySelector('[data-testid="tweetText"]');
          const text = textEl ? textEl.innerText : '';
          const nameBlock = a.querySelector('[data-testid="User-Name"]');
          let author = '', handle = '';
          if (nameBlock) {
            const parts = nameBlock.innerText.split('\\n').filter(Boolean);
            author = parts[0] || '';
            handle = parts.find(s => s.startsWith('@')) || '';
          }
          const avatar = (a.querySelector('img[src*="profile_images"]') || {}).src || '';
          const image = (a.querySelector('img[src*="/media/"]') || {}).src || '';
          const stats = {};
          const grp = a.querySelector('[role="group"][aria-label]');
          if (grp) {
            const label = grp.getAttribute('aria-label') || '';
            const map = { repl:'replies', repost:'reposts', like:'likes', view:'views', bookmark:'bookmarks' };
            for (const piece of (label.match(/([\\d,.KM]+)\\s+(repl|repost|like|view|bookmark)/gi) || [])) {
              const mm = piece.match(/([\\d,.KM]+)\\s+(repl|repost|like|view|bookmark)/i);
              if (mm) stats[map[mm[2].toLowerCase()]] = mm[1];
            }
          }
          seen.set(sid, { id: sid, permalink, postedAt, author, handle, text, avatar, image, stats });
        } catch (e) {}
      }
    };
    const extract = extractX;
    extract();
    for (let i = 0; i < ROUNDS; i++) {
      window.scrollBy(0, STEP);
      const last = document.querySelector('article:last-of-type');
      if (last) last.scrollIntoView({ block: 'end' });
      await new Promise(r => setTimeout(r, SETTLE));
      extract();
    }
    return JSON.stringify([...seen.values()]);
  })()`;
}
