import { Slot } from 'radix-ui';

import { cn } from '../../lib/utils';

export const HeroTitle: React.FC<
  React.HTMLAttributes<HTMLHeadingElement> & {
    asChild?: boolean;
  }
> = function HeroTitleComponent({ children, className, ...props }) {
  const Comp = props.asChild ? Slot.Root : 'h1';

  return (
    <Comp
      className={cn(
        'hero-title flex flex-col text-center font-sans text-4xl font-semibold tracking-tighter sm:text-6xl lg:max-w-5xl lg:text-7xl xl:text-[4.5rem] dark:text-white',
        className,
      )}
      {...props}
    >
      <Slot.Slottable>{children}</Slot.Slottable>
    </Comp>
  );
};
