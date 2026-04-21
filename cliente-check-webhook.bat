@echo off
setlocal EnableExtensions
chcp 65001 >nul

echo ============================================
echo   ORION - CHECK RAPIDO WEBHOOK
echo ============================================
echo.

echo [1/3] Status backend local:
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000/api/dashboard/webhook-status').Content } catch { $_.Exception.Message }"
echo.

echo [2/3] URL publica do ngrok:
powershell -NoProfile -Command "try { $r=Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels'; ($r.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1 -ExpandProperty public_url) } catch { $_.Exception.Message }"
echo.

echo [3/3] Teste do endpoint publico /api/v1/priority-client-update:
powershell -NoProfile -Command "$u=''; try { $r=Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels'; $u=($r.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1 -ExpandProperty public_url) } catch {}; if(-not $u){ 'SEM_TUNEL' } else { try { (Invoke-WebRequest -UseBasicParsing -Method POST ($u + '/api/v1/priority-client-update') -ContentType 'application/json' -Body '{\"type\":\"test\",\"data\":{\"id\":\"123456\"}}').StatusCode } catch { if($_.Exception.Response){ [int]$_.Exception.Response.StatusCode } else { $_.Exception.Message } } }"
echo.

pause
exit /b 0
