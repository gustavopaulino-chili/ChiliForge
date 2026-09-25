# ChiliForge — Documento de passagem (handover)

> Escrito em 25/09/2026, no último dia de quem mantinha o projeto. Objetivo: quem der `git pull`
> aqui consegue entender, rodar, mudar e publicar **sem precisar perguntar a ninguém**.
> Leia inteiro uma vez. Depois use como referência.
>
> Complementos (não repetidos aqui): `TRABALHANDO-COM-CLAUDE.md` (como usar o Claude Code no
> projeto), `CLAUDE.md` (regras que o Claude segue), `.claude/memory/*.md` (decisões e bugs
> históricos, com o porquê).

---

## 0. TL;DR — as 10 coisas que você PRECISA saber

1. **Trabalhe na branch `dev`.** `main`/`release`/`testing` estão paradas desde maio/junho
   (568 commits atrás). Tudo que está em produção saiu da `dev`.
2. **Não existe CI.** Commit/push **não publica nada**. Publicar = rodar scripts de FTP +
   `npx supabase functions deploy` à mão.
3. **São DOIS servidores PHP** no mesmo host Hostinger, com **bancos separados**:
   `testforge.chili.pa` (teste) e `forge.chili.pa` (**live — é o que a Fullstop usa**).
   Mudou PHP? Deploy nos **dois** (`deploy-ftp.ps1` = teste, `deploy-live.ps1` = live).
4. **Um único projeto Supabase** (`vehowvyqxhelyfdesmog`) serve teste e live. Deploy de edge
   function afeta os dois ao mesmo tempo.
5. **O cliente principal da API é a Fullstop** (WhatsApp → n8n → `api/v1/external/*`). Qualquer
   mudança no **contrato do payload** desses endpoints tem que ser avisada a eles.
6. **Geração de anúncio da API externa hoje é 100% OpenAI (`gpt-image-2`)** — o "caminho C".
   A geração por Gemini foi aposentada em 28/08/2026 **na API externa**. O Gemini continua
   sendo usado para: brief visual da marca, copy, e todo o app interno (frontend).
7. Os segredos **não estão no git**: `.env`, `.deploy.env`, `.deploy.live.env`. Sem eles nada
   de deploy funciona. Peça ao responsável/gestor onde estão guardados (Drive/cofre).
8. A empresa (company) é identificada por **(user_id, phone)**. `user_id` vem da `api_key`.
   Duas `api_key`s diferentes = duas companies diferentes para o mesmo telefone.
9. Deploy por FTP pode **falhar em silêncio** (arquivo `.in.*` órfão → erro 550 para sempre).
   Depois de todo deploy, **confira o tamanho/data do arquivo remoto**. Receita na seção 7.4.
10. Teste de geração **custa dinheiro real** (~US$ 0,10–0,14 por peça na OpenAI). Gere **uma
    peça por teste**.
11. **Se você usar o Claude Code aqui**, o hook do `.claude/settings.json` faz **commit + push
    na `dev` e deploy das edge functions alteradas sozinho** ao fim de cada resposta (seção 3.2).

---

## 1. O que é o ChiliForge

Plataforma interna da Chili para **gerar criativos de anúncio e landing pages com IA**.
Tem duas "portas de entrada":

| Porta | Quem usa | Onde está | Motor de imagem |
|---|---|---|---|
| **App web** (React) | Equipe Chili, no navegador | `src/` + `api/*.php` + `api/v1/agents/*` | Gemini (edge `agents-ads`, `agents-lp`, …) |
| **API externa** | **Fullstop** (bot de WhatsApp, via n8n) | `api/v1/external/*` | **OpenAI `gpt-image-2`** (caminho C) |

Hoje o **uso real em produção é a API externa**; é onde quase todo o trabalho dos últimos
3 meses aconteceu (ver `git log --since=2026-07-01`).

### 1.1 Arquitetura

```
                    ┌──────────────────────── Hostinger (mesmo IP, 2 contas FTP) ─────────────────────────┐
WhatsApp            │  forge.chili.pa  (LIVE)                testforge.chili.pa  (TESTE)                    │
   │                │  ├─ /index.html + /assets  (React)     ├─ idem                                        │
   ▼                │  ├─ /api/*.php             (app)       ├─ idem                                        │
 n8n (Fullstop) ───►│  ├─ /api/v1/external/*     (API ext.)  ├─ idem                                        │
                    │  ├─ /projects/<slug>/...   (arquivos gerados: ads, LPs, assets da marca)          │
                    │  ├─ /.env                  (chaves: Gemini, OpenAI, Pexels, DB…)                   │
                    │  └─ MySQL  u427845891_chiliforge (live)   ≠   banco do teste                      │
                    └────────────┬────────────────────────────────────────────┬──────────────────────────┘
                                 │ PHP chama                                  │ PHP chama
                                 ▼                                            ▼
                     Supabase Edge Functions (Deno)                  OpenAI Images API
                     projeto vehowvyqxhelyfdesmog                    (gpt-image-2, só API externa)
                     agents-ads, agents-lp, agents-store…
                                 │
                                 ▼
                     Google Gemini (texto, visão, File Search, imagem no app)  +  Pexels (fotos)
```

Pontos importantes:
- **O banco é MySQL na Hostinger**, não o Postgres do Supabase. O Supabase é usado só para
  Edge Functions (e um bucket de storage `download_files`). As tabelas em
  `supabase/migrations/` são antigas e quase não são usadas.
- O PHP roda em **LiteSpeed** (sem `fastcgi_finish_request`). Trabalho demorado é feito
  respondendo `202` e disparando um **worker CLI** com `exec('/usr/bin/php worker.php <id> &')`.
- Arquivos gerados ficam em disco em `public_html/projects/<slug>/…` e são servidos
  diretamente pelo Apache/LiteSpeed (regras em `public/.htaccess`).

---

## 2. Mapa do repositório

```
ChiliForge/
├── HANDOVER.md                 ← este documento
├── TRABALHANDO-COM-CLAUDE.md    guia de uso do Claude Code no projeto
├── CLAUDE.md                    regras que o Claude Code segue automaticamente
├── README.md                    README antigo (stack/instalação; parcialmente desatualizado)
│
├── src/                         FRONTEND React 18 + Vite + TS + shadcn/ui + Tailwind
│   ├── App.tsx                  rotas (ver 5.1)
│   ├── services/api.ts          TODAS as chamadas HTTP do front (PHP em /api e edge functions)
│   ├── contexts/AuthContext.tsx login (usuário salvo no localStorage)
│   ├── pages/                   telas
│   ├── components/editor/       AdsEditor.tsx (~9.500 linhas) e VisualEditor.tsx (~7.900) — GIGANTES
│   ├── components/ad-generator/ wizard de criação de anúncios
│   ├── components/generator/    wizard de criação de site/LP
│   └── components/project/      tela da empresa, import do ClickUp
│
├── api/                         BACKEND PHP (Hostinger)
│   ├── db.php                   conexão MySQL (ver 8.1: no servidor vale o db.php de lá)
│   ├── *.php                    endpoints do app (login, projetos, criativos, FTP, ClickUp…)
│   ├── _render.php / _browserless.php   render HTML→PNG (Chrome headless / Browserless)
│   ├── site_helpers.php         caminhos de disco, URLs públicas, download seguro de assets
│   ├── v1/agents/               endpoints do app que falam com as edge functions de IA
│   │   └── helpers.php          núcleo compartilhado: env, chamada de edge, stores Gemini, custo
│   ├── v1/external/             ★ API EXTERNA (Fullstop) — ver seção 4
│   └── v1/ads/generate.php      caminho antigo do gerador de ads
│
├── supabase/
│   ├── config.toml              lista de functions (todas com verify_jwt=false)
│   └── functions/               Edge Functions Deno (ver seção 6)
│
├── scripts/
│   ├── deploy-ftp.ps1           deploy → TESTE (lê .deploy.env)
│   └── deploy-live.ps1          deploy → LIVE  (lê .deploy.live.env)
│
├── database.sql                 schema de referência do MySQL (não é migration automática)
├── database_clickup.sql         tabelas da integração ClickUp
├── setup_projects.sql / setup_ftp_servers.sql   scripts antigos de setup
├── guidelines/*.txt             textos de diretrizes indexados nos stores Gemini (ads-*, lp-*)
├── resources/mailer/            PHPMailer usado pelos formulários das LPs geradas
├── fonts/                       fontes Raleway usadas pelo compositor GD
├── public/                      estáticos do Vite; public/.htaccess é o .htaccess do site!
├── docs/                        briefs (ClickUp), plano de IA, manual .docx, skills exportadas
│                                (*.skill e external.zip = pacotes de skills do Claude, não são código)
├── auto-commit-dev.ps1          script ANTIGO de auto-commit (caminho de outra máquina); não é usado
└── .claude/                     memória, skills e hooks do Claude Code (versionados)
```

