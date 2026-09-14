/**
 * Keep Chart.js canvases sized to their wrappers on mobile / orientation change.
 */
(() => {
  function resizeAll() {
    if (typeof Chart === "undefined") return;
    for (const canvas of document.querySelectorAll("canvas")) {
      const chart = Chart.getChart(canvas);
      if (chart) chart.resize();
    }
  }

  window.addEventListener("resize", resizeAll, { passive: true });
  window.addEventListener("orientationchange", () => {
    setTimeout(resizeAll, 150);
  });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => resizeAll());
    const watch = () => {
      document
        .querySelectorAll(
          ".si-chart-wrap, .chart-container, .pt-chart-wrap, .pt-hit-charts",
        )
        .forEach((el) => ro.observe(el));
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", watch);
    } else {
      watch();
    }
    // Charts often mount after first paint
    setTimeout(watch, 0);
    setTimeout(resizeAll, 100);
    setTimeout(resizeAll, 500);
  }
})();
