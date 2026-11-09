import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type * as React from 'react';
import { cn } from '../../lib/utils';

/** Provider belongs once near the app root; tooltips elsewhere use the parts. */
function TooltipProvider({ delayDuration = 200, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-72 rounded-sm border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
