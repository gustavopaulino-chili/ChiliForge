# Brief de implementação — Integração ClickUp → ChiliForge (v1)

> Documento para o Claude Code. Lê inteiro antes de começar. Onde houver
> "DECISÃO PENDENTE", **não chute** — pare e pergunte ao desenvolvedor humano.

---

## 1. Objetivo

Permitir que o usuário conecte a conta do ClickUp dele ao Forge e importe
empresas (clientes) detectadas no ClickUp para a aba **Projects**. Cada empresa
importada entra no pipeline existente de empresa do Forge: vira um registro com
nome + canais, tem o site scrapeado e os dados interpretados, alimentando a
store de conhecimento.

O ClickUp é apenas **mais uma fonte de entrada** para o pipeline de empresa que
já existe. Não é uma integração paralela. Modele a importação como uma fonte
plugável (`source = clickup`) para que outras fontes (CSV, manual) possam ser
adicionadas depois sem reescrever o pipeline.

---

## 2. Escopo

### Dentro da v1 (construir agora)
1. Fluxo OAuth 2.0 do ClickUp (conectar conta).
2. Listar empresas detectadas (parse + deduplicação por nome, mantendo canais).
3. Tela de seleção das empresas a importar.
4. Portão de confirmação da URL do site antes de scrapear.
5. Criação da empresa no Forge + disparo do pipeline existente (scrape →
   interpretação → store).
6. Triagem dos anexos do ClickUp antes de mandar para a store.
7. Portão de revisão do perfil antes do commit final.
8. Idempotência: reimportar não duplica.

### Fora do escopo da v1 (NÃO construir)
- Sincronização contínua / detecção automática de empresa nova → **v3**.
- Geração de campanhas/ads a partir do plano de mídia → descartado por enquanto.
- Webhooks do ClickUp.
- Qualquer escrita de volta no ClickUp (a integração é **somente leitura**).

Se algo do escopo da v1 parecer que precisa de algo da v2/v3 para funcionar,
**pare e pergunte** — provavelmente está expandindo demais.

---

## 3. Stack e convenções (seguir o projeto existente)

- Backend: **PHP 8+ procedural, sem framework, sem autoload, sem PSR**.
  Cada endpoint começa com `include "db.php"`. Validação por endpoint.
- Endpoints PHP em **snake_case** no nome do arquivo (ex: `clickup_callback.php`).
  > Obs: o projeto tem endpoints em camelCase (`getAdCreatives.php`) e o doc de
  > convenções diz snake_case. **DECISÃO PENDENTE**: confirmar o padrão real de
  > nomenclatura de endpoint com o dev antes de criar os arquivos.
- Banco: **MySQL 8 via MySQLi**, colunas em **snake_case**.
- Frontend: **React 18 + TypeScript (strict OFF) + Vite**, Tailwind + shadcn/ui.
- Serviços HTTP centralizados em `src/services/api.ts`.
- Estrutura por domínio. Colocar o frontend desta feature em `src/project/`
  (a aba Projects vive aqui) ou criar `src/clickup/` se ficar mais limpo.
- **Não** usar Supabase Edge para esta feature — é só OAuth + REST, sem IA.
  Mantém tudo no PHP.
- Tipos em `src/types/`.

---

## 4. Pipeline (ordem de execução)

```
Conectar ClickUp (OAuth, uma vez)
  → Detectar + deduplicar empresas (mantém canais)
  → Usuário seleciona empresas
  → [PORTÃO] Confirmar URL do site         ← não scrapeia antes disso
  → Scrape + interpretar site
  → Triar anexos do ClickUp → store
  → [PORTÃO] Revisar perfil + criar empresa ← preview antes do commit
```

Princípio: o barato e confiável roda primeiro; as etapas caras (scrape +
interpretação por IA) só rodam depois de um portão de confirmação do usuário.
Nunca queimar scrape/IA num site não confirmado nem criar empresa com perfil
não revisado.

---

## 5. Modelo de dados (MySQL)

Criar migration / SQL para duas tabelas novas.

### `clickup_connections`
Guarda a conexão OAuth de cada usuário.

| coluna | tipo | nota |
|---|---|---|
| id | BIGINT PK AUTO_INCREMENT | |
| user_id | BIGINT | FK para o usuário do Forge |
| access_token | TEXT | **criptografado em repouso** — ver seção 8 |
| refresh_token | TEXT NULL | criptografado, se o ClickUp devolver |
| token_expires_at | DATETIME NULL | |
| clickup_user_id | VARCHAR | id do usuário no ClickUp |
| workspace_id | VARCHAR NULL | team_id do ClickUp escolhido |
| created_at | DATETIME | |
| updated_at | DATETIME | |

Restrição: um usuário pode ter no máximo uma conexão ativa (ou tratar múltiplas
se o produto exigir — **DECISÃO PENDENTE**, default: uma).

### Campos a adicionar na tabela de `projects`/empresa (não criar nova tabela)
Para idempotência e rastreabilidade da origem:

