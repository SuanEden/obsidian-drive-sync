export function shouldIgnoreVaultPath(
  path: string,
  patterns: readonly string[],
  isFolder = false,
): boolean {
  const candidate = isFolder ? `${path.replace(/\/+$/u, '')}/` : path;

  return patterns.some((rawPattern) => {
    const pattern = rawPattern.trim().replace(/\\/gu, '/');
    if (pattern.length === 0 || pattern.startsWith('/')) {
      return false;
    }

    if (pattern.endsWith('/')) {
      const directory = pattern.replace(/\/+$/u, '').toLocaleLowerCase();
      const normalizedCandidate = candidate.toLocaleLowerCase();
      if (!directory.includes('/')) {
        return normalizedCandidate.replace(/\/+$/u, '').split('/').includes(directory);
      }

      return (
        normalizedCandidate === `${directory}/` || normalizedCandidate.startsWith(`${directory}/`)
      );
    }

    const value = pattern.includes('/') ? candidate : basename(candidate);
    return globMatches(value, pattern);
  });
}

function basename(path: string): string {
  const withoutTrailingSlash = path.replace(/\/+$/u, '');
  return withoutTrailingSlash.slice(withoutTrailingSlash.lastIndexOf('/') + 1);
}

function globMatches(value: string, pattern: string): boolean {
  const expression = globToRegExp(pattern);
  return expression.test(value);
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];

    if (character === '*' && next === '*') {
      source += '.*';
      index += 1;
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(character ?? '');
    }
  }

  return new RegExp(`${source}$`, 'iu');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
