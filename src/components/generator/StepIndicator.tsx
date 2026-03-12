interface StepIndicatorProps {
  steps: { id: string; label: string }[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all ${
                i < currentStep
                  ? 'step-indicator-done'
                  : i === currentStep
                  ? 'step-indicator-active'
                  : 'step-indicator-pending'
              }`}
            >
              {i < currentStep ? '✓' : i + 1}
            </div>
            <span
              className={`hidden text-sm font-medium sm:block ${
                i === currentStep ? 'text-foreground' : 'text-muted-foreground'
              }`}
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
      ))}
    </div>
  );
}
