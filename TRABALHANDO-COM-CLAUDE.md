# Trabalhando no ChiliForge com o Claude Code

Guia prático pra **qualquer pessoa** mexer neste projeto usando o Claude Code — do zero até fazer uma mudança e publicar. Leia uma vez por inteiro; depois use como referência.

---

## 1. O que é o ChiliForge (arquitetura em 30 segundos)

Gerador de anúncios e landing pages por IA, acionado por WhatsApp/n8n. São **três camadas**, cada uma com seu deploy próprio:

| Camada | O que é | Onde roda | Como publica |
|---|---|---|---|
| **Frontend** | React + Vite + TypeScript (`src/`) | Hostinger (`public_html`) | `npm run build` → FTP |
| **API / PHP** | Endpoints em `api/` (`api/v1/external/*`, `api/v1/agents/*`) | Hostinger — **DOIS servidores**: `testforge.chili.pa` (teste) e `forge.chili.pa` (live), **bancos separados** | FTP (dois scripts) |
| **Edge Functions** | Deno/TypeScript em `supabase/functions/*` (chamam a Gemini) | Supabase (1 projeto serve teste E live) | `npx supabase functions deploy <nome>` |

> ⚠️ **Não existe GitHub Actions.** Commit/push **não publicam nada**. Publicar é sempre manual (FTP + Supabase CLI). Ver seção 5.

Fluxo típico de um anúncio: WhatsApp → n8n → `api/v1/external/company-assets.php` (registra a marca) e `generate-ads.php` (gera) → edge `agents-ads` → Gemini (texto + imagem) + Pexels → volta a imagem/HTML.

---

## 2. Como começar uma sessão com o Claude (o "prepare-se para mudar")

O Claude não lembra de sessões anteriores sozinho — o conhecimento do projeto fica em **arquivos versionados**. No começo de cada sessão, mande ele carregar o contexto. Cole isto:

```
Antes de qualquer coisa, leia e absorva:
1. CLAUDE.md (regras do projeto — deploy, SQL, etc.)
2. .claude/memory/MEMORY.md e os arquivos de memória em .claude/memory/
3. As skills em .claude/skills/ (veja quais existem)
Depois me diga que está pronto e resuma em 3 linhas o que entendeu do fluxo de deploy.
```

Com isso ele já sabe: as regras de deploy, os bugs/decisões passadas (memória) e os atalhos de trabalho (skills). **A partir daí ele já consegue mudar com segurança.**

### O que cada fonte de contexto entrega

- **`CLAUDE.md`** — regras *obrigatórias* (deploy manual, sempre nos dois servidores, deploy de edge após editar, sempre imprimir o SQL no fim).
- **`.claude/memory/`** — fatos aprendidos: por que a company é por `(user_id, phone)`, chaves Gemini, procedimento de teste da API de ads, etc. `MEMORY.md` é o índice.
- **`.claude/skills/`** — roteiros de tarefas específicas (ver abaixo).

### Skills disponíveis (o Claude aciona sozinho, ou você pede `/nome`)

| Skill | Quando usar |
|---|---|
| **brainstorming** | Antes de qualquer trabalho criativo/feature — explora intenção e requisitos antes de codar. |
| **chiliforge-nova-feature** | Feature nova que precisa de **banco** (SQL + PHP + tipos TS + `api.ts` + React, na ordem certa). |
| **chiliforge-ia-gemini** | Mexer em `supabase/functions/*`, pipeline de imagem (Gemini + Pexels), erros 403/546, worker de ads, ciclo edge→deploy→teste. |
| **chiliforge-editores-grandes** | Tocar nos arquivos gigantes (`AdsEditor.tsx` 9000+ linhas, `VisualEditor.tsx` 7700+): como editar cirurgicamente sem ler o arquivo inteiro e queimar tokens. |

---

## 3. Estrutura do repositório (o que importa)

```
ChiliForge/
├── CLAUDE.md                 # regras que o Claude DEVE seguir
├── TRABALHANDO-COM-CLAUDE.md # este guia
├── src/                      # frontend React (editores, gerador de ads, UI)
├── api/                      # PHP — backend na Hostinger
│   ├── v1/external/          # API pública (n8n): company-assets, generate-ads, job-status…
│   └── v1/agents/            # helpers compartilhados (helpers.php, custo Gemini…)
├── supabase/functions/       # edge functions Deno (agents-ads, agents-lp, agents-lp-reforge…)
├── scripts/
│   ├── deploy-ftp.ps1        # deploy p/ servidor de TESTE  (lê .deploy.env)
│   └── deploy-live.ps1       # deploy p/ servidor LIVE       (lê .deploy.live.env)
├── database.sql              # documentação do schema (rode as mudanças no servidor)
└── .claude/                  # contexto do Claude (versionado — ver seção 6)
```

---

## 4. Fazendo uma mudança (o loop de trabalho)

1. **Contexto** — sessão nova? Rode o prompt da seção 2.
2. **Peça a mudança** em linguagem natural. Se envolver banco, o Claude deve seguir `chiliforge-nova-feature`.
3. **Revise** o que ele editou.
4. **Publique** os arquivos alterados (seção 5). O Claude já faz isso automaticamente ao fim do request (hook), mas confira.
5. **SQL** — se mudou schema, o Claude imprime o bloco SQL no fim; **rode você mesmo no banco** (teste e/ou live).

