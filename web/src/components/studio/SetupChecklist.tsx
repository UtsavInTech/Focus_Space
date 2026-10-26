import {useEffect,useState} from 'react';
import type {Call} from '../institute-tools/shared';
export function SetupChecklist({org,call}:{org:string;call:Call}){
 const [state,setState]=useState<{items:{id:string;label:string;done:boolean;href:string}[];completed:number;total:number}|null>(null),[error,setError]=useState(''),[dismissed,setDismissed]=useState(false);
 useEffect(()=>{let live=true;setState(null);setDismissed(false);void call<NonNullable<typeof state>>(`/v1/studio/${org}/setup`).then(s=>live&&setState(s)).catch(e=>live&&setError(e.message));return()=>{live=false;};},[org,call]);
 if(dismissed)return null;
 return <section className="fss-setup"><h2>Get your institute ready {state&&<span>· {state.completed} of {state.total} complete</span>}</h2>{error?<p role="alert">{error}</p>:!state?<p>Checking your setup…</p>:<><ul>{state.items.map(item=><li key={item.id}>{item.done?'✓':'○'} <a href={item.href}>{item.label}</a> <span className="fss-sr-only">{item.done?'complete':'not complete'}</span></li>)}</ul><p>Course, batch, quiz and faculty setup is managed with your FocusSpace staff contact.</p>{state.completed===state.total&&<button onClick={()=>setDismissed(true)}>Dismiss completed checklist</button>}</>}</section>;
}
