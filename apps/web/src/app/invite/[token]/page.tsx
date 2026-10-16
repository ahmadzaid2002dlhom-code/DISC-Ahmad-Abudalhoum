import { connection } from 'next/server';
import InviteStart from '../invite-start';

export default async function Invitation({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  // GET is render-only: no DB writes, API redemption or session changes here.
  return <InviteStart token={token} />;
}
