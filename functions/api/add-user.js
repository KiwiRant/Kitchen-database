export async function onRequestPost({ request, env }) {
  const { username, password, role, name } = await request.json();

  if (!username || !password) {
    return jsonResponse({ success: false, error: "Missing fields" }, { status: 400 });
  }

  const metadata = await resolveUsersTableMetadata(env.DB);
  if (!metadata.identifierColumn) {
    return jsonResponse(
      { success: false, error: "Users table is missing a username or email column" },
      { status: 500 }
    );
  }

  if (metadata.nameColumn?.required && !name) {
    return jsonResponse(
      { success: false, error: "Name is required" },
      { status: 400 }
    );
  }

  const hash = await hashPassword(password);

  try {
    const columns = [];
    const values = [];

    if (metadata.nameColumn?.exists) {
      columns.push(metadata.nameColumn.name);
      values.push(name ?? null);
    }

    columns.push(metadata.identifierColumn, "password", "role");
    values.push(username, hash, role || "user");

    const placeholders = columns.map(() => "?").join(", ");
    const statement = `INSERT INTO users (${columns.join(", ")}) VALUES (${placeholders})`;

    await env.DB.prepare(statement)
      .bind(...values)
      .run();

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ success: false, error: e.message }, { status: 500 });
  }
}

async function resolveUsersTableMetadata(db) {
  const { results } = await db
    .prepare("SELECT name, notnull, dflt_value FROM pragma_table_info('users')")
    .all();

  const identifierColumn = results.find((row) => row.name === "username")
    ? "username"
    : results.find((row) => row.name === "email")
      ? "email"
      : null;

  const nameInfo = results.find((row) => row.name === "name");
  const nameColumn = nameInfo
    ? {
        name: nameInfo.name,
        exists: true,
        required: Boolean(nameInfo.notnull) && nameInfo.dflt_value === null,
      }
    : null;

  return {
    identifierColumn,
    nameColumn,
  };
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
