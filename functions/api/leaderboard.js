export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create the leaderboard table if it does not exist
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS leaderboard (
        username TEXT PRIMARY KEY,
        cash INTEGER NOT NULL DEFAULT 0,
        punches INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `).run();

    // Get worldwide leaderboard
    if (request.method === "GET") {
      const result = await env.DB.prepare(`
        SELECT username, cash, punches
        FROM leaderboard
        ORDER BY cash DESC, punches DESC, username ASC
        LIMIT 100
      `).all();

      return new Response(
        JSON.stringify({
          success: true,
          players: result.results || []
        }),
        { headers: corsHeaders }
      );
    }

    // Submit/update player's score
    if (request.method === "POST") {
      const body = await request.json();

      const username = String(body.username || "").trim().slice(0, 16);
      const cash = Math.max(0, Math.floor(Number(body.cash) || 0));
      const punches = Math.max(0, Math.floor(Number(body.punches) || 0));

      if (username.length < 2) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Username must be at least 2 characters."
          }),
          { status: 400, headers: corsHeaders }
        );
      }

      await env.DB.prepare(`
        INSERT INTO leaderboard
          (username, cash, punches, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
          cash = excluded.cash,
          punches = excluded.punches,
          updated_at = excluded.updated_at
      `)
      .bind(username, cash, punches, Date.now())
      .run();

      return new Response(
        JSON.stringify({ success: true }),
        { headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Method not allowed."
      }),
      { status: 405, headers: corsHeaders }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Server error."
      }),
      { status: 500, headers: corsHeaders }
    );
  }
        }
