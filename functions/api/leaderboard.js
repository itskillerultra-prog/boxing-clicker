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
    // Create leaderboard table if it doesn't exist
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS leaderboard (
        username TEXT PRIMARY KEY,
        cash INTEGER NOT NULL DEFAULT 0,
        punches INTEGER NOT NULL DEFAULT 0,
        rebirths INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `).run();

    // Add rebirths column to older databases
    try {
      await env.DB.prepare(`
        ALTER TABLE leaderboard
        ADD COLUMN rebirths INTEGER NOT NULL DEFAULT 0
      `).run();
    } catch (e) {
      // Column already exists — that's okay.
    }

    // GET = load worldwide leaderboard
    if (request.method === "GET") {
      const result = await env.DB.prepare(`
        SELECT
          username,
          cash,
          punches,
          rebirths
        FROM leaderboard
        ORDER BY
          cash DESC,
          rebirths DESC,
          punches DESC,
          username ASC
        LIMIT 100
      `).all();

      return new Response(
        JSON.stringify({
          success: true,
          players: result.results || []
        }),
        {
          headers: corsHeaders
        }
      );
    }

    // POST = save/update player's leaderboard data
    if (request.method === "POST") {
      const body = await request.json();

      const username = String(body.username || "")
        .trim()
        .slice(0, 16);

      const cash = Math.max(
        0,
        Math.floor(Number(body.cash) || 0)
      );

      const punches = Math.max(
        0,
        Math.floor(Number(body.punches) || 0)
      );

      const rebirths = Math.max(
        0,
        Math.floor(Number(body.rebirths) || 0)
      );

      if (username.length < 2) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Username must be at least 2 characters."
          }),
          {
            status: 400,
            headers: corsHeaders
          }
        );
      }

      await env.DB.prepare(`
        INSERT INTO leaderboard
          (
            username,
            cash,
            punches,
            rebirths,
            updated_at
          )
        VALUES (?, ?, ?, ?, ?)

        ON CONFLICT(username) DO UPDATE SET
          cash = excluded.cash,
          punches = excluded.punches,
          rebirths = excluded.rebirths,
          updated_at = excluded.updated_at
      `)
        .bind(
          username,
          cash,
          punches,
          rebirths,
          Date.now()
        )
        .run();

      return new Response(
        JSON.stringify({
          success: true
        }),
        {
          headers: corsHeaders
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Method not allowed."
      }),
      {
        status: 405,
        headers: corsHeaders
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Server error."
      }),
      {
        status: 500,
        headers: corsHeaders
      }
    );
  }
}
