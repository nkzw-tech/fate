export default function decodeGlobalID(globalID: string) {
  const separator = globalID.indexOf('-');
  if (separator <= 0 || separator >= globalID.length - 1) {
    throw new Error(`decodeGlobalID: Invalid global ID '${globalID}'.`);
  }
  const typename = globalID.slice(0, separator);
  const id = globalID.slice(separator + 1);
  if (!id) {
    throw new Error(`decodeGlobalID: Provided an empty id for '${typename}'.`);
  }
  return { id, typename };
}
