#!/bin/bash
# Teacher user management script
# Usage: bash scripts/user-manage.sh <command> [args...]

set -e

DB="${DB_PATH:-./data/data.db}"
CMD="${1:-}"

# ── Help ──────────────────────────────────────────────────────────
if [ -z "$CMD" ] || [ "$CMD" = "help" ] || [ "$CMD" = "-h" ] || [ "$CMD" = "--help" ]; then
  cat <<EOF
Usage: bash scripts/user-manage.sh <command> [args...]

Commands:
  list                        List all teachers (id, username, name, created)
  info      [teacher-id]      Show detailed info for a teacher (default: 1)
  reset-pw  <new-password> [teacher-id]
                              Reset password (default teacher-id: 1)
  delete    <teacher-id>      Delete a teacher and ALL their data
                              Prompts for confirmation before proceeding

Environment:
  DB_PATH   Path to SQLite database (default: ./data/data.db)

Examples:
  bash scripts/user-manage.sh list
  bash scripts/user-manage.sh info
  bash scripts/user-manage.sh info 2
  bash scripts/user-manage.sh reset-pw mynewpassword
  bash scripts/user-manage.sh delete 3
EOF
  exit 0
fi

# ── Check DB exists ───────────────────────────────────────────────
if [ ! -f "$DB" ]; then
  echo "Error: Database not found at $DB"
  echo "Set DB_PATH to the correct path."
  exit 1
fi

# ── list ──────────────────────────────────────────────────────────
if [ "$CMD" = "list" ]; then
  echo "ID  Username        Name                 Created"
  echo "--- --------------- -------------------- -------------------"
  sqlite3 -separator "  " "$DB" \
    "SELECT printf('%-3s', id), printf('%-15s', username), printf('%-20s', name), createdAt FROM teachers ORDER BY id;"
  exit 0
fi

# ── info ──────────────────────────────────────────────────────────
if [ "$CMD" = "info" ]; then
  TID="${2:-1}"
  USER=$(sqlite3 "$DB" "SELECT id, username, name, apiKey, subjects, createdAt FROM teachers WHERE id = $TID;")
  if [ -z "$USER" ]; then
    echo "Error: Teacher id=$TID not found."
    exit 1
  fi
  IFS='|' read -r id username name apiKey subjects createdAt <<< "$USER"
  CLASS_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM classes WHERE teacher_id = $TID AND deleted = 0;")
  ALL_CLASS_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM classes WHERE teacher_id = $TID;")
  STUDENT_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM students WHERE teacher_id = $TID;")
  SCHED_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM schedules WHERE classId IN (SELECT id FROM classes WHERE teacher_id = $TID);")

  cat <<EOF
ID        : $id
Username  : $username
Name      : $name
API Key   : $apiKey
Subjects  : $subjects
Created   : $createdAt

Classes   : $CLASS_COUNT active ($ALL_CLASS_COUNT total including deleted)
Students  : $STUDENT_COUNT
Schedules : $SCHED_COUNT
EOF
  exit 0
fi

# ── reset-pw ──────────────────────────────────────────────────────
if [ "$CMD" = "reset-pw" ]; then
  PASS="${2:-}"
  TID="${3:-1}"

  if [ -z "$PASS" ]; then
    echo "Usage: bash scripts/user-manage.sh reset-pw <new-password> [teacher-id]"
    exit 1
  fi

  EXISTS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM teachers WHERE id = $TID;")
  if [ "$EXISTS" -eq 0 ]; then
    echo "Error: Teacher id=$TID not found."
    exit 1
  fi

  HASH=$(node -e "const bcrypt=require('bcryptjs');bcrypt.hash(process.argv[1],10).then(h=>console.log(h))" "$PASS")
  sqlite3 "$DB" "UPDATE teachers SET passwordHash = '$HASH' WHERE id = $TID;"
  echo "Password updated for teacher id=$TID."
  exit 0
fi

# ── delete ────────────────────────────────────────────────────────
if [ "$CMD" = "delete" ]; then
  TID="${2:-}"

  if [ -z "$TID" ]; then
    echo "Usage: bash scripts/user-manage.sh delete <teacher-id>"
    echo ""
    echo "This will PERMANENTLY DELETE the teacher and ALL their data:"
    echo "  classes, students, schedules, class-student links,"
    echo "  pricing tiers, semesters, holidays, audit log"
    exit 1
  fi

  USER=$(sqlite3 "$DB" "SELECT username || ' (' || name || ')' FROM teachers WHERE id = $TID;")
  if [ -z "$USER" ]; then
    echo "Error: Teacher id=$TID not found."
    exit 1
  fi

  CLASS_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM classes WHERE teacher_id = $TID;")
  STUDENT_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM students WHERE teacher_id = $TID;")
  SCHED_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM schedules WHERE classId IN (SELECT id FROM classes WHERE teacher_id = $TID);")

  echo "You are about to DELETE teacher: $USER"
  echo ""
  echo "  Classes     : $CLASS_COUNT"
  echo "  Students    : $STUDENT_COUNT"
  echo "  Schedules   : $SCHED_COUNT"
  echo "  (plus pricing tiers, semesters, holidays, audit log)"
  echo ""
  read -p "Type 'yes' to confirm: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 0
  fi

  sqlite3 "$DB" <<SQL
BEGIN TRANSACTION;
  DELETE FROM schedules    WHERE classId IN (SELECT id FROM classes WHERE teacher_id = $TID);
  DELETE FROM classStudents WHERE classId IN (SELECT id FROM classes WHERE teacher_id = $TID)
                              OR studentId IN (SELECT id FROM students WHERE teacher_id = $TID);
  DELETE FROM classes       WHERE teacher_id = $TID;
  DELETE FROM students      WHERE teacher_id = $TID;
  DELETE FROM pricingTiers  WHERE teacher_id = $TID;
  DELETE FROM semesters     WHERE teacher_id = $TID;
  DELETE FROM holidays      WHERE teacher_id = $TID;
  DELETE FROM auditLog      WHERE teacher_id = $TID;
  DELETE FROM teachers      WHERE id = $TID;
COMMIT;
SQL

  echo "Done. Teacher id=$TID and all their data deleted."
  exit 0
fi

# ── Unknown command ────────────────────────────────────────────────
echo "Unknown command: $CMD"
echo "Run 'bash scripts/user-manage.sh help' for usage."
exit 1
