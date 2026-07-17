---
name: nao-reformular-o-que-funciona
description: Usuário prefere mudanças medidas; não empurrar overhaul em sistema que já funciona/está bom o suficiente.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 81bbd24b-7090-42fd-99e6-c02421a93b59
---

Quando o usuário reclama de um sintoma, ele quer a **causa** corrigida com o **menor** ajuste possível — NÃO um overhaul do sistema inteiro. Exemplos nesta sessão:
- "nao é pra deletar por completo se ele achou legal colocar deixa" (ao eu ter proibido design-assets em proxy em vez de só reinterpretá-los).
- "deixa quieto, ta funcionando ta bom" (ao eu propor reformular o gerador de overlay HTML pra variar mais estilo).

**Why:** ele está iterando rápido em produção e valoriza estabilidade; mudança ampla em algo que já entrega ("bom o suficiente") é fricção, não valor.

**How to apply:** priorizar o fix cirúrgico que resolve o sintoma relatado. Antes de propor mexer em algo que serve TODO o produto (ex.: overlay de todos os ads), confirmar que é regressão real — se for só "podia ser mais variado/melhor", oferecer numa frase e seguir, sem AskUserQuestion elaborado nem reescrita. Ver [[company-e-por-user-id-phone]] (mesma sessão).
