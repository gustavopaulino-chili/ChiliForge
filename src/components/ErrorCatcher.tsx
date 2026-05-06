import { useEffect, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';

export const ErrorCatcher = () => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Captura erros não tratados
    const handleError = (event: ErrorEvent) => {
      const errorMessage = `Error: ${event.message}\nStack: ${event.error?.stack || 'No stack available'}\nTime: ${new Date().toISOString()}`;
      console.error('Global error caught:', errorMessage);
      setError(errorMessage);
    };

    // Captura promise rejections não tratadas
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const errorMessage = `Unhandled Promise Rejection: ${event.reason}\nTime: ${new Date().toISOString()}`;
      console.error('Unhandled rejection caught:', errorMessage);
      setError(errorMessage);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  const copyToClipboard = () => {
    if (error) {
      navigator.clipboard.writeText(error).then(() => {
        toast.success('Error copied to clipboard!');
      });
    }
  };

  return (
    <AlertDialog open={!!error} onOpenChange={(open) => !open && setError(null)}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>⚠️ An error occurred</AlertDialogTitle>
          <AlertDialogDescription>
            Click the copy button and paste the error here so I can help you resolve it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <div className="bg-muted p-4 rounded-lg max-h-80 overflow-y-auto">
          <p className="text-sm font-mono text-foreground whitespace-pre-wrap break-words">
            {error}
          </p>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={copyToClipboard}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition"
          >
            <Copy className="h-4 w-4" />
            Copy Error
          </button>
          <AlertDialogCancel>Close</AlertDialogCancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
