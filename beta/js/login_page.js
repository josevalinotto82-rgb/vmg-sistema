import { getAuthContext, signIn, signOut } from "./auth.js";
import { PAGES } from "./config.js";
import { setBusy, showState } from "./ui.js";

const form = document.getElementById("loginForm");
const button = document.getElementById("loginButton");
const status = document.getElementById("formStatus");
if (new URLSearchParams(location.search).has("admin_required")) showState(status,"Este sistema es exclusivo para administradores.","error");

try {
  const context = await getAuthContext();
  if (context.session && context.profile?.active && context.profile.role === "admin") location.replace(PAGES.panel);
  else if (context.session) await signOut();
} catch (error) { console.error(error); }

form.addEventListener("submit", async event => {
  event.preventDefault();
  status.hidden = true;
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!email || !password) return showState(status, "Ingresá email y contraseña.", "error");
  try {
    setBusy(button, true, "Ingresando...");
    await signIn(email, password);
    const next = new URLSearchParams(location.search).get("next");
    location.replace(next && !next.includes(":") ? next : PAGES.panel);
  } catch (error) {
    showState(status, error.message || "No se pudo iniciar sesión.", "error");
    setBusy(button, false);
  }
});

document.getElementById("password").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.repeat) {
    event.preventDefault();
    if (!button.disabled) form.requestSubmit();
  }
});
