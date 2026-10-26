import type {ReactNode} from 'react';
import {ArrowUpRight, Inbox} from 'lucide-react';

export function WorkspaceHeader({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:ReactNode}) {
  return <header className="fss-workspace-head"><div><p className="fss-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action&&<div className="fss-head-action">{action}</div>}</header>;
}
export function EmptyState({title,children}:{title:string;children:ReactNode}) {
  return <div className="fss-empty-state"><Inbox size={24} aria-hidden="true"/><h3>{title}</h3><div>{children}</div></div>;
}
export function SummaryStat({label,value,detail,href}:{label:string;value:ReactNode;detail:string;href?:string}) {
  const content=<><span>{label}{href&&<ArrowUpRight size={15} aria-hidden="true"/>}</span><strong>{value}</strong><small>{detail}</small></>;
  return href?<a className="fss-summary-stat" href={href}>{content}</a>:<div className="fss-summary-stat">{content}</div>;
}
