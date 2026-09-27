// EDNA grátis: tudo neste aparelho, sem conta e sem servidor.
//
// As tarefas moram no localStorage do navegador. Nada sai do aparelho — é por
// isso que não custa nada para ninguém, e é por isso que o backup existe.

import { interpretar, quando, rotulo, coluna, atrasada, paraISO } from "./datas.js";
import * as amor from "./amor.js";

const CHAVE = "edna.tarefas.v1";
const CHAVE_AMOR = "edna.amor.v1";
const COLUNAS = ["hoje", "compromissos", "proximos", "tarefas"];

let tarefas = [];
let vinculo = null;      // { conta, segredo, convite, nome } — a lista "meu amor" no servidor
let pedidos = [];        // o que chegou do servidor
let semArmazenamento = false;
let abaAtual = "hoje";
let selecionada = null;   // tarefa aberta no menu
let desfazer = null;      // função do "desfazer" do último aviso

// --- guardar ------------------------------------------------------------------

function carregar() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    tarefas = bruto ? JSON.parse(bruto).filter((t) => t && typeof t.texto === "string") : [];
    const v = JSON.parse(localStorage.getItem(CHAVE_AMOR) || "null");
    if (v && v.segredo) vinculo = v;
  } catch (e) {
    tarefas = [];
    semArmazenamento = true;
  }
}

function salvarVinculo() {
  try { localStorage.setItem(CHAVE_AMOR, JSON.stringify(vinculo)); } catch (e) {}
}

function salvar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(tarefas));
  } catch (e) {
    if (!semArmazenamento) avisar("Este navegador não deixa guardar — as tarefas somem ao fechar.");
    semArmazenamento = true;
  }
}

function novoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// --- desenhar -----------------------------------------------------------------

function ordenar(lista, col) {
  const chave = (t) => (t.dia || "9999") + " " + (t.hora || "99:99");
  if (col === "tarefas") return lista.sort((a, b) => a.criado - b.criado);
  return lista.sort((a, b) => chave(a).localeCompare(chave(b)) || a.criado - b.criado);
}

const VAZIO = {
  hoje: "Nada para hoje. Escreva embaixo — por exemplo <code>pagar a luz hoje</code>.",
  compromissos: "Nenhum horário marcado. Tente <code>dentista sexta 9h</code>.",
  proximos: "Nada com data pela frente. Tente <code>renovar o seguro dia 30</code>.",
  tarefas: "Sem data vira tarefa: <code>trocar a lâmpada da cozinha</code>.",
};

function desenhar() {
  const agora = new Date();
  document.getElementById("dia").textContent = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const porColuna = Object.fromEntries(COLUNAS.map((c) => [c, []]));
  for (const t of tarefas) if (!t.feito) porColuna[coluna(t, agora)].push(t);

  for (const col of COLUNAS) {
    const itens = ordenar(porColuna[col], col);
    const sec = document.getElementById(col);
    const ul = sec.querySelector("ul");
    ul.innerHTML = "";
    sec.querySelector("h2 .n").textContent = itens.length || "";
    document.querySelector(`[data-aba="${col}"] .n`).textContent = itens.length || "";
    if (!itens.length) {
      ul.innerHTML = `<p class="vazio">${VAZIO[col]}</p>`;
      continue;
    }
    for (const t of itens) ul.appendChild(linha(t, agora));
  }
  desenharAmor();
}

// --- meu amor ----------------------------------------------------------------------
//
// A única coluna que vem de fora: os pedidos que o parceiro mandou pelo link.
// Concluir aqui marca "feito" lá no app dele.

