import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { InstitutesDb, publicPayload, type Driver } from './db';
import { testDriver } from './test-driver';
import { ProgressQueue } from './queue';
import { CONSENT_VERSION, type Actor, type CoursePayload } from './types';
let driver: Driver,db: InstitutesDb;
let phoneNumber=9000000000;
const actor=():Actor=>({id:randomUUID(),email:null,name:'Learner',phone:null});
const phone=()=>`+91${++phoneNumber}`;
const sharing=(progress=false,contact=false)=>({textVersion:CONSENT_VERSION,progress,contact});
const video='abcdefghijk',privateVideo='lmnopqrstuv',channel=`UC${'a'.repeat(22)}`;
const data=():CoursePayload=>({brand:{name:'Test Institute'},subjects:[{id:'subject',title:'Subject',topics:[{id:'topic',title:'Topic',subtopics:['A concept'],items:[{type:'video',videoId:video},{type:'video',videoId:privateVideo,membersOnly:true}]}]}],approvedChannels:[{id:channel}],modes:[]});
async function course(kind:'free'|'batch'='free') {
  const org=await db.createOrg('staff',{slug:randomUUID(),name:'Test Institute'}),orgId=String(org.id);
  const row=await db.createCourse(orgId,'staff',{title:'Test Course',kind,channelId:channel}),courseId=String(row.id);
  await db.saveDraft(orgId,courseId,'staff',data());await db.publish(orgId,courseId,'staff');
  return {orgId,courseId};
}
beforeAll(async()=>{driver=await testDriver();db=new InstitutesDb(driver,'r'.repeat(32));await db.migrate();},30000);
afterAll(async()=>{await driver?.close();});

