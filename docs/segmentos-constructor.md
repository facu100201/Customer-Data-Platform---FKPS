# Constructor visual de segmentos

Resumen de los cambios a la pantalla **Segmentos** y a la API de segmentos: antes los segmentos se
creaban escribiendo la regla en JSON a mano; ahora hay un constructor visual, edición, vista previa,
modo JSON avanzado y borrado con confirmación.

## Qué puede hacer quien tiene `segments:write`

| Acción | Cómo |
| --- | --- |
| Crear un segmento | Nombre, descripción opcional y la regla armada en el constructor |
| Armar la regla | Grupos **todas estas condiciones** / **al menos una de estas condiciones**, anidables; condiciones campo · operador · valor; cualquier grupo o condición se puede negar (**no cumplen** / casilla **No**) |
| Editar un segmento | Botón **Editar** en la lista: abre nombre, descripción y regla en el mismo formulario |
| Vista previa | Botón **Vista previa**: "Coinciden 30 de 39 perfiles (76.9 %)", sin guardar nada |
| Modo avanzado | **Modo avanzado: ver y editar la regla en JSON**, sincronizado con el constructor |
| Borrar | Botón **Eliminar**, con confirmación que dice qué más se borra |

Quien solo tiene `segments:read` ve la lista, sin formulario ni botones.

Los campos y operadores se muestran en español (`frontend/web/src/services/segmentLabels.ts`), por
ejemplo "Gasto en los últimos 30 días (MXN)", "Riesgo de churn (de 0 a 1)", "es mayor o igual a",
"tiene valor".

## El formato de la regla no cambió

La regla que se guarda en `segments.definition` sigue siendo la de `shared/src/segments.ts`
(`all` / `any` / `not` y condiciones `{ field, op, value }`), validada con `ruleSchema`. El
constructor es solo otra forma de editarla:

- **Cualquier regla guardada se puede abrir** en el constructor sin perder significado. `not` se
  muestra como la opción "no cumplen" (grupos) o la casilla "No" (condiciones); una condición suelta
  en la raíz se muestra dentro de un grupo "todas".
- **Una regla guardada no se reescribe sola.** Solo se manda a la API si alguien cambió la regla. Cambiar
  el nombre o la descripción, abrir el JSON, escribir JSON inválido y volver atrás, o reescribir la
  misma regla con otros espacios u orden de llaves no la toca.
- **Al volver a guardar una regla editada se guarda en forma canónica**: sin `not` doble, `exists`
  sin `value`, raíz siempre `all`/`any`. Evalúa exactamente igual que la original.
- **No se guardan reglas incompletas**: grupos vacíos o comparaciones sin valor se marcan en rojo en
  la condición correspondiente. La API las aceptaría, pero una comparación sin valor nunca se cumple.

## Modo JSON

- Los cambios en el constructor reescriben el JSON; un JSON válido reemplaza al constructor mientras
  se escribe.
- Si el JSON es inválido: el constructor se bloquea mostrando la última regla válida, **no se puede
  guardar ni previsualizar**, y el error dice dónde está el problema
  (`En any[0]: "email" no es un campo del perfil…`). **Volver a la última regla válida** recupera el
  último texto válido.
- Una regla incompleta (grupo vacío, comparación sin valor) no es un error de JSON: pasa al
  constructor y se marca ahí.
- Al abrir un segmento guardado, el JSON muestra la regla tal como está en la base.

## API

| Ruta | Permiso | Qué hace |
| --- | --- | --- |
| `POST /api/segments` | `segments:write` | Sin cambios, salvo: nombre repetido → **409 `nombre_duplicado`** (antes 500) |
| `PATCH /api/segments/:id` | `segments:write` | **Nuevo.** Edición parcial de `name`, `description` (`null` la borra) y `definition`. Solo recalcula la membresía si cambió la regla. 404 si no existe, 409 si el nombre ya existe, 400 con campos desconocidos |
| `POST /api/segments/preview` | `segments:write` | **Nuevo.** Recibe `{ definition }` y devuelve `{ matches, total }`. Solo lee perfiles: no crea segmento, no toca membresías ni auditoría |
| `DELETE /api/segments/:id` | `segments:write` | 404 si no existe (antes 500). Borra también membresías y activaciones (`ON DELETE CASCADE`, ya estaba así en la base) |
| `GET /api/segments` | `segments:read` | Agrega `activationCount`, para avisar al borrar |

