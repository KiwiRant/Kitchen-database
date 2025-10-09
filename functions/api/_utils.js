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
    normalizedName: column.name.toLowerCase(),
    required: Boolean(column.notnull) && column.dflt_value === null && column.pk === 0,
    hasDefault: column.dflt_value !== null,
    primaryKey: column.pk === 1,
  }));
}

export async function getUsersTableMetadata(db) {
  const columns = await getTableColumns(db, "users");
  const columnsByNormalized = Object.fromEntries(
    columns.map((column) => [column.normalizedName, column])
  );

  const identifierColumn =
    columnsByNormalized.username?.name ?? columnsByNormalized.email?.name ?? null;
  const passwordColumn = columnsByNormalized.password?.name ?? null;

  const supported = new Set([
    "id",
    "password",
    "role",
    "name",
    "created_at",
    "updated_at",
    "username",
    "email",
  ]);

  if (identifierColumn) {
    supported.add(columnsByNormalized.username?.normalizedName ?? "username");
    supported.add(columnsByNormalized.email?.normalizedName ?? "email");
  }
  if (passwordColumn) {
    supported.add(columnsByNormalized.password.normalizedName);
  }

  const unsupportedRequiredColumns = columns
    .filter((column) => column.required && !supported.has(column.normalizedName))
    .map((column) => column.name);

  return {
    columns: columnsByNormalized,
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

