# co-CGAR

Base de chat para formular problemas de investigación DSR, sin cuentas y sin dependencias npm. Requiere Node.js 22 o posterior.

```sh
npm start
```

Abre http://localhost:3000 y pulsa **Configuración del modelo**. Introduce un endpoint completo compatible con `POST /v1/chat/completions`, el identificador de modelo y una API key. El servidor local evita depender del CORS del proveedor. Compatible con servicios que aceptan `messages`, los roles system/user/assistant y `Authorization: Bearer`; Anthropic dispone de un adaptador nativo de Messages API. Los modelos deben admitir un system prompt.

## Funcionamiento

- El system prompt pedagógico está en `public/system-prompt.md`. La opción **System prompt** permite desbloquearlo, editarlo, guardar una versión en localStorage y restablecer el predeterminado.
- Cada petición envía el historial, el BOARD actual (incluidas las ediciones manuales), el último registro disponible y el mensaje del alumno. El servidor añade el contrato JSON al prompt elegido sin sobrescribir los prompts personalizados guardados.
- La respuesta tiene exactamente `message`, `board` y `record`. El chat muestra solo `message`: la explicación, reflexión y pregunta pedagógica completas. BOARD y registro son estados secundarios de esa misma interacción.
- `board` es una instantánea completa: artefacto, contexto, requisitos, objetivos, comprobaciones, discrepancias, cuestiones aparcadas y próximo paso. No se inventan valores para rellenar huecos.
- Con logging activado, `record` recoge turno, fase, movimiento, comprobación y los tres indicadores de investigación. La aplicación lo guarda junto con una copia independiente del BOARD y el mensaje exacto, y los muestra en **Registro**. Una edición posterior del BOARD no modifica las instantáneas anteriores.
- Con logging desactivado se exige `record: null`. El chat y el BOARD siguen funcionando; no se crea un registro de investigación nuevo. Se conservan los registros previos y las revisiones manuales.
- Requisitos y objetivos se editan como JSON. Las referencias `serves` deben corresponder a objetivos presentes; usa `[]` cuando todavía no se conoce el vínculo. Una edición invalida sus checks y devuelve los elementos afectados a `stated`.
- Sesiones y registros persisten en localStorage. La exportación JSON versión 2 contiene sesión, registros, BOARD y configuración, sin API key. Las sesiones y registros STATE anteriores siguen siendo legibles.
- Las claves propias solo existen en memoria de la pestaña; la conexión Server default se configura en el entorno del servidor. El servidor no almacena conversaciones.

## Respuestas estructuradas y recuperación

`public/contract.js` define el esquema compartido por proveedor, servidor y navegador. Se validan tipos, campos obligatorios, campos extra, enumeraciones, mensaje no vacío, turno exacto, contadores, IDs únicos y referencias entre requisitos y objetivos. La actualización del mensaje, BOARD y registro se acepta como una sola operación validada.

Se solicita JSON Schema estricto a OpenAI, Groq, Gemini y endpoints compatibles, y `output_config.format` a Anthropic. DeepSeek utiliza su modo JSON. Cuando el proveedor rechaza explícitamente el formato por incompatibilidad, se utiliza modo JSON y, si tampoco está admitido, JSON solicitado mediante el prompt. La validación local siempre permanece activa; no se rebaja ante incompatibilidades.

Una respuesta inválida o truncada recibe **un único intento de corrección**, para el mismo turno. Si el mensaje original era válido, se conserva literalmente al corregir los metadatos. Si el segundo intento falla, no se guarda ninguna parte de la respuesta: el BOARD y los registros anteriores permanecen intactos y el mensaje del alumno vuelve al editor para reintentarlo. No se reintentan automáticamente rechazos de contenido, errores de autenticación o límites de uso. Como máximo hay cuatro peticiones por envío, contando dos posibles rechazos de compatibilidad y una corrección; la corrección puede consumir tokens adicionales.

