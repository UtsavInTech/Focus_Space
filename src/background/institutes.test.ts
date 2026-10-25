import {describe,it,expect,vi,afterEach} from 'vitest';
import {fakeChrome} from '@/test/fake-chrome';
import {blankMode} from '@/modes/templates';
import {defaultsFor} from '@/storage/schema';
vi.mock('./auth',()=>({apiBaseUrl:async()=> 'https://api.example.com',status:async()=>({user:{id:'learner'},accessToken:'token'})}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
const membership={orgId:'org',courseId:'course',courseVersion:1,etag:'v1',org:{name:'Institute'}};
const payload={brand:{name:'Institute'},subjects:[{id:'s',title:'Subject',topics:[{id:'t',title:'Topic',subtopics:[],items:[{type:'video',videoId:'abcdefghijk'}]}]}],approvedChannels:[],modes:[]};
function setup(){return fakeChrome({ownership:{owner:'learner',epoch:1},settings:{...defaultsFor('settings'),onboarded:true,activeModeId:'personal',defaultModeId:'personal'},modes:[blankMode('personal',1)]});}
describe('course cache refresh',()=>{
 it('leaves personal settings and modes unchanged with no enrolments',async()=>{const data=setup(),before=structuredClone(data);vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({courses:[]}))));const {syncInstitutes}=await import('./institutes');expect(await syncInstitutes(true)).toEqual({ok:true});expect(data.modes).toEqual(before.modes);expect(data.settings).toEqual(before.settings);});
 it('uses ETag, survives offline and removes course cache after explicit refusal',async()=>{const data=setup();let state='first';const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{if(url.endsWith('/v1/me/institutes'))return new Response(JSON.stringify({courses:[membership]}));if(state==='offline')throw new Error('Offline');if(state==='denied')return new Response(JSON.stringify({error:'No access'}),{status:403});if(state==='cached'){expect((options?.headers as Record<string,string>)['If-None-Match']).toBe('v1');return new Response(null,{status:304});}return new Response(JSON.stringify({payload}),{headers:{ETag:'v1'}});});vi.stubGlobal('fetch',fetcher);const {syncInstitutes}=await import('./institutes');await syncInstitutes(true);expect((data.modes as unknown[]).length).toBe(2);state='cached';await syncInstitutes(true);state='offline';await syncInstitutes(true);expect((data.modes as unknown[]).length).toBe(2);state='denied';await syncInstitutes(true);expect((data.modes as unknown[]).length).toBe(1);expect(data.instituteCache).toMatchObject({courses:{}});});
});
