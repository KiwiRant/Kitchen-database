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
  if (!env || !env.DB) {
    throw Object.assign(new Error('Database binding DB is not configured'), { status: 500 });
  }
  return env.DB;
}

export async function getUsersMetadata(db) {
  const info = await db.prepare("PRAGMA table_info('users')").all();
  const columns = (info?.results || []).map((col) => ({
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

  const identifierColumn = findColumn(['username', 'email']);
  const passwordColumn = findColumn(['password_hash', 'password']);
  const nameColumn = findColumn(['name', 'full_name']);
  const roleColumn = findColumn(['role']);

  const required = columns
    .filter((col) => col.notNull && !col.hasDefault)
    .map((col) => col.name);

  if (!identifierColumn) {
    throw Object.assign(new Error('The users table is missing a username or email column'), { status: 500 });
  }
  if (!passwordColumn) {
    throw Object.assign(new Error('The users table is missing a password column'), { status: 500 });
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

export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
