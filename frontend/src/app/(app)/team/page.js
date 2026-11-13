'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';
import { formatDateShort, humanizeEnum } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';

export default function TeamMembersPage() {
  const { activeOrg, user } = useAuth();
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [feedback, setFeedback] = useState('');
  const [devInviteToken, setDevInviteToken] = useState('');
  const [error, setError] = useState('');
  const [inviting, setInviting] = useState(false);

  const isAdmin = activeOrg?.role === 'org_admin' || user?.isSuperAdmin;
  const canInvite = isAdmin || activeOrg?.role === 'manager';

  const loadTeam = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const data = await apiRequest('/organizations/current/members');
      setMembers(data.members || []);
      setInvitations(data.invitations || []);
    } finally {
      setLoading(false);
    }
  }, [activeOrg]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  const handleInvite = async (e) => {
    e.preventDefault();
    setError('');
    setFeedback('');
    setDevInviteToken('');
    setInviting(true);
    try {
      const res = await apiRequest('/organizations/current/invitations', {
        method: 'POST',
        body: { email: inviteEmail.trim(), role: inviteRole },
      });
      setFeedback(`Invitation sent to ${res.invitation.email}.`);
      if (res.devInviteToken) setDevInviteToken(res.devInviteToken);
      setInviteEmail('');
      loadTeam();
    } catch (err) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (memberId, role) => {
    setError('');
    try {
      await apiRequest(`/organizations/current/members/${memberId}`, {
        method: 'PATCH',
        body: { role },
      });
      loadTeam();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveMember = async (memberId) => {
    setError('');
    try {
      await apiRequest(`/organizations/current/members/${memberId}`, { method: 'DELETE' });
      loadTeam();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRevokeInvite = async (inviteId) => {
    await apiRequest(`/organizations/current/invitations/${inviteId}`, { method: 'DELETE' });
    loadTeam();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Team Members</h1>
        <p className="text-sm text-ink-muted">
          Manage members, roles, and invitations for <strong>{activeOrg?.name}</strong>
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 space-y-1">
          <p>{feedback}</p>
          {devInviteToken && (
            <p className="font-mono break-all">
              Dev invite link: /invite/accept?token={devInviteToken}
            </p>
          )}
        </div>
      )}

      {canInvite && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-burgundy" />
              Invite Team Member
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
              <Input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="flex-1"
              />
              <Select
                className="sm:w-44"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="member">Member</option>
                <option value="manager">Manager</option>
                {isAdmin && <option value="org_admin">Organization Admin</option>}
              </Select>
              <Button type="submit" disabled={inviting}>
                {inviting ? 'Sending...' : 'Send Invitation'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-burgundy" />
            Active Members ({members.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-border">
          {loading ? (
            <p className="p-6 text-xs text-ink-muted">Loading team members...</p>
          ) : (
            members.map((m) => (
              <div
                key={m.memberId}
                className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink">
                    {m.fullName} {m.userId === user?.id && <span className="text-xs text-ink-muted">(You)</span>}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {m.email}
                    {m.jobTitle ? ` · ${m.jobTitle}` : ''} · Joined {formatDateShort(m.joinedAt)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {isAdmin ? (
                    <>
                      <Select
                        className="h-8 text-xs w-36"
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.memberId, e.target.value)}
                      >
                        <option value="org_admin">Org Admin</option>
                        <option value="manager">Manager</option>
                        <option value="member">Member</option>
                      </Select>
                      {m.userId !== user?.id && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.memberId)}
                          className="p-1.5 rounded-md text-ink-muted hover:bg-red-50 hover:text-red-600"
                          title="Remove member"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  ) : (
                    <Badge variant="midnight">
                      <Shield className="h-3 w-3 mr-1" />
                      {humanizeEnum(m.role)}
                    </Badge>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-burgundy" />
              Pending Invitations ({invitations.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border">
            {invitations.map((inv) => (
              <div key={inv.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-ink-muted">
                    Role: {humanizeEnum(inv.role)} · Expires {formatDateShort(inv.expiresAt)}
                  </p>
                </div>
                {canInvite && (
                  <Button variant="outline" size="sm" onClick={() => handleRevokeInvite(inv.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

