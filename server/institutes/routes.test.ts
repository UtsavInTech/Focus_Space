import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, register, startPhoneSignIn, verifyPhoneOwnership, type AuthConfig } from '../auth/service';
import { IdentityDb } from '../auth/db';
import { ApiError, sendJson } from '../http';
import { InstitutesDb, type Driver } from './db';
import { testDriver } from './test-driver';
import { csv, institutePath, instituteRoutes, staffAllowed } from './routes';
import { CONSENT_VERSION, type Actor, type CoursePayload } from './types';
let driver: Driver,db: InstitutesDb,identityDb: IdentityDb,server: Server,base: string;
let orgId: string,otherOrg: string,courseId: string,staffToken: string,facultyToken: string,studentToken: string;
let databaseCalls=0;
const config:AuthConfig={tokenSecret:'t'.repeat(32)};
const signup=()=>register(identityDb,config,`${randomUUID()}@example.com`,'test password',null);
const channel=`UC${'a'.repeat(22)}`;
beforeAll(async()=>{
  driver=await testDriver();db=new InstitutesDb(driver,'r'.repeat(32));await db.migrate();identityDb=new IdentityDb(':memory:');
  const staff=signup(),faculty=signup(),student=signup();staffToken=staff.accessToken;facultyToken=faculty.accessToken;studentToken=student.accessToken;
  orgId=String((await db.createOrg(staff.user.id,{slug:randomUUID(),name:'Institute A'})).id);
  otherOrg=String((await db.createOrg(staff.user.id,{slug:randomUUID(),name:'Institute B'})).id);
  await db.setMember(orgId,staff.user.id,faculty.user.id,'faculty');
  courseId=String((await db.createCourse(orgId,staff.user.id,{title:'Course',kind:'free',channelId:channel})).id);
  const data:CoursePayload={brand:{name:'Institute A'},subjects:[{id:'s',title:'Subject',topics:[{id:'t',title:'Topic',subtopics:[],items:[{type:'video',videoId:'abcdefghijk'}]}]}],approvedChannels:[{id:channel}],modes:[]};
  await db.saveDraft(orgId,courseId,staff.user.id,data);await db.publish(orgId,courseId,staff.user.id);
  const handler=instituteRoutes({database:async()=>{databaseCalls++;return db;},identity:header=>authenticate(identityDb,config,header).user,staff:staff.user.id,userExists:id=>!!identityDb.findUserById(id),clientIp:()=> 'test-address',startPhone:async()=>({sent:true}),verifyPhone:async()=>{}});
  server=createServer(async(req,res)=>{
    try { if (!await handler(req,res)) sendJson(res,200,{legacy:true}); }
    catch(err) { if (err instanceof ApiError) sendJson(res,err.status,err.toResponse());else {sendJson(res,500,{error:'Unexpected'});throw err;} }
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if (!address||typeof address==='string') throw new Error('No test port');base=`http://127.0.0.1:${address.port}`;
},30000);
afterAll(async()=>{await new Promise<void>(resolve=>server?.close(()=>resolve()));identityDb?.close();await driver?.close();});
const request=(path:string,token?:string,body?:unknown)=>fetch(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
describe('institute HTTP authorization and contracts',()=>{
  it('authenticates before DB access and denies ordinary users staff access',async()=>{
    const before=databaseCalls;expect((await request('/v1/admin/orgs')).status).toBe(401);expect(databaseCalls).toBe(before);
    expect((await request('/v1/admin/orgs',studentToken)).status).toBe(403);expect(databaseCalls).toBe(before);
    expect((await request('/v1/admin/orgs',staffToken)).status).toBe(200);
  });
  it('allows faculty in their own org only, and never grants admin via the metrics token',async()=>{
    expect((await request(`/v1/studio/${orgId}/students`,facultyToken)).status).toBe(200);
    expect((await request(`/v1/studio/${otherOrg}/students`,facultyToken)).status).toBe(403);
    expect((await request('/v1/admin/orgs',facultyToken)).status).toBe(403);
    expect(institutePath('/v1/admin/metrics')).toBe(false);expect(await (await request('/v1/admin/metrics')).json()).toEqual({legacy:true});
  });
  it('handles public metadata and private ETags without exposing correct answers',async()=>{
    expect((await request(`/v1/courses/${courseId}`)).status).toBe(200);
    const result=await request(`/v1/courses/${courseId}/v/1`);expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('private, no-cache');
    expect(JSON.stringify(await result.json())).not.toContain('answer');
    const cached=await fetch(`${base}/v1/courses/${courseId}/v/1`,{headers:{'If-None-Match':result.headers.get('etag')!}});expect(cached.status).toBe(304);
  });
  it('enrols without sharing or OTP and rejects fabricated consent/identity input',async()=>{
    const body={courseId,phone:'+919123456789',consents:{textVersion:CONSENT_VERSION,progress:false,contact:false}};
    expect((await request('/v1/enroll',studentToken,{...body,consents:{...body.consents,progress:'true'}})).status).toBe(400);
    expect((await request('/v1/enroll',studentToken,{...body,phone:'+12025550123'})).status).toBe(400);
    expect((await request('/v1/enroll',studentToken,body)).status).toBe(201);
    const mine=await (await request('/v1/me/institutes',studentToken)).json();expect(mine.courses[0].courseId).toBe(courseId);
    expect((await request('/v1/consents',studentToken,{orgId,consents:{...body.consents,contact:true}})).status).toBe(409);
  });
  it('rate limits join-code guessing by caller, not by guessed code',async()=>{
    const statuses=[];for(let i=0;i<22;i++) statuses.push((await request(`/v1/join/guess-code-${i}`)).status);
    expect(statuses).toContain(429);
  });
  it('prevents unverified email staff grants, and neutralises spreadsheet formulas',()=>{
    const actor:Actor={id:'user',email:'staff@example.com',name:null,phone:null,emailVerified:false};
    expect(staffAllowed(actor,'staff@example.com')).toBe(false);expect(staffAllowed({...actor,emailVerified:true},'STAFF@example.com')).toBe(true);
    expect(staffAllowed(actor,'user')).toBe(true);expect(staffAllowed(actor,'')).toBe(false);
    const exportText=csv([{user_id:'u',name:'=HYPERLINK("bad")',phone:'+919123456789'}]);expect(exportText).toContain("\"'=HYPERLINK");expect(exportText).toContain("\"'+919123456789\"");
  });
  it('reuses the existing OTP for the current account without switching identities',async()=>{
    let code='';const person=signup();const mobile='+919887766554';
    await startPhoneSignIn(identityDb,config,{email:{id:'test',send:async()=>{}},phone:{id:'test',send:async(_target,value)=>{code=value;}},exposeCodes:false},mobile);
    expect(()=>verifyPhoneOwnership(identityDb,config,person.user.id,mobile,code==='000000'?'111111':'000000')).toThrow();
    verifyPhoneOwnership(identityDb,config,person.user.id,mobile,code);
    expect(identityDb.findUserByPhone(mobile)).toBeUndefined(); // no extra account or sign-in side effect
    expect(()=>verifyPhoneOwnership(identityDb,config,person.user.id,mobile,code)).toThrow();
  });
});
