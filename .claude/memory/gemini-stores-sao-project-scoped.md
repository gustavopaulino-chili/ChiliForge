---
name: gemini-stores-sao-project-scoped
description: Trocar a key do Gemini invalida TODOS os File Search stores — eles pertencem ao projeto Google da key que os criou
metadata: 
  node_type: memory
  type: project
  originSessionId: 78dfda94-50bb-4cee-9791-d6c711bc2b99
---

Um File Search store do Gemini pertence ao **projeto Google da API key que o criou**.
Trocar `GEMINI_API_KEY_PRODUCTION` por uma key de outro projeto invalida **todos** os
`gemini_store_name` já gravados: o acesso volta `403 PERMISSION_DENIED` em ~2s
("You do not have permission to access the file search store X or it may not exist").

Falha rápido (não trava), mas o store **nunca se regenera sozinho** — o nome inválido
continua no banco e `get_or_create` insiste nele. Para reconstruir é preciso limpar as
colunas para `NULL`, o que força `createStore`.

Store names ficam espalhados em: `projects.gemini_store_name`,
`projects.gemini_memory_store`, `projects.gemini_good_examples_store`,
`ads_campaign_examples.gemini_store_name`, `company_store_files.gemini_store_name` +
`gemini_file_uri` (a Files API também é project-scoped), `global_store_files.store_name`
e `system_settings` (chaves `gemini_global_ads_store`, `gemini_global_ads_reference_store`,
`gemini_global_ads_image_reference_store`, `gemini_global_lp_store`).

**Why:** em 14/07/2026 o `.env` do servidor live estava com PRODUCTION/TESTING invertidos
em relação ao `.env` local — o slot PRODUCTION tinha a key free-tier, cujas operações de
indexação de File Search **nunca ficavam `done`** (upload aceito, LRO só devolve `{name}`,
sem `done`/`error`). Isso fazia `waitForOperation` (60×2s) queimar 120s e derrubar o
endpoint no corte do proxy. Corrigido em 15/07/2026: a key paga foi para PRODUCTION.

**How to apply:** antes de culpar o código por lentidão/hang em store sync, teste a key
direto: `curl "https://generativelanguage.googleapis.com/v1beta/fileSearchStores?key=$K"`
(lista) e um `get_or_create` na edge. Se a key nova lista zero stores enquanto o sistema
tem stores antigos, houve troca de projeto. Ver [[gemini-testing-key-free-tier]] e
[[deploy-api-both-servers]].
