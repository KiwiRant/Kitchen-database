export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { username, password, role, name } = body;

  if (!username || !password) {
    return jsonResponse({ success: false, error: "Missing username or password" }, { status: 400 });
  }

  const metadata = await resolveUsersTableMetadata(env.DB);

  if (!metadata.identifier) {
    return jsonResponse(
      { success: false, error: "Users table is missing a username or email column" },
      { status: 500 }
    );
  }

  if (!metadata.columns.password) {
    return jsonResponse(
      { success: false, error: "Users table is missing a password column" },
      { status: 500 }
    );
  }

  if (metadata.columns.name?.required && !name) {
    return jsonResponse(
      { success: false, error: "Name is required" },
      { status: 400 }
    );
  }

  const unsupportedRequiredColumns = metadata.unsupportedRequiredColumns;
  if (unsupportedRequiredColumns.length) {
    return jsonResponse(
      {
        success: false,
        error: `Users table has unsupported required column(s): ${unsupportedRequiredColumns.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const hash = await hashPassword(password);

  try {
    const insertColumns = [];
    const insertValues = [];

    if (metadata.columns.name?.exists && name) {
      insertColumns.push(metadata.columns.name.name);
      insertValues.push(name);
    }

    insertColumns.push(metadata.identifier);
    insertValues.push(username);

    insertColumns.push("password");
    insertValues.push(hash);

    if (metadata.columns.role?.exists) {
      if (role) {
        insertColumns.push("role");
        insertValues.push(role);
      } else if (metadata.columns.role.required || !metadata.columns.role.hasDefault) {
        insertColumns.push("role");
        insertValues.push("user");
      }
    }

    const placeholders = insertColumns.map(() => "?").join(", ");
    const statement = `INSERT INTO users (${insertColumns.join(", ")}) VALUES (${placeholders})`;

    await env.DB.prepare(statement).bind(...insertValues).run();

    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ success: false, error: e.message }, { status: 500 });
  }
}

async function resolveUsersTableMetadata(db) {
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

  const identifier = columns.username ? "username" : columns.email ? "email" : null;

  const supportedColumns = new Set(["id", "created_at", "updated_at", "password", "role", "name"]);
  if (identifier) supportedColumns.add(identifier);

  const unsupportedRequiredColumns = results
    .filter((row) => !supportedColumns.has(row.name))
    .filter((row) => Boolean(row.notnull) && row.dflt_value === null)
    .map((row) => row.name);

  return {
    identifier,
    columns,
    unsupportedRequiredColumns,
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
