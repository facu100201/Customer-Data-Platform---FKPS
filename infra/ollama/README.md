# Ollama en el servidor del CDP

El Sentinel usa un modelo local para clasificar hallazgos de seguridad. Ollama corre en el mismo equipo que Apache y solo escucha en `127.0.0.1:11434`, así que los logs nunca salen del servidor.

## Instalación (Windows)

```powershell
winget install Ollama.Ollama
ollama pull llama3.2:3b
```

`llama3.2:3b` pesa unos 2 GB y responde en pocos segundos en CPU. El reporte de instalación registró unos 2.4 GB de RAM libre en el servidor, así que no conviene un modelo más grande. Si el equipo tiene GPU o más memoria, `qwen2.5:7b` clasifica mejor. Para cambiarlo, edita `OLLAMA_MODEL` en `C:\cdp\config\sentinel.env`.

## Comprobar que no está expuesto

```powershell
netstat -ano | findstr :11434
```

Debe aparecer `127.0.0.1:11434`, nunca `0.0.0.0:11434`. No definas `OLLAMA_HOST=0.0.0.0`. El script `infra/windows/firewall-zerotier.ps1` también bloquea el puerto 11434 desde la red.

## Prueba rápida

```powershell
curl.exe http://127.0.0.1:11434/api/generate -d '{\"model\":\"llama3.2:3b\",\"prompt\":\"responde ok\",\"stream\":false}'
```

Si Ollama está apagado, el Sentinel no se detiene: guarda la alerta con la severidad de las reglas y `model = "reglas"`.
