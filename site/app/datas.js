// Entender data escrita do jeito que se fala — a mesma regra da lousa do
// Diego (cmd/edna/main.go e voz.go), reescrita para rodar no navegador.
//
//   interpretar("consulta amanhã 14h")         → { texto: "Consulta", dia: "2026-09-26", hora: "14:00" }
//   interpretar("sexta às 3 da tarde reunião")  → { texto: "Reunião", dia: …, hora: "15:00" }
//   interpretar("comprar 2 caixas de leite")    → { texto: "Comprar 2 caixas de leite", dia: null, hora: null }
//
// A data pode estar em qualquer ponto da frase. Na dúvida, não é data: um item
// sem data está certo; um prazo inventado não.

const DIAS_DA_SEMANA = {
  domingo: 0, dom: 0,
  segunda: 1, "segunda-feira": 1, seg: 1,
  terca: 2, "terça": 2, "terca-feira": 2, "terça-feira": 2, ter: 2,
  quarta: 3, "quarta-feira": 3, qua: 3,
  quinta: 4, "quinta-feira": 4, qui: 4,
  sexta: 5, "sexta-feira": 5, sex: 5,
  sabado: 6, "sábado": 6, sab: 6, "sáb": 6,
};

const ENFEITE = new Set(["as", "às", "ás", "a", "à", "dia", "de", "no", "na"]);

function doisDigitos(n) {
  return String(n).padStart(2, "0");
}

