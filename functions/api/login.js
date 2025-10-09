export async function onRequestPost({ request, env }) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return new Response("Missing username or password", { status: 400 });
  }

  const identifierColumn = await resolveIdentifierColumn(env.DB);
  if (!identifierColumn) {
    return Response.json(
      { success: false, message: "Users table is missing login column" },
      { status: 500 }
    );
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM users WHERE ${identifierColumn} = ?`
  )
    .bind(username)
    .all();

  const user = results[0];
  if (!user) return Response.json({ success: false, message: "User not found" });

  const hash = await hashPassword(password);
  if (hash !== user.password)
    return Response.json({ success: false, message: "Invalid credentials" });

  return Response.json({
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
