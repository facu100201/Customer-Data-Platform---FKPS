En este proyecto debemos elaborar un CDP, accediendo a un servidor apache a través de ZeroTier y utilizando el concepto de dumb terminal para simular conexiones de hasta más de 20 dispositivos. Debes inicializar el repo https://github.com/facu100201/Customer-Data-Platform---FKPS  

Un Customer Data Platform (CDP) es un software empaquetado que crea una base de datos de clientes unificada y persistente, accesible para otros sistemas, con el fin de analizar, segmentar y automatizar interacciones personalizadas en tiempo real.
A continuación, se detalla el ciclo completo de lo que hace un CDP dividido en sus cuatro capacidades fundamentales:

1. Recolección de datos (Ingesta masiva)

Un CDP se conecta a todas las fuentes de información de tu empresa, tanto online como offline, para capturar datos en tiempo real y de forma histórica.
• Datos de comportamiento: Clics en la web, descargas en la app, carritos abandonados o videos vistos.
• Datos transaccionales: Compras en tiendas físicas o e-commerce, devoluciones y renovaciones de suscripciones.
• Datos de perfil: Correos electrónicos, números de teléfono, nombres y preferencias guardadas en el CRM.
• Datos operativos: Interacciones con tickets de soporte técnico, chats en vivo o datos de envío.

2. Unificación de identidad (Identity Resolution)

Esta es la función más crítica de un CDP. Elimina los silos de información uniendo los fragmentos de datos de un mismo usuario mediante algoritmos de coincidencia deterministas (coincidencias exactas como el email) o probabilísticos (predicciones basadas en comportamiento e IP).
• El problema: Un usuario navega anónimo en su teléfono, luego compra desde su laptop usando un correo y días después llama a soporte.
• La solución del CDP: Identifica que todos esos puntos pertenecen a la misma persona y los fusiona en un perfil único y centralizado (Visión 360 del cliente) que se actualiza constantemente.

3. Segmentación y Analítica

Una vez que los perfiles están unificados, el CDP permite crear audiencias dinámicas y personalizadas sin necesidad de que intervenga el equipo de TI o programadores.
• Segmentos inteligentes: Puedes agrupar usuarios bajo criterios específicos (por ejemplo: "Usuarios que gastaron más de $100 USD en el último mes pero no han abierto la app en 14 días").
• Modelos predictivos: Muchos CDP modernos calculan el valor del ciclo de vida del cliente (CLV), la probabilidad de abandono (churn rate) o la propensión de compra utilizando inteligencia artificial.

4. Activación de datos (Orquestación)

El CDP no es una herramienta para enviar correos o poner anuncios, sino el "cerebro" que da las instrucciones a los canales que sí lo hacen. Distribuye los perfiles y segmentos unificados hacia tu ecosistema de herramientas externas:
• Marketing automatizado: Envía un correo con un cupón personalizado mediante Salesforce o HubSpot inmediatamente después de que el CDP detecte un comportamiento de abandono.
• Publicidad digital: Exporta audiencias a Meta Ads o Google Ads para hacer retargeting hiperespecífico o excluir a quienes ya compraron el producto.
• Personalización web: Cambia el banner de inicio de tu sitio web en tiempo real para mostrar productos basados en el historial unificado del visitante.

Sugerencia de arquitectura del profesor: 

