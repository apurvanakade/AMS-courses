// Collapse/expand toggle for the header controls and the filters ribbon
// below it, via the arrow button at the right edge of the header.

const app = document.querySelector(".app");

// `onToggle` is called after the collapsed state flips, so the caller can
// resize/redraw the canvas — collapsing changes how much vertical space
// `main` has, but nothing repaints on its own.
export function initRibbonToggle(onToggle) {
  document.getElementById("ribbonToggle").addEventListener("click", () => {
    app.classList.toggle("controls-hidden");
    onToggle();
  });
}
