# ChiliForge — Claude Code Rules

## Before conversation compaction

Before the conversation is compacted, commit all pending changes to `dev` and push:

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

**Servidor Hostinger (FTP/SSH):**
- `api/v1/...` — arquivos PHP da API
- `public_html/...` — arquivos de front-end

**Supabase (deploy automático via CLI):**
- `supabase/functions/<name>/index.ts` → `npx supabase functions deploy <name>`

Se apenas o frontend React foi alterado (`src/`, `dist/`), indicar que o `npm run build` gera `dist/` e esse diretório deve ser enviado ao servidor Hostinger.

## SQL changes

Whenever a task requires changes to the database schema or seed data (new tables, columns, indexes, seed rows, etc.), always output the complete SQL snippet at the end of the response — even if the change was already applied in `database.sql`. Format it as a fenced SQL code block so the user can copy and run it directly on the server.
