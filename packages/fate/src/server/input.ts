import { z } from 'zod';
import { connectionArgs } from './connection.ts';

export const byIdInput = z.object({
  args: connectionArgs,
  ids: z.array(z.string().min(1)).nonempty(),
  select: z.array(z.string()),
});

export const liveByIdInput = z.object({
  args: connectionArgs,
  id: z.string().min(1),
  select: z.array(z.string()),
});