Arquivos **não versionados** que você precisa ter na raiz: `.env`, `.deploy.env`,
`.deploy.live.env` (ver seção 8). `ad-tests/` (saídas de teste) também fica fora do git.

---

## 3. Setup numa máquina nova

Pré-requisitos: **Windows + PowerShell** (os scripts de deploy são `.ps1` e usam `curl.exe`),
Node 18+, Git, acesso ao GitHub `gustavopaulino-chili/ChiliForge`.

```powershell
git clone https://github.com/gustavopaulino-chili/ChiliForge.git
cd ChiliForge
git checkout dev
npm install

# 1) Copie para a raiz os 3 arquivos de segredo (ver seção 8):
#    .env   .deploy.env   .deploy.live.env

# 2) Supabase CLI (para deploy de edge functions)
npx supabase login          # abre o navegador; precisa ter acesso à org do projeto
npx supabase link --project-ref vehowvyqxhelyfdesmog

# 3) Teste o deploy com algo inofensivo (reenviar um arquivo que não mudou):
powershell -File scripts/deploy-ftp.ps1 api/v1/external/missing-creative.php
```

### 3.1 Rodar localmente — a verdade

**Não existe ambiente local completo.** `npm run dev` sobe o React em `http://localhost:8080`,
mas o front chama `/api/...` de forma relativa e o `vite.config.ts` **não tem proxy** para PHP,
e o banco MySQL só existe na Hostinger. Então:

- Mudança **só visual** no React → dá para ver com `npm run dev` até o ponto em que precisa de API.
- Todo o resto → o fluxo usado foi **editar → deploy no testforge → testar em
  `https://testforge.chili.pa`**. Para a API externa, testar direto no endpoint (seção 4.6).
- Checagens locais possíveis: `npm run build` (pega erro de TS/import), `npm run lint`,
  `php -l arquivo.php` (se tiver PHP instalado), `deno check` nas edge functions.
- `npm test` roda vitest, mas só existe um teste de exemplo.

Se quiser montar ambiente local de verdade: adicionar `server.proxy: { '/api': 'https://testforge.chili.pa' }`
no `vite.config.ts` (o front local passa a usar o PHP e o banco de teste).

### 3.2 Automação do Claude Code já configurada (hooks)

`.claude/settings.json` (versionado) tem hooks que rodam **sozinhos** quando se usa o Claude Code
neste repo:

- **Ao editar qualquer arquivo** → cria um marcador `.git/.cf-edited`.
- **Ao fim de cada resposta (Stop)**:
  1. faz `npx supabase functions deploy` de **toda** pasta de `supabase/functions/` com mudança
     não commitada;
  2. se houve edição: `git add -A` + commit `"auto: commit automatico na dev ao fim do request"`
     + **`git push origin dev`**.
- O deploy **FTP (PHP/front) não** é automático: o Claude roda os scripts seguindo o `CLAUDE.md`.

Consequência: qualquer arquivo não ignorado que estiver modificado na pasta vai para o GitHub
no fim da resposta. Para desligar, remova o bloco `"Stop"` de `.claude/settings.json`. Se não
usar o Claude Code, nada disso roda.

Arquivos do Claude versionados: `CLAUDE.md` (regras), `.claude/memory/` (fatos históricos),
`.claude/skills/` (roteiros: `chiliforge-nova-feature`, `chiliforge-ia-gemini`,
`chiliforge-editores-grandes`, `brainstorming`). Guia de uso: `TRABALHANDO-COM-CLAUDE.md`.

---

## 4. ★ API externa (`api/v1/external/`) — o coração do uso atual

Consumida pela **Fullstop** via n8n. Autenticação: `Authorization: Bearer cf_…` ou
`api_key` no corpo. A `api_key` é criada por usuário em `api/getApiKey.php` (tela "API key" no
app). `api_key` → `user_id` → namespace de companies.

| Arquivo | Papel |
|---|---|
| `company-assets.php` | Cadastra/atualiza a **marca**: logo, cores, fonte, posts do Instagram (`brand_posts`), posts de concorrente, imagens do site. Espelha tudo para o disco. Dispara o **brief visual** (async). |
| `company-assets-brief.php` | Lógica do job de brief (Gemini vision sobre os posts → texto 300–400 palavras). |
| `company-assets-worker.php` | Worker CLI que roda o brief fora da requisição. |
| `generate-ads.php` | Recebe o pedido de anúncio, valida, resolve company, cria campanha + job, responde **202**, dispara o worker. |
| `generate-ads-worker.php` | Worker CLI: espelha assets, gera copy (Gemini), brief visual, e **gera a peça na OpenAI** (caminho C), cola a logo, salva. |
| `compose-gd.php` | Biblioteca: prompt da OpenAI (`extc_openai_prompt`), chamada (`extc_openai_gerar`), colagem da logo (`extc_poe_logo`), fontes, e o antigo compositor GD. |
| `job-status.php` | Polling: `GET ?api_key=…&job_id=…` → status + `creatives[].image_url`. |
| `missing-creative.php` | Devolve 404 real para imagem inexistente em `/projects/**` (senão a Meta recebia a página de login). |
| `_check_wk.php`, `_gd-test.php` | Diagnóstico do servidor. `_gd-test.php` é bloqueado no live. |

### 4.1 Fluxo de um anúncio

```
n8n ──POST generate-ads.php──► valida payload + chave OpenAI
                               resolve company por (user_id, phone)   [cria se não existir]
                               cria ads_campaign + ad_generation_jobs + 1 batch por formato
    ◄──── 202 {job_id, status_url} ────
                               exec php generate-ads-worker.php <job_id> &
                                  ├─ espelha imagens em /projects/<slug>/assets
                                  ├─ copy (headline/sub/CTA) via edge agents-ads mode=copy
                                  │   (pulado se o chamador mandou headline pronta)
                                  ├─ brief visual da marca (cache) via agents-ads mode=brand_visual
                                  ├─ monta prompt (extc_openai_prompt) + até 6 imagens de referência
                                  ├─ OpenAI gpt-image-2 → bytes da imagem
                                  ├─ cola a logo PNG no canto mais calmo (extc_poe_logo)
                                  └─ grava ads_creatives + arquivo em /projects/…
n8n ──GET job-status.php (a cada ~10-15s)──► completed | failed + creatives[].image_url
```

