import {
  jsonResponse,
  readJson,
  requireDb,
  fetchAll,
  runStatement,
} from './_utils.js';

export const onRequestGet = async ({ env }) => {
  try {
    const db = await requireDb(env);
    const clients = await fetchAll(
      db,
      `SELECT c.id,
              c.name,
              c.contact_email AS email,
              c.contact_phone AS phone,
              c.notes,
              c.created_at AS createdAt,
              COALESCE(SUM(s.total), 0) AS totalSales,
              COUNT(DISTINCT s.job_name) AS jobCount
         FROM clients c
         LEFT JOIN sales s ON s.client_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC`,
    );

    return jsonResponse(200, { clients });
  } catch (error) {
    return jsonResponse(error.status || 500, { error: error.message || 'Unable to load clients.' });
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const payload = await readJson(request);
    const name = (payload.name || '').trim();
    const email = (payload.email || '').trim();
    const phone = (payload.phone || '').trim();
    const notes = (payload.notes || '').trim();

    if (!name) {
      return jsonResponse(400, { error: 'Client name is required.' });
    }

    const db = await requireDb(env);

    const result = await runStatement(
      db,
      `INSERT INTO clients (name, contact_email, contact_phone, notes) VALUES (?, ?, ?, ?)` ,
      [name, email || null, phone || null, notes || null],
    );

    return jsonResponse(201, {
      success: true,
      client: {
        id: result.lastInsertRowId,
        name,
        email: email || null,
        phone: phone || null,
        notes: notes || null,
      },
    });
  } catch (error) {
    return jsonResponse(error.status || 500, { error: error.message || 'Unable to create client.' });
  }
};
