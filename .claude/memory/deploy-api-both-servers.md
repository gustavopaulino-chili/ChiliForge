---
name: deploy-api-both-servers
description: Always deploy PHP/API changes to BOTH servers — staging (test) and live
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 91c6a15d-f8e6-486f-8d8d-7aa9746830da
---

When deploying API (PHP) changes on ChiliForge, always deploy to BOTH servers, not just staging:

- Staging (test / testforge.chili.pa): `powershell -File scripts/deploy-ftp.ps1 <files>`
- Live / production (forge.chili.pa): `powershell -File scripts/deploy-live.ps1 <files>` (use `-AllApi` for whole api/**, or no args for external API only, `-Frontend` for dist/)

**Why:** the user wants staging and production kept in sync; deploying only to test leaves live stale.

**How to apply:** after editing any `api/**` PHP file, run BOTH deploy scripts. Note this does NOT apply to Supabase edge functions (`supabase/functions/*`) — those deploy once via `npx supabase functions deploy <name>` to the single shared Supabase project (vehowvyqxhelyfdesmog), which serves both test and live frontends.

## O live JÁ ficou defasado — e custou um incidente (08/09/2026)

Os dois servidores são o MESMO host (`195.35.41.130`), contas FTP diferentes
(`u427845891.forge…` vs `u427845891.testforge…`). Em 08/09/2026 o live estava rodando
`generate-ads.php` + `generate-ads-worker.php` de **25/08 (`3e7d353`)**, enquanto o teste
tinha os de 28/08. Os três commits que aposentaram a geração Gemini (`9c65cac`, `ac8b499`,
`3a1122e`) nunca chegaram ao live, então o **fallback silencioso para o Gemini continuou
vivo em produção por 2 semanas** — gerando ads no motor errado e na chave do cliente da API
externa. Ver [[gemini-testing-key-free-tier]].

**Conferir a versão remota é barato e não depende de log** — o `ls` do FTP dá o tamanho, e
o tamanho identifica o commit:

```powershell
# lista a pasta remota (troque .deploy.env por .deploy.live.env para o live)
$cfg=@{}; foreach($l in Get-Content .deploy.env){ $t=$l.Trim(); if($t -eq '' -or $t.StartsWith('#') -or ($t -notmatch '=')){continue}; $k,$v=$t.Split('=',2); $cfg[$k.Trim()]=$v.Trim().Trim('"').Trim("'") }
curl.exe -s --ssl-reqd --insecure "ftp://$($cfg['FTP_HOST'])/api/v1/external/" --user "$($cfg['FTP_USER']):$($cfg['FTP_PASS'])"
```

```bash
# tamanho de cada commit, em LF e em CRLF — um dos dois bate com o do servidor
git cat-file -s $(git rev-parse <commit>:api/v1/external/<arquivo>)   # LF
# CRLF = blob + número de linhas (core.autocrlf=true converte no checkout)
```

## Armadilha do 550: `.in.<arquivo>.` órfão trava TODO upload seguinte

O host roda ProFTPD com `HiddenStores`: cada `STOR` grava em `.in.<nome>.` e renomeia no
fim. Se um upload for interrompido (curl exit 28, *FTP response timeout* — acontece com os
arquivos maiores), o `.in.` de 0 byte **fica para trás** e daí em diante todo upload daquele
arquivo devolve `curl: (25) Failed FTP upload: 550`, para sempre. O arquivo real continua
com a versão ANTIGA — o deploy "falha", mas o sistema segue funcionando, então é fácil não
perceber. É a hipótese mais provável para o live ter congelado em 25/08.

**Como sair:** apagar o órfão e reenviar. O `deploy-*.ps1` não faz isso sozinho.

```powershell
curl.exe -s --ssl-reqd --insecure "ftp://$($cfg['FTP_HOST'])/api/v1/external/" `
  --user "$($cfg['FTP_USER']):$($cfg['FTP_PASS'])" `
  -Q "DELE /api/v1/external/.in.generate-ads-worker.php." -o NUL
```

**Regra:** depois de qualquer deploy que reporte `FALHOU`, listar a pasta remota e conferir
data/tamanho — nunca assumir que uma retentativa bem-sucedida depois de um timeout resolveu.
Ver [[nao-reformular-o-que-funciona]] (o fix é cirúrgico: apagar o órfão, não refazer o
script de deploy).
