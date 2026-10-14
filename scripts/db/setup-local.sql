-- BiomedIntel.ai — LOCAL DEVELOPMENT database setup.
-- Run ONCE as the PostgreSQL superuser on your own computer:
--   psql -h localhost -U postgres -f scripts/db/setup-local.sql
--
-- It creates two roles and two databases:
--   biomedintel_owner  owns the tables, runs migrations and seed scripts.
--                      Has BYPASSRLS so migrations and seeding can see all rows.
--                      Never used by the running web application.
--   biomedintel_app    used by the running web application. NOBYPASSRLS, so every
--                      query on tenant tables is filtered by Row-Level Security.
--
-- The passwords below are LOCAL DEVELOPMENT placeholders only. Never reuse them
-- for a shared, staging or production database.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'biomedintel_owner') THEN
    CREATE ROLE biomedintel_owner LOGIN PASSWORD 'local_owner_password' CREATEDB BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'biomedintel_app') THEN
    CREATE ROLE biomedintel_app LOGIN PASSWORD 'local_app_password' NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

SELECT 'CREATE DATABASE biomedintel_dev OWNER biomedintel_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'biomedintel_dev')\gexec

SELECT 'CREATE DATABASE biomedintel_test OWNER biomedintel_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'biomedintel_test')\gexec

GRANT CONNECT ON DATABASE biomedintel_dev TO biomedintel_app;
GRANT CONNECT ON DATABASE biomedintel_test TO biomedintel_app;
