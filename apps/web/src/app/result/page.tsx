import { connection } from 'next/server';
import ReportScreen from '../../components/report-screen';

export default async function Result() {
  await connection();
  return <ReportScreen />;
}
