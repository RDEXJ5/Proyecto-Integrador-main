import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as api from './src/api';

export default function App() {
  const [token, setToken] = useState(null);
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cases, setCases] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.restoreToken().then((saved) => { setToken(saved); setLoading(false); }); }, []);
  useEffect(() => { if (token) refreshCases(); }, [token]);

  async function signIn() {
    try {
      const result = await api.login(email, password);
      setProfile(result.user); setToken(result.access_token);
    } catch (error) { Alert.alert('Acceso denegado', error.message); }
  }
  async function refreshCases() {
    try { setCases(await api.getCases(token)); } catch (error) { Alert.alert('Error', error.message); }
  }
  async function openCase(item) {
    try { setDocuments(await api.getDocuments(token, item.id)); setVersions([]); } catch (error) { Alert.alert('Error', error.message); }
  }
  async function openDocument(item) {
    try { setVersions(await api.getVersions(token, item.id)); } catch (error) { Alert.alert('Error', error.message); }
  }
  async function sign(version) {
    try { await api.signVersion(token, version.id); Alert.alert('Firma registrada', `La versión ${version.version_number} quedó firmada y auditada.`); }
    catch (error) { Alert.alert('No se pudo firmar', error.message); }
  }
  async function signOut() { await api.logout(); setToken(null); setProfile(null); setCases([]); setDocuments([]); setVersions([]); }

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator /></SafeAreaView>;
  if (!token) return <SafeAreaView style={styles.login}><Text style={styles.title}>Expediente Íntegro</Text><Text style={styles.subtitle}>Firma judicial móvil · sin descargas de archivos</Text><TextInput style={styles.input} placeholder="Correo" autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail}/><TextInput style={styles.input} placeholder="Contraseña" secureTextEntry onChangeText={setPassword}/><Button title="Iniciar sesión" onPress={signIn}/></SafeAreaView>;
  return <SafeAreaView style={styles.container}><StatusBar style="dark"/><View style={styles.header}><View><Text style={styles.title}>Expedientes</Text><Text>{profile?.full_name || 'Sesión activa'} · {profile?.role || 'rol'}</Text></View><Button title="Salir" onPress={signOut}/></View><Text style={styles.section}>Casos disponibles</Text><FlatList data={cases} keyExtractor={(x) => String(x.id)} renderItem={({item}) => <Text style={styles.row} onPress={() => openCase(item)}>{item.folio} · {item.title} ({item.status})</Text>} ListEmptyComponent={<Text>No hay casos para este rol.</Text>}/>{documents.length > 0 && <><Text style={styles.section}>Documentos del caso</Text>{documents.map((item) => <Text key={item.id} style={styles.row} onPress={() => openDocument(item)}>{item.title} · {item.kind}</Text>)}</>}{versions.length > 0 && <><Text style={styles.section}>Versiones</Text>{versions.map((version) => <View key={version.id} style={styles.version}><Text>v{version.version_number} · {version.original_name}</Text><Text numberOfLines={1}>SHA-256: {version.sha256}</Text>{profile?.role === 'judge' && <Button title="Firmar versión" onPress={() => sign(version)}/>}</View>)}</>}</SafeAreaView>;
}

const styles = StyleSheet.create({ container:{flex:1,padding:20,backgroundColor:'#f6f8fb'}, center:{flex:1,justifyContent:'center',alignItems:'center'}, login:{flex:1,justifyContent:'center',padding:28,gap:14,backgroundColor:'#f6f8fb'}, title:{fontSize:25,fontWeight:'800',color:'#12314c'}, subtitle:{color:'#526274'}, input:{backgroundColor:'#fff',borderWidth:1,borderColor:'#bdcad8',borderRadius:8,padding:12}, header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:18}, section:{fontWeight:'800',fontSize:16,marginTop:16,marginBottom:6}, row:{backgroundColor:'#fff',padding:13,borderRadius:8,marginBottom:8,color:'#12314c'}, version:{backgroundColor:'#e4edf5',padding:12,borderRadius:8,gap:7,marginBottom:8} });
