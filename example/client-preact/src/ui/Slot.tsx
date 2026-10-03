import { cloneElement, isValidElement, type ComponentChildren } from 'preact';

type Props = Record<string, unknown>;

// Same merge rules as `@radix-ui/react-slot`: child handlers run before slot
// handlers, styles are merged, class names are concatenated and any other child
// prop overrides the slot's.
const mergeProps = (slotProps: Props, childProps: Props) => {
  const overrideProps: Props = { ...childProps };

  for (const name in childProps) {
    const slotValue = slotProps[name];
    const childValue = childProps[name];

    if (/^on[A-Z]/.test(name)) {
      if (typeof slotValue === 'function' && typeof childValue === 'function') {
        overrideProps[name] = (...args: Array<unknown>) => {
          const result = childValue(...args);
          slotValue(...args);
          return result;
        };
      } else if (slotValue) {
        overrideProps[name] = slotValue;
      }
    } else if (name === 'style') {
      overrideProps[name] = { ...(slotValue as object), ...(childValue as object) };
    } else if (name === 'className') {
      overrideProps[name] = [slotValue, childValue].filter(Boolean).join(' ');
    }
  }

  return { ...slotProps, ...overrideProps };
};

/**
 * A minimal `@radix-ui/react-slot`: renders its only child element with the
 * slot's props merged in, so `<Button asChild>` can style a link.
 */
export default function Slot({ children, ...slotProps }: Props & { children?: ComponentChildren }) {
  if (!isValidElement(children)) {
    return null;
  }

  return cloneElement(children, mergeProps(slotProps, children.props as Props));
}
