import type { LearningMode } from '@/types/domain';
import { blankMode } from '@/modes/templates';
import type { CoursePayload } from '../../server/institutes/types';
export type { CoursePayload };
export interface InstituteMembership {orgId:string;courseId:string;batchId?:string|null;courseVersion:number;etag:string;title?:string;org:{name:string;logo?:string|null;accent?:string|null};consents?:{progress:boolean;contact:boolean}}
export interface InstituteCache {lastSync:number;courses:Record<string,{membership:InstituteMembership;payload:CoursePayload;etag:string}>}
export const instituteModeId=(m:Pick<InstituteMembership,'orgId'|'courseId'|'batchId'>)=>`institute:${m.orgId}:${m.courseId}:${m.batchId??'free'}`;
export function compileCourse(m:InstituteMembership,payload:CoursePayload,now=Date.now()):LearningMode {
 if(!payload||!Array.isArray(payload.subjects)||!Array.isArray(payload.approvedChannels)||!payload.brand?.name)throw new Error('Invalid institute course.');
 const id=instituteModeId(m),mode=blankMode(id,now);
 const items=payload.subjects.flatMap(s=>s.topics.flatMap(t=>t.items.map(item=>({...item,topicId:t.id}))));
 if(items.some(i=>i.type==='video'?!/^[\w-]{11}$/.test(i.videoId??''):i.type!=='playlist'||!/^[\w-]+$/.test(i.playlistId??'')))throw new Error('Invalid institute video/playlist id.');
 return {...mode,name:m.title??`${m.org.name} course`,kind:'institute',icon:'graduation-cap',description:`${m.org.name} · Read-only institute course`,topics:payload.subjects.flatMap(s=>s.topics.map(t=>({id:t.id,name:t.title,group:s.title,keywords:t.subtopics}))),discovery:false,filterOverride:{intensity:'strict',filters:{hideShorts:true,replaceHomeFeed:true,relatedVideos:'hide',hideEndScreens:true,hideExplore:true,hideComments:false,hideNotifications:false,searchResults:'show'}},allowedChannels:payload.approvedChannels.map(c=>({id:c.id,title:c.id})),source:{orgId:m.orgId,courseId:m.courseId,...(m.batchId?{batchId:m.batchId}:{}),courseVersion:m.courseVersion,orgName:m.org.name,logo:m.org.logo?.startsWith('https://')?m.org.logo:undefined,accent:/^#[\da-f]{6}$/i.test(m.org.accent??'')?m.org.accent!:undefined,items,progressConsent:m.consents?.progress===true,contactConsent:m.consents?.contact===true}};
}
export function mergeInstituteModes(personalAndOld:LearningMode[],incoming:LearningMode[]):LearningMode[]{const personal=personalAndOld.filter(m=>!m.source);return incoming.length||personal.length!==personalAndOld.length?[...personal,...incoming]:personalAndOld;}
export function milestoneFor(mode:LearningMode|null,videoId:string,progress:number,seconds:number){if(!mode?.source||!mode.source.items.some(i=>i.type==='video'&&i.videoId===videoId)||progress<=0)return null;return {orgId:mode.source.orgId,courseId:mode.source.courseId,videoId,stage:progress>=.8?'done' as const:progress>=.5?'half' as const:'started' as const,seconds:Math.max(0,Math.min(86400,Math.round(seconds)))};}
