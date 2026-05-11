#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=guided-manual-tests/common.sh
source "$SCRIPT_DIR/common.sh"

echo "[B] Seeding source and destination with identical schema + data"
print_connection_summaries

echo "Creating schema objects and tables in source and destination..."

for db in source dest; do
  if [[ "$db" == "source" ]]; then
    psql_cmd="source_psql"
  else
    psql_cmd="dest_psql"
  fi

  $psql_cmd <<'SQL'
DROP TABLE IF EXISTS user_no_pk CASCADE;
DROP TABLE IF EXISTS test_no_pk CASCADE;
DROP TABLE IF EXISTS user_nullable_values CASCADE;
DROP TABLE IF EXISTS test_nullable_values CASCADE;
DROP TABLE IF EXISTS user_composite_pk CASCADE;
DROP TABLE IF EXISTS test_composite_pk CASCADE;
DROP TABLE IF EXISTS user_all_types CASCADE;
DROP TABLE IF EXISTS test_all_types CASCADE;
DROP TYPE IF EXISTS test_mood_enum CASCADE;
DROP DOMAIN IF EXISTS positive_int_domain CASCADE;

CREATE TYPE test_mood_enum AS ENUM ('happy', 'sad', 'neutral');
CREATE DOMAIN positive_int_domain AS integer CHECK (VALUE > 0);

CREATE TABLE test_all_types (
  id integer PRIMARY KEY,
  small_val smallint,
  int_val integer,
  big_val bigint,
  numeric_val numeric(18,6),
  decimal_val decimal(10,4),
  real_val real,
  double_val double precision,
  money_val money,
  text_val text,
  varchar_val varchar(100),
  char_val char(5),
  bool_val boolean,
  date_val date,
  time_val time,
  timetz_val time with time zone,
  timestamp_val timestamp,
  timestamptz_val timestamp with time zone,
  interval_val interval,
  uuid_val uuid,
  json_val json,
  jsonb_val jsonb,
  bytea_val bytea,
  text_array_val text[],
  int_array_val integer[],
  uuid_array_val uuid[],
  inet_val inet,
  cidr_val cidr,
  macaddr_val macaddr,
  point_val point,
  line_val line,
  box_val box,
  path_val path,
  polygon_val polygon,
  circle_val circle,
  int4range_val int4range,
  numrange_val numrange,
  tsrange_val tsrange,
  tstzrange_val tstzrange,
  daterange_val daterange,
  mood_val test_mood_enum,
  domain_val positive_int_domain,
  generated_label text GENERATED ALWAYS AS (text_val || '_gen') STORED
);

CREATE TABLE user_all_types (LIKE test_all_types INCLUDING ALL);

CREATE TABLE test_composite_pk (
  tenant_id integer,
  item_id integer,
  value text,
  PRIMARY KEY (tenant_id, item_id)
);

CREATE TABLE user_composite_pk (LIKE test_composite_pk INCLUDING ALL);

CREATE TABLE test_nullable_values (
  id integer PRIMARY KEY,
  maybe_text text,
  maybe_number integer
);

CREATE TABLE user_nullable_values (LIKE test_nullable_values INCLUDING ALL);

CREATE TABLE test_no_pk (
  name text,
  value text
);

