import {
  getUsersTableMetadata,
  hashPassword,
  isNonEmptyString,
  jsonResponse,
  parseJsonBody,
} from "./_utils.js";

export async function onRequestPost({ request, env }) {
  const db = env.DB;

  if (!db) {
    return jsonResponse(
      { success: false, error: "Database binding DB is not configured" },
      { status: 500 }
    );
  }

  let payload;
  try {
    payload = await parseJsonBody(request);
  } catch (error) {
    return jsonResponse(
      { success: false, error: "Unable to read request body" },
      { status: 400 }
    );
  }

  const identifierInput = ((payload.username ?? payload.email) || "").trim();
  const passwordInput = (payload.password ?? "").toString();
  const nameInput = isNonEmptyString(payload.name) ? payload.name.trim() : "";
  const roleInput = isNonEmptyString(payload.role) ? payload.role.trim() : "";

  if (!identifierInput || !passwordInput) {
    return jsonResponse(
      { success: false, error: "Username/email and password are required" },
      { status: 400 }
    );
  }

  let metadata;
  try {
    metadata = await getUsersTableMetadata(db);
  } catch (error) {
    return jsonResponse(
      { success: false, error: `Failed to inspect users table: ${error.message}` },
      { status: 500 }
    );
  }

  if (!metadata.identifierColumn) {
    return jsonResponse(
      { success: false, error: "Users table must include a username or email column" },
      { status: 500 }
    );
  }

  if (!metadata.passwordColumn) {
    return jsonResponse(
      { success: false, error: "Users table is missing a password column" },
      { status: 500 }
    );
  }

  if (metadata.unsupportedRequiredColumns.length) {
    return jsonResponse(
      {
        success: false,
        error: `Unsupported required column(s) on users table: ${metadata.unsupportedRequiredColumns.join(", ")}`,
      },
      { status: 400 }
    );
  }

  try {
    const { results } = await db
      .prepare(`SELECT 1 FROM users WHERE ${metadata.identifierColumn} = ? LIMIT 1`)
      .bind(identifierInput)
      .all();
    if (results.length) {
      return jsonResponse(
        { success: false, error: "A user with that login already exists" },
        { status: 409 }
      );
    }
  } catch (error) {
    return jsonResponse(
      { success: false, error: `Failed to check for existing user: ${error.message}` },
      { status: 500 }
    );
  }

  const passwordHash = await hashPassword(passwordInput);

  const insertColumns = [metadata.identifierColumn, "password"];
  const insertValues = [identifierInput, passwordHash];

  if (metadata.columns.name) {
    const isRequired = metadata.columns.name.required;
    const value = nameInput || (isRequired ? identifierInput : "");
    if (isRequired && !value) {
      return jsonResponse(
        { success: false, error: "Full name is required" },
        { status: 400 }
      );
    }
    if (value) {
      insertColumns.push(metadata.columns.name.name);
      insertValues.push(value);
    }
  }

  if (metadata.columns.role) {
    const roleValue = roleInput || (metadata.columns.role.hasDefault ? "" : "user");
    if (metadata.columns.role.required && !roleValue) {
      return jsonResponse({ success: false, error: "Role is required" }, { status: 400 });
    }
    if (roleValue) {
      insertColumns.push("role");
      insertValues.push(roleValue);
    }
  }

  const statement = `INSERT INTO users (${insertColumns.join(", ")}) VALUES (${insertColumns
    .map(() => "?")
    .join(", ")})`;

  try {
    const result = await db.prepare(statement).bind(...insertValues).run();
    return jsonResponse({
      success: true,
      user: {
        id: result.meta?.last_row_id ?? null,
        username: identifierInput,
        role: insertColumns.includes("role")
          ? insertValues[insertColumns.indexOf("role")]
          : undefined,
      },
    });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, { status: 500 });
  }
}
