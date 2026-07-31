import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'expediente_integro_token';
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://YOUR_SERVER/api';
const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';

async function request(method, path, { token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.detail || `Error ${response.status}`);
  return payload;
}

export async function login(email, password) {
  const result = await request('POST', '/auth/login', { body: { email, password } });
  await SecureStore.setItemAsync(TOKEN_KEY, result.access_token);
  return result;
}

export const restoreToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const logout = () => SecureStore.deleteItemAsync(TOKEN_KEY);
export const getCases = (token) => request('GET', '/cases', { token });
export const getDocuments = (token, caseId) => request('GET', `/documents?case_id=${caseId}`, { token });
export const getVersions = (token, documentId) => request('GET', `/documents/${documentId}/versions`, { token });
export const signVersion = (token, versionId) => request('POST', `/documents/versions/${versionId}/signatures`, { token, body: {} });

// There is deliberately no content/download function: mobile clients never
// retrieve original files, even when the person is a judge or notary.
