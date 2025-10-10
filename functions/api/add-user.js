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
  quoteIdentifier,
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

    const identifierColumnQuoted = quoteIdentifier(meta.identifierColumn);
    const passwordColumnQuoted = quoteIdentifier(meta.passwordColumn);
    const nameColumnQuoted = meta.nameColumn ? quoteIdentifier(meta.nameColumn) : null;
    const roleColumnQuoted = meta.roleColumn ? quoteIdentifier(meta.roleColumn) : null;

    const duplicate = await fetchOne(
      db,
      `SELECT ${identifierColumnQuoted} AS identifier FROM users WHERE lower(${identifierColumnQuoted}) = lower(?)`,
      [identifier],
    );

    if (duplicate) {
      return jsonResponse(409, { error: 'A user with this identifier already exists.' });
    }

    const hashedPassword = await hashPassword(password);

    const columns = [
      { raw: meta.identifierColumn, quoted: identifierColumnQuoted, value: identifier },
      { raw: meta.passwordColumn, quoted: passwordColumnQuoted, value: hashedPassword },
    ];

    if (meta.nameColumn) {
      columns.push({ raw: meta.nameColumn, quoted: nameColumnQuoted, value: name || null });
    }
    if (meta.roleColumn) {
      columns.push({ raw: meta.roleColumn, quoted: roleColumnQuoted, value: role });
    }

    const placeholders = columns.map(() => '?').join(', ');
    const columnList = columns.map((col) => col.quoted).join(', ');
    const values = columns.map((col) => col.value);
    try {
      await runStatement(db, `INSERT INTO users (${columnList}) VALUES (${placeholders})`, values);
    } catch (dbError) {
      if (/NOT NULL constraint failed: users\./i.test(dbError.message || '')) {
        const columnMatch = dbError.message.match(/users\.([\w]+)/i);
        const columnName = columnMatch?.[1] ?? 'unknown column';
        return jsonResponse(400, {
          error: `The database requires a value for the ${columnName} column, which this form does not supply. ` +
            'Please make the column optional or add a default value in your schema.',
        });
      }
      throw dbError;
    }

    return jsonResponse(201, {
      success: true,
      user: {
        identifier,
        name: name || null,
        role,
      },
    });
  } catch (error) {
    let status = error.status || 500;
    let message = error.message || 'Unable to create user.';

    if (!error.status) {
      if (/UNIQUE constraint failed: users\./i.test(error.message || '')) {
        status = 409;
        message = 'A user with this identifier already exists.';
      } else if (/no such column: /i.test(error.message || '')) {
        status = 500;
        message = `The database schema is missing a required column: ${error.message.replace(/^.*no such column: /i, '')}.`;
      }
    }

    return jsonResponse(status, { error: message });
  }
};
