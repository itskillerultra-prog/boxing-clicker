export async function onRequest(context) {
  const { request, env } = context;
  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  const cleanName = v => String(v || "").trim().slice(0, 16);
  const validName = n => /^[A-Za-z0-9 _-]{2,16}$/.test(n);
  const suggestions = name => {
    const base = name.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 13) || "Player";
    return [1,2,3,4,5,6].map(n => `${base}${n}`.slice(0, 16));
  };
  const b64 = bytes => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
  const bytes = str => { const s = atob(str), a = new Uint8Array(s.length); for (let i=0;i<s.length;i++) a[i]=s.charCodeAt(i); return a; };
  const randomB64 = (n=24) => { const a=new Uint8Array(n); crypto.getRandomValues(a); return b64(a); };
  async function hashPassword(password, saltB64) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({name:"PBKDF2", salt:bytes(saltB64), iterations:100000, hash:"SHA-256"}, key, 256);
    return b64(new Uint8Array(bits));
  }
  const safeEqual = (a,b) => { if(!a||!b||a.length!==b.length)return false; let x=0; for(let i=0;i<a.length;i++) x |= a.charCodeAt(i)^b.charCodeAt(i); return x===0; };
  const safeState = raw => { try { const x=typeof raw==='string'?JSON.parse(raw):raw; return x&&typeof x==='object'?x:null; } catch(_) { return null; } };

  async function ensureSchema() {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS leaderboard (username TEXT PRIMARY KEY,cash INTEGER NOT NULL DEFAULT 0,punches INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL)`).run();
    for (const sql of [
      `ALTER TABLE leaderboard ADD COLUMN player_id TEXT`,
      `ALTER TABLE leaderboard ADD COLUMN password_hash TEXT`,
      `ALTER TABLE leaderboard ADD COLUMN password_salt TEXT`,
      `ALTER TABLE leaderboard ADD COLUMN auth_token TEXT`,
      `ALTER TABLE leaderboard ADD COLUMN email TEXT`,
      `ALTER TABLE leaderboard ADD COLUMN phone TEXT`,
      `ALTER TABLE leaderboard ADD COLUMN rebirths INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE leaderboard ADD COLUMN game_state TEXT`,
      `ALTER TABLE leaderboard ADD COLUMN otp_hash TEXT`,
      `ALTER TABLE leaderboard ADD COLUMN otp_expires INTEGER`,
      `ALTER TABLE leaderboard ADD COLUMN otp_verified_phone TEXT`,
      `ALTER TABLE leaderboard ADD COLUMN last_ip TEXT`,
      `ALTER TABLE leaderboard ADD COLUMN banned INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE leaderboard ADD COLUMN banned_ip INTEGER NOT NULL DEFAULT 0`
    ]) { try { await env.DB.prepare(sql).run(); } catch (_) {} }
  }

  try {
    if (request.method === "OPTIONS") return new Response(null, {headers});
    await ensureSchema();

    if (request.method === "GET") {
      const url=new URL(request.url), check=cleanName(url.searchParams.get("check"));
      if(check){
        const row=await env.DB.prepare(`SELECT username FROM leaderboard WHERE username=?`).bind(check).first();
        return json({success:true,exists:!!row,suggestions:row?suggestions(check):[]});
      }
      const result=await env.DB.prepare(`SELECT username,cash,punches,rebirths FROM leaderboard ORDER BY cash DESC,rebirths DESC,punches DESC,username ASC LIMIT 100`).all();
      return json({success:true,players:result.results||[]});
    }

    if (request.method !== "POST") return json({success:false,error:"Method not allowed."},405);
    const body=await request.json();
    const action=String(body.action||"sync");

    const username=cleanName(body.username);
    const isBannedIP = await env.DB.prepare(`SELECT username FROM leaderboard WHERE banned_ip=1 AND last_ip=? LIMIT 1`).bind(clientIP).first();
    if (isBannedIP) return json({success:false,error:"This IP address is banned."},403);
    if(action === "register" || action === "login") {
      if(!validName(username)) return json({success:false,error:"Username must be 2–16 letters, numbers, spaces, _ or - only."},400);
      const password=String(body.password||""); if(password.length<4) return json({success:false,error:"Password must be at least 4 characters."},400);
      const existing=await env.DB.prepare(`SELECT * FROM leaderboard WHERE username=?`).bind(username).first();
      if (existing?.banned) return json({success:false,error:"This account is banned."},403);
      if(action === "register") {
        if(existing && existing.password_hash) return json({success:false,error:"That username is already taken.",suggestions:suggestions(username)},409);
        const salt=randomB64(16), hash=await hashPassword(password,salt), playerId=existing?.player_id||`p_${crypto.randomUUID()}`, token=randomB64(32);
        if(existing) await env.DB.prepare(`UPDATE leaderboard SET player_id=?,password_hash=?,password_salt=?,auth_token=?,last_ip=?,updated_at=? WHERE username=?`).bind(playerId,hash,salt,token,clientIP,Date.now(),username).run();
        else await env.DB.prepare(`INSERT INTO leaderboard(username,cash,punches,rebirths,updated_at,player_id,password_hash,password_salt,auth_token,game_state,last_ip) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(username,0,0,0,Date.now(),playerId,hash,salt,token,null,clientIP).run();
        return json({success:true,username,playerId,authToken:token,gameState:null});
      }
      if(!existing||!existing.password_hash) return json({success:false,error:"Account not found. Create this username first."},401);
      const hash=await hashPassword(password,existing.password_salt); if(!safeEqual(hash,existing.password_hash)) return json({success:false,error:"Wrong password."},401);
      const token=randomB64(32),playerId=existing.player_id||`p_${crypto.randomUUID()}`;
      await env.DB.prepare(`UPDATE leaderboard SET player_id=?,auth_token=?,last_ip=?,updated_at=? WHERE username=?`).bind(playerId,token,clientIP,Date.now(),username).run();
      return json({success:true,username,playerId,authToken:token,gameState:safeState(existing.game_state)});
    }

    if(action === "change_password") {
      const username=cleanName(body.username), token=String(body.authToken||"");
      const currentPassword=String(body.currentPassword||""), newPassword=String(body.newPassword||"");
      if(!token) return json({success:false,error:"Please log in first."},401);
      if(newPassword.length<4) return json({success:false,error:"New password must be at least 4 characters."},400);
      const row=await env.DB.prepare(`SELECT * FROM leaderboard WHERE username=? AND auth_token=?`).bind(username,token).first();
      if(!row || !row.password_hash) return json({success:false,error:"Session expired. Please log in again."},401);
      const currentHash=await hashPassword(currentPassword,row.password_salt);
      if(!safeEqual(currentHash,row.password_hash)) return json({success:false,error:"Current password is incorrect."},401);
      const salt=randomB64(16), hash=await hashPassword(newPassword,salt);
      await env.DB.prepare(`UPDATE leaderboard SET password_hash=?,password_salt=?,updated_at=? WHERE username=? AND auth_token=?`).bind(hash,salt,Date.now(),username,token).run();
      return json({success:true,message:"Password changed successfully."});
    }

    if(action === "delete_account") {
      const token=String(body.authToken||"");
      const deleteName=cleanName(body.username);
      if(!token || !validName(deleteName)) return json({success:false,error:"Please log in first."},401);
      const owner=await env.DB.prepare(`SELECT username FROM leaderboard WHERE username=? AND auth_token=?`).bind(deleteName,token).first();
      if(!owner) return json({success:false,error:"Session expired. Please log in again."},401);
      await env.DB.prepare(`DELETE FROM leaderboard WHERE username=? AND auth_token=?`).bind(deleteName,token).run();
      return json({success:true,message:"Profile deleted permanently."});
    }

    if(action === "rename") {
      const oldUsername=cleanName(body.oldUsername), newUsername=cleanName(body.newUsername), token=String(body.authToken||"");
      if(!validName(newUsername)) return json({success:false,error:"Use 2–16 letters, numbers, spaces, _ or - only."},400);
      const owner=await env.DB.prepare(`SELECT * FROM leaderboard WHERE username=? AND auth_token=?`).bind(oldUsername,token).first();
      if(!owner) return json({success:false,error:"Session expired. Please log in again."},401);
      if(oldUsername===newUsername) return json({success:true,username:newUsername});
      const taken=await env.DB.prepare(`SELECT username FROM leaderboard WHERE username=?`).bind(newUsername).first();
      if(taken) return json({success:false,error:"That username is already taken.",suggestions:suggestions(newUsername)},409);
      await env.DB.prepare(`UPDATE leaderboard SET username=?,updated_at=? WHERE username=? AND auth_token=?`).bind(newUsername,Date.now(),oldUsername,token).run();
      return json({success:true,username:newUsername});
    }

    if(action === "load_state") {
      const token=String(body.authToken||"");
      const loadName=cleanName(body.username);
      if(!token || !validName(loadName)) return json({success:false,error:"Please log in first."},401);

      const row=await env.DB.prepare(`SELECT username,cash,punches,rebirths,game_state,banned FROM leaderboard WHERE username=? AND auth_token=?`).bind(loadName,token).first();
      if(!row) return json({success:false,error:"Session expired. Please log in again."},401);
      if (row.banned) return json({success:false,error:"This account is banned."},403);

      await env.DB.prepare(`UPDATE leaderboard SET last_ip=? WHERE username=? AND auth_token=?`).bind(clientIP,loadName,token).run();

      return json({
        success:true,
        username:row.username,
        cash:Number(row.cash)||0,
        punches:Number(row.punches)||0,
        rebirths:Number(row.rebirths)||0,
        gameState:safeState(row.game_state)
      });
    }

    if(action === "sync") {
      const token=String(body.authToken||""); if(!token) return json({success:false,error:"Login required."},401);
      const row=await env.DB.prepare(`SELECT username,banned FROM leaderboard WHERE username=? AND auth_token=?`).bind(username,token).first(); if(!row) return json({success:false,error:"Session expired. Log in again."},401); if(row.banned) return json({success:false,error:"This account is banned."},403);
      const cash=Math.max(0,Math.floor(Number(body.cash)||0)), punches=Math.max(0,Math.floor(Number(body.punches)||0)), rebirths=Math.max(0,Math.floor(Number(body.rebirths)||0));
      const state=body.gameState&&typeof body.gameState==='object'?JSON.stringify(body.gameState):null;
      await env.DB.prepare(`UPDATE leaderboard SET cash=?,punches=?,rebirths=?,game_state=?,last_ip=?,updated_at=? WHERE username=? AND auth_token=?`).bind(cash,punches,rebirths,state,clientIP,Date.now(),username,token).run();
      return json({success:true});
    }
    return json({success:false,error:"Unknown action."},400);
  } catch(error) { return json({success:false,error:"Server error."},500); }
}
