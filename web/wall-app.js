(async () => {
  "use strict";
  const Wall = window.Wall;
  const items = window.WALL_ITEMS || [];
  const { esc, renderItem } = Wall.renderers;
  const { ordered, newIds, wasRead, markRead } = Wall.state;
  const feed = document.getElementById("feed");
  const learningCards = Wall.learning
    ? await Wall.learning.createCards({ items }).catch(() => [])
    : [];
  const opennessCards = Wall.openness
    ? await Wall.openness.init({ items }).catch(() => [])
    : [];
  const displayOrder = ordered.slice();
  let learningCursor = 0;
  learningCards.forEach((card, index) => {
    if (index) learningCursor += (card.learning?.interleaveEvery || 7) + 1;
    displayOrder.splice(Math.min(learningCursor, displayOrder.length), 0, card);
  });
  opennessCards.sort((a, b) => a.insertAfter - b.insertAfter).forEach(card => {
    displayOrder.splice(Math.min(card.insertAfter, displayOrder.length), 0, card);
  });
  const initiallyRead = new Set(items.filter(item => wasRead(item.id)).map(item => item.id));
  let activeSource = "all";
  let activeCategory = "all";

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

  function render() {
    const shown = displayOrder.filter(item =>
      !(item.source === "learning" && Wall.learning?.wasAnswered(item.id)) &&
      (activeSource === "all" || item.source === activeSource) &&
      (activeCategory === "all" || item.category === activeCategory));

    feed.innerHTML = shown.map(renderItem).join("");
    feed.querySelectorAll("article[data-item-id]").forEach(card => {
      const id = cardId(card);
      card.classList.toggle("isnew", newIds.has(id));
      card.classList.toggle("isread", wasRead(id));
    });

    const firstRead = shown.find(item => initiallyRead.has(item.id));
    if (firstRead && shown.some(item => !initiallyRead.has(item.id))) {
      const divider = document.createElement("div");
      divider.className = "caughtup";
      divider.textContent = "caught up — everything below you've already read";
      feed.querySelector(`article[data-item-id="${escapedId(firstRead.id)}"]`)?.before(divider);
    }

    feedback.paint();
    readTracker.arm();
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
    document.getElementById("end").innerHTML = newIds.size
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
  buildEnd();
})();
