export type VaultPathErrorCode =
  | 'empty'
  | 'absolute'
  | 'windows-drive'
  | 'backslash'
  | 'empty-segment'
  | 'dot-segment'
  | 'control-character';

export interface ValidVaultPath {
  readonly valid: true;
  readonly path: string;
}

export interface InvalidVaultPath {
  readonly valid: false;
  readonly code: VaultPathErrorCode;
  readonly message: string;
}

export type VaultPathValidation = ValidVaultPath | InvalidVaultPath;

/**
 * Valida um caminho vindo de metadados antes que ele alcance o Adapter.
 * A função não corrige entradas ambíguas: caminhos suspeitos são rejeitados.
 */
export function validateVaultRelativePath(path: string): VaultPathValidation {
  if (path.length === 0) {
    return invalid('empty', 'O caminho não pode ser vazio.');
  }

  if (path.startsWith('/')) {
    return invalid('absolute', 'Caminhos absolutos não são permitidos.');
  }

  if (/^[a-zA-Z]:\//u.test(path)) {
    return invalid('windows-drive', 'Caminhos com unidade do Windows não são permitidos.');
  }

  if (path.includes('\\')) {
    return invalid('backslash', 'Use somente barras normais em caminhos do cofre.');
  }

  if (hasControlCharacter(path)) {
    return invalid('control-character', 'Caracteres de controle não são permitidos.');
  }

  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    return invalid('empty-segment', 'Segmentos vazios não são permitidos.');
  }

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return invalid('dot-segment', 'Segmentos ponto e ponto duplo não são permitidos.');
  }

  return { valid: true, path };
}

export function assertVaultRelativePath(path: string): string {
  const result = validateVaultRelativePath(path);
  if (!result.valid) {
    throw new Error(`${result.message} Caminho recebido: ${JSON.stringify(path)}`);
  }

  return result.path;
}

function invalid(code: VaultPathErrorCode, message: string): InvalidVaultPath {
  return { valid: false, code, message };
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}
