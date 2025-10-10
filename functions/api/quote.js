import {
  jsonResponse,
  readJson,
  requireDb,
  fetchAll,
  fetchOne,
  runStatement,
  formatLineItems,
} from './_utils.js';

export const onRequestGet = async ({ env }) => {
  try {
    const db = await requireDb(env);
    const quotes = await fetchAll(
      db,
      `SELECT q.id,
              q.client_id AS clientId,
              c.name AS clientName,
              q.job_name AS jobName,
              q.total,
              q.notes,
              q.details,
              q.status,
              q.created_at AS createdAt
         FROM quotes q
         LEFT JOIN clients c ON c.id = q.client_id
        ORDER BY q.created_at DESC`,
    );

    const hydrated = quotes.map((quote) => ({
      ...quote,
      details: quote.details ? JSON.parse(quote.details) : [],
    }));

    return jsonResponse(200, { quotes: hydrated });
  } catch (error) {
    return jsonResponse(error.status || 500, { error: error.message || 'Unable to load quotes.' });
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const payload = await readJson(request);
    const clientId = Number(payload.clientId || payload.client_id);
    const jobName = (payload.jobName || payload.job_name || '').trim();
    const notes = (payload.notes || '').trim();

    if (!clientId || Number.isNaN(clientId)) {
      return jsonResponse(400, { error: 'A valid client is required.' });
    }
    if (!jobName) {
      return jsonResponse(400, { error: 'A job name is required.' });
    }

    const db = await requireDb(env);

    const client = await fetchOne(db, 'SELECT id, name FROM clients WHERE id = ?', [clientId]);
    if (!client) {
      return jsonResponse(404, { error: 'Client not found.' });
    }

    const items = await fetchAll(
      db,
      `SELECT id, description, quantity, unit_price, total, created_at
         FROM sales
        WHERE client_id = ? AND lower(job_name) = lower(?)
        ORDER BY created_at ASC`,
      [clientId, jobName],
    );

    if (!items.length) {
      return jsonResponse(400, { error: 'No sales recorded for this client and job.' });
    }

    const total = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const detailPayload = JSON.stringify(formatLineItems(items));

    const result = await runStatement(
      db,
      `INSERT INTO quotes (client_id, job_name, total, notes, details)
       VALUES (?, ?, ?, ?, ?)`,
      [clientId, jobName, Math.round(total * 100) / 100, notes || null, detailPayload],
    );

    return jsonResponse(201, {
      success: true,
      quote: {
        id: result.lastInsertRowId,
        clientId,
        clientName: client.name,
        jobName,
        total: Math.round(total * 100) / 100,
        notes: notes || null,
        details: JSON.parse(detailPayload),
        status: 'draft',
      },
    });
  } catch (error) {
    return jsonResponse(error.status || 500, { error: error.message || 'Unable to create quote.' });
  }
};
