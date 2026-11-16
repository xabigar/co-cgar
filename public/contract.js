// One schema for provider output, server validation and browser validation.
export const statuses = ['missing', 'vague', 'stated', 'checked', 'disputed'];
const string = {type: 'string'};
const status = {type: 'string', enum: statuses};
const object = properties => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false});
const list = items => ({type: 'array', items});
const element = object({text: string, status, source: string});
export const boardSchema = object({
  artifact: element,
  context: element,
  requirements: list(object({id: string, text: string, status, serves: list(string)})),
  goals: list(object({id: string, text: string, stakeholder: string, status, source: string})),
  checks: object(Object.fromEntries(['C0', 'C1', 'C2', 'C3'].map(id => [id, {type: 'string', enum: ['pass', 'fail', 'na']}]))),
  disputed: string,
  parked: string,
  next: string,
});
export const recordSchema = object({
  turn: {type: 'integer', description: 'The exact current turn number supplied by the application.'},
  phase: {type: 'integer', enum: [0, 1, 2, 3, 4]},
  move: {type: 'string', enum: ['answer', 'ask_source', 'run_check', 'elicit', 'show_board', 'synthesis']},
  check_run: {type: 'string', enum: ['C0', 'C1', 'C2', 'C3', 'none']},
  same_check_failures: {type: 'integer', description: 'Nonnegative count of consecutive failures of the same check on the same element.'},
  alternatives_offered: {type: 'boolean'},
  declined_to_write: {type: 'boolean'},
});
export function responseSchema(logging = true) {
  return object({
    message: {type: 'string', description: 'PRIMARY OUTPUT: the complete, useful student-facing coaching response, in the student language. Answer their question, explain as needed, and ask at most two focused questions, preferably one. Usually about 120 words. Never replace this with a board summary or a metadata status notification.'},
    board: {...boardSchema, description: 'Secondary state snapshot grounded only in the student wording and conversation. Empty values are allowed and must never be invented to fill the schema.'},
    record: logging ? {...recordSchema, description: 'Secondary research metadata for this same response. No duplicate board fields.'} : {type: 'null'},
  });
}

export class ContractError extends Error {
  constructor(issues) {
    super(issues.join(' '));
    this.name = 'ContractError';
    this.issues = issues;
  }
}
// Implements only the small JSON Schema subset used above (not a general schema engine).
function shapeIssues(schema, value, path, issues) {
  const matches = schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : schema.type === 'array' ? Array.isArray(value)
    : schema.type === 'integer' ? Number.isSafeInteger(value)
    : schema.type === 'null' ? value === null : typeof value === schema.type;
  if (!matches) {issues.push(`${path}: se requiere ${schema.type}.`); return;}
  if (schema.enum && !schema.enum.includes(value)) issues.push(`${path}: valor fuera de los permitidos.`);
  if (schema.type === 'object') {
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) issues.push(`${path}.${key}: campo obligatorio.`);
      else shapeIssues(schema.properties[key], value[key], `${path}.${key}`, issues);
    }
    if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) issues.push(`${path}: contiene campos no admitidos.`);
  } else if (schema.type === 'array') {
    value.forEach((item, i) => shapeIssues(schema.items, item, `${path}[${i}]`, issues));
  }
}
function assertShape(schema, value, path) {
  const issues = [];
  shapeIssues(schema, value, path, issues);
  if (issues.length) throw new ContractError(issues.slice(0, 12));
}
export function validateBoard(board) {
  assertShape(boardSchema, board, 'board');
  const issues = [];
  for (const [collection, prefix] of [['requirements', 'R'], ['goals', 'G']]) {
    const ids = new Set();
    for (const [i, entry] of board[collection].entries()) {
      if (!new RegExp(`^${prefix}[1-9][0-9]*$`).test(entry.id) || ids.has(entry.id)) issues.push(`board.${collection}[${i}].id: identificador inválido o duplicado.`);
      ids.add(entry.id);
    }
  }
  const goals = new Set(board.goals.map(goal => goal.id));
  for (const [i, requirement] of board.requirements.entries()) {
    if (requirement.serves.some(id => !goals.has(id))) issues.push(`board.requirements[${i}].serves: referencia a un objetivo inexistente; usa [] si todavía no se conoce.`);
    if (new Set(requirement.serves).size !== requirement.serves.length) issues.push(`board.requirements[${i}].serves: referencias duplicadas.`);
  }
  if (issues.length) throw new ContractError(issues.slice(0, 12));
  return board;
}
export function validMessage(message) {
  if (typeof message !== 'string' || !message.trim()) return false;
  if (/<!--\s*(?:STATE|BOARD_STATE)\b/.test(message)) return false;
  // A nested envelope is not an answer to the student.
  try {const candidate = message.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1'); const value = JSON.parse(candidate); if (value && typeof value === 'object') return false;} catch {}
  return true;
}
export function validateRecord(record, expectedTurn) {
  assertShape(recordSchema, record, 'record');
  if (record.turn < 1 || (expectedTurn !== undefined && record.turn !== expectedTurn)) throw new ContractError(['record.turn: debe coincidir con el turno indicado por la aplicación.']);
  if (record.same_check_failures < 0) throw new ContractError(['record.same_check_failures: debe ser un entero no negativo.']);
  return record;
}
export function validateReply(value, {logging = true, turn} = {}) {
  assertShape(responseSchema(logging), value, 'response');
  if (!validMessage(value.message)) throw new ContractError(['message: debe contener una respuesta útil para el alumno, no estar vacío ni contener el JSON completo o comentarios de estado.']);
  validateBoard(value.board);
  if (logging) validateRecord(value.record, turn);
  return value;
}
export function parseReply(raw, options) {
  let value;
  try {value = JSON.parse(raw);} catch {throw new ContractError(['response: devuelve un único objeto JSON válido, sin bloques Markdown, comentarios ni texto externo.']);}
  return validateReply(value, options);
}
