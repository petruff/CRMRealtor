import { createHash } from 'node:crypto';
import { utils, write } from 'xlsx';
import type { Contact } from '../domain/contact.ts';

export const CONTACT_EXPORT_FIELDS = ['id','firstName','lastName','preferredName','phone','secondaryPhone','email','mailingAddress','city','state','postalCode','birthdate','homePurchaseDate','leadType','qualificationStatus','relationship','intent','source','pipelineStage','lastContactedAt','nextTouchAt','tags','emailSubscribed','createdAt','updatedAt','archivedAt'] as const;
export type ContactExportField = typeof CONTACT_EXPORT_FIELDS[number];

export function spreadsheetSafe(value: unknown): string {
  const text=Array.isArray(value)?value.join('|'):value==null?'':String(value);
  return /^[=+\-@\t\r]/.test(text)?`'${text}`:text;
}
export function parseContactExportFields(value: readonly string[]): ContactExportField[]{const unique=[...new Set(value)];if(unique.length<1||unique.some((field)=>!CONTACT_EXPORT_FIELDS.includes(field as ContactExportField)))throw new Error('Export fields must use the contact allowlist.');return unique as ContactExportField[];}
export function contactExportRows(contacts:readonly Contact[],fields:readonly ContactExportField[],includeArchived=false):string[][]{return [fields.map(String),...contacts.filter((c)=>includeArchived||!c.archivedAt).map((contact)=>fields.map((field)=>spreadsheetSafe(contact[field])))];}
export function createGovernedContactExport(contacts:readonly Contact[],input:{format:'csv'|'xlsx';fields:readonly string[];includeArchived?:boolean}){const fields=parseContactExportFields(input.fields);const rows=contactExportRows(contacts,fields,input.includeArchived);const selectionHash=createHash('sha256').update(JSON.stringify({fields,includeArchived:Boolean(input.includeArchived),ids:contacts.map((c)=>c.id)})).digest('hex');if(input.format==='csv'){const content=rows.map((row)=>row.map((cell)=>`"${cell.replace(/"/g,'""')}"`).join(',')).join('\r\n');return{bytes:new TextEncoder().encode(content),rowCount:rows.length-1,selectionHash};}const book=utils.book_new();utils.book_append_sheet(book,utils.aoa_to_sheet(rows),'Contacts');return{bytes:new Uint8Array(write(book,{type:'array',bookType:'xlsx',compression:true})),rowCount:rows.length-1,selectionHash};}
