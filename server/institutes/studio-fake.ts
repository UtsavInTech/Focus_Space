/** Demo/test only. Production routes never select this planner. No network, no provider tokens. */
import type {StudioLlm} from '../usage/studio';
export const fakeStudioLlm:StudioLlm=async(prompt)=>{
 const input=JSON.parse(prompt.user);let data:unknown;
 if(prompt.system.startsWith('Choose read-only')){
  const q=String(input.question).toLowerCase();const course=input.catalog.courses?.[0]?.id;
  const calls=q.includes('asked')||q.includes('requests')?[{fn:'requests',args:{open:!q.includes('closed')}}]:q.includes('fee')||q.includes('enrolment')?[{fn:'outcomes',args:{}}]:q.includes('lecture')&&(q.includes('viewers')||q.includes('lose'))?[{fn:'courseLessons',args:{courseId:course}}]:q.includes('activity')||q.includes('last week')?[{fn:'activity',args:{days:7}}]:q.includes('student report')?[{fn:'studentSummary',args:{id:input.catalog.studentId??'student-demo'}}]:q.includes('playbook matches')?[{fn:'playbookMatches',args:{playbookId:input.catalog.playbooks?.[0]?.id??'playbook-demo'}}]:[{fn:'students',args:{...(q.includes('quiet')?{quietDays:7}:{}),...(q.match(/above (\d+)/)?{minQuiz:Number(q.match(/above (\d+)/)![1])}:{}),...(q.match(/at least (\d+) lectures/)?{minLessons:Number(q.match(/at least (\d+) lectures/)![1])}:{}),...(q.includes('joined')?{joinedWithinDays:7}:{}),...(q.includes('private')?{sharing:false}:{}),limit:100}}];
  data={calls,intent:'Answer from institute records'};
 }else if(prompt.system.startsWith('Return JSON {answer'))data={answer:'The matching records are shown in the table. The filters below explain how they were selected.',followUps:['Who asked us to call?','Which students need help?']};
 else if(prompt.system.startsWith('Return JSON {rules'))data={rules:['Keep the opening friendly and the next step optional.','Avoid promises of results or guaranteed admission.']};
 else {const facts=input.facts;data={lines:[{text:`Hello ${facts.firstName}, would you like to discuss your next study step?`,reason:'The student’s first name and your reviewed outreach purpose.'},...(facts.finished===undefined?[]:[{text:`You have finished ${facts.finished} lectures.`,reason:'The finished-lecture count in the shared report.'}])]};}
 return {data,usage:{promptTokens:0,completionTokens:0}};
};