Tempo típico: 60–120 s por peça.

### 4.2 Payload de `generate-ads.php` (resumo)

Campos obrigatórios: `phone`, `company.name`, `campaign` (objeto), `formats` (array),
`gemini_api_key` (ainda exigido — é usado para copy/brief), e chave OpenAI
(`campaign.openai_api_key` **ou** `OPENAI_API_KEY` no `.env` do servidor).

`formats`: presets `instagram-feed-square`, `instagram-feed-landscape`, `instagram-story`,
`facebook-feed-square`, `facebook-story`, `google-leaderboard`, `google-medium-rectangle`,
`tiktok-feed` — ou objeto `{platform, format, width, height}`.

Campos de `campaign` que mais importam (lista completa em `ext_map_campaign()`,
`generate-ads.php` ~linha 205):
- Copy: `headline`/`main_headline`, `subheadline`, `cta`/`cta_text`, `use_ai_copy`
  (se mandar headline pronta, ela é usada **literalmente**).
- Referência: `reference_image` (**dentro de `campaign`**, não no topo — no topo é ignorado
  em silêncio), `reference_face_authorized` (default true: reproduz o rosto da referência).
- Visual: `preferred_style`, `image_genre`, `background_color`, `font_family`,
  `logo_position`/`logo_strategy`, `ignore_references`, `qualidade_imagem` (`low|medium|high`, default `medium`).
- Carrossel: `carousel_index`, `carousel_total`, `carousel_structure`
  (`lista|passo_a_passo|explicacao|mito|case|narrativa|opiniao|checklist`), `carousel_item_number`.
- `motor_imagem` é aceito mas **não decide nada** (só é ecoado no debug).

`company`: `name`, `industry`, `description`, `language`, cores (`primary_color`…), `logo_url`,
`font_family`, `services`, `target_audience`, `website`, imagens…

> **Regra:** se você mudar qualquer campo aceito/retornado desses endpoints, **avise a Fullstop**
> explicitamente (nome do campo, tipo, default quando ausente). Eles dependem do contrato exato.

### 4.3 `company-assets.php`

`POST {api_key, phone, company?, logo_url?, font_family?, brand_posts?[], competitor_posts?[],
site_images?[], reference_images?[], brand_posts_are_proxy?, gemini_api_key?}`

- Primeira chamada com posts → responde `brand_visual_status:"processing"` + instruções de poll.
- Poll: mesmo endpoint com `{api_key, phone}` até `generated|cached|failed`.
- `brand_visual_brief` é **em inglês de propósito** (vai para o modelo de imagem);
  `brand_visual_brief_pt` é a versão para mostrar ao cliente. Não traduza o EN.
- `brand_posts_are_proxy:true` = os posts são de outra marca (cliente sem Instagram próprio):
  servem de referência de layout, mas não de identidade.

### 4.4 Tabelas que a API externa usa

`api_keys`, `users`, `projects` (company = `project_type='project'`, com `phone`,
`company_form_data` JSON = toda a marca), `ads_campaign` (`form_data` = snapshot congelado da
campanha), `ad_generation_jobs`, `ad_generation_job_batches`, `ads_creatives`,
`company_asset_jobs`, `gemini_usage` (ledger de custo), `system_settings`.

Índice único **`uniq_company_user_phone (user_id, phone)`** em `projects` impede company
duplicada. Várias colunas são criadas em tempo de execução (`ext_ensure_columns`,
`caa_ensure_job_table`), então o banco de produção pode ter colunas que o `database.sql` não
lista.

### 4.5 Motor de imagem (caminho C) — onde mexer

Quase toda regra de qualidade da peça está em **`extc_openai_prompt()`**
(`api/v1/external/compose-gd.php`, ~linha 1785, ~450 linhas de prompt comentado). Os
comentários explicam o porquê de cada frase — **leia antes de mudar**; muitas frases existem
para corrigir um defeito concreto que já aconteceu (texto queimado, logo duplicada, rosto
virando word-art, CTA em inglês, carrossel que não combina…).

- Referências: `extc_papeis_refs` + `extc_legenda_refs` dizem ao modelo o papel de cada imagem
  anexada (hero do cliente / site / post da marca / outro). Só as **6 primeiras** vão.
- Logo: nunca é desenhada pela IA; é colada depois por `extc_poe_logo` (GD).
- Tamanho: `extc_tamanho_openai` converte o formato para um tamanho aceito pela OpenAI.
- Cada peça grava um `debug` (`motor_usado`, `fallback_motivo`, refs anexadas…) para
  diagnosticar sem log do servidor.

### 4.6 Testar a API externa

1. Use a `api_key` de teste (guardada com as credenciais — **não commitar**).
   Obs.: a `api_key` só existe no banco onde foi criada; a de live não funciona no testforge e
   vice-versa.
2. `POST https://<host>/api/v1/external/generate-ads.php` com **um** formato.
3. Poll `job-status.php` a cada ~12 s até `completed`/`failed`.
4. Baixe `creatives[0].image_url` para `ad-tests/` com nome `live_job<id>_…` ou
   `testforge_job<id>_…` (o `job_id` é global, nunca sobrescreve).
5. Referência de imagem precisa estar num host que o servidor/edge consiga baixar
   (Pexels, Google avatars, forge.chili.pa funcionam; thumbnails do Bing às vezes não).

Detalhes e histórico de testes: `.claude/memory/external-ads-api-test-procedure.md` e
`.claude/memory/ads-test-run-counter.md`.

### 4.7 Modelos de IA e custo

| Etapa (API externa) | Modelo | Onde se troca |
|---|---|---|
| Peça final (imagem) | OpenAI `gpt-image-2`, qualidade `medium` | modelo fixo em `extc_openai_gerar` (`compose-gd.php`); qualidade por payload `qualidade_imagem` ou default no worker |
| Copy (headline/sub/CTA) | Gemini `gemini-2.5-flash` (edge `agents-ads` modo `copy`) | código da edge |
| Brief visual da marca + tradução PT | Gemini `gemini-2.5-flash` (modo `brand_visual`) | código da edge |

Custo: ~US$ 0,10–0,14 por peça na OpenAI (`medium`), estimado a partir de uma leva de 8 peças
registrada num commit, mais centavos de Gemini. No app
interno, o modelo de imagem Gemini vem do secret `GEMINI_IMAGE_MODELS` do Supabase.
O ledger `gemini_usage` registra só o Gemini; o gasto da OpenAI se vê no painel da OpenAI.

---

## 5. App web (frontend + PHP do app)

### 5.1 Rotas (`src/App.tsx`)

| Rota | Tela |
|---|---|
| `/auth` | login/registro (`api/login.php`, `api/register.php`) |
| `/` | início |
| `/projects`, `/history` | lista de empresas/projetos |
| `/projects/new` | criar empresa |
| `/projects/:id` | página da empresa (dados, imagens, arquivos de conhecimento, ClickUp) |
| `/projects/:companyId/campaigns/:campaignId` | campanha de anúncios (board de criativos) |
| `/ad-creatives` | wizard de criação de anúncios |
| `/ads-editor` | editor de anúncio (AdsEditor.tsx) |
| `/visual-editor` | editor de LP/site (VisualEditor.tsx) |
| `/admin/global-stores` | admin dos stores Gemini globais (guidelines) |

