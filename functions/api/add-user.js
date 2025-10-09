export async function onRequestPost({ request, env }) {
  const { username, password, role, name } = await request.json();

  if (!username || !password) {
    return new Response("Missing fields", { status: 400 });
  }

  const identifierColumn = await resolveIdentifierColumn(env.DB);
  if (!identifierColumn) {
    return Response.json(
      { success: false, error: "Users table is missing a username or email column" },
      { status: 500 }
    );
  }

  const hash = await hashPassword(password);

  try {
    await env.DB.prepare(
      `INSERT INTO users (${identifierColumn}, password, role) VALUES (?, ?, ?)`
    )
      .bind(username, hash, role || "user")
      .run();

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ success: false, error: e.message });
  }
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
