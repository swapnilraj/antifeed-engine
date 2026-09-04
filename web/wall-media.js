(() => {
  "use strict";
  const Wall = window.Wall ||= {};

  function install({ feed, markEngaged }) {
    function playYouTube(el) {
      const id = el.dataset.yt;
      if (!id || el.classList.contains("playing")) return;
      el.classList.add("playing");
      const frame = document.createElement("iframe");
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
      frame.title = "YouTube video player";
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      el.replaceChildren(frame);
    }

    function playInstagram(el) {
      const src = el.dataset.video;
      if (!src || el.classList.contains("playing")) return;
      el.classList.add("playing");
      const video = document.createElement("video");
      video.src = src;
      video.className = "media";
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      el.replaceChildren(video);

      // Visibility-aware replay (not a blanket loop): while the reel is on
      // screen it replays on end; once it finishes while scrolled off it stays
      // stopped (no restart). Scrolling never pauses it, so a reel scrolled off
      // mid-play still runs to the end — and if you scroll back onto a finished
      // one, it replays. Visibility is measured live at the moment it matters,
      // so it never depends on a stale flag.
      const onScreen = () => {
        const r = video.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        if (!vh || r.height <= 0) return false;
        const shown = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        return shown / r.height >= 0.5;
      };
      const replay = () => { video.currentTime = 0; video.play().catch(() => {}); };
      video.addEventListener("ended", () => { if (onScreen()) replay(); });
      // Re-check on scroll so a finished reel replays when it comes back on screen.
      const io = new IntersectionObserver(() => {
        if (!video.isConnected) { io.disconnect(); return; }
        if (video.ended && onScreen()) replay();
      }, { threshold: [0, 0.5, 1] });
      io.observe(video);
    }

    // Replace expired media with the card's existing text or avatar fallback.
    feed.addEventListener("error", event => {
      const image = event.target;
      if (image?.tagName !== "IMG") return;
      const avatar = image.closest(".avatar");
      if (avatar) {
        avatar.textContent = avatar.dataset.initial || "?";
        return;
      }
      const wrap = image.closest(".media-wrap");
      const instagram = image.closest(".ig");
      if (instagram && wrap) {
        const fallback = document.createElement("div");
        fallback.className = "textonly";
        fallback.textContent = instagram.dataset.text || "";
        wrap.replaceWith(fallback);
        instagram.querySelector(".caption")?.remove();
        return;
      }
      (wrap || image).remove();
    }, true);

    feed.addEventListener("scroll", event => {
      const track = event.target.closest?.(".carousel-track");
      if (!track || !track.children.length) return;
      const index = Math.min(track.children.length - 1, Math.round(track.scrollLeft / track.clientWidth));
      const carousel = track.closest(".carousel");
      const count = carousel?.querySelector(".carousel-count");
      if (count) count.textContent = `${index + 1}/${track.children.length}`;
      carousel?.querySelectorAll(".carousel-dot").forEach((dot, i) => dot.classList.toggle("active", i === index));
    }, true);

    feed.addEventListener("click", event => {
      const facade = event.target.closest(".yt-play, .ig-play");
      if (facade) {
        markEngaged(facade);
        (facade.classList.contains("yt-play") ? playYouTube : playInstagram)(facade);
        return;
      }
      if (event.target.closest("a.orig, a.kb, .tprov a, .tl-src a")) markEngaged(event.target);
    });

    feed.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const facade = event.target.closest(".yt-play, .ig-play");
      if (!facade) return;
      event.preventDefault();
      markEngaged(facade);
      (facade.classList.contains("yt-play") ? playYouTube : playInstagram)(facade);
    });
  }

  Wall.media = { install };
})();