describe('Postgres institutes data boundaries',()=>{
  it('migrates idempotently, and separates organisation roles and resources',async()=>{
    await db.migrate(); expect(await driver.query('SELECT version FROM institutes.migrations')).toHaveLength(1);
    const a=await course(),b=await course(),person=actor();
    await db.setMember(a.orgId,'staff',person.id,'faculty');
    expect(await db.role(a.orgId,person.id)).toBe('faculty');expect(await db.role(b.orgId,person.id)).toBeNull();
    expect((await db.courses(b.orgId)).some(row=>row.id===a.courseId)).toBe(false);
    await expect(db.saveDraft(b.orgId,a.courseId,'staff',data())).rejects.toMatchObject({status:404});
    await expect(db.courseVersion(b.orgId,a.courseId,1)).rejects.toMatchObject({status:404});
    await expect(db.recordProgress([{orgId:b.orgId,courseId:a.courseId,userId:person.id,videoId:video,stage:'done',seconds:10}])).rejects.toMatchObject({status:403});
    await expect(db.createBatch(b.orgId,'staff',{courseId:a.courseId,name:'Wrong org',seats:2})).rejects.toMatchObject({status:404});
  });
  it('creates immutable published versions and does not expose members-only data or answer fields',async()=>{
    const {orgId,courseId}=await course();
    const changed=data();changed.subjects[0].title='Changed';
    await db.saveDraft(orgId,courseId,'staff',changed);expect((await db.publish(orgId,courseId,'staff')).version).toBe(2);
    const first=await db.courseVersion(orgId,courseId,1);
    expect(first.payload.subjects[0].title).toBe('Subject');expect(JSON.stringify(first)).not.toContain(privateVideo);
    expect((await db.courseVersion(orgId,courseId,2)).payload.subjects[0].title).toBe('Changed');
    await expect(driver.query('UPDATE institutes.course_versions SET payload_json=\'{}\' WHERE org_id=$1',[orgId])).rejects.toThrow('immutable');
    const dirty=data() as unknown as Record<string,unknown>; dirty.answers=['secret'];
    expect(JSON.stringify(publicPayload(dirty as unknown as CoursePayload,false))).not.toContain('secret');
  });
  it('requires unique Indian phones and OTP proof only for contact sharing',async()=>{
    const {orgId,courseId}=await course(),a=actor(),b=actor(),mobile=phone();
    await db.enroll(orgId,courseId,a,{phone:mobile,consents:sharing()});
    await expect(db.enroll(orgId,courseId,b,{phone:mobile,consents:sharing()})).rejects.toMatchObject({status:409});
    await expect(db.changeConsent(orgId,a.id,sharing(false,true))).rejects.toMatchObject({status:409});
    await db.verifyPhone(a,mobile); await db.changeConsent(orgId,a.id,sharing(false,true));
    const leads=await db.leads(orgId,'staff',{limit:100});expect(leads.items).toHaveLength(1);expect(leads.items[0].phone).toBe(mobile);
    expect(leads.items[0].quiz_score).toBeNull();expect(leads.items[0].completed_videos).toBeNull();
  });
  it('enforces seats under simultaneous enrolment, and hides batch content from nonmembers',async()=>{
    const {orgId,courseId}=await course('batch');
    const batch=await db.createBatch(orgId,'staff',{courseId,name:'Batch',seats:1});expect(String(batch.join_code).length).toBeGreaterThanOrEqual(10);
    const a=actor(),b=actor();
    const results=await Promise.allSettled([a,b].map(person=>db.enroll(orgId,courseId,person,{phone:phone(),joinCode:String(batch.join_code),consents:sharing()})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    const winner=results[0].status==='fulfilled'?a:b;
    expect(JSON.stringify(await db.courseVersion(orgId,courseId,1,winner.id))).toContain(privateVideo);
    await expect(db.courseVersion(orgId,courseId,1,actor().id)).rejects.toMatchObject({status:403});
    await db.leave(orgId,courseId,winner.id);await expect(db.courseVersion(orgId,courseId,1,winner.id)).rejects.toMatchObject({status:403});
  });
  it('only stores totals for a learner sharing nothing; quizzes work without sharing',async()=>{
    const {orgId,courseId}=await course(),person=actor();await db.enroll(orgId,courseId,person,{phone:phone(),consents:sharing()});
    const quiz=await db.createQuiz(orgId,courseId,'staff',video,[{question:'Which?',options:['A','B'],answer:1}]);await db.publishQuiz(orgId,String(quiz.id),'staff');
    await expect(db.quiz(orgId,String(quiz.id),person.id)).rejects.toMatchObject({status:409});
    await db.recordProgress([{orgId,courseId,userId:person.id,videoId:video,stage:'done',seconds:100}]);
    expect(JSON.stringify(await db.quiz(orgId,String(quiz.id),person.id))).not.toContain('answer');
    expect(await db.attemptQuiz(orgId,String(quiz.id),person.id,[1])).toEqual({score:1,total:1});
    expect(await driver.query('SELECT * FROM institutes.progress WHERE org_id=$1',[orgId])).toHaveLength(0);
    expect(await driver.query('SELECT * FROM institutes.quiz_attempts WHERE org_id=$1',[orgId])).toHaveLength(0);
    expect((await db.students(orgId,{limit:100})).items).toHaveLength(0);
    const funnel=await db.funnel(orgId,courseId);expect(funnel).toMatchObject({joined:1,started:1,half:1,done:1,passed_quiz:1});
    expect(funnel.videos[0]).toMatchObject({started:1,half:1,done:1});
    const receipts=await driver.query('SELECT * FROM institutes.total_receipts WHERE org_id=$1',[orgId]);
    expect(JSON.stringify(receipts)).not.toContain(person.id);expect(receipts[0]).not.toHaveProperty('user_id');
  });
  it('removes names, progress, scores and leads immediately on withdrawal, even for queued milestones',async()=>{
    const {orgId,courseId}=await course(),person=actor(),mobile=phone();await db.verifyPhone(person,mobile);await db.enroll(orgId,courseId,person,{phone:mobile,consents:sharing(true,true)});
    await db.recordProgress([{orgId,courseId,userId:person.id,videoId:video,stage:'half',seconds:50}]);
    const quiz=await db.createQuiz(orgId,courseId,'staff',video,[{question:'Which?',options:['A','B'],answer:0}]);await db.publishQuiz(orgId,String(quiz.id),'staff');
    await db.recordProgress([{orgId,courseId,userId:person.id,videoId:video,stage:'done',seconds:90}]);
    await db.attemptQuiz(orgId,String(quiz.id),person.id,[0]);
    expect((await db.students(orgId,{limit:100})).items[0].quiz_score).toBe(100);
    const queue=new ProgressQueue(db,60000),waiting=queue.enqueue({orgId,courseId,userId:person.id,videoId:video,stage:'done',seconds:100});
    await db.changeConsent(orgId,person.id,sharing());await queue.flush();await waiting;
    expect((await db.students(orgId,{limit:100})).items).toHaveLength(0);expect((await db.leads(orgId,'staff',{limit:100})).items).toHaveLength(0);
    expect(await driver.query('SELECT * FROM institutes.progress WHERE org_id=$1',[orgId])).toHaveLength(0);
    expect(await driver.query('SELECT * FROM institutes.quiz_attempts WHERE org_id=$1',[orgId])).toHaveLength(0);
    const consents=await driver.query('SELECT * FROM institutes.consents WHERE org_id=$1',[orgId]);expect(consents.every(row=>row.withdrawn_at!==null)).toBe(true);
    await db.changeConsent(orgId,person.id,sharing(true,false));expect((await db.students(orgId,{limit:100})).items[0].completed_videos).toBe(0);
  });
  it('coalesces 10,000 posts, never regresses stages and never double-counts totals',async()=>{
    const {orgId,courseId}=await course(),person=actor();await db.enroll(orgId,courseId,person,{phone:phone(),consents:sharing(true)});
    const save=vi.spyOn(db,'recordProgress'),queue=new ProgressQueue(db,60000);
    const pending=Array.from({length:10000},(_,i)=>queue.enqueue({orgId,courseId,userId:person.id,videoId:video,stage:i===9999?'done':'started',seconds:i}));
    await queue.flush();await Promise.all(pending);expect(save).toHaveBeenCalledTimes(1);save.mockRestore();
    await db.recordProgress([{orgId,courseId,userId:person.id,videoId:video,stage:'half',seconds:2}]);
    const rows=await driver.query('SELECT * FROM institutes.progress WHERE org_id=$1',[orgId]);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({stage:'done',seconds:9999});
    const stats=await db.funnel(orgId,courseId);expect(stats.videos[0]).toMatchObject({started:1,half:1,done:1});
    expect((await db.students(orgId,{limit:100,minCompletion:100})).items).toHaveLength(1);
  });
  it('filters and pages exports, scopes quiz scores, and logs each export',async()=>{
    const {orgId,courseId}=await course(),other=await course();
    for (let i=0;i<3;i++) {
      const person=actor(),mobile=phone();await db.verifyPhone(person,mobile);await db.enroll(orgId,courseId,person,{phone:mobile,consents:sharing(true,true)});
      if (i===0) await db.recordProgress([{orgId,courseId,userId:person.id,videoId:video,stage:'done',seconds:100}]);
    }
    const first=await db.leads(orgId,'staff',{limit:1});expect(first.items).toHaveLength(1);expect(first.next).not.toBeNull();
    const second=await db.leads(orgId,'staff',{limit:1,after:first.next!});expect(second.items[0].user_id).not.toBe(first.items[0].user_id);
    expect((await db.leads(orgId,'staff',{limit:10,minCompletion:100})).items).toHaveLength(1);
    expect((await db.leads(other.orgId,'staff',{limit:10})).items).toHaveLength(0);
    expect((await driver.query("SELECT * FROM institutes.audit_log WHERE org_id=$1 AND action='leads.export'",[orgId])).length).toBe(3);
  });
});
