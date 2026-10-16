import { connection } from 'next/server';
import AssessmentFlow from './assessment-flow';

export default async function Assessment() {
  await connection();
  return <AssessmentFlow />;
}
