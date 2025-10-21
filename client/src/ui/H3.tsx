export default function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">
      {children}
    </h3>
  );
}
