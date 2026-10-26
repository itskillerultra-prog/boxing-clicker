export async function onRequest(context) {
    const { request, env } = context;

    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
    };

    const json = (data, status = 200) =>
        new Response(JSON.stringify(data), { status, headers });

    const OWNER_USERNAME = "itskillerultrayt";

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

        // Only the exact founder account can use this API.
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

        // Check the real login session in D1.
        const owner = await env.DB.prepare(
            `SELECT username FROM leaderboard
             WHERE username=? AND auth_token=?`
        ).bind(username, authToken).first();

        if (!owner) {
            return json({
                success: false,
                error: "Invalid or expired owner session."
            }, 401);
        }

        const action = String(body.action || "");

        if (action === "set_stats") {
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

            await env.DB.prepare(
                `UPDATE leaderboard
                 SET cash=?, punches=?, rebirths=?, updated_at=?
                 WHERE username=? AND auth_token=?`
            ).bind(
                cash,
                punches,
                rebirths,
                Date.now(),
                username,
                authToken
            ).run();

            return json({
                success: true,
                message: "Owner stats updated.",
                cash,
                punches,
                rebirths
            });
        }

        if (action === "add_stats") {
            const cashAdd = Math.max(
                0,
                Math.floor(Number(body.cash) || 0)
            );

            const punchesAdd = Math.max(
                0,
                Math.floor(Number(body.punches) || 0)
            );

            const rebirthsAdd = Math.max(
                0,
                Math.floor(Number(body.rebirths) || 0)
            );

            const current = await env.DB.prepare(
                `SELECT cash, punches, rebirths
                 FROM leaderboard
                 WHERE username=? AND auth_token=?`
            ).bind(username, authToken).first();

            if (!current) {
                return json({
                    success: false,
                    error: "Owner account not found."
                }, 404);
            }

            const newCash =
                Math.max(0, Number(current.cash) || 0) + cashAdd;

            const newPunches =
                Math.max(0, Number(current.punches) || 0) + punchesAdd;

            const newRebirths =
                Math.max(0, Number(current.rebirths) || 0) + rebirthsAdd;

            await env.DB.prepare(
                `UPDATE leaderboard
                 SET cash=?, punches=?, rebirths=?, updated_at=?
                 WHERE username=? AND auth_token=?`
            ).bind(
                newCash,
                newPunches,
                newRebirths,
                Date.now(),
                username,
                authToken
            ).run();

            return json({
                success: true,
                message: "Owner stats increased.",
                cash: newCash,
                punches: newPunches,
                rebirths: newRebirths
            });
        }

        if (action === "get_stats") {
            const current = await env.DB.prepare(
                `SELECT username, cash, punches, rebirths
                 FROM leaderboard
                 WHERE username=? AND auth_token=?`
            ).bind(username, authToken).first();

            if (!current) {
                return json({
                    success: false,
                    error: "Owner account not found."
                }, 404);
            }

            return json({
                success: true,
                username: current.username,
                cash: Number(current.cash) || 0,
                punches: Number(current.punches) || 0,
                rebirths: Number(current.rebirths) || 0
            });
        }

        return json({
            success: false,
            error: "Unknown owner action."
        }, 400);

    } catch (error) {
        return json({
            success: false,
            error: "Server error."
        }, 500);
    }
          }
