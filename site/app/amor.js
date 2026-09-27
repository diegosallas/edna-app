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