Conta **admin** usa `GEMINI_API_KEY_PRODUCTION`; conta comum usa `GEMINI_API_KEY_TESTING`
(tipo de conta resolvido por domínio de e-mail no `login.php`). Hoje as duas chaves no Supabase
são iguais.

### 5.2 Como o front fala com o back

Tudo passa por `src/services/api.ts`:
- `fetch('/api/<arquivo>.php')` para o PHP (mesmo domínio).
- Algumas chamadas vão direto para `VITE_SUPABASE_URL/functions/v1/<nome>` (scrape, busca de
  imagem, parse de planilha, preset, geração de LP antiga).
- As gerações "pesadas" do app (ads, LP, reforge, chat) vão para `api/v1/agents/*.php`, que
  chama a edge function e salva o resultado.

### 5.3 Editores gigantes

`AdsEditor.tsx` e `VisualEditor.tsx` têm milhares de linhas e injetam um script "bridge"
dentro de um iframe. **Não leia inteiro**: localize com `grep` e edite pontualmente. Guia
completo: `.claude/skills/chiliforge-editores-grandes/SKILL.md`.

### 5.4 Feature nova com banco

Ordem: SQL → PHP → tipos TS (`src/types/`) → `api.ts` → componente. Guia:
`.claude/skills/chiliforge-nova-feature/SKILL.md`. Mudança de schema **não é aplicada
automaticamente**: rode o SQL à mão no phpMyAdmin da Hostinger, **nos dois bancos** (teste e live),
e atualize `database.sql`.

### 5.5 Formulário de lead das LPs (mailer)

`resources/mailer/` é um PHPMailer autocontido que é **copiado para dentro de cada LP
publicada** (`api/lpMailer.php` instala e configura pelo Visual Editor). O formulário da LP faz
POST para `send_lead.php` da própria LP, que envia o lead por SMTP. A configuração (SMTP, e-mail
de destino live/teste) fica num `config.php` **por LP**, no servidor, gerado a partir de
`config.example.php`. A senha SMTP nunca é devolvida à UI.

### 5.6 Integração ClickUp

`api/clickup_*.php` + `database_clickup.sql` + `docs/clickup-integration-brief*.md`. OAuth
(`CLICKUP_CLIENT_ID/SECRET/REDIRECT_URI/TOKEN_KEY` no `.env`), importa empresas a partir de
listas/docs do ClickUp e detecta empresa nova via webhook.

---

## 6. Edge Functions (Supabase)

Projeto `vehowvyqxhelyfdesmog`. Todas com `verify_jwt=false` (a autenticação é feita no PHP).

| Function | Quem chama | Para quê |
|---|---|---|
| `agents-ads` (~5.300 linhas) | app (`api/v1/agents/*`) e API externa | modos `brand_visual` (brief), `copy`, e no app: `interpret`, `compose`, `render`, `image`… |
| `agents-store` | `helpers.php` e vários | cria/sincroniza **Gemini File Search stores** (conhecimento da empresa e guidelines) |
| `agents-lp` / `agents-lp-reforge` | `generate-landing.php`, `reforge-lp.php` | gera / edita LP por chat |
| `agents-learn` | `learn-from-feedback.php` | aprende com feedback do usuário |
| `generate-landing`, `generate-images`, `generate-ad-creatives`, `analyze-ad-brief`, `analyze-brand-book`, `generate-preset`, `parse-spreadsheet`, `scrape-website`, `search-images` | front direto (`api.ts`) | ferramentas do app |
| `parse-products-spreadsheet`, `render-landing-preview`, `smart-endpoint` | ninguém no código atual | legado |
| `_shared/geminiCost.ts` | várias | tabela de preços para o ledger de custo |

Deploy: `npx supabase functions deploy <nome>`. **Arquivo local não tem efeito até o deploy.**

Segredos (definidos com `npx supabase secrets set NOME=valor`; listar com `npx supabase secrets list`):
`GEMINI_API_KEY`, `GEMINI_API_KEY_PRODUCTION`, `GEMINI_API_KEY_TESTING`, `GEMINI_IMAGE_MODELS`,
`GEMINI_IMAGE_MODEL`, `GEMINI_SITE_MODEL(_TESTING)`, `GEMINI_SITE_FALLBACK_MODELS(_TESTING)`,
`OPENAI_API_KEY`, `PEXELS_API_KEY`, `USAGE_LOG_URL`, `USAGE_LOG_SECRET`,
`STORAGE_SERVICE_ROLE_KEY`, e os `SUPABASE_*` automáticos. Segredos lidos **no boot** da
função → depois de mudar, faça redeploy da função.

Logs das edge functions: pelo **dashboard do Supabase** (o `supabase functions logs` não existe
na CLI atual). Erro `546 WORKER_RESOURCE_LIMIT` = a função estourou memória/CPU (geralmente
imagens de referência demais).

Guia de trabalho: `.claude/skills/chiliforge-ia-gemini/SKILL.md`.

---

## 7. Deploy — passo a passo

### 7.1 PHP (sempre nos DOIS servidores, só os arquivos alterados)

```powershell
powershell -File scripts/deploy-ftp.ps1  api/v1/external/generate-ads.php api/v1/external/compose-gd.php   # TESTE
powershell -File scripts/deploy-live.ps1 api/v1/external/generate-ads.php api/v1/external/compose-gd.php   # LIVE
```

⚠️ **Nunca rode `deploy-live.ps1` sem argumentos**: ele sobe a pasta `api/v1/external/`
inteira e sobrescreve arquivos que divergem de propósito no live. Sempre liste os arquivos.
O `deploy-live.ps1` bloqueia por segurança `*.env`, `api/db.php`, `_gd-test.php` e `projects/`.

### 7.2 Frontend

```powershell
npm run build
powershell -File scripts/deploy-ftp.ps1  -Frontend    # TESTE
powershell -File scripts/deploy-live.ps1 -Frontend    # LIVE (só quando quiser publicar o app no live)
```

Os bundles antigos com hash não são apagados do servidor (não tem problema).
Atenção: `public/.htaccess` vira `dist/.htaccess` e vai junto no `-Frontend`.

### 7.3 Edge functions

```powershell
npx supabase functions deploy agents-ads
```

### 7.4 Conferir se o deploy pegou (IMPORTANTE)

O servidor usa ProFTPD com `HiddenStores`: se um upload é interrompido (timeout, comum no
`generate-ads-worker.php`, ~60 KB), fica um `.in.<arquivo>.` órfão e **todo upload seguinte
desse arquivo dá `curl: (25) ... 550`**, enquanto o arquivo antigo continua rodando. Já
deixou o live 2 semanas desatualizado.

Listar a pasta remota (data/tamanho):
```powershell
$cfg=@{}; foreach($l in Get-Content .deploy.live.env){ $t=$l.Trim(); if($t -eq '' -or $t.StartsWith('#') -or ($t -notmatch '=')){continue}; $k,$v=$t.Split('=',2); $cfg[$k.Trim()]=$v.Trim().Trim('"').Trim("'") }
curl.exe -s --ssl-reqd --insecure "ftp://$($cfg['FTP_HOST'])/api/v1/external/" --user "$($cfg['FTP_USER']):$($cfg['FTP_PASS'])"
```

