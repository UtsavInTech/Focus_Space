import {getItem,getItems,setItem,updateItem} from '@/storage/storage';
import {ownerGuard} from '@/storage/ownership';
import {apiBaseUrl,status} from './auth';
import {compileCourse,instituteModeId,mergeInstituteModes,milestoneFor,type InstituteMembership,type InstituteCache} from '@/institutes/model';
import type {LearningMode} from '@/types/domain';
import type {CoursePayload} from '@/institutes/model';
class InstituteError extends Error{constructor(message:string,readonly status:number){super(message);}}
async function session(){const [base,auth]=await Promise.all([apiBaseUrl(),status()]);const ownership=await getItem('ownership');if(!base||!auth.user||!auth.accessToken||ownership.owner!==auth.user.id)return null;return {base,token:auth.accessToken,user:auth.user.id};}
async function json<T>(s:NonNullable<Awaited<ReturnType<typeof session>>>,path:string,body?:unknown):Promise<T>{const response=await fetch(`${s.base}${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${s.token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});const data=await response.json();if(!response.ok)throw new InstituteError(data.error??'Institute request failed.',response.status);return data as T;}
let syncing:Promise<{ok:boolean;error?:string}>|undefined;
export function syncInstitutes(force=false):Promise<{ok:boolean;error?:string}>{if(syncing)return syncing;syncing=sync(force).catch(e=>({ok:false,error:(e as Error).message})).finally(()=>{syncing=undefined;});return syncing;}
async function sync(force:boolean){
 const s=await session();if(!s)return {ok:true};const guard=await ownerGuard(),cache=await getItem('instituteCache');if(!force&&Date.now()-cache.lastSync<4*3600000)return {ok:true};
 let memberships:InstituteMembership[];
 try{memberships=(await json<{courses:InstituteMembership[]}>(s,'/v1/me/institutes')).courses;}catch(e){if(e instanceof InstituteError&&[401,403].includes(e.status)&&await guard()){await updateItem('modes',m=>mergeInstituteModes(m,[]));await setItem('instituteCache',{lastSync:0,courses:{}});await repairCourseSelection();}throw e;}
 if(!Array.isArray(memberships))throw new Error('Invalid institute membership response.');
 let failed=false;const courses:InstituteCache['courses']={},incoming:LearningMode[]=[];
 for(const membership of memberships){const key=instituteModeId(membership),old=cache.courses[key];try{
   const response=await fetch(`${s.base}/v1/courses/${encodeURIComponent(membership.courseId)}/v/${membership.courseVersion}`,{headers:{Authorization:`Bearer ${s.token}`,...(old?{'If-None-Match':old.etag}:{})},signal:AbortSignal.timeout(20000)});
   let payload:CoursePayload,etag:string;if(response.status===304&&old){payload=old.payload;etag=old.etag;}else{const data=await response.json();if(!response.ok)throw new InstituteError(data.error??'Course unavailable.',response.status);payload=data.payload;etag=response.headers.get('ETag')??data.etag;}
   courses[key]={membership,payload,etag};incoming.push(compileCourse(membership,payload));
 }catch(e){failed=true;if(old&&!(e instanceof InstituteError&&[401,403,404].includes(e.status))){courses[key]={...old,membership:{...old.membership,consents:membership.consents}};incoming.push(compileCourse({...old.membership,consents:membership.consents},old.payload));}}}
 if(!await guard())return {ok:false};
 const {modes,settings}=await getItems(['modes','settings']);const merged=mergeInstituteModes(modes,incoming);
 if(merged!==modes&&!(incoming.length===0&&modes.every(m=>!m.source)))await setItem('modes',merged);
 await repairCourseSelection();
 if(incoming.length&&!settings.onboarded)await updateItem('settings',v=>({...v,onboarded:true,exam:v.exam??'none',activeModeId:v.activeModeId??incoming[0].id,defaultModeId:v.defaultModeId??incoming[0].id}));
 await setItem('instituteCache',{lastSync:failed?0:Date.now(),courses});return {ok:true};
}
async function repairCourseSelection(){const {modes,settings}=await getItems(['modes','settings']);const missing=(id:string|null)=>!!id?.startsWith('institute:')&&!modes.some(m=>m.id===id);if(missing(settings.activeModeId)||missing(settings.defaultModeId))await updateItem('settings',v=>({...v,activeModeId:missing(v.activeModeId)?modes[0]?.id??null:v.activeModeId,defaultModeId:missing(v.defaultModeId)?modes[0]?.id??null:v.defaultModeId}));}
export async function leaveInstitute(modeId:string){const guard=await ownerGuard(),mode=(await getItem('modes')).find(m=>m.id===modeId);if(!mode?.source)throw new Error('Not an institute course.');const s=await session();if(!s)throw new Error('Sign in to leave a course.');await json(s,`/v1/institutes/${mode.source.courseId}/leave`,{orgId:mode.source.orgId});if(!await guard())return {ok:false};await updateItem('modes',m=>m.filter(v=>v.source?.courseId!==mode.source!.courseId||v.source.orgId!==mode.source!.orgId));await repairCourseSelection();await syncInstitutes(true);return {ok:true};}
const pending=new Map<string,NonNullable<ReturnType<typeof milestoneFor>>>();let timer:ReturnType<typeof setTimeout>|undefined;let attempts=0;
export async function recordMilestone(input:{modeId:string;videoId:string;progress:number;seconds:number}){
 const modes=await getItem('modes'),mode=modes.find(m=>m.id===input.modeId)??null,event=milestoneFor(mode,input.videoId,input.progress,input.seconds);if(!event)return {ok:true};
 const s=await session();if(!s)return {ok:false};const key=`${s.user}:${event.orgId}:${event.courseId}:${event.videoId}`,prior=pending.get(key);
 if(!prior||event.seconds>=prior.seconds)pending.set(key,event);if(pending.size>100)pending.delete(pending.keys().next().value!);
 if(!timer)timer=setTimeout(()=>{timer=undefined;void flushMilestones(s.user);},1500);return {ok:true};
}
async function flushMilestones(owner:string){const s=await session();if(!s||s.user!==owner){pending.clear();return;}const guard=await ownerGuard(),events=[...pending.entries()].filter(([key])=>key.startsWith(`${owner}:`));if(!events.length)return;
 try{await json(s,'/v1/progress',{events:events.map(([,event])=>event)});if(!await guard()){pending.clear();return;}for(const [key,event]of events)if(pending.get(key)===event)pending.delete(key);attempts=0;}catch(e){if(e instanceof InstituteError&&[400,401,403,404].includes(e.status)){pending.clear();attempts=0;}else if(++attempts<5&&!timer)timer=setTimeout(()=>{timer=undefined;void flushMilestones(owner);},10000);}
}
export async function reportQuizScore(input:{modeId:string;videoId:string;score:number;total:number}){const mode=(await getItem('modes')).find(m=>m.id===input.modeId);if(!mode?.source?.progressConsent||!mode.source.items.some(i=>i.videoId===input.videoId))return {ok:true};const s=await session();if(!s)return {ok:false};await json(s,'/v1/institutes/quiz-score',{orgId:mode.source.orgId,courseId:mode.source.courseId,videoId:input.videoId,score:input.score,total:input.total});return {ok:true};}
export async function withdrawInstitute(orgId:string){const s=await session();if(!s)throw new Error('Sign in first.');await json(s,'/v1/consents',{orgId,consents:{textVersion:'institute-consent-v1',progress:false,contact:false}});await syncInstitutes(true);return {ok:true};}
export async function instituteStudentRequest(input:{orgId:string;courseId?:string;quizId?:string;answers?:number[]}){const s=await session();if(!s)throw new Error('Sign in first.');if(input.quizId)return input.answers?json(s,'/v1/quiz-attempts',input):json(s,`/v1/institutes/quizzes/${input.orgId}/${input.quizId}`);return json(s,`/v1/institutes/${input.orgId}/assignments?courseId=${encodeURIComponent(input.courseId??'')}`);}
