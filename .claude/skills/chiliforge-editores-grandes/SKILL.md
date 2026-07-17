---
name: chiliforge-editores-grandes
description: Estratégia para editar os arquivos gigantes do ChiliForge sem ler o arquivo inteiro e queimar tokens. Use SEMPRE que a tarefa tocar AdsEditor.tsx (9000+ linhas), VisualEditor.tsx (7700+ linhas) ou qualquer arquivo de editor visual muito grande, incluindo features de drag, snap, alignment, o código de bridge injetado no iframe, ou a lógica de eventos do editor. Dispare ao ouvir "editor de ads", "editor visual", "AdsEditor", "VisualEditor", "snap", "alinhamento", "arrastar elemento", "bridge do iframe" ou "esse arquivo é enorme". Ler esses arquivos por inteiro é a tarefa mais cara em tokens do projeto — esta skill mostra como localizar e editar cirurgicamente.
---

# ChiliForge — Editando os arquivos gigantes (AdsEditor / VisualEditor)

`AdsEditor.tsx` (9000+ linhas) e `VisualEditor.tsx` (7700+ linhas) são os maiores do projeto.
Cada edição que começa com "ler o arquivo todo" desperdiça milhares de tokens e ainda perde
contexto no meio. A regra é: **mapear → localizar → editar cirurgicamente**, nunca ler inteiro.

## Passo 1 — Mapear sem ler tudo

Antes de qualquer edição, construa um mapa barato da estrutura:

```bash
# Componentes, funções e hooks de topo (assinaturas, não corpos)
grep -nE "^(export |const |function |class |  const .* = \(|useEffect|useState|useCallback|useMemo)" AdsEditor.tsx | head -120

# Handlers de evento (drag/snap/align costumam estar aqui)
grep -niE "onMouseDown|onMouseMove|onDrag|handleDrag|snap|align|onDrop|onResize" AdsEditor.tsx

# Pontos de comunicação com o iframe (bridge)
grep -niE "postMessage|addEventListener|contentWindow|iframe|injected|bridge" AdsEditor.tsx
```

Isso te dá os números de linha. A partir daí use `view` com `view_range` para abrir **só** o
trecho relevante (ex.: 200 linhas em torno do handler), não o arquivo.

## Passo 2 — Entender o modelo de bridge (snap/align)

As features de snap/alignment dependem de código **injetado no iframe** que conversa com o
editor por mensagens. A lógica costuma estar dividida em:
- o lado do editor (React) que escuta `message` e calcula guias/snap;
- o lado injetado (string de script ou arquivo) que reporta posições dos elementos.

Antes de mexer em snap/align, localize **os dois lados** com o grep de bridge acima. Mudar só
um lado quebra silenciosamente (sem erro de TS, porque `strict: false`).

## Passo 3 — Editar cirurgicamente

- Use `str_replace` com um trecho **único e curto** como âncora. Em arquivo de 9k linhas,
  strings repetidas são comuns — inclua contexto suficiente (a linha de cima e a de baixo) para
  o match ser único.
- Depois de um `str_replace`, qualquer `view` anterior daquele arquivo está desatualizado.
  Re-localize por `grep`/`view_range` antes da próxima edição no mesmo arquivo.
- Não reformate trechos vizinhos "de brinde": diffs grandes nesses arquivos são impossíveis de
  revisar e escondem regressões.

## Armadilhas conhecidas do projeto

- **`catch {}` silenciosos** são frequentes em `AdsEditor.tsx` e em `api.ts`. Se for tratar
  erros, procure-os (`grep -n "catch" AdsEditor.tsx`) e dê visibilidade — não adicione mais
  catch vazio.
- **Div de debug** com `outline: '3px solid magenta'` já foi commitada por engano e removida.
  Antes de commitar, `grep -ni "magenta\|outline:.*solid\|DEBUG\|console.log" AdsEditor.tsx`
  para não reintroduzir lixo visual.
- `strict: false` + `noUnusedLocals: false`: o compilador não acusa variável morta nem tipo
  errado aqui. Confie em leitura e teste, não no `tsc`.

## Por que assim
O gargalo não é a complexidade da edição — é o custo de carregar 9000 linhas para mudar 5. O
fluxo grep → view_range → str_replace transforma uma tarefa de "ler o arquivo inteiro toda vez"
numa de "abrir só a vizinhança do que muda", que é ordens de magnitude mais barata e menos
propensa a perder contexto.
