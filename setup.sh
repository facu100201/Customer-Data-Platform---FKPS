#!/usr/bin/env bash
# Puesta en marcha local del CDP FKPS en Linux (entorno de desarrollo / sandbox).
#
#   bash /workspace/cdp/setup.sh
#
# Funciona como usuario normal o como root. PostgreSQL nunca corre como root: si el script se ejecuta
# como root, el clúster pertenece al usuario del sistema "postgres" (se crea si no existe).
#
# Es idempotente: se puede correr varias veces. No borra nada. No toca ZeroTier, Apache, Electron ni
# el Sentinel. Deja una base PostgreSQL 16 local con migraciones y seed, y los .env de desarrollo.
# No arranca la API ni la web; al final imprime cómo hacerlo.
set -euo pipefail

# --- Rutas (absolutas) --------------------------------------------------------------------------
REPO=/workspace/cdp
PG_BIN=/usr/lib/postgresql/16/bin
DEFAULT_PG_PORT=5432   # si está ocupado por otro servicio se usa el siguiente libre (5433…)

if [ "$(/usr/bin/id -u)" -eq 0 ]; then
  STATE_DIR=/var/lib/cdp-fkps                    # datos locales (root), fuera del repo
  PG_OS_USER=postgres                            # usuario sin privilegios dueño del clúster
else
  STATE_DIR="$HOME/.local/share/cdp-fkps"        # datos locales (usuario normal), fuera del repo
  PG_OS_USER=$(/usr/bin/id -un)
fi
PG_DATA="$STATE_DIR/pgdata"
PG_SOCK="$STATE_DIR/pgsock"
PG_LOG_DIR="$STATE_DIR/pglog"
PRISMA_STUBS="$STATE_DIR/prisma-engine-stubs"

# Credenciales locales: junto a los .env que se generan con ellas (ignorado por git: regla .env.*)
CREDENTIALS=/workspace/cdp/.env.setup
LEGACY_CREDENTIALS=/home/model/.local/share/cdp-fkps/credentials.env   # ubicación de la versión anterior
API_ENV=/workspace/cdp/backend/api/.env
DB_ENV=/workspace/cdp/db/.env
SIM_ENV=/workspace/cdp/backend/simulator/.env
PG_SETUP_SQL=/workspace/cdp/db/postgres/setup.sql
MIGRATIONS_DIR=/workspace/cdp/db/prisma/migrations

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
rand() { /usr/bin/openssl rand -hex "$1"; }
# Aplica una expresión de sed reescribiendo el archivo en su lugar: conserva dueño, permisos e inodo
# (sed -i crea un archivo nuevo; como root le cambiaría el dueño a un .env de otro usuario).
sed_in_place() {
  local out
  out=$(/usr/bin/sed "$2" "$1") && printf '%s\n' "$out" > "$1"
}

# Ejecuta un comando como el dueño del clúster (pg_ctl e initdb se niegan a correr como root)
as_pg() {
  if [ "$(/usr/bin/id -u)" -eq 0 ]; then
    (cd / && /usr/sbin/runuser -u "$PG_OS_USER" -- "$@")
  else
    "$@"
  fi
}
# Crea un directorio (si falta) que pertenece al dueño del clúster
pg_dir() {
  if [ "$(/usr/bin/id -u)" -eq 0 ]; then
    /usr/bin/install -d -m "$2" -o "$PG_OS_USER" -g "$(/usr/bin/id -gn "$PG_OS_USER")" "$1"
  else
    /usr/bin/install -d -m "$2" "$1"
  fi
}

