const encoder = new TextEncoder();

export async function parseJsonBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }

  const text = await request.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export async function getTableColumns(db, tableName) {
  if (!db) {
    throw new Error("Database binding DB is not configured");
  }

  const safeName = tableName.replaceAll("'", "''");
  const { results } = await db
    .prepare(
      `SELECT name, notnull, dflt_value, pk FROM pragma_table_info('${safeName}') ORDER BY cid`
    )
    .all();

  return results.map((column) => ({
    name: column.name,
    required: Boolean(column.notnull) && column.dflt_value === null && column.pk === 0,
    hasDefault: column.dflt_value !== null,
    primaryKey: column.pk === 1,
  }));
}

export async function getUsersTableMetadata(db) {
  const columns = await getTableColumns(db, "users");
  const byName = Object.fromEntries(columns.map((column) => [column.name, column]));

  const identifierColumn = byName.username ? "username" : byName.email ? "email" : null;
  const passwordColumn = byName.password ? "password" : null;

  const supported = new Set([
    "id",
    "password",
    "role",
    "name",
    "created_at",
    "updated_at",
  ]);
  if (identifierColumn) {
    supported.add(identifierColumn);
  }

  const unsupportedRequiredColumns = columns
    .filter((column) => column.required && !supported.has(column.name))
    .map((column) => column.name);

  return {
    columns: byName,
    identifierColumn,
    passwordColumn,
    unsupportedRequiredColumns,
  };
}

export async function hashPassword(password) {
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPassword(inputPassword, storedPassword) {
  if (!isNonEmptyString(storedPassword)) {
    return false;
  }

  if (inputPassword === storedPassword) {
    return true;
  }

  const hashed = await hashPassword(inputPassword);
  return hashed === storedPassword;
}

