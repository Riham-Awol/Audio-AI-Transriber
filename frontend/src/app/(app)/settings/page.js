'use client';

import { useEffect, useState } from 'react';
import { Building2, KeyRound, Laptop, MailCheck, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function SettingsPage() {
  const { user, activeOrg, refreshProfile } = useAuth();

  const [profile, setProfile] = useState({
    fullName: '',
    jobTitle: '',
    timezone: 'UTC',
  });
  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
  });
  const [orgForm, setOrgForm] = useState({
    name: '',
    industry: '',
    vocabulary: '',
  });
  const [sessions, setSessions] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setProfile({
        fullName: user.fullName || '',
        jobTitle: user.jobTitle || '',
        timezone: user.timezone || 'UTC',
      });
    }
    if (activeOrg) {
      setOrgForm({
        name: activeOrg.name || '',
        industry: activeOrg.industry || '',
        vocabulary: Array.isArray(activeOrg.defaultVocabulary)
          ? activeOrg.defaultVocabulary.join(', ')
          : '',
      });
    }
  }, [user, activeOrg]);

  const loadSessions = async () => {
    try {
      const data = await apiRequest('/auth/sessions');
      setSessions(data.sessions || []);
    } catch {
      setSessions([]);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setError('');
    setFeedback('');
    try {
      await apiRequest('/auth/me', { method: 'PATCH', body: profile });
      await refreshProfile();
      setFeedback('Profile updated.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setError('');
    setFeedback('');
    try {
      await apiRequest('/auth/me', { method: 'PATCH', body: passwords });
      setPasswords({ currentPassword: '', newPassword: '' });
      setFeedback('Password updated successfully.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResendVerification = async () => {
    setError('');
    const res = await apiRequest('/auth/resend-verification', { method: 'POST' });
    setFeedback(
      res.devVerificationToken
        ? `Verification link generated (dev token: ${res.devVerificationToken})`
        : res.message
    );
  };

  const handleRevokeSession = async (sessionId) => {
    await apiRequest(`/auth/sessions/${sessionId}`, { method: 'DELETE' });
    loadSessions();
  };

  const handleSaveOrg = async (e) => {
    e.preventDefault();
    setError('');
    setFeedback('');
    try {
      await apiRequest('/organizations/current', {
        method: 'PATCH',
        body: {
          name: orgForm.name,
          industry: orgForm.industry,
          defaultVocabulary: orgForm.vocabulary
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        },
      });
      await refreshProfile();
      setFeedback('Organization settings saved.');
    } catch (err) {
      setError(err.message);
    }
  };

  const isOrgAdmin = activeOrg?.role === 'org_admin' || user?.isSuperAdmin;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
        <p className="text-sm text-ink-muted">
          Manage your profile, security sessions, and organization preferences.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {feedback}
        </div>
      )}

      {/* Email verification status */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <MailCheck className="h-5 w-5 text-burgundy" />
            <div>
              <p className="text-sm font-medium">{user?.email}</p>
              <p className="text-xs text-ink-muted">
                {user?.emailVerified
                  ? 'Email address is verified.'
                  : 'Your email address has not been verified yet.'}
              </p>
            </div>
          </div>
          {user?.emailVerified ? (
            <Badge variant="success">Verified</Badge>
          ) : (
            <Button size="sm" variant="outline" onClick={handleResendVerification}>
              Resend Verification Email
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-4 w-4 text-burgundy" />
            Profile Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProfile} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Full Name</label>
              <Input
                required
                value={profile.fullName}
                onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Job Title</label>
              <Input
                value={profile.jobTitle}
                onChange={(e) => setProfile({ ...profile, jobTitle: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Timezone</label>
              <Input
                value={profile.timezone}
                onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
              />
            </div>
            <div className="sm:col-span-3 flex justify-end">
              <Button type="submit">Save Profile</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Organization Settings */}
      {isOrgAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-burgundy" />
              Organization Settings ({activeOrg?.name})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveOrg} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Organization Name</label>
                  <Input
                    required
                    value={orgForm.name}
                    onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Industry</label>
                  <Input
                    value={orgForm.industry}
                    onChange={(e) => setOrgForm({ ...orgForm, industry: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Default Custom Transcription Vocabulary (comma-separated)
                </label>
                <Input
                  value={orgForm.vocabulary}
                  onChange={(e) => setOrgForm({ ...orgForm, vocabulary: e.target.value })}
                  placeholder="VoxaMeet, WhisperX, Qwen3.5, Kubernetes"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit">Save Organization</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Password Change */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-burgundy" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Current Password</label>
              <Input
                type="password"
                required
                value={passwords.currentPassword}
                onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">New Password</label>
              <Input
                type="password"
                required
                minLength={8}
                value={passwords.newPassword}
                onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" variant="secondary">
                Update Password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Active Sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-burgundy" />
            Active Sessions ({sessions.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-border">
          {sessions.map((s) => (
            <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Laptop className="h-4 w-4 text-ink-muted shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{s.userAgent || 'Web Browser'}</p>
                  <p className="text-[11px] text-ink-muted">
                    IP: {s.ipAddress || 'Unknown'} · Last active {formatDateTime(s.lastActiveAt)}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleRevokeSession(s.id)}>
                Revoke
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

