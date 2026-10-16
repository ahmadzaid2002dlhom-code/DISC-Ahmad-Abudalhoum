import { connection } from 'next/server';
import InviteStart from './invite-start';

export default async function LegacyInvitation() {
  await connection();
  return <InviteStart />;
}
