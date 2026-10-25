import { describe,expect,it } from 'vitest';
import * as v from './validate';
import { CONSENT_VERSION } from './types';
describe('institute boundary validation',()=>{
  it('normalises Indian mobile numbers and rejects other formats',()=>{
    expect(v.phone('9123456789')).toBe('+919123456789');expect(v.phone('+919123456789')).toBe('+919123456789');
    for(const value of ['+12025550123','1234567890','+915123456789','91234',null]) expect(()=>v.phone(value)).toThrow();
  });
  it('requires explicit versioned consent choices and an exclusive course/join selector',()=>{
    expect(()=>v.sharing({progress:true,contact:true})).toThrow();expect(()=>v.sharing({textVersion:CONSENT_VERSION,progress:1,contact:false})).toThrow();
    expect(()=>v.enrollment({courseId:'a',joinCode:'long-join-code',phone:'9123456789',consents:{textVersion:CONSENT_VERSION,progress:false,contact:false}})).toThrow();
  });
  it('bounds pagination, quiz answers and executable URLs',()=>{
    expect(()=>v.page(new URLSearchParams('limit=100000'))).toThrow();expect(()=>v.https('javascript:alert(1)')).toThrow();
    expect(()=>v.quiz([{question:'Test',options:['A','B'],answer:2}])).toThrow();
    expect(v.page(new URLSearchParams('limit=20&minCompletion=80&minQuizScore=70'))).toMatchObject({limit:20,minCompletion:80,minQuizScore:70});
  });
});
