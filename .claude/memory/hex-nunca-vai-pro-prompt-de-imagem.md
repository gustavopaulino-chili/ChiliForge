---
name: hex-nunca-vai-pro-prompt-de-imagem
description: "Slots de cor vazios no prompt de imagem (\"Brand palette: ;;;\") são o scrub agindo de propósito, NÃO dado faltando — não saia caçando o payload"
metadata: 
  node_type: memory
  type: project
  originSessionId: d8a4ccfd-3297-41a0-ab55-1543e8071047
  modified: 2026-08-04T13:48:10.746Z
---

No prompt de **imagem** do `agents-ads` compose, `scrubBgPromptText`
(`supabase/functions/agents-ads/index.ts`) remove todo `#hex` de propósito: se o hex
sobrevive, o modelo pinta `#fee701` como **texto dentro do banner**. A cor é transmitida
por **nome em inglês** via `describeHexColor` (`#fee701` → `amber`), nunca por código.

**Por isso, "Brand palette: ;;;" e "Colors: primary:  → dominant element" no
`forge_debug.prompt` NÃO significam que `primaryColor`/`accentColor` chegaram vazios.**
Em 04/08/2026 esse foi o diagnóstico errado que quase mandou rastrear `company_form_data`
e o payload do n8n à toa. O teste decisivo é reproduzir a string: os rótulos `--x:` caem
por uma regra e os hexes por outra, então
`--primary:#fee701;--secondary:#161202;--accent:#161202;--font-headline:'Montserrat'`
vira exatamente `;;;'Montserrat',sans-serif` — **conte os `;`**: cada um é um hex que
ESTAVA lá. Se há 3 `;`, chegaram 3 cores. Confirme também que a linha
`BRAND COLORS — the DOMINANT background color is <nome>` traz o nome certo
(`describeHexColor` do hex esperado); se traz, o dado está correto e o bug é outro.

**Consertado em 04/08/2026 (commit ab7c642):** o scrub agora **substitui** o hex pelo nome
em vez de apagá-lo, porque slot vazio = zero peso textual — e a única frase de cor com peso
sobrava sendo a prosa do brief, deixando um concorrente navy/coral vencer uma marca âmbar.
Ver [[cor-do-concorrente-vence-por-volume-de-prosa]].

**How to apply:** nunca "reinjete o hex" no prompt de imagem para resolver slot vazio —
isso ressuscita o bug do hex desenhado como texto. Injete o **nome**. O hex de verdade
continua indo normalmente para o overlay HTML, que é onde ele deve estar.
