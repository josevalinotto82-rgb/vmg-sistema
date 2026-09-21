import { getAuthContext, signIn } from "./auth_beta.js";
import { BETA_PAGES } from "./config_beta.js";
import { setBusy, showState } from "./ui_beta.js";

const form = document.getElementById("loginForm");
const button = document.getElementById("loginButton");
const status = document.getElementById("formStatus");

try {
  const context = await getAuthContext();
  if (context.session && context.profile?.active) location.replace(BETA_PAGES.panel);
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
    location.replace(next && !next.includes(":") ? next : BETA_PAGES.panel);
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
