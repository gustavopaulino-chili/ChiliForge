import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, continueWithoutLogin, user } = useAuth();

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/login.php' : '/api/register.php';
      const body = isLogin
        ? { email, pwd: password }
        : { email, pwd: password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      let data: any = null;

      try {
        data = JSON.parse(text);
      } catch (parseError) {
        throw new Error(
          `Invalid JSON response from ${endpoint} (status ${res.status}):\n${text}`
        );
      }

      if (!res.ok) {
        throw new Error(data.error || `Authentication error (${res.status})`);
      }

      const resolvedId = Number(data?.id ?? data?.user_id ?? data?.userId ?? data?.user?.id);
      const resolvedEmail = String(data?.email ?? data?.user_email ?? data?.userEmail ?? data?.user?.email ?? '').trim().toLowerCase();
      const resolvedName = String((data?.name ?? data?.user?.name ?? resolvedEmail) || '').trim();
      const resolvedAccountType = (data?.accountType ?? data?.account_type ?? data?.user?.accountType ?? data?.user?.account_type) === 'admin'
        ? 'admin'
        : 'testing';

      if (!Number.isFinite(resolvedId) || resolvedId <= 0 || !resolvedEmail) {
        throw new Error('Authentication response is missing valid user id/email.');
      }

      // ✅ save user in context
      signIn({
        id: resolvedId,
        email: resolvedEmail,
        name: resolvedName || resolvedEmail,
        accountType: resolvedAccountType,
      });

      toast.success(isLogin ? "Login successful!" : "Account created successfully!");
    } catch (err: any) {
      toast.error(err.message);
    }

    setLoading(false);
  };

  const handleContinueWithoutLogin = () => {
    continueWithoutLogin();
    toast.success('Continuing as guest.');
  };


  return (
    <div className="min-h-screen bg-background relative flex items-center justify-center px-4">
      <div className="reactive-bg-mouse" />
      <div className="glass-card rounded-2xl p-8 w-full max-w-md relative z-10">
        <div className="flex items-center justify-center gap-2 mb-6">
          <img src="/images/logo-small.png" alt="Logo" className="h-10 w-auto" />
          <img src="/images/logo.png" alt="Forge" className="h-8 w-auto" />
        </div>

        <h1 className="font-display text-2xl font-bold text-center text-foreground mb-2">
          {isLogin ? 'Login to your account' : 'Create a new account'}
        </h1>
        <p className="text-muted-foreground text-center text-sm mb-6">
          {isLogin
            ? 'Access your landing page history'
            : 'Start creating professional landing pages'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              minLength={6}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isLogin ? 'Login' : 'Create account'}
          </Button>
        </form>

        <div className="space-y-4">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleContinueWithoutLogin}
            >
              Continue without login
            </Button>

        </div>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-primary hover:underline"
          >
            {isLogin
              ? "Don't have an account? Create one now"
              : 'Already have an account? Log in'}
          </button>
        </div>
      </div>
    </div>
  );
}