Contornar o órfão (sobe com outro nome e renomeia por cima):
```bash
H=$(sed -n 's/^FTP_HOST=//p' .deploy.live.env | tr -d '"\r')
U=$(sed -n 's/^FTP_USER=//p' .deploy.live.env | tr -d '"\r')
P=$(sed -n 's/^FTP_PASS=//p' .deploy.live.env | tr -d '"\r')
curl -s --ssl-reqd --insecure -T api/v1/external/ARQ.php "ftp://$H/api/v1/external/ARQ.deploy-tmp.php" --user "$U:$P"
curl -s --ssl-reqd --insecure "ftp://$H/api/v1/external/" --user "$U:$P" -Q "-RNFR ARQ.deploy-tmp.php" -Q "-RNTO ARQ.php"
```
O órfão só pode ser apagado pelo Gerenciador de Arquivos do hPanel (mostrar ocultos) ou SSH.

### 7.5 SQL

Não há migrations automáticas no MySQL. Rode o SQL no phpMyAdmin da Hostinger nos **dois**
bancos e registre em `database.sql`.

### 7.6 Checklist de fim de tarefa

- [ ] `npm run build` passa (se mexeu no front)
- [ ] Commit na `dev` + `git push origin dev`
- [ ] PHP → `deploy-ftp.ps1` **e** `deploy-live.ps1` com os arquivos explícitos
- [ ] Edge → `npx supabase functions deploy <nome>`
- [ ] Conferiu data/tamanho remoto se algum upload falhou
- [ ] SQL rodado nos dois bancos
- [ ] Mudou payload da API externa? Avisou a Fullstop

---

## 7b. Plataformas usadas (o que é cada uma e para que serve)

| Plataforma | Para que o projeto usa | Conta / identificação | Onde se configura |
|---|---|---|---|
| **GitHub** | Código-fonte | repo `gustavopaulino-chili/ChiliForge` (conta pessoal) | — |
| **Hostinger** (hPanel) | Hospeda os 2 sites (PHP + React), o MySQL, os arquivos gerados | conta de hospedagem `u427845891`; IP `195.35.41.130` | hPanel → Sites, Bancos MySQL, Gerenciador de Arquivos, FTP |
| ↳ FTP teste | deploy `testforge.chili.pa` | usuário `u427845891.testforge…` | `.deploy.env` |
| ↳ FTP live | deploy `forge.chili.pa` | usuário `u427845891.forge…` | `.deploy.live.env` |
| ↳ MySQL live | banco do live | `u427845891_chiliforge` / usuário `u427845891_forge_admin` | `.env` do servidor (`DB_*`) + phpMyAdmin |
| ↳ MySQL teste | banco do teste (separado) | ver `.env` do servidor de teste | idem |
| **Supabase** | Só Edge Functions (Deno) + bucket `download_files` | projeto `vehowvyqxhelyfdesmog` | dashboard + `npx supabase` CLI |
| **Google Gemini** (AI Studio / Cloud) | Texto, visão, brief da marca, copy, File Search stores, imagem no app | chaves `GEMINI_API_KEY_PRODUCTION` (paga) e `…_TESTING` | `.env` do servidor + secrets do Supabase |
| **OpenAI** | Motor de imagem da API externa (`gpt-image-2`) | `OPENAI_API_KEY` | `public_html/.env` de cada servidor |
| **Pexels** | Fotos de banco para ancorar cenas / LPs | `PEXELS_API_KEY` | `.env` + secrets Supabase |
| **Browserless** | Renderizar HTML→imagem sem Chrome local | `BROWSERLESS_URL/TOKEN` | `.env` |
| **ClickUp** | Importar empresas (lists/wikis) para o Forge | OAuth app (`CLICKUP_CLIENT_ID/SECRET`) ou token pessoal `pk_…` por usuário | `.env` + tela da empresa no app |
| **Meta (Instagram/Facebook)** | Destino final dos criativos (publicados pela Fullstop) | contas dos clientes | lado Fullstop |

---

## 7c. Logins e autenticação — como cada coisa se autentica

**1. Login no app (usuários humanos)**
- Tabela `users` (`email`, `pwd` = `password_hash`, `account_type` `admin|user`, `gemini_api_key` opcional por usuário).
- `api/login.php` confere a senha e devolve `{id, email, accountType}`. O front guarda isso em
  `localStorage["user"]` (`src/contexts/AuthContext.tsx`). **Não há sessão/token no servidor**:
  os endpoints do app recebem `user_id` no corpo da requisição e confiam nele.
- `account_type` é decidido pelo **domínio do e-mail** (`api/accountType.php`): quem é
  `@chili.pa` vira `admin` (configurável por `ADMIN_EMAIL_DOMAINS` no ambiente). Admin usa a
  chave Gemini de produção e vê `/admin/global-stores`.
- Criar usuário: tela `/auth` → `api/register.php`.

**2. API externa (máquinas — n8n/Fullstop)**
- `api_key` no formato `cf_<40 hex>`, tabela `api_keys` (`user_id`, `is_active`, `requests_count`, `last_used_at`).
- Gerada/consultada em `api/getApiKey.php` (botão "API key" no app). Cada usuário tem 1 ativa.
- **A `api_key` define o `user_id`**, e o `user_id` define o "espaço" de companies. Por isso
  todas as chamadas de um mesmo cliente da API precisam usar **a mesma** `api_key`.
- Desativar uma chave: `UPDATE api_keys SET is_active=0 WHERE api_key='…'` (no banco certo!).
- As chaves de live e de teste são diferentes (bancos diferentes).

**3. Chaves de IA**
- Gemini no app: admin → `GEMINI_API_KEY_PRODUCTION`, user → `GEMINI_API_KEY_TESTING`, ou a
  chave pessoal salva em `users.gemini_api_key` (`saveGeminiKey.php`). O PHP passa a chave
  para a edge no campo `geminiApiKey`.
- Gemini na API externa: vem no payload (`gemini_api_key`) — **quem chama paga**.
- OpenAI na API externa: `campaign.openai_api_key` no payload, senão `OPENAI_API_KEY` do
  `.env` do servidor (hoje a Fullstop **não** manda: usa a do servidor).

**4. Serviço-a-serviço**
- Edge functions têm `verify_jwt=false`; o PHP as chama com a publishable key do Supabase.
- As edges registram custo chamando `api/v1/agents/log-gemini-usage.php` com o segredo
  compartilhado `USAGE_LOG_SECRET` (URL em `USAGE_LOG_URL`).
- ClickUp: token OAuth/pessoal guardado **criptografado** (`CLICKUP_TOKEN_KEY`) em `clickup_connections`;
  webhook validado por HMAC (`X-Signature`).

**5. Infra**
- FTP (deploy): `.deploy.env` / `.deploy.live.env`.
- Supabase CLI: `npx supabase login` com a conta que tem acesso ao projeto.
- Hostinger hPanel: login da conta de hospedagem da empresa.

---

## 7d. Explicação do código, arquivo por arquivo

### 7d.1 Modelo de dados (o conceito central)

```
users ──< api_keys
  │
  └──< projects  (project_type='project')      = COMPANY / marca   (phone, company_form_data JSON)
          │                                        company_form_data guarda TUDO da marca:
          │                                        nome, cores, fontes, logoUrl, brandPostImages,
          │                                        brandVisualBrief(+Pt), siteImages, referenceImages…
          ├──< projects (project_type='landing_page', company_project_id=…)  ──1 lps (HTML da LP)
          └──< projects (project_type='ad_creative', company_project_id=…)
                   └──< ads_campaign (form_data = snapshot da campanha)
                           ├──< ads_creatives (cada peça: html, image, formato)
                           └──< ad_generation_jobs ──< ad_generation_job_batches (1 por formato)
company_asset_jobs      jobs async do brief visual (company-assets)
company_store_files     arquivos de conhecimento da empresa indexados no Gemini
global_store_files      guidelines globais indexadas (guidelines/*.txt)
ads_campaign_examples   exemplos "bons" marcados pelo usuário (memória de estilo)
agents                  ★ system prompts dos agentes (ADS_AGENT, LP_AGENT) — ficam NO BANCO
system_settings         nomes dos stores Gemini globais, etc.
gemini_usage            ledger de custo por chamada
ftp_servers             servidores FTP de CLIENTES (para publicar LP no domínio do cliente)
clickup_*               integração ClickUp
```

