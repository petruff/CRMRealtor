import { describe, expect, it } from 'vitest';
import {
  ContactImportError,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  normalizePhoneIdentity,
  parseContactImport,
  parseDelimited,
  parseJsonContactImport,
} from './contact-import';

describe('contact import parser', () => {
  it('parses quoted and multiline RFC4180-style CSV cells', () => {
    const rows = parseDelimited('First Name,Last Name,Notes\r\nAvery,Stone,"Met at open house,\nready in spring"');
    expect(rows).toEqual([
      ['First Name', 'Last Name', 'Notes'],
      ['Avery', 'Stone', 'Met at open house,\nready in spring'],
    ]);
  });

  it('maps Mailchimp columns, tags, subscription state, and detects the preset', () => {
    const parsed = parseContactImport({
      filename: 'subscribed_members_export.csv',
      source: 'auto',
      content: 'Email Address,First Name,Last Name,Tags,Email Marketing\nJAMIE@EXAMPLE.COM,Jamie,Rivera,"Hot, VIP",subscribed',
    });
    expect(parsed.detectedSource).toBe('mailchimp');
    expect(parsed.candidates[0]).toMatchObject({
      firstName: 'Jamie',
      lastName: 'Rivera',
      email: 'jamie@example.com',
      leadType: 'hot',
      tags: ['Hot', 'VIP'],
      emailSubscribed: true,
    });
  });

  it.each([
    ['Email Subscribed,Tags', 'subscribed,DNC'],
    ['Email Subscribed,Notes', 'yes,Do not contact'],
    ['Email Subscribed,Status', 'true,unsubscribed'],
    ['Email Subscribed,Unsubscribe', 'true,yes'],
    ['Email Subscribed,Email Opt Out', 'true,opted out'],
  ])('lets negative consent evidence override positive source data in %s', (headers, values) => {
    const parsed = parseContactImport({
      filename: 'consent-safety.csv',
      content: `First Name,Email,${headers}\nAvery,avery@example.com,${values}`,
    });
    expect(parsed.rejected).toEqual([]);
    expect(parsed.candidates[0]?.emailSubscribed).toBe(false);
  });

  it('does not infer positive consent from a missing or negative automatic-intake field', () => {
    const missing = parseJsonContactImport({
      source: 'website', contacts: [{ externalId: 'web-missing', firstName: 'Missing' }],
    });
    const dnc = parseJsonContactImport({
      source: 'website', contacts: [{
        externalId: 'web-dnc', firstName: 'Suppressed', emailSubscribed: true, tags: 'DNC',
      }],
    });
    expect(missing.candidates[0]?.emailSubscribed).toBeUndefined();
    expect(dnc.candidates[0]?.emailSubscribed).toBe(false);
  });

  it('maps Google Contacts phone aliases and reports unknown columns', () => {
    const parsed = parseContactImport({
      filename: 'google.csv',
      source: 'auto',
      content: 'Given Name,Family Name,Phone 1 - Value,Custom Mystery\nTaylor,Ng,+1 (555) 010-1000,ignore me',
    });
    expect(parsed.detectedSource).toBe('google');
    expect(parsed.candidates[0]?.phone).toBe('+1 (555) 010-1000');
    expect(parsed.unknownFields).toEqual(['Custom Mystery']);
  });

  it('maps Needs review only from an explicit qualification column', () => {
    const parsed = parseContactImport({
      filename: 'explicit-qualification.csv', source: 'platform',
      content: 'First Name,Last Name,Lead Type,Qualification Status\nJudith,Client,Hot,needs-qualification',
    });
    expect(parsed.candidates[0]).toMatchObject({ leadType: 'hot', qualificationStatus: 'needs-qualification' });
  });

  it('detects a BoldTrail export and maps its common lead aliases', () => {
    const parsed = parseContactImport({
      filename: 'boldtrail-contacts.csv',
      source: 'auto',
      content: 'Lead ID,Contact Name,Primary Email,Primary Phone,Lead Source\nkv-22,Morgan Lee,morgan@example.com,5550102222,referral',
    });
    expect(parsed.detectedSource).toBe('boldtrail');
    expect(parsed.candidates[0]).toMatchObject({ externalId: 'kv-22', firstName: 'Morgan', lastName: 'Lee', source: 'referral' });
  });

  it('recognizes a reduced, reordered, and renamed KvCore export without reinterpreting Status or Rating', () => {
    const parsed = parseContactImport({
      filename: 'contacts-for-mailchimp.csv',
      source: 'auto',
      content: [
        'Rating,Email,Deal Type,Last Name,Cell Phone 1,Status,First Name,Contact Id',
        '2,JUDITH@example.com,seller,Serna,(305) 555-1212,Active Lead,Judith,kv-reduced-1',
      ].join('\n'),
    });

    expect(parsed).toMatchObject({
      provider: 'first-class-real-estate',
      totalRows: 1,
      rejected: [],
      preservedFields: [
        'Rating', 'Email', 'Deal Type', 'Last Name', 'Cell Phone 1', 'Status', 'First Name', 'Contact Id',
      ],
    });
    expect(parsed.candidates[0]).toMatchObject({
      externalId: 'kv-reduced-1', firstName: 'Judith', lastName: 'Serna',
      email: 'judith@example.com', phone: '3055551212', intent: 'seller',
    });
    expect(parsed.candidates[0]?.leadType).toBeUndefined();
    expect(parsed.candidates[0]?.pipelineStage).toBeUndefined();
    expect(parsed.candidates[0]?.sourceFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'status', label: 'Status', category: 'other', valueType: 'text', value: 'Active Lead', sourceRowNumber: 2 }),
      expect.objectContaining({ key: 'rating', label: 'Rating', category: 'engagement', valueType: 'number', value: 2, sourceRowNumber: 2 }),
    ]));
  });

  it('requires an explicit mapping before a generic Status column becomes pipelineStage', () => {
    const input = {
      filename: 'generic-contacts.csv',
      content: 'First Name,Status,Rating\nAvery,active,5',
    };
    const automatic = parseContactImport(input);
    expect(automatic.candidates[0]?.pipelineStage).toBeUndefined();
    expect(automatic.candidates[0]?.leadType).toBeUndefined();
    expect(automatic.candidates[0]?.relationship).toBeUndefined();
    expect(automatic.candidates[0]?.qualificationStatus).toBeUndefined();
    expect(automatic.unknownFields).toEqual(['Status', 'Rating']);

    const confirmed = parseContactImport({ ...input, mapping: { Status: 'pipelineStage' } });
    expect(confirmed.candidates[0]?.pipelineStage).toBe('active');
    expect(confirmed.unknownFields).toEqual(['Rating']);
  });

  it('imports relationship only from an explicit supported relationship column', () => {
    const parsed = parseContactImport({
      filename: 'explicit-relationship.csv',
      content: 'First Name,Relationship,Status,Rating\nAvery,active-client,Active Lead,5',
    });
    expect(parsed.candidates[0]).toMatchObject({ firstName: 'Avery', relationship: 'active-client' });
    expect(parsed.candidates[0]?.qualificationStatus).toBeUndefined();
    expect(parsed.candidates[0]?.pipelineStage).toBeUndefined();
  });

  it('normalizes realtor-facing organization labels while explicit lead type wins over tags', () => {
    const parsed = parseContactImport({
      filename: 'omnix-contacts.csv',
      content: [
        'First Name,Lead Type,Relationship,Intent,Source,Pipeline Stage,Tags',
        'Active,Hot,client,seller,lead import,client,nurture',
        'Archived,Warm,lead,buyer,cold call,archived,hot',
        'Website,,lead,buyer,organic website,new lead,nurture',
        'Prospect,,lead,seller,manual add,prospect,',
      ].join('\n'),
    });

    expect(parsed.rejected).toEqual([]);
    expect(parsed.candidates).toEqual([
      expect.objectContaining({ leadType: 'hot', relationship: 'active-client', intent: 'seller', source: 'other', pipelineStage: 'closed' }),
      expect.objectContaining({ leadType: 'warm', relationship: 'lead', intent: 'buyer', source: 'cold-call', pipelineStage: 'lost' }),
      expect.objectContaining({ leadType: 'nurture', relationship: 'lead', intent: 'buyer', source: 'website', pipelineStage: 'new' }),
      expect.objectContaining({ relationship: 'lead', intent: 'seller', source: 'other', pipelineStage: 'contacted' }),
    ]);
  });

  it.each([
    [' new lead ', 'new'],
    ['PROSPECT', 'contacted'],
    [' Active   Lead ', 'active'],
    ['client', 'closed'],
    ['ARCHIVED', 'lost'],
  ] as const)('maps imported pipeline status %s to %s', (sourceStage, expectedStage) => {
    const parsed = parseContactImport({
      filename: 'status-fidelity.csv',
      content: `First Name,Pipeline Stage\nSynthetic,${sourceStage}`,
    });
    expect(parsed.rejected).toEqual([]);
    expect(parsed.candidates[0]?.pipelineStage).toBe(expectedStage);
  });

  it('uses a KvCore filename hint when source columns were renamed and retains original provenance', () => {
    const parsed = parseContactImport({
      filename: 'kvcore-edited.csv',
      content: 'Given Name,Family Name,Email Address,Mobile,Status,Rating\nAvery,Stone,avery@example.com,3055550144,active,4',
      mapping: { Status: 'pipelineStage' },
    });

    expect(parsed.provider).toBe('first-class-real-estate');
    expect(parsed.candidates[0]).toMatchObject({
      firstName: 'Avery', lastName: 'Stone', phone: '3055550144', pipelineStage: 'active',
    });
    expect(parsed.candidates[0]?.leadType).toBeUndefined();
    expect(parsed.candidates[0]?.sourceFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'status', label: 'Status', category: 'other', valueType: 'text', value: 'active' }),
      expect.objectContaining({ key: 'rating', label: 'Rating', category: 'engagement', valueType: 'number', value: 4 }),
    ]));
  });

  it('classifies the complete sanitized 79-field source profile without dropping populated facts', () => {
    const headers = 'Contact Id,First Name,Last Name,Email,Email Optin,Cell Phone 1,Text On,Phone On,Status,Deal Type,Work Phone,Home Phone,Cell Phone 2,Source,System Source,Assigned Agent,Agent Email,Assigned Agent ID,Owner Type,Owner ID,Is Private,Location,Business Type,Spouse First Name,Spouse Last Name,Spouse Phone,Spouse Email,Spouse Birthday,Last Closed Date,Birthday,Registered,Referrer,Capture Method,Rating,Homeowner Status,Avg Price,Avg Beds,Avg Baths,Preferred Listing Name,Preferred City,Hashtags,Complete Primary Address,Primary Address,Primary City,Primary State,Primary Zip,Primary Address Label Line 1,Primary Address Label Line 2,Secondary Address,Call Count,Last Call,Email Count,Last Email,Last Email Date,Price Range,Search Count,Saved Search Count,Fav Count,Primary Call,Primary SMS,Latitude,Longitude,Lead Channel,Picture URL,Text Count,Behavior Alerts On,Verification Run,Email Verified,Phone Verified,Last Email Sent By Contact,Created At,Updated At,External Vendor ID,Merged At,Active MLS ID,Valuation Optin,TCPA Optin Date,TCPA Optin Party,TCPA Optin Party ID'.split(',');
    const booleanLabels = new Set(['Email Optin','Text On','Phone On','Is Private','Registered','Primary Call','Primary SMS','Behavior Alerts On','Verification Run','Email Verified','Phone Verified','Last Email Sent By Contact','Valuation Optin']);
    const numericLabels = new Set(['Rating','Avg Price','Avg Beds','Avg Baths','Call Count','Email Count','Search Count','Saved Search Count','Fav Count','Latitude','Longitude','Text Count']);
    const dateLabels = new Set(['Spouse Birthday','Last Closed Date','Birthday']);
    const timestampLabels = new Set(['Last Call','Last Email Date','Created At','Updated At','Merged At','TCPA Optin Date']);
    const overrides: Record<string, string> = {
      'Contact Id': 'synthetic-contact-79', 'First Name': 'Synthetic', 'Last Name': 'Contact',
      Email: 'synthetic@example.test', 'Cell Phone 1': '5551234567', 'Cell Phone 2': '5551234568',
      'Work Phone': '5551234569', 'Home Phone': '5551234570', Source: 'Referral', 'Deal Type': 'buyer',
    };
    const values = headers.map((label) => overrides[label] ?? (booleanLabels.has(label) ? 'Yes'
      : numericLabels.has(label) ? '3' : dateLabels.has(label) ? '2026-01-02'
        : timestampLabels.has(label) ? '2026-01-02T03:04:05Z' : `Synthetic ${label}`));
    const parsed = parseContactImport({
      filename: 'kvcore-sanitized-79.csv',
      content: [headers.join(','), values.map((value) => `"${value}"`).join(',')].join('\n'),
    });

    expect(parsed.rejected).toEqual([]);
    expect(parsed.preservedFields).toHaveLength(79);
    expect(parsed.candidates[0]?.sourceFacts).toHaveLength(79);
    expect(parsed.candidates[0]?.sourceFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'email-optin', category: 'consent', valueType: 'boolean', value: true }),
      expect.objectContaining({ key: 'rating', category: 'engagement', valueType: 'number', value: 3 }),
      expect.objectContaining({ key: 'tcpa-optin-date', category: 'consent', valueType: 'timestamp' }),
    ]));
  });

  it('parses Apple-style vCards including notes, address, and UID', () => {
    const parsed = parseContactImport({
      filename: 'iphone-contacts.vcf',
      source: 'auto',
      content: [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'N:Stone;Avery;;;',
        'FN:Avery Stone',
        'TEL;TYPE=CELL:+1 555 010 2000',
        'EMAIL:avery@example.com',
        'ADR:;;12 Main St;Austin;TX;78701;USA',
        'BDAY:19900408',
        'NOTE:Past client\\nMet through referral',
        'UID:apple-42',
        'END:VCARD',
      ].join('\r\n'),
    });
    expect(parsed.format).toBe('vcard');
    expect(parsed.detectedSource).toBe('apple');
    expect(parsed.candidates[0]).toMatchObject({
      externalId: 'apple-42',
      firstName: 'Avery',
      lastName: 'Stone',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      birthdate: '1990-04-08',
      note: 'Past client Met through referral',
    });
  });

  it('accepts slash dates but rejects impossible dates and missing names', () => {
    const parsed = parseContactImport({
      filename: 'contacts.csv',
      content: 'First Name,Last Name,Birthday\nJamie,Rivera,4/8/1990\n,,2/30/2020',
    });
    expect(parsed.candidates[0]?.birthdate).toBe('1990-04-08');
    expect(parsed.rejected[0]?.errors).toEqual(expect.arrayContaining([
      'At least a first or last name is required.',
      'Invalid date "2/30/2020".',
    ]));
    expect(parsed.rejected[0]?.incomplete).toBeUndefined();
  });

  it('retains only a safe quarantine projection for an identifiable invalid row', () => {
    const parsed = parseJsonContactImport({
      source: 'website',
      contacts: [{
        externalId: 'lead-invalid-1',
        firstName: '',
        email: 'not-an-email',
        authorization: 'Bearer must-never-persist',
        rawPayload: '{"secret":true}',
      }],
    });
    expect(parsed.rejected[0]?.incomplete).toMatchObject({
      externalId: 'lead-invalid-1',
      candidate: { email: 'not-an-email' },
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-email' }),
      ]),
    });
    expect(JSON.stringify(parsed.rejected[0]?.incomplete)).not.toMatch(/Bearer|secret|authorization|rawPayload/);
  });

  it('rejects unclosed quotes and accepts more than one thousand contact rows', () => {
    expect(() => parseDelimited('Name\n"broken')).toThrow(ContactImportError);
    const rows = Array.from({ length: 1_250 }, (_, index) => `Synthetic Contact ${index}`).join('\n');
    const parsed = parseContactImport({ filename: 'large.csv', content: `Name\n${rows}` });
    expect(parsed).toMatchObject({ totalRows: 1_250 });
    expect(parsed.candidates).toHaveLength(1_250);
  });

  it('retains cell, column, and cell-length security bounds without a row cap', () => {
    const headers = Array.from({ length: MAX_IMPORT_COLUMNS + 1 }, (_, index) => `Column ${index}`).join(',');
    expect(() => parseContactImport({ filename: 'wide.csv', content: `${headers}\nSynthetic` })).toThrow(/column safe limit/);
    expect(() => parseContactImport({
      filename: 'long-cell.csv',
      content: `Name,Notes\nSynthetic,${'A'.repeat(MAX_IMPORT_CELL_LENGTH + 1)}`,
    })).toThrow(/cell exceeds 4,096 characters/);
  });

  it('rejects oversized files, invalid enums, and oversized automatic batches', () => {
    expect(() => parseContactImport({ filename: 'huge.csv', content: `Name\n${'A'.repeat(2_000_001)}` })).toThrow(/2 MB/);
    const parsed = parseContactImport({ filename: 'bad.csv', content: 'Name,Relationship,Pipeline Stage\nAvery,customer,won' });
    expect(parsed.rejected[0]?.errors).toEqual(expect.arrayContaining(['Relationship is invalid.', 'Pipeline stage is invalid.']));
    expect(() => parseJsonContactImport({ source: 'website', contacts: Array.from({ length: 51 }, () => ({ firstName: 'A' })) })).toThrow(/1–50/);
  });

  it('rejects external IDs that cannot fit the provenance constraint', () => {
    const parsed = parseJsonContactImport({ source: 'website', contacts: [{ externalId: 'x'.repeat(256), firstName: 'Avery' }] });
    expect(parsed.rejected[0]?.errors).toContain('External ID must be 255 characters or fewer.');
  });

  it('parses bounded JSON intake records with camel-case aliases', () => {
    const parsed = parseJsonContactImport({
      source: 'website',
      contacts: [{ externalId: 'lead-1', firstName: 'River', email: 'river@example.com', leadType: 'warm' }],
    });
    expect(parsed.detectedSource).toBe('website');
    expect(parsed.candidates[0]).toMatchObject({ externalId: 'lead-1', firstName: 'River', email: 'river@example.com' });
  });

  it('normalizes US country prefixes without conflating arbitrary numbers', () => {
    expect(normalizePhoneIdentity('+1 (555) 010-2000')).toBe('5550102000');
    expect(normalizePhoneIdentity('+44 20 7946 0958')).toBe('442079460958');
  });
});
