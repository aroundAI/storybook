import { Slot } from 'radix-ui';

import { cn } from '../../lib/utils';
import { GradientSecondaryText } from './gradient-secondary-text';

export const Pill: React.FC<
  React.HTMLAttributes<HTMLHeadingElement> & {
    label?: React.ReactNode;
    asChild?: boolean;
  }
> = function PillComponent({ className, asChild, ...props }) {
  const Comp = asChild ? Slot.Root : 'h3';

  return (
    <Comp
      className={cn(
        'flex items-center gap-x-1.5 rounded-full border bg-muted/50 px-2 py-1 pr-2 text-center text-sm font-medium text-transparent',
        className,
      )}
      {...props}
    >
      {props.label && (
        <span
          className={
            'rounded-2xl border bg-primary px-1.5 py-0.5 text-xs font-bold tracking-tight text-primary-foreground'
          }
        >
          {props.label}
        </span>
      )}
      <Slot.Slottable>
        <GradientSecondaryText
          className={'flex items-center gap-x-2 font-semibold tracking-tight'}
        >
          {props.children}
        </GradientSecondaryText>
      </Slot.Slottable>
    </Comp>
  );
};

export const PillActionButton: React.FC<
  React.HTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
  }
> = ({ asChild, ...props }) => {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      {...props}
      className={
        'rounded-full bg-input px-1.5 py-1.5 text-center text-sm font-medium text-secondary-foreground ring ring-transparent transition-colors hover:ring-muted-foreground/50 active:bg-primary active:text-primary-foreground'
      }
    >
      {props.children}
    </Comp>
  );
};