function desenharAmor() {
  const sec = document.getElementById("amor");
  const ul = sec.querySelector("ul");
  ul.innerHTML = "";
  const abertos = pedidos.filter((p) => !p.feito);
  sec.querySelector("h2 .n").textContent = abertos.length || "";
  const aba = document.querySelector(`[data-aba="amor"] .n`);
  aba.textContent = abertos.length || "";
  if (!vinculo) {
    ul.innerHTML = `<div class="convite-vazio">Quem você ama manda pedidos direto para cá — sem cadastro, só com um link.<br>
      <button class="botao-cheio" id="convidar-agora">♥ Convidar meu amor</button></div>`;
    document.getElementById("convidar-agora").onclick = abrirAmor;
    return;
  }
  if (!abertos.length) {
    ul.innerHTML = `<p class="vazio">Nenhum pedido pendente. ${pedidos.length ? "" : "Mande o link pelo menu ⋯ → ♥ Convidar meu amor."}</p>`;
    return;
  }
  for (const p of abertos) {
    const li = document.createElement("li");
    if (p.urgente) li.classList.add("urgente");
    const caixa = document.createElement("button");
    caixa.className = "caixa";
    caixa.setAttribute("aria-label", "Concluir " + p.texto);
    caixa.onclick = async () => {
      p.feito = true;
      desenhar();
      try { await amor.concluirPedido(vinculo.segredo, p.id); avisar("Feito ✓ — ele vai ver no app"); }
      catch (e) { p.feito = false; desenhar(); avisar("Sem conexão — tenta de novo"); }
    };
    const texto = document.createElement("div");
    texto.className = "texto";
    if (p.urgente) texto.insertAdjacentHTML("beforeend", `<span class="selo">urgente</span>`);
    texto.appendChild(document.createTextNode(p.texto));
    const q = document.createElement("span");
    q.className = "quando";
    q.textContent = (p.de ? p.de + " · " : "") + (p.urgente ? "" : "quando der · ") + "pediu " + amor.momento(p.criado);
    texto.appendChild(q);
    const mais = document.createElement("button");
    mais.className = "mais";
    mais.textContent = "⋯";
    mais.onclick = async () => {
      if (!confirm(`Apagar o pedido “${p.texto}”?`)) return;
      try { await amor.apagarPedido(vinculo.segredo, p.id); pedidos = pedidos.filter((x) => x !== p); desenhar(); }
      catch (e) { avisar("Sem conexão — tenta de novo"); }
    };
    li.append(caixa, texto, mais);
    ul.appendChild(li);
  }
}

let vistos = null;
// forcar: ao abrir e ao voltar para a aba, busca mesmo que o navegador diga
// que a página está escondida (app instalado abrindo em segundo plano).
async function buscarPedidos(forcar) {
  if (!vinculo || (document.hidden && forcar !== true)) return;
  try {
    const lista = await amor.caixa(vinculo.segredo);
    const novos = vistos ? lista.filter((p) => !p.feito && !vistos.has(p.id)) : [];
    vistos = new Set(lista.map((p) => p.id));
    pedidos = lista;
    desenharAmor();
    if (novos.length) {
      const p = novos[0];
      avisar((p.urgente ? "Pedido urgente" : "Pedido novo") + (p.de ? " de " + p.de : "") + ": " + p.texto);
      if (Notification?.permission === "granted") new Notification((p.urgente ? "Urgente — " : "") + (p.de || "Meu amor"), { body: p.texto, tag: "amor-" + p.id });
    }
  } catch (e) {
    if (e.status === 401) { vinculo = null; localStorage.removeItem(CHAVE_AMOR); desenharAmor(); }
  }
}

async function abrirAmor() {
  const dlg = document.getElementById("menu-amor");
  const linkDiv = document.getElementById("link-convite");
  if (!vinculo) {
    const nome = await perguntar("Como o seu amor te chama?", "Aparece no app dele: “Pedidos pro Diego”.", "");
    if (nome === null) return;
    try {
      const c = await amor.criarConta(nome.trim());
      vinculo = { conta: c.conta, segredo: c.segredo, convite: c.convite, nome: nome.trim() };
      salvarVinculo();
      // Pedir a notificação agora, que é quando faz sentido para a pessoa.
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    } catch (e) {
      avisar("Não consegui falar com o servidor: " + e.message);
      return;
    }
  }
  linkDiv.hidden = false;
  linkDiv.textContent = amor.linkDoConvite(vinculo.convite);
  document.getElementById("amor-explica").textContent = "Mande este link para quem você ama. Quem abrir instala o app e passa a mandar pedidos para a sua coluna ♥.";
  document.getElementById("amor-quem").textContent = "";
  amor.verConta(vinculo.segredo).then((c) => {
    document.getElementById("amor-quem").textContent = c.parceiros.length
      ? "Já entrou: " + c.parceiros.map((n) => n || "alguém").join(", ")
      : "Ninguém entrou ainda.";
  }).catch(() => {});
  dlg.showModal();
  desenharAmor();
}

