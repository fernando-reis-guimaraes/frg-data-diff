#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=guided-manual-tests/common.sh
source "$SCRIPT_DIR/common.sh"

echo "[C] Producing deterministic source-only changes on test_* tables"
echo "Affected database: source ($PG_SOURCE_HOST:$PG_SOURCE_PORT/$PG_SOURCE_DB)"

echo "Applying scripted changes to source test_* tables only..."
source_psql <<'SQL'
-- Update + JSON/JSONB + bytea + array + value->NULL on test_all_types
UPDATE test_all_types
SET
  int_val = int_val + 1000,
  text_val = 'seed-one-updated',
  json_val = '{"k":"v1-updated","extra":true}',
  jsonb_val = '{"k":"v1-updated","n":100}',
  bytea_val = decode('aabbccdd', 'hex'),
  int_array_val = ARRAY[9,8,7],
  money_val = '$120.00',
  varchar_val = NULL
WHERE id = 1;

-- Insert on test_all_types
INSERT INTO test_all_types (
  id, small_val, int_val, big_val,
  numeric_val, decimal_val, real_val, double_val, money_val,
  text_val, varchar_val, char_val,
  bool_val,
  date_val, time_val, timetz_val, timestamp_val, timestamptz_val, interval_val,
  uuid_val,
  json_val, jsonb_val,
  bytea_val,
  text_array_val, int_array_val, uuid_array_val,
  inet_val, cidr_val, macaddr_val,
  point_val, line_val, box_val, path_val, polygon_val, circle_val,
  int4range_val, numrange_val, tsrange_val, tstzrange_val, daterange_val,
  mood_val, domain_val
)
VALUES (
  3, 30, 300, 3000,
  333.333333, 300.3333, 5.5, 6.5, '$10.00',
  'source-insert', 'new-varchar', 'ins  ',
  true,
  '2026-03-01', '12:00:00', '12:00:00+00', '2026-03-01 12:00:00', '2026-03-01 12:00:00+00', '3 hours',
  'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  '{"k":"v3"}', '{"k":"v3","n":3}',
  decode('090909', 'hex'),
  ARRAY['delta'], ARRAY[5,6], ARRAY['c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'::uuid],
  '172.16.0.10', '172.16.0.0/16', '11:22:33:44:55:66',
  '(5,6)', '{1,-1,2}', '(2,2),(4,4)', '[(2,2),(3,3),(4,2)]', '((2,2),(3,3),(4,2))', '<(3,3),1>',
  '[3,30]', '[3.3,4.4)', '[2026-03-01 00:00:00,2026-03-02 00:00:00)', '[2026-03-01 00:00:00+00,2026-03-02 00:00:00+00)', '[2026-03-01,2026-03-31)',
  'sad', 3
);

-- Delete on test_all_types
DELETE FROM test_all_types WHERE id = 2;

-- Composite primary key update
UPDATE test_composite_pk SET value = 'seed-a-updated' WHERE tenant_id = 1 AND item_id = 1;

-- NULL -> value update
UPDATE test_nullable_values SET maybe_text = 'now populated' WHERE id = 1;

-- value -> NULL update
UPDATE test_nullable_values SET maybe_number = NULL WHERE id = 1;
SQL

echo "Scripted source-side changes complete."
echo "Destination database is untouched."

printf "\nReviewer optional manual step (source DB only):\n"
echo "  - You may now apply manual INSERT/UPDATE/DELETE changes to user_* tables in SOURCE only."
echo "  - Do NOT modify destination."
print_connection_summaries

printf "\nExample source connection command (password env var only, no password value shown):\n"
echo "  PGPASSWORD=\"\$PG_PASSWORD_SOURCE\" psql -h $PG_SOURCE_HOST -p $PG_SOURCE_PORT -U $PG_SOURCE_USER -d $PG_SOURCE_DB"

printf "\nExample SQL for reviewer (SOURCE only):\n"
cat <<'SQL'
UPDATE user_all_types SET text_val = 'manual-review-change' WHERE id = 1;
INSERT INTO user_nullable_values (id, maybe_text, maybe_number) VALUES (99, 'manual insert', 99);
DELETE FROM user_composite_pk WHERE tenant_id = 1 AND item_id = 2;
SQL

printf "\nNext step: %s\n" "$REPO_ROOT/guided-manual-tests/d-produce-diff-json.sh"
