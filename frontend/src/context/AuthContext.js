'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, clearStoredAuth, getStoredAuth, setStoredAuth } from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [activeOrg, setActiveOrg] = useState(null);
  const [loading, setLoading] = useState(true);

  const syncOrganizations = useCallback((orgs, preferredOrgId) => {
    setOrganizations(orgs || []);
    if (!orgs || orgs.length === 0) {
      setActiveOrg(null);
      setStoredAuth({ organizationId: null });
      return null;
    }
    const chosen = orgs.find((o) => o.id === preferredOrgId) || orgs[0];
    setActiveOrg(chosen);
    setStoredAuth({ organizationId: chosen.id });
    return chosen;
  }, []);

  const refreshProfile = useCallback(async () => {
    const { accessToken, organizationId } = getStoredAuth();
    if (!accessToken) {
      setUser(null);
      setOrganizations([]);
      setActiveOrg(null);
      setLoading(false);
      return;
    }

    try {
      const data = await apiRequest('/auth/me');
      setUser(data.user);
      const chosen = syncOrganizations(data.organizations, organizationId);
      connectSocket(getStoredAuth().accessToken, chosen?.id);
    } catch {
      clearStoredAuth();
      setUser(null);
      setOrganizations([]);
      setActiveOrg(null);
      disconnectSocket();
    } finally {
      setLoading(false);
    }
  }, [syncOrganizations]);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const login = async (email, password) => {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    const firstOrgId = data.organizations?.[0]?.id || null;
    setStoredAuth({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      organizationId: firstOrgId,
    });
    setUser(data.user);
    const chosen = syncOrganizations(data.organizations, firstOrgId);
    connectSocket(data.accessToken, chosen?.id);
    return data;
  };

  const register = async (payload) => {
    const data = await apiRequest('/auth/register', {
      method: 'POST',
      body: payload,
    });
    const firstOrgId = data.organizations?.[0]?.id || null;
    setStoredAuth({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      organizationId: firstOrgId,
    });
    setUser(data.user);
    const chosen = syncOrganizations(data.organizations, firstOrgId);
    connectSocket(data.accessToken, chosen?.id);
    return data;
  };

  const logout = async () => {
    const { refreshToken } = getStoredAuth();
    try {
      if (refreshToken) {
        await apiRequest('/auth/logout', { method: 'POST', body: { refreshToken } });
      }
    } catch {
      // Clear local session regardless
    } finally {
      clearStoredAuth();
      disconnectSocket();
      setUser(null);
      setOrganizations([]);
      setActiveOrg(null);
    }
  };

  const switchOrganization = (orgId) => {
    const chosen = syncOrganizations(organizations, orgId);
    const { accessToken } = getStoredAuth();
    if (accessToken && chosen) {
      connectSocket(accessToken, chosen.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        organizations,
        activeOrg,
        loading,
        login,
        register,
        logout,
        switchOrganization,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}