El contrato de salida tiene precedencia solo sobre el formato antiguo (comentarios STATE/BOARD_STATE), incluso si un prompt anterior sigue guardado en localStorage. Conserva las reglas pedagógicas del tutor. El nuevo predeterminado explicita que `message` es la respuesta principal: debe contestar al alumno, dar la explicación necesaria y proponer como máximo dos preguntas, preferentemente una. La validez estructural no garantiza por sí sola la calidad pedagógica ni la veracidad del contenido.

Fuentes de los adaptadores: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat), [Anthropic Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Groq Structured Outputs](https://console.groq.com/docs/structured-outputs), [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/).

## Comprobaciones

```sh
npm test
```

Pruebas del contrato JSON, conservación de la respuesta pedagógica, reparación limitada, respuestas truncadas, incompatibilidades de formato, logging, instantáneas, referencias, ediciones manuales y protección de Server default. Las pruebas usan proveedores simulados; no consumen una API real.

## Alcance

Prototipo local: el servidor escucha únicamente en 127.0.0.1. No exponer directamente a Internet; no incorpora autenticación, cuotas ni protección de un proxy público. No hay streaming ni sincronización entre dispositivos. Borrar los datos del navegador elimina las sesiones. El modelo puede incumplir el protocolo: la aplicación avisa y conserva el último BOARD válido. La validación estructural no garantiza la corrección pedagógica del modelo.

## Proveedores y Server default

Requiere **Node.js 22 o posterior**. Puedes elegir OpenAI, Anthropic (Messages API nativa), DeepSeek, Groq, Gemini (compatibilidad OpenAI) o cualquier endpoint compatible con OpenAI. Introduce el ID exacto de un modelo disponible para tu cuenta; no se mantiene un catálogo estático de modelos.

Para configurar una conexión del servidor antes de arrancar:

```sh
cp .env.example .env
chmod 600 .env
```

Edita `.env` en tu equipo:

```dotenv
SERVER_DEFAULT_PROVIDER=openai
SERVER_DEFAULT_MODEL=ID_DEL_MODELO
SERVER_DEFAULT_API_KEY=TU_API_KEY
SERVER_DEFAULT_PASSWORD=UNA_CONTRASENA_DE_AL_MENOS_12_CARACTERES
```

Para `compatible`, añade `SERVER_DEFAULT_ENDPOINT` con la URL completa. Los otros proveedores tienen destinos fijos. Ejecuta `npm start` y selecciona **Server default** en Configuración del modelo. Introduce la contraseña, pulsa **Desbloquear durante 24 horas** y guarda la configuración. La selección se conserva al recargar. La contraseña no se guarda en el navegador y la API key no sale del servidor salvo en la petición al proveedor configurado.

El desbloqueo usa una cookie HttpOnly/SameSite=Strict con caducidad de 24 horas. Se puede revocar con **Bloquear ahora**; reiniciar el servidor revoca todos los accesos. El servidor limita los intentos fallidos a 10 por cada 15 minutos. Sigue sin haber cuentas de usuario. `.env` queda excluido de Git y de los archivos servidos por HTTP. Se almacena como texto local, por lo que debe mantenerse privado.

Las claves propias siguen siendo temporales: no se incluyen en localStorage ni en exportaciones. Cambiar de proveedor requiere introducir su clave. Server default utiliza exclusivamente el proveedor, modelo y destino del servidor, aunque el cliente envíe otros valores.

Referencia de comportamiento: [ChatinVis LLMPanel](https://github.com/onekin/ChatinVis-Web-App/blob/main/client/src/components/editor/LLMPanel.jsx) y [controlador de desbloqueo](https://github.com/onekin/ChatinVis-Web-App/blob/main/server/src/controllers/auth.controller.js). Implementación propia para este prototipo, sin copiar sus dependencias de usuarios, JWT o MongoDB.

Documentación de protocolos: [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Gemini compatible con OpenAI](https://ai.google.dev/gemini-api/docs/openai), [Groq](https://console.groq.com/docs/overview), [DeepSeek](https://api-docs.deepseek.com/).

Las pruebas de integración usan respuestas simuladas: verifican el transporte de los seis proveedores, desbloqueo, bloqueo, caducidad, limitación de intentos, rechazo de peticiones de otro origen y que el cliente no pueda redirigir la clave del servidor. Las llamadas reales requieren tus credenciales.
