import { json, corsOptions } from '../lib/http.js';

export async function OPTIONS() {
  return corsOptions('GET, OPTIONS');
}

export async function GET() {
  return json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  });
}
