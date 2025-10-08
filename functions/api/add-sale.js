export async function onRequestPost({ request, env }) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return new Response(JSON.stringify({ error: "Content-Type must be application/json" }), { status: 415 });
    }

    const data = await request.json();
    let { user_id, customer_name, kitchen_id, addons, sale_amount } = data ?? {};

    // Basic validation (tweak as needed)
    if (!user_id || !customer_name || !kitchen_id || sale_amount == null) {
      return new Response(JSON.stringify({ error: "Missing required fields: user_id, customer_name, kitchen_id, sale_amount" }), { status: 400 });
    }

    // Coerce numeric fields
    const kitchenIdNum = Number(kitchen_id);
    const saleAmountNum = Number(sale_amount);

    if (Number.isNaN(kitchenIdNum) || Number.isNaN(saleAmountNum)) {
      return new Response(JSON.stringify({ error: "kitchen_id and sale_amount must be numbers" }), { status: 400 });
    }

    // Ensure addons is text (string); empty string if undefined/null
    if (addons == null) addons = "";

    await env.DB
      .prepare(`
        INSERT INTO sales (user_id, customer_name, kitchen_id, addons, sale_amount)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(user_id, customer_name, kitchenIdNum, String(addons), saleAmountNum)
      .run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), { status: 500 });
  }
}
