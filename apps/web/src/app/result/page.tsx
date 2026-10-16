import { connection } from 'next/server';
import Completion from './completion';

export default async function ResultReceipt() {
  await connection();
  return <Completion />;
}
