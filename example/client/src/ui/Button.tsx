import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { ButtonHTMLAttributes, useTransition } from 'react';
import cx from '../lib/cx.tsx';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-10 px-4 py-2',
        icon: 'h-10 w-10',
        lg: 'h-11 rounded-lg px-8',
        sm: 'h-9 rounded-lg px-3',
      },
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      },
    },
  },
);

const Button = ({
  action,
  asChild = false,
  className,
  disabled,
  onClick: initialOnClick,
  size,
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    action?: () => void;
    asChild?: boolean;
  }) => {
  const Component = asChild ? Slot : 'button';

  const [isPending, startTransition] = useTransition();

  const onClick =
    initialOnClick || (action ? () => startTransition(action) : undefined);

  return (
    <Component
      className={cx(buttonVariants({ className, size, variant }))}
      disabled={disabled !== undefined ? disabled : isPending}
      onClick={onClick}
      {...props}
    />
  );
};

export { Button, buttonVariants };
