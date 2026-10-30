import { analyze } from '@/server/analyze';
import { authorize } from '@/server/auth';
import { demoFiles } from '@/server/demo';
import { InputError } from '@/server/limits';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    authorize(request);
    return Response.json(
      await analyze(demoFiles, { name: 'atlas / order-platform', origin: 'demo' }),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof InputError ? error.message : 'Could not load the example.' },
      { status: error instanceof InputError ? error.status : 500 },
    );
  }
}
