# EDNA — suas tarefas do dia, sem cadastro

**Use agora:** https://fazmeuapp.com.br/edna/

Escreva do jeito que fala — *"dentista sexta 9h"*, *"pagar a luz dia 30"* — e a
EDNA põe cada coisa no lugar: **Hoje**, **Compromissos**, **Próximos dias**,
**Tarefas**. Instala no celular e no PC como app, funciona offline, e nada sai
do seu aparelho.

**♥ Meu amor:** quem você ama manda pedidos direto para a sua lista, por texto
ou por voz, sem cadastro — só com um link. A voz é transcrita **dentro do
celular** de quem fala (Whisper no navegador); o servidor só recebe o texto.

## O que tem aqui

| Pasta | O que é |
|---|---|
| `site/` | a página e os dois apps (PWA): `app/` é a lista; `amor/` é o app de quem manda pedidos |
| `site/app/datas.js` | entende data escrita em português (testes em `site/testes`) |
| `site/amor/whisper.js` | Whisper rodando no navegador, num worker, com biblioteca e modelo em versão fixa |
| `cmd/mozao/` | o único servidor: guarda os pedidos "meu amor" (Go, sem banco, um JSON por lista) |

## Rodar

Site: qualquer servidor estático na pasta `site/` (ex.: `python -m http.server`).
O app do dono espera a API em `../api/` — atrás de um proxy, aponte
`/edna/api/*` para o `mozao`.

```bash
go run ./cmd/mozao --porta 8200 --dados ./dados --prefixo /edna/api
node --test site/testes/datas.test.mjs
go test ./cmd/mozao
```

## Segurança e privacidade

- Sem conta e sem senha: a identidade é por chaves aleatórias (segredo do dono,
  link de convite, token do parceiro) que vivem só nos aparelhos. No servidor
  ficam apenas os hashes.
- O servidor guarda só texto curto (quem pediu, o quê, se é urgente). Pedidos
  concluídos são apagados em 30 dias. Freios por IP e por lista.
- Áudio nunca sai do aparelho. A biblioteca de transcrição é servida do próprio
  site (não de CDN) e o modelo é baixado em revisão fixa do Hugging Face.
- A página roda com Content-Security-Policy: só código do próprio site.

Feito pela [fazmeuapp](https://fazmeuapp.com.br). Licença MIT.
