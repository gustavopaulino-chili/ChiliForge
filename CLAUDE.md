# ChiliForge — Claude Code Rules

## Deploy — manual via FTP (NÃO existe mais GitHub Actions)

O deploy é **100% manual** pelo script `scripts/deploy-ftp.ps1` (FTPS via curl; credenciais em `.deploy.env`, gitignorado). **Não há GitHub Actions** — commit/push NÃO publicam nada.

**Regra:** ao final de TODO request que altere arquivos, além de commitar na `dev`, **rodar o deploy** dos arquivos alterados:

```
# PHP / API — arquivos específicos
powershell -File scripts/deploy-ftp.ps1 api/caminho/arquivo.php

# Frontend React — buildar e enviar dist/ inteiro para public_html
npm run build
powershell -File scripts/deploy-ftp.ps1 -Frontend
```

Enviar **apenas os arquivos alterados** naquele request (não o conjunto inteiro). Edge functions (`supabase/functions/*`) continuam fora do FTP — usar `npx supabase functions deploy <name>`.

## Before conversation compaction

Before the conversation is compacted, commit all pending changes to `dev` and push, then run the manual FTP deploy of the changed files:

```
git add -A
git commit -m "<summary of changes made in this session>"
git push origin dev
```

Do this automatically without asking for confirmation when a compaction is about to occur.

## Supabase edge functions — deploy obrigatório

Sempre que qualquer arquivo em `supabase/functions/` for modificado, executar o deploy imediatamente após o build:

```
npx supabase functions deploy <function-name>
```

Exemplo: se `supabase/functions/agents-ads/index.ts` for alterado:
```
npx supabase functions deploy agents-ads
```

**Regra:** nunca considerar uma mudança em edge function como concluída sem o deploy. Mudanças no arquivo local não têm efeito em produção até serem publicadas no Supabase.

## Arquivos a enviar ao servidor após mudanças

Ao final de cada resposta que modifique arquivos, listar quais precisam ser enviados ao servidor (Hostinger ou Supabase), no formato:

**Servidor Hostinger (deploy manual via `scripts/deploy-ftp.ps1`):**
- `api/...` — arquivos PHP da API → `powershell -File scripts/deploy-ftp.ps1 api/...`
- Frontend (`src/` alterado) → `npm run build` e depois `powershell -File scripts/deploy-ftp.ps1 -Frontend`

**Supabase (deploy via CLI):**
- `supabase/functions/<name>/index.ts` → `npx supabase functions deploy <name>`

Não há GitHub Actions — o deploy só acontece quando o script FTP é executado.

## SQL changes

Whenever a task requires changes to the database schema or seed data (new tables, columns, indexes, seed rows, etc.), always output the complete SQL snippet at the end of the response — even if the change was already applied in `database.sql`. Format it as a fenced SQL code block so the user can copy and run it directly on the server.
