<#
.SYNOPSIS
  Despliegue en el servidor Apache. Lo ejecuta el runner self-hosted (deploy.yml) desde la raíz del
  repositorio ya compilado. También se puede correr a mano como administrador.

  Espera en el servidor:
    C:\cdp\config\api.env          variables de la API (ver .env.example)
    C:\cdp\config\sentinel.env     variables del Sentinel
    C:\cdp\config\migrator.url     DATABASE_URL del rol cdp_migrator (una línea)
#>
param(
  [string]$RepoDir = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [string]$AppDir = 'C:\cdp\app',
  [string]$ConfigDir = 'C:\cdp\config',
  [string]$ApacheDir = 'C:\Apache24'
)

$ErrorActionPreference = 'Stop'
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

function Invoke-Robocopy($from, $to, [string[]]$extra) {
  robocopy $from $to /MIR /NFL /NDL /NJH /NJS /NP @extra | Out-Null
  # robocopy devuelve < 8 cuando copió bien
  if ($LASTEXITCODE -ge 8) { throw "robocopy falló ($LASTEXITCODE): $from -> $to" }
  $global:LASTEXITCODE = 0
}

foreach ($f in 'api.env', 'sentinel.env', 'migrator.url') {
  if (-not (Test-Path "$ConfigDir\$f")) { throw "Falta $ConfigDir\$f" }
}

Step 'Deteniendo servicios'
foreach ($svc in 'CDP-Sentinel', 'CDP-API') {
  if (Get-Service $svc -ErrorAction SilentlyContinue) { Stop-Service $svc -Force }
}

Step "Copiando aplicación a $AppDir"
Invoke-Robocopy $RepoDir $AppDir @('/XD', '.git', 'release', 'coverage', 'playwright-report', 'test-results')
Copy-Item "$ConfigDir\api.env" "$AppDir\apps\api\.env" -Force
Copy-Item "$ConfigDir\sentinel.env" "$AppDir\apps\sentinel\.env" -Force

Step 'Migraciones de base de datos'
Push-Location "$AppDir\apps\api"
try {
  $env:DATABASE_URL = (Get-Content "$ConfigDir\migrator.url" -Raw).Trim()
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'prisma migrate deploy falló' }
  Remove-Item Env:\DATABASE_URL
  npm run db:seed
  if ($LASTEXITCODE -ne 0) { throw 'seed falló' }
} finally {
  Pop-Location
}

Step 'Publicando frontend en Apache'
Invoke-Robocopy "$RepoDir\apps\web\dist" "$ApacheDir\htdocs\cdp" @()

Step 'Configuración de Apache'
$confTarget = "$ApacheDir\conf\extra\cdp.conf"
$backup = "$confTarget.bak"
if (Test-Path $confTarget) { Copy-Item $confTarget $backup -Force }
Copy-Item "$RepoDir\infra\apache\cdp.conf" $confTarget -Force
& "$ApacheDir\bin\httpd.exe" -t
if ($LASTEXITCODE -ne 0) {
  if (Test-Path $backup) { Copy-Item $backup $confTarget -Force }
  throw 'httpd -t falló: se restauró la configuración anterior y Apache no se reinició'
}
& "$ApacheDir\bin\httpd.exe" -k restart

Step 'Arrancando servicios'
Start-Service CDP-API
Start-Service CDP-Sentinel

Step 'Prueba de humo'
$ok = $false
foreach ($i in 1..15) {
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1/api/health' -TimeoutSec 5
    if ($r.status -eq 'ok' -and $r.db -eq 'ok') { $ok = $true; break }
  } catch { }
  Start-Sleep -Seconds 2
}
if (-not $ok) { throw 'La API no respondió sano en /api/health después de 30 s' }
Write-Host 'Despliegue correcto.' -ForegroundColor Green
