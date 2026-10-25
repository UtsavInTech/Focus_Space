import { ApiError } from '../http';
import { EXAMS } from '@/modes/exams';
import { slugify } from '@/learning/text';
import type { CoursePayload } from './types';
import { channel, text } from './validate';
type Page = { items?: { id?: string; snippet?: { title?: string }; contentDetails?: {videoId?:string} }[]; nextPageToken?: string };
export type YouTubeFetch = (resource:string, params:Record<string,string>)=>Promise<Page>;
export function youtubeFetch(key=process.env.YOUTUBE_API_KEY):YouTubeFetch {
  return async(resource,params)=>{
    if (!key) throw new ApiError(503,'internal_error','YouTube course import is not configured.');
    const url=new URL(`https://www.googleapis.com/youtube/v3/${resource}`);for(const [k,v] of Object.entries({...params,key}))url.searchParams.set(k,v);
    const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new ApiError(502,'upstream_error','YouTube could not complete the import. Try later.');
    return await response.json() as Page;
  };
}
export async function resolveChannel(input:string,read:YouTubeFetch):Promise<string> {
  if(/^UC[\w-]{22}$/.test(input))return channel(input);
  let path=input;
  if(input.startsWith('http')) { const url=new URL(input);if(url.protocol!=='https:'||!['youtube.com','www.youtube.com'].includes(url.hostname))throw new ApiError(400,'invalid_request','Use a YouTube channel URL.');path=url.pathname; }
  const bits=path.replace(/^\//,'').split('/');
  if(bits[0]==='channel')return channel(bits[1]);
  const params:Record<string,string>|null=bits[0].startsWith('@')?{forHandle:bits[0]}:bits[0]==='user'?{forUsername:text(bits[1],'username',100)}:null;
  if(!params)throw new ApiError(400,'invalid_request','Use a channel id, @handle, or YouTube channel URL.');
  const result=await read('channels',{part:'id',...params});
  if(!result.items?.[0]?.id)throw new ApiError(404,'invalid_request','Channel not found.');return channel(result.items[0].id);
}
/** Titles exist only transiently to match the learning map. Persist ids and authored catalog labels only. */
export async function importChannel(input:string,brand:CoursePayload['brand'],examId:string|null,read:YouTubeFetch=youtubeFetch()) {
  const source=await resolveChannel(input,read),exam=EXAMS.find(e=>e.id===examId);
  const subjects=new Map<string,CoursePayload['subjects'][number]>();let playlistCount=0,videoCount=0;
  async function pages(resource:string,params:Record<string,string>,visit:(item:NonNullable<Page['items']>[number])=>Promise<void>) {
    const seen=new Set<string>();let token='';
    do {
      if(seen.has(token))throw new ApiError(502,'upstream_error','YouTube returned a repeated page token.');seen.add(token);
      if(seen.size>100)throw new ApiError(400,'invalid_request','Import is too large. Split this channel into smaller courses.');
      const page=await read(resource,{...params,maxResults:'50',...(token?{pageToken:token}:{})});
      for(const item of page.items??[])await visit(item);token=page.nextPageToken??'';
    }while(token);
  }
  await pages('playlists',{part:'snippet',channelId:source},async playlist=>{
    if(++playlistCount>100)throw new ApiError(400,'invalid_request','Import at most 100 playlists per course.');
    if(!playlist.id||!/^[\w-]+$/.test(playlist.id))return;
    const title=(playlist.snippet?.title??'').toLowerCase();
    const match=exam?.topics.map(topic=>({topic,score:[topic.name,...topic.keywords.filter(k=>!k.startsWith('~'))].filter(k=>k.length>=4&&title.includes(k.toLowerCase())).reduce((n,k)=>n+k.length,0)})).sort((a,b)=>b.score-a.score)[0];
    const topic=match&&match.score>0?match.topic:null,group=topic?.group??'Other';
    if(!subjects.has(group))subjects.set(group,{id:slugify(group)||'other',title:group,topics:[]});
    const items:CoursePayload['subjects'][number]['topics'][number]['items']=[],seenVideos=new Set<string>();
    await pages('playlistItems',{part:'contentDetails',playlistId:playlist.id},async item=>{
      const id=item.contentDetails?.videoId;if(!id||! /^[\w-]{11}$/.test(id)||seenVideos.has(id))return;seenVideos.add(id);
      if(++videoCount>5000)throw new ApiError(400,'invalid_request','Import at most 5000 videos per course.');items.push({type:'video',videoId:id});
    });
    subjects.get(group)!.topics.push({id:`playlist-${playlist.id}`,title:topic?.name??`Playlist ${playlistCount}`,subtopics:topic?.keywords.filter(k=>!k.startsWith('~')).slice(0,20)??[],items});
  });
  if(!videoCount)throw new ApiError(400,'invalid_request','No public playlist videos found on this channel.');
  return {payload:{brand,subjects:[...subjects.values()],approvedChannels:[{id:source}],modes:[]} satisfies CoursePayload,sourceChannelId:source,playlists:playlistCount,videos:videoCount};
}
