import {describe,it,expect,vi} from 'vitest';
import {UsageDb} from './db';
import {studioAi} from './studio';
describe('institute assistant budget',()=>{
 it('hard-stops before calling AI and meters actual tokens by institute',async()=>{const db=new UsageDb(':memory:');const llm=vi.fn(async()=>({data:{answer:'ok'},usage:{promptTokens:10,completionTokens:5}}));const ai=studioAi(db,{apiKey:'fake',model:'test',maxTokens:20},1400,llm);await ai('org',{system:'s',user:'u'},100);expect(db.studioUsage('org').tokens).toBe(15);expect(db.studioUsage('other').tokens).toBe(0);expect(db.reserveStudio('org','test',1300,1400)).not.toBeNull();await expect(ai('org',{system:'s',user:'u'},100)).rejects.toMatchObject({status:429});expect(llm).toHaveBeenCalledTimes(1);db.close();});
 it('keeps uncertain requests charged instead of resetting the budget',async()=>{const db=new UsageDb(':memory:');const ai=studioAi(db,{apiKey:'fake',model:'test',maxTokens:20},2000,async()=>{throw new Error('timeout');});await expect(ai('org',{system:'s',user:'u'},100)).rejects.toThrow('timeout');expect(db.studioUsage('org').tokens).toBeGreaterThan(1000);db.close();});
});