CREATE TABLE user_no_pk (LIKE test_no_pk INCLUDING ALL);

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
VALUES
(
  1, 10, 100, 1000,
  123.456789, 100.1234, 1.5, 2.5, '$99.99',
  'seed-one', 'seed-varchar', 'abc  ',
  true,
  '2026-01-01', '10:00:00', '10:00:00+00', '2026-01-01 10:00:00', '2026-01-01 10:00:00+00', '1 hour',
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  '{"k":"v1"}', '{"k":"v1","n":1}',
  decode('010203', 'hex'),
  ARRAY['alpha','beta'], ARRAY[1,2], ARRAY['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid],
  '192.168.1.10', '192.168.1.0/24', '08:00:2b:01:02:03',
  '(1,2)', '{1,0,-1}', '(0,0),(2,2)', '[(0,0),(1,1),(2,0)]', '((0,0),(1,1),(2,0))', '<(1,1),2>',
  '[1,10]', '[1.1,2.2)', '[2026-01-01 00:00:00,2026-01-02 00:00:00)', '[2026-01-01 00:00:00+00,2026-01-02 00:00:00+00)', '[2026-01-01,2026-01-31)',
  'happy', 1
),
(
  2, 20, 200, 2000,
  987.654321, 200.5678, 3.5, 4.5, '$49.00',
  'seed-two', 'seed-varchar-2', 'xyz  ',
  false,
  '2026-02-01', '11:00:00', '11:00:00+00', '2026-02-01 11:00:00', '2026-02-01 11:00:00+00', '2 hours',
  'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  '{"k":"v2"}', '{"k":"v2","n":2}',
  decode('040506', 'hex'),
  ARRAY['gamma'], ARRAY[3,4], ARRAY['b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'::uuid],
  '10.0.0.10', '10.0.0.0/8', 'aa:bb:cc:dd:ee:ff',
  '(3,4)', '{0,1,-3}', '(1,1),(3,3)', '[(1,1),(2,2),(3,1)]', '((1,1),(2,2),(3,1))', '<(2,2),3>',
  '[2,20]', '[2.2,3.3)', '[2026-02-01 00:00:00,2026-02-02 00:00:00)', '[2026-02-01 00:00:00+00,2026-02-02 00:00:00+00)', '[2026-02-01,2026-02-28)',
  'neutral', 2
);

INSERT INTO user_all_types (
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
SELECT
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
FROM test_all_types;

INSERT INTO test_composite_pk (tenant_id, item_id, value) VALUES
(1, 1, 'seed-a'),
(1, 2, 'seed-b');

INSERT INTO user_composite_pk SELECT * FROM test_composite_pk;

INSERT INTO test_nullable_values (id, maybe_text, maybe_number) VALUES
(1, NULL, 10),
(2, 'value', NULL);

INSERT INTO user_nullable_values SELECT * FROM test_nullable_values;

INSERT INTO test_no_pk (name, value) VALUES
('alpha', 'one'),
('beta', 'two');

INSERT INTO user_no_pk SELECT * FROM test_no_pk;
SQL
done

echo "Tables created: ${MANUAL_TEST_TABLES[*]}"
echo "Row counts per table (source / destination):"

for table in "${MANUAL_TEST_TABLES[@]}"; do
  source_count="$(source_psql -Atc "SELECT count(*) FROM $table;")"
  dest_count="$(dest_psql -Atc "SELECT count(*) FROM $table;")"
  echo "  - $table: $source_count / $dest_count"
done

echo "Verifying source and destination equality table-by-table..."

declare -A table_order

table_order[test_all_types]="id"
table_order[user_all_types]="id"
table_order[test_composite_pk]="tenant_id, item_id"
table_order[user_composite_pk]="tenant_id, item_id"
table_order[test_nullable_values]="id"
table_order[user_nullable_values]="id"
table_order[test_no_pk]="name, value"
table_order[user_no_pk]="name, value"

for table in "${MANUAL_TEST_TABLES[@]}"; do
  order_by="${table_order[$table]}"
  source_hash="$(source_psql -Atc "SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY $order_by), '')) FROM $table t;")"
  dest_hash="$(dest_psql -Atc "SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY $order_by), '')) FROM $table t;")"

  if [[ "$source_hash" != "$dest_hash" ]]; then
    echo "ERROR: Equality check failed for table $table" >&2
    exit 1
  fi
done

echo "Equality verification result: PASS (source and destination are equal after seeding)."
printf "\nNext step: %s\n" "$REPO_ROOT/guided-manual-tests/c-produce-changes-in-source.sh"
