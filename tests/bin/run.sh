#!/usr/bin/env bash
# Smoke tests for bin/azeron. The unit tests cover the library; this checks the CLI
# actually starts from the built artifact and reports failure with a non-zero exit code.
set -uo pipefail
cd "$(dirname "$0")/../.."
# Against the frozen copy of the data, like every other test: the owner's layouts can be half
# way through a change without failing a check of the code. See tests/fixtures/repo.
export AZERON_DATA="$PWD/tests/fixtures/repo"

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
# Exit codes alone let a command pass for the wrong reason: roundtrip exits 0 when it
# skips every profile, and a refusal can come from a missing store rather than the check
# being tested. These also require what was said.
says() {
  local name="$1" pattern="$2"; shift 2
  local output status
  output="$("$@" 2>&1)"; status=$?
  if grep -qE -- "$pattern" <<<"$output"; then
    echo "ok   $name"
  else
    echo "FAIL $name (exit $status, expected /$pattern/)"
    printf '%s\n' "$output" | sed 's/^/     /' | head -8
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
says "azeron help prints usage" "^azeron <command>" ./bin/azeron help
says "azeron lint is clean" "everspace: 0 error\(s\), 0 warning\(s\)" ./bin/azeron lint
check "azeron build --check" ./bin/azeron build --check
says "azeron roundtrip checks the golden profile" "round trip ok: .*single-v5" ./bin/azeron roundtrip
says "the committed game bindings agree with actions.yaml" " 0 differ" \
  ./bin/azeron ingame everspace --config "$AZERON_DATA/dist/SpaceSims/everspace/Input.ini"
says "the pedals are reported with how far each name is trusted" "rudder .*\[inferred\] -- not flown" \
  ./bin/azeron ingame everspace --config "$AZERON_DATA/dist/SpaceSims/everspace/Input.ini"
says "capturing finds the recorded rudder where the layout expects it" "already recorded: rudder .*inferred" \
  ./bin/azeron ingame everspace --capture-pedals --config "$AZERON_DATA/dist/SpaceSims/everspace/Input.ini"
check_fails "unknown command exits non-zero" ./bin/azeron nonsense
check_fails "the cheatsheet command is gone" ./bin/azeron cheatsheet
check "no generated HTML is tracked" bash -c '[ -z "$(git ls-files "*.html")" ]'
check_fails "unknown game exits non-zero" ./bin/azeron lint no-such-game
says "install refuses without --yes" "Re-run with --yes" ./bin/azeron install everspace
says "install refuses one device id for a pair" "would send profiles for 2 units" \
  ./bin/azeron install everspace --device-id 0 --dry-run

exit "$fails"
