// Next.js instrumentation entrypoint. Runs once at server startup.
// Keep this file free of Node-only imports so it can also compile for the Edge runtime.
// All Node.js logic (SQLite / MongoDB / fs) lives in '@/lib/db/boot' and is imported ONLY
// inside the `NEXT_RUNTIME === 'nodejs'` guard so it is excluded from the Edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const mod = await import('@/lib/db/boot');
    await mod.register();
  }
}
