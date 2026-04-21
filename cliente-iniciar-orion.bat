@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

echo ============================================
echo   ORION - INICIALIZACAO AUTOMATICA CLIENTE
echo ============================================
echo.

where ngrok >nul 2>nul
if errorlevel 1 (
  echo [ERRO] ngrok nao encontrado no PATH.
  echo Instale o ngrok e teste no CMD: ngrok version
  pause
  exit /b 1
)

set "APP_EXE=%LOCALAPPDATA%\Programs\Orion Painel\Orion Painel.exe"
if not exist "%APP_EXE%" (
  echo [ERRO] App nao encontrado em:
  echo %APP_EXE%
  echo Instale o Orion Painel antes de rodar este script.
  pause
  exit /b 1
)

echo [1/4] Iniciando tunel ngrok na porta 3000...
start "ORION-NGROK" cmd /k "ngrok http 3000 --log stdout"

echo [2/4] Aguardando ngrok estabilizar...
timeout /t 6 /nobreak >nul

echo [3/4] Obtendo URL publica do tunel...
set "TUNNEL_URL="
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $r=Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels'; ($r.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1 -ExpandProperty public_url)"`) do (
  set "TUNNEL_URL=%%U"
)

if not defined TUNNEL_URL (
  echo [AVISO] Nao consegui ler a URL do ngrok agora.
  echo O app ainda vai abrir, mas confira no ngrok se o tunel subiu.
) else (
  echo URL do tunel: !TUNNEL_URL!
  set "ENV_DIR=%APPDATA%\bot-orion-peptides"
  if not exist "!ENV_DIR!" mkdir "!ENV_DIR!" >nul 2>nul
  set "ENV_FILE=!ENV_DIR!\.env"

  if exist "!ENV_FILE!" (
    powershell -NoProfile -Command "$p=$env:ENV_FILE; $u=$env:TUNNEL_URL; $c=Get-Content -Raw $p; if($c -match '(?m)^WEBHOOK_BASE_URL='){ $c=[regex]::Replace($c,'(?m)^WEBHOOK_BASE_URL=.*$','WEBHOOK_BASE_URL='+$u) } else { if($c.Length -gt 0 -and -not $c.EndsWith([Environment]::NewLine)) { $c += [Environment]::NewLine }; $c += 'WEBHOOK_BASE_URL='+$u+[Environment]::NewLine }; Set-Content -Path $p -Value $c -Encoding UTF8"
  ) else (
    >"!ENV_FILE!" echo WEBHOOK_BASE_URL=!TUNNEL_URL!
  )
  echo WEBHOOK_BASE_URL atualizado em: !ENV_FILE!
)

echo [4/4] Abrindo Orion Painel...
start "" "%APP_EXE%"

echo.
echo Pronto. Se quiser validar:
echo - http://127.0.0.1:3000/api/dashboard/webhook-status
echo - Mercado Pago webhook em: URL_DO_TUNEL/api/v1/priority-client-update
echo.
exit /b 0
