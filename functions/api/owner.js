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
            return json({ success: false, error: "Method not allowed." }, 405);
        }

        const body = await request.json();

        const username = String(body.username || "").trim();
        const authToken = String(body.authToken || "");

        // Only the real founder account can use this API.
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

        // Verify the real owner login session.
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

        // --------------------------------
        // BAN / UNBAN PLAYER
        // --------------------------------
        if (action === "ban_player" || action === "unban_player" || action === "ban_ip" || action === "unban_ip") {
            const targetUsername = String(body.targetUsername || "").trim();
            if (!targetUsername) return json({success:false,error:"Enter a player username."},400);
            if (targetUsername === OWNER_USERNAME) return json({success:false,error:"You cannot ban the owner account."},400);
            const player = await env.DB.prepare(`SELECT username,last_ip,banned,banned_ip FROM leaderboard WHERE username=?`).bind(targetUsername).first();
            if (!player) return json({success:false,error:"Player not found."},404);
            const setBan = action === "ban_player" || action === "ban_ip";
            if (action === "ban_ip" || action === "unban_ip") {
                await env.DB.prepare(`UPDATE leaderboard SET banned_ip=? WHERE username=?`).bind(setBan ? 1 : 0,targetUsername).run();
            } else {
                await env.DB.prepare(`UPDATE leaderboard SET banned=? WHERE username=?`).bind(setBan ? 1 : 0,targetUsername).run();
            }
            return json({success:true,username:targetUsername,banned:action.includes("player")?setBan:!!player.banned,bannedIp:action.includes("_ip")?setBan:!!player.banned_ip,message:setBan?"Ban applied.":"Ban removed."});
        }


        // --------------------------------
        // GET A PLAYER
        // --------------------------------
        if (action === "get_player") {
            const targetUsername = String(body.targetUsername || "").trim();

            if (!targetUsername) {
                return json({
                    success: false,
                    error: "Enter a player username."
                }, 400);
            }

            const player = await env.DB.prepare(
                `SELECT username, cash, punches, rebirths, rebirths,
                        rebirths, game_state
                 FROM leaderboard
                 WHERE username=?`
            ).bind(targetUsername).first();

            if (!player) {
                return json({
                    success: false,
                    error: "Player not found."
                }, 404);
            }

            let gameState = {};

            try {
                gameState = player.game_state
                    ? JSON.parse(player.game_state)
                    : {};
            } catch (e) {
                gameState = {};
            }

            return json({
                success: true,
                username: player.username,
                cash: Number(player.cash) || 0,
                punches: Number(player.punches) || 0,
                rebirths: Number(player.rebirths) || 0,
                rebirthTokens: Number(gameState.rebirthTokens) || 0,
                gameState
            });
        }

        // --------------------------------
        // SET PLAYER STATS
        // --------------------------------
        if (action === "set_stats") {
            const targetUsername = String(body.targetUsername || "").trim();

            if (!targetUsername) {
                return json({
                    success: false,
                    error: "Enter a player username."
                }, 400);
            }

            if (targetUsername === OWNER_USERNAME) {
                return json({
                    success: false,
                    error: "Use the owner account separately."
                }, 400);
            }

            const player = await env.DB.prepare(
                `SELECT game_state FROM leaderboard
                 WHERE username=?`
            ).bind(targetUsername).first();

            if (!player) {
                return json({
                    success: false,
                    error: "Player not found."
                }, 404);
            }

            let gameState = {};

            try {
                gameState = player.game_state
                    ? JSON.parse(player.game_state)
                    : {};
            } catch (e) {
                gameState = {};
            }

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

            const rebirthTokens = Math.max(
                0,
                Math.floor(Number(body.rebirthTokens) || 0)
            );

            gameState.cash = cash;
            gameState.totalPunches = punches;
            gameState.rebirths = rebirths;
            gameState.rebirthTokens = rebirthTokens;
            gameState.savedAt = Date.now();

            await env.DB.prepare(
                `UPDATE leaderboard
                 SET cash=?, punches=?, rebirths=?, game_state=?, updated_at=?
                 WHERE username=?`
            ).bind(
                cash,
                punches,
                rebirths,
                JSON.stringify(gameState),
                Date.now(),
                targetUsername
            ).run();

            return json({
                success: true,
                message: "Player stats updated.",
                username: targetUsername,
                cash,
                punches,
                rebirths,
                rebirthTokens
            });
        }

        // --------------------------------
        // RESET COMPLETE GAME PROGRESS
        // --------------------------------
        if (action === "reset_progress") {
            const targetUsername = String(body.targetUsername || "").trim();

            if (!targetUsername) {
                return json({
                    success: false,
                    error: "Enter a player username."
                }, 400);
            }

            if (targetUsername === OWNER_USERNAME) {
                return json({
                    success: false,
                    error: "Owner progress cannot be reset here."
                }, 400);
            }

            const player = await env.DB.prepare(
                `SELECT username FROM leaderboard
                 WHERE username=?`
            ).bind(targetUsername).first();

            if (!player) {
                return json({
                    success: false,
                    error: "Player not found."
                }, 404);
            }

            const resetState = {
                savedAt: Date.now(),
                cash: 0,
                totalPunches: 0,
                rebirths: 0,
                rebirthTokens: 0,
                upgrades: {},
                bags: {},
                activeBagSkin: "",
                tokenShop: {},
                lowGraphics: false,
                soundEnabled: true
            };

            await env.DB.prepare(
                `UPDATE leaderboard
                 SET cash=0, punches=0, rebirths=0,
                     game_state=?, updated_at=?
                 WHERE username=?`
            ).bind(
                JSON.stringify(resetState),
                Date.now(),
                targetUsername
            ).run();

            return json({
                success: true,
                message: "Player progress completely reset.",
                username: targetUsername
            });
        }

        // --------------------------------
        // DELETE PLAYER ACCOUNT
        // --------------------------------
        if (action === "delete_player") {
            const targetUsername = String(body.targetUsername || "").trim();

            if (!targetUsername) {
                return json({
                    success: false,
                    error: "Enter a player username."
                }, 400);
            }

            if (targetUsername === OWNER_USERNAME) {
                return json({
                    success: false,
                    error: "You cannot delete the owner account."
                }, 400);
            }

            const player = await env.DB.prepare(
                `SELECT username FROM leaderboard
                 WHERE username=?`
            ).bind(targetUsername).first();

            if (!player) {
                return json({
                    success: false,
                    error: "Player not found."
                }, 404);
            }

            await env.DB.prepare(
                `DELETE FROM leaderboard
                 WHERE username=?`
            ).bind(targetUsername).run();

            return json({
                success: true,
                message: "Player account deleted.",
                username: targetUsername
            });
        }

        // --------------------------------
        // ADD STATS
        // --------------------------------
        if (action === "add_stats") {
            const targetUsername = String(body.targetUsername || "").trim();

            if (!targetUsername) {
                return json({
                    success: false,
                    error: "Enter a player username."
                }, 400);
            }

            if (targetUsername === OWNER_USERNAME) {
                return json({
                    success: false,
                    error: "Use the owner account separately."
                }, 400);
            }

            const player = await env.DB.prepare(
                `SELECT cash, punches, rebirths, game_state
                 FROM leaderboard
                 WHERE username=?`
            ).bind(targetUsername).first();

            if (!player) {
                return json({
                    success: false,
                    error: "Player not found."
                }, 404);
            }

            let gameState = {};

            try {
                gameState = player.game_state
                    ? JSON.parse(player.game_state)
                    : {};
            } catch (e) {
                gameState = {};
            }

            const cashAdd = Number(body.cash) || 0;
            const punchesAdd = Number(body.punches) || 0;
            const rebirthsAdd = Number(body.rebirths) || 0;
            const tokensAdd = Number(body.rebirthTokens) || 0;

            const newCash = Math.max(
                0,
                Math.floor(Number(player.cash) || 0) + Math.floor(cashAdd)
            );

            const newPunches = Math.max(
                0,
                Math.floor(Number(player.punches) || 0) + Math.floor(punchesAdd)
            );

            const newRebirths = Math.max(
                0,
                Math.floor(Number(player.rebirths) || 0) + Math.floor(rebirthsAdd)
            );

            const newTokens = Math.max(
                0,
                Math.floor(Number(gameState.rebirthTokens) || 0) + Math.floor(tokensAdd)
            );

            gameState.cash = newCash;
            gameState.totalPunches = newPunches;
            gameState.rebirths = newRebirths;
            gameState.rebirthTokens = newTokens;
            gameState.savedAt = Date.now();

            await env.DB.prepare(
                `UPDATE leaderboard
                 SET cash=?, punches=?, rebirths=?, game_state=?, updated_at=?
                 WHERE username=?`
            ).bind(
                newCash,
                newPunches,
                newRebirths,
                JSON.stringify(gameState),
                Date.now(),
                targetUsername
            ).run();

            return json({
                success: true,
                message: "Player stats increased.",
                username: targetUsername,
                cash: newCash,
                punches: newPunches,
                rebirths: newRebirths,
                rebirthTokens: newTokens
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
