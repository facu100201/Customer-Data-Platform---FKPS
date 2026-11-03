<#
.SYNOPSIS
  Deja el puerto 80 abierto solo para la subred ZeroTier y bloquea desde fuera los puertos internos
  (API 3000, PostgreSQL 5432, Ollama 11434). Ejecutar como administrador.
.EXAMPLE
  .\firewall-zerotier.ps1 -ZtSubnet 10.147.20.0/24
#>
param(
  [Parameter(Mandatory = $true)][string]$ZtSubnet
)

$ErrorActionPreference = 'Stop'

# La regla del reporte de instalación abría el 80 a cualquier origen
Get-NetFirewallRule -DisplayName 'Apache HTTP 80' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName 'CDP Apache 80 (ZeroTier)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule -DisplayName 'CDP Apache 80 (ZeroTier)' -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 80 -RemoteAddress $ZtSubnet -Profile Any | Out-Null

foreach ($port in 3000, 5432, 11434) {
  $name = "CDP bloquear $port"
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Block -Protocol TCP -LocalPort $port -Profile Any | Out-Null
}

Write-Host "Puerto 80 abierto solo para $ZtSubnet; 3000, 5432 y 11434 bloqueados desde la red."
Get-NetFirewallRule -DisplayName 'CDP*' | Format-Table DisplayName, Direction, Action, Enabled
