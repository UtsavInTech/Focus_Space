import {describe,it,expect} from 'vitest';
import {visibleColumns,displayCell,columnLabel} from './table-display';
describe('staff-readable answer tables',()=>{
  it('keeps internal account identifiers hidden even when showing additional detail',()=>{
    const columns=['user_id','id','name','phone','phone_verified_at','handled_by','created_at','completed_videos'];
    expect(visibleColumns(columns)).toEqual(['name','phone','completed_videos']);
    expect(visibleColumns(columns,true)).toEqual(['name','phone','created_at','completed_videos']);
  });
  it('distinguishes zero scores from unavailable progress and formats boolean choices',()=>{
    expect(displayCell('quiz_score',0)).toBe('0%');
    expect(displayCell('quiz_score',null)).toBe('Not shared / unavailable');
    expect(displayCell('wants_contact',false)).toBe('No');
    expect(displayCell('wants_contact',true)).toBe('Yes');
    expect(displayCell('note',null)).toBe('—');
  });
  it('shows rupees and India calendar dates rather than raw timestamps',()=>{
    expect(displayCell('fees_rupees',125000)).toBe('₹1,25,000');
    expect(displayCell('created_at',Date.UTC(2026,9,25,20))).toBe('26 Oct 2026');
    expect(displayCell('created_at','invalid')).toBe('—');
    expect(displayCell('watch_seconds',120)).toBe('2 min');
  });
  it('uses counsellor-facing labels for technical report fields',()=>{
    expect(columnLabel('completed_videos')).toBe('Lectures finished');
    expect(columnLabel('wants_contact')).toBe('Asked for a call');
  });
});
