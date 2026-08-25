#!/bin/sh
set -eu

if [ "${TOKKIE_SECURITY_TEST_DATABASE_URL:-}" = "" ]; then
  echo "TOKKIE_SECURITY_TEST_DATABASE_URL must name an empty disposable PostgreSQL database" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# A second pass against the same database proves that the harness/schema setup
# is retry-safe. Test identities and fixtures are enclosed in BEGIN/ROLLBACK.
psql "$TOKKIE_SECURITY_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$script_dir/security-test.sql"
exec psql "$TOKKIE_SECURITY_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$script_dir/security-test.sql"
