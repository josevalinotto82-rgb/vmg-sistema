import { supabase } from "./supabase.js";
export const BILLING_METHODS={cash:"Efectivo",account:"Cuenta corriente",debit:"Tarjeta de débito",credit:"Tarjeta de crédito",transfer:"Transferencia",no_charge:"No corresponde"};
export const billingMoney=value=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:2}).format(Number(value)||0);
export const billingToday=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Argentina/Cordoba",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export async function listBillingProducts(){const{data,error}=await supabase.from("misc_products").select("id,code,name,price,active").eq("active",true).order("code");if(error)throw error;return data||[];}
export async function saveBillingProduct(product){
  const code=Number(product.code),price=Number(product.price),name=String(product.name||"").trim();
  if(!Number.isInteger(code)||code<1||!name||!Number.isFinite(price)||price<0)throw new Error("Completá código, nombre y precio válido.");
  const payload={code,name,price};let query=product.id?supabase.from("misc_products").update(payload).eq("id",product.id):supabase.from("misc_products").insert(payload);
  const{data,error}=await query.select().single();if(error)throw new Error(error.code==="23505"?"Ese código de producto ya existe.":error.message);return data;
}
export async function createBillingSale({id,client,method,items}){
  const{data,error}=await supabase.rpc("create_misc_sale",{p_id:id,p_client_name:client.display_name,p_member_number:client.aag_member_number||"",p_method:method,p_items:items.map(item=>({product_id:item.product.id,quantity:item.quantity,expected_price:Number(item.product.price)}))});
  if(error)throw error;
  const sale=Array.isArray(data)?data[0]:data;
  if(!sale?.id)throw new Error("No se pudo confirmar la venta. Volvé a intentar; no se duplicará el cupón.");
  return sale;
}
export async function listDailySales(date){
  const rows=[];
  for(let from=0;;from+=500){const{data,error}=await supabase.from("misc_sales").select("id,number,created_at,sale_date,client_name,client_member_number,payment_method,items,total").eq("sale_date",date).order("number").range(from,from+499);if(error)throw error;rows.push(...(data||[]));if((data||[]).length<500)return rows;}
}
let printerLoading;
export async function printBillingCoupon(html){
  if(!window.imprimirTicketQZ){
    printerLoading ||= (async()=>{for(const [check,src] of [[()=>window.qz,"https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js"],[()=>window.KEYUTIL,"https://cdn.jsdelivr.net/npm/jsrsasign@10.8.6/lib/jsrsasign-all-min.js"],[()=>window.imprimirTicketQZ,"./qz-ticket.js?v=billing-20261012"]]){if(check())continue;await new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=src;script.onload=resolve;script.onerror=()=>reject(new Error("No se pudo cargar la conexión de impresión."));document.head.appendChild(script);});}})().catch(error=>{printerLoading=null;throw error;});await printerLoading;
  }
  await window.imprimirTicketQZ(html);
}
