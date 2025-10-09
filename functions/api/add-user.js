export async function onRequestPost({ request, env }) {
  const { username, password, role, name } = await request.json();

  if (!username || !password) {
    return new Response("Missing fields", { status: 400 });
  }

  const metadata = await resolveUsersTableMetadata(env.DB);
  if (!metadata.identifierColumn) {
    return Response.json(
      { success: false, error: "Users table is missing a username or email column" },
      { status: 500 }
    );
  }

  if (metadata.nameColumn?.required && !name) {
    return Response.json(
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

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ success: false, error: e.message });
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
