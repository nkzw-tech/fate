import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'preact';
import cx from '../lib/cx.ts';

const badgeVariants = cva(
  'squircle inline-flex items-center border px-1.5 py-0.5 text-xs font-semibold transition-colors focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none',
  {
    defaultVariants: {
      variant: 'default',
    },
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80 border-transparent',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
      },
    },
  },
);

export interface BadgeProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'className'>, VariantProps<typeof badgeVariants> {
  className?: string;
}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cx(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
