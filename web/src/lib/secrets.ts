export const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

