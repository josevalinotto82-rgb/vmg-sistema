import { supabase } from "./supabase_beta.js";
import { setBusy, showState } from "./ui_beta.js";
const form=document.getElementById("recoveryForm"),button=document.getElementById("recoveryButton"),status=document.getElementById("formStatus");
form.addEventListener("submit",async event=>{event.preventDefault();const email=document.getElementById("email").value.trim();if(!email)return showState(status,"Ingresá tu email.","error");try{setBusy(button,true,"Enviando...");const redirectTo=new URL("cambiar_password_beta.html",location.href).href;const{error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo});if(error)throw error;showState(status,"Te enviamos el enlace de recuperación.","success")}catch(error){showState(status,error.message,"error")}finally{setBusy(button,false)}});
