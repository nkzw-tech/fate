import PrismaTypes from '../../prisma/pothos-types.ts';
import decodeGlobalID from './decodeGlobalID.tsx';

export default function decodeIDOrThrow(type: keyof PrismaTypes, globalID: string) {
  const { id, typename } = decodeGlobalID(globalID);
  if (typename !== type || !id) {
    throw new Error(`Expected '${type}' but received '${typename}' with id '${id}'.`);
  }
  return id;
}
