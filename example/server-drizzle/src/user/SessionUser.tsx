import type { UserRow } from '../drizzle/schema.ts';

export type SessionUser = Pick<UserRow, 'role' | 'id' | 'username'>;

export function toSessionUser({
  email,
  id,
  role,
  username,
}: Readonly<{
  email: string | null | undefined;
  id: string;
  role?: string | null | undefined;
  username?: string | null | undefined;
}>): SessionUser {
  return { id, role: role || '', username: username || email || '' };
}
