export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  const OWNER_USERNAME="itskillerultrayt";
  try {
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers});
    if(request.method!=="POST") return json({success:false,error:"Method not allowed."},405);
    const body=await request.json();
    const username=String(body.username||"").trim().slice(0,32);
    const authToken=String(body.authToken||"");
    const search=String(body.search||"").trim().slice(0,32);
    if(username!==OWNER_USERNAME||!authToken) return json({success:false,error:"Owner access denied."},403);
    const owner=await env.DB.prepare(`SELECT username FROM leaderboard WHERE username=? AND auth_token=?`).bind(OWNER_USERNAME,authToken).first();
    if(!owner) return json({success:false,error:"Invalid or expired owner session."},401);
    if(!search) return json({success:true,players:[]});
    const result=await env.DB.prepare(`SELECT username FROM leaderboard WHERE username != ? AND LOWER(username) LIKE LOWER(?) ORDER BY CASE WHEN LOWER(username)=LOWER(?) THEN 0 WHEN LOWER(username) LIKE LOWER(?) THEN 1 ELSE 2 END, username ASC LIMIT 10`).bind(OWNER_USERNAME,`%${search}%`,search,`${search}%`).all();
    const players=(result.results||[]).map(r=>String(r.username||"").trim()).filter(Boolean).filter(n=>n!==OWNER_USERNAME);
    return json({success:true,players});
  } catch(e) { return json({success:false,error:"Could not load player suggestions."},500); }
}
