#!/usr/bin/env bash
# Smoke tests for bin/azeron. The unit tests cover the library; this checks the CLI
# actually starts from the built artifact and reports failure with a non-zero exit code.
set -uo pipefail
cd "$(dirname "$0")/../.."

fails=0
check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "ok   $name"
  else
    echo "FAIL $name (exit $?)"
    fails=$((fails + 1))
  fi
}
check_fails() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "FAIL $name (expected non-zero exit)"
    fails=$((fails + 1))
  else
    echo "ok   $name"
  fi
}

check "azeron --help" ./bin/azeron --help
check "azeron lint" ./bin/azeron lint
check "azeron build --check" ./bin/azeron build --check
check "azeron roundtrip" ./bin/azeron roundtrip
check_fails "unknown command exits non-zero" ./bin/azeron nonsense
check_fails "unknown game exits non-zero" ./bin/azeron lint no-such-game
check_fails "install refuses without --yes" ./bin/azeron install everspace --device-id 0

exit "$fails"
