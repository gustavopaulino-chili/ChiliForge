import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';

interface Props {
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
  required?: boolean;
}

export function FieldLabel({ htmlFor, children, hint, className, required }: Props) {
  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={htmlFor}>
        {children}{required && ' *'}
      </Label>
      {hint && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            {hint}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
