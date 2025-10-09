export async function onRequestPost({ request, env }) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return new Response("Missing username or password", { status: 400 });
  }

  const { results } = await env.DB.prepare(
    "SELECT * FROM users WHERE username = ?"
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
    user: { id: user.id, username: user.username, role: user.role },
  });
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
