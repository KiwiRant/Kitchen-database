import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcrypt';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    // LOGIN
    if (url.pathname === '/api/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    // ADD USER
    if (url.pathname === '/api/add-user' && request.method === 'POST') {
      const auth = await verifyAuth(request, env);
      if (!auth.ok) return auth.response;
      if (auth.role !== 'admin') return json({ success: false, message: 'Forbidden' }, 403);
      return handleAddUser(request, env);
    }

    // SALES
    if (url.pathname === '/api/sales') {
      const auth = await verifyAuth(request, env);
      if (!auth.ok) return auth.response;
      if (request.method === 'GET') return getSales(env);
      if (request.method === 'POST') return addSale(request, env, auth.email);
    }

    // QUOTES
    if (url.pathname === '/api/quotes') {
      const auth = await verifyAuth(request, env);
      if (!auth.ok) return auth.response;
      if (request.method === 'GET') return getQuotes(env);
      if (request.method === 'POST') return addQuote(request, env, auth.email);
    }

    return json({ success: false, message: 'Not found' }, 404);

  } catch (err) {
    console.error('API error:', err);
    return json({ success: false, message: 'Server error' }, 500);
  }
}

// --------------------
// LOGIN
// --------------------
async function handleLogin(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) return json({ success: false, message: 'Email and password required' }, 400);

  const user = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first();
  if (!user || !user.password) return json({ success: false, message: 'Invalid credentials' }, 401);

  const match = await bcrypt.compare(password, user.password);
  if (!match) return json({ success: false, message: 'Invalid credentials' }, 401);

  const token = await new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(env.JWT_SECRET));

  return json({ success: true, token });
}

// --------------------
// ADD USER
// --------------------
async function handleAddUser(request, env) {
  const { name, email, role, password } = await request.json();
  if (!name || !email || !role || !password) return json({ success: false, message: 'All fields required' }, 400);

  const hashed = await bcrypt.hash(password, 10);

  await env.DB.prepare(
    `INSERT INTO users (name, email, role, password) VALUES (?, ?, ?, ?)`
  ).bind(name, email, role, hashed).run();

  return json({ success: true, message: 'User created' });
}

// --------------------
// SALES
// --------------------
async function getSales(env) {
  const result = await env.DB.prepare(`SELECT * FROM sales ORDER BY created_at DESC`).all();
  return json({ success: true, sales: result.results || [] });
}

async function addSale(request, env, created_by) {
  const { customer_name, kitchen_model, price, details } = await request.json();
  if (!customer_name || !kitchen_model || !price) return json({ success: false, message: 'Missing fields' }, 400);

  await env.DB.prepare(
    `INSERT INTO sales (customer_name, kitchen_model, price, details, created_by) VALUES (?, ?, ?, ?, ?)`
  ).bind(customer_name, kitchen_model, price, details || '', created_by).run();

  return json({ success: true });
}

// --------------------
// QUOTES
// --------------------
async function getQuotes(env) {
  const result = await env.DB.prepare(`SELECT * FROM quotes ORDER BY created_at DESC`).all();
  return json({ success: true, quotes: result.results || [] });
}

async function addQuote(request, env, created_by) {
  const { sale_id, customer_name, kitchen_model, quote_total, notes } = await request.json();
  if (!sale_id || !customer_name || !kitchen_model || !quote_total) return json({ success: false, message: 'Missing fields' }, 400);

  await env.DB.prepare(
    `INSERT INTO quotes (sale_id, customer_name, kitchen_model, quote_total, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(sale_id, customer_name, kitchen_model, quote_total, notes || '', created_by).run();

  return json({ success: true });
}

// --------------------
// AUTH
// --------------------
async function verifyAuth(request, env) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return { ok: false, response: json({ success: false, message: 'Unauthorized' }, 401) };

  const token = header.split(' ')[1];
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
    return { ok: true, email: payload.email, role: payload.role };
  } catch {
    return { ok: false, response: json({ success: false, message: 'Invalid token' }, 401) };
  }
}

// --------------------
// HELPER JSON
// --------------------
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
