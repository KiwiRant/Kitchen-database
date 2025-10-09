import {
  getUsersTableMetadata,
  jsonResponse,
  parseJsonBody,
  verifyPassword,
} from "./_utils.js";

export async function onRequestPost({ request, env }) {
  const db = env.DB;

  if (!db) {
    return jsonResponse(
      { success: false, message: "Database binding DB is not configured" },
      { status: 500 }
    );
  }

  let payload;
  try {
    payload = await parseJsonBody(request);
  } catch (error) {
    return jsonResponse({ success: false, message: "Invalid request body" }, { status: 400 });
  }

  const identifier = ((payload.username ?? payload.email) || "").trim();
  const password = (payload.password ?? "").toString();

  if (!identifier || !password) {
    return jsonResponse({ success: false, message: "Missing username or password" }, { status: 400 });
  }

  let metadata;
  try {
    metadata = await getUsersTableMetadata(db);
  } catch (error) {
    return jsonResponse(
      { success: false, message: `Failed to inspect users table: ${error.message}` },
      { status: 500 }
    );
  }

  if (!metadata.identifierColumn) {
    return jsonResponse(
      { success: false, message: "Users table is missing login column" },
      { status: 500 }
    );
  }

  let user;
  try {
    user = await db
      .prepare(`SELECT * FROM users WHERE ${metadata.identifierColumn} = ? LIMIT 1`)
      .bind(identifier)
      .first();
  } catch (error) {
    return jsonResponse({ success: false, message: error.message }, { status: 500 });
  }

  if (!user) {
    return jsonResponse({ success: false, message: "User not found" }, { status: 404 });
  }

  const passwordMatches = await verifyPassword(password, user.password);
  if (!passwordMatches) {
    return jsonResponse({ success: false, message: "Invalid credentials" }, { status: 401 });
  }

  return jsonResponse({
    success: true,
    user: {
      id: user.id,
      username: user.username ?? user.email,
      role: user.role,
    },
  });
}
