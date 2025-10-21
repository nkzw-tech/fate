import { Content, List, Root, Trigger } from '@radix-ui/react-tabs';
import { ComponentPropsWithoutRef, ComponentRef, forwardRef } from 'react';
import cx from '../lib/cx.tsx';

const Tabs = Root;

const TabsList = forwardRef<
  ComponentRef<typeof List>,
  ComponentPropsWithoutRef<typeof List>
>(({ className, ...props }, ref) => (
  <List
    className={cx(
      'bg-muted text-muted-foreground inline-flex h-10 items-center justify-center rounded-md p-1',
      className,
    )}
    ref={ref}
    {...props}
  />
));
TabsList.displayName = List.displayName;

const TabsTrigger = forwardRef<
  ComponentRef<typeof Trigger>,
  ComponentPropsWithoutRef<typeof Trigger>
>(({ className, ...props }, ref) => (
  <Trigger
    className={cx(
      'ring-offset-background focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm',
      className,
    )}
    ref={ref}
    {...props}
  />
));
TabsTrigger.displayName = Trigger.displayName;

const TabsContent = forwardRef<
  ComponentRef<typeof Content>,
  ComponentPropsWithoutRef<typeof Content>
>(({ className, ...props }, ref) => (
  <Content
    className={cx(
      'ring-offset-background focus-visible:ring-ring mt-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
      className,
    )}
    ref={ref}
    {...props}
  />
));
TabsContent.displayName = Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
