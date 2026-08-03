import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

export async function selectDocumentFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'application/pdf',
      'image/jpeg',
      'image/png'
    ],
    copyToCacheDirectory: true,
    multiple: false
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name || `documento-${Date.now()}`,
    type: asset.mimeType || 'application/octet-stream',
    size: asset.size ?? null,
    file: asset.file,
    uploadSource: 'mobile_file'
  };
}

export async function captureDocumentPhoto() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    const error = new Error('Autoriza el uso de la cámara para fotografiar el documento.');
    error.code = 'camera_permission_required';
    throw error;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    cameraType: ImagePicker.CameraType.back,
    allowsEditing: false,
    quality: 1,
    exif: false
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const extension = asset.mimeType === 'image/png' ? 'png' : 'jpg';
  return {
    uri: asset.uri,
    name: asset.fileName || `captura-documento-${Date.now()}.${extension}`,
    type: asset.mimeType || 'image/jpeg',
    size: asset.fileSize ?? null,
    file: asset.file,
    uploadSource: 'mobile_camera'
  };
}
