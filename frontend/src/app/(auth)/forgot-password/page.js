'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [devToken, setDevToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setDevToken('');
    setSubmitting(true);
    try {
      const data = await apiRequest('/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      setMessage(data.message);
      if (data.devResetToken) setDevToken(data.devResetToken);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-warm dark:bg-midnight-deep px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl font-semibold text-ink">Reset your password</h1>
          <p className="text-sm text-ink-muted">
            Enter your email and we will send password reset instructions.
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  {error}
                </div>
              )}
              {message && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 space-y-1">
                  <p>{message}</p>
                  {devToken && (
                    <p>
                      Dev reset link:{' '}
                      <Link href={`/reset-password?token=${devToken}`} className="underline font-semibold">
                        Reset Password Now
                      </Link>
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium mb-1.5">Work Email</label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Sending...' : 'Send Reset Link'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-ink-muted">
          <Link href="/login" className="font-semibold text-burgundy hover:underline">
            Back to Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}

