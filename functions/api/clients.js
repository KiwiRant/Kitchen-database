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
export async function onRequest({ request, env }) {
  if (request.method === "GET") {
    return handleGet(env);
  }

  if (request.method === "POST") {
    return handlePost(env, request);
  }

  return new Response("Method Not Allowed", { status: 405 });
}

async function handleGet(env) {
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

  return Response.json({
    success: true,
    clients: Array.from(clientsMap.values()),
  });
}

async function handlePost(env, request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : null;
  const phone = typeof body.phone === "string" ? body.phone.trim() : null;
  const address = typeof body.address === "string" ? body.address.trim() : null;

  if (!name) {
    return Response.json(
      { success: false, message: "Client name is required" },
      { status: 400 }
    );
  }

  try {
    const result = await env.DB.prepare(
      "INSERT INTO clients (name, email, phone, address) VALUES (?, ?, ?, ?)"
    )
      .bind(name, email, phone, address)
      .run();

    return Response.json({
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
    return Response.json(
      { success: false, message: "Unable to create client", error: error.message },
      { status: 500 }
    );
  }
}
