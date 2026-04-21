#!/usr/bin/env bash
# Launch example 03 — in-process SalesService + aggregate pipelines.
# No external providers needed; everything runs inside the example CAP app.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

EXAMPLE_PORT=4103

rm -rf "$SCRIPT_DIR/app"
mkdir -p "$SCRIPT_DIR/app"
cp -R "$REPO_ROOT/examples/_monitor-app/pipeline-monitor" "$SCRIPT_DIR/app/"
cp    "$REPO_ROOT/examples/_monitor-app/launchpage.html"    "$SCRIPT_DIR/app/"

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[example-03] Installing dependencies..."
    (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund)
fi

pid=$(lsof -ti:$EXAMPLE_PORT 2>/dev/null || true)
[ -n "$pid" ] && { echo "[example-03] Port $EXAMPLE_PORT busy (pid $pid) — killing"; kill -9 "$pid" 2>/dev/null || true; }

echo "[example-03] Starting on :$EXAMPLE_PORT ..."
echo "  SalesService:     http://localhost:$EXAMPLE_PORT/odata/v4/sales/Orders"
echo "  ReportingService: http://localhost:$EXAMPLE_PORT/odata/v4/reporting/DailyCustomerRevenue"
echo "  Pipeline Monitor: http://localhost:$EXAMPLE_PORT/launchpage.html"
echo ""

cd "$SCRIPT_DIR"
exec npx cds-serve --port $EXAMPLE_PORT
