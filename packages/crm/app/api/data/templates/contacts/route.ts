import { createContactTemplate } from '@/lib/application/workbook-portability';

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const bytes = await createContactTemplate(format);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      'content-type': format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="omnix-contacts-template.${format}"`,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
