# Brief de implementação — ClickUp → ChiliForge (v3: sincronização / empresa nova)

> Documento para o Claude Code. Depende apenas da v1 concluída.
> Onde houver "DECISÃO PENDENTE", **não chute** — pare e pergunte ao humano.

---

## 1. Objetivo

Detectar automaticamente quando uma empresa nova aparece no ClickUp (uma List
nova na Folder de projetos) e **notificar o usuário** para importá-la, em vez de
ele precisar reabrir o fluxo manualmente toda vez.

**Princípio: detecção é automática, importação continua com portões.** A v3
**não** cria empresa sozinha. Ela detecta, avisa, e o usuário roda o fluxo da v1
(seleção → confirmar URL → scrape → preview → criar). Nada de auto-import.

---

## 2. Pré-requisitos / dependência

- v1 concluída: conexão OAuth, parse/dedup, idempotência por `clickup_list_ids`.
- A detecção reusa o parse e a deduplicação da v1 — não reimplementar.
- A importação em si é o fluxo da v1, disparado a partir de uma notificação.

---

## 3. Escopo

### Dentro da v3
1. Registrar webhook do ClickUp para detectar List nova na Folder de projetos.
2. Receiver de webhook: validar assinatura, processar evento, deduplicar.
3. Notificar o usuário sobre empresa nova detectada.
4. Refresh automático de token (jobs de fundo agora são de longa duração).
5. Fallback de polling, caso o webhook não seja viável.

### Fora do escopo da v3
- Importar/criar empresa automaticamente sem o usuário — **proibido**.
- Escrita de volta no ClickUp.
- Sincronização de alterações de dados da empresa (só detecção de empresa nova).

---

## 4. Stack e convenções

Mesmas da v1 (ver `clickup-integration-brief.md`, seção 3). Para os jobs
assíncronos / processamento em background, **reusar o padrão que o projeto já
tem** (`generate-ads-worker.php` é a referência de job assíncrono). Não
introduzir uma stack nova de filas sem necessidade.

---

## 5. Abordagem: webhook (preferido) vs polling (fallback)

O ClickUp suporta webhooks com escopo por localização. O evento relevante é
**`listCreated`**, e dá para escopá-lo na Folder de projetos
(ex: "(Brazil) Projects"). Isso é muito melhor que polling: sem gasto contínuo
de rate limit, detecção em tempo quase real.

Detalhes do webhook que importam:
- Um webhook assina uma **localização** (Space/Folder/List/task); a mais
  específica vale. Escopar na Folder de projetos pega `listCreated` das Lists
  dentro dela.
- O payload de `listCreated` traz só `{ event, list_id, webhook_id }` — **não**
  traz o nome da List. É preciso fazer `GET /api/v2/list/{list_id}` para pegar o
  nome e então rodar o parse de canal/empresa.
- O webhook tem um **secret**; validar a assinatura de cada evento recebido
  (header de assinatura) antes de processar. Não processar evento não validado.
- **Health do webhook**: o ClickUp desativa o webhook após muitas falhas
  (`fail_count`). O receiver precisa responder rápido (200) e processar o
  trabalho pesado de forma assíncrona, não dentro da resposta do webhook.

Polling é o **fallback** se o webhook não puder ser usado: cron periódico
chamando `GET /api/v2/folder/{folder_id}/list`, comparando com o que já foi
importado. Respeitar o rate limit (100 req/min por token) e backoff em 429.

> **DECISÃO PENDENTE**: webhook na Folder (default recomendado) ou polling? Se
> polling, qual intervalo? O endpoint receiver do webhook precisa ser público e
> alcançável pelo ClickUp — confirmar que a infra Hostinger expõe isso.

---

## 6. Fluxo (webhook)

```
Conexão/config → registra webhook listCreated na Folder de projetos
ClickUp cria List nova
  → ClickUp dispara listCreated no receiver
  → Receiver valida assinatura, responde 200, enfileira processamento
  → Job: GET list/{id} → parse nome → dedup contra clickup_list_ids
  → Se empresa nova → cria notificação pendente para o usuário
Usuário vê notificação
  → Entra no fluxo da v1 (seleção → URL → scrape → preview → criar)
```

---

## 7. Modelo de dados (deltas)

| tabela/coluna | tipo | nota |
|---|---|---|
| `clickup_webhooks` | tabela | webhook_id, connection_id, location_id, secret (criptografado), status, fail_count, created_at |
| `clickup_detected_companies` | tabela | empresa detectada e ainda não importada: nome, canais, list_ids, status (`pending`/`dismissed`/`imported`), detected_at |