Pasta em disco de cada projeto: `public_html/projects/<slug>/` (`assets/`, `index.html`,
criativos). `folder_path`/`public_url` no banco apontam para ela. Helpers em `api/site_helpers.php`.

### 7d.2 PHP do app (`api/*.php`)

| Grupo | Arquivos | O que fazem |
|---|---|---|
| Auth | `login.php`, `register.php`, `accountType.php` | login, cadastro, regra admin por domínio |
| Chaves | `getApiKey.php`, `getGeminiKey.php`, `saveGeminiKey.php` | api_key externa e chave Gemini pessoal |
| Projetos | `createProject.php`, `getProjects.php`, `updateCompanyProject.php`, `updateProjectContent.php`, `updateProjectFormState.php`, `updateProjectStep.php`, `moveProjectToCompany.php`, `deleteProject.php` (apaga TUDO, incl. stores Gemini) | CRUD de companies e filhos |
| Arquivos | `uploadProjectAsset.php`, `getProjectAssets.php`, `deleteProjectAsset.php`, `uploadProjectFiles.php`, `getProjectFiles.php`, `deleteProjectFile.php`, `downloadProjectZip.php`, `proxyImage.php` (proxy com proteção SSRF) | imagens/arquivos da marca e do projeto |
| Criativos | `getAdCreatives.php` (board), `getAdCreative.php`, `updateAdCreativeContent.php`, `deleteAdCreative.php`, `updateAdCampaignBoard.php`, `getCampaign.php`, `getCreativesHtml.php`, `downloadAdCreativesZip.php`, `publishAdCreative.php` | board de campanha, edição, export ZIP/PNG, publicar criativo em URL pública |
| LP / site | `getProjectEditorContent.php`, `publishSite.php` (grava a LP em `/projects/<slug>/`, copia imagens da company, reescreve URLs), `lpMailer.php` (instala formulário de lead com PHPMailer) | ciclo da landing page |
| Publicar em FTP de cliente | `saveFtpServer.php`, `getFtpServers.php`, `deleteFtpServer.php`, `listFtpFolders.php`, `deployFtp.php` (FTPS→FTP) | enviar LP pronta ao hosting do cliente |
| Scraping | `scrapeWebsite.php`, `fetchHtml.php` (proxy HTML usado pela edge `scrape-website`) | lê o site do cliente para preencher a marca |
| Render | `_render.php` (Chrome headless), `_browserless.php` (Browserless.io) | HTML → PNG/JPG |
| ClickUp | `clickup_*.php` (+ `clickup_common.php`) | OAuth/token, listar folders/lists/wikis, importar companies, webhook de list nova |
| Diagnóstico | `check_apis.php`, `testFtp.php` (**remover**: recebe senha por GET) | checagens |

### 7d.3 PHP de IA do app (`api/v1/agents/*.php`)

- `helpers.php` — núcleo: `agents_env_value` (lê `.env`), `agents_call_edge_function`
  (chama edge com timeout), `agents_sync_company_store` (cria/atualiza o **File Search store**
  da empresa no Gemini com os dados da marca), limpeza de base64 (base64 dentro de store vira
  milhões de tokens), custo, reconexão MySQL em jobs longos.
- Anúncios no app: `prepare-generate-ads.php` / `prepare-generate-ads-from-campaign.php`
  montam o payload (marca + stores + prompt do `ADS_AGENT` da tabela `agents`); **o próprio
  front** então chama a edge `agents-ads` (modos `interpret` → `compose`/`render`) e salva o
  resultado; `create/update/get-generation-job.php` persistem o progresso;
  `record-campaign-generation.php` grava o plano criativo. `generate-ads.php` /
  `generate-ads-from-campaign.php` são as versões server-side.
- `generate-copy.php` (só copy), `campaign-chat.php` e `setup-wizard.php` (assistente de campanha
  por chat), `global-chat.php` (chat geral com a base de conhecimento).
- LP: `generate-landing.php` (edge `agents-lp`, prompt `LP_AGENT`), `reforge-lp.php` (edição
  cirúrgica por chat, edge `agents-lp-reforge`).
- Conhecimento: `upload/list/delete-company-file.php`, `sync-company-knowledge.php`,
  `sync-global-store.php`, `list/delete-global-store-file.php`, `cleanup-store-base64.php`.
- Aprendizado: `mark-good-example.php`, `remove-campaign-example.php`, `learn-from-feedback.php`.
- Custo: `log-gemini-usage.php` (recebe das edges), `gemini-usage-summary.php` (consulta).

### 7d.4 Frontend (`src/`)

- `pages/`: `Auth`, `Index`, `History` (lista), `ProjectSetup` (nova empresa), `CompanyPage`
  (empresa: dados, imagens, arquivos, ClickUp), `CampaignScreen` (board de criativos),
  `AdCreatives` (wizard de anúncio), `AdsEditorPage`, `VisualEditorPage`, `GlobalStoreAdmin`.
- `components/ad-generator/Step*.tsx`: passos do wizard de anúncio (import, marca, objetivo,
  plataforma, formatos, estratégia, copy, imagens, revisão, saída).
- `components/generator/Step*.tsx`: passos do wizard de LP/site (tipo, básico, marca, serviços,
  páginas, imagens, contato, leads, CSV, revisão) + `FtpDeployModal`.
- `components/editor/`: `AdsEditor` e `VisualEditor` (editores drag&drop via iframe + bridge),
  `ReforgeChat*` (chat de edição de LP), `FilesPanel`, `LpEmailPanel`.
- `data/adLayouts.ts` (layouts de anúncio), `data/nicheTemplates.ts` (templates por nicho),
  `types/*.ts` (formato dos formulários), `lib/adRecommendations.ts`, `lib/aiFormMapping.ts`.
- `components/ui/`: shadcn/ui (gerado, não editar à mão sem necessidade).

### 7d.5 Lógica do motor de anúncio da API externa (caminho C) em detalhe

1. **Resolver a company** (`generate-ads.php`): busca por `(user_id, phone)` exato; se a linha
   achada não tem marca (sem logo nem cor), procura pelo telefone só com dígitos uma linha que
   tenha marca. Não achou → cria (INSERT atômico; se colidir no índice único, relê).
2. **Mesclar dados**: o que veio no payload `company` é mesclado em `company_form_data`; a
   campanha vira um **snapshot** em `ads_campaign.form_data` (a peça sempre usa o snapshot).
3. **Referências** (`composeCompanyRefs`), em ordem de prioridade: referência do cliente
   (`campaign.reference_image`) → posts da marca → imagens do site → produto/empresa/fundo.
   Só as 6 primeiras vão para a OpenAI. Em modo proxy (posts de concorrente) as imagens do site
   do cliente passam à frente.
4. **Copy**: se o chamador mandou headline, ela é literal. Senão, edge `agents-ads` modo `copy`
   gera headline/sub/CTA no idioma da campanha (uma vez por job, compartilhada entre formatos).
5. **Brief visual**: usa o brief gerado no cadastro (`company-assets`); se não houver, gera a
   partir das referências e guarda em cache por hash.
