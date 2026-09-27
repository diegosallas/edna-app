// node --test site/testes
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretar, coluna, rotulo } from "../app/datas.js";

// Quinta-feira, 24/09/2026, 10:00 — dia fixo para os testes não mudarem.
const AGORA = new Date(2026, 8, 24, 10, 0);

test("data no fim da frase", () => {
  assert.deepEqual(interpretar("consulta amanhã 14h", AGORA), { texto: "Consulta", dia: "2026-09-25", hora: "14:00" });
});

test("data no meio, hora falada", () => {
  assert.deepEqual(interpretar("sexta às 3 da tarde reunião na escola", AGORA),
    { texto: "Reunião na escola", dia: "2026-09-25", hora: "15:00" });
});

test("período sem hora vira só o dia", () => {
  assert.deepEqual(interpretar("levar o carro na revisão amanhã de manhã", AGORA),
    { texto: "Levar o carro na revisão", dia: "2026-09-25", hora: null });
});

test("número solto não é data", () => {
  assert.deepEqual(interpretar("comprar 2 caixas de leite", AGORA), { texto: "Comprar 2 caixas de leite", dia: null, hora: null });
});

test("dia do mês", () => {
  assert.equal(interpretar("pagar a luz dia 30", AGORA).dia, "2026-09-30");
  assert.equal(interpretar("pagar a luz dia 3", AGORA).dia, "2026-10-03"); // já passou: mês que vem
});

test("dia da semana de hoje é hoje", () => {
  assert.equal(interpretar("ligar pro contador quinta", AGORA).dia, "2026-09-24");
});

test("data inválida não vira prazo", () => {
  assert.equal(interpretar("festa 31/02", AGORA).dia, null);
});

test("colunas", () => {
  assert.equal(coluna({ dia: null }, AGORA), "tarefas");
  assert.equal(coluna({ dia: "2026-09-24", hora: null }, AGORA), "hoje");
  assert.equal(coluna({ dia: "2026-09-20", hora: null }, AGORA), "hoje");
  assert.equal(coluna({ dia: "2026-09-24", hora: "15:00" }, AGORA), "compromissos");
  assert.equal(coluna({ dia: "2026-09-24", hora: "08:00" }, AGORA), "hoje"); // hora passou
  assert.equal(coluna({ dia: "2026-09-27", hora: null }, AGORA), "proximos");
});

test("rótulos", () => {
  assert.equal(rotulo("2026-09-24", "14:30", AGORA), "hoje 14:30");
  assert.equal(rotulo("2026-09-25", null, AGORA), "amanhã");
  assert.equal(rotulo("2026-09-28", null, AGORA), "seg 28/09");
});
