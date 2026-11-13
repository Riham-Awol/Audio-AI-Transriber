'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

function AcceptInviteContent() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const { user, refreshProfile } = useAuth();
  const router = useRouter();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAccept = async () => {
    setError('');
    setSubmitting(true);
    try {
      await apiRequest('/organizations/invitations/accept', {
        method: 'POST',
        body: { token },
      });
      await refreshProfile();
      router.replace('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-4 text-center">
        <h1 className="text-lg font-semibold">Organization Invitation</h1>
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {!user ? (
          <div className="space-y-3">
            <p className="text-xs text-ink-muted">
              Sign in or create an account with the invited email address to accept this invitation.
            </p>
            <div className="flex gap-2 justify-center">
              <Link href="/login">
                <Button>Sign In</Button>
              </Link>
              <Link href="/register">
                <Button variant="outline">Create Account</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-ink-muted">
              Signed in as <strong>{user.email}</strong>. Click below to join the organization.
            </p>
            <Button onClick={handleAccept} disabled={submitting || !token} className="w-full">
              {submitting ? 'Joining...' : 'Accept Invitation'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-warm dark:bg-midnight-deep px-4">
      <div className="w-full max-w-md">
        <Suspense fallback={<Card><CardContent className="p-6 text-sm">Loading...</CardContent></Card>}>
          <AcceptInviteContent />
        </Suspense>
      </div>
    </div>
  );
}