6. **Prompt** (`extc_openai_prompt`): cores da marca em hex com papel de cada uma; legenda de
   cada imagem anexada ("esta é a referência do cliente", "este é post da marca"…); copy exata
   que deve aparecer; regras de legibilidade; canto reservado para a logo com tom oposto ao da
   logo (luminância medida); instruções de formato/rede; regras de carrossel (o que é igual em
   toda a série × o que muda por slide, papel do slide: gancho/argumento/fechamento, número da
   lista).
7. **Geração**: `POST https://api.openai.com/v1/images/edits` (multipart, refs como `image[]`;
   sem nenhuma ref baixável cai em `/images/generations`) com `gpt-image-2`,
   qualidade `medium` por padrão, tamanho convertido pelo `extc_tamanho_openai`.
8. **Logo**: `extc_poe_logo` cola o PNG da logo no canto pedido (ou no mais calmo), sem
   placa/overlay atrás.
9. **Salvar**: JPG em `/projects/<company>/…`, linha em `ads_creatives`, batch `completed`.
   Falha em qualquer etapa → batch `failed` com motivo (`fallback_motivo`), sem derrubar o job.

---

## 8. Segredos e acessos (o que pedir no primeiro dia)

Nenhum destes valores está no git. Peça ao gestor / dono das contas:

| Onde | Conteúdo |
|---|---|
| `.env` (raiz local **e** `public_html/.env` em cada servidor) | `DB_HOST/USER/PASS/NAME`, `GEMINI_API_KEY_PRODUCTION`, `GEMINI_API_KEY_TESTING`, `OPENAI_API_KEY`, `PEXELS_API_KEY`, `SUPABASE_*`, `VITE_SUPABASE_*`, `CLICKUP_*`, `APP_BASE_URL`, `BROWSERLESS_URL/TOKEN` |
| `.deploy.env` | FTP do **teste** (`FTP_HOST`, `FTP_USER`, `FTP_PASS`) |
| `.deploy.live.env` | FTP do **live** (modelo: `.deploy.live.env.example`) |
| Hostinger hPanel | phpMyAdmin dos 2 bancos, Gerenciador de Arquivos, logs PHP |
| Supabase | membro da org do projeto `vehowvyqxhelyfdesmog` |
| GitHub | acesso de escrita a `gustavopaulino-chili/ChiliForge` (repo está na conta pessoal de quem saiu — **transferir para uma org da empresa**) |
| Google AI Studio / Cloud | projetos das chaves Gemini (billing) |
| OpenAI | conta/billing da `OPENAI_API_KEY` |
| `api_key` de teste (`cf_…`) | para testar a API externa |

### 8.1 De onde o PHP tira as credenciais NO SERVIDOR

- **Chaves de IA, Pexels, ClickUp, Browserless**: `public_html/.env` de cada servidor, lido por
  `agents_env_value()` (`api/v1/agents/helpers.php`). Mudar uma chave = editar esse arquivo pelo
  Gerenciador de Arquivos do hPanel (não há deploy de `.env`: os dois scripts não o enviam).
- **Banco**: `api/db.php` usa `getenv('DB_*')`, mas o servidor **não** define essas variáveis.
  Na prática vale o valor de fallback escrito dentro do `db.php` **que está em cada servidor**.
  O `deploy-live.ps1` bloqueia o envio do `db.php`, mas o `deploy-ftp.ps1` (teste) **não**:
  nunca envie `api/db.php` para o teste sem conferir, ou o teste passa a apontar para outro banco.

Cuidados:
- Os valores no `.env` vêm **entre aspas**; ao usar num script, remova as aspas, senão a
  Gemini responde `API_KEY_INVALID`.
- **Trocar a chave Gemini de projeto Google invalida todos os File Search stores** já criados
  (403). É preciso zerar as colunas `gemini_store_name` etc. para recriar — ver
  `.claude/memory/gemini-stores-sao-project-scoped.md`.
- `.claude/settings.local.json` **não** é versionado (tem credencial). Nunca commitar.

---

## 9. Integrações externas (quem consome o ChiliForge)

**O ChiliForge não tem workflow n8n próprio.** Ele só expõe a API externa (seção 4). Quem a
chama hoje é a **Fullstop**, um produto separado com equipe e workflows próprios, que ficam
fora do escopo deste documento. Do lado do ChiliForge, o que você precisa saber da integração:

- A Fullstop chama **só o LIVE** (`forge.chili.pa`): `company-assets.php` (cadastro da marca,
  logo, cor, posts, e o poll do brief) e `generate-ads.php` + `job-status.php` (geração e poll).
- Ela manda `api_key` e `gemini_api_key` no payload e **não** manda `openai_api_key`: usa a
  `OPENAI_API_KEY` do `.env` do servidor live. Se essa chave acabar ou for trocada no servidor,
  a geração da Fullstop para de funcionar.
- Se você **desativar ou trocar a `api_key`** que ela usa, avise antes: a chave fica
  configurada nos workflows deles.
- Qualquer mudança de contrato (campo novo, renomeado, removido, mudança de default) → avisar
  a equipe da Fullstop (seção 4.2).

---

## 10. Troubleshooting (sintoma → causa → onde olhar)

| Sintoma | Causa mais provável | O que fazer |
|---|---|---|
| Fullstop diz que "nada mudou" depois do deploy | Só subiu no testforge, ou upload falhou com 550 | `deploy-live.ps1` + conferir tamanho remoto (7.4) |
| Job fica `running` para sempre | Worker não foi disparado / morreu | Log PHP no hPanel; verificar `/usr/bin/php` e `exec` habilitado (`_check_wk.php`) |
| `400 openai_api_key is required` | Sem chave no payload e sem `OPENAI_API_KEY` no `.env` do servidor | Conferir `public_html/.env` do servidor |
| Anúncio sai com logo/cor de **outra** marca | Company duplicada, ou n8n usando `api_key`s de contas diferentes | `SELECT id,user_id,HEX(phone),project_type FROM projects WHERE phone LIKE '%<num>%'` — se só `user_id` difere, é o chamador usando `api_key`s diferentes |
| Anúncio genérico, sem identidade | Company vazia (telefone com/sem `+`), sem `brand_posts` | Rodar `company-assets.php` com posts; conferir `brand_posts_stored` |
| Pessoa da referência não aparece | `reference_image` fora do objeto `campaign`, ou URL não baixável | Mover para `campaign.reference_image`; usar host acessível |
| `403 PERMISSION_DENIED` em store Gemini | Chave Gemini trocada de projeto Google | Zerar colunas de store (seção 8) |
| `429 RESOURCE_EXHAUSTED …FreeTier` | Chave Gemini em free tier | Ativar billing no projeto Google da chave |
| `402 gemini_credits_depleted` | Crédito da chave Gemini acabou | Recarregar billing |
| Edge `546 WORKER_RESOURCE_LIMIT` | Imagens demais / grandes na edge | Reduzir refs; ver skill ia-gemini |
| Meta rejeita URL da imagem ("Only photo or video…") | URL apontava para arquivo inexistente e caía no SPA | Já tratado por `missing-creative.php` + `.htaccess`; conferir se o arquivo existe |
| Endpoint cai em ~120 s com 500/503 | Proxy da Hostinger corta em ~120 s | Trabalho longo tem de ir para worker async (padrão 202 + worker) |

---

## 11. Decisões que parecem erro mas não são

- `brandVisualBrief` em **inglês** — de propósito (seção 4.3).
- Brief visual **capado** na geração, completo só no cadastro — senão o texto domina e todo
  anúncio fica igual.
