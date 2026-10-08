// Integración de las herramientas con el panel principal, sin ventanas nuevas.
if (window.parent !== window && new URLSearchParams(location.search).get("embedded") === "1") {
  document.body.classList.add("embedded-tool");
  document.addEventListener("click", event => {
    const close = event.target.closest("#closeFreeCard, #closeTvControl, #closeTvMedia");
    const link = event.target.closest("a[href]");
    const back = link && new URL(link.href,location.href).pathname.endsWith("/panel.html");
    if (!close && !back) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.parent.postMessage({type:"vmgc:close-tool"},location.origin);
  }, true);
}