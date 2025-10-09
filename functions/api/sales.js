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
    "SELECT s.id, s.client_id, s.job_name, s.description, s.amount, s.sale_date, s.created_at, c.name AS client_name" +
    " FROM sales s INNER JOIN clients c ON s.client_id = c.id";
  const params = [];
  const conditions = [];

  if (clientId) {
    conditions.push("s.client_id = ?");
    params.push(clientId);
  }

  if (jobName) {
    conditions.push("s.job_name = ?");
    params.push(jobName);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY datetime(s.sale_date) DESC, s.id DESC";

  let statement = env.DB.prepare(query);
  if (params.length > 0) {
    statement = statement.bind(...params);
  }

  const { results } = await statement.all();

  return Response.json({ success: true, sales: results });
}

async function handlePost(env, request) {
  const body = await request.json().catch(() => ({}));
  const clientId = body.client_id;
  const jobName = typeof body.job_name === "string" ? body.job_name.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const amount = Number(body.amount);
  const saleDate = body.sale_date ? new Date(body.sale_date) : new Date();

  if (!clientId || !jobName || !description || Number.isNaN(amount)) {
    return Response.json(
      {
        success: false,
        message: "client_id, job_name, description and amount are required",
      },
      { status: 400 }
    );
  }

  if (amount < 0) {
    return Response.json(
      { success: false, message: "Amount must be greater than or equal to 0" },
      { status: 400 }
    );
  }

  const saleDateString = saleDate.toISOString();

  try {
    const result = await env.DB.prepare(
      "INSERT INTO sales (client_id, job_name, description, amount, sale_date) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(clientId, jobName, description, amount, saleDateString)
      .run();

    return Response.json({
      success: true,
      sale: {
        id: result.meta.last_row_id,
        client_id: clientId,
        job_name: jobName,
        description,
        amount,
        sale_date: saleDateString,
      },
    });
  } catch (error) {
    return Response.json(
      { success: false, message: "Unable to record sale", error: error.message },
      { status: 500 }
    );
  }
}
