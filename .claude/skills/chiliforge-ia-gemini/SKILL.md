---
name: chiliforge-ia-gemini
description: Fluxo de trabalho para as Edge Functions Supabase (Deno/TypeScript) que chamam a Gemini API, mais a pipeline de geração e composição de imagens (Gemini image + Pexels) do ChiliForge. Use SEMPRE que a tarefa envolver gerar texto ou imagem com IA, mexer em qualquer função em supabase/functions, debugar erros 403/546 da Gemini, ajustar a pipeline compose, o worker de ads assíncrono, o agents-ads/index.ts, ou o ciclo de deploy/redeploy de edge function. Dispare também ao ouvir "geração de imagem", "Gemini", "Pexels", "edge function", "compose", "worker de ads" ou "a IA está falhando". O loop edge→Gemini→erro→redeploy→teste é caro em tokens, então siga este roteiro para encurtar a iteração.
---

# ChiliForge — Edge Functions + Gemini + pipeline de imagem

São ~16 Edge Functions Supabase (Deno/TypeScript) que encapsulam a Gemini API. O PHP no
Hostinger orquestra; a Edge Function chama a Gemini; o resultado volta e é salvo em MySQL +
disco. O custo em tokens aqui vem do **loop de redeploy**: editar → fazer deploy → testar →
ver erro 403/546 → ajustar → redeploy. O objetivo desta skill é fechar o diagnóstico antes do
redeploy, não depois.

## Mapa do fluxo

```
React → PHP (prepara payload + auth) → Supabase Edge Function (Deno) → Gemini API
                                                                      ↘ Pexels (busca de imagem)
            ← salva em MySQL + disco ←──────────────────────────────────┘
```

- Texto/criativos: `agents-ads/index.ts` (2000+ linhas) é a pipeline principal, com múltiplos
  modos. **Não leia o arquivo inteiro** — localize o modo/branch relevante por `grep` (ver
  `chiliforge-editores-grandes`).
- Imagem: Gemini image generation para geração; **Pexels** para busca de imagens prontas.
- `compose`: coordena PHP → Supabase → Gemini image → PHP save → preview. É multi-etapa;
  um erro no meio costuma vir de uma etapa anterior, não de onde o erro aparece.

## Antes de redeployar — diagnostique o erro

**403 da Gemini** quase sempre é credencial/autorização, não código:
- Chave de API ausente, expirada ou não setada nos secrets da Edge Function
  (`supabase secrets list`).
- Modelo ou endpoint sem permissão para a conta/projeto.
- Verifique o secret **antes** de mexer no código — redeployar código não conserta chave errada.

**546 / 5xx** costuma ser timeout ou payload grande:
- Imagem de referência grande demais no request (Edge Functions têm limite de tempo/tamanho).
- Pipeline `compose` esperando uma etapa lenta. Cheque os logs da função
  (`supabase functions logs <nome>`) para ver onde parou.

**Erro só na imagem:** confirme se é geração (Gemini) ou busca (Pexels) que falhou — são
caminhos diferentes com credenciais diferentes.

## Otimizações de custo de imagem planejadas (ainda não feitas)

O documento lista 3 otimizações projetadas mas **não implementadas**. Se a tarefa for reduzir
custo/latência de imagem, é aqui:
1. **Dedup por ratio** — não regenerar imagens com a mesma proporção já produzida.
2. **Resize de refs** — encolher imagens de referência antes de enviar (também ajuda com 546).
3. **Batch** — agrupar requisições em vez de uma chamada por item.

Implemente na Edge Function/pipeline, não no frontend, e meça o efeito no erro 546.

## Ciclo de deploy de Edge Function

```bash
# Deploy de UMA função (mais rápido que deployar tudo)
supabase functions deploy <nome-da-funcao>

# Ver logs em tempo real para diagnosticar 403/546
supabase functions logs <nome-da-funcao>

# Conferir/ajustar secrets (causa nº1 de 403)
supabase secrets list
supabase secrets set GEMINI_API_KEY=...
```

Atenção: `supabase/.temp/cli-latest` aparece modificado em estado transitório de deploy — não
o commite achando que é mudança de feature.

## Por que assim
Cada redeploy custa tempo e tokens de teste. A maior economia é separar **"é credencial"
(403, conserta em segundos via secret)** de **"é código/payload" (546/lógica, aí sim edita e
redeploya)**. Ler os logs antes de tocar o código evita o loop de redeploy às cegas.
