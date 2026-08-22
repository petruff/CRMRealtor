import { executeOperationalApiRequest } from '@/lib/data/operational-api-server-context';
export async function GET(request:Request){const result=await executeOperationalApiRequest({action:'status.read',payload:{},correlationId:request.headers.get('x-correlation-id')},request);return Response.json(result.body,{status:result.status});}
