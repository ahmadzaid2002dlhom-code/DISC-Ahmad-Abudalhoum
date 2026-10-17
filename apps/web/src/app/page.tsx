import { redirect } from 'next/navigation';

// Give the public prototype URL an entry point into the existing staff flow.
export default function Home() {
  redirect('/login');
}
