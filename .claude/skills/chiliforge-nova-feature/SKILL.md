---
name: chiliforge-nova-feature
description: Guia o corte vertical completo de uma feature nova no ChiliForge que precisa de persistência em banco. Use SEMPRE que a tarefa envolver criar/alterar uma tabela, coluna ou entidade nova que precise ser lida ou gravada pela UI — ou seja, qualquer coisa que toque SQL + PHP + tipos TypeScript + api.ts + componente React ao mesmo tempo. Dispare mesmo quando o usuário só menciona "adicionar um campo X", "guardar Y no banco", "novo endpoint para Z" ou "salvar tal coisa", pois no ChiliForge isso quase sempre significa mexer em 5 arquivos em camadas diferentes na ordem certa. Não use para edição puramente visual de editor nem para mudanças que não tocam o banco.
---

# ChiliForge — Corte vertical de feature nova (5 arquivos)

No ChiliForge, adicionar algo que persiste no banco é a tarefa mais cara em tokens porque
encadeia **5 camadas**. O erro comum é mexer em uma camada, descobrir que outra ficou
inconsistente, e refazer. Esta skill fixa a ordem e as convenções para fazer de uma vez só.

## Arquitetura relevante

Fluxo: `React → src/services/api.ts → PHP (valida + orquestra) → MySQL (MySQLi)`.
Para features de IA, o PHP ainda chama uma Edge Function Supabase (ver `chiliforge-ia-gemini`).
Não há ORM, não há autoload PHP, não há estado global (sem Redux/Zustand). `strict: false`
no TS, então tipar bem aqui importa porque o compilador não vai te proteger.

## A ordem canônica (de baixo para cima)

Faça nesta sequência — cada passo depende do anterior estar definido:

### 1. SQL — tabela/coluna
- MySQL 8, colunas em `snake_case`. São 5 tabelas principais; primeiro confirme se a feature
  cabe numa existente antes de criar tabela nova (use `SHOW TABLES;` / `DESCRIBE <tabela>;`
  ou leia o arquivo de schema/migração do projeto).
- Escreva o SQL como um arquivo de migração versionado (não só um comando solto), para o
  deploy no Hostinger conseguir reproduzir. Inclua o `ALTER`/`CREATE` e, se aplicável, o
  rollback comentado.
- Defaults e `NOT NULL` explícitos: dados antigos vão existir, então toda coluna nova precisa
  de default ou ser nullable, senão o publish/save de registros antigos quebra.

### 2. PHP — endpoint
- Siga a skill `chiliforge-php-endpoint` à risca (db.php no topo, MySQLi com prepared
  statements, validação por endpoint, resposta JSON padrão). Nome do arquivo em `snake_case`
  ou no padrão `verboRecurso.php` já usado (ex.: `getAdCreatives.php`, `publishAdCreative.php`).
- Um endpoint = uma responsabilidade. Não empacote create+update+delete num arquivo só sem
  necessidade clara.

### 3. TypeScript — tipos
- Defina/atualize a interface em `src/types/`. Espelhe **exatamente** as colunas do banco e o
  shape do JSON do PHP. Como `strict` está desligado, um tipo errado não gera erro de compilação
  — ele só estoura em runtime, então este passo é a sua única rede de segurança.
- Campos que o PHP pode não retornar devem ser opcionais (`?`) no tipo.

### 4. api.ts — método de serviço
- Toda chamada HTTP é centralizada em `src/services/api.ts` (700+ linhas). NÃO faça `fetch`
  direto no componente — adicione um método aqui seguindo o padrão dos vizinhos (mesma forma
  de montar URL, mesmos headers de auth, mesmo parse de resposta).
- Tipe o retorno com a interface do passo 3.
- Atenção a erros: o projeto tem histórico de `catch {}` silencioso. Propague o erro ou
  retorne um resultado tipado que o componente consiga tratar — não engula a exceção.

### 5. React — componente/UI
- Componentes em `PascalCase`, dentro da pasta de domínio correta (`generator/`,
  `ad-generator/`, `editor/`, `landing/`, `project/`). UI genérica reaproveita `ui/` (shadcn).
- Estado em `useState`/context local (não há store global). Trate loading e erro
  explicitamente — mostre algo ao usuário no `catch`.

## Checklist antes de declarar pronto

- [ ] SQL tem default/nullable para registros antigos não quebrarem
- [ ] Endpoint PHP valida entrada e usa prepared statement (sem string concat em query)
- [ ] Tipo TS bate coluna-a-coluna com o banco e com o JSON do PHP
- [ ] Método em `api.ts` (nenhum `fetch` solto no componente) e não engole erro
- [ ] Componente trata loading + erro visíveis ao usuário
- [ ] Os 5 arquivos foram citados/commitados juntos (ver `chiliforge-deploy` p/ pendências)

## Por que isso importa
A maior fonte de retrabalho aqui é inconsistência entre camadas com `strict: false`: o TS não
acusa, então o bug aparece só em produção no Hostinger. Fechar as 5 camadas numa passada,
na ordem de baixo para cima, é o que torna a tarefa barata em vez de um loop de idas e voltas.
