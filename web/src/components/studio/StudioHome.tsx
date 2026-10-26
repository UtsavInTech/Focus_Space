import {ArrowRight, Phone, BookOpen} from 'lucide-react';
import {HomeAsk, type Recent} from './NavigationTools';
import {SetupChecklist} from './SetupChecklist';
import {SummaryStat, WorkspaceHeader} from './WorkspaceUI';
import {rupees, type Results} from './ResultsPage';
import {placeHash} from './model';
import type {Call} from '../institute-tools/shared';
import type {ReactNode} from 'react';

export function StudioHome({org,orgName,call,students,waiting,results,ask,recents,children}:{org:string;orgName:string;call:Call;students:number;waiting:number;results:Results|null;ask:(question:string)=>void;recents:Recent[];children:ReactNode}) {
  return <div className="fss-home-dashboard">
    <WorkspaceHeader eyebrow={orgName} title="A clear start to your day." description="See who needs you, follow up with students, and keep track of the results." action={<a className="fss-primary" href="#/requests">Review call requests <ArrowRight size={16}/></a>}/>
    <div className="fss-summary-strip">
      <SummaryStat label="Your students" value={students.toLocaleString('en-IN')} detail="Currently enrolled" href="#/students"/>
      <SummaryStat label="Waiting for a call" value={waiting} detail="Open requests from students" href="#/requests"/>
      <SummaryStat label="Paid enrolments" value={results?.enrolled??'—'} detail="Recorded this month" href="#/results"/>
      <SummaryStat label="Agreed course fees" value={results?rupees(results.fees):'—'} detail="Recorded this month · not collected payments" href="#/results"/>
    </div>
    <div className="fss-home-focus"><HomeAsk ask={ask}/><aside className="fss-next-action"><span className="fss-section-kicker"><Phone size={16}/> Next conversation</span><h2>{waiting?`${waiting} ${waiting===1?'student is':'students are'} waiting to hear from you.`:'Make the next conversation helpful.'}</h2><p>{waiting?'Start with students who asked for a call. Read their report before reaching out.':'Choose a reviewed playbook to find students who could use your guidance.'}</p><a href={waiting?'#/requests':'#/playbooks'}>{waiting?'Open call requests':'Explore playbooks'} <ArrowRight size={16}/></a><div className="fss-action-note"><BookOpen size={16}/><span>Study details appear only when students choose to share them.</span></div></aside></div>
    <SetupChecklist org={org} call={call}/>
    <div className="fss-daily-detail">{children}</div>
    {recents.length>0&&<section className="fss-jump-back"><div className="fss-section-heading"><h2>Pick up where you left off</h2><span>Recently opened</span></div><div>{recents.slice(0,4).map((r,i)=><a key={i} href={placeHash(r.place)}><span>{r.label}</span><ArrowUpRightIcon/></a>)}</div></section>}
  </div>;
}
function ArrowUpRightIcon(){return <ArrowRight size={16} aria-hidden="true"/>;}
