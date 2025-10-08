export async function onRequestPost({ request, env }) {
  const data = await request.json();
  const { user_id, customer_name, kitchen_id, addons, sale_amount } = data;

  try {
    await env.DB.prepare(`
      INSERT INTO sales (user_id, customer_name, kitchen_id, addons, sale_amount)
      VALUES (?, ?, ?, ?, ?)
    `).bind(user_id, customer_name, kitchen_id, addons, sale_amount).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
