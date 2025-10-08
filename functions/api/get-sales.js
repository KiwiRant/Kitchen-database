export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT s.id, s.customer_name, k.name AS kitchen, s.addons, s.sale_amount, s.sale_date
      FROM sales s
      JOIN kitchens k ON s.kitchen_id = k.id
      ORDER BY s.sale_date DESC
    `).all();

    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
