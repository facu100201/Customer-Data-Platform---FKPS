-- Crea la base del CDP con dos roles:
--   cdp_migrator: dueño del esquema, solo lo usa el despliegue para correr migraciones
--   cdp_app:      el que usa la API en runtime, solo SELECT/INSERT/UPDATE/DELETE
--
-- Ejecutar una sola vez como superusuario de PostgreSQL:
--   psql -U postgres -v migrator_password='...' -v app_password='...' -f infra/postgres/setup.sql
--
-- Además, en postgresql.conf:   listen_addresses = 'localhost'
-- y en pg_hba.conf deja solo:
--   host  cdp  cdp_app       127.0.0.1/32  scram-sha-256
--   host  cdp  cdp_migrator  127.0.0.1/32  scram-sha-256

\set ON_ERROR_STOP on

CREATE ROLE cdp_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE cdp_app LOGIN PASSWORD :'app_password';

CREATE DATABASE cdp OWNER cdp_migrator ENCODING 'UTF8' TEMPLATE template0;

\connect cdp

ALTER SCHEMA public OWNER TO cdp_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cdp_app;

-- Las tablas que creen las migraciones quedan accesibles para la API automáticamente
ALTER DEFAULT PRIVILEGES FOR ROLE cdp_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cdp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cdp_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cdp_app;
