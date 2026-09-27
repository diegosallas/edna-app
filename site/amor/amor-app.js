// O app de quem manda pedidos: entra pelo link do convite, escreve ou fala,
// escolhe "quando der" ou "urgente". Só texto sai daqui.

import { entrar, meusPedidos, mandarPedido, momento, ativarAvisos, renovarAvisos, registrarPushParceiro, podeAvisar } from "../app/amor.js";

const CHAVE = "edna.parceiro.v1";
let sessao = null; // { token, dono, nome, convite }
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
  iniciarAvisos();
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
    limparTexto();
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

// O × do campo: errou, apaga tudo e recomeça — vale para texto e para voz.
const limpar = document.getElementById("limpar");
function limparTexto() {
  campo.value = "";
  limpar.hidden = true;
  document.getElementById("previa-voz").hidden = true;
}
campo.addEventListener("input", () => { limpar.hidden = !campo.value; });
limpar.onclick = () => { limparTexto(); avisar("Apagado."); campo.focus(); };

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
  if (!pedidos.length) { ul.innerHTML = `<li class="vazio" style="border:none;background:none">Nenhum pedido ainda.</li>`; return; }
  for (const p of pedidos.slice(0, 40)) {
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

// --- avisos: saber quando ele fez -----------------------------------------------------

function iniciarAvisos() {
  const b = document.getElementById("avisos");
  const pode = podeAvisar();
  if (!pode.ok) { b.textContent = "🔔 " + pode.motivo; b.disabled = true; return; }
  if (Notification.permission === "granted") {
    b.textContent = "🔔 Você recebe aviso quando ele fizer";
    renovarAvisos((sub) => registrarPushParceiro(sessao.token, sub));
  }
  b.onclick = async () => {
    try {
      await ativarAvisos((sub) => registrarPushParceiro(sessao.token, sub));
      b.textContent = "🔔 Você recebe aviso quando ele fizer";
      avisar("Pronto: você recebe aviso quando ele concluir.", "ok");
    } catch (e) { avisar(e.message, "erro"); }
  };
}

// --- voz: gravar aqui, transcrever aqui ----------------------------------------------
//
// O microfone grava; o Whisper (whisper.js, num worker) transcreve dentro do
// celular; o texto aparece no campo para a pessoa conferir, apagar ou mandar.
// Três estados: parado → gravando → transcrevendo → parado. Em qualquer um
// dá para desistir — ninguém fica preso esperando.

const mic = document.getElementById("mic");
const micRotulo = document.getElementById("mic-rotulo");
const micDica = document.getElementById("mic-dica");
const cancelar = document.getElementById("cancelar");
const barra = document.getElementById("baixando");
const previaVoz = document.getElementById("previa-voz");
const MAX_SEGUNDOS = 60;
const PRAZO_TRANSCRICAO = 120000;
const DICA = "ou toque uma vez para gravar e de novo para parar";

let estado = "parado";
let gravacao = null, apertouEm = 0, travado = false;
let worker = null, prontoParaOuvir = false, relogioPrazo = null, wasmBaixado = false;

function iniciarVoz() {
  const temMic = navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext) && window.Worker;
  if (!temMic) return;
  document.getElementById("voz").classList.add("pronto");

  mic.addEventListener("pointerdown", async (ev) => {
    ev.preventDefault();
    if (enviando) return;
    if (estado === "transcrevendo") { desistirDaTranscricao(); return; }
    if (estado === "gravando") { if (travado) parar(); return; }
    apertouEm = Date.now(); travado = false;
    await comecar();
  });
  const soltou = () => {
    if (estado !== "gravando" || travado) return;
    if (Date.now() - apertouEm < 400) { travado = true; micRotulo.textContent = "Gravando… toque para parar"; cancelar.classList.add("visivel"); return; }
    parar();
  };
  mic.addEventListener("pointerup", soltou);
  mic.addEventListener("pointercancel", () => { if (estado === "gravando" && !travado) descartar(); });
  mic.addEventListener("contextmenu", (ev) => ev.preventDefault());
  cancelar.onclick = descartar;
  document.getElementById("previa-apagar").onclick = () => { limparTexto(); avisar("Apagado. Pode gravar de novo."); };
}

