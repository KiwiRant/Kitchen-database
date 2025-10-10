import {
  jsonResponse,
  readJson,
  requireDb,
  getUsersMetadata,
  normaliseIdentifier,
  hashPassword,
  safeCompare,
  fetchOne,
} from './_utils.js';

async function verifyPassword(password, stored) {
  if (!stored) {
    return false;
  getUsersTableMetadata,
  jsonResponse,
  parseJsonBody,
  verifyPassword,
} from "./_utils.js";

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }

  const username = (payload.username ?? payload.email ?? "").toString().trim();
  const password = (payload.password ?? "").toString();

  if (!username || !password) {
    return jsonResponse({ success: false, message: "Missing username or password" }, { status: 400 });
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

    const row = await fetchOne(
      db,
      `SELECT *, ${meta.identifierColumn} AS identifier_alias FROM users WHERE lower(${meta.identifierColumn}) = lower(?)`,
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
  const identifierColumn = await resolveIdentifierColumn(env.DB);
  if (!identifierColumn) {
    return jsonResponse(
      { success: false, message: "Users table is missing login column" },
      { status: 500 }
    );
  }

  let results;
  try {
    ({ results } = await env.DB.prepare(
      `SELECT * FROM users WHERE ${identifierColumn} = ?`
    )
      .bind(username)
      .all());
  } catch (error) {
    return jsonResponse({ success: false, message: error.message }, { status: 500 });
  }

  const user = results[0];
  if (!user) return jsonResponse({ success: false, message: "User not found" }, { status: 404 });

  const hash = await hashPassword(password);
  const passwordMatches = hash === user.password || password === user.password;
  if (!passwordMatches) {
    return jsonResponse({ success: false, message: "Invalid credentials" }, { status: 401 });
  }

  return jsonResponse({
    success: true,
    user: {
      id: user.id,
      username: user.username ?? user.email,
      role: user.role,
    },
  });
}

async function resolveIdentifierColumn(db) {
  const { results } = await db
    .prepare(
      "SELECT name FROM pragma_table_info('users') WHERE name IN ('username', 'email')"
    )
    .all();

  const columns = results.map((row) => row.name);
  if (columns.includes("username")) return "username";
  if (columns.includes("email")) return "email";
  return null;
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}
