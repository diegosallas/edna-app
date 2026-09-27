// A ponte com o servidor de pedidos (cmd/mozao). É a única coisa da EDNA
// grátis que sai do aparelho — e só carrega texto curto: quem pediu, o quê,
// e se é urgente.

export const API = new URL("../api/", location.href).href.replace(/\/$/, "");

async function chamar(metodo, rota, chave, corpo) {
  const r = await fetch(API + rota, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(chave ? { Authorization: "Bearer " + chave } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (r.status === 204) return null;
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(dados.erro || `erro ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return dados;
}

// --- lado do dono -----------------------------------------------------------------

export const criarConta = (nome) => chamar("POST", "/contas", null, { nome });
export const verConta = (segredo) => chamar("GET", "/conta", segredo);
export const caixa = (segredo) => chamar("GET", "/caixa", segredo);
export const concluirPedido = (segredo, id) => chamar("POST", `/caixa/${id}/feito`, segredo);
export const reabrirPedido = (segredo, id) => chamar("POST", `/caixa/${id}/reabrir`, segredo);
export const apagarPedido = (segredo, id) => chamar("DELETE", `/caixa/${id}`, segredo);
export const novoConvite = (segredo) => chamar("POST", "/conta/convite", segredo);
export const desligarTodos = (segredo) => chamar("POST", "/conta/desligar", segredo);

// --- lado do parceiro ------------------------------------------------------------

export const entrar = (convite, nome) => chamar("POST", "/entrar", null, { convite, nome });
export const meusPedidos = (token) => chamar("GET", "/meus", token);
export const mandarPedido = (token, texto, urgente) => chamar("POST", "/pedidos", token, { texto, urgente });

// --- avisos no celular (Web Push) --------------------------------------------------

export const chavePush = () => chamar("GET", "/vapid");
export const registrarPushDono = (segredo, sub) => chamar("POST", "/conta/push", segredo, sub);
export const registrarPushParceiro = (token, sub) => chamar("POST", "/meus/push", token, sub);

function base64ParaBytes(s) {
  const b = atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

// podeAvisar diz se este navegador consegue receber aviso em segundo plano.
// No iPhone só funciona com o app instalado na Tela de Início.
export function podeAvisar() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { ok: false, motivo: "este navegador não avisa em segundo plano" };
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const instalado = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (iOS && !instalado) return { ok: false, motivo: "no iPhone, primeiro instale: Compartilhar → Adicionar à Tela de Início" };
  return { ok: true };
}

// ativarAvisos pede permissão, cria a inscrição e manda para o servidor.
// registrar é registrarPushDono ou registrarPushParceiro já com a chave.
export async function ativarAvisos(registrar) {
  const pode = podeAvisar();
  if (!pode.ok) throw new Error(pode.motivo);
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("sem permissão para avisar — libere nas configurações do navegador");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { chave } = await chavePush();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ParaBytes(chave) });
  }
  await registrar(sub.toJSON());
  return sub;
}

// renovarAvisos: se já foi permitido, garante que o servidor tem a inscrição
// atual (o navegador troca o endereço de vez em quando).
export async function renovarAvisos(registrar) {
  try {
    if (!podeAvisar().ok || Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    await registrar(sub.toJSON());
    return true;
  } catch (e) { return false; }
}

export function linkDoConvite(convite) {
  return new URL("../amor/?c=" + encodeURIComponent(convite), location.href).href;
}

export function momento(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1).toDateString() === d.toDateString();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (mesmoDia) return "hoje " + hora;
  if (ontem) return "ontem " + hora;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + hora;
}
