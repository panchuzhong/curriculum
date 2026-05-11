#!/bin/bash
# Reset teacher password via direct SQLite update
# Usage: bash scripts/reset-password.sh <new-password> [teacher-id]
# Default teacher-id is 1

set -e

PASS="${1:-}"
TID="${2:-1}"
DB="${DB_PATH:-./data/data.db}"

if [ -z "$PASS" ]; then
  echo "Usage: bash scripts/reset-password.sh <new-password> [teacher-id]"
  echo ""
  echo "  new-password   The new password (required)"
  echo "  teacher-id     Teacher ID to update (default: 1)"
  echo ""
  echo "Environment:"
  echo "  DB_PATH        Path to SQLite database (default: ./data/data.db)"
  exit 1
fi

HASH=$(node -e "const bcrypt=require('bcryptjs');bcrypt.hash(process.argv[1],10).then(h=>console.log(h))" "$PASS")

echo "Teacher ID : $TID"
echo "Database   : $DB"
echo "New hash   : $HASH"
echo ""

sqlite3 "$DB" "UPDATE teachers SET passwordHash = '$HASH' WHERE id = $TID;"

if [ $? -eq 0 ]; then
  echo "Done. Password updated successfully."
else
  echo "Failed. Check that DB_PATH is correct and sqlite3 is installed."
fi