| coluna | tipo | nota |
|---|---|---|
| source | VARCHAR | `clickup` \| `manual` \| ... (default `manual`) |
| clickup_list_ids | JSON/TEXT | ids das Lists que originaram a empresa |
| channels | JSON/TEXT | canais detectados, ex: `["SEO","PPC"]` |

> Antes de criar: **DECISÃO PENDENTE** — confirmar o nome real da tabela de
> empresa/projeto e suas colunas atuais. Não assumir.

---

## 6. Endpoints PHP a criar

Todos com `include "db.php"`, validação própria, resposta JSON.

1. **`clickup_oauth_start.php`** (ou tratar no front) — devolve/redireciona para
   a URL de autorização do ClickUp com `client_id`, `redirect_uri`,
   `response_type=code`.
2. **`clickup_callback.php`** — recebe o `code`, troca por `access_token` no
   endpoint de token do ClickUp, criptografa e salva em `clickup_connections`.
3. **`clickup_list_companies.php`** — usa o token salvo, navega a hierarquia do
   ClickUp, faz parse + dedup, devolve a lista de empresas detectadas (nome +
   canais + list_ids). Ver seção 7.
4. **`clickup_import_companies.php`** — recebe a seleção do usuário + as URLs
   confirmadas, cria os registros de empresa (`source=clickup`), salva
   `clickup_list_ids` e `channels`, e dispara o pipeline existente de
   scrape/interpretação. Implementar idempotência aqui (ver seção 7).

Reaproveitar a lógica de scrape + store que já existe — **não reimplementar**.
Localizar o serviço/endpoint atual que faz "criar empresa + scrape + store" e
chamar ele a partir do import.

---

## 7. Integração ClickUp — detalhes e pegadinhas

Base URL: `https://api.clickup.com/api/v2`. Documentação para agentes:
`https://developer.clickup.com/llms.txt`.

### Autenticação (OAuth 2.0, authorization code flow)
- Registrar app no developer portal → obter `client_id` + `client_secret`.
- `redirect_uri` precisa bater **exatamente** com o registrado.
- URL de autorização:
  `https://app.clickup.com/api?client_id=...&redirect_uri=...&response_type=code`
- Trocar `code` por token via POST no endpoint Get Access Token.
- **PEGADINHA CRÍTICA**: no header `Authorization` da API v2 o token vai **cru**,
  sem o prefixo `Bearer`. Errar isso custa horas de debug.
- `client_secret` **nunca** vai pro frontend. A troca de code por token acontece
  só no PHP.

### Hierarquia e o que é "empresa"
ClickUp: `Workspace (team)` → `Space` → `Folder` → `List` → `Task`.
No ClickUp de vocês a empresa **não** é uma entidade nativa — ela está embutida
no **nome da List**, no padrão `{CANAL} - {Empresa}`. Estrutura observada:

- Space: `Campaign Delivery ...`
- Folder: `(Brazil) Projects`
- Lists: `SEO - Daikin`, `PPC - Infios`, `BKLinks - ByBit BR`, `SEO INT - ...`

Endpoints para navegar:
- `GET /api/v2/team` → workspaces (atenção: `team_id` = Workspace ID, **não** um
  sub-time).
- `GET /api/v2/team/{team_id}/space` → spaces.
- `GET /api/v2/space/{space_id}/folder` → folders.
- `GET /api/v2/folder/{folder_id}/list` → lists.

> **DECISÃO PENDENTE**: o Space "Campaign Delivery" e a Folder "(Brazil) Projects"
> devem ser fixos, ou o usuário escolhe Space/Folder na UI? Default sugerido:
> deixar o usuário escolher o Space e a Folder, e só então listar as Lists.

### Parse + deduplicação (a única lógica de verdade)
1. Para cada List, separar pelo primeiro ` - `: à esquerda o canal, à direita o
   nome da empresa. Tratar canais multi-palavra (`SEO INT`).
2. Normalizar o nome da empresa (trim, colapsar espaços) para a chave de dedup.
3. Agrupar Lists pela empresa, agregando os canais.
   Ex: `PPC - BM Móveis` + `SEO - BM Móveis` → `{ empresa: "BM Móveis",
   canais: ["PPC","SEO"], list_ids: [...] }`.
4. **NÃO** fazer agrupamento "inteligente" por similaridade (ex: juntar
   `Chili BR` / `Chili Brasil` / `Chili.com.br`). Isso é arriscado. Mostrar as
   variações como entradas separadas e deixar o usuário decidir se são a mesma
   empresa. Menos mágica, menos erro.

### Origem da URL do site (portão antes do scrape)
Tentar nesta ordem:
1. Ler de um custom field/doc padrão da List, **se existir**.
2. Senão, campo editável na UI onde o usuário digita/confirma a URL.

