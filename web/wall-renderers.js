(() => {
  "use strict";
  const Wall = window.Wall ||= {};

  // HTML-escape for text AND attribute contexts (quotes included, so a value
  // can't break out of a src="..."/href="..." attribute).
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // Allow http(s) URLs and same-origin rooted "/media/…" paths (self-hosted
  // Instagram covers/avatars) into src/href. Blocks javascript:, data:,
  // protocol-relative "//host", and backslash tricks.
  function safeUrl(u) {
    const s = String(u == null ? "" : u).trim();
    return (/^https?:\/\//i.test(s) || /^\/[^/\\]/.test(s)) ? s : "";
  }
  // A swipeable multi-image carousel (CSS scroll-snap — swiping works with no
  // JS; wall-app.js only updates the count/dots indicator on scroll). A one-item
  // array falls back to a single framed image. Rendered inside the Instagram
  // card (see insta()); any card with a multi-image `images` array routes there.
  function carousel(images) {
    const imgs = (Array.isArray(images) ? images : []).map(safeUrl).filter(Boolean);
    if (!imgs.length) return "";
    if (imgs.length === 1) return `<div class="media-wrap"><img class="media" src="${esc(imgs[0])}" alt=""></div>`;
    const slides = imgs.map(u => `<img class="media carousel-slide" src="${esc(u)}" alt="">`).join("");
    const dots = imgs.map((_, idx) => `<span class="carousel-dot${idx === 0 ? " active" : ""}"></span>`).join("");
    return `<div class="carousel">
        <div class="carousel-track">${slides}</div>
        <span class="carousel-count">1/${imgs.length}</span>
        <div class="carousel-dots">${dots}</div>
      </div>`;
  }
  function av(i, cls) {
    const initial = ((i.author || "?").trim()[0] || "?").toUpperCase();
    // data-initial lets the error handler restore the letter when a signed
    // avatar URL fails to load (common for Instagram/CDN images off-platform).
    return `<div class="avatar ${cls || ""}" data-initial="${esc(initial)}">${i.avatar ? `<img src="${esc(safeUrl(i.avatar))}" alt="">` : initial}</div>`;
  }
  const I = { // icon paths (24x24 viewBox)
    reply: '<path d="M12 3c5 0 9 3.6 9 8s-4 8-9 8c-1 0-2-.14-2.9-.4L4 21l1.3-3.9C3.9 15.7 3 13.9 3 11c0-4.4 4-8 9-8z"/>',
    rt: '<path d="M4 9l3-3 3 3M7 6v9a3 3 0 0 0 3 3h2M20 15l-3 3-3-3M17 18V9a3 3 0 0 0-3-3h-2"/>',
    like: '<path d="M12 20s-7.5-4.7-9.3-9C1.2 7.2 3.6 4 6.6 4c2 0 3.6 1.1 4.4 2.7h2C13.8 5.1 15.4 4 17.4 4c3 0 5.4 3.2 3.9 7-1.8 4.3-9.3 9-9.3 9z"/>',
    views: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    bmk: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
    share: '<path d="M12 3v13M7 8l5-5 5 5M5 15v5h14v-5"/>',
    comment: '<path d="M21 12a8 8 0 0 1-8 8H4l2-3.2A8 8 0 1 1 21 12z"/>'
  };
  const icon = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
  const kb = i => i.kbNote
    ? ` <a class="kb" data-read-id="${esc(i.id)}" href="obsidian://open?vault=obsidian-vault&file=${encodeURIComponent(i.kbNote.replace(/\.md$/, ""))}">notes ↗</a>`
    : "";
  // Why your algorithm surfaced this — the legible-ranking layer — plus the
  // more/less feedback pills that teach it (stored locally, read by the sweep agent).
  const fb = i => i.id
    ? `<span class="fb" data-id="${esc(i.id)}"><button class="fb-ask" title="ask an AI about this">✦</button><button class="fb-note" title="tell your algorithm">✎</button><button class="fb-more" title="more like this">＋</button><button class="fb-less" title="less like this">－</button><button class="fb-read" title="mark read">✓</button></span>`
    : "";
  // shelf-life chip: how long this card stays on the wall unread; tapping it
  // opens the "keep longer / already stale" correction (wall-feedback.js).
  const shelfChip = i => {
    const shelf = i.shelf, expires = Wall.shelfLife?.expiresAt(i);
    if (!shelf || expires == null) return "";
    const days = Math.max(0, Math.ceil((expires - Date.now()) / 864e5));
    const label = shelf.until
      ? `until ${new Date(`${shelf.until}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
      : `${shelf.life} · ${days}d`;
    return ` <button class="shelf-chip" data-id="${esc(i.id)}" title="${esc(shelf.reason || "")} — tap to correct">${esc(label)}</button>`;
  };
  const why = (i, cls) => `<div class="why ${cls || ""}"><span class="whytext">${
    i.why ? `<span class="mark">✦</span> ${esc(i.why)}${i.score != null ? ` · <b>${esc(String(i.score))}/10</b>` : ""}` : ""
  }${shelfChip(i)}</span>${fb(i)}</div>`;

  const timeOf = i => esc(i.postedAt || i.collectedAt);
  const categoryPill = i => i.category ? `<span class="catpill">${esc(i.category)}</span>` : "";
  const noteBlock = (i, cls) => i.note || i.kbNote
    ? `<div class="note${cls ? ` ${cls}` : ""}">${esc(i.note || "")}${kb(i)}</div>`
    : "";
  const opennessAddon = i => Wall.openness?.cardAddon?.(i) || "";
  const action = (kind, value) => kind === "share"
    ? `<span class="act-share" role="button" tabindex="0" title="Copy link" aria-label="Copy link">${icon(I[kind])}${esc(value || "")}</span>`
    : `<span>${icon(I[kind])}${esc(value || "")}</span>`;

  // X and article cards share the same outer shell. Sources only supply the
  // badge, media behavior, and action row that differ between them.
  function feedCard(i, { badge = "", linkMedia = "", afterLink = "", actions = "" } = {}) {
    return `<article class="tweet" data-item-id="${esc(i.id)}">
      ${av(i)}
      <div class="body">
        <div class="head">
          <span class="name">${esc(i.author)}</span>
          ${badge ? `<span class="srcbadge src-${esc(i.source)}">${esc(badge)}</span>` : ""}
          <span class="handle">${esc(i.handle || "")}</span><span class="dot">·</span>
          <span class="time">${timeOf(i)}</span>
          ${categoryPill(i)}
        </div>
        <a class="orig" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener"><div class="text">${esc(i.text)}</div>${linkMedia}</a>
        ${afterLink}
        <div class="actions">${actions}</div>
        ${why(i)}
        ${noteBlock(i)}
        ${opennessAddon(i)}
      </div>
    </article>`;
  }

  function tweet(i) {
    const s = i.stats || {};
    return feedCard(i, {
      linkMedia: i.image ? `<img class="media" src="${esc(safeUrl(i.image))}" alt="">` : "",
      actions: [
        action("reply", s.replies), action("rt", s.reposts), action("like", s.likes),
        action("views", s.views), action("bmk"), action("share")
      ].join("")
    });
  }

  function insta(i) {
    const s = i.stats || {};
    const uname = (i.handle || i.author || "").replace(/^@/, "");
    const isReel = i.kind === "reel";
    const link = `href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener"`;
    // Media area, in priority order: a self-hosted reel plays inline (cover
    // facade → <video> on click, like the YouTube cards, so it isn't wrapped in
    // the outbound link); otherwise the cover/photo links to the original; and
    // with no image at all, the branded text card. The reel ▶ badge stays a
    // plain cue on cover-only reels (no video to play).
    const hasCarousel = Array.isArray(i.images) && i.images.length > 1;
    let media;
    if (isReel && i.video) {
      media = `<div class="media-wrap ig-play" data-video="${esc(safeUrl(i.video))}" role="button" tabindex="0" aria-label="Play reel inline"><img class="media" src="${esc(safeUrl(i.image))}" alt=""><span class="play-badge"></span></div>`;
    } else if (hasCarousel) {
      // Multi-image carousel: swipes in place (a count + dots cue the extra images).
      media = carousel(i.images);
    } else if (i.image) {
      media = `<a class="orig" ${link}><div class="media-wrap"><img class="media" src="${esc(safeUrl(i.image))}" alt="">${isReel ? `<span class="reel-badge">▶</span>` : ""}</div></a>`;
    } else {
      media = `<a class="orig" ${link}><div class="textonly">${esc(i.text)}</div></a>`;
    }
    const hasMedia = i.image || hasCarousel;
    // reels report reach as views; photos as likes.
    const count = isReel && s.views ? `${esc(s.views)} views`
                : s.likes ? `${esc(s.likes)} likes` : "";
    return `<article class="ig" data-item-id="${esc(i.id)}" data-text="${esc(i.text)}">
      <div class="head">${av(i)}<span>${esc(uname)}</span>
          ${categoryPill(i)}<span class="more">···</span></div>
      ${media}
      <div class="actions">${icon(I.like)}${icon(I.comment)}<span class="act-share" role="button" tabindex="0" title="Copy link" aria-label="Copy link">${icon(I.share)}</span><span class="save">${icon(I.bmk)}</span></div>
      ${count ? `<div class="likes">${count}</div>` : ""}
      ${hasMedia ? `<div class="caption"><b>${esc(uname)}</b>${esc(i.text)}</div>` : ""}
      <div class="time">${timeOf(i)}</div>
      ${opennessAddon(i)}
    </article>
    ${why(i, "why-ig")}
    ${noteBlock(i, "note-ig")}`;
  }

  function linkcard(i) {
    // A lone image leads the card (image on top, text as the caption below).
    // Multi-image carousels never reach here — they route to the Instagram
    // renderer via isGallery() — so this only handles the single-image case.
    const media = i.image
      ? `<a class="orig" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener"><img class="media" src="${esc(safeUrl(i.image))}" alt=""></a>`
      : "";
    return `<article class="linkcard${media ? " has-media" : ""}" data-item-id="${esc(i.id)}">
      <div class="head"><span class="name">${esc(i.author)}</span>
        <span class="time">${timeOf(i)}</span>
        ${categoryPill(i)}</div>
      ${media}
      <a class="orig" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener"><div class="text">${esc(i.text)}</div></a>
      ${why(i)}
      ${noteBlock(i)}
      ${opennessAddon(i)}
    </article>`;
  }

  function quizCard(i) {
    const learning = i.learning || {};
    const question = learning.question || {};
    const choices = Array.isArray(question.choices) ? question.choices : [];
    return `<article class="quizcard" data-learning-card="true" data-item-id="${esc(i.id)}"
      data-track="${esc(learning.trackId)}" data-concept="${esc(learning.conceptId)}" data-question="${esc(learning.questionIndex)}">
      <div class="quiz-head">
        <span class="quiz-badge">recall</span>
        <span>${esc(learning.trackTitle)}</span>
        <span class="quiz-progress">review ${esc(learning.reviewNumber)} of ${esc(learning.reviewTotal)}</span>
      </div>
      <div class="quiz-rung">${esc(learning.unitLabel || "Unit")} ${esc(learning.rung)} · ${esc(learning.conceptTitle)}</div>
      <div class="quiz-prompt">${esc(question.prompt)}</div>
      <div class="quiz-cue">Answer from memory before revealing the explanation.</div>
      <div class="quiz-choices">${choices.map((choice, index) =>
        `<button class="quiz-choice" data-choice="${index}"><span>${String.fromCharCode(65 + index)}</span>${esc(choice)}</button>`
      ).join("")}</div>
      <div class="quiz-result" hidden>
        <strong class="quiz-result-title"></strong>
        <span>${esc(question.explanation)}</span>
        ${learning.sourceUrl ? `<a href="${esc(safeUrl(learning.sourceUrl))}" target="_blank" rel="noopener">review source ↗</a>` : ""}
        <div class="quiz-next"></div>
      </div>
    </article>`;
  }

  const opennessCard = i => Wall.openness?.renderRuntimeCard?.(i) || "";

  // External sources (Hacker News, RSS, and the knowledge feed — Wikipedia, arXiv,
  // YouTube) — reuse the tweet layout with a source badge. Same why/score
  // legibility. YouTube gets a play overlay on its thumbnail and shows views.
  const SRC_BADGE = { hackernews: "HN", rss: "RSS", ft: "FT", wikipedia: "WIKI", arxiv: "arXiv", youtube: "▶ YT" };
  // pull the 11-char video id out of a YouTube watch/embed url
  const ytId = u => { const m = String(u || "").match(/[?&]v=([\w-]{11})/) || String(u || "").match(/(?:embed|shorts)\/([\w-]{11})/); return m ? m[1] : ""; };
  function article(i) {
    const s = i.stats || {};
    const badge = SRC_BADGE[i.source] || "LINK";
    const isVid = i.source === "youtube";
    const vid = isVid ? ytId(i.url) : "";
    // non-video sources: image sits inside the outbound link, as before.
    const inlineMedia = (!isVid && i.image) ? `<img class="media" src="${esc(safeUrl(i.image))}" alt="">` : "";
    // youtube: a click-to-play facade OUTSIDE the link — clicking swaps in an
    // inline iframe (see the feed handler below) instead of navigating away.
    const ytMedia = isVid && i.image
      ? (vid
          ? `<div class="media-wrap yt-play" data-yt="${esc(vid)}" role="button" tabindex="0" aria-label="Play video inline"><img class="media" src="${esc(safeUrl(i.image))}" alt=""><span class="play-badge"></span></div>`
          : `<span class="media-wrap"><img class="media" src="${esc(safeUrl(i.image))}" alt=""><span class="play-badge"></span></span>`)
      : "";
    return feedCard(i, {
      badge,
      linkMedia: inlineMedia,
      afterLink: ytMedia,
      actions: [
        s.likes ? action("like", s.likes) : "",
        s.replies ? action("comment", s.replies) : "",
        s.views ? action("views", s.views) : "",
        action("share")
      ].join("")
    });
  }

  // A market-thesis card: an actionable, FACT-CHECKED, sourced synthesis of the
  // low-signal macro/TA "signal" tweets the harvest folds in (they don't get their
  // own cards — see CLAUDE.md "Market-thesis synthesis"). Verdicts come from real
  // price history (collectors/market.mjs), not from the tweets. Everything is escaped.
  const VERDICT_CLASS = { "✓": "v-ok", "✗": "v-no", "~": "v-mid" };
  function thesisCard(i) {
    const t = i.thesis || {};
    const levels = Array.isArray(t.levels) ? t.levels : [];
    const fc = Array.isArray(t.factcheck) ? t.factcheck : [];
    const prov = Array.isArray(t.provenance) ? t.provenance : [];
    const b = t.bracket;
    const bias = String(t.bias || "");
    const dir = /short|bear|down|fade/i.test(bias) ? "bias-short"
              : /long|bull|up|buy/i.test(bias) ? "bias-long" : "bias-flat";
    return `<article class="tweet thesiscard" data-item-id="${esc(i.id)}">
      <div class="body">
        <div class="thead">
          <span class="tasset">${esc(t.asset || i.author)}</span>
          ${t.spot ? `<span class="tspot">${esc(t.spot)}</span>` : ""}
          <span class="tbias ${dir}">${esc(bias)}</span>
          ${t.conviction ? `<span class="tconv">${esc(t.conviction)} conviction</span>` : ""}
          <span class="time">${esc(t.asOf || i.postedAt || i.collectedAt)}</span>
          ${categoryPill(i)}
        </div>
        <div class="tactionable">${esc(i.text)}</div>
        ${b ? `<div class="tbracket">
          <span><em>trigger</em> ${esc(b.trigger)}</span>
          <span><em>invalidation</em> ${esc(b.invalidation)}</span>
          <span><em>targets</em> ${b.targets.map(x => esc(x)).join(" → ")}</span>
        </div>` : ""}
        ${levels.length ? `<table class="tlevels"><tbody>${levels.map(l => `<tr>
          <td class="tl-lvl">${esc(l.level)}</td>
          <td class="tl-role">${esc(l.role)}</td>
          <td class="tl-src">${l.url ? `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.src || "src")}</a>` : esc(l.src || "")}</td>
        </tr>`).join("")}</tbody></table>` : ""}
        ${fc.length ? `<div class="tfc"><div class="tfc-h">fact-check <span class="dim">· vs price history</span></div>${fc.map(f => `<div class="tfc-row">
          <span class="tfc-v ${VERDICT_CLASS[f.verdict] || ""}">${esc(f.verdict)}</span>
          <span class="tfc-c">${esc(f.claim)}${f.detail ? ` <span class="dim">— ${esc(f.detail)}</span>` : ""}</span>
        </div>`).join("")}</div>` : ""}
        ${t.reasoning ? `<div class="treason">${esc(t.reasoning)}</div>` : ""}
        ${t.flip ? `<div class="tflip"><em>flips if</em> ${esc(t.flip)}</div>` : ""}
        ${prov.length ? `<div class="tprov"><span class="dim">sources</span> ${prov.map(p =>
          `<a class="tprov-chip" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.handle)}${p.note ? `<span class="dim"> ${esc(p.note)}</span>` : ""}</a>`).join("")}</div>` : ""}
        ${why(i)}
        ${noteBlock(i)}
        ${opennessAddon(i)}
      </div>
    </article>`;
  }


  const renderers = {
    learning: quizCard,
    openness: opennessCard,
    thesis: thesisCard,
    twitter: tweet,
    instagram: insta,
    hackernews: article,
    rss: article,
    ft: article,
    wikipedia: article,
    arxiv: article,
    youtube: article,
    link: article
  };

  // A multi-image carousel (or an item explicitly marked kind:"carousel") is an
  // Instagram-style format, so render it with the full IG card — avatar, media,
  // the like/comment/share row, and the caption below — regardless of source.
  const isGallery = item => (Array.isArray(item.images) && item.images.length > 1) || item.kind === "carousel";
  Wall.renderers = {
    esc,
    renderItem: item => (isGallery(item) ? insta : (renderers[item.source] || linkcard))(item)
  };
})();
