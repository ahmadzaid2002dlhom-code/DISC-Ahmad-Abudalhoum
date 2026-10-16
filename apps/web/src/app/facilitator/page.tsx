import { connection } from 'next/server';
import StaffScreen from '../../components/staff-screen';

export default async function Facilitator() {
  await connection();
  return <StaffScreen />;
}
