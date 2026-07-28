import { json, corsOptions } from '../lib/http.js';
import { isCursorConfigured } from '../lib/cursor-agent.js';

export async function OPTIONS() {
  return corsOptions('GET, OPTIONS');
}

export async function GET() {
  return json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    cursorConfigured: isCursorConfigured(),
  });
}
