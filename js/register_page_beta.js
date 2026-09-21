import { supabase } from "./supabase_beta.js";
import { setBusy, showState, escapeHtml } from "./ui_beta.js";

let player = null;
const status = document.getElementById("formStatus");
const playerBox = document.getElementById("playerBox");
const validateButton = document.getElementById("validateButton");
const registerButton = document.getElementById("registerButton");

validateButton.addEventListener("click", async () => {
  status.hidden = true; playerBox.hidden = true; player = null;
  const matricula = document.getElementById("matricula").value.trim();
  if (!matricula) return showState(status, "Ingresá la matrícula.", "error");
  try {
    setBusy(validateButton, true, "Buscando...");
    const { data, error } = await supabase.from("players").select("id,full_name,aag_member_number,option_club_id,is_club_member,profile_id").eq("aag_member_number", matricula).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("No encontré esa matrícula en la base de jugadores.");
    if (Number(data.option_club_id) !== 408 && data.is_club_member !== true) throw new Error("Solo los socios del Villa María Golf Club pueden registrarse.");
    if (data.profile_id) throw new Error("Esta matrícula ya tiene una cuenta vinculada.");
    player = data; playerBox.innerHTML = `<strong>${escapeHtml(data.full_name)}</strong><br>Confirmá que sos vos.`; playerBox.hidden = false;
  } catch (error) { showState(status, error.message, "error"); }
  finally { setBusy(validateButton, false); }
});

document.getElementById("registerForm").addEventListener("submit", async event => {
  event.preventDefault(); status.hidden = true;
  if (!player) return showState(status, "Primero validá la matrícula.", "error");
  const email = document.getElementById("email").value.trim(); const phone = document.getElementById("phone").value.trim(); const password = document.getElementById("password").value;
  if (!email || !phone || password.length < 6) return showState(status, "Completá email, teléfono y una contraseña de al menos 6 caracteres.", "error");
  try {
    setBusy(registerButton, true, "Registrando...");
    const emailRedirectTo = new URL("login_beta.html", location.href).href;
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo, data: { aag_member_number: player.aag_member_number, phone } } });
    if (error) throw error;
    showState(status, "Registro creado. Revisá tu correo para confirmar el email.", "success");
    setTimeout(() => location.href = "login_beta.html", 4500);
  } catch (error) { showState(status, error.message || "No se pudo completar el registro.", "error"); setBusy(registerButton, false); }
});
