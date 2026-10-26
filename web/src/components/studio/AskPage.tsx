import {useEffect,useState} from 'react';
import {ArrowRight, Plus, Pin, MessageSquare, ArrowDownUp, Bookmark} from 'lucide-react';
import type {Call} from '../institute-tools/shared';
import type {StudentRules} from '../../../../server/institutes/studio-types';
import type {Table} from '../../../../server/institutes/studio-ai';
import {placeHash,type Place} from './model';
import {OutcomeButton} from './ResultsPage';
import {EmptyState,WorkspaceHeader} from './WorkspaceUI';
import {SUGGESTED_QUESTIONS} from '../../content/studio';
import {columnLabel,displayCell,visibleColumns} from './table-display';
interface Answer{threadId:string;answer:string;tables:Table[];how:string[];followUps:string[]}
interface Thread{id:string;title:string;pinned:boolean}
export function AskPage({org,call,initial='',thread,savedList,go,onPlaybook}:{org:string;call:Call;initial?:string;thread?:string;savedList?:string;go:(p:Place)=>void;onPlaybook:(rules:StudentRules)=>void}){
  const [question,setQuestion]=useState(initial),[answer,setAnswer]=useState<Answer|null>(null),[threadId,setThread]=useState(thread);
  const [threads,setThreads]=useState<Thread[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[listNext,setListNext]=useState<string|null>(null),[history,setHistory]=useState<{question:string}[]>([]);
  const load=()=>call<{threads:Thread[]}>(`/v1/studio/${org}/threads`).then(r=>setThreads(r.threads));
  useEffect(()=>{let live=true;void call<{threads:Thread[]}>(`/v1/studio/${org}/threads`).then(r=>live&&setThreads(r.threads)).catch(e=>live&&setError(e.message));if(thread)void call<{messages:{question:string}[]}>(`/v1/studio/${org}/threads/${thread}`).then(r=>{if(live){setQuestion(r.messages.at(-1)?.question??'');setHistory(r.messages);}}).catch(e=>live&&setError(e.message));return()=>{live=false;};},[org,thread,call]);
  useEffect(()=>{if(!savedList)return;let live=true;void call<{list:{name:string;rules:StudentRules};items:Record<string,unknown>[];next:string|null}>(`/v1/studio/${org}/lists/${savedList}`).then(r=>{if(live){setListNext(r.next);setAnswer({threadId:'',answer:`${r.list.name}: current matching students.`,tables:[{title:r.list.name,columns:Object.keys(r.items[0]??{}),rows:r.items,rules:r.list.rules}],how:['Saved filters run again against current records and sharing choices.'],followUps:[]});}}).catch(e=>live&&setError(e.message));return()=>{live=false;};},[org,savedList,call]);
  const ask=async(value=question)=>{setBusy(true);setError('');try{const r=await call<Answer>(`/v1/studio/${org}/ask`,{question:value,...(threadId?{threadId}:{})});setAnswer(r);setListNext(null);setThread(r.threadId);setQuestion(value);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const pinned=threads.find(t=>t.id===answer?.threadId)?.pinned??false;
  return <section className="fss-workspace fss-ask-page">
    <WorkspaceHeader eyebrow="Ask" title="Turn a question into a next step." description="Find students to help, understand their learning, or check your recorded results."/>
    <div className="fss-ask-layout"><aside className="fss-thread-list"><button disabled={busy} onClick={()=>{setThread(undefined);setAnswer(null);setQuestion('');setHistory([]);setListNext(null);go({room:'ask'});}}><Plus size={16}/> New question</button><p className="fss-section-kicker">Recent conversations</p>{threads.map(t=><a key={t.id} aria-current={threadId===t.id?'page':undefined} href={placeHash({room:'ask',threadId:t.id})}><MessageSquare size={15}/><span>{t.title}</span>{t.pinned&&<Pin size={13}/>}</a>)}{!threads.length&&<p>Questions you ask will be saved here.</p>}</aside>
      <div className="fss-conversation">{history.length>0&&<details className="fss-evidence"><summary>Earlier questions · {history.length}</summary>{history.map((m,i)=><p key={i}>{m.question}</p>)}<small>Ask again to see the current records.</small></details>}
        <form className="fss-question-composer" onSubmit={e=>{e.preventDefault();void ask();}}><label htmlFor="studio-question">What would you like to know?</label><textarea disabled={busy} id="studio-question" value={question} onChange={e=>setQuestion(e.target.value)} required maxLength={1000} placeholder="Which students finished 10 lectures and might be ready for our paid course?"/><div><span>Answers include the records and filters used.</span><button className="fss-primary" disabled={busy||!question.trim()}>{busy?'Finding answers…':'Ask question'} <ArrowRight size={16}/></button></div></form>
        {error&&<p className="fss-feedback" role="alert">{error}</p>}{busy&&<div className="fss-loading-panel" role="status"><span className="fss-loading-dot"/> Checking permitted records and preparing your answer…</div>}
        {!answer&&!busy&&<section className="fss-question-starters"><p className="fss-section-kicker">A useful place to start</p><h2>What needs attention today?</h2>{SUGGESTED_QUESTIONS.slice(0,4).map((q,i)=><button key={q} onClick={()=>setQuestion(q)}><span>{String(i+1).padStart(2,'0')}</span><strong>{q}</strong><ArrowRight size={16}/></button>)}<p>Choose a question to edit it before asking.</p></section>}
        {answer&&<article className="fss-answer"><div className="fss-answer-intro"><span className="fss-section-kicker">From your institute’s records</span><p>{answer.answer}</p>{answer.threadId&&<button className="fss-text-action" onClick={()=>void call(`/v1/studio/${org}/threads/${answer.threadId}`,{pinned:!pinned}).then(load).catch(e=>setError(e.message))}><Pin size={15}/>{pinned?'Unpin conversation':'Pin conversation'}</button>}</div>
          {answer.tables.map((table,i)=><AnswerTable key={`${answer.threadId}:${i}:${table.title}`} table={table} org={org} call={call} go={go} onPlaybook={onPlaybook}/>)}
          {savedList&&listNext&&<button disabled={busy} onClick={()=>{setBusy(true);void call<{items:Record<string,unknown>[];next:string|null}>(`/v1/studio/${org}/lists/${savedList}?after=${encodeURIComponent(listNext)}`).then(r=>{setListNext(r.next);setAnswer(old=>old?{...old,tables:old.tables.map((t,i)=>i?t:{...t,rows:[...t.rows,...r.items]})}:old);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Show more matching students</button>}
          <details className="fss-evidence"><summary>How this answer was found</summary><ul>{answer.how.map((line,i)=><li key={i}>{line}</li>)}</ul></details><div className="fss-suggestions">{answer.followUps.map(q=><button key={q} disabled={busy} onClick={()=>void ask(q)}>{q} <ArrowRight size={14}/></button>)}</div>
        </article>}
      </div>
    </div>
  </section>;
}
function AnswerTable({table,org,call,go,onPlaybook}:{table:Table;org:string;call:Call;go:(p:Place)=>void;onPlaybook:(rules:StudentRules)=>void}){
  const [sort,setSort]=useState(''),[reverse,setReverse]=useState(false),[status,setStatus]=useState(''),[all,setAll]=useState(false);
  const columns=visibleColumns(table.columns,all),hasStudent=table.rows.some(r=>typeof r.user_id==='string');
  const rows=[...table.rows].sort((a,b)=>{const x=a[sort],y=b[sort];const n=typeof x==='number'&&typeof y==='number'?x-y:String(x??'').localeCompare(String(y??''));return reverse?-n:n;});
  return <section className="fss-answer-table"><div className="fss-section-heading"><div><h2>{table.title}</h2><p>{rows.length} records shown{table.hasMore?' · more matches available; narrow your question':''}</p></div>{rows.length>0&&<button className="fss-text-action" onClick={()=>setAll(v=>!v)}>{all?'Fewer columns':'More details'}</button>}</div>
    {table.rules&&<div className="fss-actions"><button onClick={()=>void call(`/v1/studio/${org}/lists`,{name:table.title,rules:table.rules}).then(()=>setStatus('List saved in the sidebar. It will update when you open it.')).catch(e=>setStatus(e.message))}><Bookmark size={15}/> Save list</button><button className="fss-primary" onClick={()=>onPlaybook(table.rules!)}>Create a playbook <ArrowRight size={15}/></button></div>}
    {status&&<p className="fss-feedback" role="status">{status}</p>}{!rows.length?<EmptyState title="No records match yet"><p>Try a broader question or reduce a threshold, such as the number of finished lectures.</p></EmptyState>:<div className="fss-table-scroll" tabIndex={0} aria-label={table.title}><table><thead><tr>{columns.map(c=><th key={c} aria-sort={sort===c?(reverse?'descending':'ascending'):'none'}><button onClick={()=>{setSort(c);setReverse(sort===c?!reverse:false);}}>{columnLabel(c)} <ArrowDownUp size={12}/></button></th>)}{hasStudent&&<th>Next step</th>}</tr></thead><tbody>{rows.map((row,i)=><tr key={String(row.user_id??row.id??i)}>{columns.map(c=><td key={c}>{c==='name'&&typeof row.user_id==='string'?<button className="fss-student-link" onClick={()=>go({room:'student',id:row.user_id as string})}>{displayCell(c,row[c])}</button>:displayCell(c,row[c])}</td>)}{hasStudent&&<td>{typeof row.user_id==='string'&&<OutcomeButton org={org} call={call} userId={row.user_id}/>}</td>}</tr>)}</tbody></table></div>}
  </section>;
}
