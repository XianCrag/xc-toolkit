/**
 * Register root service worker from any page (home or tool subdir).
 * Resolves sw.js next to this script so scope covers the whole site.
 */
(() => {
  if (!("serviceWorker" in navigator)) return;

  const script = document.currentScript;
  if (!script?.src) return;

  const swUrl = new URL("sw.js", script.src);
  const scopeUrl = new URL("./", script.src);

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(swUrl.href, { scope: scopeUrl.href })
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch(() => {});
  });
})();
