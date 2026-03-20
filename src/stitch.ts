import { stitch as stitchSingleton, type Stitch, StitchToolClient } from '@google/stitch-sdk';

let client: (Stitch & Pick<StitchToolClient, 'listTools' | 'callTool' | 'close'>) | null = null;

export function getClient() {
  if (!client) {
    if (!process.env.STITCH_API_KEY && !process.env.STITCH_ACCESS_TOKEN) {
      throw new Error('STITCH_API_KEY or STITCH_ACCESS_TOKEN environment variable required');
    }
    client = stitchSingleton;
  }
  return client;
}

export async function fetchContent(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

export async function fetchBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || 'image/png';
  return { base64: buf.toString('base64'), mimeType: ct };
}
