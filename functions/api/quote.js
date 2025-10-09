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
