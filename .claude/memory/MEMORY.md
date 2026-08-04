# Memory Index

- [Test ads one at a time](test-ads-one-at-a-time.md) — when testing ad generation, only 1 ad per run (cost)
- [Ad image model 3.1-flash](ad-image-model-3.1-flash.md) — ad images run on gemini-3.1-flash-image via Supabase secret GEMINI_IMAGE_MODELS
- [Deploy API to both servers](deploy-api-both-servers.md) — PHP/API changes deploy to BOTH test (deploy-ftp.ps1) and live (deploy-live.ps1)
- [External Ads API test procedure](external-ads-api-test-procedure.md) — how to submit/poll/download an ads generation test (LIVE endpoint, strip quotes from .env key)
- [Ads test run counter](ads-test-run-counter.md) — incrementing label for ad-tests files; next run = 273
- [Gemini testing key is free tier](gemini-testing-key-free-tier.md) — GEMINI_API_KEY_TESTING free tier → image gen 429; PRODUCTION is paid
- [Brief full only for company calls](brief-full-only-for-company-calls.md) — full brief only for company-assets; ad generation caps it so ref images/brand posts drive the visual
- [Gemini stores são project-scoped](gemini-stores-sao-project-scoped.md) — trocar a key invalida todo gemini_store_name (403); precisa limpar as colunas p/ recriar
- [Brief EN p/ modelo, PT p/ cliente](brief-en-para-modelo-pt-para-cliente.md) — brandVisualBrief fica em inglês de propósito; o pt-BR do cliente é brandVisualBriefPt
- [Company é por (user_id, phone)](company-e-por-user-id-phone.md) — duplicatas faziam ad sair com marca errada; índice único + get-or-create atômico + deleteProject purga tudo
- [Não reformular o que funciona](nao-reformular-o-que-funciona.md) — fix cirúrgico do sintoma, não overhaul; não empurrar mudança em sistema que já está bom
- [Hex nunca vai pro prompt de imagem](hex-nunca-vai-pro-prompt-de-imagem.md) — "Brand palette: ;;;" é o scrub de propósito, não dado faltando; cor vai por NOME
- [Cor do concorrente vence por volume de prosa](cor-do-concorrente-vence-por-volume-de-prosa.md) — carve-out de 1 linha perde pra parágrafo; tire a cor do brief e nunca dê paleta-exemplo
- [Prosa não vence pixel](prosa-nao-vence-pixel.md) — regra escrita perde pra imagem de ref legível; borrar não resolve (medido); tire a imagem do input
- [Proibição que nomeia vira desenho](proibicao-que-nomeia-vira-desenho.md) — soletrar 'LOGO' no prompt fez o modelo desenhar "LOGO"; proíba descrevendo o estado desejado
- [reference_image é o primeiro de composeCompanyRefs](reference-image-e-o-primeiro-de-composecompanyrefs.md) — nunca filtre esse array por posição; filtre por identidade da URL
