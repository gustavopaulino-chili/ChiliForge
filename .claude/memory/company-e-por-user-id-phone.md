---
name: company-e-por-user-id-phone
description: "Company é identificada por (user_id, phone); duplicatas causavam ad sair com identidade de outra marca. Índice único + get-or-create atômico resolveram."
metadata: 
  node_type: memory
  type: project
  originSessionId: 78dfda94-50bb-4cee-9791-d6c711bc2b99
---

A company (projects, project_type='project') é identificada por **(user_id, phone)**.
`phone` faz dois papéis: chave de identidade da empresa E número de WhatsApp do destinatário.
Reusar um phone pra marcas diferentes = mesma company (dados acumulam/vazam por merge).

**Bug resolvido em 15-16/07/2026:** existiam linhas DUPLICADAS em projects pro mesmo
(user_id, phone), e os dois resolvedores usavam desempate diferente — `company-assets.php`
(pushes de logo/cor/brief) tinha `LIMIT 1` sem ORDER BY; `generate-ads.php` (geração) tinha
`ORDER BY created_at DESC`. Com duplicata, push gravava numa company e geração lia outra →
marca nova saía com logo/design de marca antiga (ex.: Unica saindo com identidade da Chili),
e deletar a company visível não adiantava porque a geração lia a duplicata escondida.

**Correções (todas deployadas):**
1. As duas queries agora idênticas: `ORDER BY created_at DESC, id DESC LIMIT 1`.
2. Get-or-create ATÔMICO nos dois endpoints: recupera da corrida de INSERT (errno 1062 /
   mysqli_sql_exception) re-lendo a linha, em vez de criar duplicata.
3. `ALTER TABLE projects ADD UNIQUE INDEX uniq_company_user_phone (user_id, phone)` — a trava
   no banco. Filhos têm phone NULL (MySQL trata múltiplos NULL como distintos), então o índice
   só restringe as companies.

**deleteProject.php agora purga TUDO** (princípio do usuário: deletou no Forge, some tudo):
além do que já cascateava (filhos, campanhas/criativos via FK, company_store_files,
ad_generation_jobs, pastas), agora apaga `company_asset_jobs` (guardava gemini_api_key),
`ad_generation_job_batches` (sem FK cascade) e os stores do Gemini via API do Google
(best-effort, depois de responder — 403 pós-troca-de-key só loga).

O logo/design de um ad SEMPRE vem da company resolvida por phone, congelado no snapshot
`ads_campaign.form_data` no submit. Não há dado hardcoded de marca nenhuma no código.
Ver [[gemini-stores-sao-project-scoped]].

**IMPORTANTE (17/07/2026): "company duplicada" pode NÃO ser bug do Forge.** Investigando um
caso (registro na 297, geração na 298, mesmo phone), o diagnóstico decisivo foi comparar as
linhas: `phone` IDÊNTICO byte a byte (HEX igual), `project_type='project'` nos dois, mas
`user_id` DIFERENTE (297=user 5, 298=user 19). Como um `api_key` mapeia pra UM usuário, isso
significa que os nós do n8n estavam autenticando com **api_keys de contas diferentes** — cada
conta tem seu namespace de company por design, então a identidade caiu numa conta e a geração
noutra. Correção é 100% no n8n (unificar o `api_key`), zero backend. **Antes de tratar
duplicata como bug, rode o SELECT com `HEX(phone)`, `user_id` e `project_type` das duas linhas
— se só o `user_id` difere, é chave/conta errada no caller, não o resolver.**
