'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState(token ? 'verifying' : 'missing');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    apiRequest('/auth/verify-email', { method: 'POST', body: { token } })
      .then((res) => {
        setStatus('success');
        setMessage(res.message);
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.message);
      });
  }, [token]);

  return (
    <Card>
      <CardContent className="p-6 text-center space-y-4">
        {status === 'verifying' && <p className="text-sm text-ink-muted">Verifying your email...</p>}
        {status === 'success' && (
          <>
            <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
            <h2 className="text-base font-semibold">Email Verified</h2>
            <p className="text-xs text-ink-muted">{message}</p>
            <Link href="/dashboard">
              <Button className="w-full">Go to Dashboard</Button>
            </Link>
          </>
        )}
        {(status === 'error' || status === 'missing') && (
          <>
            <XCircle className="h-10 w-10 text-red-600 mx-auto" />
            <h2 className="text-base font-semibold">Verification Failed</h2>
            <p className="text-xs text-ink-muted">
              {message || 'Missing or expired verification token.'}
            </p>
            <Link href="/login">
              <Button variant="outline" className="w-full">
                Back to Sign In
              </Button>
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-warm dark:bg-midnight-deep px-4">
      <div className="w-full max-w-md">
        <Suspense fallback={<Card><CardContent className="p-6 text-sm">Loading...</CardContent></Card>}>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </div>
  );
}

