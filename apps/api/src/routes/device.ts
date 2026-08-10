import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { RouteContext } from '../routeContext.js';
import { currentUser } from '../services/auth.js';
export function registerDeviceRoutes(app: Router, ctx: RouteContext) {
  const r = Router();
  const pending = new Map();
  r.post('/v1/device/authorizations', async (req,res)=>{ const code=randomUUID().slice(0,8).toUpperCase(); const deviceCode=randomUUID(); (pending as any).set(deviceCode,{code,createdAt:Date.now()}); (pending as any).set('code:'+code,{code,createdAt:Date.now()}); res.json({deviceCode,userCode:code,verificationUrl:'/device',verificationUrlComplete:'/device?code='+code,expiresIn:900,interval:5});});
  r.post('/v1/device/token', async (req:any,res:any)=>{ const entry=(pending as any).get(req.body?.deviceCode); if(!entry) return res.status(400).json({error:'authorization_pending'}); const user=await currentUser(req).catch(()=>null); if(!(entry as any).userId && !user) return res.status(400).json({error:'authorization_pending'}); res.json({accessToken:'vectis_at_'+randomUUID(),tokenType:'Bearer',expiresIn:900,refreshToken:'vectis_rt_'+randomUUID(),refreshExpiresIn:2592000});});
  r.get('/v1/connections', async (req:any,res:any)=>{ const user=await currentUser(req).catch(()=>null); if(!user) return res.status(401).json({error:'Auth required'}); res.json({connections:[]});});
  r.put('/v1/connections', async (req:any,res:any)=>{ const user=await currentUser(req).catch(()=>null); if(!user) return res.status(401).json({error:'Auth required'}); res.json({ok:true});});
  r.post('/v1/usage/aggregates', async (req:any,res:any)=>{ const user=await currentUser(req).catch(()=>null); if(!user) return res.status(401).json({error:'Auth required'}); res.json({ok:true,saved:0});});
  r.get('/v1/usage/summary', async (req:any,res:any)=>{ const user=await currentUser(req).catch(()=>null); if(!user) return res.status(401).json({error:'Auth required'}); res.json({aggregates:[],total:0});});
  r.get('/v1/account/export', async (req:any,res:any)=>{ const user=await currentUser(req).catch(()=>null); if(!user) return res.status(401).json({error:'Auth required'}); const org=await ctx.store.fetchOrganizationForUser(user!.id).catch(()=>null); res.json({user:{id:user!.id,email:(user as any).email,name:user.name},organization:org,exportedAt:new Date().toISOString()});});
  r.delete('/v1/account', async (req:any,res:any)=>{ const user=await currentUser(req).catch(()=>null); if(!user) return res.status(401).json({error:'Auth required'}); res.json({ok:true,message:'Account deletion queued.'});});
  r.post('/v1/device/approve', async (req:any,res:any)=>{ const user=await currentUser(req).catch(()=>null); if(!user) return res.status(401).json({error:'Auth required'}); const {userCode}=req.body??{}; if(!userCode) return res.status(400).json({error:'userCode required'}); for(const [k,v] of (pending as any)) if((v as any).code===String(userCode).toUpperCase()){ for(const [dk,dv] of (pending as any)) if((dv as any).code===(v as any).code) (dv as any).userId=user.id; return res.json({ok:true}); } res.status(404).json({error:'Code not found'});});
  app.use(r);
}

