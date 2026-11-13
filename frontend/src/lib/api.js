const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const STORAGE_KEYS = {
  ACCESS: 'voxameet_access_token',
  REFRESH: 'voxameet_refresh_token',
  ORG_ID: 'voxameet_org_id',
};

export function getStoredAuth() {
  if (typeof window === 'undefined') {
    return { accessToken: null, refreshToken: null, organizationId: null };
  }
  return {
    accessToken: window.localStorage.getItem(STORAGE_KEYS.ACCESS),
    refreshToken: window.localStorage.getItem(STORAGE_KEYS.REFRESH),
    organizationId: window.localStorage.getItem(STORAGE_KEYS.ORG_ID),
  };
}

export function setStoredAuth({ accessToken, refreshToken, organizationId }) {
  if (typeof window === 'undefined') return;
  if (accessToken !== undefined) {
    if (accessToken) window.localStorage.setItem(STORAGE_KEYS.ACCESS, accessToken);
    else window.localStorage.removeItem(STORAGE_KEYS.ACCESS);
  }
  if (refreshToken !== undefined) {
    if (refreshToken) window.localStorage.setItem(STORAGE_KEYS.REFRESH, refreshToken);
    else window.localStorage.removeItem(STORAGE_KEYS.REFRESH);
  }
  if (organizationId !== undefined) {
    if (organizationId) window.localStorage.setItem(STORAGE_KEYS.ORG_ID, organizationId);
    else window.localStorage.removeItem(STORAGE_KEYS.ORG_ID);
  }
}

export function clearStoredAuth() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEYS.ACCESS);
  window.localStorage.removeItem(STORAGE_KEYS.REFRESH);
  window.localStorage.removeItem(STORAGE_KEYS.ORG_ID);
}

let refreshPromise = null;

async function refreshAccessToken() {
  const { refreshToken } = getStoredAuth();
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) {
          clearStoredAuth();
          return null;
        }
        const data = await res.json();
        setStoredAuth({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });
        return data.accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, headers = {}, retryOnAuth = true } = options;
  const { accessToken, organizationId } = getStoredAuth();

  const requestHeaders = {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(organizationId ? { 'X-Organization-Id': organizationId } : {}),
    ...headers,
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && retryOnAuth && !path.startsWith('/auth/login')) {
    const newAccessToken = await refreshAccessToken();
    if (newAccessToken) {
      return apiRequest(path, { ...options, retryOnAuth: false });
    }
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error?.message || `Request failed (${response.status})`);
    err.status = response.status;
    err.code = data?.error?.code || 'API_ERROR';
    throw err;
  }

  return data;
}

/**
 * Uploads a recording via XMLHttpRequest to provide accurate upload progress
 * percentages and abort/cancellation support for multi-hour recordings.
 */
export function uploadRecordingWithProgress(formData, { onProgress, onRegisterAbort } = {}) {
  return new Promise(async (resolve, reject) => {
    let { accessToken, organizationId } = getStoredAuth();
    if (!accessToken) {
      accessToken = await refreshAccessToken();
    }
    if (!accessToken) {
      reject(new Error('Your session has expired. Please sign in again.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/recordings/upload`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    if (organizationId) {
      xhr.setRequestHeader('X-Organization-Id', organizationId);
    }

    if (onRegisterAbort) {
      onRegisterAbort(() => xhr.abort());
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress(pct, event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data?.error?.message || `Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error occurred while uploading recording.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));

    xhr.send(formData);
  });
}

