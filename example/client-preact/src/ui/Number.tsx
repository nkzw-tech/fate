const numberFormatter = new Intl.NumberFormat(undefined);

export default function Number({ value }: { value: number }) {
  return <>{numberFormatter.format(value)}</>;
}
