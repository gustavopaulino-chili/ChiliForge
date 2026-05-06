# ChiliForge - Gerador de Websites

**ChiliForge** é uma plataforma web que gera websites automaticamente baseado em informações fornecidas pelo usuário através de um assistente passo-a-passo.

## 🚀 Funcionalidades

- **Autenticação**: Login e registro de usuários
- **Assistente 9 passos**: Geração guiada de websites
- **Templates de nicho**: Restaurante, SaaS, e-commerce, etc.
- **Geração de imagens**: Integração com IA para criar imagens
- **Preview em tempo real**: Visualização do website sendo criado
- **Histórico de projetos**: Salvar e gerenciar criações

## 🛠️ Stack Tecnológico

- **Frontend**: React 18 + TypeScript + Vite
- **UI**: shadcn/ui + Radix UI + Tailwind CSS
- **Backend**: PHP 8+ + MySQL
- **IA**: Supabase Edge Functions (Gemini)
- **Imagens**: Pexels API (imagens gratuitas)

## 📦 Instalação Local

```bash
# Clone o repositório
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>

# Instale as dependências
npm install

# Inicie o servidor de desenvolvimento
npm run dev
```

## 🔑 APIs Necessárias

### APIs OBRIGATÓRIAS para Funcionalidade Completa:

#### 1. **GEMINI_API_KEY_PRODUCTION** (Geração para admin)
- **Onde obter**: https://aistudio.google.com/app/apikey
- **Necessária para**: Geração de HTML/CSS/JS dos websites e funções auxiliares para contas admin
- **Status**: 🔴 CRÍTICA - Sem ela, geração de sites não funciona

#### 2. **GEMINI_API_KEY_TESTING** (Geração para usuários comuns)
- **Onde obter**: https://aistudio.google.com/app/apikey
- **Necessária para**: Geração de HTML/CSS/JS dos websites e funções auxiliares para contas não-admin
- **Status**: 🔴 CRÍTICA - Sem ela, usuários comuns não conseguem usar IA

#### 3. **PEXELS_API_KEY** (Busca de Imagens)
- **Onde obter**: https://www.pexels.com/api/ → Crie conta gratuita
- **Necessária para**: Buscar imagens gratuitas quando usuário não fornece
- **Status**: 🟡 RECOMENDADA - Sem ela, só usa imagens fornecidas pelo usuário

#### 3. **SUPABASE KEYS** (Backend de IA)
- **Onde obter**: https://supabase.com/dashboard → Seu projeto → Settings → API
- **Necessária para**: Executar funções Edge Functions
- **Status**: 🔴 CRÍTICA - Sem elas, nenhuma funcionalidade de IA funciona

## 🚀 Deploy no Hostinger

### 1. Configuração das APIs

Antes do deploy, obtenha todas as chaves de API necessárias:

```bash
# 1. Gemini API Key de produção
# Acesse: https://aistudio.google.com/app/apikey

# 2. Gemini API Key de testing
# Acesse: https://aistudio.google.com/app/apikey

# 3. Pexels API Key
# Acesse: https://www.pexels.com/api/ → Create Account

# 4. Supabase Keys
# Acesse: https://supabase.com/dashboard → Project → Settings → API
```

### 2. Preparação do Banco MySQL

1. Acesse seu painel Hostinger
2. Vá para **Databases** > **MySQL Databases**
3. Crie um novo banco de dados
4. Anote as credenciais (host, usuário, senha, nome do banco)

### 3. Configuração do Ambiente

1. Execute o script `database.sql` no seu banco MySQL
2. Copie `.env.example` para `.env`
3. Preencha todas as variáveis:

```env
# Banco MySQL
DB_HOST=sql123.hostinger.com
DB_USER=u123456789_chiliforge
DB_PASS=minha_senha_segura
DB_NAME=u123456789_chiliforge

# Supabase (Frontend)
VITE_SUPABASE_URL=https://vehowvyqxhelyfdesmog.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua_chave_publica

# APIs Externas (OBRIGATÓRIAS)
GEMINI_API_KEY_PRODUCTION=sua_api_key_gemini_production_aqui
GEMINI_API_KEY_TESTING=sua_api_key_gemini_testing_aqui
PEXELS_API_KEY=sua_api_key_pexels_aqui

# Supabase (Backend/Secret)
SUPABASE_URL=https://vehowvyqxhelyfdesmog.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
```

### 4. Upload dos Arquivos

1. Faça build da aplicação:
```bash
npm run build
```

2. Upload todos os arquivos para o diretório `public_html` do Hostinger
3. Certifique-se que os arquivos PHP estão na pasta `api/`

### 5. Verificação Final

Acesse `https://seudominio.com/api/check_apis.php` para verificar se tudo está configurado.

## ✅ Verificação de APIs

Execute o script de verificação:
```bash
# Acesse: https://seudominio.com/api/check_apis.php
```

Ele irá mostrar o status de todas as configurações necessárias.

## 🔒 Segurança

- Todas as queries usam **prepared statements** (proteção contra SQL injection)
- Senhas são **hashed** com `password_hash()`
- Validação de entrada em todos os endpoints
- CORS configurado para produção
- Chaves de API armazenadas de forma segura

## 📁 Estrutura do Projeto

```
├── api/                 # Backend PHP
│   ├── db.php          # Conexão com banco
│   ├── login.php       # Autenticação
│   ├── register.php    # Registro
│   ├── check_apis.php  # Verificação de APIs
│   └── ...
├── src/                # Frontend React
├── public/             # Arquivos estáticos
├── database.sql        # Schema do banco
├── .env.example        # Exemplo de configuração
```

## 🧪 Teste Rápido

1. **Login**: Use suas credenciais de usuário MySQL cadastradas no banco
2. **Verificação de APIs**: Execute `api/check_apis.php`
3. **Teste de Geração**: Tente gerar um site simples

## 🐛 Troubleshooting

### Geração de Sites não Funciona
- ✅ Verifique se GEMINI_API_KEY_PRODUCTION está configurada para admins
- ✅ Verifique se GEMINI_API_KEY_TESTING está configurada para usuários comuns
- ✅ Execute `api/check_apis.php` para diagnóstico

### Imagens não Aparecem
- ✅ Verifique se `PEXELS_API_KEY` está configurada
- ✅ Ou forneça suas próprias imagens no formulário

### Login não Funciona
- ✅ Verifique conexão com banco MySQL
- ✅ Execute `database.sql` se necessário
- ✅ Use credenciais de teste primeiro