document.getElementById("menu-amor").addEventListener("click", async (ev) => {
  const dlg = ev.currentTarget;
  const acao = ev.target.dataset?.acao;
  if (ev.target === dlg || acao === "fechar") { dlg.close(); return; }
  if (!vinculo) return;
  const link = amor.linkDoConvite(vinculo.convite);
  if (acao === "zap") {
    const msg = `Amor, instala a EDNA e me manda os pedidos por aqui: ${link}`;
    window.open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank");
  }
  if (acao === "copiar") {
    try { await navigator.clipboard.writeText(link); avisar("Link copiado"); }
    catch (e) { avisar("Segure no link para copiar"); }
  }
  if (acao === "novo-link") {
    try { const c = await amor.novoConvite(vinculo.segredo); vinculo.convite = c.convite; salvarVinculo(); document.getElementById("link-convite").textContent = amor.linkDoConvite(c.convite); avisar("Link trocado — o antigo não vale mais"); }
    catch (e) { avisar("Sem conexão"); }
  }
  if (acao === "desligar") {
    if (!confirm("Desligar todo mundo desta lista? Quem já entrou vai precisar de um link novo.")) return;
    try { const c = await amor.desligarTodos(vinculo.segredo); vinculo.convite = c.convite; salvarVinculo(); document.getElementById("link-convite").textContent = amor.linkDoConvite(c.convite); document.getElementById("amor-quem").textContent = "Ninguém entrou ainda."; avisar("Todo mundo desligado"); }
    catch (e) { avisar("Sem conexão"); }
  }
});

function linha(t, agora) {
  const li = document.createElement("li");
  if (atrasada(t, agora)) li.classList.add("atrasada");

  const caixa = document.createElement("button");
  caixa.className = "caixa";
  caixa.setAttribute("aria-label", "Concluir " + t.texto);
  caixa.onclick = () => concluir(t);

  const texto = document.createElement("div");
  texto.className = "texto";
  texto.textContent = t.texto;
  if (t.dia) {
    const q = document.createElement("span");
    q.className = "quando";
    q.textContent = rotulo(t.dia, t.hora, agora) + (atrasada(t, agora) ? " · atrasada" : "");
    texto.appendChild(q);
  }

  const mais = document.createElement("button");
  mais.className = "mais";
  mais.textContent = "⋯";
  mais.setAttribute("aria-label", "Opções de " + t.texto);
  mais.onclick = () => abrirItem(t);

  li.append(caixa, texto, mais);
  return li;
}

// --- ações --------------------------------------------------------------------

function anotar(frase) {
  const r = interpretar(frase);
  if (!r.texto) return;
  const t = { id: novoId(), texto: r.texto, dia: r.dia, hora: r.hora, feito: false, criado: Date.now() };
  tarefas.push(t);
  salvar();
  // Mostra a tarefa onde ela caiu — no celular, troca para a aba certa.
  mudarAba(coluna(t));
  desenhar();
  avisar(r.dia ? `Anotado para ${rotulo(r.dia, r.hora)}` : "Anotado em Tarefas");
}

function concluir(t) {
  t.feito = true;
  t.feitoEm = Date.now();
  salvar();
  desenhar();
  avisar("Concluída ✓", () => { t.feito = false; delete t.feitoEm; salvar(); desenhar(); });
}

function mudarData(t, dia, hora) {
  const antes = { dia: t.dia, hora: t.hora };
  t.dia = dia;
  t.hora = hora;
  salvar();
  desenhar();
  avisar(dia ? `Agora: ${rotulo(dia, hora)}` : "Sem data", () => { Object.assign(t, antes); salvar(); desenhar(); });
}

function apagar(t) {
  const i = tarefas.indexOf(t);
  if (i < 0) return;
  tarefas.splice(i, 1);
  salvar();
  desenhar();
  avisar("Apagada", () => { tarefas.splice(i, 0, t); salvar(); desenhar(); });
}

// --- aviso com desfazer ---------------------------------------------------------

let relogioAviso = null;
function avisar(msg, acaoDesfazer) {
  const caixa = document.getElementById("aviso");
  const botao = document.getElementById("aviso-botao");
  document.getElementById("aviso-texto").textContent = msg;
  desfazer = acaoDesfazer || null;
  botao.hidden = !desfazer;
  caixa.classList.add("visivel");
  clearTimeout(relogioAviso);
  relogioAviso = setTimeout(() => { caixa.classList.remove("visivel"); desfazer = null; }, desfazer ? 6000 : 2500);
}
document.getElementById("aviso-botao").onclick = () => {
  if (desfazer) desfazer();
  desfazer = null;
  document.getElementById("aviso").classList.remove("visivel");
};

// --- menus ----------------------------------------------------------------------

function abrirItem(t) {
  selecionada = t;
  document.getElementById("item-titulo").textContent = t.texto;
  document.getElementById("item-quando").textContent = t.dia ? rotulo(t.dia, t.hora) : "sem data";
  document.getElementById("menu-item").showModal();
}