Capa
Tecnología
Responsabilidad
Interfaz
React + Vite
Formularios, controles y dashboard
Diseño
Tailwind CSS
Interfaz adaptable y profesional
Simulación
JavaScript / TypeScript
Motor de cálculo independiente
Visualización
Recharts
Gráficos, tendencias y escenarios
Datos locales
IndexedDB
Guardar simulaciones en el dispositivo
Datos compartidos
Firebase o Supabase
Usuarios, proyectos e historial
Pruebas
Vitest + Playwright
Comprobar cálculos y funcionamiento
Repositorio
GitHub
Versionamiento y colaboración
Web
Vercel
Despliegue de la aplicación
Escritorio
Tauri o Electron
Empaquetar una aplicación instalable
Estructura del repositoriosimulador-empresarial/
├── docs/
│ ├── problema.md
│ ├── modelo-matematico.md
│ ├── arquitectura.md
│ └── rubrica.md
├── src/
│ ├── components/
│ ├── pages/
│ ├── simulators/
│ │ ├── inventarios/
│ │ ├── hoteleria/
│ │ ├── marketing/
│ │ └── infraestructura/
│ ├── engine/
│ ├── services/
│ ├── hooks/
│ ├── styles/
│ └── tests/
├── public/
├── package.json
└── README.md

USAR: Node.js, React.js, Electron para empaquetar, Ollama para gestionar y monitorear la ciberseguridad con un modelo local, Pipeline de CI/CD --> Claude para diseñar la lógica - Codex para desarrollar el código backend - Obsidian para elaborar un .md de revisión y reporteo - Claude nuevamente para confirmar y asegurar la calidad y coherencia del código y sistema - Github actions para despliegue, tests, lint, auditorias, etc. 


4 usuarios iniciales: usuario, admin, superusuario, y QA

Debes proponer una arquitectura final con todo lo anterior discutido, base de datos, etc. 

# REPORTE DE INSTALACIÓN, CONFIGURACIÓN Y ENDURECIMIENTO DE SERVIDOR WEB APACHE 2.4

**Fecha:** 03 de noviembre de 2026

**Equipo:** FKPS

**Integrantes:**

1. Pamela Ruíz Velasco - Matrícula: 240186

2. Ana Karen López Jiménez - Matrícula: 240187

3. Fernando Acuña Martínez - Matrícula: 240191

4. Frida Sofía Escamilla Olguín - Matrícula: 240165

## PARTE 1. VERIFICACIÓN DE REQUISITOS (15 puntos)

**Comandos ejecutados:**

* `systeminfo | findstr /C:"Nombre del sistema operativo" /C:"Tipo de sistema"`

* `systeminfo | findstr /C:"Memoria física disponible"`

* `vol C:` (Alternativa a wmic por deprecación en Windows 11)

* `netstat -ano | findstr :80`

* `netstat -ano | findstr :443`

* `net session` (Para confirmar permisos de administrador)

**Análisis de incidencias:** Al ejecutar `netstat`, se detectó que el puerto 80 estaba ocupado por el PID 4 (Servicio System / IIS World Wide Web Publishing).

**Solución propuesta y aplicada:** Se ejecutó `net stop W3SVC` para detener el servicio en conflicto y liberar el puerto para Apache.

**Tabla de Evidencia:**

| Requisito | Valor Encontrado | ¿Cumple? | Observación / Solución | 
| ----- | ----- | ----- | ----- | 
| SO y Arquitectura | Windows 11 Pro x64 | Sí | Cumple con requisitos de 64 bits. | 
| RAM Libre | \~2,456 MB | Sí | Supera el mínimo de 1-2 GB requerido. | 
| Espacio en Disco | \~240 GB libres | Sí | Ampliamente suficiente para la práctica. | 
| Puerto 80 Libre | Ocupado por PID 4 | No (Inicialmente) | Solucionado: `net stop W3SVC`. | 
| Puerto 443 Libre | Libre | Sí | No hay procesos escuchando. | 
| Permisos de Admin | Usuario en grupo Admin | Sí | Confirmado con `net session`. | 
| VC++ Redistributable | VS 2015-2022 (x64) | Sí | Requerido por compilación VS18 de Apache Lounge. | 

*(Espacio para rúbrica del docente: \______\_)*

## PARTE 2. INSTALACIÓN (20 puntos)

**Opción seleccionada:** Opción B (Windows)

**Comandos ejecutados:**

1. Verificación de integridad: `certutil -hashfile C:\httpd-2.4.69-261002-Win64-VS18.zip SHA256`

