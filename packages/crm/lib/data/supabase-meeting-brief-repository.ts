import type { SupabaseClient } from '@supabase/supabase-js';
import { MEETING_BRIEF_SOURCE_LIMIT, MeetingBriefError, meetingBriefIdentifier, type MeetingBriefSnapshot } from '../domain/meeting-brief.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { MeetingBriefRepository, MeetingBriefSourceRecord } from './meeting-brief-repository.ts';
import { supabaseContactIdentityMap } from './supabase-contact-identity-map.ts';

type Row = Record<string, unknown>;
const str = (r:Row, k:string) => typeof r[k] === 'string' ? r[k] as string : '';
function live(input: WorkspaceScope) { const scope = validateWorkspaceScope(input); if (scope.mode !== 'live') throw new MeetingBriefError('invalid-input', 'Live brief requires a live workspace.'); return scope; }
export function supabaseMeetingBriefRepository(client: SupabaseClient): MeetingBriefRepository {
  return {
    async loadSources(input, contactId, transactionId) {
      const scope = live(input); const records: MeetingBriefSourceRecord[] = []; const unavailable = ['provider messages', 'appointments']; const bounded: string[] = [];
      meetingBriefIdentifier(contactId);
      if(transactionId) meetingBriefIdentifier(transactionId);
      const group=await supabaseContactIdentityMap(client).listGroupMembers(scope,contactId);
      if(group.canonicalContactId!==contactId) throw new MeetingBriefError('not-found','Contact is unavailable.');
      const memberIds=[contactId,...group.memberContactIds.filter(id=>id!==contactId)].slice(0,MEETING_BRIEF_SOURCE_LIMIT);
      memberIds.forEach(meetingBriefIdentifier);
      if(group.memberContactIds.length>MEETING_BRIEF_SOURCE_LIMIT) bounded.push('contact aliases');
      const configs = [
        {name:'notes', table:'notes', columns:'id,workspace_id,contact_id,body,created_at', order:'created_at', type:'note', label:'Recorded note', text:(r:Row)=>`Recorded note: ${str(r,'body')}`, active:true},
        {name:'tasks', table:'tasks', columns:'id,workspace_id,contact_id,title,due_at,status,updated_at', order:'due_at', type:'task', label:'Open CRM task', text:(r:Row)=>`${str(r,'title')} · due ${str(r,'due_at')}`, active:false},
        {name:'activities', table:'activity_events', columns:'id,workspace_id,contact_id,type,occurred_at', order:'occurred_at', type:'activity', label:'Recorded activity', text:(r:Row)=>`Recorded activity: ${str(r,'type').replaceAll('-',' ')}`, active:false},
        {name:'transactions', table:'real_estate_transactions', columns:'id,workspace_id,contact_id,title,status,expected_close_date,next_action,updated_at', order:'updated_at', type:'transaction', label:'Transaction status and next step', text:(r:Row)=>`${str(r,'title')} · ${str(r,'status')}${str(r,'expected_close_date') ? ` · expected close ${str(r,'expected_close_date')}` : ''}${str(r,'next_action') ? ` · next step: ${str(r,'next_action')}` : ''}`, active:false},
        {name:'nurture', table:'omnix_nurture_plans', columns:'id,workspace_id,contact_id,state,cadence_days,next_step_at,updated_at', order:'updated_at', type:'nurture', label:'Nurture plan', text:(r:Row)=>`Nurture: ${str(r,'state')} · cadence ${Number(r.cadence_days)} days${str(r,'next_step_at') ? ` · next step ${str(r,'next_step_at')}` : ''}`, active:false},
        {name:'property behavior',table:'property_behavior_events',columns:'id,workspace_id,contact_id,behavior_type,source,source_occurred_at,permission_state',order:'source_occurred_at',type:'property-behavior',label:'Recorded property behavior',text:(r:Row)=>`Recorded property behavior: ${str(r,'behavior_type').replaceAll('-',' ')} · source: ${str(r,'source')}. This is an observed event, not a conclusion about buying intent.`,active:false},
      ] as const;
      await Promise.all(configs.map(async (c) => {
        try {
          let query = client.from(c.table).select(c.columns).eq('workspace_id',scope.workspaceId).in('contact_id',memberIds).order(c.order,{ascending:c.type==='task'}).limit(MEETING_BRIEF_SOURCE_LIMIT);
          if (c.active) query = query.is('archived_at', null);
          if (c.type === 'task') query = query.eq('status','open');
          if (c.type === 'property-behavior') query=query.eq('permission_state','allowed');
          if (c.type === 'transaction' && transactionId) query = query.eq('id',transactionId);
          const {data,error} = await query;
          if (error) { unavailable.push(c.name); return; }
          const rows = data as unknown as Row[];
          if (rows.length >= MEETING_BRIEF_SOURCE_LIMIT) bounded.push(c.name);
          records.push(...rows.filter(r=>memberIds.includes(str(r,'contact_id')) && (c.type!=='property-behavior' || str(r,'permission_state')==='allowed')).map((r):MeetingBriefSourceRecord=>({id:str(r,'id'),sourceType:c.type,contactId,workspaceId:str(r,'workspace_id'),time:str(r,'updated_at')||str(r,'occurred_at')||str(r,'source_occurred_at')||str(r,'created_at')||null,label:c.label,text:c.text(r),...(c.type==='task'?{dueAt:str(r,'due_at'),status:str(r,'status')}:{})})));
        } catch { unavailable.push(c.name); }
      }));
      try {
        const {data,error}=await client.from('contact_relationships').select('id,workspace_id,kind,label,created_at')
          .eq('workspace_id',scope.workspaceId).or(`first_contact_id.in.(${memberIds.join(',')}),second_contact_id.in.(${memberIds.join(',')})`)
          .is('archived_at',null).order('created_at',{ascending:false}).limit(MEETING_BRIEF_SOURCE_LIMIT);
        if(error) unavailable.push('relationships');
        else { const rows=data as unknown as Row[]; if(rows.length>=MEETING_BRIEF_SOURCE_LIMIT) bounded.push('relationships');
          records.push(...rows.map((r):MeetingBriefSourceRecord=>({id:str(r,'id'),sourceType:'relationship',workspaceId:str(r,'workspace_id'),contactId,time:str(r,'created_at'),label:'Recorded relationship role',text:`Recorded relationship: ${str(r,'kind')}${str(r,'label')?` · ${str(r,'label')}`:''}. Confirm current role with the client.`}))); }
      } catch { unavailable.push('relationships'); }
      try {
        const {data,error}=await client.from('household_memberships').select('id,workspace_id,created_at').eq('workspace_id',scope.workspaceId)
          .in('contact_id',memberIds).is('ended_at',null).order('created_at',{ascending:false}).limit(MEETING_BRIEF_SOURCE_LIMIT);
        if(error) unavailable.push('household');
        else { const rows=data as unknown as Row[]; if(rows.length>=MEETING_BRIEF_SOURCE_LIMIT) bounded.push('household');
          records.push(...rows.map((r):MeetingBriefSourceRecord=>({id:str(r,'id'),sourceType:'relationship',workspaceId:str(r,'workspace_id'),contactId,time:str(r,'created_at'),label:'Household membership',text:'Current household membership is recorded. Review the contact relationship panel for members.'}))); }
      } catch { unavailable.push('household'); }
      const transactionIds=records.filter(r=>r.sourceType==='transaction').map(r=>r.id);
      if(transactionIds.length) {
        try {
          const plans=await client.from('transaction_workflow_plans').select('id,transaction_id').eq('workspace_id',scope.workspaceId).in('transaction_id',transactionIds)
            .eq('status','active').order('updated_at',{ascending:false}).limit(MEETING_BRIEF_SOURCE_LIMIT);
          if(plans.error) throw new Error('unavailable');
          const planRows=plans.data as unknown as Row[];
          if(planRows.length>=MEETING_BRIEF_SOURCE_LIMIT) bounded.push('workflow plans');
          if(planRows.length) {
            const steps=await client.from('transaction_workflow_steps').select('id,workspace_id,plan_id,title,state,updated_at').eq('workspace_id',scope.workspaceId)
              .in('plan_id',planRows.map(r=>str(r,'id'))).order('position',{ascending:true}).limit(MEETING_BRIEF_SOURCE_LIMIT);
            if(steps.error) throw new Error('unavailable');
            const rows=steps.data as unknown as Row[]; if(rows.length>=MEETING_BRIEF_SOURCE_LIMIT) bounded.push('milestones');
            records.push(...rows.map((r):MeetingBriefSourceRecord=>({id:str(r,'id'),sourceType:'milestone',workspaceId:str(r,'workspace_id'),contactId,time:str(r,'updated_at'),label:'Recorded transaction milestone',text:`Milestone: ${str(r,'title')} · ${str(r,'state')}`,transactionId:str(planRows.find(p=>str(p,'id')===str(r,'plan_id'))??{},'transaction_id')})));
          }
        } catch { unavailable.push('milestones'); }
      }
      return {records, unavailable:unavailable.sort(), bounded:bounded.sort()};
    },
    async create(input, snapshot) {
      const scope = live(input);
      const {error} = await client.rpc('create_meeting_brief_snapshot',{target_workspace_id:scope.workspaceId,target_membership_id:scope.membershipId,target_snapshot:snapshot});
      if (error) throw new MeetingBriefError(error.code==='23505'?'conflict':'unavailable',error.code==='23505'?'This brief was already refreshed. Reopen the contact.':'Meeting brief storage is unavailable.');
    },
    async get(input,id) {
      const scope = live(input);
      const {data,error} = await client.from('meeting_brief_snapshots').select('snapshot').eq('workspace_id',scope.workspaceId).eq('id',id).maybeSingle();
      if (error) throw new MeetingBriefError('unavailable','Meeting brief storage is unavailable.');
      return data ? data.snapshot as MeetingBriefSnapshot : undefined;
    },
  };
}
