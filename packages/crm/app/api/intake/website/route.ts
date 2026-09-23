import { NextResponse, type NextRequest } from 'next/server';
import { MAX_WEBSITE_INTAKE_BYTES, validWebsiteSignature, websiteIntakeConfiguration } from '@/lib/application/website-intake-security';
import { createAutomationContext } from '@/lib/data/automation-context';
import { validIdempotencyKey } from '@/lib/application/intake-security';
import { processWebsiteLeadSubmission } from '@/lib/application/website-intake-processor';

export const runtime = 'nodejs';

function safe(status: number, message: string, supportReference?: string, headers?: HeadersInit) {
  return NextResponse.json({ ok: status < 400, message, ...(supportReference ? { supportReference } : {}) }, { status, headers });
}

async function boundedBody(request: NextRequest): Promise<string | undefined> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBSITE_INTAKE_BYTES) return undefined;
  if (!request.body) return '';
  const reader=request.body.getReader();const decoder=new TextDecoder();let bytes=0;let body='';
  while(true){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_WEBSITE_INTAKE_BYTES){await reader.cancel();return undefined;}body+=decoder.decode(value,{stream:true});}
  return body+decoder.decode();
}

export async function POST(request: NextRequest) {
  const receivedAt=new Date();const configuration=websiteIntakeConfiguration();
  if(!configuration)return safe(503,'Website lead intake is not configured.');
  const body=await boundedBody(request);if(body===undefined)return safe(413,'The form submission is too large.');
  const idempotencyKey=request.headers.get('idempotency-key');const origin=request.headers.get('origin')?.trim()??'';
  if(!validIdempotencyKey(idempotencyKey))return safe(400,'A valid submission key is required.');
  if(!validWebsiteSignature({signature:request.headers.get('x-omnix-signature'),timestamp:request.headers.get('x-omnix-timestamp'),idempotencyKey,origin,body,secret:configuration.signingSecret,now:receivedAt}))return safe(401,'The form signature is invalid or expired.');
  let context;
  try{context=await createAutomationContext(configuration);}catch(error){console.error('Website intake workspace binding failed.',error);return safe(503,'Website lead intake is temporarily unavailable.');}
  const outcome=await processWebsiteLeadSubmission(context,{endpointKey:configuration.endpointKey,body,idempotencyKey,origin,forwardedFor:request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),userAgent:request.headers.get('user-agent'),receivedAt});
  return safe(outcome.status,outcome.message,outcome.supportReference,outcome.headers);
}