2. Descompresión: `tar -xf C:\httpd-2.4.69-261002-Win64-VS18.zip -C C:\`

3. Renombrado: `ren C:\httpd-2.4.69-261002-Win64-VS18 Apache24`

4. Versión: `C:\Apache24\bin\httpd.exe -v`

5. Instalación de servicio: `C:\Apache24\bin\httpd.exe -k install`

6. Inicio de servicio: `C:\Apache24\bin\httpd.exe -k start`

7. Estado: `sc query Apache2.4`

**Salida de versión:** `Server version: Apache/2.4.69 (Win64)`

**Estado del servicio:** `STATE : 4 RUNNING`

**Respuesta a la pregunta de la Parte 2:**

Instalé la versión 2.4.69 (compilación de Apache Lounge). Aunque la documentación menciona la 2.4.68 como referencia, Apache Lounge actualiza sus binarios con las últimas revisiones de seguridad y compatibilidad con Visual Studio (VS18). Al ser una compilación oficial de terceros actualizada, incluye los últimos parches, por lo que **no representa ningún riesgo de seguridad**, sino una mejora.

*(Espacio para rúbrica del docente: \______\_)*

## PARTE 3. CONFIGURACIÓN MÍNIMA (20 puntos)

**Archivo modificado:** `C:\Apache24\conf\httpd.conf`

**Valores documentados:**

* `ServerRoot "c:/Apache24"`

* `Listen 80`

* `DocumentRoot "c:/Apache24/htdocs"`

**Fragmento de configuración modificado (Antes y Después):**

```
# ANTES:
#ServerName www.example.com:80

# DESPUÉS:
ServerName localhost:80

```

**Pasos adicionales:**

* **Creación de `index.html`:** Se creó `C:\Apache24\htdocs\index.html` con nombre, matrícula y fecha del examen.

* **Validación de sintaxis:**

  ```
  C:\Apache24\bin\httpd.exe -t
  
  ```

  *Salida:* `Syntax OK`

* **Reinicio del servicio:** `C:\Apache24\bin\httpd.exe -k restart`

*(Espacio para rúbrica del docente: \______\_)*

## PARTE 4. PRUEBAS DE FUNCIONAMIENTO (15 puntos)

1. **Navegador:** Se accedió a `http://localhost` y se visualizó correctamente la página con los datos del equipo.

2. **Prueba Curl:**

   ```
   curl.exe -I http://localhost
   
   ```

   *Salida:* `HTTP/1.1 200 OK` y `Server: Apache/2.4.69 (Win64)`

3. **Firewall:** Se ejecutó `netsh advfirewall firewall add rule name="Apache HTTP 80" dir=in action=allow protocol=TCP localport=80`.

4. **Acceso desde otro equipo mediante Red Virtual (ZeroTier):**

   Para cumplir con el requisito de acceso remoto sin exponer el servidor a internet ni configurar NAT en el router, se implementó una red virtual privada con **ZeroTier**:

   * **Instalación y unión:** En los equipos clientes se instaló ZeroTier One y se unieron a la red ejecutando: `zerotier-cli join [ID_DE_RED]`.

   * **Autorización:** Desde el panel de ZeroTier Central, el administrador autorizó los dispositivos (marcando la casilla "Auth").

   * **Prueba de acceso:** Desde otro equipo autorizado, se accedió al servidor Apache usando la IP virtual gestionada (ej. `http://10.147.20.5`), visualizando correctamente el `index.html`. Esto demuestra que el tráfico fluye de forma segura y cifrada a través de la VLAN virtual.

5. **Registros (Logs):**

   * **Acceso:** `powershell -command "Get-Content C:\Apache24\logs\access_log -Tail 3"`

     *Salida:* `::1 - - [03/Nov/2026:...] "GET / HTTP/1.1" 200`

   * **Error:** `powershell -command "Get-Content C:\Apache24\logs\error_log -Tail 3"`

     *Salida:* `[notice] AH00456: Apache Lounge VS18 Server built... resuming normal operations.`

