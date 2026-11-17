# Credenciales de prueba

> **Entorno de prueba.** Estos usuarios y contraseñas son públicos a propósito: sirven para
> desarrollo local, el sandbox de revisión y las pruebas E2E. No dan acceso a ningún dato real.
> En el servidor del equipo se usan contraseñas propias, y estas se van a rotar al cerrar el proyecto.

| Rol | Correo | Contraseña |
|---|---|---|
| Usuario | `usuario@fkps.local` | `Prueba-Usuario-2026` |
| QA | `qa@fkps.local` | `Prueba-QA-2026` |
| Administrador | `admin@fkps.local` | `Prueba-Admin-2026` |
| Superusuario | `super@fkps.local` | `Prueba-Super-2026` |

El dominio `.local` está reservado y no recibe correo, así que estas cuentas no existen fuera del CDP.

## De dónde salen

- `bash setup.sh` las escribe en `.env.setup` y en `db/.env`, y el seed crea los cuatro usuarios.
- `.env.example` trae los mismos valores, para quien levante el proyecto a mano.
- `e2e/helpers.ts` las usa por defecto si no hay variables `SEED_*_PASSWORD` en el entorno.

## Qué puede hacer cada rol

| Rol | Ve | No ve |
|---|---|---|
| Usuario | Dashboard, Clientes 360 (sin PII), Segmentos, Activaciones, Terminales | Simulador, Identidades, Seguridad, QA |
| QA | Lo de Usuario + Simulador (solo clientes sintéticos) y QA y auditoría | PII, Identidades, Seguridad |
| Administrador | Todo lo anterior con PII, Identidades, Seguridad | Gestión de roles y purga de datos |
| Superusuario | Todo | — |

## Si ya habías corrido setup.sh antes

El seed solo pone la contraseña cuando **crea** el usuario. Si la base ya existía con otras contraseñas,
cambiar `.env.setup` no las actualiza. Para empezar de cero en el sandbox: borra `.env.setup` y la carpeta
de datos de PostgreSQL que indica el script, y vuelve a correr `bash setup.sh`.
