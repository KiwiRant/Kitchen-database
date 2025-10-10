import {
  jsonResponse,
  readJson,
  requireDb,
  fetchAll,
  fetchOne,
  runStatement,
} from './_utils.js';

export const onRequestGet = async ({ env }) => {
  try {
    const db = await requireDb(env);
    const sales = await fetchAll(
      db,
      `SELECT s.id,
              s.client_id AS clientId,
              c.name AS clientName,
              s.job_name AS jobName,
              s.description,
              s.quantity,
              s.unit_price AS unitPrice,
              s.total,
              s.created_at AS createdAt
         FROM sales s
         LEFT JOIN clients c ON c.id = s.client_id
        ORDER BY s.created_at DESC`,
    );

    return jsonResponse(200, { sales });
  } catch (error) {
    return jsonResponse(error.status || 500, { error: error.message || 'Unable to load sales.' });
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const payload = await readJson(request);
    const clientId = Number(payload.clientId || payload.client_id);
    const jobName = (payload.jobName || payload.job_name || '').trim();
    const description = (payload.description || '').trim();
    const quantityValue = Number(payload.quantity || 1);
    const unitPriceValue = Number(payload.unitPrice || payload.unit_price || 0);

    if (!clientId || Number.isNaN(clientId)) {
      return jsonResponse(400, { error: 'A valid client is required.' });
    }
    if (!jobName) {
      return jsonResponse(400, { error: 'A job name is required.' });
    }
    if (!description) {
      return jsonResponse(400, { error: 'A description is required.' });
    }
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      return jsonResponse(400, { error: 'Quantity must be greater than zero.' });
    }
    if (!Number.isFinite(unitPriceValue) || unitPriceValue < 0) {
      return jsonResponse(400, { error: 'Unit price must be zero or higher.' });
    }

    const quantity = Math.round(quantityValue * 100) / 100;
    const unitPrice = Math.round(unitPriceValue * 100) / 100;
    const total = Math.round(quantity * unitPrice * 100) / 100;

    const db = await requireDb(env);

    const client = await fetchOne(db, 'SELECT id FROM clients WHERE id = ?', [clientId]);
    if (!client) {
      return jsonResponse(404, { error: 'Client not found.' });
    }

    const result = await runStatement(
      db,
      `INSERT INTO sales (client_id, job_name, description, quantity, unit_price, total)
       VALUES (?, ?, ?, ?, ?, ?)` ,
      [clientId, jobName, description, quantity, unitPrice, total],
    );

    return jsonResponse(201, {
      success: true,
      sale: {
        id: result.lastInsertRowId,
        clientId,
        jobName,
        description,
        quantity,
        unitPrice,
        total,
      },
    });
  } catch (error) {
    return jsonResponse(error.status || 500, { error: error.message || 'Unable to record sale.' });
  }
};
