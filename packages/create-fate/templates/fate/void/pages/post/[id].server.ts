import { defineHandler, type InferProps } from 'void';

export type Props = InferProps<typeof loader>;

export const loader = defineHandler((context) => ({
  id: context.req.param('id'),
}));
