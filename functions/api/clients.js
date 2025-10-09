import { jsonResponse, parseJsonBody } from "./_utils.js";

export async function onRequest({ request, env }) {
  if (request.method === "GET") {
    return handleGet(env);
  }

  if (request.method === "POST") {
    return handlePost(env, request);
  }

  return jsonResponse({ success: false, message: "Method Not Allowed" }, { status: 405 });
}

async function handleGet(env) {
  if (!env.DB) {
    return jsonResponse(
      { success: false, message: "Database binding DB is not configured" },
      { status: 500 }
    );
  }

  const { results } = await env.DB.prepare(
    `SELECT c.id,
            c.name,
            c.email,
            c.phone,
            c.address,
            c.created_at,
            COALESCE(j.job_name, '') AS job_name,
            COALESCE(j.sale_count, 0) AS sale_count,
            COALESCE(j.total_amount, 0) AS total_amount
       FROM clients c
       LEFT JOIN (
         SELECT client_id,
                job_name,
                COUNT(*) AS sale_count,
                SUM(amount) AS total_amount
           FROM sales
          GROUP BY client_id, job_name
       ) j ON c.id = j.client_id
      ORDER BY c.name COLLATE NOCASE, job_name COLLATE NOCASE`
  ).all();

  const clientsMap = new Map();
  for (const row of results) {
    if (!clientsMap.has(row.id)) {
      clientsMap.set(row.id, {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        address: row.address,
        created_at: row.created_at,
        jobs: [],
      });
    }

    if (row.job_name) {
      clientsMap.get(row.id).jobs.push({
        job_name: row.job_name,
        sale_count: row.sale_count,
        total_amount: row.total_amount,
      });
    }
  }

  return jsonResponse({
    success: true,
    clients: Array.from(clientsMap.values()),
  });
}

async function handlePost(env, request) {
  if (!env.DB) {
    return jsonResponse(
      { success: false, message: "Database binding DB is not configured" },
      { status: 500 }
    );
  }

  const body = await parseJsonBody(request).catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : null;
  const phone = typeof body.phone === "string" ? body.phone.trim() : null;
  const address = typeof body.address === "string" ? body.address.trim() : null;

  if (!name) {
    return jsonResponse({ success: false, message: "Client name is required" }, { status: 400 });
  }

  try {
    const result = await env.DB.prepare(
      "INSERT INTO clients (name, email, phone, address) VALUES (?, ?, ?, ?)"
    )
      .bind(name, email, phone, address)
      .run();

    return jsonResponse({
      success: true,
      client: {
        id: result.meta.last_row_id,
        name,
        email,
        phone,
        address,
      },
    });
  } catch (error) {
    return jsonResponse(
      { success: false, message: "Unable to create client", error: error.message },
      { status: 500 }
    );
  }
}
