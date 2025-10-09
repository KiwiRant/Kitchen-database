import {
  jsonResponse,
  readJson,
  requireDb,
  getUsersMetadata,
  normaliseIdentifier,
  normaliseName,
  normaliseRole,
  hashPassword,
  fetchOne,
  runStatement,
} from './_utils.js';

export const onRequestPost = async ({ request, env }) => {
  try {
    const payload = await readJson(request);
    const identifier = normaliseIdentifier(payload.identifier || payload.username || payload.email);
    const password = (payload.password || '').trim();
    const name = normaliseName(payload.name);
    const role = normaliseRole(payload.role);

    if (!identifier) {
      return jsonResponse(400, { error: 'A username or email is required.' });
    }
    if (!password) {
      return jsonResponse(400, { error: 'A password is required.' });
    }

    const db = await requireDb(env);
    const meta = await getUsersMetadata(db);

    if (meta.required.includes(meta.nameColumn) && !name) {
      return jsonResponse(400, { error: 'A full name is required for this database schema.' });
    }
    if (meta.required.includes(meta.roleColumn) && !role) {
      return jsonResponse(400, { error: 'A role value is required for this database schema.' });
    }

    const duplicate = await fetchOne(
      db,
      `SELECT ${meta.identifierColumn} AS identifier FROM users WHERE lower(${meta.identifierColumn}) = lower(?)`,
      [identifier],
    );

    if (duplicate) {
      return jsonResponse(409, { error: 'A user with this identifier already exists.' });
    }

    const hashedPassword = await hashPassword(password);

    const columns = [meta.identifierColumn, meta.passwordColumn];
    const values = [identifier, hashedPassword];

    if (meta.nameColumn) {
      columns.push(meta.nameColumn);
      values.push(name || null);
    }
    if (meta.roleColumn) {
      columns.push(meta.roleColumn);
      values.push(role);
    }

    const placeholders = columns.map(() => '?').join(', ');
    await runStatement(db, `INSERT INTO users (${columns.join(', ')}) VALUES (${placeholders})`, values);

    return jsonResponse(201, {
      success: true,
      user: {
        identifier,
        name: name || null,
        role,
      },
    });
  } catch (error) {
    const status = error.status || 500;
    return jsonResponse(status, { error: error.message || 'Unable to create user.' });
  }
};