export function paraISO(d) {
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

function inicioDoDia(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function somarDias(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// hora lê "14h", "14hs", "14:30", "14h30" e "9".
function hora(token) {
  const s = token.replace(/hs?$/, "");
  const m = s.match(/^(\d{1,2})(?:[:h](\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return `${doisDigitos(h)}:${doisDigitos(min)}`;
}

// dia resolve só o dia; devolve null se não for dia.
function dia(s, hoje) {
  switch (s) {
    case "hoje": case "agora": return hoje;
    case "amanha": case "amanhã": return somarDias(hoje, 1);
    case "depois amanha": case "depois amanhã": return somarDias(hoje, 2);
  }
  let m = s.match(/^em (\d{1,3}) dias?$/);
  if (m) return somarDias(hoje, Number(m[1]));
  if (s in DIAS_DA_SEMANA) {
    // "sexta" dita numa sexta é hoje — é assim que se fala.
    return somarDias(hoje, (DIAS_DA_SEMANA[s] - hoje.getDay() + 7) % 7);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (m) {
    const d = Number(m[1]), mes = Number(m[2]) - 1;
    let ano = m[3] ? Number(m[3]) : hoje.getFullYear();
    if (ano < 100) ano += 2000;
    const data = new Date(ano, mes, d);
    if (data.getMonth() !== mes || data.getDate() !== d) return null; // 31/02 não existe
    // "05/01" dito em dezembro, sem ano, é o janeiro que vem.
    if (!m[3] && data < hoje) data.setFullYear(ano + 1);
    return data;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

// quando traduz um trecho ("amanhã 14h", "sexta") em { dia, hora } ou null.
export function quando(trecho, agora = new Date()) {
  const hoje = inicioDoDia(agora);
  const campos = trecho.toLowerCase().trim().split(/\s+/).filter((c) => c && !ENFEITE.has(c));
  if (!campos.length) return null;
  if (campos.length >= 2) {
    const h = hora(campos[campos.length - 1]);
    if (h) {
      const d = dia(campos.slice(0, -1).join(" "), hoje);
      if (d) return { dia: paraISO(d), hora: h };
    }
  }
  const d = dia(campos.join(" "), hoje);
  return d ? { dia: paraISO(d), hora: null } : null;
}

// normalizar traduz o jeito de falar hora e dia do mês: "3 da tarde" → "15h",
// "9 horas" → "9h", "dia 30" → "30/09", "amanhã de manhã" → "amanhã".
function normalizar(s, agora) {
  s = s.replace(/(\d{1,2})(?::(\d{2}))?\s*(?:horas?|h)?\s+da\s+(manhã|manha|tarde|noite)/gi, (_, h, m, p) => {
    let n = Number(h);
    if (/tarde|noite/i.test(p) && n < 12) n += 12;
    return m ? `${n}:${m}` : `${n}h`;
  });
  s = s.replace(/\s+(?:de|pela|à|a|na)\s+(?:manhã|manha|tarde|noite)(?=[\s,.!?;]|$)/gi, " ");
  s = s.replace(/(\d{1,2})(?::(\d{2}))?\s*horas?\b/gi, (_, h, m) => (m ? `${h}:${m}` : `${h}h`));
  s = s.replace(/\bdia\s+(\d{1,2})\b/gi, (orig, n) => {
    n = Number(n);
    let mes = agora.getMonth();
    if (n < agora.getDate()) mes += 1; // "dia 3" dito no dia 24 é o mês que vem
    const d = new Date(agora.getFullYear(), mes, n);
    if (d.getDate() !== n) return orig; // "dia 31" num mês de 30: não invento
    return `${doisDigitos(n)}/${doisDigitos(d.getMonth() + 1)}`;
  });
  return s;
}

function pareceDia(w) {
  return w.includes("/") || w === "hoje" || w === "amanha" || w === "amanhã" || w in DIAS_DA_SEMANA;
}

const CONECTOR = new Set(["às", "as", "a", "à", "de", "no", "na", "pra", "para", "até"]);

// interpretar tira a data mais longa que der para entender de qualquer ponto da
// frase e devolve o texto limpo com a primeira letra maiúscula.
export function interpretar(frase, agora = new Date()) {
  const palavras = normalizar(frase.trim(), agora).split(/\s+/).filter(Boolean);
  const limpas = palavras.map((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}/:]+$/gu, ""));
  for (let tam = 5; tam >= 1; tam--) {
    for (let ini = 0; ini + tam <= palavras.length; ini++) {
      const trecho = limpas.slice(ini, ini + tam);
      if (tam === 1 && !pareceDia(trecho[0])) continue; // "2 caixas" não é data
      if (ENFEITE.has(trecho[0])) continue;
      const q = quando(trecho.join(" "), agora);
      if (!q) continue;
      let inicio = ini;
      if (inicio > 0 && CONECTOR.has(limpas[inicio - 1])) inicio--;
      const resto = [...palavras.slice(0, inicio), ...palavras.slice(ini + tam)];
      return { texto: arrumar(resto.join(" ")) || arrumar(frase), ...q };
    }
  }
  return { texto: arrumar(frase), dia: null, hora: null };
}

function arrumar(s) {
  s = s.replace(/\s+/g, " ").replace(/\s+([,.!?;])/g, "$1").replace(/^[\s,.;:!?-]+|[\s,;:-]+$/g, "");
  return s ? s[0].toLocaleUpperCase("pt-BR") + s.slice(1) : "";
}

// rotulo escreve a data como se fala: "hoje 14:30", "amanhã", "sex 26/09".
export function rotulo(diaISO, horaTxt, agora = new Date()) {
  if (!diaISO) return "";
  const [a, m, d] = diaISO.split("-").map(Number);
  const data = new Date(a, m - 1, d);
  const dif = Math.round((data - inicioDoDia(agora)) / 86400000);
  const semana = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  let base;
  if (dif === 0) base = "hoje";
  else if (dif === 1) base = "amanhã";
  else if (dif === -1) base = "ontem";
  else if (dif > 1 && dif < 7) base = `${semana[data.getDay()]} ${doisDigitos(d)}/${doisDigitos(m)}`;
  else if (a !== agora.getFullYear()) base = `${doisDigitos(d)}/${doisDigitos(m)}/${String(a).slice(2)}`;
  else base = `${doisDigitos(d)}/${doisDigitos(m)}`;
  return horaTxt ? `${base} ${horaTxt}` : base;
}

// coluna decide onde a tarefa aparece — a mesma regra da lousa:
//   HOJE          vence hoje, e tudo que já venceu (marcado atrasado)
//   COMPROMISSOS  tem hora e ainda não passou
//   PRÓXIMOS      tem dia, sem hora, depois de hoje
//   TAREFAS       sem data
export function coluna(t, agora = new Date()) {
  if (!t.dia) return "tarefas";
  const hoje = paraISO(agora);
  if (t.hora) {
    const [a, m, d] = t.dia.split("-").map(Number);
    const [h, min] = t.hora.split(":").map(Number);
    if (new Date(a, m - 1, d, h, min) > agora) return "compromissos";
  }
  if (t.dia <= hoje) return "hoje";
  return "proximos";
}

export function atrasada(t, agora = new Date()) {
  return !!t.dia && t.dia < paraISO(agora);
}