document.getElementById("menu-item").addEventListener("click", async (ev) => {
  const dlg = ev.currentTarget;
  if (ev.target === dlg) { dlg.close(); return; } // toque fora fecha
  const acao = ev.target.dataset?.acao;
  const t = selecionada;
  if (!acao || !t) return;
  dlg.close();
  const hoje = new Date();
  if (acao === "hoje") mudarData(t, paraISO(hoje), t.hora);
  if (acao === "amanha") mudarData(t, paraISO(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1)), t.hora);
  if (acao === "sem-data") mudarData(t, null, null);
  if (acao === "apagar") apagar(t);
  if (acao === "editar") {
    const novo = await perguntar("Editar", "", t.texto);
    if (novo && novo.trim()) { t.texto = novo.trim(); salvar(); desenhar(); }
  }
  if (acao === "data") {
    const q = await perguntar("Mudar data", "Escreva como fala: amanhã, sexta 9h, dia 30, 15/10 14h", "");
    if (q === null) return;
    const r = quando(q.trim());
    if (r) mudarData(t, r.dia, r.hora);
    else avisar("Não entendi essa data");
  }
});

// perguntar abre a caixinha de texto e devolve o que a pessoa escreveu, ou
// null se desistiu. Responde ao Enter, ao Salvar, ao Cancelar e ao Esc —
// sem depender do evento "close", que nem todo navegador embutido dispara.
function perguntar(titulo, dica, valor) {
  const dlg = document.getElementById("caixa-texto");
  const form = document.getElementById("caixa-form");
  const campo = document.getElementById("caixa-campo");
  document.getElementById("caixa-titulo").textContent = titulo;
  document.getElementById("caixa-dica").textContent = dica;
  campo.value = valor;
  dlg.showModal();
  campo.focus();
  campo.select();
  return new Promise((ok) => {
    const fim = (v) => { form.onsubmit = dlg.oncancel = document.getElementById("caixa-cancelar").onclick = null; if (dlg.open) dlg.close(); ok(v); };
    form.onsubmit = (ev) => { ev.preventDefault(); fim(campo.value); };
    document.getElementById("caixa-cancelar").onclick = () => fim(null);
    dlg.oncancel = (ev) => { ev.preventDefault(); fim(null); };
  });
}

document.getElementById("abrir-menu").onclick = () => document.getElementById("menu-app").showModal();

document.getElementById("menu-app").addEventListener("click", (ev) => {
  const dlg = ev.currentTarget;
  const acao = ev.target.dataset?.acao;
  if (ev.target === dlg || acao === "fechar") { dlg.close(); return; }
  if (acao === "exportar") exportar();
  if (acao === "importar") document.getElementById("arquivo-backup").click();
  if (acao === "feitas") { dlg.close(); mostrarFeitas(); }
  if (acao === "amor") { dlg.close(); abrirAmor(); }
  if (acao === "sobre") location.href = "../#planos";
});

document.getElementById("feitas").addEventListener("click", (ev) => {
  const dlg = ev.currentTarget;
  if (ev.target === dlg || ev.target.dataset?.acao === "fechar") dlg.close();
});

function mostrarFeitas() {
  const ul = document.getElementById("lista-feitas");
  ul.innerHTML = "";
  const feitas = tarefas.filter((t) => t.feito).sort((a, b) => (b.feitoEm || 0) - (a.feitoEm || 0)).slice(0, 50);
  if (!feitas.length) ul.innerHTML = `<p class="vazio">Nenhuma ainda.</p>`;
  for (const t of feitas) {
    const li = document.createElement("li");
    li.className = "feito";
    const caixa = document.createElement("button");
    caixa.className = "caixa";
    caixa.setAttribute("aria-label", "Reabrir " + t.texto);
    caixa.onclick = () => { t.feito = false; delete t.feitoEm; salvar(); desenhar(); li.remove(); };
    const texto = document.createElement("div");
    texto.className = "texto";
    texto.textContent = t.texto;
    li.append(caixa, texto);
    ul.appendChild(li);
  }
  document.getElementById("feitas").showModal();
}

// --- backup -----------------------------------------------------------------------

