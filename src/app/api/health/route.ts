import { getSystemStatus } from '@/features/system-health/queries/status';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const status = await getSystemStatus();
  if (status.state === 'ready') return Response.json({ status: 'ok' });
  return Response.json({ status: 'unavailable', referenceId: status.referenceId }, { status: 503 });
}
