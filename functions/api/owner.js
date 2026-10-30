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
    if (request.method !== "POST") return json({ success:false, error:"Method not allowed." }, 405);

    const body = await request.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const authToken = String(body.authToken || "");

    if (username !== OWNER_USERNAME) return json({ success:false, error:"Owner access denied." }, 403);
    if (!authToken) return json({ success:false, error:"You must be logged in." }, 401);

    // IMPORTANT: verify the exact owner account + current auth token before any action.
    const owner = await env.DB.prepare(
      `SELECT username FROM leaderboard WHERE username=? AND auth_token=?`
    ).bind(OWNER_USERNAME, authToken).first();
    if (!owner) return json({ success:false, error:"Invalid or expired owner session." }, 401);

    const action = String(body.action || "").trim();

    if (action === "get_stats") {
      return json({ success:true, username:OWNER_USERNAME, cash:0, punches:0, rebirths:0, rebirthTokens:0, message:"Owner access verified." });
    }

    if (action === "get_player") {
      const targetUsername = String(body.targetUsername || "").trim();
      if (!targetUsername) return json({ success:false, error:"Enter a player username." }, 400);
      const player = await env.DB.prepare(
        `SELECT username,cash,punches,rebirths,game_state,banned,banned_ip,last_ip FROM leaderboard WHERE username=?`
      ).bind(targetUsername).first();
      if (!player) return json({ success:false, error:"Player not found." }, 404);
      let gameState = {};
      try { gameState = player.game_state ? JSON.parse(player.game_state) : {}; } catch (_) {}
      return json({
        success:true, username:player.username, cash:Number(player.cash)||0, punches:Number(player.punches)||0,
        rebirths:Number(player.rebirths)||0, rebirthTokens:Number(gameState.rebirthTokens)||0,
        banned:!!Number(player.banned), bannedIp:!!Number(player.banned_ip), lastIp:player.last_ip || "unknown", gameState
      });
    }

    if (["set_stats","add_stats"].includes(action)) {
      const targetUsername = String(body.targetUsername || "").trim();
      if (!targetUsername) return json({ success:false, error:"Enter a player username." }, 400);
      if (targetUsername === OWNER_USERNAME) return json({ success:false, error:"Use the owner account separately." }, 400);
      const player = await env.DB.prepare(`SELECT cash,punches,rebirths,game_state FROM leaderboard WHERE username=?`).bind(targetUsername).first();
      if (!player) return json({ success:false, error:"Player not found." }, 404);
      let state = {}; try { state = player.game_state ? JSON.parse(player.game_state) : {}; } catch (_) {}
      const curCash=Math.max(0,Math.floor(Number(player.cash)||0)), curPunches=Math.max(0,Math.floor(Number(player.punches)||0)), curRebirths=Math.max(0,Math.floor(Number(player.rebirths)||0)), curTokens=Math.max(0,Math.floor(Number(state.rebirthTokens)||0));
      const cash=Math.max(0,Math.floor(action === "add_stats" ? curCash + (Number(body.cash)||0) : (Number(body.cash)||0)));
      const punches=Math.max(0,Math.floor(action === "add_stats" ? curPunches + (Number(body.punches)||0) : (Number(body.punches)||0)));
      const rebirths=Math.max(0,Math.floor(action === "add_stats" ? curRebirths + (Number(body.rebirths)||0) : (Number(body.rebirths)||0)));
      const tokens=Math.max(0,Math.floor(action === "add_stats" ? curTokens + (Number(body.rebirthTokens)||0) : (Number(body.rebirthTokens)||0)));
      state.cash=cash; state.totalPunches=punches; state.rebirths=rebirths; state.rebirthTokens=tokens; state.savedAt=Date.now();
      await env.DB.prepare(`UPDATE leaderboard SET cash=?,punches=?,rebirths=?,game_state=?,updated_at=? WHERE username=?`).bind(cash,punches,rebirths,JSON.stringify(state),Date.now(),targetUsername).run();
      return json({ success:true, username:targetUsername, cash,punches,rebirths,rebirthTokens:tokens, gameState:state });
    }

    if (action === "reset_progress") {
      const targetUsername=String(body.targetUsername||"").trim();
      if(!targetUsername) return json({success:false,error:"Enter a player username."},400);
      if(targetUsername===OWNER_USERNAME) return json({success:false,error:"Owner progress cannot be reset here."},400);
      const p=await env.DB.prepare(`SELECT username FROM leaderboard WHERE username=?`).bind(targetUsername).first();
      if(!p) return json({success:false,error:"Player not found."},404);
      const state={savedAt:Date.now(),cash:0,totalPunches:0,rebirths:0,rebirthTokens:0,upgrades:{},bags:{},activeBagSkin:"",tokenShop:{},lowGraphics:false,soundEnabled:true,punchingEnabled:true};
      await env.DB.prepare(`UPDATE leaderboard SET cash=0,punches=0,rebirths=0,game_state=?,updated_at=? WHERE username=?`).bind(JSON.stringify(state),Date.now(),targetUsername).run();
      return json({success:true,message:"Player progress completely reset.",username:targetUsername});
    }

    if (action === "delete_player") {
      const targetUsername=String(body.targetUsername||"").trim();
      if(!targetUsername) return json({success:false,error:"Enter a player username."},400);
      if(targetUsername===OWNER_USERNAME) return json({success:false,error:"You cannot delete the owner account."},400);
      const p=await env.DB.prepare(`SELECT username FROM leaderboard WHERE username=?`).bind(targetUsername).first();
      if(!p) return json({success:false,error:"Player not found."},404);
      await env.DB.prepare(`DELETE FROM leaderboard WHERE username=?`).bind(targetUsername).run();
      return json({success:true,message:"Player account deleted.",username:targetUsername});
    }

    if (action === "ban_player" || action === "unban_player") {
      const targetUsername=String(body.targetUsername||"").trim();
      if(!targetUsername) return json({success:false,error:"Enter a player username."},400);
      if(targetUsername===OWNER_USERNAME) return json({success:false,error:"You cannot ban the owner account."},400);
      const p=await env.DB.prepare(`SELECT username FROM leaderboard WHERE username=?`).bind(targetUsername).first();
      if(!p) return json({success:false,error:"Player not found."},404);
      const banned=action === "ban_player" ? 1 : 0;
      await env.DB.prepare(`UPDATE leaderboard SET banned=?,updated_at=? WHERE username=?`).bind(banned,Date.now(),targetUsername).run();
      return json({success:true,message:banned?"Player account banned.":"Player account unbanned.",username:targetUsername,banned:!!banned});
    }

    if (action === "ban_ip" || action === "unban_ip") {
      const targetUsername=String(body.targetUsername||"").trim();
      if(!targetUsername) return json({success:false,error:"Enter a player username."},400);
      if(targetUsername===OWNER_USERNAME) return json({success:false,error:"You cannot IP-ban the owner account."},400);
      const p=await env.DB.prepare(`SELECT username,last_ip FROM leaderboard WHERE username=?`).bind(targetUsername).first();
      if(!p) return json({success:false,error:"Player not found."},404);
      if(!p.last_ip || p.last_ip === "unknown") return json({success:false,error:"This player does not have a recorded IP yet."},400);
      const banned=action === "ban_ip" ? 1 : 0;
      await env.DB.prepare(`UPDATE leaderboard SET banned_ip=?,updated_at=? WHERE last_ip=?`).bind(banned,Date.now(),p.last_ip).run();
      return json({success:true,message:banned?"Player IP banned.":"Player IP unbanned.",username:targetUsername,bannedIp:!!banned});
    }

    return json({success:false,error:`Unknown owner action: ${action || "(empty)"}`},400);
  } catch (error) {
    return json({success:false,error:"Server error."},500);
  }
}
