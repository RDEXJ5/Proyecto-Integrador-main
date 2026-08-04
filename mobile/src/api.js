import { NativeModules, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'expediente_integro_mobile_token';
function developmentApiUrl() {
  const scriptUrl = NativeModules.SourceCode?.scriptURL;
  const metroHost = typeof scriptUrl === 'string'
    ? scriptUrl.match(/^(?:https?|exp|exps):\/\/([^/:]+)/)?.[1]
    : null;
  return metroHost ? `http://${metroHost}:3001` : 'http://127.0.0.1:3001';
}

const API_URL = (process.env.EXPO_PUBLIC_MOBILE_API_URL || developmentApiUrl()).replace(/\/$/, '');

export class ApiClientError extends Error {
  constructor(message, { status = 0, code = 'network_error' } = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

function hasWebStorage() {
  return Platform.OS === 'web' && typeof globalThis.localStorage !== 'undefined';
}

export async function saveToken(token) {
  if (hasWebStorage()) {
    globalThis.localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function restoreToken() {
  if (hasWebStorage()) return globalThis.localStorage.getItem(TOKEN_KEY);
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function logout() {
  if (hasWebStorage()) {
    globalThis.localStorage.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function request(method, path, { token, body, formData, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(formData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(formData ? { body: formData } : body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = payload?.error;
      if (response.status === 401) await logout();
      throw new ApiClientError(error?.message || `El servicio respondió con el estado ${response.status}.`, {
        status: response.status,
        code: error?.code || 'api_error'
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (error?.name === 'AbortError') {
      throw new ApiClientError('La solicitud tardó demasiado. Verifica tu conexión.', { code: 'request_timeout' });
    }
    throw new ApiClientError(
      'No fue posible conectar con el servicio. Verifica tu conexión a Internet y que el servicio esté disponible.',
      { code: 'network_error' }
    );
  } finally {
    clearTimeout(timeout);
  }
}

function appendFile(formData, file) {
  if (Platform.OS === 'web' && file.file) {
    formData.append('file', file.file, file.name);
    return;
  }
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.type
  });
}

export async function login(email, password) {
  const result = await request('POST', '/auth/login', { body: { email, password } });
  await saveToken(result.accessToken);
  return result;
}

export async function register({ fullName, email, password, roleCode }) {
  const result = await request('POST', '/auth/register', {
    body: { fullName, email, password, roleCode }
  });
  await saveToken(result.accessToken);
  return result;
}

export const getMe = (token) => request('GET', '/auth/me', { token });

export const updateProfile = (token, fullName) => (
  request('PATCH', '/auth/me', { token, body: { fullName } })
);

export async function getCases(token) {
  const payload = await request('GET', '/cases', { token });
  return payload.cases ?? [];
}

export async function getInvitations(token) {
  const payload = await request('GET', '/invitations', { token });
  return payload.invitations ?? [];
}

export const acceptInvitation = (token, invitationId) => (
  request('POST', `/invitations/${invitationId}/accept`, { token, body: {} })
);

export const declineInvitation = (token, invitationId) => (
  request('POST', `/invitations/${invitationId}/decline`, { token, body: {} })
);

export async function getDocuments(token, caseId) {
  const payload = await request('GET', `/cases/${caseId}/documents`, { token });
  return payload.documents ?? [];
}

export async function getDocumentTypes(token, caseId) {
  const payload = await request('GET', `/cases/${caseId}/document-types`, { token });
  return payload.documentTypes ?? [];
}

export async function getVersions(token, documentId) {
  const payload = await request('GET', `/documents/${documentId}/versions`, { token });
  return payload.versions ?? [];
}

export async function getObservations(token, documentId) {
  const payload = await request('GET', `/documents/${documentId}/observations`, { token });
  return payload.observations ?? [];
}

export async function uploadDocument(token, caseId, { documentTypeCode, title, description, file }) {
  const formData = new FormData();
  formData.append('documentTypeCode', documentTypeCode);
  formData.append('title', title);
  if (description) formData.append('description', description);
  formData.append('uploadSource', file.uploadSource);
  appendFile(formData, file);
  return request('POST', `/cases/${caseId}/documents`, { token, formData, timeoutMs: 60000 });
}

export async function uploadVersion(token, documentId, file) {
  const formData = new FormData();
  formData.append('uploadSource', file.uploadSource);
  appendFile(formData, file);
  return request('POST', `/documents/${documentId}/versions`, { token, formData, timeoutMs: 60000 });
}

export const respondObservation = (token, documentId, observationId, body, referencedDocumentVersionId = null) => (
  request('POST', `/documents/${documentId}/observations/${observationId}/responses`, {
    token,
    body: { body, referencedDocumentVersionId }
  })
);
