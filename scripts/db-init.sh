#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --set=app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE sillage LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE sillage OWNER sillage;
SQL
