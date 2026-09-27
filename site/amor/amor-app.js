// O app de quem manda pedidos: entra pelo link do convite, escreve ou fala,
// escolhe "quando der" ou "urgente". Só texto sai daqui.

import { entrar, meusPedidos, mandarPedido, momento } from "../app/amor.js";

const CHAVE = "edna.parceiro.v1";
let sessao = null; // { token, dono }
let enviando = false;

const campo = document.getElementById("texto");
const aviso = document.getElementById("aviso");

function avisar(msg, tipo) {
  aviso.textContent = msg;
  aviso.className = tipo || "";
}

// --- entrar -------------------------------------------------------------------------

try { sessao = JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch (e) {}

const convite = new URLSearchParams(location.search).get("c");

function mostrarApp() {
  document.getElementById("entrada-convite").classList.remove("visivel");
  document.getElementById("app").classList.add("visivel");
  document.getElementById("titulo").textContent = sessao.dono ? `Pedidos pro ${sessao.dono}` : "Pedidos";
  document.getElementById("subtitulo").textContent = sessao.dono ? `cai direto na lista de ${sessao.dono}` : "cai direto na lista de quem te ama";
  carregar();
  iniciarVoz();
}

if (convite && !(sessao && sessao.convite === convite)) {
  document.getElementById("entrada-convite").classList.add("visivel");
  document.getElementById("entrar").onclick = async () => {
    const nome = document.getElementById("meu-nome").value.trim();
    try {
      const r = await entrar(convite, nome);
      sessao = { token: r.token, dono: r.dono, nome, convite };
      localStorage.setItem(CHAVE, JSON.stringify(sessao));
      history.replaceState(null, "", location.pathname);
      mostrarApp();
    } catch (e) {
      document.getElementById("erro-convite").textContent = e.message;
    }
  };
} else if (sessao && sessao.token) {
  mostrarApp();
} else {
  document.getElementById("subtitulo").textContent = "Você precisa de um convite: peça o link para quem tem a EDNA.";
}

// --- mandar pedido ------------------------------------------------------------------

async function enviar(urgente) {
  const texto = campo.value.trim();
  if (!texto) { avisar("Escreve (ou fala) o pedido primeiro 🙂"); campo.focus(); return; }
  if (enviando) return;
  enviando = true;
  document.querySelectorAll(".botoes button").forEach((b) => (b.disabled = true));
  avisar("enviando…");
  try {
    await mandarPedido(sessao.token, texto, urgente);
    campo.value = "";
    avisar(urgente ? "Chegou — marcado como urgente ❤️" : "Chegou na lista 💌", "ok");
    if (navigator.vibrate) navigator.vibrate(40);
    carregar();
  } catch (e) {
    if (e.status === 401) { avisar("Esse convite foi desligado. Peça um link novo.", "erro"); return; }
    avisar(navigator.onLine ? "Não consegui mandar: " + e.message : "Sem internet agora — o texto ficou aí, tenta de novo.", "erro");
  } finally {
    enviando = false;
    document.querySelectorAll(".botoes button").forEach((b) => (b.disabled = false));
  }
}
document.getElementById("quando-der").onclick = () => enviar(false);
document.getElementById("urgente").onclick = () => enviar(true);

async function carregar() {
  try {
    const r = await meusPedidos(sessao.token);
    if (r.dono && r.dono !== sessao.dono) { sessao.dono = r.dono; localStorage.setItem(CHAVE, JSON.stringify(sessao)); }
    desenhar(r.pedidos);
  } catch (e) {
    if (e.status === 401) avisar("Esse convite foi desligado. Peça um link novo.", "erro");
  }
}

function desenhar(pedidos) {
  const ul = document.getElementById("lista");
  ul.innerHTML = "";
  const meus = pedidos; // o servidor já devolve só os deste parceiro
  if (!meus.length) { ul.innerHTML = `<li class="vazio" style="border:none;background:none">Nenhum pedido ainda.</li>`; return; }
  for (const p of meus.slice(0, 40)) {
    const li = document.createElement("li");
    if (p.feito) li.classList.add("feito"); else if (p.urgente) li.classList.add("urgente");
    const texto = document.createElement("div");
    texto.className = "texto";
    texto.textContent = p.texto;
    const meta = document.createElement("div");
    meta.className = "meta";
    const selo = document.createElement("span");
    if (p.feito) { selo.className = "selo feito"; selo.textContent = "feito ✓"; }
    else if (p.urgente) { selo.className = "selo urgente"; selo.textContent = "urgente"; }
    else { selo.className = "selo esperando"; selo.textContent = "quando der"; }
    const quando = document.createElement("span");
    quando.textContent = p.feito && p.feito_em ? "feito " + momento(p.feito_em) : "pedido " + momento(p.criado);
    meta.append(selo, quando);
    li.append(texto, meta);
    ul.appendChild(li);
  }
}
setInterval(() => { if (sessao && document.visibilityState === "visible") carregar(); }, 30000);
document.addEventListener("visibilitychange", () => { if (sessao && document.visibilityState === "visible") carregar(); });

// --- voz: gravar aqui, transcrever aqui ----------------------------------------------
//
// O microfone grava; o Whisper (whisper.js, num worker) transcreve dentro do
// celular; o texto aparece no campo para a pessoa conferir e escolher o botão.

const mic = document.getElementById("mic");
const micRotulo = document.getElementById("mic-rotulo");
const micDica = document.getElementById("mic-dica");
const cancelar = document.getElementById("cancelar");
const barra = document.getElementById("baixando");
const MAX_SEGUNDOS = 60;
let gravacao = null, apertouEm = 0, travado = false, worker = null, ouvindo = false;

function iniciarVoz() {
  const temMic = navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext) && window.Worker;
  if (!temMic) return;
  worker = new Worker("whisper.js", { type: "module" });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.tipo === "progresso") { barra.classList.add("visivel"); barra.value = m.fracao; micDica.textContent = `baixando o ouvido da EDNA… ${Math.round(m.fracao * 100)}% (só na primeira vez)`; }
    if (m.tipo === "pronto") { barra.classList.remove("visivel"); if (!ouvindo) micDica.textContent = "ou toque uma vez para gravar e de novo para parar"; }
    if (m.tipo === "texto") {
      ouvindo = false; mic.disabled = false; micRotulo.textContent = "Segure para falar";
      if (!m.texto) { avisar("Não entendi — fala mais pertinho do celular.", "erro"); return; }
      campo.value = (campo.value.trim() ? campo.value.trim() + " " : "") + m.texto;
      avisar("Confere o texto e escolhe: quando der ou urgente.", "ok");
      campo.focus();
    }
    if (m.tipo === "erro") { ouvindo = false; mic.disabled = false; micRotulo.textContent = "Segure para falar"; barra.classList.remove("visivel"); avisar("A transcrição falhou neste aparelho — escreve o pedido. (" + m.mensagem.slice(0, 80) + ")", "erro"); }
  };
  document.getElementById("voz").classList.add("pronto");

  mic.addEventListener("pointerdown", async (ev) => {
    ev.preventDefault();
    if (enviando || ouvindo) return;
    if (gravacao) { if (travado) parar(); return; }
    apertouEm = Date.now(); travado = false;
    await comecar();
  });
  const soltou = () => {
    if (!gravacao || travado) return;
    if (Date.now() - apertouEm < 400) { travado = true; micRotulo.textContent = "Gravando… toque para parar"; cancelar.classList.add("visivel"); return; }
    parar();
  };
  mic.addEventListener("pointerup", soltou);
  mic.addEventListener("pointercancel", () => { if (gravacao && !travado) descartar(); });
  mic.addEventListener("contextmenu", (ev) => ev.preventDefault());
  cancelar.onclick = descartar;
}

