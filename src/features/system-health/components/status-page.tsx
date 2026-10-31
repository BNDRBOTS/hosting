import { getSystemStatus } from '../queries/status';

export async function StatusPage() {
  const status = await getSystemStatus();
  return (
    <main>
      <h1>ProofLoop status</h1>
      {status.state === 'ready' ? (
        <p>ProofLoop is ready.</p>
      ) : (
        <p>ProofLoop is having trouble checking whether it is ready. Try again in a little while.</p>
      )}
    </main>
  );
}
