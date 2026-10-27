export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  const OWNER_USERNAME = "itskillerultrayt";

  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);

    const body = await request.json();
    const username = String(body.username || "").trim();
    const authToken = String(body.authToken || "");
    const action = String(body.action || "");

    if (username !== OWNER_USERNAME) return json({ success: false, error: "Owner access denied." }, 403);
    if (!authToken) return json({ success: false, error: "You must be logged in." }, 401);

    const owner = await env.DB.prepare(
      `SELECT username FROM leaderboard WHERE username=? AND auth_token=?`
    ).bind(OWNER_USERNAME, authToken).first();
    if (!owner) return json({ success: false, error: "Invalid or expired owner session." }, 401);

    if (action === "get_stats") {
      const row = await env.DB.prepare(
        `SELECT username,cash,punches,rebirths,game_state FROM leaderboard WHERE username=?`
      ).bind(OWNER_USERNAME).first();
      if (!row) return json({ success: false, error: "Owner account not found." }, 404);
      let gs = {}; try { gs = row.game_state ? JSON.parse(row.game_state) : {}; } catch {}
      return json({ success: true, username: row.username, cash: Number(row.cash)||0, punches: Number(row.punches)||0, rebirths: Number(row.rebirths)||0, rebirthTokens: Number(gs.rebirthTokens)||0, gameState: gs });
    }

    const targetUsername = String(body.targetUsername || "").trim();
    if (["get_player","set_stats","add_stats","reset_progress","delete_player"].includes(action) && !targetUsername) {
      return json({ success: false, error: "Enter a player username." }, 400);
    }
    if (targetUsername === OWNER_USERNAME && ["set_stats","add_stats","reset_progress","delete_player"].includes(action)) {
      return json({ success: false, error: "Owner account cannot be changed with player actions." }, 400);
    }

    if (action === "get_player") {
      const player = await env.DB.prepare(
        `SELECT username,cash,punches,rebirths,game_state FROM leaderboard WHERE username=?`
      ).bind(targetUsername).first();
      if (!player) return json({ success: false, error: "Player not found." }, 404);
      let gameState = {}; try { gameState = player.game_state ? JSON.parse(player.game_state) : {}; } catch {}
      return json({ success: true, username: player.username, cash: Number(player.cash)||0, punches: Number(player.punches)||0, rebirths: Number(player.rebirths)||0, rebirthTokens: Number(gameState.rebirthTokens)||0, gameState });
    }

    if (action === "set_stats" || action === "add_stats") {
      const player = await env.DB.prepare(
        `SELECT username,cash,punches,rebirths,game_state FROM leaderboard WHERE username=?`
      ).bind(targetUsername).first();
      if (!player) return json({ success: false, error: "Player not found." }, 404);
      let gameState = {}; try { gameState = player.game_state ? JSON.parse(player.game_state) : {}; } catch {}
      const c = Math.max(0, Math.floor(Number(body.cash)||0));
      const p = Math.max(0, Math.floor(Number(body.punches)||0));
      const r = Math.max(0, Math.floor(Number(body.rebirths)||0));
      const t = Math.max(0, Math.floor(Number(body.rebirthTokens)||0));
      const cash = action === "add_stats" ? Math.max(0, Math.floor(Number(player.cash)||0)+c) : c;
      const punches = action === "add_stats" ? Math.max(0, Math.floor(Number(player.punches)||0)+p) : p;
      const rebirths = action === "add_stats" ? Math.max(0, Math.floor(Number(player.rebirths)||0)+r) : r;
      const tokens = action === "add_stats" ? Math.max(0, Math.floor(Number(gameState.rebirthTokens)||0)+t) : t;
      gameState.cash=cash; gameState.totalPunches=punches; gameState.rebirths=rebirths; gameState.rebirthTokens=tokens; gameState.savedAt=Date.now();
      await env.DB.prepare(`UPDATE leaderboard SET cash=?,punches=?,rebirths=?,game_state=?,updated_at=? WHERE username=?`)
        .bind(cash,punches,rebirths,JSON.stringify(gameState),Date.now(),targetUsername).run();
      return json({ success:true, message: action === "add_stats" ? "Player stats increased." : "Player stats updated.", username:targetUsername, cash,punches,rebirths,rebirthTokens:tokens,gameState });
    }

    if (action === "reset_progress") {
      const resetState = { savedAt:Date.now(),cash:0,totalPunches:0,rebirths:0,rebirthTokens:0,upgrades:{},bags:{},activeBagSkin:"canvas",tokenShop:{},lowGraphics:false,soundEnabled:true };
      await env.DB.prepare(`UPDATE leaderboard SET cash=0,punches=0,rebirths=0,game_state=?,updated_at=? WHERE username=?`)
        .bind(JSON.stringify(resetState),Date.now(),targetUsername).run();
      return json({ success:true, message:"Player progress completely reset.", username:targetUsername });
    }

    if (action === "delete_player") {
      const player = await env.DB.prepare(`SELECT username FROM leaderboard WHERE username=?`).bind(targetUsername).first();
      if (!player) return json({ success:false,error:"Player not found." },404);
      await env.DB.prepare(`DELETE FROM leaderboard WHERE username=?`).bind(targetUsername).run();
      return json({ success:true,message:"Player account deleted.",username:targetUsername });
    }

    return json({ success:false,error:`Unknown owner action: ${action || "(empty)"}` },400);
  } catch (error) {
    return json({ success:false,error:"Server error." },500);
  }
}
