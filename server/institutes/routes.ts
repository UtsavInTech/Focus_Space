import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, CORS_HEADERS, readJsonBody, sendJson } from '../http';
import { RateLimiter } from '../auth/rate-limit';
import type { InstitutesDb } from './db';
import { ProgressQueue } from './queue';
import type { Actor } from './types';
import * as v from './validate';

export interface InstituteDependencies {
  database: () => Promise<InstitutesDb>;
  identity: (authorization: string|undefined) => Actor;
  startPhone: (actor: Actor, phone: string) => Promise<unknown>;
  verifyPhone: (actor: Actor, phone: string, code: string) => Promise<void>;
  staff?: string;
  userExists: (id: string) => boolean;
  clientIp: (request: IncomingMessage) => string;
}
export function staffAllowed(actor: Actor, allowList: string): boolean {
  const entries=allowList.split(',').map(x=>x.trim()).filter(Boolean);
  return entries.includes(actor.id) || (!!actor.email && actor.emailVerified===true && entries.some(value=>value.toLowerCase()===actor.email!.toLowerCase()));
}
export function csv(items: Record<string, unknown>[]): string {
  const cell=(value: unknown) => { let s=value===null||value===undefined?'':String(value); if (/^\s*[=+@\-]|^[\t\r\n]/.test(s)) s=`'${s}`; return `"${s.replace(/"/g,'""')}"`; };
  return ['user_id,name,phone,completed_videos,completion_percent,quiz_score',...items.map(row=>['user_id','name','phone','completed_videos','completion_percent','quiz_score'].map(k=>cell(row[k])).join(','))].join('\r\n');
}
export function institutePath(path: string): boolean {
  return path==='/v1/me/institutes' || path==='/v1/enroll' || path==='/v1/progress' || path==='/v1/quiz-attempts' || path==='/v1/consents' || path.startsWith('/v1/institutes/') || path.startsWith('/v1/courses/') || path.startsWith('/v1/join/') || path.startsWith('/v1/studio/') || (path.startsWith('/v1/admin/') && path!=='/v1/admin/metrics');
}
export function instituteRoutes(deps: InstituteDependencies) {
  const joinLimiter=new RateLimiter(20,10*60_000), progressLimiter=new RateLimiter(120,60_000), readLimiter=new RateLimiter(120,60_000);
  let queue: ProgressQueue|undefined;
  const limited=(limiter: RateLimiter,key: string)=>{ if (!limiter.attempt(key)) throw new ApiError(429,'rate_limited','Too many attempts. Try again shortly.'); };
  return async (req: IncomingMessage,res: ServerResponse): Promise<boolean>=>{
    const url=new URL(req.url??'/','http://localhost'),path=url.pathname;
    if (!institutePath(path)) return false;
    const parts=path.split('/').filter(Boolean);
    const body=()=>readJsonBody(req,2*1024*1024);
    const identity=()=>deps.identity(req.headers.authorization);
    const respond=(result: unknown,status=200)=>{ sendJson(res,status,{ok:true,...(typeof result==='object'&&result!==null?result:{})}); return true; };
    // Authenticate before touching infrastructure for every private route; do not fall back to guest.
    const publicGet=req.method==='GET'&&(parts[1]==='courses'||parts[1]==='join');
    const actor=publicGet ? (req.headers.authorization ? identity() : undefined) : identity();
    limited(readLimiter,`read:${actor?.id??deps.clientIp(req)}`);
    if (parts[1]==='admin' && !staffAllowed(actor!,deps.staff??'')) throw new ApiError(403,'forbidden','FocusSpace staff access is required.');
    const db=await deps.database();
    queue??=new ProgressQueue(db);
    if (req.method==='GET' && path==='/v1/institutes/access') return respond({staff:staffAllowed(actor!,deps.staff??''),orgs:await db.myOrgs(actor!.id)});
    if (req.method==='GET' && path==='/v1/me/institutes') return respond({courses:await db.mine(actor!.id)});
    if (req.method==='GET'&&parts[1]==='join'&&parts.length===3) {
      limited(joinLimiter,`ip:${deps.clientIp(req)}`);
      return respond({batch:await db.resolveJoin(v.text(parts[2],'join code',100))});
    }
    if (req.method==='GET'&&parts[1]==='courses') {
      const course=await db.resolveCourse(v.id(parts[2]));
      if (parts.length===3) return respond({course});
      if (parts[3]==='v'&&parts.length===5) {
        const version=await db.courseVersion(String(course.org_id),String(course.id),v.integer(Number(parts[4]),'version',1,1000000),actor?.id);
        // Always revalidate membership before 304. A former member must not reuse a private cached body.
        res.setHeader('ETag',version.etag); res.setHeader('Cache-Control','private, no-cache'); res.setHeader('Vary','Authorization'); res.setHeader('Access-Control-Expose-Headers','ETag');
        if (req.headers['if-none-match']===version.etag) { res.writeHead(304,CORS_HEADERS);res.end();return true; }
        return respond(version);
      }
    }
    if (req.method==='POST'&&path==='/v1/enroll') {
      limited(joinLimiter,`ip:${deps.clientIp(req)}`); limited(joinLimiter,`user:${actor!.id}`);
      const input=v.enrollment(await body());
      const course=input.joinCode?await db.resolveJoin(input.joinCode):await db.resolveCourse(input.courseId!);
      return respond({enrollment:await db.enroll(String(course.org_id),String(course.course_id??course.id),actor!,input)},201);
    }
    if (req.method==='POST'&&path==='/v1/consents') {
      const input=v.object(await body()); await db.changeConsent(v.id(input.orgId),actor!.id,v.sharing(input.consents));return respond({});
    }
    if (req.method==='GET'&&path==='/v1/consents') return respond({consents:await db.myConsents(v.id(url.searchParams.get('orgId')),actor!.id)});
    if (req.method==='GET'&&parts[1]==='institutes'&&parts.length===4&&parts[3]==='assignments') return respond({assignments:await db.assignments(v.id(parts[2]),v.id(url.searchParams.get('courseId')),actor!.id)});
    if (req.method==='POST'&&path==='/v1/progress') {
      limited(progressLimiter,actor!.id);
      const input=v.object(await body());
      const events=Array.isArray(input.events)?input.events:[input];
      if (!events.length||events.length>100) return v.invalid('Send between 1 and 100 milestones.');
      const parsed=events.map(raw=>{const e=v.object(raw);if (!['started','half','done'].includes(String(e.stage))) return v.invalid('Invalid milestone.');return {orgId:v.id(e.orgId),courseId:v.id(e.courseId),videoId:v.video(e.videoId),stage:e.stage as 'started'|'half'|'done',seconds:v.integer(e.seconds??0,'seconds',0,86400),userId:actor!.id};});
      await Promise.all(parsed.map(event=>queue!.enqueue(event))); return respond({accepted:parsed.length});
    }
    if (req.method==='POST'&&path==='/v1/quiz-attempts') {
      const input=v.object(await body()); if (!Array.isArray(input.answers)||input.answers.length>50) return v.invalid('Invalid answers.');
      const answers=input.answers.map(a=>v.integer(a,'answer',0,5));
      return respond(await db.attemptQuiz(v.id(input.orgId),v.id(input.quizId),actor!.id,answers));
    }
    if (parts[1]==='institutes'&&parts[2]==='phone'&&req.method==='POST') {
      const input=v.object(await body()),mobile=v.phone(input.phone);
      if (parts[3]==='start') return respond(await deps.startPhone(actor!,mobile));
      if (parts[3]==='verify') {
        const code=v.text(input.code,'verification code',6); if (!/^\d{6}$/.test(code)) return v.invalid('Enter the six-digit code.');
        await deps.verifyPhone(actor!,mobile,code); await db.verifyPhone(actor!,mobile); return respond({verified:true});
      }
    }
    if (parts[1]==='institutes'&&parts.length===4&&parts[3]==='leave'&&req.method==='POST') {
      const input=v.object(await body()); await db.leave(v.id(input.orgId),v.id(parts[2]),actor!.id);return respond({});
    }
    if (parts[1]==='institutes'&&parts[2]==='quizzes'&&parts.length===5&&req.method==='GET') return respond(await db.quiz(v.id(parts[3]),v.id(parts[4]),actor!.id));
    if (parts[1]==='studio') {
      const orgId=v.id(parts[2]);
      if (!await db.role(orgId,actor!.id)) throw new ApiError(403,'forbidden','Institute staff access is required.');
      if (req.method==='GET'&&parts.length===4) {
        const filter=v.page(url.searchParams);
        if (parts[3]==='funnel') return respond(await db.funnel(orgId,filter.courseId));
        if (parts[3]==='students') return respond(await db.students(orgId,filter));
        if (parts[3]==='leads.csv') {
          const result=await db.leads(orgId,actor!.id,filter);
          res.writeHead(200,{...CORS_HEADERS,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="focusspace-leads.csv"','Cache-Control':'no-store',...(result.next?{'X-Next-Cursor':result.next}:{}),'Access-Control-Expose-Headers':'X-Next-Cursor'});
          res.end(csv(result.items));return true;
        }
      }
    }
    if (parts[1]==='admin') {
      if (parts[2]==='orgs'&&parts.length===3) {
        if (req.method==='GET') return respond({orgs:await db.orgs()});
        if (req.method==='POST') {
          const input=v.object(await body());
          return respond({org:await db.createOrg(actor!.id,{slug:v.id(input.slug),name:v.text(input.name,'institute name'),...(input.logo===undefined?{}:{logo:v.https(input.logo)}),...(input.accent===undefined?{}:{accent:/^#[\da-fA-F]{6}$/.test(String(input.accent))?String(input.accent):v.invalid('Invalid accent.')})})},201);
        }
      }
      if (parts[2]==='orgs'&&parts.length>=5) {
        const orgId=v.id(parts[3]),resource=parts[4],resourceId=parts[5]===undefined?undefined:v.id(parts[5]);
        if (req.method==='GET'&&parts.length===5) {
          if (resource==='courses') return respond({courses:await db.courses(orgId)});
          if (resource==='batches') return respond({batches:await db.batches(orgId)});
        }
        if (req.method==='GET'&&resource==='courses'&&resourceId&&parts.length===7&&parts[6]==='draft') return respond({draft:await db.draft(orgId,resourceId)});
        if (req.method==='POST') {
          const input=v.object(await body());
          if (resource==='settings'&&parts.length===5) {
            if (!['pilot','active','paused'].includes(String(input.status))) return v.invalid('Invalid institute status.');
            await db.orgStatus(orgId,actor!.id,input.status as 'pilot'|'active'|'paused');return respond({});
          }
          if (resource==='members'&&parts.length===5) {
            if (!['owner','admin','faculty'].includes(String(input.role))) return v.invalid('Invalid institute role.');
            if (!deps.userExists(v.id(input.userId))) return v.invalid('That FocusSpace account does not exist.');
            await db.setMember(orgId,actor!.id,v.id(input.userId),input.role as 'owner'|'admin'|'faculty'); return respond({});
          }
          if (resource==='courses') {
            if (parts.length===5) {
              if (input.kind!=='free'&&input.kind!=='batch') return v.invalid('Invalid course kind.');
              return respond({course:await db.createCourse(orgId,actor!.id,{title:v.text(input.title,'course title'),kind:input.kind,channelId:v.channel(input.channelId),examId:input.examId===undefined?undefined:v.id(input.examId)})},201);
            }
            if (parts.length===7&&resourceId) {
              if (parts[6]==='draft') { await db.saveDraft(orgId,resourceId,actor!.id,v.payload(input.payload));return respond({}); }
              if (parts[6]==='publish') return respond(await db.publish(orgId,resourceId,actor!.id));
              if (parts[6]==='import') throw new ApiError(501,'invalid_request','Course import is the next implementation step and is not available yet.');
              if (parts[6]==='quizzes') return respond({quiz:await db.createQuiz(orgId,resourceId,actor!.id,v.video(input.videoId),v.quiz(input.questions))},201);
            }
          }
          if (resource==='batches') {
            if (parts.length===5) return respond({batch:await db.createBatch(orgId,actor!.id,{courseId:v.id(input.courseId),name:v.text(input.name,'batch name'),seats:v.integer(input.seats,'seats',1,1000000),startsOn:input.startsOn===undefined?undefined:v.integer(input.startsOn,'start',0,8640000000000000),endsOn:input.endsOn===undefined?undefined:v.integer(input.endsOn,'end',0,8640000000000000)})},201);
            if (resourceId&&parts.length===7&&parts[6]==='settings') {
              if (input.status!=='active'&&input.status!=='paused') return v.invalid('Invalid batch status.');
              await db.batchSettings(orgId,resourceId,actor!.id,input.status,v.integer(input.seats,'seats',1,1000000));return respond({});
            }
            if (resourceId&&parts[6]==='rotate') return respond(await db.rotateCode(orgId,resourceId,actor!.id));
            if (resourceId&&parts[6]==='assignments') { if (input.kind!=='today'&&input.kind!=='homework') return v.invalid('Invalid assignment kind.');return respond(await db.assignment(orgId,resourceId,actor!.id,{itemRef:v.id(input.itemRef),kind:input.kind,note:input.note===undefined?undefined:v.text(input.note,'note',2000),dueOn:input.dueOn===undefined?undefined:v.integer(input.dueOn,'due date',0,8640000000000000)})); }
          }
          if (resource==='quizzes'&&resourceId&&parts[6]==='publish') { await db.publishQuiz(orgId,resourceId,actor!.id);return respond({}); }
        }
      }
    }
    // Matched namespace but unknown method/path: never fall through into another auth/AI handler.
    throw new ApiError(404,'invalid_request','Unknown institute route.');
  };
}
