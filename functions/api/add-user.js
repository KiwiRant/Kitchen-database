export async function onRequestPost({ request, env }) {
  const { username, password, role } = await request.json();

  if (!username || !password) {
    return new Response("Missing fields", { status: 400 });
  }

  const hash = await hashPassword(password);

  try {
    await env.DB.prepare(
      "INSERT INTO users (username, password, role) VALUES (?, ?, ?)"
    )
      .bind(username, hash, role || "user")
      .run();

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ success: false, error: e.message });
  }
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
