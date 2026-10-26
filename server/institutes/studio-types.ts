import {ApiError} from '../http';
export interface StudioContext {
 about:string; products:{name:string;fee:number;startDate:string;mode:'online'|'offline';centre:string}[];
 offers:string; counsellor:string; callback:string; tone:string; language:'English'|'Hindi'|'Hinglish'; neverSay:string; examples:string[]; rules:string[];
}
export const EMPTY_CONTEXT:StudioContext={about:'',products:[],offers:'',counsellor:'',callback:'',tone:'Helpful and respectful',language:'English',neverSay:'',examples:[],rules:[]};
export const invalid=(message:string):never=>{throw new ApiError(400,'invalid_request',message);};
export function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return invalid('Expected an object.');return value as Record<string,unknown>;}
export function text(value:unknown,max=2000):string{if(typeof value!=='string'||value.length>max)return invalid(`Use text up to ${max} characters.`);return value.trim();}
export function integer(value:unknown,min=0,max=1000000):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)return invalid('Number is outside its allowed range.');return value;}
export function strings(value:unknown,max=20){if(!Array.isArray(value)||value.length>max)return invalid('Too many entries.');return value.map(v=>text(v,1000));}
export function contextInput(value:unknown):StudioContext{
 const v=object(value);if(!Array.isArray(v.products)||v.products.length>30)return invalid('Use up to 30 courses for sale.');
 const products=v.products.map(raw=>{const p=object(raw);if(!['online','offline'].includes(String(p.mode)))return invalid('Choose online or offline.');const startDate=text(p.startDate,10);if(startDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!Number.isFinite(Date.parse(startDate))||new Date(startDate).toISOString().slice(0,10)!==startDate))return invalid('Use a date in YYYY-MM-DD format.');return {name:text(p.name,150),fee:integer(p.fee,0,10000000),startDate,mode:p.mode as 'online'|'offline',centre:text(p.centre,300)};});
 if(!['English','Hindi','Hinglish'].includes(String(v.language)))return invalid('Choose a supported language.');
 return {about:text(v.about),products,offers:text(v.offers),counsellor:text(v.counsellor,100),callback:text(v.callback,30),tone:text(v.tone,500),language:v.language as StudioContext['language'],neverSay:text(v.neverSay),examples:strings(v.examples,5),rules:strings(v.rules,30)};
}
export interface StudentRules {courseId?:string;sharing?:boolean;minLessons?:number;minQuiz?:number;maxQuiz?:number;quietDays?:number;joinedWithinDays?:number;wantsContact?:boolean;notContactedDays?:number;freeOnly?:boolean;returnedDays?:number;limit?:number}
export function studentRules(value:unknown):StudentRules{const v=object(value),out:Record<string,unknown>={};for(const [key,val]of Object.entries(v)){if(key==='courseId')out[key]=text(val,100);else if(['sharing','wantsContact','freeOnly'].includes(key)){if(typeof val!=='boolean')return invalid('Expected true or false.');out[key]=val;}else if(['minLessons','minQuiz','maxQuiz','quietDays','joinedWithinDays','notContactedDays','returnedDays','limit'].includes(key))out[key]=integer(val,key==='limit'?1:0,['minQuiz','maxQuiz'].includes(key)?100:key==='limit'?100:key==='minLessons'?5000:3650);else return invalid(`Unknown filter: ${key}`);}return out as StudentRules;}
export interface PlaybookInput {name:string;rules:StudentRules;template:string;channel:'whatsapp'|'call'|'copy';personalize:boolean}
export function playbookInput(value:unknown):PlaybookInput{const v=object(value);if(!['whatsapp','call','copy'].includes(String(v.channel))||typeof v.personalize!=='boolean')return invalid('Choose a channel and personalisation setting.');return {name:text(v.name,150),rules:studentRules(v.rules),template:text(v.template,3000),channel:v.channel as PlaybookInput['channel'],personalize:v.personalize};}
export const OUTCOMES=['called','no_answer','interested','visited','enrolled','not_now','wrong_number'] as const;
export type Outcome=typeof OUTCOMES[number];
