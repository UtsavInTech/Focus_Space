import {describe,it,expect,vi,afterEach} from 'vitest';
import {compileCourse,mergeInstituteModes,milestoneFor,type CoursePayload} from './model';
import {blankMode} from '@/modes/templates';
import {fakeChrome} from '@/test/fake-chrome';
import {ownedKeys} from '@/storage/ownership';
const payload:CoursePayload={brand:{name:'Institute'},subjects:[{id:'s',title:'Subject',topics:[{id:'t',title:'Topic',subtopics:['Concept'],items:[{type:'video',videoId:'abcdefghijk'}]}]}],approvedChannels:[{id:`UC${'a'.repeat(22)}`}],modes:[]};
const membership={orgId:'org',courseId:'course',courseVersion:1,etag:'v1',org:{name:'Institute'}};
afterEach(()=>vi.unstubAllGlobals());
describe('institute isolation',()=>{
 it('preserves the exact personal collection for a learner with no institute',()=>{const personal=[blankMode('personal',1)];expect(mergeInstituteModes(personal,[])).toBe(personal);expect(milestoneFor(personal[0],'abcdefghijk',1,100)).toBeNull();});
 it('compiles ordered, branded courses with discovery off and consent off by default',()=>{const mode=compileCourse(membership,payload,1);expect(mode.kind).toBe('institute');expect(mode.discovery).toBe(false);expect(mode.topics[0].name).toBe('Topic');expect(mode.source?.progressConsent).toBe(false);expect(milestoneFor(mode,'abcdefghijk',.5,50)?.stage).toBe('half');expect(milestoneFor(mode,'unknown____',1,50)).toBeNull();expect(ownedKeys()).toContain('instituteCache');});
 it('sends neither milestones nor quiz scores for a personal Space',async()=>{fakeChrome({modes:[blankMode('personal',1)]});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const {recordMilestone,reportQuizScore}=await import('@/background/institutes');await recordMilestone({modeId:'personal',videoId:'abcdefghijk',progress:1,seconds:100});await reportQuizScore({modeId:'personal',videoId:'abcdefghijk',score:15,total:20});expect(fetcher).not.toHaveBeenCalled();});
 it('rejects edits and deletion of synced institute courses',async()=>{const mode=compileCourse(membership,payload);const data=fakeChrome({modes:[mode,blankMode('personal',1)]});const before=structuredClone(data.modes);const {updateMode,deleteMode,setChannelRule}=await import('@/modes/service');await expect(updateMode(mode.id,{name:'Changed'})).rejects.toThrow('read-only');await expect(deleteMode(mode.id)).rejects.toThrow('read-only');await expect(setChannelRule(mode.id,{id:'channel',title:'Channel'},'allowed')).rejects.toThrow('read-only');expect(data.modes).toEqual(before);});
 it('does not consume guest slots for institute courses',async()=>{fakeChrome({modes:[compileCourse(membership,payload),compileCourse({...membership,courseId:'two'},payload),blankMode('personal',1)]});const {authorize}=await import('@/background/spaces');expect((await authorize('new-personal','New')).ok).toBe(true);});
 it('never sends a non-consenting institute quiz score',async()=>{const mode=compileCourse(membership,payload);fakeChrome({modes:[mode]});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const {reportQuizScore}=await import('@/background/institutes');await reportQuizScore({modeId:mode.id,videoId:'abcdefghijk',score:1,total:2});expect(fetcher).not.toHaveBeenCalled();});
});
