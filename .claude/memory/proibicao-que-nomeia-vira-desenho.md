---
name: proibicao-que-nomeia-vira-desenho
description: Proibição que SOLETRA o artefato entrega ao modelo o texto exato para desenhar — proíba descrevendo o estado desejado, nunca citando a string
metadata:
  node_type: memory
  type: project
---

Num prompt de imagem, **nomear o que é proibido é o mesmo que pedir**. Dois casos medidos
em 04/08/2026, no mesmo pipeline:

1. O nome da marca aparecia 25× no prompt de fundo (linha de cena + JSON do perfil da
   company). Saiu queimado no banner. Removido → parou.
2. As proibições de logo soletravam as strings: `'LOGO'`, `'YOUR LOGO'`, `'YOUR LOGO HERE'`,
   `'BRAND'` — 55 menções a "logo", 9 em caixa alta. O run 270 voltou com um marcador
   circular genérico e a palavra literal **"LOGO"** desenhada ao lado. Decisivo: naquele run
   só UMA imagem foi enviada (o swatch de cor), então não havia de onde traçar — o modelo
   **inventou** o placeholder a partir do próprio texto da proibição.

**Correção:** trocar a enumeração literal por uma afirmação do estado desejado — "aquele
canto é superfície vazia e plana" em vez de "nunca escreva 'LOGO'/'YOUR LOGO HERE'".
Run 271: zero placeholder, zero texto queimado, e foi o melhor banner da série.

**How to apply:** ao escrever regra anti-alguma-coisa para modelo de imagem, nunca cite a
string, o nome ou o rótulo que você não quer ver renderizado — descreva o que DEVE estar ali.
Vale para nome de marca, palavra "logo", nomes de produto e qualquer texto de exemplo.
Ver [[prosa-nao-vence-pixel]] (irmã: quando a fonte é uma imagem, tire a imagem).
