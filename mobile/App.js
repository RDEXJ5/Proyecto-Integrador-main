import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as api from './src/api';
import { captureDocumentPhoto, selectDocumentFile } from './src/file-pickers';
import { theme } from './theme';

const MOBILE_ROLES = ['party', 'witness'];
const SUPPORT_EMAIL = 'cristian05corona@gmail.com';
const ROLE_COPY = {
  party: {
    heading: 'Mi expediente',
    summary: 'Consulta y aporta únicamente tus documentos personales dentro de los expedientes vinculados.',
    label: 'Parte interesada',
    casesTitle: 'Mis expedientes',
    casesDescription: 'Asuntos en los que participas y que ya aceptaste consultar.',
    pendingDescription: 'Invitaciones y observaciones sobre tus documentos personales.'
  },
  witness: {
    heading: 'Mi participación',
    summary: 'Consulta y aporta solamente tu identificación, declaración y documentos personales autorizados.',
    label: 'Testigo',
    casesTitle: 'Mis participaciones',
    casesDescription: 'Asuntos en los que tu participación como testigo está activa.',
    pendingDescription: 'Invitaciones, identificación, declaraciones y observaciones propias.'
  }
};
const MOBILE_PERMISSION_COPY = {
  'workspace.mobile.access': 'Usar la aplicación móvil personal',
  'case.read.assigned': 'Consultar expedientes vinculados a tu participación',
  'document.read.assigned': 'Consultar tus documentos personales',
  'document.upload': 'Cargar documentos personales autorizados',
  'document.version.create': 'Registrar versiones nuevas sin sobrescribir',
  'document.observation.respond': 'Responder observaciones sobre tus documentos'
};
const STATUS_COPY = {
  active: 'Activo',
  paused: 'Pausado',
  draft: 'Borrador',
  closed: 'Cerrado',
  annulled: 'Anulado',
  archived: 'Archivado',
  open: 'Abierta',
  responded: 'Respondida',
  resolved: 'Resuelta',
  pending: 'Pendiente',
  accepted: 'Aceptada',
  declined: 'Rechazada',
  expired: 'Vencida',
  signed: 'Firmado',
  valid: 'Válida'
};

