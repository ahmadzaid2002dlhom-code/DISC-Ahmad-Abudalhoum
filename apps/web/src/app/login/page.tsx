import { connection } from 'next/server';
import LoginForm from './login-form';

export default async function Login() {
  await connection();
  return <LoginForm />;
}
