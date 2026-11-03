<#
.SYNOPSIS
  Detiene IIS y evita que vuelva a ocupar el puerto 80 al reiniciar. "net stop W3SVC" del reporte
  solo lo detiene hasta el siguiente arranque. Ejecutar como administrador.
#>
$ErrorActionPreference = 'Stop'

$svc = Get-Service -Name W3SVC -ErrorAction SilentlyContinue
if (-not $svc) {
  Write-Host 'IIS (W3SVC) no está instalado.'
  exit 0
}
Stop-Service W3SVC -Force
Set-Service W3SVC -StartupType Disabled
Get-Service W3SVC | Format-Table Name, Status, StartType

Write-Host 'Puerto 80:'
netstat -ano | Select-String ':80 '
