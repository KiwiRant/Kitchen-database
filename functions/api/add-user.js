import {
  getUsersTableMetadata,
  hashPassword,
  isNonEmptyString,
  jsonResponse,
  parseJsonBody,
} from "./_utils.js";

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const identifierInput = (payload.username ?? payload.email ?? "").trim();
  const passwordInput = (payload.password ?? "").toString();
  const roleInput = (payload.role ?? "").toString().trim();
  const nameInput = payload.name !== undefined ? `${payload.name}`.trim() : "";

  if (!identifierInput || !passwordInput) {
    return jsonResponse(
      { success: false, error: "Username/email and password are required" },
      { status: 400 }
    );
  }

  const metadata = await loadUsersTableMetadata(env.DB);

  if (!metadata.identifierColumn) {
    return jsonResponse(
      { success: false, error: "Users table must include a username or email column" },
      { status: 500 }
    );
  }

  if (!metadata.columns.password) {
    return jsonResponse(
      { success: false, error: "Users table is missing a password column" },
      { status: 500 }
    );
  }

  const conflicts = metadata.unsupportedRequiredColumns;
  if (conflicts.length) {
    return jsonResponse(
      {
        success: false,
        error: `Unsupported required column(s) on users table: ${conflicts.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const existingUser = await findExistingUser(env.DB, metadata.identifierColumn, identifierInput);
  if (existingUser) {
    return jsonResponse(
      { success: false, error: "A user with that login already exists" },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(passwordInput);

  const insertColumns = [];
  const insertValues = [];

  // Required identifier column
  insertColumns.push(metadata.identifierColumn);
  insertValues.push(identifierInput);

  // Password column is always required if we reach this point
  insertColumns.push("password");
  insertValues.push(passwordHash);

  if (metadata.columns.name?.exists) {
    const nameValue = nameInput || (metadata.columns.name.required ? identifierInput : "");
    if (metadata.columns.name.required && !nameValue) {
      return jsonResponse({ success: false, error: "Full name is required" }, { status: 400 });
    }
    if (nameValue) {
      insertColumns.push(metadata.columns.name.name);
      insertValues.push(nameValue);
    }
  }

  if (metadata.columns.role?.exists) {
    const roleValue = roleInput || (metadata.columns.role.required || !metadata.columns.role.hasDefault ? "user" : "");
    if (metadata.columns.role.required && !roleValue) {
      return jsonResponse({ success: false, error: "Role is required" }, { status: 400 });
    }
    if (roleValue) {
      insertColumns.push("role");
      insertValues.push(roleValue);
    }
  }

  const statement = `INSERT INTO users (${insertColumns.join(", ")}) VALUES (${insertColumns
    .map(() => "?")
    .join(", ")})`;

  try {
    const result = await env.DB.prepare(statement).bind(...insertValues).run();
    return jsonResponse({
      success: true,
      user: {
        id: result.meta?.last_row_id ?? null,
        username: identifierInput,
        role: insertColumns.includes("role")
          ? insertValues[insertColumns.indexOf("role")]
          : undefined,
      },
    });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, { status: 500 });
  }

async function findExistingUser(db, identifierColumn, identifierValue) {
  const { results } = await db
    .prepare(`SELECT 1 FROM users WHERE ${identifierColumn} = ? LIMIT 1`)
    .bind(identifierValue)
    .all();
  return results[0];
}

async function loadUsersTableMetadata(db) {
  const { results } = await db
    .prepare("SELECT name, notnull, dflt_value FROM pragma_table_info('users')")
    .all();

  const columns = results.reduce((acc, row) => {
    acc[row.name] = {
      name: row.name,
      exists: true,
      required: Boolean(row.notnull) && row.dflt_value === null,
      hasDefault: row.dflt_value !== null,
    };
    return acc;
  }, {});

  const identifierColumn = columns.username ? "username" : columns.email ? "email" : null;

  const supported = new Set(["id", "password", "role", "name", "created_at", "updated_at"]);
  if (identifierColumn) supported.add(identifierColumn);

  const unsupportedRequiredColumns = results
    .filter((column) => !supported.has(column.name))
    .filter((column) => Boolean(column.notnull) && column.dflt_value === null)
    .map((column) => column.name);

  return { columns, identifierColumn, unsupportedRequiredColumns };
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}
