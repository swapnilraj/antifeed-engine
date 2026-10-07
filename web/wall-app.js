(() => {
  "use strict";
  const Wall = window.Wall;
  const items = window.WALL_ITEMS || [];
  const { esc, renderItem } = Wall.renderers;
  const { ordered, newIds, wasRead, markRead } = Wall.state;
  const feed = document.getElementById("feed");
  const end = document.getElementById("end");
  const PAGE_SIZE = 24;
  let learningCards = [];
  let opennessCards = [];
  let displayOrder = [];
  function rebuildDisplayOrder() {
    displayOrder = ordered.slice();
    let learningCursor = 0;
    learningCards.forEach((card, index) => {
      if (index) learningCursor += (card.learning?.interleaveEvery || 7) + 1;
      displayOrder.splice(Math.min(learningCursor, displayOrder.length), 0, card);
    });
    opennessCards.sort((a, b) => a.insertAfter - b.insertAfter).forEach(card => {
      displayOrder.splice(Math.min(card.insertAfter, displayOrder.length), 0, card);
    });
  }
  rebuildDisplayOrder();
  const initiallyRead = new Set(items.filter(item => wasRead(item.id)).map(item => item.id));
  let activeSource = "all";
  let activeCategory = "all";
  let shown = [];
  let renderedCount = 0;

  const escapedId = id => window.CSS?.escape ? CSS.escape(id) : id;
  const cardId = element => element?.dataset?.itemId;
  // one-way: reads paint the card, but never light the ✓ button — only a press does
  const paintRead = id => feed.querySelector(`article[data-item-id="${escapedId(id)}"]`)?.classList.add("isread");
  const itemById = Object.fromEntries(items.filter(item => item.id).map(item => [item.id, item]));

  const readTracker = Wall.readTracking.createReadTracker({
    container: feed,
    selector: "article:not([data-learning-card]):not([data-openness-card])",
    getId: cardId,
    itemById,
    wasRead,
    markRead: id => {
      markRead(id);
      paintRead(id);
    },
  });

  const markEngaged = target => {
    const id = target?.dataset?.readId || cardId(target?.closest("article"));
    if (id) readTracker.markExplicit(id);
  };

  const feedback = Wall.feedback.create({ feed, items, readTracker });
  Wall.media.install({ feed, markEngaged });
  Wall.learning?.install({ feed });
  Wall.openness?.install({ feed });

  // Share: copy the card's original post link to the clipboard. The clipboard
  // API needs a secure context (https); the wall is also opened over file://
  // locally, so fall back to the execCommand path there.
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through to the legacy path */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  function flashShare(el, state) {
    el.classList.remove("copied", "copyfail");
    void el.offsetWidth; // restart the flash if clicked again quickly
    el.classList.add(state);
    window.setTimeout(() => el.classList.remove(state), 1400);
  }

  function shareFrom(el) {
    const item = itemById[cardId(el.closest("article[data-item-id]"))];
    const url = item && item.url;
    if (!url) { flashShare(el, "copyfail"); return; } // house cards have no source link
    copyText(url).then(ok => flashShare(el, ok ? "copied" : "copyfail"));
    markEngaged(el);
  }

  feed.addEventListener("click", event => {
    const share = event.target.closest(".act-share");
    if (!share || !feed.contains(share)) return;
    event.preventDefault();
    shareFrom(share);
  });
  feed.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const share = event.target.closest(".act-share");
    if (!share || !feed.contains(share)) return;
    event.preventDefault();
    shareFrom(share);
  });

  function placeReadDivider() {
    if (feed.querySelector(".caughtup")) return;
    const firstRead = shown.find(item => initiallyRead.has(item.id));
    if (firstRead && shown.some(item => !initiallyRead.has(item.id))) {
      const divider = document.createElement("div");
      divider.className = "caughtup";
      divider.textContent = "caught up — everything below you've already read";
      feed.querySelector(`article[data-item-id="${escapedId(firstRead.id)}"]`)?.before(divider);
    }
  }

  function appendNextPage(count = PAGE_SIZE) {
    if (renderedCount >= shown.length) return;
    const next = Math.min(renderedCount + count, shown.length);
    const page = shown.slice(renderedCount, next);
    feed.insertAdjacentHTML("beforeend", page.map(renderItem).join(""));
    renderedCount = next;
    page.forEach(item => {
      const card = feed.querySelector(`article[data-item-id="${escapedId(item.id)}"]`);
      if (!card) return;
      card.classList.toggle("isnew", newIds.has(item.id));
      card.classList.toggle("isread", wasRead(item.id));
    });
    placeReadDivider();
    feedback.paint();
    readTracker.arm();
    buildEnd();
  }

  function render(limit = PAGE_SIZE) {
    shown = displayOrder.filter(item =>
      !(item.source === "learning" && Wall.learning?.wasAnswered(item.id)) &&
      (activeSource === "all" || item.source === activeSource) &&
      (activeCategory === "all" || item.category === activeCategory));
    feed.innerHTML = "";
    renderedCount = 0;
    appendNextPage(Math.max(PAGE_SIZE, limit));
    if (!shown.length) buildEnd();
  }

  function installFilters(element, values, select, label = value => value) {
    element.innerHTML = values.map(value =>
      `<button data-value="${esc(value)}" ${value === "all" ? 'class="active"' : ""}>${esc(label(value))}</button>`
    ).join("");
    element.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      select(button.dataset.value);
      element.querySelectorAll("button").forEach(candidate => candidate.classList.toggle("active", candidate === button));
      button.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      render();
    });
  }

  function buildEnd() {
    const total = items.filter(item => item.id).length;
    if (renderedCount < shown.length) {
      end.innerHTML = `<b>${renderedCount}</b> of ${shown.length} cards shown — scroll for more.`;
      return;
    }
    end.innerHTML = newIds.size
      ? `You're caught up on ${newIds.size} new. <b>${total}</b> cards of signal, zero noise — come back tomorrow.`
      : `<b>${total}</b> cards of signal, zero noise. The wall ends here — that's the point.`;
  }

  function installAutoHideHeader() {
    const header = document.querySelector("header");
    let lastY = window.scrollY;
    window.addEventListener("scroll", () => {
      const y = window.scrollY;
      if (y <= header.offsetHeight || y < lastY - 4) header.classList.remove("hdr-hide");
      else if (y > lastY + 4) header.classList.add("hdr-hide");
      lastY = y;
    }, { passive: true });
  }

  const sources = ["all", ...new Set(items.map(item => item.source))];
  const categories = ["all", ...new Set(items.map(item => item.category).filter(Boolean))];
  installFilters(document.getElementById("filters"), sources, value => activeSource = value,
    value => value === "all" ? "For you" : value);
  installFilters(document.getElementById("catFilters"), categories, value => activeCategory = value);
  installAutoHideHeader();
  render();

  const pageObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) appendNextPage();
  }, { rootMargin: "900px 0px" });
  pageObserver.observe(end);

  // Learning and openness sync with the server, but neither should hold the
  // first screen hostage. Paint the normal wall first, then merge any runtime
  // cards while preserving the reader's position.
  Promise.all([
    Wall.learning ? Wall.learning.createCards({ items }).catch(() => []) : [],
    Wall.openness ? Wall.openness.init({ items }).catch(() => []) : [],
  ]).then(([nextLearning, nextOpenness]) => {
    learningCards = nextLearning;
    opennessCards = nextOpenness;
    feedback.paint();
    if (!learningCards.length && !opennessCards.length) return;
    const anchor = [...feed.querySelectorAll("article[data-item-id]")]
      .find(card => card.getBoundingClientRect().bottom > 0);
    const anchorId = cardId(anchor);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const limit = renderedCount;
    rebuildDisplayOrder();
    render(limit);
    if (anchorId && anchorTop != null) requestAnimationFrame(() => {
      const restored = feed.querySelector(`article[data-item-id="${escapedId(anchorId)}"]`);
      if (restored) window.scrollBy(0, restored.getBoundingClientRect().top - anchorTop);
    });
  });
})();
