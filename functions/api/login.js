import {
  jsonResponse,
  readJson,
  requireDb,
  getUsersMetadata,
  normaliseIdentifier,
  hashPassword,
  safeCompare,
  fetchOne,
  quoteIdentifier,
} from './_utils.js';

async function verifyPassword(password, stored) {
  if (!stored) {
    return false;
  }
  const hashed = await hashPassword(password);
  if (safeCompare(hashed, stored)) {
    return true;
  }
  return safeCompare(password, stored);
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const payload = await readJson(request);
    const identifier = normaliseIdentifier(payload.identifier || payload.username || payload.email);
    const password = (payload.password || '').trim();

    if (!identifier || !password) {
      return jsonResponse(400, { error: 'Username/email and password are required.' });
    }

    const db = await requireDb(env);
    const meta = await getUsersMetadata(db);

    const identifierColumnQuoted = quoteIdentifier(meta.identifierColumn);

    const row = await fetchOne(
      db,
      `SELECT *, ${identifierColumnQuoted} AS identifier_alias FROM users WHERE lower(${identifierColumnQuoted}) = lower(?)`,
      [identifier],
    );

    if (!row) {
      return jsonResponse(401, { error: 'Invalid credentials.' });
    }

    const storedPassword = row[meta.passwordColumn];
    const ok = await verifyPassword(password, storedPassword);

    if (!ok) {
      return jsonResponse(401, { error: 'Invalid credentials.' });
    }

    return jsonResponse(200, {
      success: true,
      user: {
        identifier: row[meta.identifierColumn],
        name: meta.nameColumn ? row[meta.nameColumn] : null,
        role: meta.roleColumn ? row[meta.roleColumn] : 'staff',
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return jsonResponse(status, { error: error.message || 'Unable to login.' });
  }
};
