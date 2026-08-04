---
name: prosa-nao-vence-pixel
description: Regra de prompt não vence imagem de referência legível — tire a fonte do input em vez de proibir por escrito
metadata:
  node_type: memory
  type: project
---

Duas vezes na mesma sessão (04/08/2026) o mesmo padrão: **o que está nos PIXELS vence o que
está no texto do prompt.**

1. Cor: um `⛔ COLOUR CARVE-OUT` de uma linha perdeu para um parágrafo de prosa navy/coral.
2. Texto queimado: ~15 parágrafos de "NUNCA desenhe texto/logo" perderam para refs que eram
   anúncios do concorrente em resolução cheia (headline "O que a Conversion faz? / maior
   agência de SEO do Brasil"; outra ref era SÓ o wordmark do iFood sobre vermelho). Saiu
   "aglencies" queimado, logotipo desenhado e vermelho vazando na paleta.

**Reduzir/borrar a referência NÃO resolve — isso foi MEDIDO, não suposto.** Headline que
ocupa um terço do quadro é **baixa frequência**: encolhe junto com a imagem. A 320px ainda
se lê perfeitamente, e mesmo com borrão equivalente a 64px continua legível — nesse ponto os
devices decorativos (dots, halftone) que queríamos preservar já morreram. Não há separação
de frequência entre "texto grande" e "elemento de design".

**O que funciona: não mandar o pixel.** Em modo proxy a estrutura do concorrente já chega
como PROSA no brief (é para isso que o brief proxy existe) — e prosa não dá para traçar.
O modelo passou a receber só o site do próprio cliente + refs de geração + o swatch de cor.
Run 269: 6 refs → 2, zero texto queimado, e o anúncio continuou rico e decorado, provando
que o brief sustenta a estrutura sozinho.

**How to apply:** ao ver o modelo copiar algo que o prompt proíbe, pergunte "isso está em
alguma imagem que eu mandei?" antes de escrever mais uma regra. Se estiver, tire a imagem
(ou o dado) do input. Regra em prosa é o último recurso, não o primeiro.
Ver [[cor-do-concorrente-vence-por-volume-de-prosa]] e [[hex-nunca-vai-pro-prompt-de-imagem]].
