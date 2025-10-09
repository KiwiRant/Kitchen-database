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
export async function onRequest({ request, env }) {
  if (request.method === "GET") {
    return handleGet(env, request);
  }

  if (request.method === "POST") {
    return handlePost(env, request);
  }

  return new Response("Method Not Allowed", { status: 405 });
}

async function handleGet(env, request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const jobName = url.searchParams.get("job_name");

  let query =
    "SELECT q.id, q.client_id, q.job_name, q.total_amount, q.notes, q.items_json, q.created_at, c.name AS client_name" +
    " FROM quotes q INNER JOIN clients c ON q.client_id = c.id";
  const params = [];
  const conditions = [];

  if (clientId) {
    conditions.push("q.client_id = ?");
    params.push(clientId);
  }

  if (jobName) {
    conditions.push("q.job_name = ?");
    params.push(jobName);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY datetime(q.created_at) DESC, q.id DESC";

  let statement = env.DB.prepare(query);
  if (params.length > 0) {
    statement = statement.bind(...params);
  }

  const { results } = await statement.all();
  const quotes = results.map(row => ({
    ...row,
    items: safeJsonParse(row.items_json),
  }));

  return Response.json({ success: true, quotes });
}

async function handlePost(env, request) {
  const body = await request.json().catch(() => ({}));
  const clientId = body.client_id;
  const jobName = typeof body.job_name === "string" ? body.job_name.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : null;

  if (!clientId || !jobName) {
    return Response.json(
      { success: false, message: "client_id and job_name are required" },
      { status: 400 }
    );
  }

  const clientExists = await env.DB.prepare(
    "SELECT id, name FROM clients WHERE id = ?"
  )
    .bind(clientId)
    .first();

  if (!clientExists) {
    return Response.json(
      { success: false, message: "Client not found" },
      { status: 404 }
    );
  }

  const { results: sales } = await env.DB.prepare(
    `SELECT id, description, amount, sale_date
       FROM sales
      WHERE client_id = ? AND job_name = ?
   ORDER BY datetime(sale_date) ASC, id ASC`
  )
    .bind(clientId, jobName)
    .all();

  if (!sales.length) {
    return Response.json(
      { success: false, message: "No sales found for this client and job" },
      { status: 400 }
    );
  }

  const totalAmount = sales.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const itemsJson = JSON.stringify(sales);

  try {
    const result = await env.DB.prepare(
      "INSERT INTO quotes (client_id, job_name, total_amount, notes, items_json) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(clientId, jobName, totalAmount, notes, itemsJson)
      .run();

    return Response.json({
      success: true,
      quote: {
        id: result.meta.last_row_id,
        client_id: clientId,
        job_name: jobName,
        total_amount: totalAmount,
        notes,
        items: sales,
      },
    });
  } catch (error) {
    return Response.json(
      { success: false, message: "Unable to create quote", error: error.message },
      { status: 500 }
    );
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value ?? "null");
  } catch (error) {
    return null;
  }
}
