export function jsonResponse(status, data) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function readJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw Object.assign(new Error('Expected application/json request'), { status: 415 });
  }
  const text = await request.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw Object.assign(new Error('Invalid JSON payload'), { status: 400 });
  }
}

export async function requireDb(env) {
  if (!env) {
    throw Object.assign(new Error('No environment bindings were provided to the request'), { status: 500 });
  }

  const candidateBindings = [
    'DB',
    'DATABASE',
    'D1',
    'DB_MAIN',
    'DB_PRIMARY',
    'KITCHEN_DB',
    'DATABASE_MAIN',
    'DATABASE_PRIMARY',
  ];

  for (const name of candidateBindings) {
    const binding = env[name];
    if (binding && typeof binding.prepare === 'function') {
      return binding;
    }
  }

  const available = Object.keys(env)
    .filter((key) => env[key] && typeof env[key].prepare === 'function')
    .sort();

  const hint = available.length
    ? `Available database-like bindings: ${available.join(', ')}`
    : 'No database-like bindings were found on the request environment.';

  throw Object.assign(new Error(`Database binding is not configured. ${hint}`), { status: 500 });
}

async function fetchTableInfo(db, table) {
  const result = await db.prepare(`PRAGMA table_info('${table}')`).all();
  return result?.results || [];
}

async function createUsersTable(db) {
  await db
    .prepare(
      [
        'CREATE TABLE IF NOT EXISTS users (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
        '  username TEXT UNIQUE NOT NULL,',
        "  password_hash TEXT NOT NULL,",
        '  name TEXT,',
        "  role TEXT NOT NULL DEFAULT 'staff',",
        "  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        ')',
      ].join('\n'),
    )
    .run();
}

export async function getUsersMetadata(db) {
  let info;
  try {
    info = await fetchTableInfo(db, 'users');
  } catch (error) {
    throw Object.assign(new Error(`Unable to inspect users table: ${error.message}`), { status: 500 });
  }

  if (!info.length) {
    await createUsersTable(db);
    info = await fetchTableInfo(db, 'users');
  }

  const columns = info.map((col) => ({
    name: col.name,
    lower: col.name.toLowerCase(),
    notNull: Boolean(col.notnull),
    hasDefault: col.dflt_value !== null,
  }));

  const findColumn = (names) => {
    for (const name of names) {
      const match = columns.find((col) => col.lower === name.toLowerCase());
      if (match) {
        return match.name;
      }
    }
    return null;
  };

  const identifierColumn =
    findColumn(['username', 'email', 'user_name', 'user', 'login', 'identifier', 'useremail', 'email_address']) ||
    columns.find((col) => col.lower.includes('email') || col.lower.includes('user'))?.name ||
    null;

  const passwordColumn =
    findColumn(['password_hash', 'password', 'pass_hash', 'passwordhash', 'pwd_hash', 'pwd', 'passcode', 'secret']) ||
    columns.find((col) => col.lower.includes('pass') || col.lower.includes('pwd') || col.lower.includes('secret'))?.name ||
    null;

  const nameColumn = findColumn(['name', 'full_name', 'display_name']);
  const roleColumn = findColumn(['role', 'user_role', 'account_role', 'type', 'permission']);

  const required = columns
    .filter((col) => col.notNull && !col.hasDefault)
    .map((col) => col.name);

  if (!identifierColumn) {
    throw Object.assign(
      new Error('The users table needs a username or email column. Run the latest schema migration or add one manually.'),
      { status: 500 },
    );
  }
  if (!passwordColumn) {
    throw Object.assign(
      new Error('The users table needs a password column. Run the latest schema migration or add one manually.'),
      { status: 500 },
    );
  }

  const allowedRequired = new Set([identifierColumn, passwordColumn]);
  if (nameColumn) {
    allowedRequired.add(nameColumn);
  }
  if (roleColumn) {
    allowedRequired.add(roleColumn);
  }

  const unsupportedRequired = required.filter((name) => !allowedRequired.has(name));

  if (unsupportedRequired.length) {
    const listed = unsupportedRequired.join(', ');
    throw Object.assign(
      new Error(
        `The users table has required columns that are not supported by this application: ${listed}. ` +
          'Either make these columns optional or provide default values.',
      ),
      { status: 400 },
    );
  }

  return {
    identifierColumn,
    passwordColumn,
    nameColumn,
    roleColumn,
    required,
  };
}

export function normaliseIdentifier(identifier) {
  return (identifier || '').trim();
}

export function normaliseName(name) {
  return (name || '').trim();
}

export function normaliseRole(role) {
  const value = (role || 'staff').trim().toLowerCase();
  return value === 'admin' ? 'admin' : 'staff';
}

export function quoteIdentifier(name) {
  if (!name) {
    throw new Error('Identifier name is required for quoting');
  }
  const escaped = name.replace(/"/g, '""');
  return `"${escaped}"`;
}

export async function hashPassword(password) {
  const value = typeof password === 'string' ? password : String(password ?? '');

  if (typeof crypto !== 'undefined' && crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  if (typeof process !== 'undefined' && process.versions?.node) {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(value).digest('hex');
  }

  throw Object.assign(new Error('Password hashing is not supported in this environment'), { status: 500 });
}

export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function runStatement(db, query, params = []) {
  const { meta } = await db.prepare(query).bind(...params).run();
  return {
    changes: meta?.changes ?? 0,
    lastInsertRowId: meta?.last_row_id ?? null,
  };
}

export async function fetchAll(db, query, params = []) {
  const { results } = await db.prepare(query).bind(...params).all();
  return results || [];
}

export async function fetchOne(db, query, params = []) {
  const { results } = await db.prepare(query).bind(...params).all();
  return results?.[0] ?? null;
}

export function formatLineItems(items) {
  return items.map((item) => ({
    id: item.id,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    total: item.total,
    createdAt: item.created_at,
  }));
}
