<?php
// Script para verificar configuração das APIs
echo "🔍 Verificando configuração das APIs...\n\n";

// Verificar variáveis de ambiente do banco
echo "=== BANCO DE DADOS ===\n";
$required_db = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'];
foreach ($required_db as $var) {
    $value = getenv($var);
    if ($value) {
        echo "✅ $var: configurado\n";
    } else {
        echo "❌ $var: NÃO CONFIGURADO\n";
    }
}

echo "\n=== SUPABASE (Frontend) ===\n";
$supabase_vars = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
foreach ($supabase_vars as $var) {
    $value = getenv($var);
    if ($value) {
        echo "✅ $var: configurado\n";
    } else {
        echo "❌ $var: NÃO CONFIGURADO\n";
    }
}

echo "\n=== APIs EXTERNAS ===\n";
$api_vars = ['GEMINI_API_KEY_PRODUCTION', 'GEMINI_API_KEY_TESTING', 'PEXELS_API_KEY'];
foreach ($api_vars as $var) {
    $value = getenv($var);
    if ($value) {
        echo "✅ $var: configurado\n";
    } else {
        echo "❌ $var: NÃO CONFIGURADO - API não funcionará\n";
    }
}

echo "\n=== SUPABASE (Backend) ===\n";
$backend_vars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
foreach ($backend_vars as $var) {
    $value = getenv($var);
    if ($value) {
        echo "✅ $var: configurado\n";
    } else {
        echo "❌ $var: NÃO CONFIGURADO - Funções Supabase não funcionarão\n";
    }
}

echo "\n" . str_repeat("=", 50) . "\n";
echo "📋 RESUMO:\n";
echo "- Frontend (React): Pode funcionar sem APIs externas\n";
echo "- Admin: usa GEMINI_API_KEY_PRODUCTION\n";
echo "- Usuários comuns: usam GEMINI_API_KEY_TESTING\n";
echo "- Busca de Imagens: Precisa PEXELS_API_KEY\n";
echo "- Autenticação: Funciona com banco MySQL\n";
echo "\n🎯 Para funcionalidade completa, configure:\n";
echo "   1. GEMINI_API_KEY_PRODUCTION (admin)\n";
echo "   2. GEMINI_API_KEY_TESTING (usuarios comuns)\n";
echo "   3. PEXELS_API_KEY (recomendado para imagens)\n";
echo "\n📖 Ver .env.example para instruções completas\n";
?>