function criarWorker() {
  if (worker) return worker;
  worker = new Worker("whisper.js", { type: "module" });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.tipo === "progresso") { barra.classList.add("visivel"); barra.value = m.fracao; micDica.textContent = `baixando o modelo de voz… ${Math.round(m.fracao * 100)}% (só na primeira vez)`; }
    if (m.tipo === "pronto") { prontoParaOuvir = true; barra.classList.remove("visivel"); if (estado === "parado") micDica.textContent = DICA; }
    if (m.tipo === "texto") {
      if (estado !== "transcrevendo") return; // a pessoa desistiu no meio
      voltarAoParado();
      if (!m.texto) { avisar("Não entendi — fala mais pertinho do celular, ou escreve.", "erro"); return; }
      campo.value = (campo.value.trim() ? campo.value.trim() + " " : "") + m.texto;
      limpar.hidden = false;
      previaVoz.hidden = false;
      avisar("Confere o texto e escolhe: quando der ou urgente.", "ok");
    }
    if (m.tipo === "erro") { falhaDeVoz("A transcrição falhou neste aparelho (" + String(m.mensagem).slice(0, 80) + ")"); }
  };
  worker.onerror = (e) => { falhaDeVoz("A voz não carregou neste navegador" + (e.message ? " (" + e.message.slice(0, 80) + ")" : "")); };
  return worker;
}

function falhaDeVoz(msg) {
  voltarAoParado();
  if (worker) { worker.terminate(); worker = null; prontoParaOuvir = false; }
  avisar(msg + ". Escreve o pedido que funciona igual.", "erro");
}

// baixarRuntime puxa o motor (21 MB) mostrando progresso — é o que deixaria a
// pessoa olhando para "ouvindo…" sem saber o que está acontecendo.
async function baixarRuntime() {
  if (wasmBaixado) return;
  try {
    const r = await fetch("vendor/ort-wasm-simd-threaded.jsep.wasm");
    const total = Number(r.headers.get("Content-Length")) || 21600000;
    const leitor = r.body.getReader();
    let lido = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      lido += value.length;
      if (estado !== "gravando") { barra.classList.add("visivel"); barra.value = Math.min(1, lido / total); micDica.textContent = `preparando a voz… ${Math.round(100 * lido / total)}% (só na primeira vez)`; }
    }
    wasmBaixado = true;
  } catch (e) { /* o worker tenta de novo por conta própria */ }
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
    estado = "gravando";
    mic.classList.add("gravando");
    micRotulo.textContent = "Gravando… solte para parar";
    previaVoz.hidden = true;
    // Enquanto ela fala, o motor e o modelo já vão baixando/carregando.
    baixarRuntime().then(() => criarWorker().postMessage({ tipo: "aquecer" }));
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

function fecharGravacao() {
  const g = gravacao;
  gravacao = null; travado = false;
  clearInterval(g.relogio);
  g.proc.disconnect(); g.stream.getTracks().forEach((t) => t.stop()); g.ctx.close();
  mic.classList.remove("gravando");
  cancelar.classList.remove("visivel");
  return g;
}

function voltarAoParado() {
  estado = "parado";
  clearTimeout(relogioPrazo);
  mic.disabled = false;
  mic.classList.remove("gravando", "ouvindo");
  micRotulo.textContent = "Segure para falar";
  micDica.textContent = DICA;
  barra.classList.remove("visivel");
  cancelar.classList.remove("visivel");
}

function descartar() {
  if (estado === "gravando") fecharGravacao();
  voltarAoParado();
  avisar("Gravação cancelada.");
}

function desistirDaTranscricao() {
  if (worker) { worker.terminate(); worker = null; prontoParaOuvir = false; }
  voltarAoParado();
  avisar("Cancelado. Pode gravar de novo ou escrever.");
}

function parar() {
  const g = fecharGravacao();
  if (Date.now() - g.inicio < 700) { voltarAoParado(); avisar("Segure o botão enquanto fala 🙂"); return; }
  const audio = para16k(g.pedacos, g.taxa);
  estado = "transcrevendo";
  mic.classList.add("ouvindo");
  micRotulo.textContent = "Transcrevendo… toque para cancelar";
  micDica.textContent = prontoParaOuvir ? "aqui no seu celular, não sai daqui" : "preparando a voz… (só na primeira vez demora)";
  avisar("");
  criarWorker().postMessage({ tipo: "transcrever", audio }, [audio.buffer]);
  relogioPrazo = setTimeout(() => { if (estado === "transcrevendo") falhaDeVoz("Demorou demais para transcrever"); }, PRAZO_TRANSCRICAO);
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
