/**
 * Integration test helpers: database setup and utilities.
 */

import { Pool } from "pg";

export const SOURCE_CONFIG = {
  host: process.env["PG_SOURCE_HOST"] || "localhost",
  port: parseInt(process.env["PG_SOURCE_PORT"] || "15432", 10),
  database: process.env["PG_SOURCE_DB"] || "testdb",
  user: process.env["PG_SOURCE_USER"] || "testuser",
  password: process.env["PG_SOURCE_PASSWORD"] || "testpassword",
};

export const DEST_CONFIG = {
  host: process.env["PG_DEST_HOST"] || "localhost",
  port: parseInt(process.env["PG_DEST_PORT"] || "15433", 10),
  database: process.env["PG_DEST_DB"] || "testdb",
  user: process.env["PG_DEST_USER"] || "testuser",
  password: process.env["PG_DEST_PASSWORD"] || "testpassword",
};

export function createSourcePool(): Pool {
  return new Pool(SOURCE_CONFIG);
}

export function createDestPool(): Pool {
  return new Pool(DEST_CONFIG);
}

/**
 * Sets up the test schema on both source and dest databases.
 * Drops existing tables if they exist.
 */
export async function setupTestSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Drop tables in dependency order
      DROP TABLE IF EXISTS no_pk_table CASCADE;
      DROP TABLE IF EXISTS composite_pk_table CASCADE;
      DROP TABLE IF EXISTS type_test_table CASCADE;
      DROP TYPE IF EXISTS mood_enum CASCADE;
      DROP DOMAIN IF EXISTS positive_integer CASCADE;
    `);

    // Create custom enum type
    await client.query(
      `CREATE TYPE mood_enum AS ENUM ('happy', 'sad', 'neutral')`,
    );

    // Create custom domain type
    await client.query(
      `CREATE DOMAIN positive_integer AS integer CHECK (VALUE > 0)`,
    );

    // Main type test table covering many PostgreSQL types
    await client.query(`
      CREATE TABLE type_test_table (
        -- Integer types
        id                    integer PRIMARY KEY,
        small_val             smallint,
        big_val               bigint,

        -- Numeric types
        numeric_val           numeric(18, 6),
        decimal_val           decimal(10, 4),
        real_val              real,
        double_val            double precision,

        -- Text types
        text_val              text,
        varchar_val           varchar(100),
        char_val              char(5),

        -- Boolean
        bool_val              boolean,

        -- Date/time types
        date_val              date,
        time_val              time,
        timetz_val            time with time zone,
        timestamp_val         timestamp,
        timestamptz_val       timestamp with time zone,
        interval_val          interval,

        -- UUID
        uuid_val              uuid,

        -- JSON types
        json_val              json,
        jsonb_val             jsonb,

        -- Binary
        bytea_val             bytea,

        -- Arrays
        text_array_val        text[],
        int_array_val         integer[],
        uuid_array_val        uuid[],

        -- Network types
        inet_val              inet,
        cidr_val              cidr,
        macaddr_val           macaddr,

        -- Geometric types
        point_val             point,

        -- Range types
        int4range_val         int4range,
        numrange_val          numrange,
        tsrange_val           tsrange,
        tstzrange_val         tstzrange,
        daterange_val         daterange,

        -- Custom types
        mood_val              mood_enum,
        domain_val            positive_integer,

        -- Nullable fields
        nullable_text         text,
        nullable_int          integer,

        -- Generated column (must be ignored)
        generated_col         text GENERATED ALWAYS AS (text_val || '_gen') STORED
      )
    `);

    // Table with composite primary key
    await client.query(`
      CREATE TABLE composite_pk_table (
        tenant_id  integer,
        item_id    integer,
        name       text,
        value      text,
        PRIMARY KEY (tenant_id, item_id)
      )
    `);

    // Table without primary key (should fail by default, skip with skipMissingPk)
    await client.query(`
      CREATE TABLE no_pk_table (
        name   text,
        value  text
      )
    `);
  } finally {
    client.release();
  }
}

/**
 * Inserts baseline rows into type_test_table.
 */
export async function insertBaselineRows(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO type_test_table (
        id, small_val, big_val,
        numeric_val, decimal_val, real_val, double_val,
        text_val, varchar_val, char_val,
        bool_val,
        date_val, time_val, timetz_val, timestamp_val, timestamptz_val, interval_val,
        uuid_val,
        json_val, jsonb_val,
        bytea_val,
        text_array_val, int_array_val, uuid_array_val,
        inet_val, cidr_val, macaddr_val,
        point_val,
        int4range_val, numrange_val, tsrange_val, tstzrange_val, daterange_val,
        mood_val, domain_val,
        nullable_text, nullable_int
      ) VALUES
      -- Row 1: will be updated in source
      (
        1, 100, 1000000000000,
        12345.678900, 9999.9999, 3.14, 2.718281828,
        'hello', 'world', 'abc  ', -- char(5) pads with spaces
        true,
        '2026-01-01', '10:30:00', '10:30:00+05:30', '2026-01-01 10:30:00', '2026-01-01 10:30:00+00', '1 hour 30 minutes',
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        '{"key": "value"}', '{"jsonb": true, "num": 42}',
        decode('48656c6c6f', 'hex'),
        ARRAY['alpha', 'beta', 'gamma'], ARRAY[1, 2, 3], ARRAY['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid],
        '192.168.1.1', '192.168.0.0/24', '08:00:2b:01:02:03',
        '(1,2)',
        '[1,5]', '[1.5,2.5]', '[2026-01-01 00:00:00,2026-01-02 00:00:00)', '[2026-01-01 00:00:00+00,2026-01-02 00:00:00+00)', '[2026-01-01,2026-01-31)',
        'happy', 1,
        'some text', 42
      ),
      -- Row 2: unchanged in both
      (
        2, 200, 2000000000000,
        99999.000000, 0.0001, 1.0, 1.0,
        'unchanged', 'row', 'xyz  ',
        false,
        '2026-02-01', '14:00:00', '14:00:00+00', '2026-02-01 14:00:00', '2026-02-01 14:00:00+00', '2 days',
        'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        '{"x": 1}', '{"x": 1}',
        decode('576f726c64', 'hex'),
        ARRAY['one'], ARRAY[10, 20], ARRAY['b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'::uuid],
        '10.0.0.1', '10.0.0.0/8', 'aa:bb:cc:dd:ee:ff',
        '(3,4)',
        '[1,10]', '[0,1]', '[2026-02-01 00:00:00,2026-02-02 00:00:00)', '[2026-02-01 00:00:00+00,2026-02-02 00:00:00+00)', '[2026-02-01,2026-02-28)',
        'neutral', 2,
        NULL, NULL
      ),
      -- Row 3: exists only in dest (will be a delete if includeDeletes=true)
      (
        3, 300, 3000000000000,
        0.000001, 1000.0000, 0.5, 0.333333333,
        'dest only', 'row', 'del  ',
        true,
        '2026-03-01', '09:00:00', '09:00:00+00', '2026-03-01 09:00:00', '2026-03-01 09:00:00+00', '30 minutes',
        'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
        '{"del": true}', '{"del": true}',
        decode('44656c657465', 'hex'),
        ARRAY['to', 'delete'], ARRAY[99], ARRAY['c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'::uuid],
        '172.16.0.1', '172.16.0.0/12', 'ff:ee:dd:cc:bb:aa',
        '(5,6)',
        '[3,7]', '[2,3]', '[2026-03-01 00:00:00,2026-03-02 00:00:00)', '[2026-03-01 00:00:00+00,2026-03-02 00:00:00+00)', '[2026-03-01,2026-03-31)',
        'sad', 3,
        'present', 99
      )
    `);

    // Composite PK baseline
    await client.query(`
      INSERT INTO composite_pk_table (tenant_id, item_id, name, value)
      VALUES
        (1, 1, 'tenant1-item1', 'value-a'),
        (1, 2, 'tenant1-item2', 'value-b'),
        (2, 1, 'tenant2-item1', 'value-c')
    `);
  } finally {
    client.release();
  }
}

