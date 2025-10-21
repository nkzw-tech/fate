import Stack from '@nkzw/stack';
import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router';
import AuthClient from './AuthClient.tsx';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { data: session } = AuthClient.useSession();

  const signIn = async (event: FormEvent) => {
    event.preventDefault();

    await AuthClient.signIn.email(
      {
        email,
        password,
      },
      {
        onError: () => {},
        onRequest: () => {},
        onSuccess: () => {},
      },
    );
  };

  if (session) {
    return <Navigate replace to="/" />;
  }

  return (
    <Stack gap vertical>
      <h2 className="text-lg font-bold">Sign In</h2>
      <Stack as="form" gap onSubmit={signIn}>
        <input
          className="rounded-sm border border-gray-500 p-2 font-mono text-gray-500 dark:border-gray-400 dark:text-gray-400"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email"
          type="email"
          value={email}
        />
        <input
          className="rounded-sm border border-gray-500 p-2 font-mono text-gray-500 dark:border-gray-400 dark:text-gray-400"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          type="password"
          value={password}
        />
        <button
          className="rounded-sm border border-gray-500 p-2 font-mono text-gray-500 dark:border-gray-400 dark:text-gray-400"
          type="submit"
        >
          Sign In
        </button>
      </Stack>
    </Stack>
  );
}
