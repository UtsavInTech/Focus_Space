import {useEffect,useState} from 'react';
import {Check, ArrowRight} from 'lucide-react';
import type {Call} from '../institute-tools/shared';
type Setup={items:{id:string;label:string;done:boolean;href:string}[];completed:number;total:number};
export function SetupChecklist({org,call}:{org:string;call:Call}){
  const [state,setState]=useState<Setup|null>(null),[error,setError]=useState(''),[dismissed,setDismissed]=useState(false);
  useEffect(()=>{let live=true;setState(null);setDismissed(false);setError('');void call<Setup>(`/v1/studio/${org}/setup`).then(s=>live&&setState(s)).catch(e=>live&&setError(e.message));return()=>{live=false;};},[org,call]);
  if(dismissed)return null;
  const next=state?.items.find(i=>!i.done);
  return <section className="fss-setup-guide"><div className="fss-setup-overview"><div><p className="fss-section-kicker">Your setup</p><h2>{state?.completed===state?.total&&state?'Ready for your team.':'A few steps to get started.'}</h2><p>{state?`${state.completed} of ${state.total} steps complete`:'Checking your institute…'}</p></div>{state&&<progress max={state.total} value={state.completed} aria-label="Institute setup progress"/>}</div>
    {error&&<p role="alert">{error}</p>}
    {next&&<a className="fss-setup-next" href={next.href}><span><small>Recommended next step</small><strong>{next.label}</strong></span><ArrowRight size={20}/></a>}
    {state&&<details><summary>{next?'See all setup steps':'Review completed setup'}</summary><ol>{state.items.map((item,i)=><li key={item.id} className={item.done?'is-complete':''}><span className="fss-step-number">{item.done?<Check size={15}/>:i+1}</span><a href={item.href}>{item.label}</a><small>{item.done?'Complete':'To do'}</small></li>)}</ol><p>Course, batch, quiz and faculty setup is managed with your FocusSpace staff contact.</p></details>}
    {state&&state.completed===state.total&&<button className="fss-text-action" onClick={()=>setDismissed(true)}>Dismiss setup</button>}
  </section>;
}