function formatDate(value) {
  if (!value) return 'Sin fecha disponible';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Tamaño no disponible';
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mobileRole(profile) {
  return profile?.roles?.find((role) => MOBILE_ROLES.includes(role.code))?.code ?? null;
}

function initials(value) {
  return String(value || 'Usuario')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default function App() {
  return <SafeAreaProvider>
    <MobileApp />
  </SafeAreaProvider>;
}

function MobileApp() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isCompact = width < 390;
  const isTablet = width >= 768;
  const horizontalPadding = width < 360 ? 14 : isTablet ? 28 : 18;
  const registrationNameInput = useRef(null);
  const emailInput = useRef(null);
  const passwordInput = useRef(null);
  const passwordConfirmationInput = useRef(null);
  const [token, setToken] = useState(null);
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [registrationName, setRegistrationName] = useState('');
  const [registrationRole, setRegistrationRole] = useState('party');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [cases, setCases] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [documentTypes, setDocumentTypes] = useState([]);
  const [versions, setVersions] = useState([]);
  const [observations, setObservations] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [screen, setScreen] = useState('home');
  const [caseReturnScreen, setCaseReturnScreen] = useState('cases');
  const [caseSearch, setCaseSearch] = useState('');
  const [caseFilter, setCaseFilter] = useState('all');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [showVersionForm, setShowVersionForm] = useState(false);
  const [documentTypeCode, setDocumentTypeCode] = useState('');
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentDescription, setDocumentDescription] = useState('');
  const [documentFile, setDocumentFile] = useState(null);
  const [versionFile, setVersionFile] = useState(null);
  const [responseObservationId, setResponseObservationId] = useState(null);
  const [responseText, setResponseText] = useState('');
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileName, setProfileName] = useState('');

  const roleCode = useMemo(() => mobileRole(profile), [profile]);
  const copy = ROLE_COPY[roleCode] ?? ROLE_COPY.party;
  const canUpload = profile?.permissions?.includes('document.upload');
  const activeCases = useMemo(
    () => cases.filter((item) => item.status === 'active'),
    [cases]
  );
  const pendingCases = useMemo(
    () => cases.filter((item) => Number(item.pending_observation_count || 0) > 0),
    [cases]
  );
  const pendingObservationCount = useMemo(
    () => cases.reduce((total, item) => total + Number(item.pending_observation_count || 0), 0),
    [cases]
  );
  const pendingTotal = invitations.length + pendingObservationCount;
  const filteredCases = useMemo(() => {
    const normalizedSearch = caseSearch.trim().toLocaleLowerCase('es-MX');
    return cases.filter((item) => {
      const matchesFilter = caseFilter === 'all'
        || (caseFilter === 'active' && item.status === 'active')
        || (caseFilter === 'attention' && Number(item.pending_observation_count || 0) > 0);
      if (!matchesFilter) return false;
      if (!normalizedSearch) return true;
      return [item.folio, item.title, item.case_type_label, item.legal_area_label]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('es-MX').includes(normalizedSearch));
    });
  }, [caseFilter, caseSearch, cases]);
  const rootScreen = ['documents', 'versions'].includes(screen) ? 'cases' : screen;

  useEffect(() => {
    async function restoreSession() {
      const savedToken = await api.restoreToken();
      if (!savedToken) {
        setLoading(false);
        return;
      }
      try {
        const savedProfile = await api.getMe(savedToken);
        if (!mobileRole(savedProfile)) throw new Error('La sesión no pertenece a un perfil móvil.');
        setToken(savedToken);
        setProfile(savedProfile);
        const [savedCases, savedInvitations] = await Promise.all([
          api.getCases(savedToken),
          api.getInvitations(savedToken)
        ]);
        setCases(savedCases);
        setInvitations(savedInvitations);
      } catch {
        await api.logout();
        setNotice('Tu sesión terminó. Ingresa nuevamente para continuar.');
      } finally {
        setLoading(false);
      }
    }
    restoreSession();
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  function navigateRoot(nextScreen) {
    Keyboard.dismiss();
    resetDocumentForm();
    resetVersionForm();
    setResponseObservationId(null);
    setResponseText('');
    if (nextScreen !== 'profile') setShowProfileForm(false);
    setScreen(nextScreen);
  }

  function toggleProfileForm() {
    setProfileName(profile?.fullName || '');
    setShowProfileForm((current) => !current);
  }

  async function saveProfile() {
    const normalizedName = profileName.trim().replace(/\s+/g, ' ');
    if (normalizedName.length < 3 || normalizedName.length > 160) {
      Alert.alert('Nombre no válido', 'El nombre debe contener entre 3 y 160 caracteres.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.updateProfile(token, normalizedName);
      setProfile(result.user);
      setProfileName(result.user.fullName);
      setShowProfileForm(false);
      Alert.alert(
        result.changed ? 'Perfil actualizado' : 'Sin cambios',
        result.changed ? 'Tu nombre visible se actualizó correctamente.' : 'El nombre ya estaba registrado de esa manera.'
      );
    } catch (error) {
      await handleError('No fue posible actualizar tu perfil', error);
    } finally {
      setBusy(false);
    }
  }

  async function contactSupport() {
    try {
      await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Solicitud%20de%20cambio%20de%20datos`);
    } catch {
      Alert.alert('Contacto de soporte', SUPPORT_EMAIL);
    }
  }

  async function handleError(title, error) {
    if (error?.status === 401) await signOut(false);
    Alert.alert(title, error?.message || 'Ocurrió un error inesperado.');
  }

  async function loadCases(activeToken = token) {
    setBusy(true);
    try {
      const [visibleCases, pendingInvitations] = await Promise.all([
        api.getCases(activeToken),
        api.getInvitations(activeToken)
      ]);
      setCases(visibleCases);
      setInvitations(pendingInvitations);
    } catch (error) {
      await handleError('No fue posible cargar los expedientes', error);
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    if (!email.trim() || !password) {
      Alert.alert('Datos incompletos', 'Escribe tu correo electrónico y contraseña.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.login(email.trim(), password);
      if (!mobileRole(result.user)) {
        await api.logout();
        throw new Error('Este perfil debe ingresar desde la plataforma web.');
      }
      setToken(result.accessToken);
      setProfile(result.user);
      const [visibleCases, pendingInvitations] = await Promise.all([
        api.getCases(result.accessToken),
        api.getInvitations(result.accessToken)
      ]);
      setCases(visibleCases);
      setInvitations(pendingInvitations);
      setScreen('home');
      setPassword('');
      setNotice('');
    } catch (error) {
      await handleError('Acceso no disponible', error);
    } finally {
      setBusy(false);
    }
  }

  async function registerAccount() {
    if (!registrationName.trim() || !email.trim() || !password || !passwordConfirmation) {
      Alert.alert('Datos incompletos', 'Completa todos los campos para crear tu cuenta.');
      return;
    }
    if (password.length < 4) {
      Alert.alert('Contraseña incompleta', 'La contraseña debe contener al menos 4 caracteres en esta versión de desarrollo.');
      return;
    }
    if (password !== passwordConfirmation) {
      Alert.alert('Contraseñas distintas', 'La confirmación no coincide con la contraseña.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.register({
        fullName: registrationName.trim(),
        email: email.trim(),
        password,
        roleCode: registrationRole
      });
      setToken(result.accessToken);
      setProfile(result.user);
      setCases([]);
      setInvitations([]);
      setScreen('home');
      setPassword('');
      setPasswordConfirmation('');
      setRegistrationName('');
      setNotice('');
      Alert.alert(
        'Cuenta creada',
        'Ya puedes usar tu espacio personal. Tus expedientes aparecerán después de aceptar una invitación.'
      );
    } catch (error) {
      await handleError('No fue posible crear la cuenta', error);
    } finally {
      setBusy(false);
    }
  }

  async function respondToInvitation(invitationId, action) {
    setBusy(true);
    try {
      if (action === 'accept') await api.acceptInvitation(token, invitationId);
      else await api.declineInvitation(token, invitationId);
      const [visibleCases, pendingInvitations] = await Promise.all([
        api.getCases(token),
        api.getInvitations(token)
      ]);
      setCases(visibleCases);
      setInvitations(pendingInvitations);
      Alert.alert(
        action === 'accept' ? 'Invitación aceptada' : 'Invitación rechazada',
        action === 'accept'
          ? 'El expediente ya está disponible en tu espacio personal.'
          : 'La respuesta quedó registrada en el historial.'
      );
    } catch (error) {
      await handleError('No fue posible responder la invitación', error);
    } finally {
      setBusy(false);
    }
  }

  function confirmDecline(invitationId) {
    Alert.alert(
      'Rechazar invitación',
      'Esta decisión quedará registrada y necesitarás una invitación nueva para ingresar al expediente.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Rechazar', style: 'destructive', onPress: () => respondToInvitation(invitationId, 'decline') }
      ]
    );
  }

  async function signOut(clearNotice = true) {
    await api.logout();
    setToken(null);
    setProfile(null);
    setCases([]);
    setInvitations([]);
    setDocuments([]);
    setDocumentTypes([]);
    setVersions([]);
    setObservations([]);
    setSelectedCase(null);
    setSelectedDocument(null);
    setScreen('home');
    setCaseReturnScreen('cases');
    setCaseSearch('');
    setCaseFilter('all');
    resetDocumentForm();
    resetVersionForm();
    setShowProfileForm(false);
    setProfileName('');
    if (clearNotice) setNotice('Sesión cerrada correctamente.');
  }

  async function openCase(item) {
    setBusy(true);
    try {
      const [caseDocuments, types] = await Promise.all([
        api.getDocuments(token, item.id),
        api.getDocumentTypes(token, item.id)
      ]);
      setSelectedCase(item);
      setDocuments(caseDocuments);
      setDocumentTypes(types);
      setSelectedDocument(null);
      setVersions([]);
      setObservations([]);
      resetDocumentForm();
      setCaseReturnScreen(['home', 'cases', 'pending'].includes(screen) ? screen : 'cases');
      setScreen('documents');
    } catch (error) {
      await handleError('No fue posible abrir el expediente', error);
    } finally {
      setBusy(false);
    }
  }

  async function refreshDocuments() {
    if (!selectedCase) return;
    setDocuments(await api.getDocuments(token, selectedCase.id));
  }

  async function openDocument(item) {
    setBusy(true);
    try {
      const [documentVersions, documentObservations] = await Promise.all([
        api.getVersions(token, item.id),
        api.getObservations(token, item.id)
      ]);
      setSelectedDocument(item);
      setVersions(documentVersions);
      setObservations(documentObservations);
      resetVersionForm();
      setResponseObservationId(null);
      setResponseText('');
      setScreen('versions');
    } catch (error) {
      await handleError('No fue posible consultar el documento', error);
    } finally {
      setBusy(false);
    }
  }

  function resetDocumentForm() {
    setShowDocumentForm(false);
    setDocumentTypeCode('');
    setDocumentTitle('');
    setDocumentDescription('');
    setDocumentFile(null);
  }

  function resetVersionForm() {
    setShowVersionForm(false);
    setVersionFile(null);
  }

  async function chooseFile(setter) {
    try {
      const file = await selectDocumentFile();
      if (file) setter(file);
    } catch (error) {
      await handleError('No fue posible seleccionar el archivo', error);
    }
  }

  async function takePhoto(setter) {
    try {
      const file = await captureDocumentPhoto();
      if (file) setter(file);
    } catch (error) {
      await handleError('No fue posible usar la cámara', error);
    }
  }

  async function submitDocument() {
    if (!documentTypeCode || documentTitle.trim().length < 2 || !documentFile) {
      Alert.alert('Datos incompletos', 'Selecciona el tipo, escribe un título y adjunta el documento.');
      return;
    }
    setBusy(true);
    try {
      await api.uploadDocument(token, selectedCase.id, {
        documentTypeCode,
        title: documentTitle.trim(),
        description: documentDescription.trim(),
        file: documentFile
      });
      await refreshDocuments();
      resetDocumentForm();
      Alert.alert('Documento registrado', 'El archivo quedó protegido en MinIO y se registró su primera versión.');
    } catch (error) {
      await handleError('No fue posible registrar el documento', error);
    } finally {
      setBusy(false);
    }
  }

  async function submitVersion() {
    if (!versionFile) {
      Alert.alert('Archivo requerido', 'Selecciona un archivo o toma una fotografía del documento.');
      return;
    }
    setBusy(true);
    try {
      await api.uploadVersion(token, selectedDocument.id, versionFile);
      setVersions(await api.getVersions(token, selectedDocument.id));
      await refreshDocuments();
      resetVersionForm();
      Alert.alert('Versión registrada', 'La versión anterior se conservó sin modificaciones.');
    } catch (error) {
      await handleError('No fue posible registrar la versión', error);
    } finally {
      setBusy(false);
    }
  }

  async function submitObservationResponse(observationId) {
    if (responseText.trim().length < 2) {
      Alert.alert('Respuesta incompleta', 'Escribe una respuesta de al menos dos caracteres.');
      return;
    }
    setBusy(true);
    try {
      await api.respondObservation(token, selectedDocument.id, observationId, responseText.trim());
      setObservations(await api.getObservations(token, selectedDocument.id));
      setResponseObservationId(null);
      setResponseText('');
      Alert.alert('Respuesta registrada', 'Tu respuesta quedó incorporada al historial del documento.');
    } catch (error) {
      await handleError('No fue posible responder la observación', error);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.center}><ActivityIndicator color={theme.colors.teal} /></SafeAreaView>;
  }

  if (!token || !profile) {
    return <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.loginSafe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.login, { paddingHorizontal: horizontalPadding }, isTablet && styles.loginTablet]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandMark}><Text style={styles.brandInitials}>EI</Text></View>
        <View style={styles.loginBadge}><Text style={styles.loginBadgeText}>PORTAL MÓVIL SEGURO</Text></View>
        <Text style={[styles.title, isCompact && styles.titleCompact]}>Expediente Íntegro</Text>
        <Text style={styles.subtitle}>Consulta y aporta tus documentos desde un espacio personal protegido.</Text>
        <View style={styles.authTabs}>
          <Pressable style={[styles.authTab, authMode === 'login' && styles.authTabActive]} onPress={() => setAuthMode('login')}>
            <Text style={[styles.authTabText, authMode === 'login' && styles.authTabTextActive]}>Iniciar sesión</Text>
          </Pressable>
          <Pressable style={[styles.authTab, authMode === 'register' && styles.authTabActive]} onPress={() => setAuthMode('register')}>
            <Text style={[styles.authTabText, authMode === 'register' && styles.authTabTextActive]}>Crear cuenta</Text>
          </Pressable>
        </View>
        {authMode === 'login' ? <View style={styles.securityList}>
          <Text style={styles.securityItem}>• Acceso exclusivo para partes y testigos.</Text>
          <Text style={styles.securityItem}>• Cada cambio genera una versión nueva.</Text>
          <Text style={styles.securityItem}>• Los archivos originales no se descargan.</Text>
        </View> : <View style={styles.infoCardCompact}>
          <Text style={styles.infoTitle}>Registro personal</Text>
          <Text style={styles.infoText}>Tu cuenta iniciará sin expedientes. El acceso se habilitará únicamente cuando aceptes una invitación.</Text>
        </View>}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {authMode === 'register' ? <>
          <TextInput
            ref={registrationNameInput}
            style={styles.input}
            placeholder="Nombre completo"
            autoCapitalize="words"
            autoCorrect={false}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            value={registrationName}
            onChangeText={setRegistrationName}
            onSubmitEditing={() => emailInput.current?.focus()}
            maxLength={160}
          />
          <Text style={styles.label}>Tipo de cuenta</Text>
          <View style={[styles.roleOptions, isCompact && styles.stackedActions]}>
            <Pressable style={[styles.roleOption, isCompact && styles.stackedAction, registrationRole === 'party' && styles.optionActive]} onPress={() => setRegistrationRole('party')}>
              <Text style={[styles.optionText, registrationRole === 'party' && styles.optionTextActive]}>Parte interesada</Text>
            </Pressable>
            <Pressable style={[styles.roleOption, isCompact && styles.stackedAction, registrationRole === 'witness' && styles.optionActive]} onPress={() => setRegistrationRole('witness')}>
              <Text style={[styles.optionText, registrationRole === 'witness' && styles.optionTextActive]}>Testigo</Text>
            </Pressable>
          </View>
        </> : null}
        <TextInput
          ref={emailInput}
          style={styles.input}
          placeholder="Correo electrónico"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="email"
          textContentType="emailAddress"
          keyboardType="email-address"
          returnKeyType="next"
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={() => passwordInput.current?.focus()}
        />
        <TextInput
          ref={passwordInput}
          style={styles.input}
          placeholder="Contraseña"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
          textContentType={authMode === 'login' ? 'password' : 'newPassword'}
          secureTextEntry
          returnKeyType={authMode === 'login' ? 'go' : 'next'}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={authMode === 'login' ? signIn : () => passwordConfirmationInput.current?.focus()}
        />
        {authMode === 'register' ? <TextInput
          ref={passwordConfirmationInput}
          style={styles.input}
          placeholder="Confirmar contraseña"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="new-password"
          textContentType="newPassword"
          secureTextEntry
          returnKeyType="go"
          value={passwordConfirmation}
          onChangeText={setPasswordConfirmation}
          onSubmitEditing={registerAccount}
        /> : null}
        <Pressable style={[styles.primaryButton, busy && styles.disabled]} onPress={authMode === 'login' ? signIn : registerAccount} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{authMode === 'login' ? 'Iniciar sesión' : 'Crear mi cuenta'}</Text>}
        </Pressable>
        <Text style={styles.loginHint}>Los perfiles profesionales y técnicos ingresan desde la plataforma web.</Text>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>;
  }

  return <SafeAreaView edges={['top', 'right', 'left']} style={styles.authenticatedSafe}>
    <StatusBar style="light" />
    <View style={[styles.header, { paddingHorizontal: horizontalPadding }, isCompact && styles.headerCompact]}>
      <View style={styles.headerIdentity}>
        <Text style={styles.headerEyebrow}>EXPEDIENTE ÍNTEGRO</Text>
        <Text style={[styles.headerTitle, isCompact && styles.headerTitleCompact]}>{copy.heading}</Text>
        <Text style={styles.headerSub}>{profile.fullName} · {copy.label}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Abrir mi perfil" style={styles.headerProfileButton} onPress={() => navigateRoot('profile')}>
        <Text style={styles.headerProfileText}>{initials(profile.fullName)}</Text>
      </Pressable>
    </View>
    <KeyboardAvoidingView
      style={styles.keyboardRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingHorizontal: horizontalPadding }, isTablet && styles.contentTablet]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      {busy ? <ActivityIndicator color={theme.colors.teal} style={styles.loader} /> : null}

      {screen === 'home' && <>
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeEyebrow}>ESPACIO PERSONAL</Text>
          <Text style={styles.welcomeTitle}>Hola, {profile.fullName?.split(' ')[0] || 'usuario'}</Text>
          <Text style={styles.welcomeText}>{copy.summary}</Text>
          <View style={[styles.welcomeActions, isCompact && styles.stackedActions]}>
            <Pressable style={[styles.welcomePrimaryAction, isCompact && styles.stackedAction]} onPress={() => navigateRoot('cases')}>
              <Text style={styles.welcomePrimaryText}>Ver {roleCode === 'witness' ? 'participaciones' : 'expedientes'}</Text>
            </Pressable>
            <Pressable style={[styles.welcomeSecondaryAction, isCompact && styles.stackedAction]} onPress={() => loadCases()} disabled={busy}>
              <Text style={styles.welcomeSecondaryText}>Actualizar</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.metricGrid}>
          <MetricTile value={activeCases.length} label="Activos" detail={roleCode === 'witness' ? 'Participaciones' : 'Expedientes'} />
          <MetricTile value={cases.reduce((total, item) => total + Number(item.own_document_count || 0), 0)} label="Documentos" detail="Registrados a tu nombre" />
        </View>

        <Pressable style={[styles.attentionSummary, pendingTotal === 0 && styles.attentionSummaryClear]} onPress={() => navigateRoot('pending')}>
          <View style={[styles.attentionMark, pendingTotal === 0 && styles.attentionMarkClear]}>
            <Text style={styles.attentionMarkText}>{pendingTotal}</Text>
          </View>
          <View style={styles.attentionCopy}>
            <Text style={styles.attentionTitle}>{pendingTotal ? 'Tienes acciones pendientes' : 'Todo está al día'}</Text>
            <Text style={styles.attentionText}>{pendingTotal ? `${invitations.length} invitaciones y ${pendingObservationCount} observaciones por revisar.` : 'No hay invitaciones ni observaciones que requieran tu atención.'}</Text>
          </View>
          <Text style={styles.attentionOpen}>Ver</Text>
        </Pressable>

        {cases.length ? <>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Actividad reciente</Text>
            <Pressable onPress={() => navigateRoot('cases')}><Text style={styles.linkInline}>Ver todos</Text></Pressable>
          </View>
          {cases.slice(0, 2).map((item) => <CaseCard key={item.id} item={item} onPress={() => openCase(item)} />)}
        </> : <View style={styles.onboardingCard}>
          <Text style={styles.onboardingTitle}>Tu cuenta está lista</Text>
          <Text style={styles.onboardingText}>El contenido aparecerá únicamente cuando una persona responsable te invite a un expediente.</Text>
          <OnboardingStep number="01" title="Recibe una invitación" detail="La solicitud aparecerá en tu bandeja de pendientes." />
          <OnboardingStep number="02" title="Acepta tu participación" detail="El expediente quedará vinculado a tu cuenta." />
          <OnboardingStep number="03" title="Consulta lo solicitado" detail="Sólo verás información y documentos personales." />
          <OnboardingStep number="04" title="Aporta tus archivos" detail="Selecciona un archivo o captura un documento con la cámara." />
        </View>}
      </>}

      {screen === 'cases' && <>
        <View style={styles.screenHeading}>
          <Text style={styles.screenEyebrow}>{roleCode === 'witness' ? 'PARTICIPACIÓN PERSONAL' : 'CONSULTA PERSONAL'}</Text>
          <Text style={styles.screenTitle}>{copy.casesTitle}</Text>
          <Text style={styles.screenDescription}>{copy.casesDescription}</Text>
        </View>
        <TextInput
          style={[styles.input, styles.searchInput]}
          value={caseSearch}
          onChangeText={setCaseSearch}
          placeholder="Buscar por folio, título, materia o tipo"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="search"
        />
        <View style={styles.filterRow}>
          <FilterChip label="Todos" active={caseFilter === 'all'} onPress={() => setCaseFilter('all')} />
          <FilterChip label="Activos" active={caseFilter === 'active'} onPress={() => setCaseFilter('active')} />
          <FilterChip label="Con pendientes" active={caseFilter === 'attention'} onPress={() => setCaseFilter('attention')} />
        </View>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Resultados</Text>
          <Pressable onPress={() => loadCases()}><Text style={styles.link}>Actualizar</Text></Pressable>
        </View>
        {filteredCases.map((item) => <CaseCard key={item.id} item={item} onPress={() => openCase(item)} />)}
        {!filteredCases.length && !busy ? <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{cases.length ? 'No hay coincidencias' : roleCode === 'witness' ? 'Aún no tienes participaciones' : 'Aún no tienes expedientes'}</Text>
          <Text style={styles.empty}>{cases.length ? 'Cambia los filtros o escribe otra búsqueda.' : 'Cuando recibas y aceptes una invitación, el asunto aparecerá en este apartado.'}</Text>
        </View> : null}
      </>}

      {screen === 'pending' && <>
        <View style={styles.screenHeading}>
          <Text style={styles.screenEyebrow}>BANDEJA PERSONAL</Text>
          <Text style={styles.screenTitle}>Pendientes</Text>
          <Text style={styles.screenDescription}>{copy.pendingDescription}</Text>
        </View>
        <View style={styles.pendingMetricRow}>
          <MetricTile value={invitations.length} label="Invitaciones" detail="Por responder" />
          <MetricTile value={pendingObservationCount} label="Observaciones" detail="En tus documentos" />
        </View>

        {invitations.length ? <>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Invitaciones</Text>
            <Text style={styles.invitationCount}>{invitations.length}</Text>
          </View>
          {invitations.map((invitation) => <InvitationCard
            key={invitation.id}
            invitation={invitation}
            compact={isCompact}
            busy={busy}
            onAccept={() => respondToInvitation(invitation.id, 'accept')}
            onDecline={() => confirmDecline(invitation.id)}
          />)}
        </> : null}

        {pendingCases.length ? <>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Documentos observados</Text>
            <Text style={styles.invitationCount}>{pendingObservationCount}</Text>
          </View>
          <Text style={styles.sectionHelp}>Abre el expediente para identificar el documento y responder la observación correspondiente.</Text>
          {pendingCases.map((item) => <CaseCard key={item.id} item={item} actionLabel="Revisar documentos" onPress={() => openCase(item)} />)}
        </> : null}

        {!pendingTotal && !busy ? <View style={styles.emptyCardComplete}>
          <View style={styles.completeMark}><Text style={styles.completeMarkText}>OK</Text></View>
          <Text style={styles.emptyTitle}>No tienes acciones pendientes</Text>
          <Text style={styles.empty}>Las invitaciones y observaciones nuevas aparecerán aquí sin mostrar información de otras personas.</Text>
        </View> : null}
      </>}

      {screen === 'profile' && <>
        <View style={styles.profileCard}>
          <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{initials(profile.fullName)}</Text></View>
          <Text style={styles.profileName}>{profile.fullName}</Text>
          <Text selectable style={styles.profileEmail}>{profile.email}</Text>
          <View style={styles.profileRole}><Text style={styles.profileRoleText}>{copy.label}</Text></View>
        </View>

        <View style={styles.securityCard}>
          <Text style={styles.screenEyebrow}>SEGURIDAD DE LA CUENTA</Text>
          <Text style={styles.securityTitle}>Sesión móvil protegida</Text>
          <SecurityFact number="01" title="Acceso personal" detail="Sólo puedes consultar expedientes aceptados y documentos registrados a tu nombre." />
          <SecurityFact number="02" title="Token protegido" detail="La sesión se conserva en el almacenamiento seguro del dispositivo." />
          <SecurityFact number="03" title="Sin descargas" detail="La aplicación no entrega copias de los archivos originales." />
          <SecurityFact number="04" title="Historial permanente" detail="Cada archivo nuevo crea una versión y nunca sobrescribe la anterior." />
        </View>

        <View style={styles.permissionsCard}>
          <Text style={styles.formTitle}>Funciones habilitadas</Text>
          <Text style={styles.formHelp}>Estas capacidades dependen de tu rol y el sistema comprueba su alcance en cada operación.</Text>
          <View style={styles.permissionList}>
            {(profile.permissions || []).map((permission) => <View key={permission} style={styles.permissionItem}>
              <Text style={styles.permissionItemText}>{MOBILE_PERMISSION_COPY[permission] || 'Función móvil autorizada'}</Text>
            </View>)}
          </View>
        </View>

        <View style={styles.profileEditCard}>
          <View style={styles.profileEditHeading}>
            <View style={styles.profileEditHeadingCopy}>
              <Text style={styles.formTitle}>Datos de mi perfil</Text>
              <Text style={styles.formHelp}>Puedes modificar únicamente el nombre que se muestra dentro del sistema.</Text>
            </View>
            <Ionicons name="create-outline" size={22} color={theme.colors.tealDark} />
          </View>
          <Pressable style={styles.profileEditButton} onPress={toggleProfileForm}>
            <Ionicons name={showProfileForm ? 'close-outline' : 'create-outline'} size={18} color={theme.colors.tealDark} />
            <Text style={styles.profileEditButtonText}>{showProfileForm ? 'Cancelar edición' : 'Editar mis datos'}</Text>
          </Pressable>
          {showProfileForm ? <View style={styles.profileEditForm}>
            <Text style={styles.label}>Nombre visible</Text>
            <TextInput
              style={styles.input}
              value={profileName}
              onChangeText={setProfileName}
              placeholder="Nombre completo"
              autoCapitalize="words"
              autoCorrect={false}
              autoComplete="name"
              textContentType="name"
              returnKeyType="done"
              onSubmitEditing={saveProfile}
              maxLength={160}
            />
            <Pressable style={[styles.primaryButton, busy && styles.disabled]} onPress={saveProfile} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <View style={styles.buttonContentRow}>
                <Ionicons name="save-outline" size={18} color="#fff" />
                <Text style={styles.primaryButtonText}>Guardar cambios</Text>
              </View>}
            </Pressable>
          </View> : null}
          <View style={styles.lockedDataNotice}>
            <Ionicons name="lock-closed-outline" size={20} color={theme.colors.warningText} />
            <View style={styles.lockedDataCopy}>
              <Text style={styles.lockedDataTitle}>Datos protegidos</Text>
              <Text style={styles.lockedDataText}>El correo electrónico, el tipo de cuenta, los permisos y el estado no pueden modificarse desde aquí. Para solicitar un cambio, contacta a soporte.</Text>
              <Pressable accessibilityRole="link" onPress={contactSupport}>
                <Text selectable style={styles.supportEmail}>{SUPPORT_EMAIL}</Text>
              </Pressable>
            </View>
          </View>
        </View>
        <Pressable style={styles.signOutButton} onPress={() => signOut()}>
          <Text style={styles.signOutButtonText}>Cerrar sesión</Text>
        </Pressable>
      </>}

      {screen === 'documents' && <>
        <Pressable onPress={() => setScreen(caseReturnScreen)}><Text style={styles.back}>‹ Volver</Text></Pressable>
        <Text style={styles.sectionTitle}>{selectedCase?.folio}</Text>
        <Text style={styles.sectionSub}>{selectedCase?.title}</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Documentos personales</Text>
          <Text style={styles.infoText}>Sólo se muestran los documentos registrados a tu nombre.</Text>
        </View>
        {canUpload && selectedCase?.status === 'active' ? <Pressable style={styles.primaryButton} onPress={() => setShowDocumentForm((current) => !current)}>
          <Text style={styles.primaryButtonText}>{showDocumentForm ? 'Cerrar formulario' : 'Agregar documento'}</Text>
        </Pressable> : null}
        {showDocumentForm ? <View style={styles.formCard}>
          <Text style={styles.formTitle}>Nuevo documento</Text>
          <Text style={styles.label}>Tipo documental</Text>
          <View style={styles.optionList}>
            {documentTypes.map((type) => <Pressable key={type.code} style={[styles.option, documentTypeCode === type.code && styles.optionActive]} onPress={() => setDocumentTypeCode(type.code)}>
              <Text style={[styles.optionText, documentTypeCode === type.code && styles.optionTextActive]}>{type.label}</Text>
            </Pressable>)}
          </View>
          <Text style={styles.label}>Título</Text>
          <TextInput
            style={styles.input}
            value={documentTitle}
            onChangeText={setDocumentTitle}
            placeholder="Ej. Identificación oficial vigente"
            autoCapitalize="sentences"
            autoCorrect
            spellCheck
            returnKeyType="done"
            maxLength={255}
          />
          <Text style={styles.label}>Descripción opcional</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={documentDescription}
            onChangeText={setDocumentDescription}
            placeholder="Información adicional"
            autoCapitalize="sentences"
            autoCorrect
            spellCheck
            multiline
            blurOnSubmit={false}
            maxLength={4000}
          />
          <FileButtons compact={isCompact} onFile={() => chooseFile(setDocumentFile)} onCamera={() => takePhoto(setDocumentFile)} />
          {documentFile ? <SelectedFile file={documentFile} /> : null}
          <Pressable style={[styles.primaryButton, busy && styles.disabled]} onPress={submitDocument} disabled={busy}><Text style={styles.primaryButtonText}>Registrar documento</Text></Pressable>
        </View> : null}
        <View style={styles.listSpacing} />
        {documents.map((item) => <Pressable key={item.id} style={styles.card} onPress={() => openDocument(item)}>
          <View style={styles.rowBetween}>
            <Text style={styles.folio}>{item.document_type_label}</Text>
            {Number(item.pending_observation_count || 0) > 0 ? <Text style={styles.pendingBadge}>{item.pending_observation_count} pendientes</Text> : null}
          </View>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardMeta}>{item.contains_sensitive_data ? 'Datos sensibles protegidos' : 'Documento registrado'} · {item.version_count} versiones</Text>
          <Text style={styles.open}>Consultar historial y observaciones ›</Text>
        </Pressable>)}
        {!documents.length && !busy ? <Text style={styles.empty}>Todavía no tienes documentos registrados en este expediente.</Text> : null}
      </>}

      {screen === 'versions' && <>
        <Pressable onPress={() => setScreen('documents')}><Text style={styles.back}>‹ Volver a mis documentos</Text></Pressable>
        <Text style={styles.sectionTitle}>{selectedDocument?.title}</Text>
        <Text style={styles.sectionSub}>{selectedDocument?.document_type_label} · Historial inmutable</Text>
        <View style={styles.blockedCard}>
          <Text style={styles.blockedTitle}>Contenido original protegido</Text>
          <Text style={styles.blockedText}>La aplicación móvil muestra metadatos, estados y observaciones, pero no entrega descargas del archivo original.</Text>
        </View>
        {selectedDocument?.lifecycle_status === 'active' ? <Pressable style={styles.secondaryButton} onPress={() => setShowVersionForm((current) => !current)}>
          <Text style={styles.secondaryButtonText}>{showVersionForm ? 'Cerrar formulario' : 'Agregar nueva versión'}</Text>
        </Pressable> : null}
        {showVersionForm ? <View style={styles.formCard}>
          <Text style={styles.formTitle}>Nueva versión</Text>
          <Text style={styles.formHelp}>La versión existente se conservará sin modificaciones.</Text>
          <FileButtons compact={isCompact} onFile={() => chooseFile(setVersionFile)} onCamera={() => takePhoto(setVersionFile)} />
          {versionFile ? <SelectedFile file={versionFile} /> : null}
          <Pressable style={[styles.primaryButton, busy && styles.disabled]} onPress={submitVersion} disabled={busy}><Text style={styles.primaryButtonText}>Registrar versión</Text></Pressable>
        </View> : null}
        <Text style={styles.groupTitle}>Versiones</Text>
        {versions.map((version) => <View key={version.id} style={styles.versionCard}>
          <View style={styles.rowBetween}><Text style={styles.versionTitle}>Versión {version.version_number}</Text><Text style={styles.sourceTag}>{version.upload_source === 'mobile_camera' ? 'Cámara' : version.client_channel === 'mobile' ? 'Archivo móvil' : 'Web'}</Text></View>
          <Text style={styles.versionFile}>{version.original_name}</Text>
          <Text style={styles.versionMeta}>{formatBytes(version.size_bytes)} · {formatDate(version.created_at)}</Text>
          <Text style={styles.versionMeta}>Firma: {version.platform_signature_status === 'not_required' ? 'No requerida' : STATUS_COPY[version.platform_signature_status] ?? version.platform_signature_status}</Text>
          <Text selectable numberOfLines={2} style={styles.hash}>SHA-256: {version.sha256 || 'Pendiente'}</Text>
        </View>)}
        {!versions.length && !busy ? <Text style={styles.empty}>No hay versiones disponibles.</Text> : null}
        <Text style={styles.groupTitle}>Observaciones</Text>
        {observations.map((observation) => <View key={observation.id} style={styles.observationCard}>
          <View style={styles.rowBetween}><Text style={styles.observationTitle}>Versión {observation.version_number}</Text><Text style={[styles.status, statusTone(observation.observation_status)]}>{STATUS_COPY[observation.observation_status] ?? observation.observation_status}</Text></View>
          <Text style={styles.observationMeta}>{observation.author_name} · {formatDate(observation.created_at)}</Text>
          <Text style={styles.observationBody}>{observation.body}</Text>
          {observation.responses?.map((item) => <View key={item.id} style={styles.responseCard}><Text style={styles.responseAuthor}>{item.responder_name}</Text><Text style={styles.observationBody}>{item.body}</Text></View>)}
          {['open', 'responded'].includes(observation.observation_status) ? <Pressable onPress={() => { setResponseObservationId(observation.id); setResponseText(''); }}><Text style={styles.link}>Responder observación</Text></Pressable> : null}
          {responseObservationId === observation.id ? <View style={styles.responseForm}>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={responseText}
              onChangeText={setResponseText}
              placeholder="Escribe tu respuesta"
              autoCapitalize="sentences"
              autoCorrect
              spellCheck
              multiline
              blurOnSubmit={false}
              maxLength={3000}
            />
            <Pressable style={styles.primaryButton} onPress={() => submitObservationResponse(observation.id)}><Text style={styles.primaryButtonText}>Enviar respuesta</Text></Pressable>
          </View> : null}
        </View>)}
        {!observations.length && !busy ? <Text style={styles.empty}>Este documento no tiene observaciones.</Text> : null}
      </>}
    </ScrollView>
    </KeyboardAvoidingView>
    {!keyboardVisible ? <BottomNavigation
      activeScreen={rootScreen}
      roleCode={roleCode}
      pendingCount={pendingTotal}
      bottomInset={insets.bottom}
      onNavigate={navigateRoot}
    /> : null}
  </SafeAreaView>;
}

function MetricTile({ value, label, detail }) {
  return <View style={styles.metricTile}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={styles.metricDetail}>{detail}</Text>
  </View>;
}

function OnboardingStep({ number, title, detail }) {
  return <View style={styles.onboardingStep}>
    <Text style={styles.onboardingNumber}>{number}</Text>
    <View style={styles.onboardingStepCopy}>
      <Text style={styles.onboardingStepTitle}>{title}</Text>
      <Text style={styles.onboardingStepText}>{detail}</Text>
    </View>
  </View>;
}

function FilterChip({ active, label, onPress }) {
  return <Pressable style={[styles.filterChip, active && styles.filterChipActive]} onPress={onPress}>
    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
  </Pressable>;
}

function statusTone(status) {
  if (status === 'active') return styles.statusSuccess;
  if (['paused', 'pending', 'open', 'responded'].includes(status)) return styles.statusWarning;
  if (['annulled', 'rejected', 'invalid'].includes(status)) return styles.statusDanger;
  return styles.statusNeutral;
}

function CaseCard({ item, onPress, actionLabel = 'Abrir' }) {
  const pendingCount = Number(item.pending_observation_count || 0);
  return <Pressable accessibilityRole="button" style={[styles.card, pendingCount > 0 && styles.attentionCaseCard]} onPress={onPress}>
    <View style={styles.rowBetween}>
      <Text style={styles.folio}>{item.folio}</Text>
      <Text style={[styles.status, statusTone(item.status)]}>{STATUS_COPY[item.status] ?? item.status}</Text>
    </View>
    <Text style={styles.cardTitle}>{item.title}</Text>
    <Text style={styles.cardMeta}>{item.case_type_label} · {item.current_stage_label || 'Sin etapa'}</Text>
    {pendingCount > 0 ? <Text style={styles.cardPending}>{pendingCount} {pendingCount === 1 ? 'observación pendiente' : 'observaciones pendientes'}</Text> : null}
    <View style={styles.cardFooter}>
      <Text style={styles.cardMeta}>{item.own_document_count} documentos propios</Text>
      <Text style={styles.open}>{actionLabel}</Text>
    </View>
  </Pressable>;
}

function InvitationCard({ invitation, compact, busy, onAccept, onDecline }) {
  return <View style={styles.invitationCard}>
    <Text style={styles.folio}>{invitation.folio}</Text>
    <Text style={styles.cardTitle}>{invitation.case_title}</Text>
    <Text style={styles.cardMeta}>{invitation.legal_area_label} · {invitation.case_type_label}</Text>
    <Text style={styles.invitationRole}>Participación propuesta: {invitation.participant_role_label}</Text>
    <Text style={styles.cardMeta}>Invita: {invitation.invited_by_name}</Text>
    <Text style={styles.cardMeta}>Vence: {formatDate(invitation.expires_at)}</Text>
    <Text style={styles.invitationReason}>{invitation.invitation_reason}</Text>
    <View style={[styles.invitationActions, compact && styles.stackedActions]}>
      <Pressable style={[styles.acceptButton, compact && styles.stackedAction]} onPress={onAccept} disabled={busy}><Text style={styles.primaryButtonText}>Aceptar</Text></Pressable>
      <Pressable style={[styles.declineButton, compact && styles.stackedAction]} onPress={onDecline} disabled={busy}><Text style={styles.declineButtonText}>Rechazar</Text></Pressable>
    </View>
  </View>;
}

function SecurityFact({ number, title, detail }) {
  return <View style={styles.securityFact}>
    <Text style={styles.securityFactNumber}>{number}</Text>
    <View style={styles.securityFactCopy}>
      <Text style={styles.securityFactTitle}>{title}</Text>
      <Text style={styles.securityFactText}>{detail}</Text>
    </View>
  </View>;
}

function BottomNavigation({ activeScreen, roleCode, pendingCount, bottomInset, onNavigate }) {
  const items = [
    { code: 'home', icon: 'home-outline', activeIcon: 'home', label: 'Inicio' },
    { code: 'cases', icon: 'folder-open-outline', activeIcon: 'folder-open', label: roleCode === 'witness' ? 'Casos' : 'Expedientes' },
    { code: 'pending', icon: 'notifications-outline', activeIcon: 'notifications', label: 'Pendientes', badge: pendingCount },
    { code: 'profile', icon: 'person-circle-outline', activeIcon: 'person-circle', label: 'Perfil' }
  ];
  return <View style={[styles.bottomNavigation, { paddingBottom: Math.max(bottomInset, 8) }]}>
    <View style={styles.bottomNavigationInner}>
      {items.map((item) => {
        const active = activeScreen === item.code;
        return <Pressable
          key={item.code}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          style={styles.bottomNavigationItem}
          onPress={() => onNavigate(item.code)}
        >
          <View style={[styles.bottomNavigationMark, active && styles.bottomNavigationMarkActive]}>
            <Ionicons
              aria-hidden
              name={active ? item.activeIcon : item.icon}
              size={22}
              color={active ? theme.colors.tealDark : theme.colors.muted}
            />
            {item.badge ? <View style={styles.navigationBadge}><Text style={styles.navigationBadgeText}>{Math.min(item.badge, 99)}</Text></View> : null}
          </View>
          <Text numberOfLines={1} style={[styles.bottomNavigationLabel, active && styles.bottomNavigationLabelActive]}>{item.label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

function FileButtons({ compact, onFile, onCamera }) {
  return <View style={[styles.fileActions, compact && styles.stackedActions]}>
    <Pressable style={[styles.fileButton, compact && styles.stackedAction]} onPress={onFile}><Text style={styles.fileButtonText}>Seleccionar archivo</Text></Pressable>
    <Pressable style={[styles.fileButton, compact && styles.stackedAction]} onPress={onCamera}><Text style={styles.fileButtonText}>Usar cámara</Text></Pressable>
  </View>;
}

function SelectedFile({ file }) {
  return <View style={styles.selectedFile}>
    <Text style={styles.selectedFileName}>{file.name}</Text>
    <Text style={styles.cardMeta}>{file.uploadSource === 'mobile_camera' ? 'Capturado con cámara' : 'Seleccionado del dispositivo'}{file.size ? ` · ${formatBytes(file.size)}` : ''}</Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  authenticatedSafe: { flex: 1, backgroundColor: theme.colors.navy },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background },
  keyboardRoot: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { flex: 1 },
  loginSafe: { flex: 1, backgroundColor: theme.colors.background },
  login: { flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 600, alignSelf: 'center', paddingVertical: 28, gap: 13, backgroundColor: theme.colors.background },
  loginTablet: { paddingVertical: 42 },
  brandMark: { width: 58, height: 58, borderRadius: 18, backgroundColor: theme.colors.navy, alignItems: 'center', justifyContent: 'center' },
  brandInitials: { color: '#fff', fontSize: 22, fontWeight: '900' },
  loginBadge: { alignSelf: 'flex-start', backgroundColor: theme.colors.tealSoft, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  loginBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: theme.colors.teal },
  title: { fontSize: 30, fontWeight: '800', color: theme.colors.navyText },
  titleCompact: { fontSize: 27 },
  subtitle: { fontSize: 16, lineHeight: 23, color: '#526274' },
  securityList: { backgroundColor: '#e8eff6', borderRadius: 12, padding: 14, gap: 5 },
  securityItem: { color: '#334155', lineHeight: 20 },
  authTabs: { flexDirection: 'row', backgroundColor: '#e8eff6', borderRadius: 11, padding: 4, gap: 4 },
  authTab: { flex: 1, alignItems: 'center', borderRadius: 8, padding: 10 },
  authTabActive: { backgroundColor: '#fff' },
  authTabText: { color: theme.colors.muted, fontWeight: '800' },
  authTabTextActive: { color: theme.colors.tealDark },
  roleOptions: { flexDirection: 'row', gap: 8 },
  stackedActions: { flexDirection: 'column' },
  stackedAction: { flex: 0, width: '100%' },
  roleOption: { flex: 1, borderWidth: 1, borderColor: '#bdcad8', borderRadius: 9, padding: 11, alignItems: 'center', backgroundColor: '#fff' },
  input: { minHeight: 50, backgroundColor: '#fff', borderWidth: 1, borderColor: '#bdcad8', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 12, fontSize: 16, color: theme.colors.navyText },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  primaryButton: { minHeight: 48, backgroundColor: theme.colors.teal, borderRadius: 10, padding: 14, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  secondaryButton: { borderWidth: 1, borderColor: theme.colors.teal, borderRadius: 10, padding: 13, alignItems: 'center', marginBottom: 10 },
  secondaryButtonText: { color: theme.colors.teal, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  loginHint: { color: theme.colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  notice: { backgroundColor: '#fef3c7', color: theme.colors.warningText, padding: 12, borderRadius: 9, lineHeight: 20 },
  header: { backgroundColor: theme.colors.navy, paddingVertical: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerCompact: { paddingVertical: 15 },
  headerIdentity: { flex: 1, paddingRight: 10 },
  headerEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: '#8eddd0' },
  headerTitle: { fontSize: 23, fontWeight: '800', color: '#fff', marginTop: 2 },
  headerTitleCompact: { fontSize: 20 },
  headerSub: { color: '#d5e4ef', marginTop: 3 },
  headerProfileButton: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#8eddd0', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  headerProfileText: { color: theme.colors.navy, fontWeight: '900', fontSize: 14 },
  content: { width: '100%', maxWidth: 960, alignSelf: 'center', paddingVertical: 18, paddingBottom: 48 },
  contentTablet: { paddingVertical: 28, paddingBottom: 64 },
  loader: { marginBottom: 12 },
  welcomeCard: { padding: 22, backgroundColor: theme.colors.navy, borderRadius: 17, marginBottom: 13, shadowColor: theme.colors.navyText, shadowOpacity: 0.1, shadowRadius: 14, elevation: 2 },
  welcomeEyebrow: { color: '#8eddd0', fontWeight: '900', fontSize: 10, letterSpacing: 1.1 },
  welcomeTitle: { color: '#fff', fontWeight: '900', fontSize: 27, marginTop: 7 },
  welcomeText: { color: '#d5e4ef', lineHeight: 21, marginTop: 7 },
  welcomeActions: { flexDirection: 'row', gap: 9, marginTop: 18 },
  welcomePrimaryAction: { flex: 1, minHeight: 46, paddingHorizontal: 13, backgroundColor: '#8eddd0', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  welcomePrimaryText: { color: theme.colors.navy, fontWeight: '900', textAlign: 'center' },
  welcomeSecondaryAction: { minWidth: 100, minHeight: 46, paddingHorizontal: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  welcomeSecondaryText: { color: '#fff', fontWeight: '800' },
  metricGrid: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  pendingMetricRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  metricTile: { flex: 1, minWidth: 0, padding: 15, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 13, shadowColor: theme.colors.navyText, shadowOpacity: 0.04, shadowRadius: 9, elevation: 1 },
  metricValue: { color: theme.colors.navyText, fontWeight: '900', fontSize: 25 },
  metricLabel: { color: theme.colors.navyText, fontWeight: '800', marginTop: 5 },
  metricDetail: { color: theme.colors.muted, fontSize: 11, marginTop: 2 },
  attentionSummary: { padding: 14, backgroundColor: theme.colors.warningBackground, borderWidth: 1, borderColor: '#efd39a', borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 22 },
  attentionSummaryClear: { backgroundColor: theme.colors.successBackground, borderColor: '#a7dfb5' },
  attentionMark: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#d99a18', alignItems: 'center', justifyContent: 'center' },
  attentionMarkClear: { backgroundColor: theme.colors.teal },
  attentionMarkText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  attentionCopy: { flex: 1 },
  attentionTitle: { color: theme.colors.navyText, fontWeight: '900' },
  attentionText: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  attentionOpen: { color: theme.colors.tealDark, fontWeight: '900', fontSize: 12 },
  linkInline: { color: theme.colors.teal, fontWeight: '800' },
  onboardingCard: { padding: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14 },
  onboardingTitle: { color: theme.colors.navyText, fontSize: 19, fontWeight: '900' },
  onboardingText: { color: theme.colors.muted, lineHeight: 20, marginTop: 5, marginBottom: 10 },
  onboardingStep: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.colors.border, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  onboardingNumber: { color: theme.colors.teal, fontWeight: '900', fontSize: 11, marginTop: 2 },
  onboardingStepCopy: { flex: 1 },
  onboardingStepTitle: { color: theme.colors.navyText, fontWeight: '800' },
  onboardingStepText: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  screenHeading: { marginBottom: 17 },
  screenEyebrow: { color: theme.colors.teal, fontWeight: '900', fontSize: 10, letterSpacing: 1.05 },
  screenTitle: { color: theme.colors.navyText, fontSize: 27, fontWeight: '900', marginTop: 4 },
  screenDescription: { color: theme.colors.muted, lineHeight: 21, marginTop: 5 },
  searchInput: { marginBottom: 10 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 18 },
  filterChip: { minHeight: 39, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 99, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  filterChipActive: { borderColor: theme.colors.teal, backgroundColor: theme.colors.tealSoft },
  filterChipText: { color: theme.colors.muted, fontSize: 12, fontWeight: '800' },
  filterChipTextActive: { color: theme.colors.tealDark },
  sectionHelp: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, marginTop: -3, marginBottom: 11 },
  infoCard: { backgroundColor: '#e1f3f0', borderLeftWidth: 4, borderLeftColor: theme.colors.teal, borderRadius: 10, padding: 15, marginBottom: 20 },
  infoCardCompact: { backgroundColor: '#e1f3f0', borderLeftWidth: 4, borderLeftColor: theme.colors.teal, borderRadius: 10, padding: 15 },
  infoTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.tealDark, marginBottom: 4 },
  infoText: { color: '#245c58', lineHeight: 20 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.navyText },
  invitationCount: { backgroundColor: theme.colors.tealSoft, color: theme.colors.tealDark, fontWeight: '900', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
  sectionSub: { color: theme.colors.muted, marginTop: 3, marginBottom: 14 },
  groupTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.navyText, marginTop: 22, marginBottom: 9 },
  link: { color: theme.colors.teal, fontWeight: '800', marginTop: 9 },
  card: { backgroundColor: '#fff', borderColor: theme.colors.border, borderWidth: 1, borderRadius: 13, padding: 15, marginBottom: 11, shadowColor: theme.colors.navyText, shadowOpacity: 0.04, shadowRadius: 10, elevation: 1 },
  invitationCard: { backgroundColor: '#fff', borderColor: theme.colors.teal, borderWidth: 1, borderRadius: 13, padding: 15, marginBottom: 14 },
  invitationRole: { color: theme.colors.tealDark, fontWeight: '800', marginTop: 10 },
  invitationReason: { color: '#334155', lineHeight: 20, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.border },
  invitationActions: { flexDirection: 'row', gap: 9, marginTop: 13 },
  acceptButton: { flex: 1, minHeight: 46, backgroundColor: theme.colors.teal, borderRadius: 9, padding: 12, alignItems: 'center', justifyContent: 'center' },
  declineButton: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: '#b42318', borderRadius: 9, padding: 12, alignItems: 'center', justifyContent: 'center' },
  declineButtonText: { color: '#b42318', fontWeight: '800' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  folio: { flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', color: theme.colors.teal, marginBottom: 4 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.navyText },
  cardMeta: { fontSize: 13, color: theme.colors.muted, marginTop: 6 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  status: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, overflow: 'hidden' },
  statusSuccess: { backgroundColor: theme.colors.successBackground, color: theme.colors.successText },
  statusWarning: { backgroundColor: theme.colors.warningBackground, color: theme.colors.warningText },
  statusDanger: { backgroundColor: theme.colors.dangerBackground, color: theme.colors.dangerText },
  statusNeutral: { backgroundColor: '#e8eff6', color: '#475569' },
  attentionCaseCard: { borderLeftWidth: 4, borderLeftColor: '#d99a18' },
  cardPending: { color: theme.colors.warningText, fontSize: 12, fontWeight: '800', marginTop: 9 },
  pendingBadge: { backgroundColor: theme.colors.warningBackground, color: theme.colors.warningText, fontSize: 10, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, overflow: 'hidden' },
  open: { color: theme.colors.teal, fontWeight: '700', fontSize: 13, marginTop: 10 },
  empty: { color: theme.colors.muted, textAlign: 'center', paddingVertical: 26, lineHeight: 21 },
  emptyCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 13, paddingHorizontal: 18, paddingTop: 18, marginBottom: 12 },
  emptyTitle: { color: theme.colors.navyText, fontWeight: '800', fontSize: 17, textAlign: 'center' },
  emptyCardComplete: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, padding: 22, alignItems: 'center' },
  completeMark: { width: 50, height: 50, borderRadius: 17, backgroundColor: theme.colors.tealSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  completeMarkText: { color: theme.colors.tealDark, fontWeight: '900' },
  back: { color: theme.colors.teal, fontWeight: '800', marginBottom: 15 },
  blockedCard: { backgroundColor: theme.colors.warningBackground, borderRadius: 11, padding: 15, marginBottom: 14 },
  blockedTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.warningText, marginBottom: 4 },
  blockedText: { color: '#9a5b16', lineHeight: 20 },
  formCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 13, padding: 15, marginTop: 12, marginBottom: 15 },
  formTitle: { fontSize: 18, fontWeight: '800', color: theme.colors.navyText, marginBottom: 4 },
  formHelp: { color: theme.colors.muted, lineHeight: 19, marginBottom: 12 },
  label: { color: theme.colors.navyText, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  optionList: { gap: 7 },
  option: { borderWidth: 1, borderColor: '#bdcad8', borderRadius: 9, padding: 11, backgroundColor: '#fff' },
  optionActive: { borderColor: theme.colors.teal, backgroundColor: theme.colors.tealSoft },
  optionText: { color: '#334155', fontWeight: '700' },
  optionTextActive: { color: theme.colors.tealDark },
  fileActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  fileButton: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: theme.colors.teal, padding: 11, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  fileButtonText: { color: theme.colors.teal, fontWeight: '800', textAlign: 'center' },
  selectedFile: { backgroundColor: '#eef5f8', padding: 11, borderRadius: 9, marginTop: 10 },
  selectedFileName: { color: theme.colors.navyText, fontWeight: '800' },
  listSpacing: { height: 14 },
  versionCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  versionTitle: { fontWeight: '800', color: theme.colors.navyText, fontSize: 16 },
  versionFile: { color: '#334155', marginTop: 5 },
  versionMeta: { color: theme.colors.muted, fontSize: 13, marginTop: 5 },
  sourceTag: { color: theme.colors.tealDark, backgroundColor: theme.colors.tealSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, overflow: 'hidden', fontSize: 11, fontWeight: '800' },
  hash: { fontFamily: 'monospace', fontSize: 11, color: '#475569', marginTop: 10 },
  observationCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  observationTitle: { fontWeight: '800', color: theme.colors.navyText },
  observationMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 5 },
  observationBody: { color: '#334155', lineHeight: 20, marginTop: 9 },
  responseCard: { backgroundColor: '#eef5f8', borderRadius: 9, padding: 10, marginTop: 10 },
  responseAuthor: { color: theme.colors.tealDark, fontWeight: '800' },
  responseForm: { marginTop: 10 },
  profileCard: { padding: 22, backgroundColor: theme.colors.navy, borderRadius: 17, alignItems: 'center', marginBottom: 13 },
  profileAvatar: { width: 72, height: 72, borderRadius: 23, backgroundColor: '#8eddd0', alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { color: theme.colors.navy, fontSize: 23, fontWeight: '900' },
  profileName: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center', marginTop: 13 },
  profileEmail: { color: '#d5e4ef', textAlign: 'center', marginTop: 4 },
  profileRole: { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 99, paddingHorizontal: 11, paddingVertical: 6, marginTop: 12 },
  profileRoleText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  securityCard: { padding: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, marginBottom: 12 },
  securityTitle: { color: theme.colors.navyText, fontSize: 19, fontWeight: '900', marginTop: 4, marginBottom: 7 },
  securityFact: { paddingVertical: 11, borderTopWidth: 1, borderTopColor: theme.colors.border, flexDirection: 'row', gap: 10 },
  securityFactNumber: { color: theme.colors.teal, fontWeight: '900', fontSize: 11, marginTop: 2 },
  securityFactCopy: { flex: 1 },
  securityFactTitle: { color: theme.colors.navyText, fontWeight: '800' },
  securityFactText: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  permissionsCard: { padding: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, marginBottom: 12 },
  permissionList: { gap: 7 },
  permissionItem: { padding: 10, backgroundColor: theme.colors.tealSoft, borderRadius: 9 },
  permissionItemText: { color: theme.colors.tealDark, fontSize: 12, fontWeight: '800' },
  profileEditCard: { padding: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, marginBottom: 12 },
  profileEditHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  profileEditHeadingCopy: { flex: 1 },
  profileEditButton: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.teal, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  profileEditButtonText: { color: theme.colors.tealDark, fontWeight: '900' },
  profileEditForm: { marginTop: 8, paddingTop: 4 },
  buttonContentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  lockedDataNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14, padding: 13, backgroundColor: theme.colors.warningBackground, borderRadius: 11 },
  lockedDataCopy: { flex: 1 },
  lockedDataTitle: { color: theme.colors.warningText, fontWeight: '900' },
  lockedDataText: { color: '#7c4a13', fontSize: 12, lineHeight: 18, marginTop: 3 },
  supportEmail: { color: theme.colors.tealDark, fontWeight: '900', marginTop: 7, textDecorationLine: 'underline' },
  signOutButton: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.dangerText, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  signOutButtonText: { color: theme.colors.dangerText, fontWeight: '900' },
  bottomNavigation: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: theme.colors.border, paddingHorizontal: 8, paddingTop: 7, shadowColor: theme.colors.navyText, shadowOpacity: 0.06, shadowRadius: 12, elevation: 8 },
  bottomNavigationInner: { width: '100%', maxWidth: 640, alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-around' },
  bottomNavigationItem: { flex: 1, minHeight: 55, alignItems: 'center', justifyContent: 'center' },
  bottomNavigationMark: { minWidth: 42, height: 30, paddingHorizontal: 9, borderRadius: 12, backgroundColor: '#eef3f7', alignItems: 'center', justifyContent: 'center' },
  bottomNavigationMarkActive: { backgroundColor: theme.colors.tealSoft },
  bottomNavigationLabel: { color: theme.colors.muted, fontSize: 10, fontWeight: '700', marginTop: 3 },
  bottomNavigationLabelActive: { color: theme.colors.tealDark, fontWeight: '900' },
  navigationBadge: { position: 'absolute', right: -8, top: -6, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: '#b42318', alignItems: 'center', justifyContent: 'center' },
  navigationBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900' }
});
