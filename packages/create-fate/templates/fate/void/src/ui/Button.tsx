import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useOptimistic,
  useTransition,
} from 'react';
import { useFormStatus } from 'react-dom';
import cx from '../lib/cx.tsx';

const buttonVariants = cva(
  'squircle inline-flex cursor-pointer items-center justify-center gap-2 text-sm font-medium whitespace-nowrap ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-10 px-3 py-2 active:pt-[11px] active:pb-[9px]',
        icon: 'h-10 w-10',
        lg: 'squircle h-11 px-6 active:pt-[11px] active:pb-[9px]',
        sm: 'squircle h-9 px-2 active:pt-[11px] active:pb-[9px]',
      },
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        outline: 'border-input border bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      },
    },
  },
);

const Button = ({
  action,
  asChild = false,
  children,
  className,
  disabled,
  onClick: initialOnClick,
  pendingPlaceholder = '...',
  size,
  type,
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    action?: () => Promise<unknown> | void;
    asChild?: boolean;
    pendingPlaceholder?: ReactNode;
  }) => {
  const Component = asChild ? Slot : 'button';

  const [optimisticIsPending, setOptimisticIsPending] = useOptimistic(false);
  const [transitionIsPending, startTransition] = useTransition();
  const { pending: formIsPending } = useFormStatus();

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    initialOnClick?.(event);

    if (!action || event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    startTransition(async () => {
      setOptimisticIsPending(true);
      await action();
    });
  };

  const isPending = transitionIsPending || optimisticIsPending || formIsPending;

  return (
    <Component
      className={cx(buttonVariants({ className, size, variant }))}
      disabled={disabled || isPending || undefined}
      onClick={initialOnClick || action ? onClick : undefined}
      type={type}
      {...props}
    >
      {isPending ? pendingPlaceholder : children}
    </Component>
  );
};

export { Button, buttonVariants };