function exportar() {
  // O vínculo vai junto: restaurar num aparelho novo mantém a coluna ♥.
  const blob = new Blob([JSON.stringify({ edna: 1, exportado: new Date().toISOString(), tarefas, amor: vinculo }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `edna-backup-${paraISO(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.getElementById("arquivo-backup").onchange = async (ev) => {
  const arquivo = ev.target.files[0];
  ev.target.value = "";
  if (!arquivo) return;
  try {
    const dados = JSON.parse(await arquivo.text());
    const lista = Array.isArray(dados) ? dados : dados.tarefas;
    if (!Array.isArray(lista)) throw new Error("formato");
    // Junta sem duplicar: quem já existe (mesmo id) fica como está.
    const ids = new Set(tarefas.map((t) => t.id));
    let novas = 0;
    // Um backup é um arquivo qualquer: só entra o que tem o formato certo.
    const eDia = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const eHora = (v) => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
    for (const t of lista) {
      if (!t || typeof t.texto !== "string" || !t.texto.trim() || ids.has(t.id)) continue;
      tarefas.push({
        id: typeof t.id === "string" && t.id.length <= 40 ? t.id : novoId(),
        texto: t.texto.slice(0, 400), dia: eDia(t.dia) ? t.dia : null, hora: eHora(t.hora) ? t.hora : null,
        feito: !!t.feito, feitoEm: Number.isFinite(t.feitoEm) ? t.feitoEm : undefined,
        criado: Number.isFinite(t.criado) ? t.criado : Date.now(),
      });
      novas++;
    }
    const a = dados.amor;
    if (!vinculo && a && typeof a.segredo === "string" && /^c_[0-9a-f]{12}\.[0-9a-f]{40}$/.test(a.segredo)) {
      vinculo = { conta: String(a.conta || ""), segredo: a.segredo, convite: typeof a.convite === "string" ? a.convite : "", nome: typeof a.nome === "string" ? a.nome.slice(0, 40) : "" };
      salvarVinculo();
      buscarPedidos(true);
    }
    salvar();
    desenhar();
    document.getElementById("menu-app").close();
    avisar(`${novas} tarefa(s) restaurada(s)`);
  } catch (e) {
    avisar("Esse arquivo não é um backup da EDNA");
  }
};

// --- abas, entrada, instalar --------------------------------------------------------

function mudarAba(col) {
  abaAtual = col;
  for (const c of [...COLUNAS, "amor"]) document.getElementById(c).classList.toggle("ativa", c === col);
  for (const b of document.querySelectorAll("#abas button")) b.classList.toggle("ativa", b.dataset.aba === col);
}
for (const b of document.querySelectorAll("#abas button")) b.onclick = () => mudarAba(b.dataset.aba);

const entrada = document.getElementById("entrada");
const previa = document.getElementById("previa");
entrada.addEventListener("input", () => {
  // Mostra antes de anotar o que a EDNA entendeu da data.
  const r = entrada.value.trim() ? interpretar(entrada.value) : null;
  previa.textContent = r && r.dia ? `→ ${r.texto} · ${rotulo(r.dia, r.hora)}` : "";
});
document.getElementById("nova").onsubmit = (ev) => {
  ev.preventDefault();
  const frase = entrada.value.trim();
  if (!frase) return;
  entrada.value = "";
  previa.textContent = "";
  anotar(frase);
};

let pedidoInstalar = null;
window.addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  pedidoInstalar = ev;
  document.getElementById("instalar").style.display = "inline-block";
});
document.getElementById("instalar").onclick = async () => {
  if (!pedidoInstalar) return;
  pedidoInstalar.prompt();
  await pedidoInstalar.userChoice;
  pedidoInstalar = null;
  document.getElementById("instalar").style.display = "none";
};

// Veio do "compartilhar" do celular: o texto vira anotação na hora.
const compartilhado = new URLSearchParams(location.search);
const textoCompartilhado = [compartilhado.get("titulo"), compartilhado.get("texto"), compartilhado.get("link")].filter(Boolean).join(" ");

carregar();
desenhar();
if (textoCompartilhado) {
  history.replaceState(null, "", location.pathname);
  anotar(textoCompartilhado);
}
if (semArmazenamento) avisar("Este navegador não deixa guardar — as tarefas somem ao fechar.");
// Pede ao navegador para não apagar os dados quando faltar espaço.
navigator.storage?.persist?.().catch(() => {});
// Compromisso que passou da hora muda de coluna sozinho.
setInterval(desenhar, 60000);
// Pedidos do amor chegam de fora: busca ao abrir e a cada 30 s com a tela visível.
buscarPedidos(true);
setInterval(buscarPedidos, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { desenhar(); buscarPedidos(true); } });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
