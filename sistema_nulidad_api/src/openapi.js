import { config } from './config.js';

export const openapiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'API del Sistema Integral de Expedientes',
    version: '2.0.0',
    description: 'API general para expedientes jurídicos. Autoriza cada recurso para prevenir BOLA/IDOR y conserva versiones documentales en almacenamiento privado.'
  },
  servers: [{ url: '/', description: 'Servidor actual' }],
  tags: [
    { name: 'Estado', description: 'Comprobaciones de disponibilidad.' },
    { name: 'Autenticación', description: 'Inicio de sesión y sesión vigente.' },
    { name: 'Sistema', description: 'Operaciones servidor a servidor protegidas por API key.' },
    { name: 'Expedientes', description: 'Consulta autorizada de expedientes.' },
    { name: 'Documentos', description: 'Consulta autorizada de metadatos y versiones.' },
    { name: 'Observaciones', description: 'Seguimiento inmutable de revisión, respuesta y resolución.' },
    { name: 'Control documental', description: 'Revisión, autorización, certificación y firma según la política de la versión.' },
    { name: 'Decisiones', description: 'Determinaciones procesales inmutables de expedientes asignados.' },
    { name: 'Gestión procesal', description: 'Alta de expedientes, asignaciones, participantes, etapas, plazos y baja lógica.' },
    { name: 'Auditoría', description: 'Consultas de solo lectura y reportes de trazabilidad.' },
    { name: 'Administración', description: 'Identidades, roles, catálogos y configuración sin acceso jurídico implícito.' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      systemApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' }
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'not_found' },
              message: { type: 'string', example: 'Recurso no encontrado.' }
            }
          }
        }
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password', 'clientChannel'],
        properties: {
          email: { type: 'string', format: 'email', example: 'abogado@example.test' },
          password: { type: 'string', format: 'password', example: 'UnaClaveSeguraDePrueba!2026' },
          clientChannel: { type: 'string', enum: ['web', 'technical'], example: 'web' }
        }
      },
      OwnProfileUpdate: {
        type: 'object',
        additionalProperties: false,
        required: ['fullName'],
        properties: {
          fullName: {
            type: 'string',
            minLength: 3,
            maxLength: 160,
            description: 'Nombre visible. Correo, roles, permisos y estado no son editables por esta operación.'
          }
        }
      },
      ProvisionUserRequest: {
        type: 'object',
        required: ['fullName', 'email', 'password', 'roleCode'],
        properties: {
          fullName: { type: 'string', example: 'Abogado de prueba' },
          email: { type: 'string', format: 'email', example: 'abogado@example.test' },
          password: {
            type: 'string',
            format: 'password',
            minLength: config.minimumPasswordLength,
            description: 'En producción se exigen al menos 12 caracteres.'
          },
          roleCode: {
            type: 'string',
            enum: [
              'notary', 'judge', 'lawyer', 'prosecutor', 'defender', 'expert',
              'secretary', 'coordinator', 'auditor', 'party', 'witness'
            ]
          }
        }
      },
      BootstrapAdminRequest: {
        type: 'object',
        required: ['fullName', 'email', 'password'],
        properties: {
          fullName: { type: 'string', example: 'Administración TI' },
          email: { type: 'string', format: 'email', example: 'admin@example.test' },
          password: {
            type: 'string',
            format: 'password',
            minLength: config.minimumPasswordLength,
            description: 'En producción se exigen al menos 12 caracteres.'
          }
        }
      },
      DocumentUpload: {
        type: 'object',
        required: ['documentTypeCode', 'file'],
        properties: {
          documentTypeCode: { type: 'string', example: 'evidence' },
          title: { type: 'string', maxLength: 255, example: 'Prueba documental' },
          description: { type: 'string', maxLength: 4000 },
          file: {
            type: 'string',
            format: 'binary',
            description: 'PDF, JPG o PNG; máximo 25 MB. El tipo se detecta desde el contenido.'
          }
        }
      },
      DocumentVersionUpload: {
        type: 'object',
        required: ['file'],
        properties: {
          file: {
            type: 'string',
            format: 'binary',
            description: 'Archivo PDF, JPG o PNG de la nueva versión. Nunca reemplaza una versión anterior.'
          }
        }
      },
      ObservationCreate: {
        type: 'object',
        required: ['observationType', 'body'],
        properties: {
          observationType: {
            type: 'string',
            enum: ['comment', 'correction_required', 'clarification_required', 'legal_review']
          },
          body: { type: 'string', minLength: 5, maxLength: 3000 }
        }
      },
      ObservationResponseCreate: {
        type: 'object',
        required: ['body'],
        properties: {
          body: { type: 'string', minLength: 2, maxLength: 3000 },
          referencedDocumentVersionId: {
            type: ['integer', 'null'],
            minimum: 1,
            description: 'Versión posterior que atiende la observación, si existe.'
          }
        }
      },
      ObservationResolve: {
        type: 'object',
        required: ['resolutionNote'],
        properties: {
          resolutionNote: { type: 'string', minLength: 2, maxLength: 2000 }
        }
      },
      DocumentActionCreate: {
        type: 'object',
        required: ['actionCode', 'outcome', 'note'],
        properties: {
          actionCode: { type: 'string', enum: ['review', 'authorize', 'certify'] },
          outcome: { type: 'string', enum: ['approved', 'rejected', 'returned'] },
          note: { type: 'string', minLength: 5, maxLength: 2000 }
        }
      },
      IntegritySignatureCreate: {
        type: 'object',
        required: ['confirmation'],
        properties: {
          confirmation: {
            type: 'boolean',
            const: true,
            description: 'Consentimiento expreso para registrar la constancia autenticada de integridad.'
          }
        }
      },
      CaseDecisionCreate: {
        type: 'object',
        required: ['decisionType', 'outcomeCode', 'title', 'reasoning'],
        properties: {
          decisionType: { type: 'string', enum: ['procedural_order', 'interim_resolution', 'final_judgment', 'other'] },
          outcomeCode: { type: 'string', minLength: 2, maxLength: 80 },
          title: { type: 'string', minLength: 5, maxLength: 240 },
          reasoning: { type: 'string', minLength: 10, maxLength: 12000 },
          documentVersionId: { type: ['integer', 'null'], minimum: 1 },
          supersedesDecisionId: { type: ['integer', 'null'], minimum: 1 }
        }
      }
    }
  },
  paths: {
    '/health': {
      get: {
        tags: ['Estado'],
        summary: 'Comprueba la conectividad de API, MySQL y MinIO.',
        responses: {
          200: { description: 'Servicios disponibles.' },
          500: { description: 'No se pudo conectar a la base.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/auth/login': {
      post: {
        tags: ['Autenticación'],
        summary: 'Autentica un perfil web o técnico y emite un JWT temporal.',
        description: 'Las partes y testigos utilizan el endpoint /auth/login de la API móvil en el puerto 3001.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
        responses: {
          200: { description: 'Sesión iniciada.' },
          401: { description: 'Credenciales inválidas.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          429: { description: 'Demasiados intentos.' }
        }
      }
    },
    '/auth/me': {
      get: {
        tags: ['Autenticación'], summary: 'Devuelve la identidad asociada al JWT.', security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Sesión vigente.' }, 401: { description: 'JWT ausente, inválido o expirado.' } }
      },
      patch: {
        tags: ['Autenticación'],
        summary: 'Actualiza únicamente el nombre visible de la cuenta autenticada.',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OwnProfileUpdate' } } } },
        responses: {
          200: { description: 'Perfil actualizado y cambio registrado en auditoría.' },
          400: { description: 'Campo no editable o nombre inválido.' },
          401: { description: 'Sesión ausente, inválida o expirada.' }
        }
      }
    },
    '/system/schema-status': {
      get: {
        tags: ['Sistema'], summary: 'Consulta el estado del esquema sin exponer datos jurídicos.', security: [{ systemApiKey: [] }],
        responses: { 200: { description: 'Estado del esquema.' }, 401: { description: 'API key inválida.' } }
      }
    },
    '/system/bootstrap-admin': {
      post: {
        tags: ['Sistema'], summary: 'Crea la única cuenta técnica inicial.', security: [{ systemApiKey: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/BootstrapAdminRequest' } } } },
        responses: { 201: { description: 'Cuenta creada.' }, 409: { description: 'Ya existe una cuenta administradora.' } }
      }
    },
    '/system/users': {
      post: {
        tags: ['Sistema'], summary: 'Aprovisiona cuentas de roles jurídicos de forma auditable.', security: [{ systemApiKey: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ProvisionUserRequest' } } } },
        responses: { 201: { description: 'Cuenta creada.' }, 409: { description: 'Bootstrap pendiente o correo existente.' } }
      }
    },
    '/cases': {
      get: {
        tags: ['Expedientes'], summary: 'Lista solo los expedientes permitidos para el usuario.', security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Expedientes autorizados.' }, 401: { description: 'JWT inválido.' }, 403: { description: 'Perfil técnico sin permiso jurídico.' } }
      }
    },
    '/cases/{caseId}': {
      get: {
        tags: ['Expedientes'], summary: 'Consulta un expediente tras validar autorización por objeto.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: { description: 'Expediente autorizado.' }, 404: { description: 'No existe o no está autorizado.' } }
      }
    },
    '/cases/{caseId}/people': {
      get: {
        tags: ['Expedientes'],
        summary: 'Consulta responsables y participantes activos de un expediente autorizado.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: {
          200: { description: 'Equipo profesional y participantes del expediente.' },
          403: { description: 'El perfil no tiene permiso para consultar personas.' },
          404: { description: 'El expediente no existe o no está asignado al usuario.' }
        }
      }
    },
    '/cases/{caseId}/documents': {
      get: {
        tags: ['Expedientes'], summary: 'Lista documentos del expediente filtrados por rol y propietario.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: { description: 'Documentos autorizados.' }, 404: { description: 'No existe o no está autorizado.' } }
      },
      post: {
        tags: ['Documentos'],
        summary: 'Crea un documento y su primera versión cifrada en MinIO.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { $ref: '#/components/schemas/DocumentUpload' } } }
        },
        responses: {
          201: { description: 'Documento y versión almacenados con retención.' },
          403: { description: 'El perfil o canal no permite cargar.' },
          413: { description: 'Archivo demasiado grande.' },
          415: { description: 'Tipo de contenido no permitido.' }
        }
      }
    },
    '/cases/{caseId}/document-types': {
      get: {
        tags: ['Documentos'],
        summary: 'Lista tipos y reglas documentales vigentes para el expediente.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: { description: 'Catálogo contextual autorizado.' }, 404: { description: 'No existe o no está autorizado.' } }
      }
    },
    '/documents/{documentId}': {
      get: {
        tags: ['Documentos'], summary: 'Consulta metadatos de un documento con validación BOLA/IDOR.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: { description: 'Documento autorizado.' }, 404: { description: 'No existe o no está autorizado.' } }
      }
    },
    '/documents/{documentId}/versions': {
      get: {
        tags: ['Documentos'], summary: 'Consulta estados de autorización y firma de cada versión.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: { description: 'Versiones autorizadas.' }, 404: { description: 'No existe o no está autorizado.' } }
      },
      post: {
        tags: ['Documentos'],
        summary: 'Agrega una nueva versión sin sobrescribir el historial.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        requestBody: {
          required: true,
          content: { 'multipart/form-data': { schema: { $ref: '#/components/schemas/DocumentVersionUpload' } } }
        },
        responses: {
          201: { description: 'Versión almacenada con política y origen inmutables.' },
          403: { description: 'El perfil no puede crear versiones.' },
          413: { description: 'Archivo demasiado grande.' },
          415: { description: 'Tipo de contenido no permitido.' }
        }
      }
    },
    '/documents/{documentId}/versions/{versionId}/content': {
      get: {
        tags: ['Documentos'],
        summary: 'Entrega una versión para vista previa web o descarga autorizada.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'versionId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          {
            name: 'download',
            in: 'query',
            required: false,
            description: 'Requiere document.download.web. La vista previa no concede este permiso.',
            schema: { type: 'boolean', default: false }
          }
        ],
        responses: {
          200: { description: 'Contenido original verificado.', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
          403: { description: 'Apertura o descarga no autorizada.' },
          409: { description: 'La versión aún no está disponible en MinIO.' }
        }
      }
    },
    '/documents/{documentId}/workflow': {
      get: {
        tags: ['Control documental'],
        summary: 'Consulta acciones y firmas inmutables del documento.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: { description: 'Historial autorizado.' }, 404: { description: 'No existe o no está autorizado.' } }
      }
    },
    '/documents/{documentId}/versions/{versionId}/actions': {
      post: {
        tags: ['Control documental'],
        summary: 'Registra una revisión, autorización o certificación sin sobrescribir el historial.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'versionId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/DocumentActionCreate' } } } },
        responses: {
          201: { description: 'Acción registrada y auditada.' },
          403: { description: 'Permiso, rol o expediente no autorizado.' },
          409: { description: 'La política o el estado no permite la transición.' }
        }
      }
    },
    '/documents/{documentId}/versions/{versionId}/signatures': {
      post: {
        tags: ['Control documental'],
        summary: 'Registra una constancia autenticada sobre la huella SHA-256 de la versión.',
        description: 'La constancia HMAC de integridad no sustituye por sí sola un certificado electrónico cualificado.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'versionId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/IntegritySignatureCreate' } } } },
        responses: {
          201: { description: 'Firma de integridad verificada y conservada.' },
          403: { description: 'El perfil o rol firmante no está autorizado.' },
          409: { description: 'Faltan revisión, autorización u observaciones por resolver.' }
        }
      }
    },
    '/cases/{caseId}/decisions': {
      get: {
        tags: ['Decisiones'],
        summary: 'Consulta las decisiones de un expediente asignado.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: { description: 'Historial de decisiones.' }, 404: { description: 'Expediente no autorizado.' } }
      },
      post: {
        tags: ['Decisiones'],
        summary: 'Emite una decisión inmutable; una corrección debe sustituir la anterior.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CaseDecisionCreate' } } } },
        responses: {
          201: { description: 'Decisión emitida y auditada.' },
          403: { description: 'El perfil no puede emitir decisiones.' },
          409: { description: 'Expediente inactivo o documento vinculado incompleto.' }
        }
      }
    },
    '/process/catalogs': {
      get: {
        tags: ['Gestión procesal'], summary: 'Lista opciones procesales compatibles con el permiso y el expediente.', security: [{ bearerAuth: [] }],
        parameters: [{
          name: 'caseId',
          in: 'query',
          required: false,
          description: 'Al incluirlo, devuelve únicamente responsables y participantes que todavía pueden vincularse al expediente.',
          schema: { type: 'integer', minimum: 1 }
        }],
        responses: {
          200: { description: 'Tipos y unidades para alta, u opciones válidas de asignación e invitación para el expediente.' },
          403: { description: 'Perfil sin el permiso procesal requerido o expediente no autorizado.' }
        }
      }
    },
    '/process/cases': {
      post: {
        tags: ['Gestión procesal'], summary: 'Crea un expediente general y asigna al operador que lo registró.', security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 201: { description: 'Expediente creado con perfil e historial inicial.' }, 409: { description: 'Folio duplicado.' } }
      }
    },
    '/process/cases/{caseId}': {
      get: {
        tags: ['Gestión procesal'], summary: 'Consulta asignaciones, participantes, etapas y plazos del expediente.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Estado procesal autorizado.' }, 404: { description: 'Expediente no asignado.' } }
      }
    },
    '/process/cases/{caseId}/assignments': {
      post: {
        tags: ['Gestión procesal'], summary: 'Agrega una asignación activa validando el rol del usuario.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 201: { description: 'Asignación creada.' }, 409: { description: 'Asignación duplicada o rol incompatible.' } }
      }
    },
    '/process/cases/{caseId}/assignments/{assignmentId}/end': {
      post: {
        tags: ['Gestión procesal'], summary: 'Finaliza lógicamente una asignación sin eliminarla.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'assignmentId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Asignación revocada.' } }
      }
    },
    '/process/cases/{caseId}/invitations': {
      post: {
        tags: ['Gestión procesal'], summary: 'Invita a una parte o testigo; no concede acceso hasta su aceptación móvil.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 201: { description: 'Invitación pendiente creada.' }, 409: { description: 'Invitación duplicada, participación activa o perfil incompatible.' } }
      }
    },
    '/process/cases/{caseId}/participants/{participationId}/end': {
      post: {
        tags: ['Gestión procesal'], summary: 'Inactiva lógicamente una participación.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'participationId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Participación inactivada.' } }
      }
    },
    '/process/cases/{caseId}/stages': {
      post: {
        tags: ['Gestión procesal'], summary: 'Registra una transición de etapa inmutable.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 201: { description: 'Transición registrada.' }, 409: { description: 'Etapa no válida para el tipo de expediente.' } }
      }
    },
    '/process/cases/{caseId}/deadlines': {
      post: {
        tags: ['Gestión procesal'], summary: 'Crea un plazo vinculado con la etapa actual.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 201: { description: 'Plazo creado con historial inicial.' } }
      }
    },
    '/process/cases/{caseId}/deadlines/{deadlineId}/status': {
      post: {
        tags: ['Gestión procesal'], summary: 'Finaliza un plazo y conserva el cambio en historial.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'deadlineId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Estado final registrado.' } }
      }
    },
    '/process/cases/{caseId}/state': {
      post: {
        tags: ['Gestión procesal'], summary: 'Cambia estado o visibilidad mediante trazabilidad y borrado lógico.', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Estado actualizado.' }, 403: { description: 'Ocultamiento no autorizado.' } }
      }
    },
    '/audit/overview': {
      get: { tags: ['Auditoría'], summary: 'Resume eventos, versiones, firmas y decisiones.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Resumen de solo lectura.' } } }
    },
    '/audit/events': {
      get: { tags: ['Auditoría'], summary: 'Lista la bitácora permanente.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Eventos auditables.' } } }
    },
    '/audit/access': {
      get: { tags: ['Auditoría'], summary: 'Lista accesos y descargas documentales.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Accesos auditables.' } } }
    },
    '/audit/versions': {
      get: { tags: ['Auditoría'], summary: 'Lista versiones, orígenes y huellas.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Inventario de versiones.' } } }
    },
    '/audit/signatures': {
      get: { tags: ['Auditoría'], summary: 'Lista firmas y estados de verificación.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Inventario de firmas.' } } }
    },
    '/audit/report.csv': {
      get: { tags: ['Auditoría'], summary: 'Exporta hasta 5000 eventos en CSV.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Reporte CSV.', content: { 'text/csv': { schema: { type: 'string' } } } } } }
    },
    '/administration/overview': {
      get: { tags: ['Administración'], summary: 'Resume salud lógica, usuarios, roles y migraciones.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Resumen técnico.' } } }
    },
    '/administration/users': {
      get: { tags: ['Administración'], summary: 'Lista cuentas y roles activos.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Usuarios.' } } },
      post: { tags: ['Administración'], summary: 'Crea una cuenta con contraseña bcrypt y rol inicial.', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Usuario creado.' }, 409: { description: 'Correo existente.' } } }
    },
    '/administration/users/{userId}': {
      get: {
        tags: ['Administración'],
        summary: 'Consulta el perfil técnico detallado sin exponer contraseña ni expedientes.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: { description: 'Identidad, roles, permisos, membresías e historial técnico.' }, 404: { description: 'Usuario no encontrado.' } }
      }
    },
    '/administration/users/{userId}/password': {
      post: {
        tags: ['Administración'],
        summary: 'Actualiza una contraseña con bcrypt sin exponerla en la bitácora.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: { description: 'Contraseña actualizada y acción auditada.' }, 404: { description: 'Usuario no encontrado.' } }
      }
    },
    '/administration/users/{userId}/status': {
      post: { tags: ['Administración'], summary: 'Activa, suspende o archiva una cuenta sin eliminarla.', security: [{ bearerAuth: [] }], parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Estado actualizado.' } } }
    },
    '/administration/users/{userId}/roles': {
      post: { tags: ['Administración'], summary: 'Concede un rol mediante una concesión auditable.', security: [{ bearerAuth: [] }], parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 201: { description: 'Rol concedido.' } } }
    },
    '/administration/users/{userId}/roles/{roleCode}/revoke': {
      post: { tags: ['Administración'], summary: 'Revoca lógicamente un rol activo.', security: [{ bearerAuth: [] }], parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'roleCode', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Rol revocado.' } } }
    },
    '/administration/roles': {
      get: { tags: ['Administración'], summary: 'Lista roles, canales y permisos activos.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Matriz de permisos.' } } }
    },
    '/administration/catalogs': {
      get: { tags: ['Administración'], summary: 'Lista materias, tipos de caso y tipos documentales.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Catálogos.' } } }
    },
    '/administration/document-types': {
      post: { tags: ['Administración'], summary: 'Crea un tipo documental y su primera regla inmutable.', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Tipo y regla creados.' } } }
    },
    '/administration/configuration': {
      get: { tags: ['Administración'], summary: 'Consulta configuración sanitizada sin exponer secretos.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Configuración no sensible.' } } }
    },
    '/observations': {
      get: {
        tags: ['Observaciones'],
        summary: 'Lista las observaciones visibles para el usuario autenticado.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Bandeja de observaciones autorizada por expediente.' },
          403: { description: 'El perfil técnico no puede consultar información jurídica.' }
        }
      }
    },
    '/documents/{documentId}/observations': {
      get: {
        tags: ['Observaciones'],
        summary: 'Consulta el historial de observaciones y respuestas de un documento.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: {
          200: { description: 'Historial autorizado, incluido el estado de resolución.' },
          404: { description: 'No existe o no está autorizado.' }
        }
      }
    },
    '/documents/{documentId}/versions/{versionId}/observations': {
      post: {
        tags: ['Observaciones'],
        summary: 'Emite una observación sobre una versión sin modificarla.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'versionId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ObservationCreate' } } } },
        responses: {
          201: { description: 'Observación abierta y auditada.' },
          403: { description: 'Solo un perfil revisor con permiso puede emitirla.' },
          409: { description: 'El expediente o documento no está activo.' }
        }
      }
    },
    '/documents/{documentId}/observations/{observationId}/responses': {
      post: {
        tags: ['Observaciones'],
        summary: 'Agrega una respuesta inmutable y opcionalmente vincula una versión posterior.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'observationId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ObservationResponseCreate' } } } },
        responses: {
          201: { description: 'Respuesta conservada y observación marcada como respondida.' },
          403: { description: 'El perfil no puede responder observaciones.' },
          409: { description: 'La observación ya no admite respuestas o la versión no es posterior.' }
        }
      }
    },
    '/documents/{documentId}/observations/{observationId}/resolve': {
      post: {
        tags: ['Observaciones'],
        summary: 'Resuelve una observación que ya recibió respuesta.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'observationId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ObservationResolve' } } } },
        responses: {
          200: { description: 'Observación resuelta con actor, fecha y nota.' },
          403: { description: 'El perfil no puede resolver observaciones.' },
          409: { description: 'La observación aún no tiene respuesta.' }
        }
      }
    }
  }
};
