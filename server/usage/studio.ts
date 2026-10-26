import {ApiError} from '../http';
import {callOpenAIJson,type OpenAIConfig} from '../openai';
import type {AiPrompt} from '@/learning/ai/actions';
import type {UsageDb} from './db';
export type StudioLlm=(prompt:AiPrompt,config:OpenAIConfig,signal?:AbortSignal)=>ReturnType<typeof callOpenAIJson>;
export function studioAi(usage:UsageDb,config:OpenAIConfig,limit:number,llm:StudioLlm=callOpenAIJson){
 if(!Number.isSafeInteger(limit)||limit<0)throw new Error('STUDIO_AI_MONTHLY_LIMIT must be a nonnegative integer token limit.');
 return async(orgId:string,prompt:AiPrompt,maxTokens=1200)=>{
  if(!config.apiKey)throw new ApiError(503,'internal_error','The institute assistant is not configured.');
  const held=Buffer.byteLength(prompt.system+prompt.user,'utf8')+maxTokens+1024;
  if(held>120000)throw new ApiError(400,'invalid_request','Narrow this question to a smaller student list or course.');
  const id=usage.reserveStudio(orgId,config.model,held,limit);if(!id)throw new ApiError(429,'rate_limited','Your institute has reached its monthly assistant allowance. You can still view students and review messages.');
  // Uncertain/failed upstream requests retain their reservation: provider usage must never be guessed as zero.
  const result=await llm(prompt,{...config,maxTokens},AbortSignal.timeout(45000));usage.settleStudio(id,result.usage);return result.data;
 };
}
