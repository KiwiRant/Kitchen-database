import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcrypt';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { pathname } = url;

  // --- LOGIN ---
  if (pathname === '/api/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }

  // --- ADD USER (admin only) ---
  if (pathname === '/api/add-user' && request.method === 'POST') {
    const auth = await verifyAuth(request, env);
    if (!auth.ok) return auth.response;
    return handleAddUser(request, env, auth.user);
  }

  // --- SALES ---
  if (pathname === '/api/sales') {
    const auth = await verifyAuth(request, env);
    if (!auth.ok) return auth.response;

    if (request.method === 'GET') return getSales(env);
    if (request.method === 'POST') return addSale(request, env, auth.user);
  }

  // --- QUOTES ---
  if (pathname === '/api/quotes') {
    const auth = await verifyAuth(request, env);
    if (!auth.ok) return auth.response;

    if (request.method === 'GET') return getQuotes(env);
    if (request.method === 'POST') return addQuote(request, env, auth.user);
  }

  return new Response('Not found', { status: 404 });
}

// --------------------
// LOGIN HANDLER
// --------------------
async function handleLogin(request, env) {
  const { email, password } = await request.json();

  const user = await env.DB.prepare(
    `SELECT * FROM users WHERE email = ?`
  ).bind(email).first();

  if (!user) return json({ success: false, message: 'Invalid credentials' }, 401);

  const match = await bcrypt.compare(password, user.password);
  if (!match) return json({ success: false, message: 'Invalid credentials' }, 401);

  const token = await new SignJWT({ email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(env.JWT_SECRET));

  return json({ success: true, token });
}

// --------------------
// ADD USER HANDLER (admin)
// --------------------
async function handleAddUser(request, env, authUserEmail) {
  const { name, email, role, password } = await request.json();

  const hashed = await bcrypt.hash(password, 10);

  await env.DB.prepare(
    `INSERT INTO users (name, email, role, password) VALUES (?, ?, ?, ?)`
  ).bind(name, email, role, hashed).run();

  return json({ success: true, message: 'User created' });
}

// --------------------
// AUTH VERIFICATION
// --------------------
async function verifyAuth(request, env) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return { ok: false, response: json({ error: 'Unauthorized' }, 401) };
  }

  const token = header.split(' ')[1];
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(env.JWT_SECRET)
    );
    return { ok: true, user: payload.email, role: payload.role };
  } catch {
    return { ok: false, response: json({ error: 'Invalid token' }, 401) };
  }
}

// --------------------
// SALES HANDLERS
// --------------------
async function getSales(env) {
  const result = await env.DB.prepare(
    `SELECT * FROM sales ORDER BY created_at DESC`
  ).all();
  return json(result.results || []);
}

async function addSale(request, env, username) {
  const { customer_name, kitchen_model, price, details } = await request.json();

  await env.DB.prepare(
    `INSERT INTO sales (customer_name, kitchen_model, price, details, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(customer_name, kitchen_model, price, details, username).run();

  return json({ success: true });
}

// --------------------
// QUOTES HANDLERS
// --------------------
async function getQuotes(env) {
  const result = await env.DB.prepare(
    `SELECT * FROM quotes ORDER BY created_at DESC`
  ).all();
  return json(result.results || []);
}

async function addQuote(request, env, username) {
  const { sale_id, customer_name, kitchen_model, quote_total, notes } = await request.json();

  await env.DB.prepare(
    `INSERT INTO quotes (sale_id, customer_name, kitchen_model, quote_total, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(sale_id, customer_name, kitchen_model, quote_total, notes, username).run();

  return json({ success: true });
}

// --------------------
// HELPER FUNCTION
// --------------------
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
