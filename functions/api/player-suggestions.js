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
        if (request.method === "OPTIONS") {
            return new Response(null, { headers });
        }

        if (request.method !== "POST") {
            return json({
                success: false,
                error: "Method not allowed."
            }, 405);
        }

        const body = await request.json();

        const username = String(body.username || "").trim();
        const authToken = String(body.authToken || "");
        const search = String(body.search || "").trim();

        const OWNER_USERNAME = "itskillerultrayt";

        if (username !== OWNER_USERNAME) {
            return json({
                success: false,
                error: "Owner access denied."
            }, 403);
        }

        if (!authToken) {
            return json({
                success: false,
                error: "You must be logged in."
            }, 401);
        }

        const owner = await env.DB.prepare(
            `SELECT username
             FROM leaderboard
             WHERE username=? AND auth_token=?`
        ).bind(username, authToken).first();

        if (!owner) {
            return json({
                success: false,
                error: "Invalid owner session."
            }, 401);
        }

        if (!search) {
            return json({
                success: true,
                players: []
            });
        }

        const result = await env.DB.prepare(
            `SELECT username
             FROM leaderboard
             WHERE LOWER(username) LIKE LOWER(?)
             ORDER BY username ASC
             LIMIT 8`
        ).bind(search + "%").all();

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
