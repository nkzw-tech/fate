import PrismaTypes from '../../prisma/pothos-types.ts';

export default function encodeGlobalID(typename: keyof PrismaTypes, id: string | number | bigint) {
  return `${typename}-${id}`;
}
