import { connection } from 'next/server';
import ReportScreen from '../../../../../components/report-screen';

export default async function ParticipantReport({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  return <ReportScreen key={id} participantId={id} />;
}
