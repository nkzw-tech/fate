import Section from './Section.tsx';
import Stack from './Stack.tsx';

export default function Thinking() {
  return (
    <Section>
      <Stack center className="animate-pulse text-gray-500 italic" verticalPadding={48}>
        Thinking...
      </Stack>
    </Section>
  );
}