> **DECISÃO PENDENTE**: existe um custom field padrão com a URL do site no
> ClickUp de vocês? Se sim, qual o nome/id? Se não há fonte estruturada,
> **não** tentar adivinhar a URL pelo nome da empresa (busca automática traz
> site errado) — usar sempre input confirmado pelo usuário.

### Triagem de anexos para a store
Ao puxar conteúdo do ClickUp para a store, **filtrar**: ingerir apenas docs de
marca/conteúdo (briefing, guidelines, posicionamento, plano de mídia como
referência). **Descartar** ruído operacional (status de task, comentários
internos, datas, responsáveis). Marcar a origem de cada dado na store
(`origem: clickup`) para permitir resolver conflitos com os dados do scraper de
site depois.

### Rate limit
100 requisições/min por token. Para o cadastro pontual é folgado. Implementar
backoff exponencial respeitando o header `Retry-After` em respostas 429, por
segurança nos loops de listagem.

### Idempotência
Antes de criar uma empresa no import, checar se já existe empresa com
`source=clickup` e interseção de `clickup_list_ids`. Se existir, oferecer
**atualizar** (mesclar canais/list_ids) em vez de criar duplicada.

---

## 8. Segurança

- Criptografar `access_token` e `refresh_token` em repouso (não salvar em texto
  puro). Usar uma chave de uma variável de ambiente do servidor.
- `client_secret` só no servidor, nunca exposto ao frontend nem commitado.
- `redirect_uri` registrado e validado.
- Não logar tokens.

---

## 9. Frontend (React)

Telas/fluxo:
1. Botão "Conectar ClickUp" na aba Projects → inicia OAuth.
2. Após callback, tela de seleção: lista de empresas detectadas (nome + chips de
   canais), com checkbox por empresa.
3. Para cada empresa selecionada, campo de URL do site (pré-preenchido se veio
   do ClickUp, senão input vazio a confirmar).
4. Tela/preview do perfil interpretado pós-scrape, com botão de confirmar
   (commit) ou descartar.

Centralizar as chamadas em `src/services/api.ts`. Tipar as respostas em
`src/types/`. Reusar componentes shadcn/ui existentes.

---

## 10. Tratamento de erros

O projeto tem histórico de `catch {}` silenciosos — **não repetir isso aqui**.
Cada falha de rede/OAuth/parse deve: (a) ser logada com contexto suficiente,
(b) virar uma mensagem clara pro usuário na UI. Estados a tratar
explicitamente: OAuth negado pelo usuário, token expirado/revogado (oferecer
reconectar), 429 rate limit, Space/Folder/List vazios, falha no scrape (não
deve travar o import inteiro — isolar por empresa).

---

## 11. Definition of Done (v1)

- [ ] Usuário conecta o ClickUp via OAuth e o token fica salvo criptografado.
- [ ] Lista de empresas detectadas aparece deduplicada, com canais agregados.
- [ ] Variações de nome aparecem separadas (sem agrupamento automático).
- [ ] Usuário seleciona empresas e confirma a URL de cada uma antes do scrape.
- [ ] Scrape/interpretação só roda após a confirmação da URL.
- [ ] Empresa criada com `source=clickup`, `channels` e `clickup_list_ids`.
- [ ] Anexos do ClickUp passam por triagem antes de ir para a store.
- [ ] Preview do perfil é mostrado antes do commit final.
- [ ] Reimportar a mesma empresa atualiza em vez de duplicar.
- [ ] Nenhum `catch {}` silencioso; erros logados e exibidos.
- [ ] Token e secret nunca expostos ao frontend nem commitados.

---

## 12. Ordem de implementação sugerida

1. SQL das tabelas + colunas novas (seção 5).
2. OAuth: `clickup_oauth_start.php` + `clickup_callback.php` + persistência
   criptografada. Validar o fluxo ponta a ponta antes de seguir.
3. `clickup_list_companies.php`: navegação da hierarquia + parse + dedup.
4. Frontend: conectar + tela de seleção (consumindo o endpoint acima).
5. Portão de URL + `clickup_import_companies.php` chamando o pipeline existente.
6. Triagem de anexos para a store.
7. Preview de perfil + commit + idempotência.
8. Tratamento de erros e estados de borda.

Commitar em incrementos pequenos. Lembrar que há arquivos pendentes no branch
`dev` (`AdCreatives.tsx`, `CampaignScreen.tsx`, `getAdCreatives.php`,
`agents-ads/index.ts`) — **não** misturar esta feature com esses commits soltos;
trabalhar em branch própria.

---

## 13. Decisões pendentes (resolver com o humano ANTES de codar)

1. Padrão real de nomenclatura de endpoint (snake_case vs camelCase).
2. Nome e schema atual da tabela de empresa/projeto.
3. Space/Folder fixos ou escolhidos pelo usuário na UI.
4. Existe custom field padrão com a URL do site? Qual?
5. Uma conexão ClickUp por usuário ou várias.
6. Onde reaproveitar o pipeline de scrape+store existente (qual arquivo/função).
