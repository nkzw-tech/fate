import { defineLiveStream } from 'void/live';

export const fateStream = defineLiveStream({
  allowAnonymousControl: true,
  id: 'fate',
});