A dedup de "empresa nova" usa os `clickup_list_ids` já salvos nas empresas
importadas (v1) **mais** os registros em `clickup_detected_companies` ainda
pendentes, para não notificar duas vezes.

---

## 8. Endpoints PHP a criar

1. **`clickup_webhook_register.php`** — cria o webhook no ClickUp (escopo na
   Folder, evento `listCreated`), salva `webhook_id` e `secret`.
2. **`clickup_webhook_receiver.php`** — endpoint público que recebe os eventos.
   Valida a assinatura, responde 200 imediatamente, enfileira o processamento.
   **Não** fazer fetch/parse/DB pesado dentro da resposta do webhook.
3. **`clickup_process_detected_list.php`** (worker) — pega o `list_id`, faz o
   fetch da List, parseia, deduplica e grava em `clickup_detected_companies` se
   for nova.
4. **`clickup_poll_companies.php`** (opcional, fallback) — cron que varre a
   Folder e detecta novas Lists. Só se o webhook não for viável.

---

## 9. Refresh de token (agora é obrigatório)

Em background de longa duração, o token vai expirar. Implementar:
- Renovação automática usando o refresh token, **se** o ClickUp devolver um no
  fluxo/plano de vocês.
- Se a renovação falhar (token revogado pelo usuário, etc.), marcar a conexão
  como inválida e **notificar o usuário para reconectar** — nunca falhar
  silencioso nem ficar tentando em loop.

> **DECISÃO PENDENTE**: confirmar se o OAuth do ClickUp no plano de vocês devolve
> refresh token e qual o tempo de vida do access token. Isso define a estratégia
> de renovação.

---

## 10. Frontend

- Um indicador de "empresas novas detectadas" na aba Projects (badge/contador).
- Lista das detecções pendentes; cada uma com ação de importar (abre o fluxo da
  v1 já pré-carregado com nome/canais/list_ids) ou dispensar.
- Estado de conexão do ClickUp: ativa / precisa reconectar (quando o refresh
  falhou).

---

## 11. Tratamento de erros e bordas

- Evento de webhook sem assinatura válida → descartar, logar.
- `list_id` que não casa com o padrão `{canal} - {empresa}` → ignorar com log,
  não criar detecção lixo.
- Webhook desativado pelo ClickUp por falhas → detectar `fail_count`/status e
  re-registrar; avisar se persistir.
- Token expirado/revogado → fluxo de reconexão (seção 9).
- Empresa já importada ou já pendente → não duplicar a notificação.
- Receiver deve ser idempotente: o ClickUp pode reenviar o mesmo evento.

---

## 12. Definition of Done (v3)

- [ ] Webhook `listCreated` registrado com escopo na Folder de projetos.
- [ ] Receiver valida assinatura e responde 200 rápido, processando async.
- [ ] List nova vira detecção pendente após parse + dedup.
- [ ] Empresa já importada/pendente não gera detecção duplicada.
- [ ] Usuário é notificado e importa pelo fluxo da v1 (com portões intactos).
- [ ] Nenhuma empresa é criada automaticamente.
- [ ] Refresh de token automático; falha vira pedido de reconexão.
- [ ] Fallback de polling implementado **ou** explicitamente descartado em acordo
      com o dev.
- [ ] Rate limit respeitado (backoff em 429).

---

## 13. Ordem de implementação sugerida

1. Resolver decisões pendentes (webhook vs polling, infra pública, refresh token).
2. `clickup_webhook_register.php` + tabela `clickup_webhooks`.
3. `clickup_webhook_receiver.php` (assinatura + 200 rápido + enfileirar).
4. Worker `clickup_process_detected_list.php` + tabela de detecções.
5. Refresh de token + estado de reconexão.
6. Frontend de notificação + ligação com o fluxo da v1.
7. Fallback de polling, se decidido.
8. Idempotência, health do webhook, erros.

---

## 14. Decisões pendentes (resolver ANTES de codar)

1. Webhook na Folder (recomendado) ou polling. Se polling, intervalo.
2. A infra Hostinger expõe um endpoint público alcançável para o receiver.
3. O OAuth do ClickUp devolve refresh token? Tempo de vida do access token.
4. Onde e como exibir as notificações de empresa nova no Forge.
5. Política quando o webhook for desativado por falhas (re-registro automático?).
