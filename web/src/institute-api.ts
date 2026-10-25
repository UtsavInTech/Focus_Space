import { API_BASE, request } from './api';
import type { CoursePayload } from '../../server/institutes/types';
export type { CoursePayload };
export interface Org {id:string;name:string;role?:string}
export interface Course {id:string;title:string;kind:'free'|'batch';source_channel_id:string;exam_id?:string;status:string}
export interface Batch {id:string;name:string;join_code:string;seats:number;course_id:string}
export type Row=Record<string,string|number|null|boolean>;
export const instituteRequest=<T>(token:string,path:string,body?:unknown)=>request<T>(path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
export async function downloadLeads(token:string,path:string):Promise<string|null>{
 const response=await fetch(`${API_BASE}${path}`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok){const data=await response.json();throw new Error(data.error??'Export failed.');}
 const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='focusspace-leads.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return response.headers.get('X-Next-Cursor');
}
export function moveTopic(data:CoursePayload,subjectIndex:number,topicIndex:number,target:number):CoursePayload {
 const next=structuredClone(data);const [topic]=next.subjects[subjectIndex].topics.splice(topicIndex,1);if(topic)next.subjects[target].topics.push(topic);return next;
}
export function reorder<T>(items:T[],index:number,delta:number):T[]{const target=index+delta;if(target<0||target>=items.length)return items;const next=[...items];[next[index],next[target]]=[next[target],next[index]];return next;}