async function comecar() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const fonte = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const pedacos = [];
    proc.onaudioprocess = (e) => pedacos.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    fonte.connect(proc); proc.connect(ctx.destination);
    gravacao = { stream, ctx, proc, pedacos, taxa: ctx.sampleRate, inicio: Date.now() };
    mic.classList.add("gravando");
    micRotulo.textContent = "Gravando… solte para parar";
    worker.postMessage({ tipo: "aquecer" }); // baixa/carrega o modelo enquanto ela fala
    gravacao.relogio = setInterval(() => {
      const s = Math.floor((Date.now() - gravacao.inicio) / 1000);
      micDica.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (s >= MAX_SEGUNDOS) parar();
    }, 250);
    if (navigator.vibrate) navigator.vibrate(20);
  } catch (e) {
    gravacao = null;
    avisar("Preciso da permissão do microfone — libera nas configurações do navegador.", "erro");
  }
}

function fechar() {
  const g = gravacao;
  gravacao = null; travado = false;
  clearInterval(g.relogio);
  g.proc.disconnect(); g.stream.getTracks().forEach((t) => t.stop()); g.ctx.close();
  mic.classList.remove("gravando");
  micRotulo.textContent = "Segure para falar";
  micDica.textContent = "ou toque uma vez para gravar e de novo para parar";
  cancelar.classList.remove("visivel");
  return g;
}

function descartar() { if (gravacao) fecharAviso(); }
function fecharAviso() { fechar(); avisar("Gravação cancelada."); }

function parar() {
  const g = fechar();
  if (Date.now() - g.inicio < 700) { avisar("Segure o botão enquanto fala 🙂"); return; }
  const audio = para16k(g.pedacos, g.taxa);
  ouvindo = true; mic.disabled = true;
  micRotulo.textContent = "Ouvindo…";
  avisar("transcrevendo aqui no seu celular…");
  worker.postMessage({ tipo: "transcrever", audio }, [audio.buffer]);
}

// para16k junta os pedaços e desce para 16 kHz — é o que o Whisper espera.
function para16k(pedacos, taxaOrigem) {
  let total = 0;
  for (const p of pedacos) total += p.length;
  const tudo = new Float32Array(total);
  let pos = 0;
  for (const p of pedacos) { tudo.set(p, pos); pos += p.length; }
  if (taxaOrigem === 16000) return tudo;
  const passo = taxaOrigem / 16000;
  const n = Math.floor(total / passo);
  const saida = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ini = Math.floor(i * passo), fim = Math.min(total, Math.floor((i + 1) * passo));
    let soma = 0;
    for (let j = ini; j < fim; j++) soma += tudo[j];
    saida[i] = soma / Math.max(1, fim - ini);
  }
  return saida;
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
