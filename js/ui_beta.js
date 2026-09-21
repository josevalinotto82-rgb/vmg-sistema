export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
}

export function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function setBusy(button, busy, label = "Procesando...") {
  if (!button) return;
  if (busy) {
    button.dataset.previousText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.previousText || button.textContent;
    button.disabled = false;
  }
}

export function notify(message, type = "success") {
  let toast = document.getElementById("appToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "appToast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

export function showState(target, message, type = "info") {
  if (!target) return;
  target.className = `notice ${type === "error" ? "warn" : type}`;
  target.textContent = message;
  target.hidden = false;
}

export function confirmAction({ title, message, confirmText = "Confirmar", danger = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement("div");
    wrap.className = "drawer open";
    wrap.innerHTML = `<section class="drawer-panel" style="max-width:440px;height:auto;margin:auto;border-radius:18px"><div class="drawer-head"><div><div class="eyebrow">Confirmación</div><h2>${escapeHtml(title)}</h2></div></div><p>${escapeHtml(message)}</p><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px"><button class="btn secondary" data-cancel>Cancelar</button><button class="btn ${danger ? "danger" : "primary"}" data-confirm>${escapeHtml(confirmText)}</button></div></section>`;
    document.body.appendChild(wrap);
    const close = value => { wrap.remove(); resolve(value); };
    wrap.querySelector("[data-cancel]").addEventListener("click", () => close(false));
    wrap.querySelector("[data-confirm]").addEventListener("click", () => close(true));
  });
}
