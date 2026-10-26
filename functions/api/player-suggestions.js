export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers
    });

  try {
    const body = await request.json();

    const search = String(body.search || "").trim();

    if (!search) {
      return json({
        success: true,
        players: []
      });
    }

    const result = await env.DB.prepare(`
      SELECT username
      FROM leaderboard
      WHERE LOWER(username) LIKE LOWER(?)
      ORDER BY username ASC
      LIMIT 8
    `)
      .bind(search + "%")
      .all();

    return json({
      success: true,
      players: (result.results || []).map(row => row.username)
    });

  } catch (error) {
    return json({
      success: false,
      error: "Server error."
    }, 500);
  }
      }
