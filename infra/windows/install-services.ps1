<#
.SYNOPSIS
  Registra la API y el Sentinel como servicios de Windows con NSSM (https://nssm.cc).
  Ejecutar una vez como administrador, después del primer despliegue.
.EXAMPLE
  .\install-services.ps1 -AppDir C:\cdp\app
#>
param(
  [string]$AppDir = 'C:\cdp\app',
  [string]$LogDir = 'C:\cdp\logs'
)

$ErrorActionPreference = 'Stop'
$nssm = (Get-Command nssm -ErrorAction Stop).Source
$node = (Get-Command node -ErrorAction Stop).Source
New-Item -ItemType Directory -Force $LogDir | Out-Null

$services = @(
  @{ Name = 'CDP-API'; Dir = "$AppDir\backend\api"; Script = 'dist\index.js' },
  @{ Name = 'CDP-Sentinel'; Dir = "$AppDir\backend\sentinel"; Script = 'dist\index.js' }
)

foreach ($s in $services) {
  if (Get-Service $s.Name -ErrorAction SilentlyContinue) {
    & $nssm stop $s.Name | Out-Null
    & $nssm remove $s.Name confirm | Out-Null
  }
  & $nssm install $s.Name $node $s.Script
  & $nssm set $s.Name AppDirectory $s.Dir
  & $nssm set $s.Name AppStdout "$LogDir\$($s.Name).out.log"
  & $nssm set $s.Name AppStderr "$LogDir\$($s.Name).err.log"
  & $nssm set $s.Name AppRotateFiles 1
  & $nssm set $s.Name AppRotateBytes 10485760
  & $nssm set $s.Name AppEnvironmentExtra 'NODE_ENV=production'
  & $nssm set $s.Name Start SERVICE_AUTO_START
  Write-Host "Servicio $($s.Name) registrado en $($s.Dir)"
}

# El Sentinel arranca después de la API
& $nssm set CDP-Sentinel DependOnService CDP-API
