---
name: cor-do-concorrente-vence-por-volume-de-prosa
description: "No prompt de imagem, uma linha de carve-out não vence um parágrafo de prosa de cor — tire a cor do texto em vez de mandar ignorá-la"
metadata: 
  node_type: memory
  type: project
  originSessionId: d8a4ccfd-3297-41a0-ab55-1543e8071047
  modified: 2026-08-04T13:48:28.747Z
---

Modelo de imagem obedece **volume de texto**, não hierarquia declarada. Um
`⛔ COLOUR CARVE-OUT: ignore todas as cores acima` de UMA linha perde para 300+ palavras
de prosa vívida ("a deep, sophisticated navy accented by a warm, energetic coral").
Foi assim que a Unica (`#fee701`, âmbar) saiu com navy+coral do concorrente.

**Padrão que funciona:** não discuta com a prosa depois do fato — **tire a cor dela**.
`stripColourFromBrief` (agents-ads) troca cada palavra de matiz do brief-proxy por
`brand-coloured`, que **aponta para** a linha BRAND COLORS em vez de contradizê-la, e
preserva a estrutura palavra por palavra ("flat, rich … field", "lower third",
"scattered dots"). Só matiz: palavras que também são material/prop no layout (stone,
slate, sand, bronze) e o termo "white space" ficam de fora. Vantagem decisiva: **conserta
brief já GRAVADO** — é neutralizado na leitura, sem precisar regerar company.

**Armadilha irmã — exemplo no prompt vira output.** O system prompt do brief pedia
"name the client's colours **(warm coral, deep navy** — never hex)" e o modelo devolvia
o exemplo como se fosse a paleta da marca. **Nunca ponha paleta-exemplo em instrução de
brief** (nem "por exemplo"): descreva a REGRA. Hoje manda descrever só o que se VÊ nas
imagens do site do cliente e, sem paleta clara, não escrever nada sobre cor.

Verificado no run 266 (company 297): navy 0 / coral 0, 8× `brand-coloured`, banner âmbar.
Ver [[hex-nunca-vai-pro-prompt-de-imagem]], [[brief-full-only-for-company-calls]] e
[[ads-test-run-counter]].

**Resíduo conhecido (não corrigido):** os modificadores de intensidade que qualificavam a
cor do concorrente sobrevivem ao lado do token ("deep, sophisticated brand-coloured"),
puxando para um âmbar mais escuro/quente do que o `#fee701` puro. Só vale mexer se o
usuário reclamar de amarelo apagado — ver [[nao-reformular-o-que-funciona]].
