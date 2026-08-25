import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth/auth';

const handler = toNextJsHandler(getAuth());

export const GET = handler.GET;
export const POST = handler.POST;
