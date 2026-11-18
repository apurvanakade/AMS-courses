// One-time "built for a bigger screen" notice, shown only below 992px
// (the same breakpoint VisualMathLab uses). The course map lays every
// level out side by side, which a phone can't show at a readable size, so
// the notice says so up front instead of leaving the visitor to discover
// it. Shown once, then remembered in localStorage under STORAGE_KEY.

const BREAKPOINT = "(max-width: 991.98px)";
const STORAGE_KEY = "ams-mobile-warning-dismissed";

export function initMobileWarning() {
  if (!window.matchMedia(BREAKPOINT).matches) return;
  try {
    if (localStorage.getItem(STORAGE_KEY) === "1") return;
  } catch { /* storage blocked: show it, it just won't stay dismissed */ }

  const banner = document.createElement("div");
  banner.className = "mobile-warning";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-labelledby", "mobileWarningTitle");
  banner.innerHTML =
    '<div class="mobile-warning-inner">' +
    '<h2 id="mobileWarningTitle" class="mobile-warning-title">Built for a bigger screen</h2>' +
    '<p class="mobile-warning-text">This site is meant for larger screens. On a phone, drag to pan and pinch to zoom the course map.</p>' +
    '<div class="mobile-warning-buttons"><button type="button" class="mobile-warning-btn">Got it</button></div>' +
    "</div>";
  document.body.appendChild(banner);

  banner.querySelector("button").addEventListener("click", () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* won't stick */ }
    banner.remove();
  });
}
