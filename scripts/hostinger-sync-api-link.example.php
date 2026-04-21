<?php
/**
 * Exemplo para hospedar em: public_html/painel/sync-api-link.php (ou o caminho do seu site)
 *
 * 1) Copie este arquivo para a Hostinger e ajuste ORION_SYNC_SECRET abaixo (mesmo valor de ORION_SYNC_LINK_SECRET no .env do bot).
 * 2) Configure no .env do bot: ORION_SYNC_LINK_URL=https://atualhub.com.br/painel/sync-api-link.php
 *
 * O script grava api-link.json no mesmo diretório do PHP (ex.: painel/api-link.json).
 */
header('Content-Type: application/json; charset=utf-8');

// Troque por uma chave forte e repita no .env do servidor Node (ORION_SYNC_LINK_SECRET).
define('ORION_SYNC_SECRET', 'troque-por-uma-chave-secreta');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
    exit;
}

$secretHeader = $_SERVER['HTTP_X_ORION_SECRET'] ?? '';
if (ORION_SYNC_SECRET !== '' && !hash_equals(ORION_SYNC_SECRET, $secretHeader)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
$baseUrl = isset($data['baseUrl']) ? trim((string) $data['baseUrl']) : '';
if ($baseUrl === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'baseUrl_required']);
    exit;
}

$baseUrl = rtrim($baseUrl, '/');
$out = ['baseUrl' => $baseUrl];
$target = __DIR__ . '/api-link.json';

if (file_put_contents($target, json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n") === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'write_failed']);
    exit;
}

echo json_encode(['ok' => true, 'written' => basename($target)]);