Auditoría: `segment.update` guarda los campos cambiados y la regla y el nombre anteriores;
`segment.delete` guarda nombre, descripción y regla. Con eso se puede recuperar una edición o un
borrado hecho por error.

La vista previa y el recálculo usan la misma función (`matchCustomers` en
`backend/api/src/services/segments.ts`), así que el conteo de la vista previa es el que queda al
guardar. Recorre todos los perfiles, igual que "Recalcular": por eso se pide con un botón y no en
cada cambio.

## Dónde está el código

| Archivo | Qué contiene |
| --- | --- |
| `shared/src/segmentBuilder.ts` | Modelo del constructor; conversión regla ⇄ constructor (`ruleToBuilder`, `builderToRule`); edición del árbol (`updateNode`, `removeNode`, `appendChild`, …); lectura del JSON con errores en español (`parseRuleJson`) |
| `frontend/web/src/components/RuleBuilder.tsx` | Componente del constructor (grupos y condiciones) |
| `frontend/web/src/services/segmentForm.ts` | Lógica del formulario sin React: qué mandar al crear o editar, sincronía constructor ⇄ JSON, vista previa, texto de la confirmación de borrado |
| `frontend/web/src/services/segmentLabels.ts` | Etiquetas en español de campos, operadores y grupos |
| `frontend/web/src/pages/Segments.tsx` | La pantalla |
| `backend/api/src/routes/segments.ts` | Rutas: `PATCH`, `preview`, 409 en `POST`, 404 en `DELETE`, `activationCount` |
| `backend/api/src/services/segments.ts` | `matchCustomers`, `previewSegment`, `refreshSegment` |

## Pruebas

`npm test` corre todas. Las de esta funcionalidad:

| Archivo | Qué cubre |
| --- | --- |
| `shared/src/segmentBuilder.test.ts` | Conversión en ambos sentidos, avisos por nodo, edición del árbol, lectura del JSON (mensajes y coincidencia con `ruleSchema` en 2000 reglas dañadas al azar) |
| `backend/engine/src/segmentation/builderRoundTrip.test.ts` | Ida y vuelta por el constructor evalúa igual que la regla original: 2000 reglas × 50 perfiles al azar |
| `backend/api/src/routes/segments.test.ts` | `PATCH`, `preview`, 409 de `POST`, `DELETE` y `activationCount`: permisos, validación, errores y qué se escribe |
| `backend/api/src/services/segments.test.ts` | Paginación de perfiles, que la vista previa solo lee, y que recalcular guarda lo mismo que cuenta la vista previa |
| `frontend/web/src/services/segmentForm.test.ts` | Qué se manda al guardar, que la regla guardada no se reescribe sola, sincronía y bloqueo del JSON, vista previa, confirmación de borrado |

Las pruebas con azar usan semilla fija: siempre generan los mismos casos. Como recorren miles de
casos tienen un límite de 30 s en lugar de los 5 s de Vitest; normalmente tardan menos de medio
segundo, pero con la máquina cargada (CI, varias suites a la vez) llegaron a pasar de 5 s.

### Cómo ver que las pruebas detectan errores

Cambiar una de estas líneas y correr `npm test` (después, deshacer el cambio):

| Línea | Cambio | Qué falla |
| --- | --- | --- |
| `shared/src/segmentBuilder.ts:91` | `!negated` → `negated` (el constructor pierde los `not`) | 12 pruebas del constructor, del JSON, del formulario y la de ida y vuelta con 2000 reglas |
| `backend/api/src/services/segments.ts:27` | quitar `members.push(c.id)` (nadie coincide) | 4 pruebas de vista previa y recálculo |
| `backend/api/src/routes/segments.ts:77` | `segments:write` → `segments:read` | Las 2 pruebas que impiden la vista previa a `usuario` y `qa` |
| `frontend/web/src/services/segmentForm.ts:142` | borrar la línea (deja previsualizar con JSON inválido) | La prueba de bloqueo por JSON inválido |

## Pendiente

- **Ediciones simultáneas**: si dos personas editan el mismo segmento, gana la última que guarda.
- La vista previa recorre todos los perfiles; con una base grande cada clic cuesta como un "Recalcular".
