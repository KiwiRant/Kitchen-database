import { jsonResponse, parseJsonBody } from "./_utils.js";

export async function onRequest({ request, env }) {
  if (request.method === "GET") {
    return handleGet(env, request);
  }

  if (request.method === "POST") {
    return handlePost(env, request);
  }

  return jsonResponse({ success: false, message: "Method Not Allowed" }, { status: 405 });
}

async function handleGet(env, request) {
  if (!env.DB) {
    return jsonResponse(
      { success: false, message: "Database binding DB is not configured" },
      { status: 500 }
    );
  }

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

  return jsonResponse({ success: true, sales: results });
}

async function handlePost(env, request) {
  if (!env.DB) {
    return jsonResponse(
      { success: false, message: "Database binding DB is not configured" },
      { status: 500 }
    );
  }

  const body = await parseJsonBody(request).catch(() => ({}));
  const clientId = body.client_id;
  const jobName = typeof body.job_name === "string" ? body.job_name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const amount = Number(body.amount);
  const saleDate = body.sale_date ? new Date(body.sale_date) : new Date();

  if (!clientId || !jobName || !description || Number.isNaN(amount)) {
    return jsonResponse(
      {
        success: false,
        message: "client_id, job_name, description and amount are required",
      },
      { status: 400 }
    );
  }

  if (amount < 0) {
    return jsonResponse(
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

    return jsonResponse({
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
    return jsonResponse(
      { success: false, message: "Unable to record sale", error: error.message },
      { status: 500 }
    );
  }
}
