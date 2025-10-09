import bcrypt from "bcryptjs";
import jwt from "@tsndr/cloudflare-worker-jwt";

/**
 * Cloudflare Pages Function for user login
 */
export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    const { email, password } = await request.json();

    if (!email || !password) {
      return Response.json({ error: "Missing email or password" }, { status: 400 });
    }

    // Get user by email
    const user = await db
      .prepare("SELECT * FROM users WHERE email = ?")
      .bind(email)
      .first();

    if (!user) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // Compare hashed password
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // Create JWT token
    const token = await jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    return Response.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return Response.json({ error: "Server error", details: err.message }, { status: 500 });
  }
}
