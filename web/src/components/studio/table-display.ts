/** Presentation only. Filtering and matching remain server decisions. */
const LABELS:Record<string,string>={name:'Student',phone:'Phone',completed_videos:'Lectures finished',quiz_score:'Quiz average',completion_percent:'Course completed',sharing_progress:'Shares progress',wants_contact:'Asked for a call',open_request:'Waiting for a call',watch_seconds:'Saved video time',active_days:'Study days',last_active:'Last studied',joined_at:'Joined',created_at:'Recorded',handled_at:'Handled',courses:'Courses joined',finished:'Lectures finished',quizzes:'Quiz attempts',started:'Started',done:'Finished',half:'Halfway',day:'Date',enrolled:'Paid enrolments',fees_rupees:'Agreed fees',source:'Request source',note:'Student’s message',video_id:'Video',course_id:'Course reference',course_title:'Course',drop_off:'Started, not finished'};
export const columnLabel=(key:string)=>LABELS[key]??key.replaceAll('_',' ');
export const visibleColumns=(columns:string[],all=false)=>columns.filter(c=>!['id','user_id','handled_by','phone_verified_at'].includes(c)&&(all||!['course_id','joined_at','created_at','handled_at','last_active','active_days','watch_seconds','courses','source','note','completion_percent','open_request'].includes(c)));
export function displayCell(key:string,value:unknown):string {
  if(value===null||value===undefined)return ['quiz_score','completion_percent','completed_videos','watch_seconds','last_active','active_days','finished','quizzes'].includes(key)?'Not shared / unavailable':'—';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(['joined_at','created_at','handled_at','last_active'].includes(key)){const date=new Date(Number(value));return Number.isFinite(date.getTime())?date.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}):'—';}
  if(['quiz_score','completion_percent'].includes(key))return `${value}%`;
  if(key==='fees_rupees')return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(value));
  if(key==='watch_seconds')return `${Math.round(Number(value)/60)} min`;
  if(typeof value==='number')return value.toLocaleString('en-IN');
  return typeof value==='object'?JSON.stringify(value):String(value);
}
