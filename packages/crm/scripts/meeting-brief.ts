#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { buildMeetingBrief, getMeetingBrief, refreshMeetingBrief, type MeetingBriefContext } from '../lib/application/meeting-brief-service.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseRepository } from '../lib/data/supabase-repository.ts';
import { supabaseMeetingBriefRepository } from '../lib/data/supabase-meeting-brief-repository.ts';
import { MeetingBriefError } from '../lib/domain/meeting-brief.ts';
import { narrateMeetingBrief, type MeetingBriefNarrationOptions } from '../lib/application/meeting-brief-narration.ts';
import { loadWorkspaceAiRuntimeCredential } from '../lib/application/workspace-ai-settings.ts';
import { createSupabaseOmnixAiBudgetAuthority } from '../lib/application/omnix-ai-budget.ts';

const usage = 'Usage: meeting-brief <build --contact ID [--transaction ID]|get --id ID|refresh --id ID --version N|narrate --id ID> --live';
export async function runMeetingBriefCli(argv: readonly string[], deps: { context: () => Promise<MeetingBriefContext>; stdout: (s:string)=>void; stderr: (s:string)=>void; clock?: ()=>Date; narrationOptions?: (context:MeetingBriefContext)=>Promise<MeetingBriefNarrationOptions> }): Promise<number> {
  try {
    if (argv.length===1 && argv[0]==='--help') { deps.stdout(`${usage}\n`); return 0; }
    const command = argv[0] ?? ''; const options = new Map<string,string>();
    if (!['build','get','refresh','narrate'].includes(command) || argv.filter(v=>v==='--live').length!==1) throw new MeetingBriefError('invalid-input',usage);
    for(let index=1;index<argv.length;index++) {
      const key=argv[index] ?? ''; if(key==='--live') continue;
      const value=argv[index+1];
      if(!['--contact','--transaction','--id','--version'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw new MeetingBriefError('invalid-input',usage);
      options.set(key,value); index++;
    }
    const context = await deps.context();
    const result = command==='build' ? await buildMeetingBrief(context,{contactId:options.get('--contact')??'',transactionId:options.get('--transaction'),trigger:'cli'},deps.clock)
      : command==='get' ? await getMeetingBrief(context,options.get('--id')??'',deps.clock)
        :command==='narrate'?await narrateMeetingBrief(context,options.get('--id')??'',await deps.narrationOptions?.(context)??{},deps.clock)
          : await refreshMeetingBrief(context,options.get('--id')??'',Number(options.get('--version')),deps.clock);
    deps.stdout(`${JSON.stringify(result)}\n`); return 0;
  } catch(error) {
    deps.stderr(`${JSON.stringify({schemaVersion:'meeting-brief.v1',ok:false,code:error instanceof MeetingBriefError?error.code:'unavailable',message:error instanceof MeetingBriefError?error.message:'Meeting brief unavailable. Check authentication and retry.'})}\n`); return 1;
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let authenticated:Awaited<ReturnType<typeof createAuthenticatedCliContext>>|undefined;
  process.exitCode=await runMeetingBriefCli(process.argv.slice(2),{context:async()=>{authenticated=await createAuthenticatedCliContext();const {client,scope}=authenticated;return {repository:supabaseRepository(client,scope),workspaceScope:scope,isLive:true,meetingBriefRepository:supabaseMeetingBriefRepository(client)};},narrationOptions:async(context)=>({credential:await loadWorkspaceAiRuntimeCredential(context.workspaceScope).catch(()=>undefined),budget:authenticated?createSupabaseOmnixAiBudgetAuthority(authenticated.client,context.workspaceScope):undefined}),stdout:s=>process.stdout.write(s),stderr:s=>process.stderr.write(s)});
}
