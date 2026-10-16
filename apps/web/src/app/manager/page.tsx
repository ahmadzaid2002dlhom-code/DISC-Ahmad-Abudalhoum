import { connection } from 'next/server';
import StaffScreen from '../../components/staff-screen';

export default async function Manager() {
  await connection();
  return <StaffScreen manager />;
}