### Automação já existente (hooks do `.claude/settings.json`)

- **Ao editar** qualquer arquivo → marca a sessão como "com edições".
- **Ao fim do request (Stop):**
  - Faz deploy automático de **toda edge function alterada** (`npx supabase functions deploy`).
  - `git add -A` + commit + **push na `dev`** (mensagem "auto: commit automatico na dev...").
- O **deploy FTP (PHP/frontend) NÃO é automático** — o Claude roda os scripts manualmente conforme a regra do `CLAUDE.md`.

---

## 5. Deploy (manual)

### PHP / API — **sempre nos DOIS servidores**

```powershell
# Teste
powershell -File scripts/deploy-ftp.ps1  api/v1/external/generate-ads.php
# Live
powershell -File scripts/deploy-live.ps1 api/v1/external/generate-ads.php
```

Envie **só os arquivos alterados** no request (não o conjunto todo).

### Frontend React

```powershell
npm run build
powershell -File scripts/deploy-ftp.ps1 -Frontend      # manda dist/ p/ public_html (teste)
```

### Edge Functions (Supabase)

```powershell
npx supabase functions deploy agents-ads
```

> Uma mudança em `supabase/functions/*` **só tem efeito em produção depois do deploy**. O arquivo local não basta.

---

## 6. Configurando os deploys do zero (a partir do Drive)

As credenciais de deploy são **segredos** e ficam **fora do git** (`.gitignore`). Quando você (ou outra pessoa) clonar o repo numa máquina nova, os scripts de deploy não funcionam até você recriar esses arquivos. Guarde-os num **Drive privado** e restaure assim:

### Arquivos necessários (crie na raiz do repo)

**`.deploy.env`** — servidor de **teste** (`testforge.chili.pa`):
```
FTP_HOST=195.35.41.130
FTP_USER=usuario_ftp_do_teste
FTP_PASS=senha_ftp_do_teste
```

**`.deploy.live.env`** — servidor **live** (`forge.chili.pa`):
```
FTP_HOST=host_do_server_live
FTP_USER=usuario_ftp_live
FTP_PASS=senha_ftp_live
# REMOTE_BASE=public_html   # opcional, se a API não estiver na raiz do FTP
```
(há um template versionado: `.deploy.live.env.example`.)

**`.env`** — chaves da aplicação (Gemini etc.), incluindo:
```
GEMINI_API_KEY_PRODUCTION="AIza…"
GEMINI_API_KEY_TESTING="AIza…"
```
> ⚠️ Os valores no `.env` vêm **entre aspas** — ao usar a chave programaticamente, remova as aspas (`.replace(/^["']|["']$/g,'')`), senão a Gemini responde `API_KEY_INVALID`.

### Passo a passo numa máquina nova

1. Clone o repo e `npm install`.
2. Baixe do Drive: `.deploy.env`, `.deploy.live.env`, `.env` → coloque na **raiz** do repo.
3. Instale a CLI da Supabase e faça login (`supabase login`) para os deploys de edge.
4. Teste: `powershell -File scripts/deploy-ftp.ps1 api/algum-arquivo.php`.

### O que guardar no Drive (checklist)

- `.deploy.env` e `.deploy.live.env` (credenciais FTP teste + live)
- `.env` (chaves Gemini, Pexels, etc.)
- A **api_key de teste** (`cf_…`) usada nas chamadas da API externa
- Onde fica cada coisa: host FTP, usuário, projeto Supabase (`vehowvyqxhelyfdesmog`)

> Se um dia quiser deploy **automático** de verdade (CI), a base já está pronta: os scripts leem tudo de `.env`/`.deploy*.env`. Bastaria um runner (GitHub Actions self-hosted, ou um cron) com esses segredos injetados como variáveis de ambiente e chamando `deploy-ftp.ps1` / `deploy-live.ps1` / `supabase functions deploy`. Hoje isso é feito à mão de propósito.

---

## 7. Segurança — leia isto

- **`.claude/settings.local.json` NÃO é versionado** (contém credenciais em texto puro). O `.gitignore` já o exclui. Nunca force o commit dele.
- **Nunca** cole senha de FTP, chave Gemini ou `api_key` completa em arquivos versionados (código, memória, este guia). Use referências ("ver `.deploy.env`") e guarde o valor real no Drive.
- Ao commitar a memória, **redija** qualquer segredo antes (é o que foi feito com a api_key de teste em `external-ads-api-test-procedure.md`).
- Se um segredo já vazou pro histórico do git, considere-o **comprometido** e **troque-o** — reescrever histórico não basta quando já foi pro GitHub.

---

## 8. Regras rápidas (resumo do `CLAUDE.md`)

- Deploy é **100% manual**: FTP (PHP/front, **dois servidores**) + `supabase functions deploy` (edge). Sem GitHub Actions.
- Ao fim de **todo** request que altere arquivos: commit na `dev` **e** deploy dos arquivos alterados.
- Editou `supabase/functions/*`? Faça `npx supabase functions deploy <nome>` — sem isso não tem efeito.
- Mudou schema (tabela/coluna/seed)? Imprima o **bloco SQL completo** no fim da resposta pra rodar no servidor.
- Enviar **apenas os arquivos alterados** naquele request.

---

Dúvida sobre o fluxo? Abra uma sessão do Claude, rode o prompt da seção 2, e pergunte — ele já vai estar com todo o contexto carregado.
