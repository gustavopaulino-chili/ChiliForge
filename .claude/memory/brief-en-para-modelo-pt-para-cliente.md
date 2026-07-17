---
name: brief-en-para-modelo-pt-para-cliente
description: brandVisualBrief fica em INGLÊS de propósito (alimenta o modelo de imagem); o pt-BR do cliente é o campo separado brandVisualBriefPt
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 78dfda94-50bb-4cee-9791-d6c711bc2b99
---

O `brandVisualBrief` é **intencionalmente em inglês**. NÃO traduza esse campo.

Ele é lido por duas máquinas: o prompt do modelo de imagem (`agents-ads` compose →
`buildBackgroundPrompt`, ~`index.ts:3700`) e o documento do Gemini File Search store
(`helpers.php:933`). Os dois aderem melhor a inglês.

O texto pt-BR que vai pro cliente no WhatsApp é um campo **separado**: `brandVisualBriefPt`
(`brief_pt` na resposta da edge / `brand_visual_brief_pt` na resposta do
`company-assets.php`). É gerado por uma chamada de tradução dedicada no fim do modo
`brand_visual`, não-fatal — se falhar, toda a cadeia (edge → PHP → n8n) faz fallback pro
brief EN em vez de mandar mensagem vazia.

O `brief_pt` é traduzido de `brandBrief`, **não** de `brief`: a seção
`[COMPETITOR LAYOUT PATTERNS]` fica de fora do que chega ao cliente (o rótulo é diretiva
interna pro Gemini, e o cliente pediu estudo da marca DELE). Ela continua no `brief` EN,
onde dá o padrão de layout do nicho pro gerador. Regra dura do usuário: **nunca expor
engrenagem interna na conversa com o cliente**.

**Why:** pedido do usuário em 15/07/2026 — "o chat é em português". Traduzir o campo único
resolveria o WhatsApp mas empurraria pt-BR pro prompt de imagem de todo ad, em silêncio.
O usuário já sofreu regressão parecida antes ao mexer no brief (ver
[[brief-full-only-for-company-calls]]: brief não-capado dominou e "todo ad ficou igual").

**How to apply:** no n8n `crawl client` (`6MGNEuym4_dSVp7755SBF`), o node `Split Design
(first)` usa `brand_visual_brief_pt || brand_visual_brief` e o `Eval Brief` carrega os dois —
mas a condição `ready` continua olhando o brief EN. Edições no n8n ficam como **rascunho**:
`update_workflow` não publica, é preciso `publish_workflow` (compare `versionId` x
`activeVersionId`). Ver [[gemini-stores-sao-project-scoped]].