# --- 1. Requisitos -------------------------------------------------------------------------------
log "Comprobando requisitos"
NODE_MAJOR=$(/usr/bin/node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || die "Se necesita Node.js >= 22 (hay $(/usr/bin/node -v))"
[ -x "$PG_BIN/initdb" ] && [ -x "$PG_BIN/pg_ctl" ] || die "No se encontró PostgreSQL 16 en $PG_BIN"
if [ "$(/usr/bin/id -u)" -eq 0 ]; then
  [ -x /usr/sbin/runuser ] || die "Como root se necesita /usr/sbin/runuser (util-linux)"
  if ! /usr/bin/id -u "$PG_OS_USER" >/dev/null 2>&1; then
    log "Creando el usuario de sistema '$PG_OS_USER' para PostgreSQL"
    /usr/sbin/useradd --system --user-group --no-create-home --home-dir "$STATE_DIR" \
      --shell /usr/sbin/nologin "$PG_OS_USER"
  fi
  echo "ejecutando como root: PostgreSQL correrá como '$PG_OS_USER'"
fi
echo "node $(/usr/bin/node -v) · npm $(/usr/bin/npm -v) · $("$PG_BIN/postgres" --version)"
echo "datos locales: $STATE_DIR"

# --- 2. Dependencias -----------------------------------------------------------------------------
# Este entorno solo alcanza registry.npmjs.org:
#  - Electron descarga su binario desde GitHub en el postinstall. No hace falta para la web ni la API,
#    así que se omite la descarga (no se modifica nada de Electron).
#  - Prisma usa engineType = "client" (sin motor nativo). Aun así, el CLI de Prisma 6 intenta
#    descargar los motores de binaries.prisma.sh al arrancar, aunque `prisma generate` no los use.
#    Se le pasan archivos vacíos para que no los descargue. `prisma migrate deploy` sí necesitaría
#    el motor real, por eso las migraciones se aplican con psql más abajo.
log "Instalando dependencias (npm ci)"
/usr/bin/install -d -m 755 "$STATE_DIR" "$PRISMA_STUBS"
/usr/bin/touch "$PRISMA_STUBS/libquery_engine.so.node" "$PRISMA_STUBS/schema-engine"
/usr/bin/chmod +x "$PRISMA_STUBS/schema-engine"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export PRISMA_QUERY_ENGINE_LIBRARY="$PRISMA_STUBS/libquery_engine.so.node"
export PRISMA_SCHEMA_ENGINE_BINARY="$PRISMA_STUBS/schema-engine"
export PRISMA_HIDE_UPDATE_MESSAGE=1
cd "$REPO"
/usr/bin/npm ci --no-audit --no-fund   # el postinstall de @cdp/db corre `prisma generate`

# --- 3. Credenciales locales (se generan una sola vez) -------------------------------------------
if [ ! -f "$CREDENTIALS" ] && [ -f "$LEGACY_CREDENTIALS" ]; then
  log "Copiando credenciales de $LEGACY_CREDENTIALS a $CREDENTIALS"
  /usr/bin/install -m 600 "$LEGACY_CREDENTIALS" "$CREDENTIALS"
fi
if [ ! -f "$CREDENTIALS" ]; then
  log "Generando credenciales locales en $CREDENTIALS"
  (
    umask 077
    cat > "$CREDENTIALS" <<EOF
# Generado por setup.sh. Solo para desarrollo local; no se sube a git (regla .env.* de .gitignore).
MIGRATOR_PASSWORD=$(rand 16)
APP_PASSWORD=$(rand 16)
JWT_SECRET=$(rand 32)
IDENTITY_PEPPER=$(rand 24)
SIM_SOURCE_KEY=sim_$(rand 16)
SEED_USUARIO_PASSWORD=usuario-$(rand 6)
SEED_ADMIN_PASSWORD=admin-$(rand 6)
SEED_SUPER_PASSWORD=super-$(rand 6)
SEED_QA_PASSWORD=qa-$(rand 6)
EOF
  )
fi
# shellcheck disable=SC1090
. "$CREDENTIALS"
PG_PORT=${PG_PORT:-$DEFAULT_PG_PORT}   # tras la primera ejecución queda guardado en $CREDENTIALS

# --- 4. PostgreSQL 16 local (como usuario sin privilegios) ---------------------------------------
pg_url() { echo "postgresql://$1:$2@127.0.0.1:$3/cdp"; }
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# PGCONNECT_TIMEOUT: si el puerto lo tiene algo que no es PostgreSQL, psql no se queda esperando
is_cdp_db() {
  PGCONNECT_TIMEOUT=5 /usr/bin/psql "$(pg_url cdp_migrator "$MIGRATOR_PASSWORD" "$1")" -qAt -c 'SELECT 1' >/dev/null 2>&1
}
own_cluster_running() {
  [ -f "$PG_DATA/PG_VERSION" ] && as_pg "$PG_BIN/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1
}

REUSED_SERVER=false
if own_cluster_running; then
  PG_PORT=$(/usr/bin/sed -n 4p "$PG_DATA/postmaster.pid")   # puerto con el que ya está corriendo
elif port_in_use "$PG_PORT"; then
  if is_cdp_db "$PG_PORT"; then
    # Típico: setup.sh ya corrió como otro usuario (p. ej. sin root) y dejó arriba su base del CDP
    # con estas mismas credenciales. Se reutiliza en vez de crear una segunda base en otro puerto.
    REUSED_SERVER=true
    log "Ya hay una base del CDP con estas credenciales en 127.0.0.1:$PG_PORT; se reutiliza"
  else
    log "El puerto $PG_PORT está ocupado por otro servicio (no es la base del CDP de este equipo)"
    /usr/bin/ss -ltnp "sport = :$PG_PORT" 2>/dev/null | /usr/bin/tail -n +2 || true
    busy=$PG_PORT
    PG_PORT=""
    for p in $(/usr/bin/seq 5433 5499); do
      if ! port_in_use "$p"; then PG_PORT=$p; break; fi
    done
    [ -n "$PG_PORT" ] || die "El puerto $busy está ocupado y no hay ninguno libre entre 5433 y 5499"
    echo "se usará 127.0.0.1:$PG_PORT (queda guardado en $CREDENTIALS)"
  fi
fi

# Guarda el puerto para que las siguientes ejecuciones y los .env usen el mismo
if ! /usr/bin/grep -q '^PG_PORT=' "$CREDENTIALS"; then
  printf 'PG_PORT=%s\n' "$PG_PORT" >> "$CREDENTIALS"
elif [ "$(/usr/bin/sed -n 's/^PG_PORT=//p' "$CREDENTIALS" | /usr/bin/tail -n 1)" != "$PG_PORT" ]; then
  sed_in_place "$CREDENTIALS" "s/^PG_PORT=.*/PG_PORT=$PG_PORT/"
fi
APP_URL=$(pg_url cdp_app "$APP_PASSWORD" "$PG_PORT")
MIGRATOR_URL=$(pg_url cdp_migrator "$MIGRATOR_PASSWORD" "$PG_PORT")

if [ "$REUSED_SERVER" = false ]; then
  pg_dir "$PG_SOCK" 755
  pg_dir "$PG_LOG_DIR" 700
  if [ ! -f "$PG_DATA/PG_VERSION" ]; then
    log "Creando clúster de PostgreSQL en $PG_DATA (dueño: $PG_OS_USER)"
    pg_dir "$PG_DATA" 700
    as_pg "$PG_BIN/initdb" -D "$PG_DATA" -U postgres -E UTF8 --auth-local=trust --auth-host=scram-sha-256 >/dev/null
  fi
  if ! own_cluster_running; then
    log "Arrancando PostgreSQL en 127.0.0.1:$PG_PORT (usuario $PG_OS_USER)"
    if ! as_pg "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$PG_LOG_DIR/postgres.log" -w \
      -o "-c listen_addresses=127.0.0.1 -p $PG_PORT -c unix_socket_directories=$PG_SOCK" start; then
      echo "--- últimas líneas de $PG_LOG_DIR/postgres.log:" >&2
      /usr/bin/tail -n 20 "$PG_LOG_DIR/postgres.log" >&2 || true
      die "PostgreSQL no arrancó; el motivo está en el log de arriba ($PG_LOG_DIR/postgres.log)"
    fi
  fi
  # Superusuario de la base por socket local (auth trust solo por socket; TCP pide contraseña)
  PSQL_SUPER=(/usr/bin/psql -h "$PG_SOCK" -p "$PG_PORT" -U postgres -v ON_ERROR_STOP=1 -qAt)

  # Roles cdp_migrator / cdp_app y base cdp, con el script del repo (el mismo que en el servidor)
  if [ "$("${PSQL_SUPER[@]}" -d postgres -c "SELECT 1 FROM pg_roles WHERE rolname = 'cdp_migrator'")" != "1" ]; then
    log "Creando roles y base de datos (db/postgres/setup.sql)"
    "${PSQL_SUPER[@]}" -d postgres -v migrator_password="$MIGRATOR_PASSWORD" -v app_password="$APP_PASSWORD" \
      -f "$PG_SETUP_SQL"
  fi
fi

# --- 5. Archivos .env (no se sobrescriben si ya existen; están en .gitignore) --------------------
write_env() {
  local file=$1
  if [ -f "$file" ]; then echo "ya existe: $file (no se modifica)"; return; fi
  (umask 077 && cat > "$file")
  echo "creado: $file"
}
log "Archivos .env de desarrollo"
write_env "$API_ENV" <<EOF
DATABASE_URL=$APP_URL
HOST=127.0.0.1
PORT=3000
JWT_SECRET=$JWT_SECRET
IDENTITY_PEPPER=$IDENTITY_PEPPER
COOKIE_SECURE=false
EOF
write_env "$DB_ENV" <<EOF
DATABASE_URL=$APP_URL
SEED_USUARIO_EMAIL=usuario@fkps.local
SEED_USUARIO_PASSWORD=$SEED_USUARIO_PASSWORD
SEED_ADMIN_EMAIL=admin@fkps.local
SEED_ADMIN_PASSWORD=$SEED_ADMIN_PASSWORD
SEED_SUPER_EMAIL=super@fkps.local
SEED_SUPER_PASSWORD=$SEED_SUPER_PASSWORD
SEED_QA_EMAIL=qa@fkps.local
SEED_QA_PASSWORD=$SEED_QA_PASSWORD
SIM_SOURCE_KEY=$SIM_SOURCE_KEY
EOF
write_env "$SIM_ENV" <<EOF
CDP_URL=http://127.0.0.1:3000
SIM_SOURCE_KEY=$SIM_SOURCE_KEY
EOF
# Si el puerto cambió, se actualiza solo la línea DATABASE_URL que generó este script (misma
# contraseña, otro puerto). Cualquier valor escrito a mano no se toca.
GENERATED_URL_RE="^DATABASE_URL=postgresql://cdp_app:${APP_PASSWORD}@127\.0\.0\.1:[0-9]*/cdp\$"
for f in "$API_ENV" "$DB_ENV"; do
  if /usr/bin/grep -q "$GENERATED_URL_RE" "$f" && ! /usr/bin/grep -qx "DATABASE_URL=$APP_URL" "$f"; then
    sed_in_place "$f" "s#$GENERATED_URL_RE#DATABASE_URL=$APP_URL#"
    echo "actualizado: puerto $PG_PORT en DATABASE_URL de $f"
  fi
done

# --- 6. Comprobación de credenciales ------------------------------------------------------------
# Si los .env o los roles vienen de otra ejecución con otras contraseñas, se avisa aquí con claridad.
env_value() { /usr/bin/sed -n "s/^$2=//p" "$1" | /usr/bin/tail -n 1; }
for f in "$API_ENV" "$DB_ENV"; do
  url=$(env_value "$f" DATABASE_URL)
  /usr/bin/psql "$url" -qAt -c 'SELECT 1' >/dev/null 2>&1 ||
    die "DATABASE_URL de $f no conecta. Sus credenciales no coinciden con $CREDENTIALS; corrige o renombra ese .env y vuelve a correr el script."
done
/usr/bin/psql "$MIGRATOR_URL" -qAt -c 'SELECT 1' >/dev/null 2>&1 ||
  die "cdp_migrator no conecta con la contraseña de $CREDENTIALS (el clúster $PG_DATA se creó con otras credenciales)."

# --- 7. Migraciones ------------------------------------------------------------------------------
# Equivalente a `prisma migrate deploy`: aplica cada migration.sql pendiente como cdp_migrator y la
# registra en _prisma_migrations con el mismo checksum (SHA-256) que usa Prisma, para que un
# `prisma migrate deploy` posterior con el motor real las reconozca como aplicadas.
log "Aplicando migraciones"
export PGOPTIONS='-c client_min_messages=warning'   # sin los NOTICE de "ya existe"
PSQL_MIGRATOR=(/usr/bin/psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -qAt)
"${PSQL_MIGRATOR[@]}" -c 'CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)'
for dir in "$MIGRATIONS_DIR"/*/; do
  name=$(/usr/bin/basename "$dir")
  file="${dir}migration.sql"
  [ -f "$file" ] || continue
  checksum=$(/usr/bin/sha256sum "$file" | /usr/bin/cut -d' ' -f1)
  applied=$("${PSQL_MIGRATOR[@]}" -c "SELECT checksum FROM _prisma_migrations
    WHERE migration_name = '$name' AND finished_at IS NOT NULL AND rolled_back_at IS NULL")
  if [ -n "$applied" ]; then
    [ "$applied" = "$checksum" ] || die "La migración $name ya aplicada cambió de contenido"
    echo "ya aplicada: $name"
    continue
  fi
  /usr/bin/psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$file" \
    -c "INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
        VALUES (gen_random_uuid(), '$checksum', '$name', now(), 1)"
  echo "aplicada: $name"
done
unset PGOPTIONS

# --- 8. Seed -------------------------------------------------------------------------------------
log "Seed (usuarios iniciales, fuente del simulador, segmento de ejemplo)"
/usr/bin/npm run seed -w @cdp/db

log "Listo"
cat <<EOF
$(if [ "$REUSED_SERVER" = true ]; then
  echo "PostgreSQL 16: 127.0.0.1:$PG_PORT (servidor que ya estaba arriba; lo administra quien lo arrancó)"
else
  echo "PostgreSQL 16: 127.0.0.1:$PG_PORT, usuario del sistema '$PG_OS_USER'"
  echo "  datos: $PG_DATA · log: $PG_LOG_DIR/postgres.log"
fi)
Contraseñas locales: $CREDENTIALS

  cd $REPO && npm run dev:api       # API  http://127.0.0.1:3000
  cd $REPO && npm run dev:web       # Web  http://127.0.0.1:5173
  cd $REPO && npm run sim -- --terminals 10 --minutes 1   # datos sintéticos (con la API arriba)
  cd $REPO && npm run typecheck && npm test

Usuarios: usuario@fkps.local, qa@fkps.local, admin@fkps.local, super@fkps.local
$(if [ "$REUSED_SERVER" = false ]; then
  echo "Para detener PostgreSQL: $( [ "$(/usr/bin/id -u)" -eq 0 ] && echo "/usr/sbin/runuser -u $PG_OS_USER -- ")$PG_BIN/pg_ctl -D $PG_DATA stop"
fi)
EOF