*(Espacio para rúbrica del docente: \______\_)*

## PARTE 5. ENDURECIMIENTO BÁSICO (15 puntos)

**Cambios en `C:\Apache24\conf\httpd.conf`:**

1. Al final del archivo se agregó:

   ```
   ServerTokens Prod
   ServerSignature Off
   
   ```

2. En el bloque `<Directory "c:/Apache24/htdocs">` se modificó:

   ```
   # ANTES: Options Indexes FollowSymLinks
   # DESPUÉS:
   Options -Indexes
   
   ```

**Prueba de 403 Forbidden:**

Se creó la carpeta `C:\Apache24\htdocs\prueba` (sin `index.html`). Al acceder a `http://localhost/prueba` en el navegador, Apache respondió correctamente con el error **403 Forbidden**, ocultando el listado de archivos.

**Comparación de cabeceras (Curl después del endurecimiento):**

```
curl.exe -I http://localhost

```

*Salida:* `HTTP/1.1 200 OK` y `Server: Apache`

*Análisis:* La cabecera ya no revela la versión (`2.4.69`) ni el sistema operativo (`Win64`), cumpliendo con `ServerTokens Prod`.

*(Espacio para rúbrica del docente: \______\_)*

## PARTE 6. PREGUNTAS DE ANÁLISIS (15 puntos)

1. **¿Por qué no debe usarse la rama 2.2 de Apache en un centro de datos?**

   La rama 2.2 alcanzó su fin de vida (EOL) en 2017 y ya no recibe parches de seguridad ni soporte oficial. Usarla expone al centro de datos a vulnerabilidades conocidas sin mitigación, violando normativas de cumplimiento y auditoría.

2. **Si compilas Apache desde el código fuente, ¿qué dependencias necesitas?**

   Se requieren: APR y APR-Util (mín. 1.4.x) para portabilidad entre SO; un compilador (GCC o MSVC) para generar binarios; PCRE2 para expresiones regulares (ej. `mod_rewrite`); y OpenSSL para habilitar cifrado TLS/SSL.

3. **¿Qué necesitarías para publicar este servidor en internet?**

   Se requiere una IP pública estática o DNS dinámico (DDNS) vinculado a un dominio. Además, configurar redirección de puertos (NAT) en el router (80/443) y obtener un certificado TLS (ej. Let's Encrypt) para cifrar el tráfico.

4. **¿Por qué XAMPP o WampServer sirven para practicar, pero no para producción?**

   Porque vienen con ajustes de seguridad relajados (ej. contraseñas vacías), incluyen servicios innecesarios que amplían la superficie de ataque, y no están optimizados para el rendimiento, escalabilidad o monitoreo de un entorno real.

5. **Diferencia entre mod_php y PHP-FPM con mod_proxy_fcgi.**

   `mod_php` incrusta el intérprete en cada proceso de Apache, consumiendo más memoria. `PHP-FPM` ejecuta PHP como servicio independiente, gestionando mejor los procesos y la memoria, mejorando el rendimiento y la estabilidad.

## CONCLUSIÓN DEL EQUIPO

Durante la práctica, identificamos que el puerto 80 estaba ocupado por el servicio IIS (PID 4), lo cual resolvimos deteniendo el servicio `W3SVC` antes de iniciar Apache. También enfrentamos un detalle al extraer el binario de Apache Lounge, que se resolvió verificando la estructura interna del ZIP y renombrando la carpeta al estándar `Apache24`. Aprendimos que validar la sintaxis con `httpd -t` antes de reiniciar es crítico para evitar caídas del servicio. Finalmente, la configuración de endurecimiento y la integración con ZeroTier nos permitieron comprender cómo minimizar la huella digital del servidor y conectarlo de forma segura en una red virtual.


tambien revisa esto 