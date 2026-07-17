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