/**
 * Mutates source rows to create a diff:
 * - Row 1 is updated (several fields changed)
 * - Row 4 is inserted (new in source)
 * - Row 3 remains only in dest (delete candidate)
 */
export async function mutateSourceRows(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Update row 1 with new values
    await client.query(`
      UPDATE type_test_table SET
        small_val = 999,
        text_val = 'updated hello',
        bool_val = false,
        nullable_text = 'now has value',
        nullable_int = NULL,
        jsonb_val = '{"jsonb": true, "num": 43, "extra": "added"}',
        mood_val = 'sad'
      WHERE id = 1
    `);

    // Insert row 4 (new in source, will be an INSERT in diff)
    await client.query(`
      INSERT INTO type_test_table (
        id, small_val, big_val,
        numeric_val, decimal_val, real_val, double_val,
        text_val, varchar_val, char_val,
        bool_val,
        date_val, time_val, timetz_val, timestamp_val, timestamptz_val, interval_val,
        uuid_val,
        json_val, jsonb_val,
        bytea_val,
        text_array_val, int_array_val, uuid_array_val,
        inet_val, cidr_val, macaddr_val,
        point_val,
        int4range_val, numrange_val, tsrange_val, tstzrange_val, daterange_val,
        mood_val, domain_val,
        nullable_text, nullable_int
      ) VALUES (
        4, 400, 4000000000000,
        111.222000, 333.4444, 2.2, 4.44444,
        'new row', 'source only', 'new  ',
        true,
        '2026-04-01', '08:00:00', '08:00:00+00', '2026-04-01 08:00:00', '2026-04-01 08:00:00+00', '15 minutes',
        'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
        '{"new": true}', '{"new": true}',
        decode('4e6577', 'hex'),
        ARRAY['new'], ARRAY[4, 5], ARRAY['d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'::uuid],
        '192.168.2.1', '192.168.2.0/24', '11:22:33:44:55:66',
        '(7,8)',
        '[4,8]', '[3,4]', '[2026-04-01 00:00:00,2026-04-02 00:00:00)', '[2026-04-01 00:00:00+00,2026-04-02 00:00:00+00)', '[2026-04-01,2026-04-30)',
        'happy', 4,
        NULL, 100
      )
    `);

    // Also update composite PK table
    await client.query(`
      UPDATE composite_pk_table SET name = 'UPDATED' WHERE tenant_id = 1 AND item_id = 1
    `);
  } finally {
    client.release();
  }
}
