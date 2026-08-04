---
name: reference-image-e-o-primeiro-de-composecompanyrefs
description: A reference_image do chamador é o PRIMEIRO item de composeCompanyRefs — nunca filtre esse array por posição
metadata:
  node_type: memory
  type: project
---

`campaign.reference_image` (a referência que o chamador manda para AQUELA geração) é colocada
pelo `generate-ads.php` como **primeiro item de `composeCompanyRefs`**, antes dos brand posts:
`[hero, brandPosts…, product/company/bg]`. A edge busca a lista inteira para `companyRefImages`,
então a referência do chamador é `companyRefImages[0]` — **não** vive em `refImagesForGen`
(esse é outro canal, `payload.referenceImages`, normalmente vazio na API externa).

**Bug causado por isso em 04/08/2026:** um filtro de modo proxy descartava o array de company
refs inteiro para tirar os posts do concorrente — e levava a `reference_image` do chamador
junto. Sintoma relatado: "enviei uma referência pra geração e ela simplesmente não foi usada".
Nenhum erro, nenhum log: a imagem só não influenciava o anúncio.

**Regra:** ao filtrar `composeCompanyRefs`/`companyRefImages`, filtre por **identidade da URL**,
nunca por posição ou por "descarta tudo". O material de marketing armazenado são os arquivos
espelhados `brand-post-*` e `site-*` sob os assets da company; **tudo o mais pertence à geração**.
Cuidado extra: uma referência externa é espelhada com nome genérico
(`external-api-asset-NN.webp`), então uma regra do tipo "está sob /assets/ → é da marca"
também a descartaria por engano.

**Como testar:** um run sem `reference_image` NÃO exercita esse caminho. Sempre mande
`campaign.reference_image` (dentro do objeto `campaign` — ver
[[external-ads-api-test-procedure]]) e confira no debug do job-status que
`composeCompanyRefs[0]` sobreviveu e que `bgRefImagesSent` a inclui.