- Headline enviada pelo chamador é usada **literalmente** (sem reescrita por IA).
- CTA ausente = **sem CTA** (não inventar "Get Started"): carrossel usa isso nos slides do meio.
- A logo **nunca** é gerada pela IA — sempre colada depois.
- O rosto da `reference_image` do cliente **é** reproduzido por padrão
  (`reference_face_authorized` default true); rostos de brand_posts/site nunca.
- `deleteProject.php` apaga **tudo** da company (inclusive stores Gemini) — princípio "deletou
  no Forge, some tudo".
- Estilo de trabalho combinado: **correção cirúrgica do sintoma**, não reescrever o que já
  funciona. Mudanças grandes no prompt de imagem costumam regredir outra coisa — teste uma peça
  antes e depois.

---

## 12. Riscos e pendências conhecidas (para o próximo responsável priorizar)

1. **Repo na conta pessoal** `gustavopaulino-chili` — transferir para a organização da empresa.
2. **`api/db.php` tem uma senha de banco como fallback no código versionado.** Mover para `.env`
   e **trocar essa senha** (tudo que foi pro GitHub deve ser considerado vazado).
3. **O app não tem sessão no servidor**: os endpoints confiam no `user_id` enviado pelo front.
   Em especial, **`api/getApiKey.php` devolve a `api_key` de qualquer `user_id`** para quem
   chamar. Precisa de autenticação real (sessão/JWT) antes de expor o app para fora da equipe.
3b. **`api/getGeminiKey.php` devolve a chave Gemini pessoal de qualquer `user_id`**, também
   sem autenticação. E `api/testFtp.php` recebe senha FTP por GET. Apagar/proteger os dois.
4. `.env` com chaves reais em cada servidor (`public_html/.env`): garantir que o Apache não
   serve o arquivo (testar `https://forge.chili.pa/.env` → deve dar 403/404).
5. Branches `main`/`release`/`testing` abandonadas; considerar fazer `dev` → `main` e adotar
   um fluxo claro.
6. Sem CI e sem testes automatizados; deploy manual sujeito ao problema do 550.
7. Código morto/legado: edge functions não chamadas (`parse-products-spreadsheet`,
   `render-landing-preview`, `smart-endpoint`), caminhos Gemini de imagem ainda dentro de
   `agents-ads` (usados só pelo app), `api/v1/ads/generate.php`.
8. Defeitos de qualidade ainda abertos na geração (ver fim de
   `.claude/memory/ads-test-run-counter.md`): texto/ícone "queimado" ocasional no fundo, logo
   colidindo com CTA em alguns layouts.
9. Ledger de custo (`gemini_usage`) subconta chamadas Gemini disparadas em fire-and-forget.

---

## 12b. Onde o trabalho parou (estado em 25/09/2026)

- **Último trabalho:** carrossel na API externa (commits de 23 e 24/09, `git log --grep caminho-c`):
  - campos `carousel_*`;
  - folha de estilo idêntica em todos os slides, ancorada nos posts da marca;
  - número de lista;
  - sinal de "deslize" como elemento gráfico da marca;
  - logo ancorada e legível por contraste.

  Foi feito para a Fullstop. A regra era publicar nos dois servidores, mas não conferi os
  arquivos remotos ao escrever isto: na dúvida, compare os tamanhos (seção 7.4). Não há tarefa
  pela metade no git: a árvore de trabalho estava limpa.
- **Antes disso (15 a 21/09):** tratamento da referência do cliente:
  - a referência passou a ser a primária;
  - opt-in de rosto com `reference_face_authorized`;
  - o herói da referência mantém a identidade e é reencenado na cena do anúncio;
  - dedup de `brand_posts`;
  - `forge_debug` com a lista das referências anexadas.
- **Branch não mergeada:** `worktree-fix-brand-color-lock` (parada desde 04/08). É um experimento
  da época do Gemini. Revise antes de apagar, mas provavelmente está obsoleta.
- **Frontend no live:** o `CLAUDE.md` só manda publicar o front no teste. Não sei se o app no
  live está igual ao do teste. Antes de publicar o app no live, compare `forge.chili.pa` com
  `testforge.chili.pa`.
- **Ideias levantadas e não feitas:**
  - espelhar no servidor a `reference_image` do chamador antes de gerar, para hosts que a
    OpenAI/edge não conseguem baixar;
  - reforçar a proibição de ícones decorativos no fundo.

---

## 12c. Receitas de tarefas comuns

**Investigar um job da API externa** (phpMyAdmin do banco **live**):
```sql
SELECT * FROM ad_generation_jobs WHERE id = <job_id>;
SELECT batch_index, status, error, attempts FROM ad_generation_job_batches WHERE job_id = <job_id>;
SELECT id, platform, format, public_url, created_at FROM ads_creatives WHERE campaign_id = <campaign_id>;
```
Logs do PHP: hPanel → site → Logs (erros), e o `error_log` da pasta. O worker loga com prefixo
`[caminho-c]` e `[generate-ads-worker]`.

**Ver uma company pelo telefone:**
```sql
SELECT id, user_id, HEX(phone), project_type, created_at FROM projects WHERE phone LIKE '%<digitos>%';
```

**Criar usuário admin:** cadastrar em `/auth` com e-mail `@chili.pa` (ou incluir o domínio em
`ADMIN_EMAIL_DOMAINS`). O tipo de conta é recalculado no login.

**Gerar `api_key` para um novo cliente da API:** logar no app com o usuário dono das companies
→ botão "API key" (chama `getApiKey.php`). Cada usuário é um espaço separado de companies.

**Desativar uma `api_key`:** `UPDATE api_keys SET is_active = 0 WHERE api_key = '<cf_…>';`

**Adicionar um formato novo na API externa:** incluir o preset em `ext_format_presets()`
(`generate-ads.php`). Deploy nos 2 servidores e avise a Fullstop (é mudança de contrato).

**Trocar a qualidade/modelo da imagem:** a qualidade vem do payload (`qualidade_imagem`) ou do
default `medium` no worker; o modelo `gpt-image-2` está fixo em `extc_openai_gerar`.

**Trocar a chave OpenAI/Gemini do servidor:** editar `public_html/.env` dos 2 servidores pelo
hPanel. Se trocar a Gemini de projeto Google, recriar os stores (seção 8).

**Adicionar/atualizar diretrizes (guidelines) do app:** tela `/admin/global-stores` (admin),
que usa `sync-global-store.php` e indexa no store Gemini global. Os textos-base estão em
`guidelines/*.txt`.

**Mudar o system prompt dos agentes do app:** fica na tabela `agents` (`ADS_AGENT`,
`LP_AGENT`) do banco, não no código.

**Conferir qual versão de um PHP está no servidor:** listar a pasta por FTP (seção 7.4) e
comparar o tamanho com `git cat-file -s $(git rev-parse <commit>:<caminho>)`. Com CRLF, o
tamanho no servidor é o tamanho do blob mais o número de linhas.

---

## 13. Onde está o conhecimento histórico

- `git log` na `dev`: as mensagens de commit são descritivas (em pt-BR) e explicam o porquê.
  `git log --grep caminho-c` conta a história do motor OpenAI.
- `.claude/memory/*.md`: bugs de produção, decisões do produto e receitas (deploy, teste, stores).
- Comentários no código de `api/v1/external/*`: longos de propósito; explicam cada regra.
- `docs/Automation_Systems_Operations_Manual.docx`: manual operacional anterior.
- `docs/CLAUDE_CODE_FUTURE_AI_PLAN.md`: plano de melhorias de IA do app (não iniciado por completo).
