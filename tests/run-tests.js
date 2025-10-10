import assert from 'node:assert/strict';
import { getUsersMetadata } from '../functions/api/_utils.js';

const DEFAULT_COLUMNS = [
  { name: 'id', notnull: 0, dflt_value: null },
  { name: 'username', notnull: 1, dflt_value: null },
  { name: 'password_hash', notnull: 1, dflt_value: null },
  { name: 'name', notnull: 0, dflt_value: null },
  { name: 'role', notnull: 0, dflt_value: "'staff'" },
  { name: 'created_at', notnull: 0, dflt_value: 'CURRENT_TIMESTAMP' },
];

class FakeStatement {
  constructor({ onAll, onRun }) {
    this.onAll = onAll;
    this.onRun = onRun;
  }

  bind() {
    return this;
  }

  async all() {
    return { results: (this.onAll ? this.onAll() : []).map((col) => ({ ...col })) };
  }

  async run() {
    const meta = this.onRun ? this.onRun() : { changes: 0, last_row_id: null };
    return { meta };
  }
}

class FakeD1Database {
  constructor(columns = null) {
    this.columns = columns;
  }

  prepare(query) {
    const normalised = query.replace(/\s+/g, ' ').trim().toUpperCase();

    if (normalised.startsWith('PRAGMA TABLE_INFO')) {
      return new FakeStatement({
        onAll: () => this.columns ? this.columns.map((col) => ({ ...col })) : [],
      });
    }

    if (normalised.startsWith('CREATE TABLE IF NOT EXISTS USERS')) {
      return new FakeStatement({
        onRun: () => {
          if (!this.columns) {
            this.columns = DEFAULT_COLUMNS.map((col) => ({ ...col }));
          }
          return { changes: 0, last_row_id: null };
        },
      });
    }

    throw new Error(`Unsupported query in FakeD1Database: ${query}`);
  }
}

async function testCreatesMissingTable() {
  const db = new FakeD1Database();
  const meta = await getUsersMetadata(db);
  assert.equal(meta.identifierColumn, 'username');
  assert.equal(meta.passwordColumn, 'password_hash');
  assert.equal(meta.roleColumn, 'role');
}

async function testRespectsExistingSchema() {
  const db = new FakeD1Database([
    { name: 'ID', notnull: 0, dflt_value: null },
    { name: 'EMAIL', notnull: 1, dflt_value: null },
    { name: 'PASSWORD', notnull: 1, dflt_value: null },
    { name: 'FULL_NAME', notnull: 0, dflt_value: null },
  ]);

  const meta = await getUsersMetadata(db);
  assert.equal(meta.identifierColumn, 'EMAIL');
  assert.equal(meta.passwordColumn, 'PASSWORD');
  assert.equal(meta.nameColumn, 'FULL_NAME');
}

async function testUnsupportedRequiredColumns() {
  const db = new FakeD1Database([
    { name: 'username', notnull: 1, dflt_value: null },
    { name: 'password_hash', notnull: 1, dflt_value: null },
    { name: 'tier', notnull: 1, dflt_value: null },
  ]);

  let caught = null;
  try {
    await getUsersMetadata(db);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, 'Expected an error to be thrown for unsupported columns');
  assert.equal(caught.status, 400);
  assert.match(caught.message, /not supported/i);
}

(async () => {
  await testCreatesMissingTable();
  await testRespectsExistingSchema();
  await testUnsupportedRequiredColumns();
  console.log('All tests passed');
})();
