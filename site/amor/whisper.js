// O ouvido do app do parceiro: Whisper rodando dentro do celular.
//
// Roda num worker para a tela não travar enquanto transcreve. O modelo
// (whisper-base, multilíngue, ~50 MB comprimido) é baixado uma vez do Hugging
// Face, numa revisão fixa, e fica no cache do navegador. Depois disso funciona
// offline. Nenhum áudio sai do aparelho: o que vai para o servidor é só o
// texto, e só depois que a pessoa lê e confirma.
//
// A biblioteca (transformers.js) e o ONNX Runtime são servidos daqui mesmo,
// em ./vendor, com versão fixa — não de um CDN. É o código que ouve a voz:
// tem que ser exatamente o que foi revisado, sem depender de terceiro.
//
// A janela manda { tipo: "transcrever", audio: Float32Array a 16 kHz } e
// recebe { tipo: "progresso" | "pronto" | "texto" | "erro" }.

import { pipeline, env } from "./vendor/transformers.min.js";

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = new URL("./vendor/", import.meta.url).href;

const MODELO = "onnx-community/whisper-base";
// Revisão fixa do modelo (commit no Hugging Face em 27/09/2026): uma troca
// de arquivos lá não muda o que roda aqui sem alguém revisar.
const REVISAO = "1846881b6b3a3024392c1eea3ad983695bc23925";

let transcritor = null;
let carregando = null;

function carregar() {
  if (!carregando) {
    const arquivos = new Map();
    carregando = pipeline("automatic-speech-recognition", MODELO, {
      dtype: "q8",
      device: "wasm", // WebGPU em celular ainda é loteria; WASM funciona em todos
      revision: REVISAO,
      progress_callback: (p) => {
        if (p.status === "progress" && p.file) arquivos.set(p.file, [p.loaded || 0, p.total || 0]);
        let feito = 0, total = 0;
        for (const [l, t] of arquivos.values()) { feito += l; total += t; }
        if (total) self.postMessage({ tipo: "progresso", fracao: Math.min(1, feito / total) });
      },
    }).then((t) => { transcritor = t; self.postMessage({ tipo: "pronto" }); return t; });
  }
  return carregando;
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.tipo === "aquecer") { await carregar(); return; }
    if (m.tipo !== "transcrever") return;
    const t = await carregar();
    const saida = await t(m.audio, {
      language: "portuguese",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ tipo: "texto", texto: (saida.text || "").trim() });
  } catch (e) {
    self.postMessage({ tipo: "erro", mensagem: String(e && e.message || e) });
  }
};
