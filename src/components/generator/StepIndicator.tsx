interface StepIndicatorProps {
  steps: { id: string; label: string }[];
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function StepIndicator({ steps, currentStep, onStepClick }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((step, i) => {
        const canClick = onStepClick && i <= currentStep;
        return (
          <div key={step.id} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canClick}
                onClick={() => canClick && onStepClick(i)}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all ${
                  canClick ? 'cursor-pointer hover:ring-2 hover:ring-primary/50' : 'cursor-default'
                } ${
                  i < currentStep
                    ? 'step-indicator-done'
                    : i === currentStep
                    ? 'step-indicator-active'
                    : 'step-indicator-pending'
                }`}
              >
                {i < currentStep ? '✓' : i + 1}
              </button>
              <span
                className={`hidden text-sm font-medium sm:block ${
                  i === currentStep ? 'text-foreground' : 'text-muted-foreground'
                } ${canClick ? 'cursor-pointer' : ''}`}
                onClick={() => canClick && onStepClick(i)}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`h-px w-6 sm:w-10 ${
                  i < currentStep ? 'bg-primary' : 'bg-border'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
